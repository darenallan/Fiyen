package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/tracking"
	"fiyen-backend/internal/util"
)

type creerLivreurBody struct {
	Nom        string `json:"nom"`
	Telephone  string `json:"telephone"`
	MotDePasse string `json:"mot_de_passe"`
}

// CreerLivreur (compagnie) — ajoute un livreur à la flotte et son compte de connexion.
func (d *Deps) CreerLivreur(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	var body creerLivreurBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if body.Nom == "" || body.Telephone == "" || len(body.MotDePasse) < 8 {
		return fiber.NewError(fiber.StatusBadRequest, "nom, telephone et mot_de_passe (8+ caractères) requis")
	}

	telephoneHash := util.HashTelephone(body.Telephone)
	mdpHash, err := util.HashMotDePasse(body.MotDePasse)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	ctx := c.Context()
	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer tx.Rollback(ctx)

	var livreurID uuid.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO livreurs (compagnie_id, nom, telephone_hash) VALUES ($1, $2, $3) RETURNING id`,
		claims.CompagnieID, body.Nom, telephoneHash,
	).Scan(&livreurID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création livreur échouée")
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, compagnie_id, livreur_id)
		 VALUES ('livreur', $1, $2, $3, $4)`,
		telephoneHash, mdpHash, claims.CompagnieID, livreurID,
	); err != nil {
		return fiber.NewError(fiber.StatusConflict, "un compte existe déjà pour ce numéro")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": livreurID})
}

// ListerLivreurs (compagnie) — vue flotte : statut + dernière position connue.
func (d *Deps) ListerLivreurs(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)

	rows, err := d.DB.Query(c.Context(), `
		SELECT l.id, l.nom, l.statut, l.created_at,
		       ST_Y(p.position::geometry) AS latitude,
		       ST_X(p.position::geometry) AS longitude,
		       p.updated_at
		FROM livreurs l
		LEFT JOIN positions_livreurs p ON p.livreur_id = l.id
		WHERE l.compagnie_id = $1
		ORDER BY l.created_at DESC
	`, claims.CompagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}
	defer rows.Close()

	type ligne struct {
		ID        uuid.UUID            `json:"id"`
		Nom       string               `json:"nom"`
		Statut    models.StatutLivreur `json:"statut"`
		CreatedAt interface{}          `json:"created_at"`
		Latitude  *float64             `json:"latitude"`
		Longitude *float64             `json:"longitude"`
		UpdatedAt interface{}          `json:"position_updated_at"`
		// EnLigne reflète la présence réelle (clé TTL Redis), à distinguer du
		// statut déclaré : un livreur "dispo" dont le téléphone a perdu le
		// réseau n'est plus joignable, et la flotte doit le montrer.
		EnLigne bool `json:"en_ligne"`
	}

	var resultats []ligne
	var ids []uuid.UUID
	for rows.Next() {
		var l ligne
		if err := rows.Scan(&l.ID, &l.Nom, &l.Statut, &l.CreatedAt, &l.Latitude, &l.Longitude, &l.UpdatedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture échouée")
		}
		resultats = append(resultats, l)
		ids = append(ids, l.ID)
	}

	presence, err := tracking.LivreursEnLigne(c.Context(), d.Redis, ids)
	if err == nil {
		for i := range resultats {
			resultats[i].EnLigne = presence[resultats[i].ID]
		}
	}
	// Redis indisponible : on renvoie la flotte avec en_ligne=false plutôt que
	// de faire échouer toute la vue.

	return c.JSON(resultats)
}

// ObtenirMonProfilLivreur (livreur) — son propre nom et statut, pour que l'app
// livreur retrouve son état après un rechargement ou une reconnexion.
func (d *Deps) ObtenirMonProfilLivreur(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.LivreurID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte non rattaché à un livreur")
	}

	var livreur models.Livreur
	err := d.DB.QueryRow(c.Context(),
		`SELECT id, compagnie_id, nom, statut, created_at FROM livreurs WHERE id = $1`,
		claims.LivreurID,
	).Scan(&livreur.ID, &livreur.CompagnieID, &livreur.Nom, &livreur.Statut, &livreur.CreatedAt)

	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "livreur introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}

	return c.JSON(livreur)
}

type majStatutLivreurBody struct {
	Statut models.StatutLivreur `json:"statut"`
}

// MettreAJourStatutLivreur (livreur) — change son propre statut (dispo/offline).
// en_course est géré automatiquement par l'assignation d'une course, pas ici.
func (d *Deps) MettreAJourStatutLivreur(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.LivreurID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte non rattaché à un livreur")
	}

	var body majStatutLivreurBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if body.Statut != models.LivreurOffline && body.Statut != models.LivreurDispo {
		return fiber.NewError(fiber.StatusBadRequest, "statut doit être offline ou dispo")
	}

	tag, err := d.DB.Exec(c.Context(),
		`UPDATE livreurs SET statut = $1 WHERE id = $2`,
		body.Statut, claims.LivreurID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusInternalServerError, "mise à jour échouée")
	}

	return c.JSON(fiber.Map{"statut": body.Statut})
}
