package main

import (
	"context"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/websocket/v2"

	"fiyen-backend/internal/auth"
	"fiyen-backend/internal/config"
	"fiyen-backend/internal/database"
	"fiyen-backend/internal/handlers"
	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/notifications"
)

func main() {
	cfg := config.Load()

	ctx := context.Background()

	pool, err := database.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connexion PostgreSQL échouée: %v", err)
	}
	defer pool.Close()

	rdb, err := database.NewRedisClient(ctx, cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		log.Fatalf("connexion Redis échouée: %v", err)
	}
	defer rdb.Close()

	deps := &handlers.Deps{
		DB:     pool,
		Redis:  rdb,
		Config: cfg,
		// Expo n'exige aucune configuration pour envoyer : le jeton d'accès
		// ne sert que si la sécurité push est activée côté EAS.
		Notifications: notifications.NouvelEnvoyeurExpo(cfg.ExpoJetonAcces),
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"erreur": err.Error()})
		},
	})

	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: cfg.CORSOrigins,
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		// DELETE compris : l'annulation d'une invitation et l'oubli d'un jeton
		// de notification passent par lui. Une méthode absente d'ici est
		// bloquée par le navigateur au pré-vol, sans que le serveur voie rien
		// — le genre de panne qui ne se lit que dans la console du client.
		AllowMethods: "GET, POST, PATCH, DELETE, OPTIONS",
	}))

	// --- Auth publique (rate limitée) ---
	authLimiter := limiter.New(limiter.Config{
		Max:        10,
		Expiration: time.Minute,
	})
	authGroup := app.Group("/api/auth", authLimiter)
	authGroup.Post("/register-compagnie", deps.RegisterCompagnie)
	authGroup.Post("/register-destinataire", deps.RegisterDestinataire)
	authGroup.Post("/login", deps.Login)

	// Le renouvellement a sa propre limite, plus haute : il n'y a rien à
	// deviner sur un jeton de 256 bits d'aléa, alors qu'un opérateur mobile
	// burkinabè fait sortir beaucoup d'abonnés derrière la même IP. Une limite
	// calquée sur celle du login déconnecterait des utilisateurs légitimes.
	refreshLimiter := limiter.New(limiter.Config{
		Max:        60,
		Expiration: time.Minute,
	})
	app.Post("/api/auth/refresh", refreshLimiter, deps.Refresh)
	app.Post("/api/auth/deconnexion", refreshLimiter, deps.Deconnexion)

	// Activation d'un collaborateur invité : nécessairement publique, l'invité
	// n'ayant pas encore de compte. Le code à 6 chiffres tient lieu de preuve,
	// d'où une limite plus serrée que le login — c'est le seul endroit du
	// système où un secret court est accepté.
	authGroup.Post("/activer-collaborateur",
		limiter.New(limiter.Config{Max: 5, Expiration: time.Minute}),
		deps.ActiverCollaborateur,
	)

	// --- API authentifiée ---
	api := app.Group("/api", middleware.AuthRequis(cfg.JWTSecret))

	livreursGroup := api.Group("/livreurs")
	livreursGroup.Post("/", middleware.RolesRequis(models.RoleCompagnie), deps.CreerLivreur)
	livreursGroup.Get("/", middleware.RolesRequis(models.RoleCompagnie), deps.ListerLivreurs)
	livreursGroup.Get("/me", middleware.RolesRequis(models.RoleLivreur), deps.ObtenirMonProfilLivreur)
	livreursGroup.Patch("/me/statut", middleware.RolesRequis(models.RoleLivreur), deps.MettreAJourStatutLivreur)

	// Dépôt de positions par lots, utilisé par l'app mobile dont la tâche
	// d'arrière-plan ne peut pas tenir un WebSocket ouvert. Limite calibrée
	// large : un livreur dépose normalement un lot toutes les ~15 s, mais
	// rattrape parfois plusieurs lots d'affilée au retour du réseau.
	livreursGroup.Post("/me/positions",
		middleware.RolesRequis(models.RoleLivreur),
		limiter.New(limiter.Config{Max: 120, Expiration: time.Minute}),
		deps.DeposerPositions,
	)

	coursesGroup := api.Group("/courses")
	coursesGroup.Post("/", middleware.RolesRequis(models.RoleCompagnie, models.RoleDestinataire), deps.CreerCourse)
	coursesGroup.Get("/", middleware.RolesRequis(models.RoleCompagnie), deps.ListerCourses)
	// déclaré avant /:id, sinon "mes-courses" serait capturé comme identifiant
	coursesGroup.Get("/mes-courses", middleware.RolesRequis(models.RoleLivreur, models.RoleDestinataire), deps.ListerMesCourses)
	coursesGroup.Get("/:id", deps.ObtenirCourse)
	coursesGroup.Get("/:id/masquage", middleware.RolesRequis(models.RoleLivreur, models.RoleDestinataire), deps.ObtenirSessionMasquage)
	coursesGroup.Patch("/:id/assigner", middleware.RolesRequis(models.RoleCompagnie), deps.AssignerCourse)
	coursesGroup.Patch("/:id/statut", middleware.RolesRequis(models.RoleLivreur), deps.MettreAJourStatutCourse)

	// --- Partenaires et collaborateurs ---
	//
	// Deux entrées pour les mêmes actions, selon qui agit : la compagnie passe
	// par /partenaires/:id/... et désigne l'entreprise, le partenaire par
	// /mon-partenaire/... et n'a pas à connaître son propre identifiant. Le
	// rattachement est revérifié en base dans les deux cas.
	partenairesGroup := api.Group("/partenaires", middleware.RolesRequis(models.RoleCompagnie))
	partenairesGroup.Post("/", deps.CreerPartenaire)
	partenairesGroup.Get("/", deps.ListerPartenaires)
	partenairesGroup.Patch("/:id", deps.MajPartenaire)
	partenairesGroup.Get("/:id/collaborateurs", deps.ListerCollaborateurs)
	partenairesGroup.Post("/:id/collaborateurs", deps.InviterCollaborateur)
	partenairesGroup.Patch("/:id/collaborateurs/:collaborateurId", deps.MajCollaborateur)
	partenairesGroup.Delete("/:id/invitations/:invitationId", deps.AnnulerInvitation)

	// Le collaborateur lit la fiche de son entreprise mais ne gère pas ses
	// comptes : c'est la seule chose qui le distingue du compte partenaire.
	api.Get("/mon-partenaire",
		middleware.RolesRequis(models.RolePartenaire, models.RoleCollaborateur),
		deps.MonPartenaire,
	)

	// Lecture ouverte au collaborateur : il doit pouvoir constater ce que son
	// entreprise a reglé. L'ecriture reste au compte principal — un
	// collaborateur qui couperait les notifications rendrait ses collegues
	// sourds sans qu'ils l'aient demande.
	api.Get("/mon-partenaire/notifications",
		middleware.RolesRequis(models.RolePartenaire, models.RoleCollaborateur),
		deps.ListerPreferencesNotification,
	)

	monPartenaire := api.Group("/mon-partenaire", middleware.RolesRequis(models.RolePartenaire))
	monPartenaire.Patch("/notifications", deps.MajPreferenceNotification)
	monPartenaire.Get("/collaborateurs", deps.ListerCollaborateurs)
	monPartenaire.Post("/collaborateurs", deps.InviterCollaborateur)
	monPartenaire.Patch("/collaborateurs/:collaborateurId", deps.MajCollaborateur)
	monPartenaire.Delete("/invitations/:invitationId", deps.AnnulerInvitation)

	// --- Commande en autonomie ---
	//
	// Groupe distinct de /courses : ce que voit un partenaire de sa commande
	// n'est pas ce que voit la compagnie, et mélanger les deux dans un même
	// handler ferait dépendre le contenu d'un `switch` sur le rôle — la porte
	// ouverte à une fuite le jour où un cas manque.
	commandes := api.Group("/commandes",
		middleware.RolesRequis(models.RolePartenaire, models.RoleCollaborateur))
	commandes.Post("/", deps.CreerCoursePartenaire)
	commandes.Get("/", deps.ListerCoursesPartenaire)
	// déclaré avant /:id, sinon "carnet" serait capturé comme identifiant
	commandes.Get("/carnet", deps.CarnetDestinataires)
	commandes.Get("/:id", deps.ObtenirCoursePartenaire)
	commandes.Post("/:id/annuler", deps.AnnulerCoursePartenaire)

	// La file des commandes entrantes vit sous /dashboard et non à la racine :
	// `Group("/commandes")` filtre par **préfixe de chaîne**, pas par segment,
	// et capturerait donc aussi « /commandes-entrantes » — que son middleware
	// réserverait alors aux partenaires, refusant la compagnie chez elle.

	// --- Notifications ---
	//
	// Ouvert à tous les rôles authentifiés : le livreur en a besoin en premier,
	// mais un partenaire voudra suivre ses commandes de la même façon.
	api.Post("/notifications/jeton", deps.EnregistrerJetonPush)
	api.Delete("/notifications/jeton", deps.OublierJetonPush)

	dashboardGroup := api.Group("/dashboard", middleware.RolesRequis(models.RoleCompagnie))
	dashboardGroup.Get("/commandes-entrantes", deps.CommandesEntrantes)
	dashboardGroup.Get("/stats", deps.StatsDashboard)
	dashboardGroup.Get("/config-tarifaire", deps.ObtenirConfigTarifaire)

	api.Get("/destinataires/recherche", middleware.RolesRequis(models.RoleCompagnie), deps.RechercherDestinataireParTelephone)

	// Canal masqué : réservé aux deux extrémités de la course. La compagnie
	// elle-même n'y a pas accès — elle gère la course, pas la conversation.
	api.Get("/masquage/:sessionId/messages",
		middleware.RolesRequis(models.RoleLivreur, models.RoleDestinataire),
		deps.ListerMessagesMasques,
	)

	// --- Tracking temps réel (WebSocket, rate limitée sur le handshake) ---
	wsLimiter := limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
	})

	upgradeSeulement := func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	}

	app.Get("/ws/livreur/position",
		wsLimiter,
		middleware.AuthRequisWS(cfg.JWTSecret),
		upgradeSeulement,
		websocket.New(deps.LivreurPositionWS),
	)

	app.Get("/ws/courses/:id/position",
		wsLimiter,
		middleware.AuthRequisWS(cfg.JWTSecret),
		upgradeSeulement,
		websocket.New(deps.CoursePositionWS),
	)

	app.Get("/ws/compagnie/flotte",
		wsLimiter,
		middleware.AuthRequisWS(cfg.JWTSecret),
		upgradeSeulement,
		websocket.New(deps.FlotteWS),
	)

	// Le partenaire suit ses commandes en direct. Complete le rafraichissement
	// a 20 s plutot que de le remplacer : sur un reseau qui vacille, la socket
	// tombe et c'est le sondage qui rattrape.
	app.Get("/ws/partenaire/evenements",
		wsLimiter,
		middleware.AuthRequisWS(cfg.JWTSecret),
		upgradeSeulement,
		websocket.New(deps.EvenementsPartenaireWS),
	)

	app.Get("/ws/masquage/:sessionId",
		wsLimiter,
		middleware.AuthRequisWS(cfg.JWTSecret),
		upgradeSeulement,
		websocket.New(deps.MasquageWS),
	)

	// Deux points de contrôle, aux conséquences distinctes :
	//   /health       interroge Postgres et Redis → sonde de *readiness*
	//   /health/live  répond tant que le processus tourne → sonde de *liveness*
	// Les confondre ferait redémarrer le service quand la base tombe, ce qui
	// ne répare rien et ajoute une panne à la panne.
	app.Get("/health", deps.Sante)
	app.Get("/health/live", deps.Vivant)

	// Ménage des sessions expirées. Lancé en arrière-plan : `auth.Purger` était
	// écrit et n'était appelé nulle part, donc `sessions_refresh` grossissait
	// indéfiniment. Le contexte permet de couper la boucle à l'arrêt.
	ctxFond, arreterFond := context.WithCancel(context.Background())
	defer arreterFond()
	go auth.PurgerPeriodiquement(
		ctxFond, pool,
		time.Duration(cfg.PurgeIntervalleH)*time.Hour,
		log.Default(),
	)

	log.Fatal(app.Listen(":" + cfg.Port))
}
