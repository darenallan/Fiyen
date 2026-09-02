package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// La réattribution d'un appareil ne s'observe pas depuis l'API : les deux
// endpoints répondent 204 sans distinction, volontairement — répondre
// différemment ferait de la suppression un moyen de tester à qui appartient un
// jeton. Elle se vérifie donc en base, d'où ces tests d'intégration.

// utilisateurJetable crée un compte minimal rattaché à une compagnie.
func utilisateurJetable(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	suffixe := uuid.NewString()[:8]

	var compagnieID, utilisateurID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		"Test push "+suffixe).Scan(&compagnieID); err != nil {
		t.Fatalf("compagnie: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM compagnies WHERE id = $1`, compagnieID)
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, compagnie_id)
		VALUES ('compagnie', $1, 'x', $2) RETURNING id
	`, "hash-push-"+suffixe, compagnieID).Scan(&utilisateurID); err != nil {
		t.Fatalf("utilisateur: %v", err)
	}

	return utilisateurID
}

// appPush monte les deux routes en injectant les claims du porteur donné,
// sans passer par un vrai JWT : ce qu'on teste ici est le handler, pas l'auth.
func appPush(deps *Deps, porteur uuid.UUID) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("claims", &middleware.Claims{
			UtilisateurID: porteur,
			Role:          models.RoleLivreur,
		})
		return c.Next()
	})
	app.Post("/api/notifications/jeton", deps.EnregistrerJetonPush)
	app.Delete("/api/notifications/jeton", deps.OublierJetonPush)
	return app
}

func envoyerJeton(t *testing.T, app *fiber.App, methode, corps string) int {
	t.Helper()
	req := httptest.NewRequest(methode, "/api/notifications/jeton", strings.NewReader(corps))
	req.Header.Set("Content-Type", "application/json")

	rep, err := app.Test(req, 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	return rep.StatusCode
}

// porteurDe rend l'utilisateur auquel le jeton est rattaché, et le nombre de
// lignes qui le portent.
func porteurDe(t *testing.T, pool *pgxpool.Pool, jeton string) (uuid.UUID, int) {
	t.Helper()

	var lignes int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM jetons_push WHERE jeton = $1`, jeton).Scan(&lignes); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	if lignes == 0 {
		return uuid.Nil, 0
	}

	var porteur uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT utilisateur_id FROM jetons_push WHERE jeton = $1`, jeton).Scan(&porteur); err != nil {
		t.Fatalf("lecture: %v", err)
	}
	return porteur, lignes
}

func jetonDeTest() string {
	return fmt.Sprintf("ExponentPushToken[%s]", uuid.NewString())
}

func TestJetonPush_EnregistrementPuisReenregistrement(t *testing.T) {
	pool := testdb.Ouvrir(t)
	porteur := utilisateurJetable(t, pool)
	app := appPush(&Deps{DB: pool}, porteur)

	jeton := jetonDeTest()
	corps := fmt.Sprintf(`{"jeton":%q,"plateforme":"android"}`, jeton)

	if code := envoyerJeton(t, app, http.MethodPost, corps); code != http.StatusNoContent {
		t.Fatalf("enregistrement = %d", code)
	}

	proprietaire, lignes := porteurDe(t, pool, jeton)
	if lignes != 1 || proprietaire != porteur {
		t.Fatalf("après enregistrement : %d ligne(s), porteur %v", lignes, proprietaire)
	}

	// L'application réenregistre à chaque démarrage : sans ON CONFLICT, la
	// table se remplirait de doublons et chaque notification partirait en
	// plusieurs exemplaires.
	if code := envoyerJeton(t, app, http.MethodPost, corps); code != http.StatusNoContent {
		t.Fatalf("réenregistrement = %d", code)
	}
	if _, lignes := porteurDe(t, pool, jeton); lignes != 1 {
		t.Errorf("réenregistrer doit laisser une seule ligne, obtenu %d", lignes)
	}
}

func TestJetonPush_UnTelephoneReattribueChangeDePorteur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	salif := utilisateurJetable(t, pool)
	aminata := utilisateurJetable(t, pool)

	jeton := jetonDeTest()
	corps := fmt.Sprintf(`{"jeton":%q,"plateforme":"android"}`, jeton)

	if code := envoyerJeton(t, appPush(&Deps{DB: pool}, salif), http.MethodPost, corps); code != http.StatusNoContent {
		t.Fatalf("premier enregistrement = %d", code)
	}
	if code := envoyerJeton(t, appPush(&Deps{DB: pool}, aminata), http.MethodPost, corps); code != http.StatusNoContent {
		t.Fatalf("réattribution = %d", code)
	}

	proprietaire, lignes := porteurDe(t, pool, jeton)

	// Le cœur du point : un téléphone réinstallé ou prêté garde son jeton Expo.
	// Sans réattribution, l'ancien porteur continuerait de recevoir les courses
	// du nouveau — une fuite d'information sur l'activité d'un collègue.
	if proprietaire != aminata {
		t.Errorf("le jeton doit suivre le nouveau porteur : %v au lieu de %v", proprietaire, aminata)
	}
	if lignes != 1 {
		t.Errorf("une seule ligne doit porter ce jeton, obtenu %d", lignes)
	}
}

func TestJetonPush_LAncienPorteurNeSupprimePlus(t *testing.T) {
	pool := testdb.Ouvrir(t)
	salif := utilisateurJetable(t, pool)
	aminata := utilisateurJetable(t, pool)

	jeton := jetonDeTest()
	corps := fmt.Sprintf(`{"jeton":%q,"plateforme":"android"}`, jeton)

	envoyerJeton(t, appPush(&Deps{DB: pool}, salif), http.MethodPost, corps)
	envoyerJeton(t, appPush(&Deps{DB: pool}, aminata), http.MethodPost, corps)

	// Salif tente d'effacer un jeton qui ne lui appartient plus. La réponse est
	// un 204 comme partout — mais l'effet doit être nul.
	suppression := fmt.Sprintf(`{"jeton":%q}`, jeton)
	if code := envoyerJeton(t, appPush(&Deps{DB: pool}, salif), http.MethodDelete, suppression); code != http.StatusNoContent {
		t.Fatalf("suppression par l'ancien porteur = %d", code)
	}

	if _, lignes := porteurDe(t, pool, jeton); lignes != 1 {
		t.Error("l'ancien porteur ne doit pas pouvoir couper les notifications du nouveau")
	}

	// Le porteur courant, lui, doit pouvoir.
	if code := envoyerJeton(t, appPush(&Deps{DB: pool}, aminata), http.MethodDelete, suppression); code != http.StatusNoContent {
		t.Fatalf("suppression par le porteur courant = %d", code)
	}
	if _, lignes := porteurDe(t, pool, jeton); lignes != 0 {
		t.Error("le porteur courant doit pouvoir oublier son appareil")
	}
}

func TestJetonPush_PlusieursAppareilsParPersonne(t *testing.T) {
	pool := testdb.Ouvrir(t)
	porteur := utilisateurJetable(t, pool)
	app := appPush(&Deps{DB: pool}, porteur)

	// Un livreur peut avoir deux téléphones, ou en changer sans se déconnecter
	// du premier. Les deux doivent recevoir : mieux vaut une notification en
	// double qu'une notification perdue.
	premier, second := jetonDeTest(), jetonDeTest()
	for _, j := range []string{premier, second} {
		corps := fmt.Sprintf(`{"jeton":%q,"plateforme":"android"}`, j)
		if code := envoyerJeton(t, app, http.MethodPost, corps); code != http.StatusNoContent {
			t.Fatalf("enregistrement de %s = %d", j, code)
		}
	}

	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM jetons_push WHERE utilisateur_id = $1`, porteur).Scan(&n); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	if n != 2 {
		t.Errorf("les deux appareils doivent coexister, obtenu %d", n)
	}
}

func TestJetonPush_FormatRefuseAvantLaBase(t *testing.T) {
	pool := testdb.Ouvrir(t)
	porteur := utilisateurJetable(t, pool)
	app := appPush(&Deps{DB: pool}, porteur)

	// Valider le format rend visible tout de suite une application mal
	// configurée, plutôt qu'au premier envoi raté chez le service Expo.
	cas := map[string]string{
		"chaîne quelconque":  `{"jeton":"bonjour","plateforme":"android"}`,
		"jeton vide":         `{"jeton":"","plateforme":"android"}`,
		"crochets manquants": `{"jeton":"ExponentPushToken","plateforme":"android"}`,
		"plateforme inconnue": fmt.Sprintf(`{"jeton":%q,"plateforme":"symbian"}`,
			jetonDeTest()),
	}

	for libelle, corps := range cas {
		if code := envoyerJeton(t, app, http.MethodPost, corps); code != http.StatusBadRequest {
			t.Errorf("%s : code %d, attendu 400", libelle, code)
		}
	}

	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM jetons_push WHERE utilisateur_id = $1`, porteur).Scan(&n); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	if n != 0 {
		t.Errorf("aucune de ces saisies ne doit atteindre la base, obtenu %d ligne(s)", n)
	}
}
