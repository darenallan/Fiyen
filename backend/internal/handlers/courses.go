package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
)

type creerCourseBody struct {
	ClientID       *uuid.UUID `json:"client_id,omitempty"` // requis si créé par une compagnie
	AdresseDepart  string     `json:"adresse_depart"`
	AdresseArrivee string     `json:"adresse_arrivee"`
}

// CreerCourse (compagnie ou client) — statut initial en_attente.
func (d *Deps) CreerCourse(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	var body creerCourseBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	if body.AdresseDepart == "" || body.AdresseArrivee == "" {
		return fiber.NewError(fiber.StatusBadRequest, "adresse_depart et adresse_arrivee requis")
	}

	var compagnieID, clientID uuid.UUID
	switch claims.Role {
	case models.RoleClient:
		return fiber.NewError(fiber.StatusBadRequest, "la création via compte client nécessite de préciser la compagnie — utilisez l'endpoint compagnie pour le MVP")
	case models.RoleCompagnie:
		compagnieID = *claims.CompagnieID
		if body.ClientID == nil {
			return fiber.NewError(fiber.StatusBadRequest, "client_id requis")
		}
		clientID = *body.ClientID
	default:
		return fiber.NewError(fiber.StatusForbidden, "rôle non autorisé à créer une course")
	}

	var courseID uuid.UUID
	err := d.DB.QueryRow(c.Context(), `
		INSERT INTO courses (compagnie_id, client_id, adresse_depart, adresse_arrivee)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, compagnieID, clientID, body.AdresseDepart, body.AdresseArrivee).Scan(&courseID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création course échouée")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": courseID, "statut": models.CourseEnAttente})
}

type assignerCourseBody struct {
	LivreurID uuid.UUID `json:"livreur_id"`
}

// AssignerCourse (compagnie) — assigne un livreur dispo de la même compagnie,
// ouvre la session de masquage numéro pour la durée de la course.
func (d *Deps) AssignerCourse(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	var body assignerCourseBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	ctx := c.Context()
	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer tx.Rollback(ctx)

	var statutActuel models.StatutCourse
	var courseCompagnieID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT statut, compagnie_id FROM courses WHERE id = $1 FOR UPDATE`, courseID).
		Scan(&statutActuel, &courseCompagnieID)
	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	if courseCompagnieID != *claims.CompagnieID {
		return fiber.NewError(fiber.StatusForbidden, "cette course n'appartient pas à votre compagnie")
	}
	if !models.TransitionValide(statutActuel, models.CourseAssignee) {
		return fiber.NewError(fiber.StatusConflict, "transition de statut invalide depuis "+string(statutActuel))
	}

	var livreurStatut models.StatutLivreur
	var livreurCompagnieID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT statut, compagnie_id FROM livreurs WHERE id = $1 FOR UPDATE`, body.LivreurID).
		Scan(&livreurStatut, &livreurCompagnieID)
	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "livreur introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	if livreurCompagnieID != *claims.CompagnieID {
		return fiber.NewError(fiber.StatusForbidden, "ce livreur n'appartient pas à votre compagnie")
	}
	if livreurStatut != models.LivreurDispo {
		return fiber.NewError(fiber.StatusConflict, "livreur non disponible")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE courses SET livreur_id = $1, statut = $2, updated_at = now() WHERE id = $3`,
		body.LivreurID, models.CourseAssignee, courseID,
	); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "assignation échouée")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE livreurs SET statut = $1 WHERE id = $2`,
		models.LivreurEnCourse, body.LivreurID,
	); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "mise à jour livreur échouée")
	}

	expireAt := time.Now().Add(time.Duration(d.Config.MasquageDureeHeures) * time.Hour)
	if _, err := tx.Exec(ctx,
		`INSERT INTO sessions_masquage (course_id, expire_at) VALUES ($1, $2)`,
		courseID, expireAt,
	); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création session masquage échouée")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(fiber.Map{"statut": models.CourseAssignee, "livreur_id": body.LivreurID})
}

type majStatutCourseBody struct {
	Statut models.StatutCourse `json:"statut"`
}

// MettreAJourStatutCourse (livreur assigné) — fait avancer la course dans le workflow.
func (d *Deps) MettreAJourStatutCourse(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}
	if claims.LivreurID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte non rattaché à un livreur")
	}

	var body majStatutCourseBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	ctx := c.Context()
	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer tx.Rollback(ctx)

	var statutActuel models.StatutCourse
	var livreurAssigne *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT statut, livreur_id FROM courses WHERE id = $1 FOR UPDATE`, courseID).
		Scan(&statutActuel, &livreurAssigne)
	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	if livreurAssigne == nil || *livreurAssigne != *claims.LivreurID {
		return fiber.NewError(fiber.StatusForbidden, "cette course ne vous est pas assignée")
	}
	if !models.TransitionValide(statutActuel, body.Statut) {
		return fiber.NewError(fiber.StatusConflict, "transition de statut invalide depuis "+string(statutActuel))
	}

	if _, err := tx.Exec(ctx,
		`UPDATE courses SET statut = $1, updated_at = now() WHERE id = $2`,
		body.Statut, courseID,
	); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "mise à jour échouée")
	}

	if body.Statut == models.CourseLivree || body.Statut == models.CourseAnnulee {
		if _, err := tx.Exec(ctx,
			`UPDATE livreurs SET statut = $1 WHERE id = $2`,
			models.LivreurDispo, claims.LivreurID,
		); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "mise à jour livreur échouée")
		}
		if _, err := tx.Exec(ctx,
			`UPDATE sessions_masquage SET expire_at = now() WHERE course_id = $1`,
			courseID,
		); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "clôture session masquage échouée")
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(fiber.Map{"statut": body.Statut})
}

// ObtenirCourse — accessible à la compagnie propriétaire, au client, ou au livreur assigné.
func (d *Deps) ObtenirCourse(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	var course models.Course
	err = d.DB.QueryRow(c.Context(), `
		SELECT id, compagnie_id, client_id, livreur_id, statut, adresse_depart, adresse_arrivee, created_at, updated_at
		FROM courses WHERE id = $1
	`, courseID).Scan(&course.ID, &course.CompagnieID, &course.ClientID, &course.LivreurID,
		&course.Statut, &course.AdresseDepart, &course.AdresseArrivee, &course.CreatedAt, &course.UpdatedAt)
	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	autorise := false
	switch claims.Role {
	case models.RoleCompagnie:
		autorise = claims.CompagnieID != nil && *claims.CompagnieID == course.CompagnieID
	case models.RoleClient:
		autorise = claims.ClientID != nil && *claims.ClientID == course.ClientID
	case models.RoleLivreur:
		autorise = claims.LivreurID != nil && course.LivreurID != nil && *claims.LivreurID == *course.LivreurID
	}
	if !autorise {
		return fiber.NewError(fiber.StatusForbidden, "accès refusé à cette course")
	}

	return c.JSON(course)
}

// ListerCourses (compagnie) — filtrable par statut via ?statut=.
func (d *Deps) ListerCourses(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	statutFiltre := c.Query("statut")

	var rows pgx.Rows
	var err error
	if statutFiltre != "" {
		rows, err = d.DB.Query(c.Context(), `
			SELECT id, compagnie_id, client_id, livreur_id, statut, adresse_depart, adresse_arrivee, created_at, updated_at
			FROM courses WHERE compagnie_id = $1 AND statut = $2 ORDER BY created_at DESC
		`, claims.CompagnieID, statutFiltre)
	} else {
		rows, err = d.DB.Query(c.Context(), `
			SELECT id, compagnie_id, client_id, livreur_id, statut, adresse_depart, adresse_arrivee, created_at, updated_at
			FROM courses WHERE compagnie_id = $1 ORDER BY created_at DESC
		`, claims.CompagnieID)
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}
	defer rows.Close()

	var resultats []models.Course
	for rows.Next() {
		var course models.Course
		if err := rows.Scan(&course.ID, &course.CompagnieID, &course.ClientID, &course.LivreurID,
			&course.Statut, &course.AdresseDepart, &course.AdresseArrivee, &course.CreatedAt, &course.UpdatedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture échouée")
		}
		resultats = append(resultats, course)
	}

	return c.JSON(resultats)
}

// ListerMesCourses (livreur ou client) — les courses qui le concernent : celles
// qui lui sont assignées pour un livreur, celles qu'il a commandées pour un
// client. Par défaut seules les courses actives (non terminées) sont renvoyées,
// pour limiter la donnée transférée sur des réseaux mobiles instables ;
// ?toutes=1 lève le filtre.
func (d *Deps) ListerMesCourses(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)

	var colonne string
	var identifiant *uuid.UUID
	switch {
	case claims.LivreurID != nil:
		colonne, identifiant = "livreur_id", claims.LivreurID
	case claims.ClientID != nil:
		colonne, identifiant = "client_id", claims.ClientID
	default:
		return fiber.NewError(fiber.StatusForbidden, "compte sans course rattachée")
	}

	// colonne ne vient pas de l'utilisateur : c'est l'une des deux constantes
	// ci-dessus, choisies d'après le rôle porté par le JWT.
	requete := `
		SELECT id, compagnie_id, client_id, livreur_id, statut, adresse_depart, adresse_arrivee, created_at, updated_at
		FROM courses WHERE ` + colonne + ` = $1
	`
	if c.Query("toutes") != "1" {
		requete += ` AND statut NOT IN ('livree', 'annulee')`
	}
	requete += ` ORDER BY created_at DESC`

	rows, err := d.DB.Query(c.Context(), requete, identifiant)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "requête échouée")
	}
	defer rows.Close()

	var resultats []models.Course
	for rows.Next() {
		var course models.Course
		if err := rows.Scan(&course.ID, &course.CompagnieID, &course.ClientID, &course.LivreurID,
			&course.Statut, &course.AdresseDepart, &course.AdresseArrivee, &course.CreatedAt, &course.UpdatedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture échouée")
		}
		resultats = append(resultats, course)
	}

	return c.JSON(resultats)
}
