package handlers

import (
	"context"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/notifications"
)

// Préférences de notification d'une entreprise cliente.
//
// Elles ne peuvent que **restreindre** ce que la politique de coût autorise,
// jamais l'élargir : un partenaire qui pourrait s'accorder des canaux
// contournerait le plafond de SMS de `internal/notifications/politique.go`, et
// la facture ne se verrait qu'après.

// PreferenceNotification est l'état d'un évènement pour un partenaire.
type PreferenceNotification struct {
	Evenement string `json:"evenement"`
	Libelle   string `json:"libelle"`
	Actif     bool   `json:"actif"`
	// Modifiable vaut faux quand la politique ne prévoit aucun canal : le
	// réglage est alors affiché mais grisé, plutôt qu'absent — un partenaire
	// doit pouvoir constater qu'une étape existe et qu'elle ne le concerne pas.
	Modifiable bool `json:"modifiable"`
}

// evenementsReglables liste ce qu'un partenaire peut choisir de recevoir, dans
// l'ordre où les étapes se produisent.
//
// Une tranche ordonnée plutôt qu'une carte : l'écran les affiche dans cet
// ordre, et une carte le rendrait aléatoire.
var evenementsReglables = []struct {
	evenement notifications.Evenement
	libelle   string
}{
	{notifications.EvtCourseAssignee, "Un livreur est assigné"},
	{notifications.EvtCourseRecuperee, "Le colis est récupéré"},
	{notifications.EvtCourseEnRoute, "Le livreur est en route"},
	{notifications.EvtCourseLivree, "La livraison est effectuée"},
	{notifications.EvtCourseAnnulee, "La commande est annulée"},
}

// ListerPreferencesNotification (partenaire ou collaborateur) — l'état complet.
//
// L'état complet et non les seules exclusions : le front ne doit pas avoir à
// connaître la liste des évènements pour afficher l'écran, sinon les deux
// listes divergent au premier ajout.
func (d *Deps) ListerPreferencesNotification(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	desactives, err := d.evenementsDesactives(c.Context(), *claims.PartenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des préférences échouée")
	}

	preferences := make([]PreferenceNotification, 0, len(evenementsReglables))
	for _, e := range evenementsReglables {
		// Modifiable seulement si la politique prévoit un canal : régler un
		// évènement qui ne partirait de toute façon pas donnerait l'illusion
		// d'un choix.
		modifiable := len(notifications.CanauxPour(e.evenement, notifications.CiblePartenaire)) > 0

		preferences = append(preferences, PreferenceNotification{
			Evenement:  string(e.evenement),
			Libelle:    e.libelle,
			Actif:      !desactives[string(e.evenement)],
			Modifiable: modifiable,
		})
	}

	return c.JSON(preferences)
}

type majPreferenceBody struct {
	Evenement string `json:"evenement"`
	Actif     *bool  `json:"actif"`
}

// MajPreferenceNotification (partenaire) — active ou coupe un évènement.
//
// Réservé au compte principal : un collaborateur qui couperait les
// notifications de l'entreprise rendrait ses collègues sourds sans qu'ils
// l'aient demandé.
func (d *Deps) MajPreferenceNotification(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	var body majPreferenceBody
	if err := c.BodyParser(&body); err != nil || body.Actif == nil {
		return fiber.NewError(fiber.StatusBadRequest, "evenement et actif requis")
	}

	// Le nom est validé contre la liste réglable : accepter n'importe quelle
	// chaîne remplirait la table de lignes sans effet, impossibles à
	// distinguer d'une faute de frappe.
	connu := false
	for _, e := range evenementsReglables {
		if string(e.evenement) == body.Evenement {
			connu = true
			break
		}
	}
	if !connu {
		return fiber.NewError(fiber.StatusBadRequest, "évènement inconnu")
	}

	ctx := c.Context()
	var err error
	if *body.Actif {
		_, err = d.DB.Exec(ctx,
			`DELETE FROM notifications_desactivees WHERE partenaire_id = $1 AND evenement = $2`,
			*claims.PartenaireID, body.Evenement)
	} else {
		_, err = d.DB.Exec(ctx, `
			INSERT INTO notifications_desactivees (partenaire_id, evenement)
			VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, *claims.PartenaireID, body.Evenement)
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "mise à jour échouée")
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// evenementsDesactives rend l'ensemble des évènements que le partenaire a
// coupés.
func (d *Deps) evenementsDesactives(ctx context.Context, partenaireID uuid.UUID) (map[string]bool, error) {
	rows, err := d.DB.Query(ctx,
		`SELECT evenement FROM notifications_desactivees WHERE partenaire_id = $1`,
		partenaireID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	desactives := map[string]bool{}
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			return nil, err
		}
		desactives[e] = true
	}
	return desactives, rows.Err()
}
