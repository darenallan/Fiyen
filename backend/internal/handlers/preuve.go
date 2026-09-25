package handlers

import (
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
)

// Preuve de livraison.
//
// Elle se dépose **après** le passage à « livrée », pas pendant. Une course qui
// n'est close qu'une fois l'image montée bloquerait le livreur derrière un
// réseau qui vacille — le contraire de ce que le produit vise. Le journal a
// déjà horodaté la livraison ; la preuve vient s'y attacher.
//
// L'image circule en base64 dans du JSON plutôt qu'en multipart : le même
// chemin que tout le reste de l'API, et l'app livreur peut mettre une preuve en
// file dans son cache local sans manipuler de Blob. Le tiers de volume que
// coûte l'encodage est le prix de cette simplicité, sur une image déjà
// redimensionnée par l'appareil.

const (
	// 512 Ko : une signature tracée fait quelques kilo-octets, une photo
	// redimensionnée par l'app en fait cent. Au-delà, c'est que le
	// redimensionnement n'a pas eu lieu — mieux vaut le dire que de faire
	// transiter deux mégaoctets sur un réseau qui peine.
	tailleMaxPreuve = 512 * 1024

	// Tolérance d'horloge. Un téléphone en avance ferait dater la signature de
	// demain sur un document imprimé.
	deriveHorlogeToleree = 5 * time.Minute
)

// mimesPreuve borne ce qu'on accepte de stocker et de ressortir. Sans
// allowlist, un `Content-Type` choisi par l'appelant reviendrait tel quel au
// navigateur d'un autre utilisateur — de quoi faire exécuter du HTML sous
// l'origine de l'application.
var mimesPreuve = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/webp": {},
}

type deposerPreuveBody struct {
	NomReceptionnaire string `json:"nom_receptionnaire"`
	TypeMedia         string `json:"type_media"`
	MediaMime         string `json:"media_mime"`
	// MediaBase64 porte l'image encodée. Vide si le livreur n'a saisi qu'un nom.
	MediaBase64 string     `json:"media_base64"`
	CaptureLe   *time.Time `json:"capture_le"`
}

// Preuve est ce qu'un lecteur obtient. L'image n'y figure pas : la joindre
// gonflerait chaque chargement de reçu d'une centaine de kilo-octets, relus à
// chaque ouverture. Elle se récupère à part, et le navigateur la met en cache.
type Preuve struct {
	NomReceptionnaire *string `json:"nom_receptionnaire,omitempty"`
	TypeMedia         *string `json:"type_media,omitempty"`
	MediaMime         *string `json:"media_mime,omitempty"`
	MediaOctets       *int    `json:"media_octets,omitempty"`

	// LivreurNom n'est renseigné que pour la compagnie, comme sur le reçu : le
	// partenaire et le destinataire ne connaissent jamais leur livreur.
	LivreurNom *string `json:"livreur_nom,omitempty"`

	CaptureLe time.Time `json:"capture_le"`
	RecueLe   time.Time `json:"recue_le"`
}

// DeposerPreuve (livreur) — une seule fois, sur sa propre course.
func (d *Deps) DeposerPreuve(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	if claims.LivreurID == nil {
		return fiber.NewError(fiber.StatusForbidden, "compte non rattaché à un livreur")
	}

	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	var body deposerPreuveBody
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "corps de requête invalide")
	}

	nom, media, mime, typeMedia, err := validerPreuve(body)
	if err != nil {
		return err
	}

	ctx := c.Context()

	// Le rattachement est relu en base plutôt que pris du jeton : un jeton vit
	// trente minutes, et une course peut avoir été réassignée entre-temps.
	var statut models.StatutCourse
	var livreurAssigne *uuid.UUID
	err = d.DB.QueryRow(ctx,
		`SELECT statut, livreur_id FROM courses WHERE id = $1`, courseID).
		Scan(&statut, &livreurAssigne)
	if err == pgx.ErrNoRows {
		return fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}
	if livreurAssigne == nil || *livreurAssigne != *claims.LivreurID {
		return fiber.NewError(fiber.StatusForbidden, "cette course ne vous est pas assignée")
	}
	// « en route » est accepté en plus de « livrée » : le livreur remplit
	// l'écran de remise sur le pas de la porte, et l'ordre des deux appels
	// dépend de quel réseau passe en premier.
	if statut != models.CourseLivree && statut != models.CourseEnRoute {
		return fiber.NewError(fiber.StatusConflict,
			"une preuve ne se dépose qu'à la remise, pas depuis "+string(statut))
	}

	capture := time.Now().UTC()
	if body.CaptureLe != nil {
		// Une capture antérieure est prise telle quelle : c'est le cas normal
		// d'un envoi différé après une coupure. Une capture *future* vient d'une
		// horloge déréglée et daterait la signature de demain sur le document.
		if body.CaptureLe.Before(capture.Add(deriveHorlogeToleree)) {
			capture = body.CaptureLe.UTC()
		}
	}

	var octets *int
	if media != nil {
		n := len(media)
		octets = &n
	}

	_, err = d.DB.Exec(ctx, `
		INSERT INTO preuves_livraison
			(course_id, livreur_id, nom_receptionnaire, type_media, media, media_mime, media_octets, capture_le)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, courseID, *claims.LivreurID, nom, typeMedia, media, mime, octets, capture)
	if err != nil {
		// 23505 : une preuve existe déjà. Le dire clairement vaut mieux qu'un
		// 500, et la refuser vaut mieux que l'écraser — c'est une pièce.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fiber.NewError(fiber.StatusConflict, "une preuve a déjà été déposée pour cette course")
		}
		return fiber.NewError(fiber.StatusInternalServerError, "enregistrement de la preuve échoué")
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// validerPreuve rend le nom, l'image, son type MIME et sa nature, ou l'erreur à
// renvoyer. Séparé du handler pour que les règles se lisent d'un bloc.
func validerPreuve(body deposerPreuveBody) (nom *string, media []byte, mime *string, typeMedia *string, err error) {
	if n := bornerNom(body.NomReceptionnaire, 120); n != "" {
		nom = &n
	}

	if body.MediaBase64 == "" {
		if nom == nil {
			return nil, nil, nil, nil, fiber.NewError(fiber.StatusBadRequest,
				"une preuve vide n'en est pas une : nom du réceptionnaire ou image requis")
		}
		return nom, nil, nil, nil, nil
	}

	if body.TypeMedia != "signature" && body.TypeMedia != "photo" {
		return nil, nil, nil, nil, fiber.NewError(fiber.StatusBadRequest,
			"type_media doit valoir « signature » ou « photo »")
	}
	if _, ok := mimesPreuve[body.MediaMime]; !ok {
		return nil, nil, nil, nil, fiber.NewError(fiber.StatusBadRequest,
			"media_mime doit valoir image/png, image/jpeg ou image/webp")
	}

	// Le décodage borne avant d'allouer : `base64.StdEncoding.DecodedLen` donne
	// la taille finale sans construire le tampon, ce qui évite qu'un envoi de
	// dix mégaoctets soit décodé entièrement pour être rejeté ensuite.
	if base64.StdEncoding.DecodedLen(len(body.MediaBase64)) > tailleMaxPreuve {
		return nil, nil, nil, nil, fiber.NewError(fiber.StatusRequestEntityTooLarge,
			"image trop lourde : 512 Ko au plus, redimensionner avant l'envoi")
	}

	brut, decodeErr := base64.StdEncoding.DecodeString(body.MediaBase64)
	if decodeErr != nil {
		return nil, nil, nil, nil, fiber.NewError(fiber.StatusBadRequest, "media_base64 illisible")
	}
	if len(brut) == 0 {
		return nil, nil, nil, nil, fiber.NewError(fiber.StatusBadRequest, "media_base64 vide")
	}
	if len(brut) > tailleMaxPreuve {
		return nil, nil, nil, nil, fiber.NewError(fiber.StatusRequestEntityTooLarge,
			"image trop lourde : 512 Ko au plus, redimensionner avant l'envoi")
	}

	m := body.MediaMime
	t := body.TypeMedia
	return nom, brut, &m, &t, nil
}

// bornerNom coupe sur une frontière de rune et non d'octet : « Ouédraogo »
// tronqué au milieu du « é » produirait une chaîne invalide en base, que
// Postgres refuse.
func bornerNom(brut string, maxRunes int) string {
	nom := strings.TrimSpace(brut)
	if utf8.RuneCountInString(nom) <= maxRunes {
		return nom
	}
	compte := 0
	for i := range nom {
		if compte == maxRunes {
			return nom[:i]
		}
		compte++
	}
	return nom
}

// LirePreuve rend la fiche de la preuve, sans l'image.
func (d *Deps) LirePreuve(c *fiber.Ctx) error {
	courseID, avecLivreur, err := d.autoriserLecturePreuve(c)
	if err != nil {
		return err
	}

	var p Preuve
	err = d.DB.QueryRow(c.Context(), `
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
		return fiber.NewError(fiber.StatusNotFound, "aucune preuve pour cette course")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture de la preuve échouée")
	}

	if !avecLivreur {
		p.LivreurNom = nil
	}
	return c.JSON(p)
}

// LireMediaPreuve rend l'image elle-même.
//
// Endpoint distinct de la fiche : une image de cent kilo-octets rejouée à
// chaque ouverture de reçu coûterait cher sur un forfait mobile, alors que
// séparée elle passe par le cache du navigateur.
func (d *Deps) LireMediaPreuve(c *fiber.Ctx) error {
	courseID, _, err := d.autoriserLecturePreuve(c)
	if err != nil {
		return err
	}

	var media []byte
	var mime *string
	err = d.DB.QueryRow(c.Context(),
		`SELECT media, media_mime FROM preuves_livraison WHERE course_id = $1`, courseID).
		Scan(&media, &mime)
	if err == pgx.ErrNoRows || (err == nil && media == nil) {
		return fiber.NewError(fiber.StatusNotFound, "aucune image pour cette course")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "lecture de l'image échouée")
	}

	// Le type est relu depuis la base, où seule l'allowlist a pu le déposer ;
	// le renvoyer depuis la requête laisserait un appelant choisir sous quel
	// type son contenu sera interprété par le navigateur d'un autre.
	if _, ok := mimesPreuve[*mime]; !ok {
		return fiber.NewError(fiber.StatusInternalServerError, "type d'image inattendu")
	}

	c.Set(fiber.HeaderContentType, *mime)
	// La preuve est immuable : une fois lue, elle ne changera pas. Un an de
	// cache privé évite de la retélécharger à chaque impression.
	c.Set(fiber.HeaderCacheControl, "private, max-age=31536000, immutable")
	// Une image affichée, jamais interprétée comme document.
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set(fiber.HeaderContentDisposition, "inline")
	return c.Send(media)
}

// autoriserLecturePreuve rend la course et si le lecteur a droit au nom du
// livreur.
//
// Les quatre parties légitimes y ont accès : la compagnie qui facture, le
// partenaire qui a commandé, le destinataire qui a reçu, et le livreur qui a
// remis. Un tiers reçoit « introuvable » plutôt qu'« accès refusé » — les
// distinguer apprendrait qu'une course existe sous cet identifiant.
func (d *Deps) autoriserLecturePreuve(c *fiber.Ctx) (uuid.UUID, bool, error) {
	claims := middleware.ClaimsDe(c)

	courseID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return uuid.Nil, false, fiber.NewError(fiber.StatusBadRequest, "identifiant de course invalide")
	}

	var compagnieID uuid.UUID
	var partenaireID, livreurID, destinataireID *uuid.UUID
	err = d.DB.QueryRow(c.Context(),
		`SELECT compagnie_id, partenaire_id, livreur_id, destinataire_id FROM courses WHERE id = $1`,
		courseID).Scan(&compagnieID, &partenaireID, &livreurID, &destinataireID)
	if err == pgx.ErrNoRows {
		return uuid.Nil, false, fiber.NewError(fiber.StatusNotFound, "course introuvable")
	}
	if err != nil {
		return uuid.Nil, false, fiber.NewError(fiber.StatusInternalServerError, "erreur interne")
	}

	memeQue := func(a *uuid.UUID, b *uuid.UUID) bool {
		return a != nil && b != nil && *a == *b
	}

	// Le **rôle** décide quel claim fait autorité, et non la simple présence
	// d'un identifiant. Un jeton de partenaire porte aussi le `compagnie_id` de
	// sa compagnie : tester d'abord ce claim laissait n'importe quel partenaire
	// lire la preuve de n'importe quelle course de la compagnie, y compris
	// celles d'une entreprise concurrente servie par le même transporteur.
	switch claims.Role {
	case models.RoleCompagnie:
		if claims.CompagnieID != nil && *claims.CompagnieID == compagnieID {
			// La compagnie emploie le livreur : le lui masquer ne protégerait
			// rien.
			return courseID, true, nil
		}
	case models.RoleLivreur:
		if memeQue(claims.LivreurID, livreurID) {
			return courseID, true, nil
		}
	case models.RolePartenaire, models.RoleCollaborateur:
		if memeQue(claims.PartenaireID, partenaireID) {
			return courseID, false, nil
		}
	case models.RoleDestinataire:
		if memeQue(claims.DestinataireID, destinataireID) {
			return courseID, false, nil
		}
	}

	return uuid.Nil, false, fiber.NewError(fiber.StatusNotFound, "course introuvable")
}
