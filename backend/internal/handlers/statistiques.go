package handlers

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/stats"
)

// Le Burkina Faso vit en UTC toute l'année, sans heure d'été : les bornes de
// mois se calculent en UTC sans dépendre d'une base de fuseaux, absente de
// certains postes Windows.
var fuseauStats = time.UTC

const requeteStats = `
	SELECT co.numero, co.statut, co.created_at,
	       MIN(e.created_at) FILTER (WHERE e.type = 'assignee'),
	       MIN(e.created_at) FILTER (WHERE e.type = 'recuperee'),
	       MIN(e.created_at) FILTER (WHERE e.type = 'livree'),
	       MIN(e.created_at) FILTER (WHERE e.type = 'annulee'),
	       COALESCE(co.livreur_id::text, ''), COALESCE(l.nom, ''),
	       COALESCE(co.partenaire_id::text, ''), COALESCE(p.nom, ''),
	       co.prix_estime
	FROM courses co
	LEFT JOIN evenements_course e ON e.course_id = co.id
	LEFT JOIN livreurs l ON l.id = co.livreur_id
	LEFT JOIN partenaires p ON p.id = co.partenaire_id
	WHERE co.compagnie_id = $1 AND co.created_at >= $2 AND co.created_at < $3
	GROUP BY co.id, l.nom, p.nom
	ORDER BY co.created_at`

func (d *Deps) chargerCoursesStats(ctx context.Context, compagnieID uuid.UUID, p stats.Periode) ([]stats.Course, error) {
	rows, err := d.DB.Query(ctx, requeteStats, compagnieID, p.Debut, p.Fin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var courses []stats.Course
	for rows.Next() {
		var c stats.Course
		var numero int
		if err := rows.Scan(&numero, &c.Statut, &c.CreeLe, &c.AssigneeLe, &c.RecupereeLe,
			&c.LivreeLe, &c.AnnuleeLe, &c.LivreurID, &c.LivreurNom, &c.PartenaireID,
			&c.PartenaireNom, &c.Prix); err != nil {
			return nil, err
		}
		c.Numero = FormaterNumero(numero)
		courses = append(courses, c)
	}
	return courses, rows.Err()
}

// lireMois lit `?mois=AAAA-MM`, le mois en cours par défaut.
func lireMois(c *fiber.Ctx, maintenant time.Time) (int, time.Month, error) {
	brut := c.Query("mois")
	if brut == "" {
		return maintenant.Year(), maintenant.Month(), nil
	}
	t, err := time.ParseInLocation("2006-01", brut, fuseauStats)
	if err != nil {
		return 0, 0, fmt.Errorf("mois attendu au format AAAA-MM")
	}
	if t.After(maintenant) {
		return 0, 0, fmt.Errorf("mois à venir")
	}
	return t.Year(), t.Month(), nil
}

// Statistiques (compagnie) — indicateurs d'un mois et comparaison.
func (d *Deps) Statistiques(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	maintenant := time.Now().In(fuseauStats)
	annee, mois, err := lireMois(c, maintenant)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	periode, precedente := stats.Periodes(annee, mois, maintenant, fuseauStats)

	ctx := c.Context()
	courses, err := d.chargerCoursesStats(ctx, *claims.CompagnieID, periode)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "calcul des statistiques échoué")
	}
	anciennes, err := d.chargerCoursesStats(ctx, *claims.CompagnieID, precedente)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "calcul des statistiques échoué")
	}

	return c.JSON(fiber.Map{
		"mois":                   fmt.Sprintf("%04d-%02d", annee, mois),
		"partiel":                periode.Fin.Equal(maintenant),
		"periode":                periode,
		"comparaison":            precedente,
		"indicateurs":            stats.Calculer(courses),
		"indicateurs_precedents": stats.Calculer(anciennes),
		"par_livreur":            stats.ParLivreur(courses),
		"par_partenaire":         stats.ParPartenaire(courses),
		"definitions":            stats.Definitions,
	})
}

// neutraliserFormule empêche un tableur d'exécuter une cellule : un nom de
// partenaire commençant par « = » deviendrait sinon une formule à l'ouverture
// du fichier (injection CSV, OWASP).
func neutraliserFormule(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

func dateCSV(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.In(fuseauStats).Format("2006-01-02 15:04")
}

func minutesEntre(a, b *time.Time) string {
	if a == nil || b == nil || b.Before(*a) {
		return ""
	}
	return strconv.FormatFloat(b.Sub(*a).Minutes(), 'f', 0, 64)
}

var libellesStatutCSV = map[string]string{
	"en_attente": "En attente", "assignee": "Assignée", "recuperee": "Récupérée",
	"en_route": "En route", "livree": "Livrée", "annulee": "Annulée",
}

// ExporterStatistiques (compagnie) — une ligne par course du mois, en CSV.
//
// Séparateur « ; » et BOM UTF-8 : c'est ce qu'attend Excel en français pour
// ouvrir le fichier d'un double-clic, accents compris.
func (d *Deps) ExporterStatistiques(c *fiber.Ctx) error {
	claims := middleware.ClaimsDe(c)
	maintenant := time.Now().In(fuseauStats)
	annee, mois, err := lireMois(c, maintenant)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	periode, _ := stats.Periodes(annee, mois, maintenant, fuseauStats)
	courses, err := d.chargerCoursesStats(c.Context(), *claims.CompagnieID, periode)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "export échoué")
	}

	var buf bytes.Buffer
	buf.Write([]byte{0xEF, 0xBB, 0xBF}) // BOM UTF-8
	w := csv.NewWriter(&buf)
	w.Comma = ';'
	_ = w.Write([]string{"Numéro", "Statut", "Créée le", "Assignée le", "Récupérée le",
		"Livrée le", "Annulée le", "Livreur", "Partenaire", "Prise en charge (min)",
		"Trajet (min)", "Prix (F CFA)"})
	for _, co := range courses {
		partenaire := co.PartenaireNom
		if co.PartenaireID == "" {
			partenaire = stats.SaisieCompagnie
		}
		prix := ""
		if co.Prix != nil {
			prix = strconv.Itoa(*co.Prix)
		}
		cree := co.CreeLe
		_ = w.Write([]string{
			co.Numero, libellesStatutCSV[co.Statut], dateCSV(&cree), dateCSV(co.AssigneeLe),
			dateCSV(co.RecupereeLe), dateCSV(co.LivreeLe), dateCSV(co.AnnuleeLe),
			neutraliserFormule(co.LivreurNom), neutraliserFormule(partenaire),
			minutesEntre(&cree, co.RecupereeLe), minutesEntre(co.RecupereeLe, co.LivreeLe), prix,
		})
	}
	w.Flush()

	c.Set(fiber.HeaderContentType, "text/csv; charset=utf-8")
	c.Set(fiber.HeaderContentDisposition,
		fmt.Sprintf(`attachment; filename="fiyen-courses-%04d-%02d.csv"`, annee, mois))
	return c.Send(buf.Bytes())
}
