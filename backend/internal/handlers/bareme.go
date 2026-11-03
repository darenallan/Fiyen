package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/tarifs"
)

// VersionBareme est une version publiée du barème d'une compagnie.
type VersionBareme struct {
	tarifs.Bareme
	ID         uuid.UUID `json:"id"`
	Motif      *string   `json:"motif,omitempty"`
	AuteurRole *string   `json:"auteur_role,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// lecteur couvre à la fois le pool et une transaction : le barème se lit
// hors transaction pour l'estimation, et dans celle de la commande pour que
// le prix figé corresponde exactement à la version lue.
type lecteur interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const colonnesBareme = `id, mode, devise, prix_forfait, paliers, prix_base, prix_par_km,
	prix_minimum, coefficient_detour::float8, arrondi, motif, auteur_role, created_at`

func scannerBareme(row pgx.Row) (VersionBareme, error) {
	var v VersionBareme
	var paliers []byte
	err := row.Scan(&v.ID, &v.Mode, &v.Devise, &v.PrixForfait, &paliers, &v.PrixBase,
		&v.PrixParKm, &v.PrixMinimum, &v.CoefficientDetour, &v.Arrondi, &v.Motif,
		&v.AuteurRole, &v.CreatedAt)
	if err != nil {
		return v, err
	}
	if len(paliers) > 0 {
		if err := json.Unmarshal(paliers, &v.Paliers); err != nil {
			return v, err
		}
	}
	return v, nil
}

// baremeEnVigueur rend la dernière version publiée, ou nil s'il n'y en a pas.
func baremeEnVigueur(ctx context.Context, db lecteur, compagnieID uuid.UUID) (*VersionBareme, error) {
	v, err := scannerBareme(db.QueryRow(ctx,
		`SELECT `+colonnesBareme+` FROM baremes_livraison
		 WHERE compagnie_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, compagnieID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ObtenirBareme (compagnie) — version en vigueur et historique des changements.
func (d *Deps) ObtenirBareme(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	ctx := c.Context()

	rows, err := d.DB.Query(ctx,
		`SELECT `+colonnesBareme+` FROM baremes_livraison
		 WHERE compagnie_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, *claims.CompagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture du barème échouée")
	}
	defer rows.Close()

	historique := []VersionBareme{}
	for rows.Next() {
		v, err := scannerBareme(rows)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "lecture du barème échouée")
		}
		historique = append(historique, v)
	}

	var actuel *VersionBareme
	if len(historique) > 0 {
		actuel = &historique[0]
	}
	return c.JSON(fiber.Map{"actuel": actuel, "historique": historique})
}

type publierBaremeBody struct {
	tarifs.Bareme
	Motif string `json:"motif"`
}

// normaliser ne garde que les champs du mode choisi : un barème « forfait »
// qui traînerait des paliers d'une saisie précédente prêterait à confusion
// dans l'historique.
func normaliser(b tarifs.Bareme) tarifs.Bareme {
	n := tarifs.Bareme{Mode: b.Mode, Devise: strings.TrimSpace(b.Devise),
		CoefficientDetour: b.CoefficientDetour, Arrondi: b.Arrondi}
	if n.Devise == "" {
		n.Devise = "XOF"
	}
	switch b.Mode {
	case tarifs.ModeForfait:
		n.PrixForfait = b.PrixForfait
	case tarifs.ModePaliers:
		n.Paliers = b.Paliers
	case tarifs.ModeDistance:
		n.PrixBase, n.PrixParKm, n.PrixMinimum = b.PrixBase, b.PrixParKm, b.PrixMinimum
	}
	return n
}

// PublierBareme (compagnie) — publie une nouvelle version.
//
// Il n'y a pas de modification en place : la table refuse les UPDATE. Chaque
// changement devient une ligne datée, avec son auteur et son motif, ce qui
// fait de l'historique un journal d'audit sans code supplémentaire.
func (d *Deps) PublierBareme(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)

	var body publierBaremeBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	b := normaliser(body.Bareme)
	if err := tarifs.Valider(b); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	var paliers []byte
	if len(b.Paliers) > 0 {
		paliers, _ = json.Marshal(b.Paliers)
	}
	role := string(claims.Role)

	v, err := scannerBareme(d.DB.QueryRow(c.Context(), `
		INSERT INTO baremes_livraison (
			compagnie_id, mode, devise, prix_forfait, paliers, prix_base,
			prix_par_km, prix_minimum, coefficient_detour, arrondi, motif,
			auteur_id, auteur_role
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING `+colonnesBareme,
		*claims.CompagnieID, b.Mode, b.Devise, b.PrixForfait, paliers, b.PrixBase,
		b.PrixParKm, b.PrixMinimum, b.CoefficientDetour, b.Arrondi,
		nilSiVide(tronquer(body.Motif, 200)), claims.UtilisateurID, role))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "publication du barème échouée")
	}
	return c.Status(fiber.StatusCreated).JSON(v)
}

type apercuBody struct {
	Bareme      tarifs.Bareme `json:"bareme"`
	DistancesKm []float64     `json:"distances_km"`
}

type ligneApercu struct {
	DistanceKm float64 `json:"distance_km"`
	Prix       *int    `json:"prix"`
	Raison     string  `json:"raison,omitempty"`
}

// ApercuBareme (compagnie) — ce que donnerait un barème, avant de le publier.
// Même fonction de calcul que pour les commandes : l'aperçu ne ment pas.
func (d *Deps) ApercuBareme(c *fiber.Ctx) error {
	var body apercuBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}
	b := normaliser(body.Bareme)
	if err := tarifs.Valider(b); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	if len(body.DistancesKm) == 0 || len(body.DistancesKm) > 20 {
		return fiber.NewError(fiber.StatusBadRequest, "entre 1 et 20 distances")
	}
	lignes := make([]ligneApercu, 0, len(body.DistancesKm))
	for _, km := range body.DistancesKm {
		if km < 0 || km > tarifs.DistanceMaxKm {
			return fiber.NewError(fiber.StatusBadRequest, "distance hors bornes")
		}
		m := int(km * 1000)
		l := ligneApercu{DistanceKm: km}
		if prix, err := tarifs.Calculer(b, &m); err != nil {
			l.Raison = err.Error()
		} else {
			l.Prix = &prix
		}
		lignes = append(lignes, l)
	}
	return c.JSON(fiber.Map{"lignes": lignes})
}

// Estimation est ce que le partenaire voit avant de commander.
type Estimation struct {
	Disponible bool     `json:"disponible"`
	Prix       *int     `json:"prix,omitempty"`
	Devise     string   `json:"devise,omitempty"`
	DistanceKm *float64 `json:"distance_km,omitempty"`
	Mode       string   `json:"mode,omitempty"`
	Raison     string   `json:"raison,omitempty"`
	baremeID   *uuid.UUID
	distanceM  *int
}

const raisonSansBareme = "votre compagnie n'a pas encore publié de barème : le prix est celui convenu avec elle"

func estimer(v *VersionBareme, latD, lonD, latA, lonA *float64) Estimation {
	if v == nil {
		return Estimation{Raison: raisonSansBareme}
	}
	e := Estimation{Devise: v.Devise, Mode: v.Mode, baremeID: &v.ID}
	e.distanceM = tarifs.DistanceEstimee(v.Bareme, latD, lonD, latA, lonA)
	if e.distanceM != nil {
		km := float64(*e.distanceM) / 1000
		e.DistanceKm = &km
	}
	prix, err := tarifs.Calculer(v.Bareme, e.distanceM)
	if err != nil {
		e.Raison = err.Error()
		return e
	}
	e.Disponible = true
	e.Prix = &prix
	return e
}

func lireCoordonnee(c *fiber.Ctx, cle string) (*float64, error) {
	brut := c.Query(cle)
	if brut == "" {
		return nil, nil
	}
	v, err := strconv.ParseFloat(brut, 64)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// EstimerCommande (partenaire, collaborateur) — prix annoncé avant l'envoi.
//
// La compagnie vient du jeton, jamais de la requête : un partenaire ne doit
// pas pouvoir lire le barème d'une autre compagnie.
func (d *Deps) EstimerCommande(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil || claims.PartenaireID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte partenaire requis")
	}
	var coords [4]*float64
	for i, cle := range []string{"lat_depart", "lon_depart", "lat_arrivee", "lon_arrivee"} {
		v, err := lireCoordonnee(c, cle)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "coordonnée illisible : "+cle)
		}
		coords[i] = v
	}
	if !coordonneesValides(coords[0], coords[1]) || !coordonneesValides(coords[2], coords[3]) {
		return fiber.NewError(fiber.StatusBadRequest, "coordonnées hors bornes")
	}

	v, err := baremeEnVigueur(c.Context(), d.DB, *claims.CompagnieID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture du barème échouée")
	}
	return c.JSON(estimer(v, coords[0], coords[1], coords[2], coords[3]))
}
