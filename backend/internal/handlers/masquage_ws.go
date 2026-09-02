package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/masquage"
	"fiyen-backend/internal/middleware"
)

const tailleMaxMessage = 1000

// evenementCanal circule dans les deux sens sur le canal masqué.
//
// `type` distingue la conversation du signaling : "message" est persisté et
// relayé, tandis que "offre"/"reponse"/"ice" ne sont que relayés — ce sont les
// primitives WebRTC nécessaires à l'appel in-app, sans intérêt à conserver.
type evenementCanal struct {
	Type    string          `json:"type"`
	Contenu string          `json:"contenu,omitempty"`
	Signal  json.RawMessage `json:"signal,omitempty"`

	// Renseignés par le serveur à la diffusion, ignorés en entrée.
	Expediteur string     `json:"expediteur,omitempty"`
	ID         *uuid.UUID `json:"id,omitempty"`
	CreatedAt  *time.Time `json:"created_at,omitempty"`
}

var typesSignaling = map[string]bool{"offre": true, "reponse": true, "ice": true}

// MasquageWS — canal de contact destinataire ↔ livreur d'une course.
//
// Le numéro réel des deux parties n'entre jamais dans ce canal : seul le
// session_id identifie la conversation, et l'autorisation est revérifiée à la
// connexion à partir du JWT.
func (d *Deps) MasquageWS(conn *websocket.Conn) {
	defer conn.Close()

	claims, ok := conn.Locals("claims").(*middleware.Claims)
	if !ok {
		return
	}

	sessionID, err := uuid.Parse(conn.Params("sessionId"))
	if err != nil {
		return
	}

	ctx := context.Background()
	session, err := masquage.ResoudreSessionParID(ctx, d.DB, sessionID, claims.DestinataireID, claims.LivreurID)
	if err != nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "accès refusé"))
		return
	}
	if !session.Active {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "canal fermé"))
		return
	}

	subCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Réception : diffuse à l'autre partie ce qui est publié sur le canal Redis.
	// Chaque évènement porte son expéditeur, ce qui permet d'ignorer l'écho de
	// ses propres messages côté client.
	go func() {
		_ = souscrireCanal(subCtx, d, session, func(payload []byte) {
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				cancel()
			}
		})
	}()

	for {
		_, brut, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var evt evenementCanal
		if err := json.Unmarshal(brut, &evt); err != nil {
			continue
		}

		// L'expiration est revérifiée à chaque envoi : une course peut se
		// terminer alors que la socket est encore ouverte.
		frais, err := masquage.ResoudreSessionParID(ctx, d.DB, sessionID, claims.DestinataireID, claims.LivreurID)
		if err != nil || !frais.Active {
			_ = conn.WriteMessage(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "canal fermé"))
			return
		}

		switch {
		case evt.Type == "message":
			contenu := strings.TrimSpace(evt.Contenu)
			if contenu == "" {
				continue
			}
			if len(contenu) > tailleMaxMessage {
				contenu = contenu[:tailleMaxMessage]
			}

			msg, err := masquage.EnregistrerMessage(ctx, d.DB, frais, contenu)
			if err != nil {
				continue
			}

			sortie := evenementCanal{
				Type:       "message",
				Contenu:    msg.Contenu,
				Expediteur: string(msg.Expediteur),
				ID:         &msg.ID,
				CreatedAt:  &msg.CreatedAt,
			}
			publierCanal(ctx, d, frais, sortie)

		case typesSignaling[evt.Type]:
			// Relais pur : le serveur ne conserve rien du contenu WebRTC.
			publierCanal(ctx, d, frais, evenementCanal{
				Type:       evt.Type,
				Signal:     evt.Signal,
				Expediteur: string(frais.Role),
			})
		}
	}
}

func publierCanal(ctx context.Context, d *Deps, session *masquage.Session, evt evenementCanal) {
	payload, err := json.Marshal(evt)
	if err != nil {
		return
	}
	_ = d.Redis.Publish(ctx, masquage.CanalRedis(session.ID), payload).Err()
}

func souscrireCanal(ctx context.Context, d *Deps, session *masquage.Session, onMessage func([]byte)) error {
	sub := d.Redis.Subscribe(ctx, masquage.CanalRedis(session.ID))
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			onMessage([]byte(msg.Payload))
		}
	}
}
