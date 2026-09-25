package handlers

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
)

// Reçu de course.
//
// Le reçu **n'a pas de numéro à lui** : c'est celui de la course, `FY-1042`.
// Une seconde numérotation obligerait à demander « lequel des deux ? » à chaque
// appel téléphonique, et il n'existe qu'un reçu par course.
//
// Aucun montant n'y figure : `config_tarifaire` porte un abonnement et une
// commission, pas un tarif par course. Il n'y a rien à calculer, et inventer un
// chiffre sur un document qui sert de justificatif serait pire qu'ailleurs.

// Recu rassemble ce qu'un document imprimé doit porter.
type Recu struct {
	Numero string              `json:"numero"`
	Statut models.StatutCourse `json:"statut"`

	CompagnieNom  string  `json:"compagnie_nom"`
	PartenaireNom *string `json:"partenaire_nom,omitempty"`

	DestinataireNom string  `json:"destinataire_nom"`
	AdresseDepart   string  `json:"adresse_depart"`
	RepereDepart    *string `json:"repere_depart,omitempty"`
	AdresseArrivee  string  `json:"adresse_arrivee"`
	RepereArrivee   *string `json:"repere_arrivee,omitempty"`

	DescriptionColis *string `json:"description_colis,omitempty"`
	Instructions     *string `json:"instructions,omitempty"`
	CreeParNom       *string `json:"cree_par_nom,omitempty"`

	// LivreurNom n'est renseigné que pour la compagnie. Le partenaire et le
	// destinataire ne connaissent jamais l'identité de leur livreur — c'est la
	// garantie centrale du produit, et un reçu imprimé la ferait tomber pour de
	// bon, sur papier.
	LivreurNom *string `json:"livreur_nom,omitempty"`

	// Journal donne les horaires réels de chaque étape. C'est ce qui distingue
	// un reçu d'une simple fiche : sans lui, le document dirait « livrée » sans
	// dire quand.
	Journal []EvenementJournal `json:"journal"`

	// Preuve est absente tant que le livreur n'a rien déposé — et elle peut le
	// rester : la remise n'est pas conditionnée à une signature. L'image ne
	// voyage pas ici (voir `LireMediaPreuve`), seulement de quoi savoir qu'elle
	// existe et l'aller chercher.
	Preuve *Preuve `json:"preuve,omitempty"`

	CreeLe time.Time `json:"cree_le"`
	// EmisLe est l'instant de génération du document, distinct de la course.
	// Deux impressions du même reçu portent des instants différents, et c'est
	// voulu : cela dit quand la copie a été tirée.
	EmisLe time.Time `json:"emis_le"`
}

// chargerRecu lit tout ce qu'un reçu porte, sans contrôle d'accès : les deux
// appelants ont déjà fait le leur, chacun selon sa règle.
func (d *Deps) chargerRecu(c *fiber.Ctx, courseID uuid.UUID, avecLivreur bool) (*Recu, error) {
	ctx := c.Context()

	var (
		r Recu
		// Local à l'appel : une variable de paquet serait partagée entre
		// requêtes simultanées, et un reçu porterait le numéro d'un autre.
		numero int
	)
	err := d.DB.QueryRow(ctx, `
		SELECT co.numero, co.statut,
		       comp.nom, p.nom,
		       d.nom,
		       co.adresse_depart, co.repere_depart,
		       co.adresse_arrivee, co.repere_arrivee,
		       co.description_colis, co.instructions,
		       u.nom, l.nom,
		       co.created_at
		FROM courses co
		JOIN compagnies comp ON comp.id = co.compagnie_id
		JOIN destinataires d ON d.id = co.destinataire_id
		LEFT JOIN partenaires p ON p.id = co.partenaire_id
		LEFT JOIN utilisateurs u ON u.id = co.cree_par
		LEFT JOIN livreurs l ON l.id = co.livreur_id
		WHERE co.id = $1
	`, courseID).Scan(
		&numero, &r.Statut,
		&r.CompagnieNom, &r.PartenaireNom,
		&r.DestinataireNom,
		&r.AdresseDepart, &r.RepereDepart,
		&r.AdresseArrivee, &r.RepereArrivee,
		&r.DescriptionColis, &r.Instructions,
		&r.CreeParNom, &r.LivreurNom,
		&r.CreeLe,
	)
	if err == pgx.ErrNoRows {
		return nil, fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture du reçu échouée")
	}

	r.Numero = FormaterNumero(numero)

	// Le livreur est retiré ici plutôt qu'omis de la requête : une seule
	// requête pour les deux audiences, et un seul endroit où la frontière se
	// franchit — celui qu'on relit quand on doute.
	if !avecLivreur {
		r.LivreurNom = nil
	}

	journal, err := d.LireJournal(ctx, courseID)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture du journal échouée")
	}
	r.Journal = journal

	// La preuve passe par le même interrupteur que le livreur : c'est la seule
	// autre donnée du reçu qui distingue les deux audiences.
	preuve, err := d.lirePreuveDeCourse(ctx, courseID, avecLivreur)
	if err != nil {
		return nil, err
	}
	r.Preuve = preuve

	r.EmisLe = time.Now().UTC()

	return &r, nil
}

// lirePreuveDeCourse rend la fiche de preuve, ou nil s'il n'y en a pas — ce qui
// n'est pas une anomalie : la remise n'est pas conditionnée à une signature.
func (d *Deps) lirePreuveDeCourse(ctx context.Context, courseID uuid.UUID, avecLivreur bool) (*Preuve, error) {
	var p Preuve
	err := d.DB.QueryRow(ctx, `
		SELECT pr.nom_receptionnaire, pr.type_media, pr.media_mime, pr.media_octets,
		       l.nom, pr.capture_le, pr.created_at
		FROM preuves_livraison pr
		JOIN livreurs l ON l.id = pr.livreur_id
		WHERE pr.course_id = $1
	`, courseID).Scan(
		&p.NomReceptionnaire, &p.TypeMedia, &p.MediaMime, &p.MediaOctets,
		&p.LivreurNom, &p.CaptureLe, &p.RecueLe,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "lecture de la preuve échouée")
	}
	if !avecLivreur {
		p.LivreurNom = nil
	}
	return &p, nil
}

// RecuCourse (compagnie) — le reçu complet, livreur compris.
func (d *Deps) RecuCourse(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.CompagnieID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte compagnie requis")
	}

	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	// Le rattachement est vérifié avant de charger : sans cela, une compagnie
	// lirait le reçu d'une course d'une autre en devinant son identifiant.
	var appartient bool
	if err := d.DB.QueryRow(c.Context(),
		`SELECT true FROM courses WHERE id = $1 AND compagnie_id = $2`,
		courseID, *claims.CompagnieID).Scan(&appartient); err != nil {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}

	recu, err := d.chargerRecu(c, courseID, true)
	if err != nil {
		return err
	}
	return c.JSON(recu)
}

// RecuCommande (partenaire ou collaborateur) — le même reçu, **sans le
// livreur**.
func (d *Deps) RecuCommande(c *fiber.Ctx) error {
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

	recu, err := d.chargerRecu(c, courseID, false)
	if err != nil {
		return err
	}
	return c.JSON(recu)
}
