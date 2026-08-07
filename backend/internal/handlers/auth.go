package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/util"
)

type registerCompagnieBody struct {
	NomCompagnie string `json:"nom_compagnie"`
	NomAdmin     string `json:"nom_admin"`
	Telephone    string `json:"telephone"`
	MotDePasse   string `json:"mot_de_passe"`
}

// RegisterCompagnie crée une compagnie partenaire et son premier compte admin.
func (d *Deps) RegisterCompagnie(c *fiber.Ctx) error {
	var body registerCompagnieBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if body.NomCompagnie == "" || body.Telephone == "" || len(body.MotDePasse) < 8 {
		return fiber.NewError(fiber.StatusBadRequest, "nom_compagnie, telephone et mot_de_passe (8+ caractères) requis")
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

	var compagnieID uuid.UUID
	err = tx.QueryRow(ctx,
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		body.NomCompagnie,
	).Scan(&compagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création compagnie échouée")
	}

	var utilisateurID uuid.UUID
	err = tx.QueryRow(ctx,
		`INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, compagnie_id)
		 VALUES ('compagnie', $1, $2, $3) RETURNING id`,
		telephoneHash, mdpHash, compagnieID,
	).Scan(&utilisateurID)
	if err != nil {
		return fiber.NewError(fiber.StatusConflict, "un compte existe déjà pour ce numéro")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	token, err := middleware.GenererToken(d.Config.JWTSecret, d.Config.JWTDureeMinutes, middleware.Claims{
		UtilisateurID: utilisateurID,
		Role:          models.RoleCompagnie,
		CompagnieID:   &compagnieID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"token":        token,
		"compagnie_id": compagnieID,
	})
}

type loginBody struct {
	Telephone  string `json:"telephone"`
	MotDePasse string `json:"mot_de_passe"`
}

// Login authentifie un compte quel que soit son rôle (compagnie, livreur, client).
func (d *Deps) Login(c *fiber.Ctx) error {
	var body loginBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if body.Telephone == "" || body.MotDePasse == "" {
		return fiber.NewError(fiber.StatusBadRequest, "telephone et mot_de_passe requis")
	}

	telephoneHash := util.HashTelephone(body.Telephone)

	var (
		utilisateurID uuid.UUID
		role          models.Role
		mdpHash       string
		compagnieID   *uuid.UUID
		livreurID     *uuid.UUID
		clientID      *uuid.UUID
	)
	err := d.DB.QueryRow(c.Context(),
		`SELECT id, role, mot_de_passe_hash, compagnie_id, livreur_id, client_id
		 FROM utilisateurs WHERE telephone_hash = $1`,
		telephoneHash,
	).Scan(&utilisateurID, &role, &mdpHash, &compagnieID, &livreurID, &clientID)

	if err == pgx.ErrNoRows || !util.VerifierMotDePasse(mdpHash, body.MotDePasse) {
		return fiber.NewError(fiber.StatusUnauthorized, "identifiants invalides")
	}
	if err != nil && err != pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	token, err := middleware.GenererToken(d.Config.JWTSecret, d.Config.JWTDureeMinutes, middleware.Claims{
		UtilisateurID: utilisateurID,
		Role:          role,
		CompagnieID:   compagnieID,
		LivreurID:     livreurID,
		ClientID:      clientID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(fiber.Map{"token": token, "role": role})
}

type registerClientBody struct {
	Nom        string `json:"nom"`
	Telephone  string `json:"telephone"`
	MotDePasse string `json:"mot_de_passe"`
}

// RegisterClient crée un compte client final (auto-inscription depuis l'app client).
func (d *Deps) RegisterClient(c *fiber.Ctx) error {
	var body registerClientBody
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

	var clientID uuid.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO clients (nom, telephone_hash) VALUES ($1, $2) RETURNING id`,
		body.Nom, telephoneHash,
	).Scan(&clientID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création client échouée")
	}

	var utilisateurID uuid.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, client_id)
		 VALUES ('client', $1, $2, $3) RETURNING id`,
		telephoneHash, mdpHash, clientID,
	).Scan(&utilisateurID); err != nil {
		return fiber.NewError(fiber.StatusConflict, "un compte existe déjà pour ce numéro")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	token, err := middleware.GenererToken(d.Config.JWTSecret, d.Config.JWTDureeMinutes, middleware.Claims{
		UtilisateurID: utilisateurID,
		Role:          models.RoleClient,
		ClientID:      &clientID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"token": token, "client_id": clientID})
}
