package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

func appBareme(deps *Deps, claims *middleware.Claims) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("claims", claims)
		return c.Next()
	})
	app.Get("/api/dashboard/bareme", deps.ObtenirBareme)
	app.Post("/api/dashboard/bareme", deps.PublierBareme)
	app.Post("/api/dashboard/bareme/apercu", deps.ApercuBareme)
	app.Get("/api/commandes/estimation", deps.EstimerCommande)
	app.Post("/api/commandes/", deps.CreerCoursePartenaire)
	app.Get("/api/commandes/:id", deps.ObtenirCoursePartenaire)
	return app
}

func appeler(t *testing.T, app *fiber.App, methode, chemin, corps string) (int, map[string]any) {
	t.Helper()
	var req *http.Request
	if corps != "" {
		req = httptest.NewRequest(methode, chemin, strings.NewReader(corps))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(methode, chemin, nil)
	}
	rep, err := app.Test(req, 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(rep.Body).Decode(&m)
	return rep.StatusCode, m
}

func claimsCompagnie(id uuid.UUID) *middleware.Claims {
	return &middleware.Claims{UtilisateurID: uuid.New(), Role: models.RoleCompagnie, CompagnieID: &id}
}

func claimsPartenaire(compagnieID, partenaireID uuid.UUID) *middleware.Claims {
	return &middleware.Claims{UtilisateurID: uuid.New(), Role: models.RolePartenaire,
		CompagnieID: &compagnieID, PartenaireID: &partenaireID}
}

const baremePaliers = `{"mode":"paliers","coefficient_detour":1.3,"arrondi":50,
	"paliers":[{"jusqu_a_km":3,"prix":1000},{"jusqu_a_km":8,"prix":1500},{"jusqu_a_km":20,"prix":2500}],
	"motif":"Grille de rentrée"}`

// Pharmacie (centre) → Ouaga 2000 : ~8,7 km estimés avec le détour → 3e palier.
const coordsOuaga2000 = "lat_depart=12.3712&lon_depart=-1.5199&lat_arrivee=12.3176&lon_arrivee=-1.4932"

func TestBareme_PublicationValideeEtHistorique(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	app := appBareme(&Deps{DB: pool}, claimsCompagnie(jeu.CompagnieID))

	// Rien de publié : pas de barème inventé.
	code, corps := appeler(t, app, "GET", "/api/dashboard/bareme", "")
	if code != 200 || corps["actuel"] != nil {
		t.Fatalf("avant publication : %d %v", code, corps["actuel"])
	}

	// Un barème incohérent est refusé, avec un message lisible.
	code, _ = appeler(t, app, "POST", "/api/dashboard/bareme",
		`{"mode":"paliers","coefficient_detour":1.3,"arrondi":50,"paliers":[{"jusqu_a_km":5,"prix":1000},{"jusqu_a_km":3,"prix":900}]}`)
	if code != 400 {
		t.Fatalf("paliers décroissants : statut %d, attendu 400", code)
	}

	if code, corps = appeler(t, app, "POST", "/api/dashboard/bareme", `{"mode":"forfait","coefficient_detour":1.3,"arrondi":50,"prix_forfait":1000}`); code != 201 {
		t.Fatalf("publication 1 : %d %v", code, corps)
	}
	if code, corps = appeler(t, app, "POST", "/api/dashboard/bareme", baremePaliers); code != 201 {
		t.Fatalf("publication 2 : %d %v", code, corps)
	}

	code, corps = appeler(t, app, "GET", "/api/dashboard/bareme", "")
	if code != 200 {
		t.Fatalf("lecture : %d", code)
	}
	actuel := corps["actuel"].(map[string]any)
	if actuel["mode"] != "paliers" || actuel["motif"] != "Grille de rentrée" || actuel["auteur_role"] != "compagnie" {
		t.Errorf("version en vigueur inattendue : %v", actuel)
	}
	if n := len(corps["historique"].([]any)); n != 2 {
		t.Errorf("historique : %d versions, attendu 2", n)
	}
}

func TestBareme_ImmuableEnBase(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	app := appBareme(&Deps{DB: pool}, claimsCompagnie(jeu.CompagnieID))
	code, corps := appeler(t, app, "POST", "/api/dashboard/bareme", `{"mode":"forfait","coefficient_detour":1.3,"arrondi":50,"prix_forfait":1000}`)
	if code != 201 {
		t.Fatalf("publication : %d %v", code, corps)
	}
	// Réécrire un prix publié doit être impossible, même en SQL direct.
	_, err := pool.Exec(context.Background(),
		`UPDATE baremes_livraison SET prix_forfait = 1 WHERE id = $1`, corps["id"])
	if err == nil {
		t.Fatal("une version publiée du barème a pu être réécrite")
	}
}

func TestBareme_Apercu(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	app := appBareme(&Deps{DB: pool}, claimsCompagnie(jeu.CompagnieID))

	code, corps := appeler(t, app, "POST", "/api/dashboard/bareme/apercu",
		`{"bareme":{"mode":"distance","coefficient_detour":1.3,"arrondi":50,"prix_base":500,"prix_par_km":200,"prix_minimum":1000},"distances_km":[1,6.3]}`)
	if code != 200 {
		t.Fatalf("aperçu : %d %v", code, corps)
	}
	lignes := corps["lignes"].([]any)
	if lignes[0].(map[string]any)["prix"].(float64) != 1000 || lignes[1].(map[string]any)["prix"].(float64) != 1800 {
		t.Errorf("aperçu inattendu : %v", lignes)
	}
}

func TestEstimation_SuitLeBaremeDeSaCompagnieSeulement(t *testing.T) {
	pool := testdb.Ouvrir(t)
	a := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	b := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partA := partenaireJetable(t, pool, a.CompagnieID, a.CourseID)
	deps := &Deps{DB: pool}

	// Seule la compagnie B publie un barème.
	if code, _ := appeler(t, appBareme(deps, claimsCompagnie(b.CompagnieID)), "POST", "/api/dashboard/bareme", baremePaliers); code != 201 {
		t.Fatal("publication B")
	}

	appA := appBareme(deps, claimsPartenaire(a.CompagnieID, partA))
	code, corps := appeler(t, appA, "GET", "/api/commandes/estimation?"+coordsOuaga2000, "")
	if code != 200 || corps["disponible"] != false || corps["prix"] != nil {
		t.Fatalf("le partenaire de A voit un prix venu d'ailleurs : %d %v", code, corps)
	}

	// A publie à son tour : l'estimation suit.
	if code, _ := appeler(t, appBareme(deps, claimsCompagnie(a.CompagnieID)), "POST", "/api/dashboard/bareme", baremePaliers); code != 201 {
		t.Fatal("publication A")
	}
	code, corps = appeler(t, appA, "GET", "/api/commandes/estimation?"+coordsOuaga2000, "")
	if code != 200 || corps["disponible"] != true || corps["prix"].(float64) != 2500 {
		t.Fatalf("estimation : %d %v", code, corps)
	}

	// Sans épingles : pas de prix inventé, une raison lisible.
	code, corps = appeler(t, appA, "GET", "/api/commandes/estimation", "")
	if code != 200 || corps["disponible"] != false || !strings.Contains(corps["raison"].(string), "à confirmer") {
		t.Fatalf("sans épingles : %d %v", code, corps)
	}
}

func TestCommande_PrixFigeAuMomentDeLaCommande(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	part := partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	deps := &Deps{DB: pool}
	appC := appBareme(deps, claimsCompagnie(jeu.CompagnieID))
	// `courses.cree_par` référence un vrai compte.
	claimsP := claimsPartenaire(jeu.CompagnieID, part)
	claimsP.UtilisateurID = utilisateurJetable(t, pool)
	appP := appBareme(deps, claimsP)

	if code, _ := appeler(t, appC, "POST", "/api/dashboard/bareme", baremePaliers); code != 201 {
		t.Fatal("publication")
	}
	telephone := "+2267" + strings.ReplaceAll(uuid.NewString(), "-", "")[:7]
	code, cmd := appeler(t, appP, "POST", "/api/commandes/", `{"destinataire_nom":"Awa","destinataire_telephone":"`+telephone+`",
		"adresse_depart":"Pharmacie","latitude_depart":12.3712,"longitude_depart":-1.5199,
		"adresse_arrivee":"Ouaga 2000","latitude_arrivee":12.3176,"longitude_arrivee":-1.4932}`)
	if code != 201 || cmd["prix_estime"] == nil || cmd["prix_estime"].(float64) != 2500 || cmd["devise"] != "XOF" {
		t.Fatalf("création : %d %v", code, cmd)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM courses WHERE id = $1`, cmd["id"])
		_, _ = pool.Exec(ctx, `DELETE FROM destinataires WHERE nom = 'Awa' AND NOT EXISTS
			(SELECT 1 FROM courses WHERE destinataire_id = destinataires.id)
			AND NOT EXISTS (SELECT 1 FROM utilisateurs WHERE destinataire_id = destinataires.id)`)
	})

	// La compagnie double ses prix le lendemain : la commande d'hier garde le sien.
	if code, _ := appeler(t, appC, "POST", "/api/dashboard/bareme", `{"mode":"forfait","coefficient_detour":1.3,"arrondi":50,"prix_forfait":5000}`); code != 201 {
		t.Fatal("seconde publication")
	}
	code, relu := appeler(t, appP, "GET", "/api/commandes/"+cmd["id"].(string), "")
	if code != 200 || relu["prix_estime"] == nil || relu["prix_estime"].(float64) != 2500 {
		t.Fatalf("le prix d'une commande passée a changé : %d %v", code, relu["prix_estime"])
	}
}
