package handlers

import (
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"

	"fiyen-backend/internal/middleware"
)

// Enregistrement des jetons de notification.
//
// L'envoi lui-même vit dans `internal/notifications` : ce fichier ne fait que
// recueillir les jetons que les applications déclarent.

// Format d'un jeton Expo. Le valider évite de remplir la table de chaînes que
// le service d'envoi rejettera de toute façon — et rend visible tout de suite
// une application mal configurée, plutôt qu'au premier envoi raté.
var motifJetonExpo = regexp.MustCompile(`^Expo(nent)?PushToken\[[A-Za-z0-9._\-]+\]$`)

type jetonPushBody struct {
	Jeton      string `json:"jeton"`
	Plateforme string `json:"plateforme"`
}

var plateformesConnues = map[string]bool{"android": true, "ios": true, "web": true}

// EnregistrerJetonPush — l'application déclare l'appareil de son porteur.
//
// Ouvert à tous les rôles authentifiés : le livreur en a besoin en premier,
// mais un partenaire voudra suivre ses commandes de la même façon.
func (d *Deps) EnregistrerJetonPush(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)

	var body jetonPushBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	body.Jeton = strings.TrimSpace(body.Jeton)
	body.Plateforme = strings.ToLower(strings.TrimSpace(body.Plateforme))

	if !motifJetonExpo.MatchString(body.Jeton) {
		return fiber.NewError(fiber.StatusBadRequest,
			"jeton de notification invalide (format ExponentPushToken[...] attendu)")
	}
	if !plateformesConnues[body.Plateforme] {
		return fiber.NewError(fiber.StatusBadRequest, "plateforme inconnue")
	}

	// ON CONFLICT sur le **jeton** : un téléphone réinstallé ou passé d'un
	// livreur à l'autre garde le même jeton Expo. Sans cette réattribution,
	// l'ancien porteur continuerait de recevoir les courses du nouveau.
	if _, err := d.DB.Exec(c.Context(), `
		INSERT INTO jetons_push (utilisateur_id, jeton, plateforme)
		VALUES ($1, $2, $3)
		ON CONFLICT (jeton) DO UPDATE
		   SET utilisateur_id = EXCLUDED.utilisateur_id,
		       plateforme     = EXCLUDED.plateforme,
		       updated_at     = now()
	`, claims.UtilisateurID, body.Jeton, body.Plateforme); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "enregistrement du jeton échoué")
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// OublierJetonPush — à appeler à la déconnexion.
//
// Sans cela, un téléphone prêté ou revendu continuerait d'afficher les courses
// de son ancien porteur. C'est le pendant de la révocation de session : couper
// l'accès sans couper les notifications ne coupe rien du tout.
func (d *Deps) OublierJetonPush(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)

	var body jetonPushBody
	if err := c.BodyParser(&body); err != nil || strings.TrimSpace(body.Jeton) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "jeton requis")
	}

	// Le filtre sur l'utilisateur empêche d'effacer le jeton de quelqu'un
	// d'autre en le devinant. Aucune distinction entre « supprimé » et
	// « n'existait pas » : répondre différemment ferait de l'endpoint un moyen
	// de tester si un jeton appartient à un compte donné.
	if _, err := d.DB.Exec(c.Context(),
		`DELETE FROM jetons_push WHERE jeton = $1 AND utilisateur_id = $2`,
		strings.TrimSpace(body.Jeton), claims.UtilisateurID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "suppression du jeton échouée")
	}

	return c.SendStatus(fiber.StatusNoContent)
}
