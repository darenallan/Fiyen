package handlers

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
)

// Journal des évènements d'une course.
//
// Ce que `courses` ne dit pas : quand chaque étape a eu lieu, et par qui. Une
// course « livrée » ne porte que son état final ; l'heure de récupération, le
// livreur qui l'a prise, le motif d'une annulation ne se reconstituent pas
// après coup.

// Types d'évènements. `creee` n'est pas un statut de course : c'est le premier
// évènement du journal, celui qui n'a pas de transition avant lui.
const (
	EvtJournalCreee     = "creee"
	EvtJournalAssignee  = "assignee"
	EvtJournalRecuperee = "recuperee"
	EvtJournalEnRoute   = "en_route"
	EvtJournalLivree    = "livree"
	EvtJournalAnnulee   = "annulee"
)

// EvenementJournal est une ligne du journal telle qu'on la relit.
type EvenementJournal struct {
	Type       string            `json:"type"`
	AuteurNom  *string           `json:"auteur_nom,omitempty"`
	AuteurRole *string           `json:"auteur_role,omitempty"`
	Details    map[string]string `json:"details,omitempty"`
	Horodatage time.Time         `json:"horodatage"`
}

// journaliser inscrit un évènement, **sans faire échouer l'appelant**.
//
// Un journal qui empêcherait une livraison d'avancer serait un mauvais
// compromis : la course a bien changé d'état, et perdre une ligne de trace est
// moins grave que bloquer le livreur. L'échec part au journal applicatif, où
// il sera visible.
//
// Écrit dans la transaction quand on lui en passe une : l'évènement et le
// changement de statut doivent tomber ou passer ensemble, sinon le journal
// raconte une histoire qui n'a pas eu lieu.
func journaliser(
	ctx context.Context,
	tx pgx.Tx,
	courseID uuid.UUID,
	typeEvt string,
	claims *middleware.Claims,
	details map[string]string,
) {
	var (
		auteurID   *uuid.UUID
		auteurRole *string
	)
	if claims != nil {
		id := claims.UtilisateurID
		auteurID = &id
		// Le rôle est **recopié**, pas joint : un compte peut changer de rôle,
		// et le journal doit dire ce qui était vrai à l'instant de l'action.
		role := string(claims.Role)
		auteurRole = &role
	}

	var brut []byte
	if len(details) > 0 {
		var err error
		if brut, err = json.Marshal(details); err != nil {
			log.Printf("journal : détails illisibles pour la course %s : %v", courseID, err)
			brut = nil
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO evenements_course (course_id, type, auteur_id, auteur_role, details)
		VALUES ($1, $2, $3, $4, $5)
	`, courseID, typeEvt, auteurID, auteurRole, brut); err != nil {
		log.Printf("journal : écriture de %s pour la course %s échouée : %v", typeEvt, courseID, err)
	}
}

// LireJournal rend l'histoire d'une course, du plus ancien au plus récent.
//
// Le nom de l'auteur est joint pour l'affichage, mais son identifiant ne sort
// pas : un reçu montre « Salif Traoré », pas un UUID, et le destinataire n'a
// de toute façon pas à connaître celui de son livreur.
func (d *Deps) LireJournal(ctx context.Context, courseID uuid.UUID) ([]EvenementJournal, error) {
	rows, err := d.DB.Query(ctx, `
		SELECT e.type, u.nom, e.auteur_role, e.details, e.created_at
		FROM evenements_course e
		LEFT JOIN utilisateurs u ON u.id = e.auteur_id
		WHERE e.course_id = $1
		ORDER BY e.created_at, e.id
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	journal := []EvenementJournal{}
	for rows.Next() {
		var (
			e    EvenementJournal
			brut []byte
		)
		if err := rows.Scan(&e.Type, &e.AuteurNom, &e.AuteurRole, &brut, &e.Horodatage); err != nil {
			return nil, err
		}
		if len(brut) > 0 {
			// Des détails illisibles ne doivent pas faire échouer la lecture de
			// tout le journal : on rend l'évènement sans eux.
			_ = json.Unmarshal(brut, &e.Details)
		}
		journal = append(journal, e)
	}
	return journal, rows.Err()
}
