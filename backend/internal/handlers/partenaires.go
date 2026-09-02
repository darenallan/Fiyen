package handlers

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/util"
)

// Durée de validité d'une invitation. Assez longue pour laisser le temps de
// transmettre le code de vive voix ou par SMS, assez courte pour qu'un code
// oublié dans une conversation ne serve plus.
const dureeInvitation = 7 * 24 * time.Hour

// Au-delà, l'invitation est brûlée. Un code à 6 chiffres se force en un million
// d'essais : sans ce compteur, seul le rate limiting HTTP protégerait, et il se
// contourne en changeant d'adresse.
const maxTentativesInvitation = 5

// refuserSiPartenaireSuspendu coupe l'accès des comptes d'un partenaire
// suspendu. La suspension porte sur l'entreprise ; sans ce contrôle, ses
// collaborateurs continueraient de commander alors que la relation est arrêtée.
func (d *Deps) refuserSiPartenaireSuspendu(ctx context.Context, partenaireID *uuid.UUID) error {
	if partenaireID == nil {
		return nil
	}

	var statut string
	err := d.DB.QueryRow(ctx, `SELECT statut FROM partenaires WHERE id = $1`, *partenaireID).Scan(&statut)
	if err != nil || statut != "actif" {
		// Même réponse qu'un identifiant faux : ne rien apprendre à qui insiste.
		return fiber.NewError(fiber.StatusUnauthorized, "identifiants invalides")
	}
	return nil
}

type creerPartenaireBody struct {
	Nom        string `json:"nom"`
	Repere     string `json:"repere"`
	Telephone  string `json:"telephone"`
	MotDePasse string `json:"mot_de_passe"`
	Visibilite string `json:"visibilite_collaborateurs"`
}

// CreerPartenaire (compagnie) — enregistre une entreprise cliente et son compte
// principal en une fois.
//
// Les deux vont ensemble : un partenaire sans compte ne pourrait pas commander,
// et c'est justement ce que la V2 apporte.
func (d *Deps) CreerPartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte compagnie requis")
	}

	var body creerPartenaireBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	body.Nom = strings.TrimSpace(body.Nom)
	body.Repere = strings.TrimSpace(body.Repere)
	body.Telephone = strings.TrimSpace(body.Telephone)

	if body.Nom == "" || body.Telephone == "" || len(body.MotDePasse) < 8 {
		return fiber.NewError(fiber.StatusBadRequest,
			"nom, telephone et mot_de_passe (8+ caractères) requis")
	}

	visibilite := models.VisibiliteEntreprise
	if body.Visibilite == string(models.VisibilitePersonnelle) {
		visibilite = models.VisibilitePersonnelle
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

	var p models.Partenaire
	err = tx.QueryRow(ctx, `
		INSERT INTO partenaires (compagnie_id, nom, repere, telephone_hash, visibilite_collaborateurs)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5)
		RETURNING id, compagnie_id, nom, repere, statut, visibilite_collaborateurs, created_at
	`, *claims.CompagnieID, body.Nom, body.Repere, telephoneHash, string(visibilite)).
		Scan(&p.ID, &p.CompagnieID, &p.Nom, &p.Repere, &p.Statut, &p.Visibilite, &p.CreatedAt)
	if err != nil {
		// L'index unique sur (compagnie_id, lower(nom)) est la seule contrainte
		// susceptible de sauter ici.
		return fiber.NewError(fiber.StatusConflict, "un partenaire porte déjà ce nom")
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO utilisateurs (role, nom, telephone_hash, mot_de_passe_hash, compagnie_id, partenaire_id)
		VALUES ('partenaire', $1, $2, $3, $4, $5)
	`, body.Nom, telephoneHash, mdpHash, *claims.CompagnieID, p.ID); err != nil {
		return fiber.NewError(fiber.StatusConflict, "un compte existe déjà pour ce numéro")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(p)
}

// ListerPartenaires (compagnie) — la liste de ses entreprises clientes, avec de
// quoi juger l'activité de chacune sans ouvrir sa fiche.
func (d *Deps) ListerPartenaires(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte compagnie requis")
	}

	rows, err := d.DB.Query(c.Context(), `
		SELECT p.id, p.compagnie_id, p.nom, p.repere, p.statut,
		       p.visibilite_collaborateurs, p.created_at,
		       (SELECT count(*) FROM utilisateurs u
		         WHERE u.partenaire_id = p.id AND u.role = 'collaborateur'),
		       (SELECT count(*) FROM courses co WHERE co.partenaire_id = p.id)
		FROM partenaires p
		WHERE p.compagnie_id = $1
		ORDER BY p.statut, lower(p.nom)
	`, *claims.CompagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des partenaires échouée")
	}
	defer rows.Close()

	// Tranche initialisée : le front itère dessus sans garde contre `null`.
	partenaires := []models.Partenaire{}
	for rows.Next() {
		var p models.Partenaire
		if err := rows.Scan(&p.ID, &p.CompagnieID, &p.Nom, &p.Repere, &p.Statut,
			&p.Visibilite, &p.CreatedAt, &p.NbCollaborateurs, &p.NbCourses); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture des partenaires échouée")
		}
		partenaires = append(partenaires, p)
	}

	return c.JSON(partenaires)
}

type majPartenaireBody struct {
	Nom        *string `json:"nom"`
	Repere     *string `json:"repere"`
	Statut     *string `json:"statut"`
	Visibilite *string `json:"visibilite_collaborateurs"`
}

// MajPartenaire (compagnie) — renomme, déplace, suspend ou réactive.
//
// La suspension remplace la suppression : les courses passées et les factures
// émises doivent survivre à la fin de la relation commerciale.
func (d *Deps) MajPartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte compagnie requis")
	}

	partenaireID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de partenaire invalide")
	}

	var body majPartenaireBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	if body.Statut != nil && *body.Statut != "actif" && *body.Statut != "suspendu" {
		return fiber.NewError(fiber.StatusBadRequest, "statut invalide")
	}
	if body.Visibilite != nil &&
		*body.Visibilite != string(models.VisibiliteEntreprise) &&
		*body.Visibilite != string(models.VisibilitePersonnelle) {
		return fiber.NewError(fiber.StatusBadRequest, "visibilité invalide")
	}
	if body.Nom != nil && strings.TrimSpace(*body.Nom) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "le nom ne peut pas être vide")
	}

	// COALESCE : seuls les champs fournis changent, le reste garde sa valeur.
	// Le filtre sur compagnie_id est ce qui empêche une compagnie de toucher au
	// partenaire d'une autre — le contrôle est dans la requête, pas avant.
	var p models.Partenaire
	err = d.DB.QueryRow(c.Context(), `
		UPDATE partenaires SET
			nom = COALESCE(NULLIF(trim($3), ''), nom),
			repere = COALESCE(NULLIF(trim($4), ''), repere),
			statut = COALESCE($5, statut),
			visibilite_collaborateurs = COALESCE($6, visibilite_collaborateurs)
		WHERE id = $1 AND compagnie_id = $2
		RETURNING id, compagnie_id, nom, repere, statut, visibilite_collaborateurs, created_at
	`, partenaireID, *claims.CompagnieID,
		valeurOuVide(body.Nom), valeurOuVide(body.Repere), body.Statut, body.Visibilite,
	).Scan(&p.ID, &p.CompagnieID, &p.Nom, &p.Repere, &p.Statut, &p.Visibilite, &p.CreatedAt)

	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "partenaire introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusConflict, "un partenaire porte déjà ce nom")
	}

	// Suspendre l'entreprise coupe les sessions en cours de ses comptes : sans
	// cela, un collaborateur déjà connecté continuerait de commander pendant
	// toute la durée de vie de son jeton de renouvellement.
	if body.Statut != nil && *body.Statut == "suspendu" {
		if _, err := d.DB.Exec(c.Context(), `
			UPDATE sessions_refresh SET revoque_at = now()
			WHERE revoque_at IS NULL
			  AND utilisateur_id IN (SELECT id FROM utilisateurs WHERE partenaire_id = $1)
		`, partenaireID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "révocation des sessions échouée")
		}
	}

	return c.JSON(p)
}

func valeurOuVide(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// MonPartenaire (partenaire ou collaborateur) — la fiche de sa propre
// entreprise, sans avoir à en connaître l'identifiant.
func (d *Deps) MonPartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	var p models.Partenaire
	err := d.DB.QueryRow(c.Context(), `
		SELECT p.id, p.compagnie_id, p.nom, p.repere, p.statut,
		       p.visibilite_collaborateurs, p.created_at,
		       (SELECT count(*) FROM utilisateurs u
		         WHERE u.partenaire_id = p.id AND u.role = 'collaborateur'),
		       (SELECT count(*) FROM courses co WHERE co.partenaire_id = p.id)
		FROM partenaires p WHERE p.id = $1
	`, *claims.PartenaireID).
		Scan(&p.ID, &p.CompagnieID, &p.Nom, &p.Repere, &p.Statut, &p.Visibilite,
			&p.CreatedAt, &p.NbCollaborateurs, &p.NbCourses)

	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "partenaire introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(p)
}

// --- Collaborateurs -------------------------------------------------------

// partenaireVise résout le partenaire sur lequel porte l'action, selon qui
// appelle : la compagnie précise l'identifiant dans l'URL, le partenaire agit
// sur le sien. Un collaborateur n'a rien à faire ici.
func (d *Deps) partenaireVise(c *fiber.Ctx) (uuid.UUID, error) {
	claims := middleware.ClaimsDe(c)

	switch claims.Role {
	case models.RolePartenaire:
		if claims.PartenaireID == nil {
			return uuid.Nil, fiber.NewError(fiber.StatusForbidden, "compte partenaire incomplet")
		}
		return *claims.PartenaireID, nil

	case models.RoleCompagnie:
		if claims.CompagnieID == nil {
			return uuid.Nil, fiber.NewError(fiber.StatusForbidden, "compte compagnie incomplet")
		}
		id, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return uuid.Nil, fiber.NewError(fiber.StatusBadRequest, "identifiant de partenaire invalide")
		}
		// Le rattachement est revérifié en base : l'identifiant vient de l'URL,
		// donc de l'appelant, et ne prouve rien par lui-même.
		var existe bool
		if err := d.DB.QueryRow(c.Context(),
			`SELECT true FROM partenaires WHERE id = $1 AND compagnie_id = $2`,
			id, *claims.CompagnieID).Scan(&existe); err != nil {
			return uuid.Nil, fiber.NewError(fiber.StatusNotFound, "partenaire introuvable")
		}
		return id, nil

	default:
		return uuid.Nil, fiber.NewError(fiber.StatusForbidden, "action réservée au partenaire")
	}
}

// ListerCollaborateurs — les comptes rattachés au partenaire, plus les
// invitations en attente.
func (d *Deps) ListerCollaborateurs(c *fiber.Ctx) error {
	partenaireID, err := d.partenaireVise(c)
	if err != nil {
		return err
	}

	rows, err := d.DB.Query(c.Context(), `
		SELECT u.id, COALESCE(u.nom, ''), u.role, u.actif, u.created_at,
		       (SELECT count(*) FROM courses co WHERE co.cree_par = u.id)
		FROM utilisateurs u
		WHERE u.partenaire_id = $1
		ORDER BY u.role, lower(COALESCE(u.nom, ''))
	`, partenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des collaborateurs échouée")
	}
	defer rows.Close()

	comptes := []models.Collaborateur{}
	for rows.Next() {
		var co models.Collaborateur
		if err := rows.Scan(&co.ID, &co.Nom, &co.Role, &co.Actif, &co.CreatedAt, &co.NbCourses); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture des collaborateurs échouée")
		}
		comptes = append(comptes, co)
	}

	invitations, err := d.listerInvitations(c.Context(), partenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des invitations échouée")
	}

	return c.JSON(fiber.Map{"collaborateurs": comptes, "invitations": invitations})
}

func (d *Deps) listerInvitations(ctx context.Context, partenaireID uuid.UUID) ([]models.Invitation, error) {
	rows, err := d.DB.Query(ctx, `
		SELECT id, nom, expire_at, created_at
		FROM invitations_collaborateurs
		WHERE partenaire_id = $1 AND consomme_at IS NULL AND expire_at > now()
		  AND tentatives < $2
		ORDER BY created_at DESC
	`, partenaireID, maxTentativesInvitation)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	invitations := []models.Invitation{}
	for rows.Next() {
		var inv models.Invitation
		if err := rows.Scan(&inv.ID, &inv.Nom, &inv.ExpireAt, &inv.CreatedAt); err != nil {
			return nil, err
		}
		invitations = append(invitations, inv)
	}
	return invitations, nil
}

type inviterBody struct {
	Nom       string `json:"nom"`
	Telephone string `json:"telephone"`
}

// genererCode tire un code à 6 chiffres. `crypto/rand` et non `math/rand` :
// un code prévisible laisserait entrer sans invitation.
func genererCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// InviterCollaborateur — crée une invitation et rend le code **une seule fois**.
//
// Le code n'est pas envoyé par la plateforme : il n'y a pas encore de passerelle
// SMS, et en inventer une donnerait l'illusion d'un envoi qui n'a pas lieu. Le
// partenaire le transmet lui-même, ce qu'il fait de toute façon de vive voix.
func (d *Deps) InviterCollaborateur(c *fiber.Ctx) error {
	partenaireID, err := d.partenaireVise(c)
	if err != nil {
		return err
	}

	var body inviterBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	body.Nom = strings.TrimSpace(body.Nom)
	body.Telephone = strings.TrimSpace(body.Telephone)
	if body.Nom == "" || body.Telephone == "" {
		return fiber.NewError(fiber.StatusBadRequest, "nom et telephone requis")
	}

	telephoneHash := util.HashTelephone(body.Telephone)
	ctx := c.Context()

	var dejaPris bool
	if err := d.DB.QueryRow(ctx,
		`SELECT true FROM utilisateurs WHERE telephone_hash = $1`, telephoneHash).
		Scan(&dejaPris); err == nil && dejaPris {
		return fiber.NewError(fiber.StatusConflict, "ce numéro a déjà un compte")
	}

	code, err := genererCode()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	codeHash, err := util.HashMotDePasse(code)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer tx.Rollback(ctx)

	// Une nouvelle invitation annule la précédente pour le même numéro :
	// laisser deux codes vivants doublerait la surface d'attaque et sèmerait la
	// confusion sur celui qui marche.
	if _, err := tx.Exec(ctx, `
		UPDATE invitations_collaborateurs SET consomme_at = now()
		WHERE partenaire_id = $1 AND telephone_hash = $2 AND consomme_at IS NULL
	`, partenaireID, telephoneHash); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	var inv models.Invitation
	if err := tx.QueryRow(ctx, `
		INSERT INTO invitations_collaborateurs (partenaire_id, telephone_hash, nom, code_hash, expire_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, nom, expire_at, created_at
	`, partenaireID, telephoneHash, body.Nom, codeHash, time.Now().Add(dureeInvitation)).
		Scan(&inv.ID, &inv.Nom, &inv.ExpireAt, &inv.CreatedAt); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création de l'invitation échouée")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	inv.Code = code
	return c.Status(fiber.StatusCreated).JSON(inv)
}

type activerCollaborateurBody struct {
	Telephone  string `json:"telephone"`
	Code       string `json:"code"`
	MotDePasse string `json:"mot_de_passe"`
}

// ActiverCollaborateur — **endpoint public** : l'invité n'a pas encore de
// compte, donc pas de jeton. Le code d'invitation tient lieu de preuve.
func (d *Deps) ActiverCollaborateur(c *fiber.Ctx) error {
	var body activerCollaborateurBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if body.Telephone == "" || body.Code == "" || len(body.MotDePasse) < 8 {
		return fiber.NewError(fiber.StatusBadRequest,
			"telephone, code et mot_de_passe (8+ caractères) requis")
	}

	telephoneHash := util.HashTelephone(body.Telephone)
	ctx := c.Context()

	var (
		invitationID uuid.UUID
		partenaireID uuid.UUID
		nom          string
		codeHash     string
		tentatives   int
	)
	err := d.DB.QueryRow(ctx, `
		SELECT id, partenaire_id, nom, code_hash, tentatives
		FROM invitations_collaborateurs
		WHERE telephone_hash = $1 AND consomme_at IS NULL AND expire_at > now()
		ORDER BY created_at DESC LIMIT 1
	`, telephoneHash).Scan(&invitationID, &partenaireID, &nom, &codeHash, &tentatives)

	// Invitation inexistante, expirée ou code faux donnent la même réponse :
	// distinguer les cas dirait à un inconnu quels numéros ont été invités.
	if err == pgx.ErrNoRows || tentatives >= maxTentativesInvitation {
		return fiber.NewError(fiber.StatusUnauthorized, "invitation invalide ou expirée")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	if !util.VerifierMotDePasse(codeHash, body.Code) {
		// Le compteur est incrémenté hors transaction : il doit survivre même si
		// la suite échoue, sinon les essais seraient gratuits.
		_, _ = d.DB.Exec(ctx,
			`UPDATE invitations_collaborateurs SET tentatives = tentatives + 1 WHERE id = $1`,
			invitationID)
		return fiber.NewError(fiber.StatusUnauthorized, "invitation invalide ou expirée")
	}

	var compagnieID uuid.UUID
	var statut string
	if err := d.DB.QueryRow(ctx,
		`SELECT compagnie_id, statut FROM partenaires WHERE id = $1`, partenaireID).
		Scan(&compagnieID, &statut); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	if statut != "actif" {
		return fiber.NewError(fiber.StatusUnauthorized, "invitation invalide ou expirée")
	}

	mdpHash, err := util.HashMotDePasse(body.MotDePasse)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer tx.Rollback(ctx)

	var utilisateurID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO utilisateurs (role, nom, telephone_hash, mot_de_passe_hash, compagnie_id, partenaire_id)
		VALUES ('collaborateur', $1, $2, $3, $4, $5) RETURNING id
	`, nom, telephoneHash, mdpHash, compagnieID, partenaireID).Scan(&utilisateurID); err != nil {
		return fiber.NewError(fiber.StatusConflict, "un compte existe déjà pour ce numéro")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE invitations_collaborateurs SET consomme_at = now() WHERE id = $1`,
		invitationID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	token, refresh, err := d.emettreJetons(ctx, middleware.Claims{
		UtilisateurID: utilisateurID,
		Role:          models.RoleCollaborateur,
		CompagnieID:   &compagnieID,
		PartenaireID:  &partenaireID,
	})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"token":         token,
		"refresh_token": refresh,
		"role":          models.RoleCollaborateur,
	})
}

type majCollaborateurBody struct {
	Actif *bool `json:"actif"`
}

// MajCollaborateur — suspend ou réactive un collaborateur.
//
// Pas de suppression : les courses qu'il a passées doivent rester attribuables,
// c'est la base de la facturation par collaborateur prévue en phase 6.
func (d *Deps) MajCollaborateur(c *fiber.Ctx) error {
	partenaireID, err := d.partenaireVise(c)
	if err != nil {
		return err
	}

	collaborateurID, err := uuid.Parse(c.Params("collaborateurId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de collaborateur invalide")
	}

	var body majCollaborateurBody
	if err := c.BodyParser(&body); err != nil || body.Actif == nil {
		return fiber.NewError(fiber.StatusBadRequest, "champ actif requis")
	}

	ctx := c.Context()

	// `role = 'collaborateur'` protège le compte principal : le partenaire ne
	// doit pas pouvoir se désactiver lui-même et perdre l'accès à son espace.
	var co models.Collaborateur
	err = d.DB.QueryRow(ctx, `
		UPDATE utilisateurs SET actif = $3
		WHERE id = $1 AND partenaire_id = $2 AND role = 'collaborateur'
		RETURNING id, COALESCE(nom, ''), role, actif, created_at
	`, collaborateurID, partenaireID, *body.Actif).
		Scan(&co.ID, &co.Nom, &co.Role, &co.Actif, &co.CreatedAt)

	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "collaborateur introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "mise à jour échouée")
	}

	// Suspendre coupe les sessions ouvertes : sans cela, le collaborateur
	// continuerait de commander jusqu'à l'expiration de son jeton.
	if !*body.Actif {
		if _, err := d.DB.Exec(ctx, `
			UPDATE sessions_refresh SET revoque_at = now()
			WHERE utilisateur_id = $1 AND revoque_at IS NULL
		`, collaborateurID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "révocation des sessions échouée")
		}
	}

	return c.JSON(co)
}

// AnnulerInvitation — retire une invitation encore en attente.
func (d *Deps) AnnulerInvitation(c *fiber.Ctx) error {
	partenaireID, err := d.partenaireVise(c)
	if err != nil {
		return err
	}

	invitationID, err := uuid.Parse(c.Params("invitationId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant d'invitation invalide")
	}

	tag, err := d.DB.Exec(c.Context(), `
		UPDATE invitations_collaborateurs SET consomme_at = now()
		WHERE id = $1 AND partenaire_id = $2 AND consomme_at IS NULL
	`, invitationID, partenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "annulation échouée")
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "invitation introuvable")
	}

	return c.SendStatus(fiber.StatusNoContent)
}
