package handlers

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/tracking"
)

type positionEntrante struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	// Horodatage de capture GPS (ISO 8601). Optionnel : absent pour un envoi
	// temps réel, renseigné quand l'app rejoue des positions mises en cache
	// pendant une coupure réseau.
	Horodatage *time.Time `json:"horodatage,omitempty"`
}

// LivreurPositionWS — le livreur pousse sa position GPS toutes les 3-5s.
func (d *Deps) LivreurPositionWS(conn *websocket.Conn) {
	defer conn.Close()

	claims, ok := conn.Locals("claims").(*middleware.Claims)
	if !ok || claims.Role != models.RoleLivreur || claims.LivreurID == nil || claims.CompagnieID == nil {
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rôle non autorisé"))
		return
	}

	ctx := context.Background()
	ttl := time.Duration(d.Config.PositionTTLSecondes) * time.Second

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var payload positionEntrante
		if err := json.Unmarshal(msg, &payload); err != nil {
			continue
		}

		var horodatage time.Time
		if payload.Horodatage != nil {
			horodatage = *payload.Horodatage
		}

		if err := tracking.EnregistrerPosition(ctx, d.Redis, d.DB, ttl, *claims.LivreurID, *claims.CompagnieID, payload.Latitude, payload.Longitude, horodatage); err != nil {
			continue
		}
	}
}

type lotPositionsBody struct {
	Positions []positionEntrante `json:"positions"`
}

// Plafond par requête : borne la charge d'un rattrapage après une longue
// coupure réseau, sans empêcher un lot normal de passer.
const maxPositionsParLot = 200

// DeposerPositions (livreur) — dépôt par lots des positions GPS.
//
// Complète le WebSocket plutôt que de le remplacer : l'app mobile suit la
// position via une tâche Android d'arrière-plan, réveillée par lots, qui ne
// peut pas maintenir une socket ouverte de façon fiable. Le dépôt groupé est
// aussi plus économe en données qu'un envoi par position.
func (d *Deps) DeposerPositions(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.LivreurID == nil || claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte non rattaché à un livreur")
	}

	var body lotPositionsBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if len(body.Positions) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "aucune position transmise")
	}
	if len(body.Positions) > maxPositionsParLot {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "lot de positions trop volumineux")
	}

	ctx := c.Context()
	ttl := time.Duration(d.Config.PositionTTLSecondes) * time.Second

	// Les positions arrivent dans l'ordre de capture. « traitées » et non
	// « enregistrées » : une position rejouée plus ancienne que la dernière
	// connue est bien diffusée aux abonnés, mais volontairement pas persistée.
	traitees := 0
	for _, p := range body.Positions {
		var horodatage time.Time
		if p.Horodatage != nil {
			horodatage = *p.Horodatage
		}
		if err := tracking.EnregistrerPosition(ctx, d.Redis, d.DB, ttl,
			*claims.LivreurID, *claims.CompagnieID, p.Latitude, p.Longitude, horodatage); err != nil {
			// Une position en échec ne doit pas faire perdre tout le lot.
			continue
		}
		traitees++
	}

	if traitees == 0 {
		return fiber.NewError(fiber.StatusInternalServerError, "aucune position n'a pu être traitée")
	}

	return c.JSON(fiber.Map{"traitees": traitees, "recues": len(body.Positions)})
}

// CoursePositionWS — le client ou la compagnie s'abonne à la position live du livreur assigné.
func (d *Deps) CoursePositionWS(conn *websocket.Conn) {
	defer conn.Close()

	claims, ok := conn.Locals("claims").(*middleware.Claims)
	if !ok {
		return
	}

	courseID, err := uuid.Parse(conn.Params("id"))
	if err != nil {
		return
	}

	ctx := context.Background()

	var compagnieID, clientID uuid.UUID
	var livreurID *uuid.UUID
	err = d.DB.QueryRow(ctx,
		`SELECT compagnie_id, client_id, livreur_id FROM courses WHERE id = $1`,
		courseID,
	).Scan(&compagnieID, &clientID, &livreurID)
	if err != nil {
		return
	}

	autorise := false
	switch claims.Role {
	case models.RoleCompagnie:
		autorise = claims.CompagnieID != nil && *claims.CompagnieID == compagnieID
	case models.RoleClient:
		autorise = claims.ClientID != nil && *claims.ClientID == clientID
	case models.RoleLivreur:
		autorise = claims.LivreurID != nil && livreurID != nil && *claims.LivreurID == *livreurID
	}
	if !autorise || livreurID == nil {
		return
	}

	subCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	_ = tracking.SouscrirePositionCourse(subCtx, d.Redis, *livreurID, func(payload []byte) {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			cancel()
		}
	})
}

// FlotteWS — la compagnie suit en direct la position de tous ses livreurs.
func (d *Deps) FlotteWS(conn *websocket.Conn) {
	defer conn.Close()

	claims, ok := conn.Locals("claims").(*middleware.Claims)
	if !ok || claims.Role != models.RoleCompagnie || claims.CompagnieID == nil {
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rôle non autorisé"))
		return
	}

	subCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// La compagnie n'envoie rien : cette lecture ne sert qu'à détecter la
	// fermeture de l'onglet pour libérer l'abonnement Redis.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	_ = tracking.SouscrireFlotteCompagnie(subCtx, d.Redis, *claims.CompagnieID, func(payload []byte) {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			cancel()
		}
	})
}
