package handlers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/util"
)

// FormaterNumero rend le numéro affichable, celui qu'on dicte au téléphone.
// Le préfixe est constant : il n'identifie pas la compagnie, il signale
// seulement qu'il s'agit d'une course Fiyen.
func FormaterNumero(numero int) string {
	return fmt.Sprintf("FY-%d", numero)
}

// attribuerNumero réserve le prochain numéro de la compagnie.
//
// **Toute** course doit passer par ici, quelle que soit son origine : la
// colonne est NOT NULL, et un appelant qui l'oublierait ferait échouer
// l'insertion. C'est aussi ce qui garantit que l'opérateur peut dicter un
// numéro pour une course qu'il a saisie lui-même.
//
// L'UPDATE verrouille la ligne compagnie jusqu'au commit : les créations
// concurrentes d'une même compagnie se sérialisent, ce qui donne une suite
// sans trou. Au volume d'une société de livraison à Ouagadougou, l'attente est
// sans conséquence.
func attribuerNumero(ctx context.Context, tx pgx.Tx, compagnieID uuid.UUID) (int, error) {
	var numero int
	err := tx.QueryRow(ctx, `
		UPDATE compagnies SET compteur_courses = compteur_courses + 1
		WHERE id = $1 RETURNING compteur_courses
	`, compagnieID).Scan(&numero)
	return numero, err
}

// CoursePartenaire est la vue d'une course telle que la voit celui qui l'a
// commandée. Ni identifiant de livreur ni coordonnées de celui-ci : le suivi
// passe par le canal dédié, qui applique ses propres contrôles.
type CoursePartenaire struct {
	ID               uuid.UUID           `json:"id"`
	Numero           string              `json:"numero"`
	Statut           models.StatutCourse `json:"statut"`
	AdresseDepart    string              `json:"adresse_depart"`
	RepereDepart     *string             `json:"repere_depart,omitempty"`
	AdresseArrivee   string              `json:"adresse_arrivee"`
	RepereArrivee    *string             `json:"repere_arrivee,omitempty"`
	DescriptionColis *string             `json:"description_colis,omitempty"`
	Instructions     *string             `json:"instructions,omitempty"`
	DestinataireNom  string              `json:"destinataire_nom"`
	LatitudeDepart   *float64            `json:"latitude_depart,omitempty"`
	LongitudeDepart  *float64            `json:"longitude_depart,omitempty"`
	LatitudeArrivee  *float64            `json:"latitude_arrivee,omitempty"`
	LongitudeArrivee *float64            `json:"longitude_arrivee,omitempty"`
	CreeParNom       *string             `json:"cree_par_nom,omitempty"`
	CreatedAt        time.Time           `json:"created_at"`
	UpdatedAt        time.Time           `json:"updated_at"`
}

type creerCoursePartenaireBody struct {
	// Le destinataire est désigné par son numéro : c'est la clé du carnet, et
	// c'est aussi ce qui lui ouvrira le suivi de sa livraison.
	DestinataireNom       string `json:"destinataire_nom"`
	DestinataireTelephone string `json:"destinataire_telephone"`

	AdresseDepart  string   `json:"adresse_depart"`
	RepereDepart   string   `json:"repere_depart"`
	LatitudeDepart *float64 `json:"latitude_depart"`
	LongitudeDep   *float64 `json:"longitude_depart"`

	AdresseArrivee  string   `json:"adresse_arrivee"`
	RepereArrivee   string   `json:"repere_arrivee"`
	LatitudeArrivee *float64 `json:"latitude_arrivee"`
	LongitudeArr    *float64 `json:"longitude_arrivee"`

	DescriptionColis string `json:"description_colis"`
	Instructions     string `json:"instructions"`
}

// Bornes de saisie. Elles ne protègent pas d'un utilisateur maladroit mais d'un
// appelant qui enverrait un mégaoctet dans un champ d'adresse.
const (
	maxAdresse     = 300
	maxRepere      = 300
	maxDescription = 500
)

func tronquer(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max]
	}
	return s
}

// nilSiVide évite d'écrire des chaînes vides là où la colonne est nullable :
// « pas de repère » et « repère vide » doivent être la même chose.
func nilSiVide(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// coordonneesValides refuse un point hors du monde. Une saisie manuelle
// inversée (longitude en latitude) produit sinon un point en pleine mer, que
// la carte du livreur afficherait sans broncher.
func coordonneesValides(lat, lon *float64) bool {
	if lat == nil || lon == nil {
		return true // le point est facultatif
	}
	return *lat >= -90 && *lat <= 90 && *lon >= -180 && *lon <= 180
}

// CreerCoursePartenaire (partenaire ou collaborateur) — commande une livraison.
//
// La compagnie n'est pas choisie par l'appelant : elle vient du rattachement du
// partenaire, lu dans le jeton. Sans cela, un partenaire pourrait déposer une
// course chez une compagnie qui n'est pas la sienne.
func (d *Deps) CreerCoursePartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil || claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	var body creerCoursePartenaireBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	body.DestinataireNom = tronquer(body.DestinataireNom, 120)
	body.DestinataireTelephone = strings.TrimSpace(body.DestinataireTelephone)
	body.AdresseDepart = tronquer(body.AdresseDepart, maxAdresse)
	body.AdresseArrivee = tronquer(body.AdresseArrivee, maxAdresse)
	body.RepereDepart = tronquer(body.RepereDepart, maxRepere)
	body.RepereArrivee = tronquer(body.RepereArrivee, maxRepere)
	body.DescriptionColis = tronquer(body.DescriptionColis, maxDescription)
	body.Instructions = tronquer(body.Instructions, maxDescription)

	if body.DestinataireNom == "" || body.DestinataireTelephone == "" {
		return fiber.NewError(fiber.StatusBadRequest,
			"destinataire_nom et destinataire_telephone requis")
	}
	if body.AdresseDepart == "" || body.AdresseArrivee == "" {
		return fiber.NewError(fiber.StatusBadRequest,
			"adresse_depart et adresse_arrivee requis")
	}
	if !coordonneesValides(body.LatitudeDepart, body.LongitudeDep) ||
		!coordonneesValides(body.LatitudeArrivee, body.LongitudeArr) {
		return fiber.NewError(fiber.StatusBadRequest, "coordonnées hors bornes")
	}

	ctx := c.Context()
	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer tx.Rollback(ctx)

	// Destinataire : retrouvé par son numéro, créé s'il est nouveau. Le nom est
	// rafraîchi au passage — c'est celui de la dernière commande qui fait foi,
	// le partenaire ayant pu corriger une faute de frappe.
	telephoneHash := util.HashTelephone(body.DestinataireTelephone)
	var destinataireID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO destinataires (nom, telephone_hash) VALUES ($1, $2)
		ON CONFLICT (telephone_hash) DO UPDATE SET nom = EXCLUDED.nom
		RETURNING id
	`, body.DestinataireNom, telephoneHash).Scan(&destinataireID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "enregistrement du destinataire échoué")
	}

	numero, err := attribuerNumero(ctx, tx, *claims.CompagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "attribution du numéro échouée")
	}

	var course CoursePartenaire
	err = tx.QueryRow(ctx, `
		INSERT INTO courses (
			compagnie_id, destinataire_id, partenaire_id, cree_par, numero,
			adresse_depart, repere_depart, point_depart,
			adresse_arrivee, repere_arrivee, point_arrivee,
			description_colis, instructions
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, CASE WHEN $8::float8 IS NULL THEN NULL
			             ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END,
			$10, $11, CASE WHEN $12::float8 IS NULL THEN NULL
			              ELSE ST_SetSRID(ST_MakePoint($13, $12), 4326)::geography END,
			$14, $15
		)
		RETURNING id, numero, statut, adresse_depart, repere_depart,
		          adresse_arrivee, repere_arrivee, description_colis, instructions,
		          created_at, updated_at
	`,
		*claims.CompagnieID, destinataireID, *claims.PartenaireID, claims.UtilisateurID, numero,
		body.AdresseDepart, nilSiVide(body.RepereDepart), body.LatitudeDepart, body.LongitudeDep,
		body.AdresseArrivee, nilSiVide(body.RepereArrivee), body.LatitudeArrivee, body.LongitudeArr,
		nilSiVide(body.DescriptionColis), nilSiVide(body.Instructions),
	).Scan(&course.ID, &numero, &course.Statut, &course.AdresseDepart, &course.RepereDepart,
		&course.AdresseArrivee, &course.RepereArrivee, &course.DescriptionColis,
		&course.Instructions, &course.CreatedAt, &course.UpdatedAt)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "création de la course échouée")
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	course.Numero = FormaterNumero(numero)
	course.DestinataireNom = body.DestinataireNom
	course.LatitudeDepart = body.LatitudeDepart
	course.LongitudeDepart = body.LongitudeDep
	course.LatitudeArrivee = body.LatitudeArrivee
	course.LongitudeArrivee = body.LongitudeArr

	return c.Status(fiber.StatusCreated).JSON(course)
}

// requeteCoursesPartenaire est partagée par la liste et la fiche : une seule
// définition des colonnes évite que les deux vues divergent.
const requeteCoursesPartenaire = `
	SELECT co.id, co.numero, co.statut,
	       co.adresse_depart, co.repere_depart,
	       co.adresse_arrivee, co.repere_arrivee,
	       co.description_colis, co.instructions,
	       cl.nom,
	       ST_Y(co.point_depart::geometry), ST_X(co.point_depart::geometry),
	       ST_Y(co.point_arrivee::geometry), ST_X(co.point_arrivee::geometry),
	       u.nom,
	       co.created_at, co.updated_at
	FROM courses co
	JOIN destinataires cl ON cl.id = co.destinataire_id
	LEFT JOIN utilisateurs u ON u.id = co.cree_par
`

func scannerCoursePartenaire(rows pgx.Rows) (CoursePartenaire, error) {
	var c CoursePartenaire
	var numero int
	err := rows.Scan(&c.ID, &numero, &c.Statut,
		&c.AdresseDepart, &c.RepereDepart, &c.AdresseArrivee, &c.RepereArrivee,
		&c.DescriptionColis, &c.Instructions, &c.DestinataireNom,
		&c.LatitudeDepart, &c.LongitudeDepart, &c.LatitudeArrivee, &c.LongitudeArrivee,
		&c.CreeParNom, &c.CreatedAt, &c.UpdatedAt)
	c.Numero = FormaterNumero(numero)
	return c, err
}

// ListerCoursesPartenaire — les commandes de l'entreprise.
//
// Ce qu'un collaborateur voit dépend du réglage de son entreprise : soit tout,
// soit ses propres commandes. Le choix appartient au partenaire, le client
// n'ayant pas tranché — voir `partenaires.visibilite_collaborateurs`.
func (d *Deps) ListerCoursesPartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	ctx := c.Context()

	var visibilite string
	if err := d.DB.QueryRow(ctx,
		`SELECT visibilite_collaborateurs FROM partenaires WHERE id = $1`,
		*claims.PartenaireID).Scan(&visibilite); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	// Le compte principal voit toujours tout : c'est lui qui répond de
	// l'activité de son entreprise.
	restreint := visibilite == string(models.VisibilitePersonnelle) &&
		claims.Role == models.RoleCollaborateur

	requete := requeteCoursesPartenaire + `
		WHERE co.partenaire_id = $1
		  AND ($2::uuid IS NULL OR co.cree_par = $2)
		ORDER BY co.created_at DESC LIMIT 100`

	var auteur *uuid.UUID
	if restreint {
		id := claims.UtilisateurID
		auteur = &id
	}

	rows, err := d.DB.Query(ctx, requete, *claims.PartenaireID, auteur)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des courses échouée")
	}
	defer rows.Close()

	courses := []CoursePartenaire{}
	for rows.Next() {
		co, err := scannerCoursePartenaire(rows)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture des courses échouée")
		}
		courses = append(courses, co)
	}

	return c.JSON(courses)
}

// Destinataire — une entrée du carnet.
type Destinataire struct {
	Nom             string    `json:"nom"`
	AdresseArrivee  string    `json:"adresse_arrivee"`
	RepereArrivee   *string   `json:"repere_arrivee,omitempty"`
	Latitude        *float64  `json:"latitude,omitempty"`
	Longitude       *float64  `json:"longitude,omitempty"`
	DernierEnvoi    time.Time `json:"dernier_envoi"`
	NombreEnvois    int       `json:"nombre_envois"`
	DerniereCourse  uuid.UUID `json:"derniere_course_id"`
	DescriptionUsu  *string   `json:"description_habituelle,omitempty"`
	TelephoneMasque string    `json:"telephone_masque"`
}

// CarnetDestinataires — à qui ce partenaire a déjà livré, avec la dernière
// adresse utilisée pour chacun.
//
// Le carnet n'est pas une table : c'est une lecture de l'historique. Une table
// séparée se désynchroniserait — une adresse corrigée sur une course ne
// remonterait pas — et il faudrait l'entretenir.
//
// Le numéro du destinataire n'est **pas** renvoyé, même à celui qui l'a saisi :
// il n'existe en base que sous forme d'empreinte. Le carnet rend un masque
// d'affichage, et la commande se refait en repartant de la course.
func (d *Deps) CarnetDestinataires(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	rows, err := d.DB.Query(c.Context(), `
		SELECT DISTINCT ON (co.destinataire_id)
		       cl.nom, co.adresse_arrivee, co.repere_arrivee,
		       ST_Y(co.point_arrivee::geometry), ST_X(co.point_arrivee::geometry),
		       co.created_at, co.id, co.description_colis,
		       (SELECT count(*) FROM courses x
		         WHERE x.partenaire_id = co.partenaire_id AND x.destinataire_id = co.destinataire_id)
		FROM courses co
		JOIN destinataires cl ON cl.id = co.destinataire_id
		WHERE co.partenaire_id = $1
		ORDER BY co.destinataire_id, co.created_at DESC
	`, *claims.PartenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture du carnet échouée")
	}
	defer rows.Close()

	carnet := []Destinataire{}
	for rows.Next() {
		var dst Destinataire
		if err := rows.Scan(&dst.Nom, &dst.AdresseArrivee, &dst.RepereArrivee,
			&dst.Latitude, &dst.Longitude, &dst.DernierEnvoi, &dst.DerniereCourse,
			&dst.DescriptionUsu, &dst.NombreEnvois); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture du carnet échouée")
		}
		// Le numéro n'est pas relisible : on n'en affiche qu'un rappel neutre.
		dst.TelephoneMasque = "numéro enregistré"
		carnet = append(carnet, dst)
	}

	// Le plus récemment servi en tête : c'est presque toujours celui qu'on
	// s'apprête à resservir.
	return c.JSON(carnet)
}

// ObtenirCoursePartenaire — la fiche d'une de ses commandes.
func (d *Deps) ObtenirCoursePartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	rows, err := d.DB.Query(c.Context(),
		requeteCoursesPartenaire+` WHERE co.id = $1 AND co.partenaire_id = $2`,
		courseID, *claims.PartenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	defer rows.Close()

	if !rows.Next() {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	course, err := scannerCoursePartenaire(rows)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	return c.JSON(course)
}

// AnnulerCoursePartenaire — retire une commande tant qu'aucun livreur n'a été
// assigné. Passé ce point, un livreur est déjà en route : l'annulation relève
// de la compagnie, qui doit pouvoir le rappeler.
func (d *Deps) AnnulerCoursePartenaire(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}

	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	tag, err := d.DB.Exec(c.Context(), `
		UPDATE courses SET statut = 'annulee', updated_at = now()
		WHERE id = $1 AND partenaire_id = $2 AND statut = 'en_attente'
	`, courseID, *claims.PartenaireID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "annulation échouée")
	}
	if tag.RowsAffected() == 0 {
		// Course inconnue, appartenant à un autre, ou déjà prise en charge :
		// une seule réponse, pour ne pas révéler laquelle.
		return fiber.NewError(fiber.StatusConflict,
			"cette commande ne peut plus être annulée ici — contactez la compagnie")
	}

	d.publierEvenementCourse(courseID, models.CourseAnnulee)

	return c.SendStatus(fiber.StatusNoContent)
}

// CommandesEntrantes (compagnie) — la file des commandes déposées par les
// partenaires et pas encore assignées.
//
// C'est le pendant côté opérateur : sans cette file, une commande passée par un
// partenaire attendrait qu'on pense à rafraîchir la liste générale.
func (d *Deps) CommandesEntrantes(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte compagnie requis")
	}

	rows, err := d.DB.Query(c.Context(), `
		SELECT co.id, co.numero, co.statut,
		       co.adresse_depart, co.repere_depart,
		       co.adresse_arrivee, co.repere_arrivee,
		       co.description_colis, co.instructions,
		       cl.nom,
		       ST_Y(co.point_depart::geometry), ST_X(co.point_depart::geometry),
		       ST_Y(co.point_arrivee::geometry), ST_X(co.point_arrivee::geometry),
		       u.nom,
		       co.created_at, co.updated_at,
		       p.nom
		FROM courses co
		JOIN destinataires cl ON cl.id = co.destinataire_id
		JOIN partenaires p ON p.id = co.partenaire_id
		LEFT JOIN utilisateurs u ON u.id = co.cree_par
		WHERE co.compagnie_id = $1
		  AND co.partenaire_id IS NOT NULL
		  AND co.statut = 'en_attente'
		ORDER BY co.created_at
	`, *claims.CompagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture des commandes échouée")
	}
	defer rows.Close()

	type entrante struct {
		CoursePartenaire
		PartenaireNom string `json:"partenaire_nom"`
	}

	commandes := []entrante{}
	for rows.Next() {
		var e entrante
		var numero int
		if err := rows.Scan(&e.ID, &numero, &e.Statut,
			&e.AdresseDepart, &e.RepereDepart, &e.AdresseArrivee, &e.RepereArrivee,
			&e.DescriptionColis, &e.Instructions, &e.DestinataireNom,
			&e.LatitudeDepart, &e.LongitudeDepart, &e.LatitudeArrivee, &e.LongitudeArrivee,
			&e.CreeParNom, &e.CreatedAt, &e.UpdatedAt, &e.PartenaireNom); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture des commandes échouée")
		}
		e.Numero = FormaterNumero(numero)
		commandes = append(commandes, e)
	}

	return c.JSON(commandes)
}

// compteEntrantes sert au badge du dashboard, appelé souvent : une requête de
// comptage plutôt que le chargement de la liste entière.
func (d *Deps) compteEntrantes(ctx context.Context, compagnieID uuid.UUID) (int, error) {
	var n int
	err := d.DB.QueryRow(ctx, `
		SELECT count(*) FROM courses
		WHERE compagnie_id = $1 AND partenaire_id IS NOT NULL AND statut = 'en_attente'
	`, compagnieID).Scan(&n)
	return n, err
}
