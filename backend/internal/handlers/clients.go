package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/util"
)

// RechercherClientParTelephone (compagnie) — résout un numéro de téléphone en
// client_id pour la création de course depuis le dashboard, sans jamais
// exposer le numéro en clair d'un autre client.
func (d *Deps) RechercherClientParTelephone(c *fiber.Ctx) error {
	telephone := c.Query("telephone")
	if telephone == "" {
		return fiber.NewError(fiber.StatusBadRequest, "paramètre telephone requis")
	}

	telephoneHash := util.HashTelephone(telephone)

	var id uuid.UUID
	var nom string
	err := d.DB.QueryRow(c.Context(),
		`SELECT id, nom FROM clients WHERE telephone_hash = $1`,
		telephoneHash,
	).Scan(&id, &nom)

	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "aucun client trouvé pour ce numéro")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}

	return c.JSON(fiber.Map{"id": id, "nom": nom})
}
