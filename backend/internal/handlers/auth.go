package handlers

import (
	"context"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/auth"
	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/util"
)

// emettreJetons produit la paire jeton d'accès + jeton de renouvellement.
// Les trois points d'entrée (inscription compagnie, inscription destinataire,
// connexion) passent par ici pour que la durée de vie reste cohérente.
func (d *Deps) emettreJetons(ctx context.Context, claims middleware.Claims) (string, string, error) {
	acces, err := middleware.GenererToken(d.Config.JWTSecret, d.Config.JWTDureeMinutes, claims)
	if err != nil {
		return "", "", err
	}

	duree := time.Duration(d.Config.RefreshDureeJours) * 24 * time.Hour
	refresh, err := auth.Emettre(ctx, d.DB, claims.UtilisateurID, duree)
	if err != nil {
		return "", "", err
	}

	return acces, refresh, nil
}

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

	token, refresh, err := d.emettreJetons(ctx, middleware.Claims{
		UtilisateurID: utilisateurID,
		Role:          models.RoleCompagnie,
		CompagnieID:   &compagnieID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"token":         token,
		"refresh_token": refresh,
		"compagnie_id":  compagnieID,
	})
}

type loginBody struct {
	Telephone  string `json:"telephone"`
	MotDePasse string `json:"mot_de_passe"`
}

// Login authentifie un compte quel que soit son rôle.
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
		utilisateurID  uuid.UUID
		role           models.Role
		mdpHash        string
		compagnieID    *uuid.UUID
		livreurID      *uuid.UUID
		destinataireID *uuid.UUID
		partenaireID   *uuid.UUID
		actif          bool
	)
	err := d.DB.QueryRow(c.Context(),
		`SELECT id, role, mot_de_passe_hash, compagnie_id, livreur_id, destinataire_id,
		        partenaire_id, actif
		 FROM utilisateurs WHERE telephone_hash = $1`,
		telephoneHash,
	).Scan(&utilisateurID, &role, &mdpHash, &compagnieID, &livreurID, &destinataireID,
		&partenaireID, &actif)

	if err == pgx.ErrNoRows || !util.VerifierMotDePasse(mdpHash, body.MotDePasse) {
		return fiber.NewError(fiber.StatusUnauthorized, "identifiants invalides")
	}
	if err != nil && err != pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	if !actif {
		// Même message qu'un mot de passe faux : un compte suspendu ne doit pas
		// se distinguer d'un compte inexistant pour qui tente sa chance.
		return fiber.NewError(fiber.StatusUnauthorized, "identifiants invalides")
	}
	if err := d.refuserSiPartenaireSuspendu(c.Context(), partenaireID); err != nil {
		return err
	}

	token, refresh, err := d.emettreJetons(c.Context(), middleware.Claims{
		UtilisateurID:  utilisateurID,
		Role:           role,
		CompagnieID:    compagnieID,
		LivreurID:      livreurID,
		DestinataireID: destinataireID,
		PartenaireID:   partenaireID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(fiber.Map{"token": token, "refresh_token": refresh, "role": role})
}

type registerDestinataireBody struct {
	Nom        string `json:"nom"`
	Telephone  string `json:"telephone"`
	MotDePasse string `json:"mot_de_passe"`
}

// RegisterDestinataire crée le compte de celui qui reçoit le colis
// (auto-inscription depuis l'app destinataire).
func (d *Deps) RegisterDestinataire(c *fiber.Ctx) error {
	var body registerDestinataireBody
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

	var destinataireID uuid.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO destinataires (nom, telephone_hash) VALUES ($1, $2) RETURNING id`,
		body.Nom, telephoneHash,
	).Scan(&destinataireID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création du destinataire échouée")
	}

	var utilisateurID uuid.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, destinataire_id)
		 VALUES ('destinataire', $1, $2, $3) RETURNING id`,
		telephoneHash, mdpHash, destinataireID,
	).Scan(&utilisateurID); err != nil {
		return fiber.NewError(fiber.StatusConflict, "un compte existe déjà pour ce numéro")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	token, refresh, err := d.emettreJetons(ctx, middleware.Claims{
		UtilisateurID:  utilisateurID,
		Role:           models.RoleDestinataire,
		DestinataireID: &destinataireID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"token":           token,
		"refresh_token":   refresh,
		"destinataire_id": destinataireID,
	})
}

type refreshBody struct {
	RefreshToken string `json:"refresh_token"`
}

// Refresh échange un jeton de renouvellement contre une nouvelle paire.
//
// L'endpoint est **public** : il est justement fait pour être appelé quand le
// jeton d'accès est mort. C'est le jeton de renouvellement qui authentifie.
// Les claims sont relus en base plutôt que repris du JWT expiré — un rôle
// révoqué ou un livreur désactivé ne doit pas survivre au renouvellement.
func (d *Deps) Refresh(c *fiber.Ctx) error {
	var body refreshBody
	if err := c.BodyParser(&body); err != nil || body.RefreshToken == "" {
		return fiber.NewError(fiber.StatusBadRequest, "refresh_token requis")
	}

	ctx := c.Context()
	duree := time.Duration(d.Config.RefreshDureeJours) * 24 * time.Hour

	utilisateurID, nouveauRefresh, err := auth.Renouveler(ctx, d.DB, body.RefreshToken, duree)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrJetonRejoue):
			// Toutes les sessions viennent d'être coupées ; on ne le dit pas au
			// porteur, qui peut être le voleur.
			return fiber.NewError(fiber.StatusUnauthorized, "session invalide")
		case errors.Is(err, auth.ErrJetonInvalide), errors.Is(err, auth.ErrJetonExpire):
			return fiber.NewError(fiber.StatusUnauthorized, "session invalide")
		default:
			return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
		}
	}

	var (
		role           models.Role
		compagnieID    *uuid.UUID
		livreurID      *uuid.UUID
		destinataireID *uuid.UUID
		partenaireID   *uuid.UUID
		actif          bool
	)
	if err := d.DB.QueryRow(ctx,
		`SELECT role, compagnie_id, livreur_id, destinataire_id, partenaire_id, actif
		 FROM utilisateurs WHERE id = $1`,
		utilisateurID,
	).Scan(&role, &compagnieID, &livreurID, &destinataireID, &partenaireID, &actif); err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "session invalide")
	}

	// Un compte suspendu depuis l'émission du jeton ne doit pas survivre au
	// renouvellement : c'est tout l'intérêt de relire les droits en base.
	if !actif {
		_ = auth.RevoquerTout(ctx, d.DB, utilisateurID)
		return fiber.NewError(fiber.StatusUnauthorized, "session invalide")
	}
	if err := d.refuserSiPartenaireSuspendu(ctx, partenaireID); err != nil {
		_ = auth.RevoquerTout(ctx, d.DB, utilisateurID)
		return fiber.NewError(fiber.StatusUnauthorized, "session invalide")
	}

	token, err := middleware.GenererToken(d.Config.JWTSecret, d.Config.JWTDureeMinutes, middleware.Claims{
		UtilisateurID:  utilisateurID,
		Role:           role,
		CompagnieID:    compagnieID,
		LivreurID:      livreurID,
		DestinataireID: destinataireID,
		PartenaireID:   partenaireID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(fiber.Map{"token": token, "refresh_token": nouveauRefresh, "role": role})
}

// Deconnexion révoque le jeton de renouvellement présenté. Le jeton d'accès
// encore valide vivra jusqu'à son expiration — c'est le prix d'un JWT sans
// consultation de la base, et la raison pour laquelle il est court.
func (d *Deps) Deconnexion(c *fiber.Ctx) error {
	var body refreshBody
	if err := c.BodyParser(&body); err != nil || body.RefreshToken == "" {
		return fiber.NewError(fiber.StatusBadRequest, "refresh_token requis")
	}

	// Pas de distinction entre « révoqué » et « inconnu » : répondre 204 dans
	// les deux cas évite de transformer l'endpoint en oracle de validité.
	if err := auth.Revoquer(c.Context(), d.DB, body.RefreshToken); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.SendStatus(fiber.StatusNoContent)
}
