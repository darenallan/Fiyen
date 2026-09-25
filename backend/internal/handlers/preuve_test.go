package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
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

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// Une preuve de livraison est une pièce : ce qui compte n'est pas seulement
// qu'elle s'enregistre, mais qu'elle ne se **remplace** pas, qu'elle n'atteigne
// que les quatre parties de la course, et qu'elle ne dise jamais au partenaire
// qui portait le colis.

// pngMinimal est un PNG valide de 1×1 pixel. Utiliser une vraie image plutôt
// que des octets quelconques : le jour où une vérification de format est
// ajoutée, ces tests continuent de dire ce qu'ils disent.
const pngMinimal = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func appPreuve(deps *Deps, claims *middleware.Claims) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("claims", claims)
		return c.Next()
	})
	app.Post("/api/courses/:id/preuve", deps.DeposerPreuve)
	app.Get("/api/courses/:id/preuve", deps.LirePreuve)
	app.Get("/api/courses/:id/preuve/media", deps.LireMediaPreuve)
	app.Get("/api/courses/:id/recu", deps.RecuCourse)
	app.Get("/api/commandes/:id/recu", deps.RecuCommande)
	return app
}

func claimsLivreur(jeu testdb.Jeu) *middleware.Claims {
	l := jeu.LivreurID
	return &middleware.Claims{Role: models.RoleLivreur, LivreurID: &l}
}

// enRoute avance la course : le décor la crée « assignee », et une preuve ne se
// dépose qu'à la remise.
func enRoute(t *testing.T, pool *pgxpool.Pool, courseID uuid.UUID, statut models.StatutCourse) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE courses SET statut = $2 WHERE id = $1`, courseID, statut); err != nil {
		t.Fatalf("avancement du statut: %v", err)
	}
}

func envoyerPreuve(t *testing.T, app *fiber.App, courseID uuid.UUID, corps string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/courses/"+courseID.String()+"/preuve",
		strings.NewReader(corps))
	req.Header.Set("Content-Type", "application/json")

	rep, err := app.Test(req, 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	lu, _ := io.ReadAll(rep.Body)
	return rep.StatusCode, string(lu)
}

func lireJSON(t *testing.T, app *fiber.App, chemin string) (int, map[string]any) {
	t.Helper()
	rep, err := app.Test(httptest.NewRequest(http.MethodGet, chemin, nil), 5000)
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

func TestPreuve_DeposeeEtRelue(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	deps := &Deps{DB: pool}
	app := appPreuve(deps, claimsLivreur(jeu))

	code, corps := envoyerPreuve(t, app, jeu.CourseID, `{
		"nom_receptionnaire": "Awa Ouédraogo",
		"type_media": "signature",
		"media_mime": "image/png",
		"media_base64": "`+pngMinimal+`"
	}`)
	if code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d, attendu 204 (%s)", code, corps)
	}

	code, fiche := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+"/preuve")
	if code != fiber.StatusOK {
		t.Fatalf("lecture = %d, attendu 200", code)
	}
	if fiche["nom_receptionnaire"] != "Awa Ouédraogo" {
		t.Errorf("nom = %v", fiche["nom_receptionnaire"])
	}
	if fiche["type_media"] != "signature" {
		t.Errorf("type = %v", fiche["type_media"])
	}
	// L'image ne voyage pas dans la fiche : la joindre gonflerait chaque
	// chargement de reçu de la taille de la photo, relue à chaque ouverture.
	if _, present := fiche["media_base64"]; present {
		t.Error("la fiche ne doit pas porter l'image elle-même")
	}
}

func TestPreuve_LImageSeRecupereTelleQuelle(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	if code, corps := envoyerPreuve(t, app, jeu.CourseID, `{
		"type_media": "photo", "media_mime": "image/png", "media_base64": "`+pngMinimal+`"
	}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	rep, err := app.Test(httptest.NewRequest(http.MethodGet,
		"/api/courses/"+jeu.CourseID.String()+"/preuve/media", nil), 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	if rep.StatusCode != fiber.StatusOK {
		t.Fatalf("statut = %d", rep.StatusCode)
	}
	if ct := rep.Header.Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, attendu image/png", ct)
	}
	// Sans `nosniff`, un navigateur pourrait deviner un autre type que celui
	// annoncé et interpréter le contenu au lieu de l'afficher.
	if rep.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("l'image doit être servie avec X-Content-Type-Options: nosniff")
	}

	recu, _ := io.ReadAll(rep.Body)
	attendu, _ := base64.StdEncoding.DecodeString(pngMinimal)
	if !bytes.Equal(recu, attendu) {
		t.Errorf("l'image rendue diffère de celle déposée (%d vs %d octets)", len(recu), len(attendu))
	}
}

func TestPreuve_NeSeRemplacePas(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	premier := `{"nom_receptionnaire": "Awa Ouédraogo"}`
	if code, corps := envoyerPreuve(t, app, jeu.CourseID, premier); code != fiber.StatusNoContent {
		t.Fatalf("premier dépôt = %d (%s)", code, corps)
	}

	// Le cœur du point : une pièce qu'on peut remplacer après coup ne prouve
	// rien. Un second envoi est refusé, pas appliqué en silence.
	code, _ := envoyerPreuve(t, app, jeu.CourseID, `{"nom_receptionnaire": "Quelqu'un d'autre"}`)
	if code != fiber.StatusConflict {
		t.Errorf("second dépôt = %d, attendu 409", code)
	}

	_, fiche := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+"/preuve")
	if fiche["nom_receptionnaire"] != "Awa Ouédraogo" {
		t.Errorf("la preuve d'origine a été altérée : %v", fiche["nom_receptionnaire"])
	}
}

func TestPreuve_LaBaseRefuseTouteModification(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	if code, corps := envoyerPreuve(t, app, jeu.CourseID,
		`{"nom_receptionnaire": "Awa Ouédraogo"}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	// La garantie est portée par la base et non par une convention de code :
	// une convention ne survit pas au premier script de correction lancé à la
	// main, et le 409 du handler ne protège que le chemin HTTP.
	_, err := pool.Exec(context.Background(),
		`UPDATE preuves_livraison SET nom_receptionnaire = 'Falsifié' WHERE course_id = $1`,
		jeu.CourseID)
	if err == nil {
		t.Fatal("la base doit refuser toute modification d'une preuve")
	}
}

func TestPreuve_UnLivreurNonAssigneEstRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)

	// Le cas dangereux n'est pas l'inconnu : c'est le collègue de la même
	// compagnie, qui a un jeton valide et pourrait deviner un identifiant.
	autre := jeu.AutreLivreu
	app := appPreuve(&Deps{DB: pool}, &middleware.Claims{
		Role: models.RoleLivreur, LivreurID: &autre,
	})

	code, _ := envoyerPreuve(t, app, jeu.CourseID, `{"nom_receptionnaire": "Awa"}`)
	if code != fiber.StatusForbidden {
		t.Errorf("dépôt = %d, attendu 403", code)
	}
}

func TestPreuve_PasAvantLaRemise(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	// La course est « assignee » : le colis n'est même pas récupéré. Une preuve
	// de remise à ce stade ne décrirait rien qui ait eu lieu.
	code, _ := envoyerPreuve(t, app, jeu.CourseID, `{"nom_receptionnaire": "Awa"}`)
	if code != fiber.StatusConflict {
		t.Errorf("dépôt depuis « assignee » = %d, attendu 409", code)
	}

	// « en route » est accepté : le livreur est à la porte, et l'ordre des deux
	// appels dépend de quel réseau passe en premier.
	enRoute(t, pool, jeu.CourseID, models.CourseEnRoute)
	if code, corps := envoyerPreuve(t, app, jeu.CourseID,
		`{"nom_receptionnaire": "Awa"}`); code != fiber.StatusNoContent {
		t.Errorf("dépôt depuis « en_route » = %d, attendu 204 (%s)", code, corps)
	}
}

func TestPreuve_RefusEntreesInvalides(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	// 512 Ko : au-delà, c'est que le redimensionnement côté appareil n'a pas eu
	// lieu. Le dire vaut mieux que de faire transiter deux mégaoctets.
	trop := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x89}, tailleMaxPreuve+1))

	cas := []struct {
		nom     string
		corps   string
		attendu int
	}{
		{"preuve vide", `{}`, fiber.StatusBadRequest},
		{"nom d'espaces seulement", `{"nom_receptionnaire": "   "}`, fiber.StatusBadRequest},
		{"type inconnu", `{"type_media": "video", "media_mime": "image/png", "media_base64": "` + pngMinimal + `"}`, fiber.StatusBadRequest},
		{"mime hors allowlist", `{"type_media": "photo", "media_mime": "text/html", "media_base64": "` + pngMinimal + `"}`, fiber.StatusBadRequest},
		{"base64 illisible", `{"type_media": "photo", "media_mime": "image/png", "media_base64": "pas du base64 !!"}`, fiber.StatusBadRequest},
		{"image trop lourde", `{"type_media": "photo", "media_mime": "image/png", "media_base64": "` + trop + `"}`, fiber.StatusRequestEntityTooLarge},
	}

	for _, c := range cas {
		t.Run(c.nom, func(t *testing.T) {
			code, corps := envoyerPreuve(t, app, jeu.CourseID, c.corps)
			if code != c.attendu {
				t.Errorf("statut = %d, attendu %d (%s)", code, c.attendu, corps)
			}
		})
	}
}

func TestPreuve_UneHorlogeEnAvanceNeDatePasDeDemain(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	futur := time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
	if code, corps := envoyerPreuve(t, app, jeu.CourseID,
		`{"nom_receptionnaire": "Awa", "capture_le": "`+futur+`"}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	_, fiche := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+"/preuve")
	capture, err := time.Parse(time.RFC3339Nano, fiche["capture_le"].(string))
	if err != nil {
		t.Fatalf("horodatage illisible: %v", err)
	}
	// Une capture antérieure serait prise telle quelle — c'est le cas normal
	// d'un envoi différé. Une capture future vient d'une horloge déréglée et
	// ferait dater la signature de demain sur un document imprimé.
	if capture.After(time.Now().UTC().Add(time.Hour)) {
		t.Errorf("capture_le = %s : une date future ne doit pas être retenue", capture)
	}
}

func TestPreuve_UneCaptureAnterieureEstConservee(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	app := appPreuve(&Deps{DB: pool}, claimsLivreur(jeu))

	// Le cas courant du terrain : la signature est prise à la porte, l'envoi
	// part une heure plus tard quand le réseau revient. Le document doit dire
	// l'heure de la porte.
	passe := time.Now().UTC().Add(-90 * time.Minute).Truncate(time.Second)
	if code, corps := envoyerPreuve(t, app, jeu.CourseID,
		`{"nom_receptionnaire": "Awa", "capture_le": "`+passe.Format(time.RFC3339)+`"}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	_, fiche := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+"/preuve")
	capture, _ := time.Parse(time.RFC3339Nano, fiche["capture_le"].(string))
	if !capture.UTC().Truncate(time.Second).Equal(passe) {
		t.Errorf("capture_le = %s, attendu %s", capture.UTC(), passe)
	}

	// `recue_le` reste l'instant du serveur : confondre les deux ferait perdre
	// l'information « cette preuve est arrivée avec du retard ».
	recue, _ := time.Parse(time.RFC3339Nano, fiche["recue_le"].(string))
	if !recue.After(capture) {
		t.Errorf("recue_le (%s) doit suivre capture_le (%s)", recue, capture)
	}
}

func TestPreuve_LePartenaireNeVoitJamaisLeLivreur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireID := partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	deps := &Deps{DB: pool}

	if code, corps := envoyerPreuve(t, appPreuve(deps, claimsLivreur(jeu)), jeu.CourseID,
		`{"nom_receptionnaire": "Awa Ouédraogo"}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	appPartenaire := appPreuve(deps, &middleware.Claims{
		Role: models.RolePartenaire, PartenaireID: &partenaireID,
	})

	code, fiche := lireJSON(t, appPartenaire, "/api/courses/"+jeu.CourseID.String()+"/preuve")
	if code != fiber.StatusOK {
		t.Fatalf("le partenaire doit pouvoir lire la preuve de sa commande : %d", code)
	}
	if _, present := fiche["livreur_nom"]; present {
		t.Errorf("la preuve du partenaire ne doit pas nommer le livreur : %v", fiche["livreur_nom"])
	}

	// Contrôle inverse : sans lui, un handler qui ne lirait jamais le nom
	// passerait le test précédent sans rien prouver.
	appCompagnie := appPreuve(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	_, fiche = lireJSON(t, appCompagnie, "/api/courses/"+jeu.CourseID.String()+"/preuve")
	if fiche["livreur_nom"] == nil {
		t.Error("la preuve de la compagnie doit nommer le livreur")
	}
}

func TestPreuve_UnTiersEstRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	deps := &Deps{DB: pool}

	if code, _ := envoyerPreuve(t, appPreuve(deps, claimsLivreur(jeu)), jeu.CourseID,
		`{"nom_receptionnaire": "Awa"}`); code != fiber.StatusNoContent {
		t.Fatal("dépôt initial échoué")
	}

	var autreCompagnie uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		"Concurrente "+uuid.NewString()[:8]).Scan(&autreCompagnie); err != nil {
		t.Fatalf("seconde compagnie: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM compagnies WHERE id = $1`, autreCompagnie)
	})

	app := appPreuve(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &autreCompagnie,
	})

	// « introuvable » et non « accès refusé » : les distinguer apprendrait
	// qu'une course existe sous cet identifiant.
	for _, chemin := range []string{"/preuve", "/preuve/media"} {
		code, _ := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+chemin)
		if code != fiber.StatusNotFound {
			t.Errorf("%s = %d, attendu 404", chemin, code)
		}
	}
}

func TestPreuve_UnPartenaireVoisinNAtteintPasLImage(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	deps := &Deps{DB: pool}

	if code, corps := envoyerPreuve(t, appPreuve(deps, claimsLivreur(jeu)), jeu.CourseID,
		`{"type_media": "signature", "media_mime": "image/png", "media_base64": "`+pngMinimal+`"}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	// Une seconde entreprise cliente **de la même compagnie**. Son jeton porte
	// donc le même `compagnie_id` que la course visée : un contrôle qui se
	// fierait à la présence de ce claim la laisserait passer, alors qu'elle est
	// une concurrente servie par le même transporteur.
	var voisin uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO partenaires (compagnie_id, nom) VALUES ($1, $2) RETURNING id
	`, jeu.CompagnieID, "Voisin "+uuid.NewString()[:8]).Scan(&voisin); err != nil {
		t.Fatalf("partenaire voisin: %v", err)
	}

	compagnie := jeu.CompagnieID
	app := appPreuve(deps, &middleware.Claims{
		Role:         models.RolePartenaire,
		PartenaireID: &voisin,
		CompagnieID:  &compagnie,
	})

	for _, chemin := range []string{"/preuve", "/preuve/media"} {
		code, _ := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+chemin)
		if code != fiber.StatusNotFound {
			t.Errorf("%s = %d, attendu 404", chemin, code)
		}
	}
}

func TestPreuve_FigureSurLeRecuDesDeuxCotes(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireID := partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	enRoute(t, pool, jeu.CourseID, models.CourseLivree)
	deps := &Deps{DB: pool}

	if code, corps := envoyerPreuve(t, appPreuve(deps, claimsLivreur(jeu)), jeu.CourseID,
		`{"nom_receptionnaire": "Awa Ouédraogo", "type_media": "signature",
		  "media_mime": "image/png", "media_base64": "`+pngMinimal+`"}`); code != fiber.StatusNoContent {
		t.Fatalf("dépôt = %d (%s)", code, corps)
	}

	appCompagnie := appPreuve(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	_, recuC := lireJSON(t, appCompagnie, "/api/courses/"+jeu.CourseID.String()+"/recu")
	preuveC, _ := recuC["preuve"].(map[string]any)
	if preuveC == nil {
		t.Fatal("le reçu de la compagnie doit porter la preuve")
	}
	if preuveC["nom_receptionnaire"] != "Awa Ouédraogo" {
		t.Errorf("nom sur le reçu = %v", preuveC["nom_receptionnaire"])
	}
	if preuveC["livreur_nom"] == nil {
		t.Error("la compagnie doit voir qui a recueilli la preuve")
	}

	appPartenaire := appPreuve(deps, &middleware.Claims{
		Role: models.RolePartenaire, PartenaireID: &partenaireID,
	})
	_, recuP := lireJSON(t, appPartenaire, "/api/commandes/"+jeu.CourseID.String()+"/recu")
	preuveP, _ := recuP["preuve"].(map[string]any)
	if preuveP == nil {
		t.Fatal("le reçu du partenaire doit porter la preuve")
	}
	// La preuve suit la même frontière que le reste du reçu : le partenaire
	// apprend que le colis a été remis et à qui, jamais par qui.
	if _, present := preuveP["livreur_nom"]; present {
		t.Errorf("le reçu du partenaire ne doit pas nommer le livreur : %v", preuveP["livreur_nom"])
	}
}

func TestPreuve_UnRecuSansPreuveNEstPasUneErreur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	app := appPreuve(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	code, recu := lireJSON(t, app, "/api/courses/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}
	// La remise n'est pas conditionnée à une signature : exiger une preuve
	// bloquerait un livreur dont l'écran ne prend pas le tracé, et créerait
	// surtout une incitation à la fabriquer.
	if _, present := recu["preuve"]; present {
		t.Errorf("absence de preuve : le champ doit être omis, pas nul — %v", recu["preuve"])
	}
}
