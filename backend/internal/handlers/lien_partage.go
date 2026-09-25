package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"html/template"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
)

// Lien de reçu partageable par WhatsApp.
//
// Le destinataire n'a pas de compte : ce lien lui donne un accès en lecture
// seule à un seul reçu, sans authentification. Il n'apprend rien de plus que
// le reçu du partenaire — ni montant, ni téléphone, ni identité du livreur —
// puisqu'il en réutilise le chargement (`avecLivreur=false`).
//
// Pourquoi pas un simple `wa.me/<numero>?text=...` visant directement le
// destinataire : sa plateforme ne connaît que `telephone_hash`, jamais le
// numéro en clair. `wa.me/?text=...` (sans numéro) ouvre WhatsApp sur le choix
// du contact, et c'est la personne qui partage — compagnie ou partenaire —
// qui le sélectionne depuis son propre téléphone.

// dureeLienPartage borne la durée de vie d'un lien sorti de l'application. Un
// reçu en lui-même ne périme pas, mais un message WhatsApp peut être transféré
// ou retrouvé des mois plus tard : 90 jours couvre l'usage réel (retrouver la
// preuve d'une livraison passée) sans laisser un lien oublié valide
// indéfiniment.
const dureeLienPartage = 90 * 24 * time.Hour

type lienPartageBody struct {
	URL      string    `json:"url"`
	ExpireLe time.Time `json:"expire_le"`
}

func genererJetonPartage() (string, error) {
	octets := make([]byte, 32)
	if _, err := rand.Read(octets); err != nil {
		return "", fmt.Errorf("génération aléatoire: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(octets), nil
}

// genererOuReutiliserLien rend le lien actif d'une course, en réutilisant
// celui déjà émis tant qu'il n'a pas expiré : un second clic sur « Partager »
// doit redonner le même lien, pas en empiler un nouveau à chaque fois.
func (d *Deps) genererOuReutiliserLien(ctx context.Context, courseID uuid.UUID, creePar *uuid.UUID) (lienPartageBody, error) {
	var jeton string
	var expireAt time.Time
	err := d.DB.QueryRow(ctx, `
		SELECT jeton, expire_at FROM liens_partages_recu
		WHERE course_id = $1 AND expire_at > now()
		ORDER BY created_at DESC LIMIT 1
	`, courseID).Scan(&jeton, &expireAt)

	if err == pgx.ErrNoRows {
		// Variable dédiée plutôt que réassigner `jeton` : un `:=` dans ce bloc
		// créerait une ombre de la variable englobante, moins lisible qu'un
		// nom distinct pour ce qui est, ici, une valeur réellement nouvelle.
		nouveauJeton, genErr := genererJetonPartage()
		if genErr != nil {
			return lienPartageBody{}, fiber.NewError(fiber.StatusInternalServerError, "génération du lien échouée")
		}
		expireAt = time.Now().UTC().Add(dureeLienPartage)
		if _, err := d.DB.Exec(ctx, `
			INSERT INTO liens_partages_recu (course_id, jeton, cree_par, expire_at)
			VALUES ($1, $2, $3, $4)
		`, courseID, nouveauJeton, creePar, expireAt); err != nil {
			return lienPartageBody{}, fiber.NewError(fiber.StatusInternalServerError, "enregistrement du lien échoué")
		}
		return lienPartageBody{
			URL:      d.Config.URLPublique + "/r/" + nouveauJeton,
			ExpireLe: expireAt,
		}, nil
	}
	if err != nil {
		return lienPartageBody{}, fiber.NewError(fiber.StatusInternalServerError, "lecture du lien échouée")
	}

	return lienPartageBody{URL: d.Config.URLPublique + "/r/" + jeton, ExpireLe: expireAt}, nil
}

// GenererLienRecuCourse (compagnie).
func (d *Deps) GenererLienRecuCourse(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte compagnie requis")
	}
	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	var appartient bool
	if err := d.DB.QueryRow(c.Context(),
		`SELECT true FROM courses WHERE id = $1 AND compagnie_id = $2`,
		courseID, *claims.CompagnieID).Scan(&appartient); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}

	lien, err := d.genererOuReutiliserLien(c.Context(), courseID, &claims.UtilisateurID)
	if err != nil {
		return err
	}
	return c.JSON(lien)
}

// GenererLienRecuCommande (partenaire ou collaborateur).
func (d *Deps) GenererLienRecuCommande(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}
	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	var appartient bool
	if err := d.DB.QueryRow(c.Context(),
		`SELECT true FROM courses WHERE id = $1 AND partenaire_id = $2`,
		courseID, *claims.PartenaireID).Scan(&appartient); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "commande introuvable")
	}

	lien, err := d.genererOuReutiliserLien(c.Context(), courseID, &claims.UtilisateurID)
	if err != nil {
		return err
	}
	return c.JSON(lien)
}

// courseDuJetonPartage rend l'identifiant de course d'un jeton valide, ou
// l'erreur à renvoyer. « introuvable » couvre aussi bien un jeton qui n'a
// jamais existé qu'un jeton expiré — les distinguer n'apprendrait rien
// d'utile à un tiers qui devine.
func (d *Deps) courseDuJetonPartage(ctx context.Context, jeton string) (uuid.UUID, error) {
	var courseID uuid.UUID
	err := d.DB.QueryRow(ctx,
		`SELECT course_id FROM liens_partages_recu WHERE jeton = $1 AND expire_at > now()`,
		jeton).Scan(&courseID)
	if err == pgx.ErrNoRows {
		return uuid.Nil, fiber.NewError(fiber.StatusNotFound, "lien introuvable ou expiré")
	}
	if err != nil {
		return uuid.Nil, fiber.NewError(fiber.StatusInternalServerError, "lecture du lien échouée")
	}
	return courseID, nil
}

// RecuPartage (public, sans authentification) — rend le reçu en HTML
// imprimable, pas en JSON : celui qui ouvre ce lien n'a pas d'application pour
// interpréter une réponse API.
func (d *Deps) RecuPartage(c *fiber.Ctx) error {
	jeton := c.Params("jeton")
	courseID, err := d.courseDuJetonPartage(c.Context(), jeton)
	if err != nil {
		return err
	}

	// avecLivreur=false, sans condition sur le rôle : ce lien quitte les
	// applications de confiance, la garantie de masquage s'applique donc dans
	// tous les cas, comme pour le partenaire.
	recu, err := d.chargerRecu(c, courseID, false)
	if err != nil {
		return err
	}

	c.Set(fiber.HeaderContentType, "text/html; charset=utf-8")
	return modeleRecuPartage.Execute(c, recuPartageVue{
		Recu:     *recu,
		MediaURL: fmt.Sprintf("/r/%s/preuve/media", jeton),
		Etapes:   libellesEtapes,
	})
}

// MediaPreuvePartage (public) — l'image de la preuve, servie à part pour la
// même raison que côté applications authentifiées : ne pas la retélécharger à
// chaque ouverture du document.
func (d *Deps) MediaPreuvePartage(c *fiber.Ctx) error {
	jeton := c.Params("jeton")
	courseID, err := d.courseDuJetonPartage(c.Context(), jeton)
	if err != nil {
		return err
	}

	var media []byte
	var mime *string
	err = d.DB.QueryRow(c.Context(),
		`SELECT media, media_mime FROM preuves_livraison WHERE course_id = $1`, courseID).
		Scan(&media, &mime)
	if err == pgx.ErrNoRows || (err == nil && media == nil) {
		return fiber.NewError(fiber.StatusNotFound, "aucune image pour cette course")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture de l'image échouée")
	}
	if _, ok := mimesPreuve[*mime]; !ok {
		return fiber.NewError(fiber.StatusInternalServerError, "type d'image inattendu")
	}

	c.Set(fiber.HeaderContentType, *mime)
	c.Set(fiber.HeaderCacheControl, "private, max-age=31536000, immutable")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set(fiber.HeaderContentDisposition, "inline")
	return c.Send(media)
}

var libellesEtapes = map[string]string{
	EvtJournalCreee:     "Commande reçue",
	EvtJournalAssignee:  "Livreur assigné",
	EvtJournalRecuperee: "Colis récupéré",
	EvtJournalEnRoute:   "En route",
	EvtJournalLivree:    "Livré",
	EvtJournalAnnulee:   "Annulée",
}

type recuPartageVue struct {
	Recu
	MediaURL string
	Etapes   map[string]string
}

// modeleRecuPartage est un `html/template` et non une concaténation de
// chaînes : les adresses, descriptions et noms qui y figurent sont du texte
// libre saisi par un partenaire ou une compagnie, et ce document est le seul
// de tout le produit rendu directement en HTML plutôt que consommé par une
// application React. Sans l'échappement automatique du paquet, une adresse
// contenant `<script>` s'exécuterait dans le navigateur du destinataire.
var modeleRecuPartage = template.Must(template.New("recu").Funcs(template.FuncMap{
	"horodatage": func(t time.Time) string { return t.Format("02/01/2006 15:04") },
	"etape": func(etapes map[string]string, evt string) string {
		if libelle, ok := etapes[evt]; ok {
			return libelle
		}
		return evt
	},
	"titreDocument": func(statut models.StatutCourse) string {
		switch statut {
		case models.CourseLivree:
			return "Reçu de livraison"
		case models.CourseAnnulee:
			return "Commande annulée"
		default:
			return "Bon de commande"
		}
	},
}).Parse(gabaritRecuPartage))
