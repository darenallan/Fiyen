// Package masquage porte le canal de communication destinataire ↔ livreur.
//
// Garantie centrale : aucun numéro de téléphone réel ne transite, et le client
// ne connaît jamais le `livreur_id`. Seul le `session_id` circule côté front,
// et il devient inutilisable dès que la course est terminée.
package masquage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Role identifie une extrémité du canal. Volontairement limité à deux valeurs :
// personne d'autre ne peut participer à la conversation.
type Role string

const (
	RoleDestinataire Role = "destinataire"
	RoleLivreur      Role = "livreur"
)

var (
	ErrSessionIntrouvable = errors.New("session de masquage introuvable")
	ErrSessionExpiree     = errors.New("session de masquage expirée")
	ErrAccesRefuse        = errors.New("accès refusé à cette session")
)

// Session décrit le canal tel qu'on peut l'exposer au front : ni numéro réel,
// ni identifiant de l'autre partie.
type Session struct {
	ID       uuid.UUID `json:"session_id"`
	CourseID uuid.UUID `json:"course_id"`
	ExpireAt time.Time `json:"expire_at"`
	// Role de celui qui interroge, pour que le front sache de quel côté il est.
	Role Role `json:"role"`
	// NumeroVirtuel n'est renseigné que si un repli PSTN a été provisionné ;
	// c'est un numéro loué, jamais celui d'un participant.
	NumeroVirtuel *string `json:"numero_virtuel,omitempty"`
	Active        bool    `json:"active"`
}

// Message est une ligne de conversation. `Expediteur` est un rôle, jamais une
// identité : le front affiche "vous"/"votre livreur", pas un nom ou un numéro.
type Message struct {
	ID         uuid.UUID `json:"id"`
	Expediteur Role      `json:"expediteur"`
	Contenu    string    `json:"contenu"`
	CreatedAt  time.Time `json:"created_at"`
}

// Autorisation résout la session d'une course pour un demandeur donné, en
// vérifiant qu'il en est bien l'une des deux extrémités.
//
// destinataireID et livreurID viennent du JWT : l'appelant ne peut pas se déclarer
// participant d'une conversation qui n'est pas la sienne.
func ResoudreSession(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID uuid.UUID,
	destinataireID, livreurID *uuid.UUID,
) (*Session, error) {
	var (
		sessionID            uuid.UUID
		expireAt             time.Time
		numeroVirtuel        *string
		courseDestinataireID uuid.UUID
		courseLivreurID      *uuid.UUID
	)

	err := pool.QueryRow(ctx, `
		SELECT s.id, s.expire_at, s.numero_virtuel, c.destinataire_id, c.livreur_id
		FROM sessions_masquage s
		JOIN courses c ON c.id = s.course_id
		WHERE s.course_id = $1
	`, courseID).Scan(&sessionID, &expireAt, &numeroVirtuel, &courseDestinataireID, &courseLivreurID)

	if err == pgx.ErrNoRows {
		return nil, ErrSessionIntrouvable
	}
	if err != nil {
		return nil, fmt.Errorf("lecture session: %w", err)
	}

	var role Role
	switch {
	case destinataireID != nil && *destinataireID == courseDestinataireID:
		role = RoleDestinataire
	case livreurID != nil && courseLivreurID != nil && *livreurID == *courseLivreurID:
		role = RoleLivreur
	default:
		return nil, ErrAccesRefuse
	}

	return &Session{
		ID:            sessionID,
		CourseID:      courseID,
		ExpireAt:      expireAt,
		Role:          role,
		NumeroVirtuel: numeroVirtuel,
		Active:        expireAt.After(time.Now()),
	}, nil
}

// ResoudreSessionParID fait le même contrôle à partir du session_id, seul
// identifiant que le front manipule.
func ResoudreSessionParID(
	ctx context.Context,
	pool *pgxpool.Pool,
	sessionID uuid.UUID,
	destinataireID, livreurID *uuid.UUID,
) (*Session, error) {
	var courseID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT course_id FROM sessions_masquage WHERE id = $1`, sessionID).
		Scan(&courseID)
	if err == pgx.ErrNoRows {
		return nil, ErrSessionIntrouvable
	}
	if err != nil {
		return nil, fmt.Errorf("lecture session: %w", err)
	}
	return ResoudreSession(ctx, pool, courseID, destinataireID, livreurID)
}

// EnregistrerMessage refuse d'écrire dans un canal expiré : une course terminée
// ne doit plus permettre de joindre l'autre partie.
func EnregistrerMessage(
	ctx context.Context,
	pool *pgxpool.Pool,
	session *Session,
	contenu string,
) (*Message, error) {
	if !session.Active {
		return nil, ErrSessionExpiree
	}

	var msg Message
	err := pool.QueryRow(ctx, `
		INSERT INTO messages_masques (session_id, expediteur, contenu)
		VALUES ($1, $2, $3)
		RETURNING id, expediteur, contenu, created_at
	`, session.ID, string(session.Role), contenu).
		Scan(&msg.ID, &msg.Expediteur, &msg.Contenu, &msg.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insertion message: %w", err)
	}
	return &msg, nil
}

// ListerMessages renvoie l'historique du canal, du plus ancien au plus récent.
func ListerMessages(ctx context.Context, pool *pgxpool.Pool, sessionID uuid.UUID) ([]Message, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, expediteur, contenu, created_at
		FROM messages_masques WHERE session_id = $1 ORDER BY created_at
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("lecture messages: %w", err)
	}
	defer rows.Close()

	messages := []Message{}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.Expediteur, &m.Contenu, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, m)
	}
	return messages, nil
}

// CanalRedis porte les évènements temps réel d'une session (messages et
// signaling WebRTC). Cloisonné par session : aucune fuite entre conversations.
func CanalRedis(sessionID uuid.UUID) string {
	return fmt.Sprintf("masquage:%s", sessionID.String())
}
