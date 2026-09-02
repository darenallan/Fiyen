package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/masquage"
	"fiyen-backend/internal/middleware"
)

// erreurMasquage traduit les erreurs du domaine en réponses HTTP.
// « introuvable » et « accès refusé » renvoient volontairement le même 404 :
// distinguer les deux permettrait de deviner quelles courses existent.
func erreurMasquage(err error) error {
	switch err {
	case masquage.ErrSessionIntrouvable, masquage.ErrAccesRefuse:
		return fiber.NewError(fiber.StatusNotFound, "aucun canal de contact pour cette course")
	case masquage.ErrSessionExpiree:
		return fiber.NewError(fiber.StatusGone, "ce canal est fermé, la course est terminée")
	default:
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
}

// ObtenirSessionMasquage (client ou livreur assigné) — donne au front le
// session_id à utiliser pour contacter l'autre partie, sans jamais lui
// transmettre de numéro réel ni l'identifiant de son interlocuteur.
func (d *Deps) ObtenirSessionMasquage(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	session, err := masquage.ResoudreSession(c.Context(), d.DB, courseID, claims.DestinataireID, claims.LivreurID)
	if err != nil {
		return erreurMasquage(err)
	}

	return c.JSON(session)
}

// ListerMessagesMasques (client ou livreur assigné) — historique du canal.
// L'historique reste lisible après expiration (le destinataire doit pouvoir relire
// l'échange), mais plus rien ne peut y être ajouté.
func (d *Deps) ListerMessagesMasques(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	sessionID, err := uuid.Parse(c.Params("sessionId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de session invalide")
	}

	session, err := masquage.ResoudreSessionParID(c.Context(), d.DB, sessionID, claims.DestinataireID, claims.LivreurID)
	if err != nil {
		return erreurMasquage(err)
	}

	messages, err := masquage.ListerMessages(c.Context(), d.DB, session.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des messages échouée")
	}

	return c.JSON(messages)
}
