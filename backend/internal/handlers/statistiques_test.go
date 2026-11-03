package handlers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/testdb"
)

func appStats(deps *Deps, claims *middleware.Claims) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("claims", claims)
		return c.Next()
	})
	app.Get("/api/dashboard/statistiques", deps.Statistiques)
	app.Get("/api/dashboard/statistiques/export", deps.ExporterStatistiques)
	return app
}

// courseHistorique insère une course livrée il y a `ilYa`, avec un journal
// daté : création, assignation +5 min, récupération +15 min, livraison +40 min.
func courseHistorique(t *testing.T, pool *pgxpool.Pool, jeu testdb.Jeu, partenaireID *uuid.UUID, ilYa time.Duration, prix int) {
	t.Helper()
	ctx := context.Background()
	cree := time.Now().Add(-ilYa)
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `
		WITH n AS (UPDATE compagnies SET compteur_courses = compteur_courses + 1 WHERE id = $1 RETURNING compteur_courses)
		INSERT INTO courses (compagnie_id, destinataire_id, livreur_id, partenaire_id, statut,
		                     adresse_depart, adresse_arrivee, numero, prix_estime, created_at, updated_at)
		SELECT $1, $2, $3, $4, 'livree', 'A', 'B', n.compteur_courses, $5, $6, $6 FROM n RETURNING id`,
		jeu.CompagnieID, jeu.DestinataireID, jeu.LivreurID, partenaireID, prix, cree).Scan(&id); err != nil {
		t.Fatalf("course : %v", err)
	}
	for _, e := range []struct {
		typ string
		min int
	}{{"creee", 0}, {"assignee", 5}, {"recuperee", 15}, {"livree", 40}} {
		if _, err := pool.Exec(ctx, `INSERT INTO evenements_course (course_id, type, created_at) VALUES ($1, $2, $3)`,
			id, e.typ, cree.Add(time.Duration(e.min)*time.Minute)); err != nil {
			t.Fatalf("journal : %v", err)
		}
	}
}

func TestStatistiques_DelaisDuJournalEtCloisonnement(t *testing.T) {
	pool := testdb.Ouvrir(t)
	a := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	b := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	part := partenaireJetable(t, pool, a.CompagnieID, a.CourseID)

	courseHistorique(t, pool, a, &part, time.Hour, 1500)
	courseHistorique(t, pool, a, nil, 2*time.Hour, 1000)
	courseHistorique(t, pool, b, nil, time.Hour, 9999) // autre compagnie

	code, corps := appeler(t, appStats(&Deps{DB: pool}, claimsCompagnie(a.CompagnieID)), "GET", "/api/dashboard/statistiques", "")
	if code != 200 {
		t.Fatalf("statut %d", code)
	}
	ind := corps["indicateurs"].(map[string]any)
	// Les 9 999 F de la compagnie B ne doivent pas apparaître.
	if ind["livrees"].(float64) != 2 || ind["montant_livre"].(float64) != 2500 {
		t.Fatalf("indicateurs : %v", ind)
	}
	trajet := ind["delai_livraison"].(map[string]any)
	if trajet["moyenne_s"].(float64) != 25*60 {
		t.Errorf("trajet moyen %v s, attendu 1500", trajet["moyenne_s"])
	}
	prise := ind["delai_prise_en_charge"].(map[string]any)
	if prise["mediane_s"].(float64) != 15*60 {
		t.Errorf("prise en charge médiane %v s, attendu 900", prise["mediane_s"])
	}
	if corps["definitions"].(map[string]any)["taux_reussite"] == nil {
		t.Error("les définitions doivent accompagner les chiffres")
	}
	if len(corps["par_partenaire"].([]any)) != 2 {
		t.Errorf("par partenaire : %v", corps["par_partenaire"])
	}

	// Un mois à venir est refusé plutôt que rendu vide.
	if code, _ := appeler(t, appStats(&Deps{DB: pool}, claimsCompagnie(a.CompagnieID)), "GET", "/api/dashboard/statistiques?mois=2999-01", ""); code != 400 {
		t.Errorf("mois à venir : %d, attendu 400", code)
	}
}

func TestExport_CSVPourExcelSansInjectionDeFormule(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	part := partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	// Un nom piégé : ouvert dans Excel, il serait exécuté comme une formule.
	if _, err := pool.Exec(context.Background(), `UPDATE partenaires SET nom = '=HYPERLINK("x")' WHERE id = $1`, part); err != nil {
		t.Fatal(err)
	}
	courseHistorique(t, pool, jeu, &part, time.Hour, 1500)

	app := appStats(&Deps{DB: pool}, claimsCompagnie(jeu.CompagnieID))
	rep, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/dashboard/statistiques/export", nil), 5000)
	if err != nil || rep.StatusCode != 200 {
		t.Fatalf("export : %v %v", err, rep.StatusCode)
	}
	brut, _ := io.ReadAll(rep.Body)
	texte := string(brut)
	if !strings.HasPrefix(texte, "\xef\xbb\xbfNuméro;Statut;") {
		t.Errorf("entête inattendue : %q", texte[:40])
	}
	if !strings.Contains(rep.Header.Get("Content-Disposition"), "fiyen-courses-") {
		t.Errorf("nom de fichier absent")
	}
	if strings.Contains(texte, ";=HYPERLINK") || strings.Contains(texte, ";\"=HYPERLINK") {
		t.Errorf("formule non neutralisée :\n%s", texte)
	}
	if !strings.Contains(texte, "'=HYPERLINK") {
		t.Errorf("le nom du partenaire doit rester lisible, préfixé d'une apostrophe :\n%s", texte)
	}
	if !strings.Contains(texte, ";15;25;1500") {
		t.Errorf("délais ou prix absents de la ligne :\n%s", texte)
	}
}
