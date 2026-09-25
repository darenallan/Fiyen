package handlers

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
)

// Rejeu du trajet d'une course sur la carte.
//
// `traces_positions` n'est pas rattachée à la course, mais au livreur (voir
// `internal/tracking`) : un livreur peut déposer des positions sans course en
// cours, et la table ne dit jamais à quelle course une position appartenait.
// Le trajet se reconstitue donc en croisant deux sources — un livreur qui n'a
// qu'une seule course active à la fois (`courses.livreur_id`), et les bornes
// temporelles du journal (`assignee` → `livree`/`annulee`) qui délimitent la
// fenêtre à extraire.
//
// Cette reconstitution ne fuit rien de neuf : la compagnie et le partenaire
// voient déjà l'un et l'autre bout du trajet ailleurs (position en direct
// pendant la course, adresses sur le reçu). Elle ne fait pas non plus
// apparaître le livreur — un point GPS n'est jamais nommé, contrairement au
// reçu où la frontière est explicite (`avecLivreur`).

// PointTrajet est une capture de position, dans l'ordre chronologique.
type PointTrajet struct {
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	Horodatage time.Time `json:"horodatage"`
}

// PointGeo est un point fixe sans horodatage : les épingles de départ et
// d'arrivée, quand elles ont été posées à la commande (elles sont
// facultatives — voir CLAUDE.md, « adresse en texte libre + repère »).
type PointGeo struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// Trajet rassemble ce qu'une carte a besoin d'afficher.
type Trajet struct {
	// Points est toujours un tableau, jamais nul : une course sans position
	// enregistrée n'est pas une erreur, seulement un trajet vide.
	Points       []PointTrajet `json:"points"`
	PointDepart  *PointGeo     `json:"point_depart,omitempty"`
	PointArrivee *PointGeo     `json:"point_arrivee,omitempty"`
}

// chargerTrajet lit tout ce qu'un rejeu porte, sans contrôle d'accès : les
// appelants ont déjà vérifié le rattachement, chacun selon sa règle — comme
// pour `chargerRecu`.
func (d *Deps) chargerTrajet(ctx context.Context, courseID uuid.UUID) (*Trajet, error) {
	var livreurID *uuid.UUID
	var depLat, depLon, arrLat, arrLon *float64
	err := d.DB.QueryRow(ctx, `
		SELECT livreur_id,
		       ST_Y(point_depart::geometry), ST_X(point_depart::geometry),
		       ST_Y(point_arrivee::geometry), ST_X(point_arrivee::geometry)
		FROM courses WHERE id = $1
	`, courseID).Scan(&livreurID, &depLat, &depLon, &arrLat, &arrLon)
	if err == pgx.ErrNoRows {
		return nil, fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture de la course échouée")
	}

	t := &Trajet{Points: []PointTrajet{}}
	if depLat != nil && depLon != nil {
		t.PointDepart = &PointGeo{Latitude: *depLat, Longitude: *depLon}
	}
	if arrLat != nil && arrLon != nil {
		t.PointArrivee = &PointGeo{Latitude: *arrLat, Longitude: *arrLon}
	}

	// Sans livreur, aucune trace n'a pu être déposée pour cette course : ce
	// n'est pas une erreur, seulement un trajet qui n'a pas encore commencé.
	if livreurID == nil {
		return t, nil
	}

	rows, err := d.DB.Query(ctx, `
		WITH bornes AS (
			SELECT
				MIN(created_at) FILTER (WHERE type = $2) AS debut,
				MAX(created_at) FILTER (WHERE type IN ($3, $4)) AS fin
			FROM evenements_course WHERE course_id = $1
		)
		SELECT ST_Y(tp.position::geometry), ST_X(tp.position::geometry), tp.horodatage
		FROM traces_positions tp, bornes b
		WHERE tp.livreur_id = $5
		  AND b.debut IS NOT NULL
		  AND tp.horodatage >= b.debut
		  AND tp.horodatage <= COALESCE(b.fin, now())
		ORDER BY tp.horodatage ASC
	`, courseID, EvtJournalAssignee, EvtJournalLivree, EvtJournalAnnulee, *livreurID)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture du trajet échouée")
	}
	defer rows.Close()

	for rows.Next() {
		var p PointTrajet
		if err := rows.Scan(&p.Latitude, &p.Longitude, &p.Horodatage); err != nil {
			return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture du trajet échouée")
		}
		t.Points = append(t.Points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture du trajet échouée")
	}

	return t, nil
}

// TrajetCourse (compagnie).
func (d *Deps) TrajetCourse(c *fiber.Ctx) error {
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

	trajet, err := d.chargerTrajet(c.Context(), courseID)
	if err != nil {
		return err
	}
	return c.JSON(trajet)
}

// TrajetCommande (partenaire ou collaborateur).
func (d *Deps) TrajetCommande(c *fiber.Ctx) error {
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

	trajet, err := d.chargerTrajet(c.Context(), courseID)
	if err != nil {
		return err
	}
	return c.JSON(trajet)
}
