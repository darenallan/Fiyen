package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
)

// StatsDashboard (compagnie) — vue d'ensemble : courses par statut + flotte.
func (d *Deps) StatsDashboard(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	ctx := c.Context()

	rows, err := d.DB.Query(ctx,
		`SELECT statut, COUNT(*) FROM courses WHERE compagnie_id = $1 GROUP BY statut`,
		claims.CompagnieID,
	)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}
	coursesParStatut := map[string]int{}
	for rows.Next() {
		var statut string
		var n int
		if err := rows.Scan(&statut, &n); err != nil {
			rows.Close()
			return fiber.NewError(fiber.StatusInternalServerError, "lecture échouée")
		}
		coursesParStatut[statut] = n
	}
	rows.Close()

	rows, err = d.DB.Query(ctx,
		`SELECT statut, COUNT(*) FROM livreurs WHERE compagnie_id = $1 GROUP BY statut`,
		claims.CompagnieID,
	)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}
	livreursParStatut := map[string]int{}
	for rows.Next() {
		var statut string
		var n int
		if err := rows.Scan(&statut, &n); err != nil {
			rows.Close()
			return fiber.NewError(fiber.StatusInternalServerError, "lecture échouée")
		}
		livreursParStatut[statut] = n
	}
	rows.Close()

	return c.JSON(fiber.Map{
		"courses_par_statut":  coursesParStatut,
		"livreurs_par_statut": livreursParStatut,
	})
}

// ObtenirConfigTarifaire (compagnie) — barème en vigueur (aucune valeur codée en dur).
func (d *Deps) ObtenirConfigTarifaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)

	var cfg models.ConfigTarifaire
	err := d.DB.QueryRow(c.Context(), `
		SELECT id, compagnie_id, abonnement_mensuel, livreurs_inclus, commission_pourcentage, devise, active_a_partir, created_at
		FROM config_tarifaire
		WHERE compagnie_id = $1 AND active_a_partir <= now()
		ORDER BY active_a_partir DESC
		LIMIT 1
	`, claims.CompagnieID).Scan(&cfg.ID, &cfg.CompagnieID, &cfg.AbonnementMensuel, &cfg.LivreursInclus,
		&cfg.CommissionPourcentage, &cfg.Devise, &cfg.ActiveAPartir, &cfg.CreatedAt)

	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "aucun barème tarifaire configuré pour cette compagnie")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}

	return c.JSON(cfg)
}
