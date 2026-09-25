package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/config"
	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// Un lien partagé quitte les applications de confiance : ce que le partenaire
// ne voit déjà pas sur son reçu, un inconnu qui tombe sur ce lien ne doit pas
// le voir non plus. Les tests portent donc moins sur la génération que sur ce
// que la page publique laisse ou ne laisse pas passer.

const urlPubliqueTest = "http://test.local"

func depsLienPartage(pool *pgxpool.Pool) *Deps {
	return &Deps{DB: pool, Config: &config.Config{URLPublique: urlPubliqueTest}}
}

// appLienPartage monte à la fois les routes authentifiées (génération) et les
// routes publiques (lecture), comme le fait réellement `main.go` — deux
// groupes distincts d'un même processus.
func appLienPartage(deps *Deps, claims *middleware.Claims) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		if claims != nil {
			c.Locals("claims", claims)
		}
		return c.Next()
	})
	app.Post("/api/courses/:id/lien-partage", deps.GenererLienRecuCourse)
	app.Post("/api/commandes/:id/lien-partage", deps.GenererLienRecuCommande)
	app.Get("/r/:jeton", deps.RecuPartage)
	app.Get("/r/:jeton/preuve/media", deps.MediaPreuvePartage)
	return app
}

func genererLien(t *testing.T, app *fiber.App, chemin string) (int, map[string]any) {
	t.Helper()
	rep, err := app.Test(httptest.NewRequest(http.MethodPost, chemin, nil), 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	if rep.StatusCode != fiber.StatusOK {
		return rep.StatusCode, nil
	}
	var corps map[string]any
	if err := json.NewDecoder(rep.Body).Decode(&corps); err != nil {
		t.Fatalf("décodage: %v", err)
	}
	return rep.StatusCode, corps
}

func pageHTML(t *testing.T, app *fiber.App, chemin string) (int, string, string) {
	t.Helper()
	rep, err := app.Test(httptest.NewRequest(http.MethodGet, chemin, nil), 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	corps, _ := io.ReadAll(rep.Body)
	return rep.StatusCode, rep.Header.Get(fiber.HeaderContentType), string(corps)
}

func cheminDuLien(t *testing.T, url string) string {
	t.Helper()
	// L'URL renvoyée est absolue (préfixée par URLPublique) ; l'app de test ne
	// connaît que le chemin.
	i := strings.Index(url, urlPubliqueTest)
	if i != 0 {
		t.Fatalf("URL inattendue, ne commence pas par %q: %q", urlPubliqueTest, url)
	}
	return strings.TrimPrefix(url, urlPubliqueTest)
}

func TestLienPartage_ReutiliseLeMemeLienTantQuilEstValide(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := depsLienPartage(pool)
	app := appLienPartage(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID, UtilisateurID: utilisateurJetable(t, pool),
	})

	code, premier := genererLien(t, app, "/api/courses/"+jeu.CourseID.String()+"/lien-partage")
	if code != fiber.StatusOK {
		t.Fatalf("génération = %d, attendu 200", code)
	}
	code, second := genererLien(t, app, "/api/courses/"+jeu.CourseID.String()+"/lien-partage")
	if code != fiber.StatusOK {
		t.Fatalf("seconde génération = %d, attendu 200", code)
	}

	// Un second clic sur « Partager » doit redonner le même lien : en empiler
	// un nouveau à chaque fois rendrait confus « lequel des trois messages
	// WhatsApp envoyés contient le bon lien ? ».
	if premier["url"] != second["url"] {
		t.Errorf("les deux liens diffèrent : %v vs %v", premier["url"], second["url"])
	}
}

func TestLienPartage_LaPageEstAccessibleSansAuthentification(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := depsLienPartage(pool)

	genere := appLienPartage(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID, UtilisateurID: utilisateurJetable(t, pool),
	})
	_, lien := genererLien(t, genere, "/api/courses/"+jeu.CourseID.String()+"/lien-partage")

	// Aucun claim posé : c'est exactement ce que voit un destinataire qui
	// ouvre le lien reçu par WhatsApp, sans jeton d'aucune sorte.
	anonyme := appLienPartage(deps, nil)
	code, contentType, html := pageHTML(t, anonyme, cheminDuLien(t, lien["url"].(string)))
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}
	if !strings.Contains(contentType, "text/html") {
		t.Errorf("content-type = %q, attendu text/html", contentType)
	}
	// Adresses posées par `testdb.CreerJeu` : leur présence prouve que la page
	// a réellement chargé le reçu, pas seulement rendu un gabarit vide.
	if !strings.Contains(html, "Marché de Rood Woko") || !strings.Contains(html, "Zone du Bois") {
		t.Errorf("la page ne reprend pas le trajet de la course : %.400s", html)
	}
}

func TestLienPartage_NeNommeJamaisLeLivreur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := depsLienPartage(pool)
	ctx := context.Background()

	// Le décor assigne déjà un livreur : sans un nom réellement présent en
	// base, l'absence de fuite ne prouverait rien.
	var nomLivreur string
	if err := pool.QueryRow(ctx, `SELECT nom FROM livreurs WHERE id = $1`, jeu.LivreurID).Scan(&nomLivreur); err != nil {
		t.Fatalf("lecture du nom du livreur: %v", err)
	}

	genere := appLienPartage(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID, UtilisateurID: utilisateurJetable(t, pool),
	})
	_, lien := genererLien(t, genere, "/api/courses/"+jeu.CourseID.String()+"/lien-partage")

	anonyme := appLienPartage(deps, nil)
	_, _, html := pageHTML(t, anonyme, cheminDuLien(t, lien["url"].(string)))

	if strings.Contains(html, nomLivreur) {
		t.Errorf("le nom du livreur (%q) apparaît sur la page publique", nomLivreur)
	}
}

func TestLienPartage_UnJetonInconnuOuExpireRend404(t *testing.T) {
	pool := testdb.Ouvrir(t)
	deps := depsLienPartage(pool)
	app := appLienPartage(deps, nil)

	code, _, _ := pageHTML(t, app, "/r/nimportequoi")
	if code != fiber.StatusNotFound {
		t.Errorf("jeton inconnu: statut = %d, attendu 404", code)
	}

	// Un lien expiré doit se comporter exactement comme un jeton inconnu : le
	// distinguer n'apprendrait rien d'utile à quelqu'un qui devine.
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	var jetonExpire string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO liens_partages_recu (course_id, jeton, expire_at)
		VALUES ($1, $2, now() - interval '1 hour') RETURNING jeton
	`, jeu.CourseID, uuid.NewString()).Scan(&jetonExpire); err != nil {
		t.Fatalf("insertion du lien expiré: %v", err)
	}

	code, _, _ = pageHTML(t, app, "/r/"+jetonExpire)
	if code != fiber.StatusNotFound {
		t.Errorf("jeton expiré: statut = %d, attendu 404", code)
	}
}

func TestLienPartage_UneAutreCompagnieNePeutPasEnGenererUn(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := depsLienPartage(pool)

	var autre uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		"Concurrente "+uuid.NewString()[:8]).Scan(&autre); err != nil {
		t.Fatalf("seconde compagnie: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM compagnies WHERE id = $1`, autre)
	})

	app := appLienPartage(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &autre, UtilisateurID: utilisateurJetable(t, pool),
	})
	code, _ := genererLien(t, app, "/api/courses/"+jeu.CourseID.String()+"/lien-partage")
	if code != fiber.StatusNotFound {
		t.Errorf("statut = %d, attendu 404", code)
	}
}

func TestLienPartage_UnAutrePartenaireNePeutPasEnGenererUn(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	deps := depsLienPartage(pool)

	var voisin uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO partenaires (compagnie_id, nom) VALUES ($1, $2) RETURNING id
	`, jeu.CompagnieID, "Voisin "+uuid.NewString()[:8]).Scan(&voisin); err != nil {
		t.Fatalf("partenaire voisin: %v", err)
	}

	app := appLienPartage(deps, &middleware.Claims{
		Role: models.RolePartenaire, PartenaireID: &voisin, UtilisateurID: utilisateurJetable(t, pool),
	})
	code, _ := genererLien(t, app, "/api/commandes/"+jeu.CourseID.String()+"/lien-partage")
	if code != fiber.StatusNotFound {
		t.Errorf("statut = %d, attendu 404", code)
	}
}

func TestLienPartage_LaPreuveDeRemiseYFigureSansLeLivreur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := depsLienPartage(pool)
	ctx := context.Background()

	if _, err := pool.Exec(ctx,
		`INSERT INTO preuves_livraison (course_id, livreur_id, nom_receptionnaire, capture_le)
		 VALUES ($1, $2, $3, now())`,
		jeu.CourseID, jeu.LivreurID, "Fatimata Sawadogo"); err != nil {
		t.Fatalf("insertion de la preuve: %v", err)
	}

	genere := appLienPartage(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID, UtilisateurID: utilisateurJetable(t, pool),
	})
	_, lien := genererLien(t, genere, "/api/courses/"+jeu.CourseID.String()+"/lien-partage")

	anonyme := appLienPartage(deps, nil)
	code, _, html := pageHTML(t, anonyme, cheminDuLien(t, lien["url"].(string)))
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}
	if !strings.Contains(html, "Fatimata Sawadogo") {
		t.Error("la preuve de remise n'apparaît pas sur la page publique")
	}
}
