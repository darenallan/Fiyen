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

	"fiyen-backend/internal/config"
	"fiyen-backend/internal/database"
	"fiyen-backend/internal/handlers"
	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
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

	deps := &handlers.Deps{DB: pool, Redis: rdb, Config: cfg}

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
		AllowMethods: "GET, POST, PATCH, OPTIONS",
	}))

	// --- Auth publique (rate limitée) ---
	authLimiter := limiter.New(limiter.Config{
		Max:        10,
		Expiration: time.Minute,
	})
	auth := app.Group("/api/auth", authLimiter)
	auth.Post("/register-compagnie", deps.RegisterCompagnie)
	auth.Post("/register-client", deps.RegisterClient)
	auth.Post("/login", deps.Login)

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
	coursesGroup.Post("/", middleware.RolesRequis(models.RoleCompagnie, models.RoleClient), deps.CreerCourse)
	coursesGroup.Get("/", middleware.RolesRequis(models.RoleCompagnie), deps.ListerCourses)
	// déclaré avant /:id, sinon "mes-courses" serait capturé comme identifiant
	coursesGroup.Get("/mes-courses", middleware.RolesRequis(models.RoleLivreur, models.RoleClient), deps.ListerMesCourses)
	coursesGroup.Get("/:id", deps.ObtenirCourse)
	coursesGroup.Get("/:id/masquage", middleware.RolesRequis(models.RoleLivreur, models.RoleClient), deps.ObtenirSessionMasquage)
	coursesGroup.Patch("/:id/assigner", middleware.RolesRequis(models.RoleCompagnie), deps.AssignerCourse)
	coursesGroup.Patch("/:id/statut", middleware.RolesRequis(models.RoleLivreur), deps.MettreAJourStatutCourse)

	dashboardGroup := api.Group("/dashboard", middleware.RolesRequis(models.RoleCompagnie))
	dashboardGroup.Get("/stats", deps.StatsDashboard)
	dashboardGroup.Get("/config-tarifaire", deps.ObtenirConfigTarifaire)

	api.Get("/clients/recherche", middleware.RolesRequis(models.RoleCompagnie), deps.RechercherClientParTelephone)

	// Canal masqué : réservé aux deux extrémités de la course. La compagnie
	// elle-même n'y a pas accès — elle gère la course, pas la conversation.
	api.Get("/masquage/:sessionId/messages",
		middleware.RolesRequis(models.RoleLivreur, models.RoleClient),
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

	app.Get("/ws/masquage/:sessionId",
		wsLimiter,
		middleware.AuthRequisWS(cfg.JWTSecret),
		upgradeSeulement,
		websocket.New(deps.MasquageWS),
	)

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"statut": "ok"})
	})

	log.Fatal(app.Listen(":" + cfg.Port))
}
