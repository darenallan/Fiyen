package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// Le rejeu du trajet se reconstitue en croisant deux tables qui ne se
// connaissent pas l'une l'autre : `traces_positions` (rattachée au livreur)
// et les bornes du journal (rattachées à la course). Les tests portent donc
// surtout sur cette jointure temporelle — ce qui entre dans la fenêtre, ce qui
// en sort, ce qui n'a pas de fenêtre du tout.

func appTrajet(deps *Deps, claims *middleware.Claims) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("claims", claims)
		return c.Next()
	})
	app.Get("/api/courses/:id/trajet", deps.TrajetCourse)
	app.Get("/api/commandes/:id/trajet", deps.TrajetCommande)
	return app
}

func lireTrajet(t *testing.T, app *fiber.App, chemin string) (int, Trajet) {
	t.Helper()
	rep, err := app.Test(httptest.NewRequest(http.MethodGet, chemin, nil), 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	var trajet Trajet
	if rep.StatusCode == fiber.StatusOK {
		if err := json.NewDecoder(rep.Body).Decode(&trajet); err != nil {
			t.Fatalf("décodage: %v", err)
		}
	}
	return rep.StatusCode, trajet
}

// deposerTrace insère un point directement, sans passer par `internal/tracking`
// (qui exige Redis) : ce qu'on teste ici est la lecture croisée, pas le dépôt.
func deposerTrace(t *testing.T, pool *pgxpool.Pool, livreurID uuid.UUID, lat, lon float64, horodatage time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO traces_positions (livreur_id, position, horodatage)
		VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
	`, livreurID, lon, lat, horodatage); err != nil {
		t.Fatalf("dépôt de trace: %v", err)
	}
}

// journaliserEvt pose un évènement à un instant choisi, en insérant
// directement plutôt qu'en passant par `journaliser` (qui horodate avec
// `now()`, non ajustable) puis un `UPDATE` — que le trigger d'immuabilité de
// 5.1 refuse justement de laisser passer. Les tests ont besoin de bornes
// précises et parfois passées ; l'immuabilité, elle, doit rester entière.
func journaliserEvt(t *testing.T, pool *pgxpool.Pool, courseID uuid.UUID, typeEvt string, quand time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO evenements_course (course_id, type, created_at) VALUES ($1, $2, $3)
	`, courseID, typeEvt, quand); err != nil {
		t.Fatalf("pose de l'évènement: %v", err)
	}
}

func TestTrajet_NeGardeQueLesPointsEntreAssigneeEtLivree(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	base := time.Now().Add(-time.Hour).Truncate(time.Second)
	journaliserEvt(t, pool, jeu.CourseID, EvtJournalAssignee, base)
	journaliserEvt(t, pool, jeu.CourseID, EvtJournalLivree, base.Add(20*time.Minute))

	// Avant l'assignation : le livreur pouvait être en service sur une autre
	// affaire, ou simplement en route vers son point de départ à lui.
	deposerTrace(t, pool, jeu.LivreurID, 12.30, -1.50, base.Add(-5*time.Minute))
	// Dans la fenêtre : les points qui comptent.
	deposerTrace(t, pool, jeu.LivreurID, 12.31, -1.51, base.Add(5*time.Minute))
	deposerTrace(t, pool, jeu.LivreurID, 12.32, -1.52, base.Add(10*time.Minute))
	// Après la livraison : le livreur est reparti vers autre chose.
	deposerTrace(t, pool, jeu.LivreurID, 12.33, -1.53, base.Add(30*time.Minute))

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	code, trajet := lireTrajet(t, app, "/api/courses/"+jeu.CourseID.String()+"/trajet")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}
	if len(trajet.Points) != 2 {
		t.Fatalf("attendu 2 points dans la fenêtre, obtenu %d : %+v", len(trajet.Points), trajet.Points)
	}
	if trajet.Points[0].Latitude != 12.31 || trajet.Points[1].Latitude != 12.32 {
		t.Errorf("mauvais points retenus : %+v", trajet.Points)
	}
	// L'ordre chronologique est ce qui fait un trajet et non un nuage de points.
	if !trajet.Points[0].Horodatage.Before(trajet.Points[1].Horodatage) {
		t.Errorf("points pas dans l'ordre chronologique : %+v", trajet.Points)
	}
}

func TestTrajet_UneCourseSansLivreurNaPasDePoints(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	// Décor délibérément non assigné : `CreerJeu` livre une course déjà
	// assignée, on la ramène donc à l'état initial pour ce cas précis.
	if _, err := pool.Exec(context.Background(),
		`UPDATE courses SET livreur_id = NULL, statut = 'en_attente' WHERE id = $1`,
		jeu.CourseID); err != nil {
		t.Fatalf("préparation: %v", err)
	}

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	code, trajet := lireTrajet(t, app, "/api/courses/"+jeu.CourseID.String()+"/trajet")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200 (l'absence de livreur n'est pas une erreur)", code)
	}
	if trajet.Points == nil {
		t.Error("Points doit être un tableau vide, pas nul")
	}
	if len(trajet.Points) != 0 {
		t.Errorf("attendu 0 point, obtenu %d", len(trajet.Points))
	}
}

func TestTrajet_UneCourseEnCoursVaJusquAMaintenant(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	base := time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	journaliserEvt(t, pool, jeu.CourseID, EvtJournalAssignee, base)
	// Pas de « livree » : la course est encore en route.

	deposerTrace(t, pool, jeu.LivreurID, 12.31, -1.51, base.Add(2*time.Minute))
	deposerTrace(t, pool, jeu.LivreurID, 12.32, -1.52, time.Now().Add(-time.Minute))

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	_, trajet := lireTrajet(t, app, "/api/courses/"+jeu.CourseID.String()+"/trajet")

	// Sans borne de fin, la fenêtre doit rester ouverte jusqu'à maintenant :
	// une course en cours doit montrer tout ce qui a déjà été parcouru, pas
	// seulement le premier point.
	if len(trajet.Points) != 2 {
		t.Errorf("attendu 2 points pour une course en cours, obtenu %d", len(trajet.Points))
	}
}

func TestTrajet_LesPointsDunAutreLivreurNyFigurentPas(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	base := time.Now().Add(-time.Hour).Truncate(time.Second)
	journaliserEvt(t, pool, jeu.CourseID, EvtJournalAssignee, base)
	journaliserEvt(t, pool, jeu.CourseID, EvtJournalLivree, base.Add(20*time.Minute))

	deposerTrace(t, pool, jeu.LivreurID, 12.31, -1.51, base.Add(5*time.Minute))
	// Un second livreur de la même compagnie, actif exactement dans la même
	// fenêtre temporelle : le cas dangereux n'est pas l'absence de bornes,
	// c'est un autre trajet qui se déroule au même moment.
	deposerTrace(t, pool, jeu.AutreLivreu, 9.99, -9.99, base.Add(6*time.Minute))

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	_, trajet := lireTrajet(t, app, "/api/courses/"+jeu.CourseID.String()+"/trajet")

	if len(trajet.Points) != 1 {
		t.Fatalf("attendu 1 point, obtenu %d : %+v", len(trajet.Points), trajet.Points)
	}
	if trajet.Points[0].Latitude == 9.99 {
		t.Error("le point d'un autre livreur a fuité dans le trajet")
	}
}

func TestTrajet_UnAutrePartenaireEstRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	deps := &Deps{DB: pool}

	var voisin uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO partenaires (compagnie_id, nom) VALUES ($1, $2) RETURNING id
	`, jeu.CompagnieID, "Voisin "+uuid.NewString()[:8]).Scan(&voisin); err != nil {
		t.Fatalf("partenaire voisin: %v", err)
	}

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RolePartenaire, PartenaireID: &voisin,
	})
	code, _ := lireTrajet(t, app, "/api/commandes/"+jeu.CourseID.String()+"/trajet")
	if code != fiber.StatusNotFound {
		t.Errorf("statut = %d, attendu 404", code)
	}
}

func TestTrajet_LesEpinglesDepartEtArriveeSontReprisesQuandPosees(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	if _, err := pool.Exec(context.Background(), `
		UPDATE courses SET
			point_depart = ST_SetSRID(ST_MakePoint(-1.50, 12.30), 4326)::geography,
			point_arrivee = ST_SetSRID(ST_MakePoint(-1.55, 12.35), 4326)::geography
		WHERE id = $1
	`, jeu.CourseID); err != nil {
		t.Fatalf("pose des épingles: %v", err)
	}

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	_, trajet := lireTrajet(t, app, "/api/courses/"+jeu.CourseID.String()+"/trajet")

	if trajet.PointDepart == nil || trajet.PointDepart.Latitude != 12.30 {
		t.Errorf("épingle de départ manquante ou fausse : %+v", trajet.PointDepart)
	}
	if trajet.PointArrivee == nil || trajet.PointArrivee.Longitude != -1.55 {
		t.Errorf("épingle d'arrivée manquante ou fausse : %+v", trajet.PointArrivee)
	}
}

func TestTrajet_SansEpinglesLesChampsSontOmis(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}

	app := appTrajet(deps, &middleware.Claims{
		Role: models.RoleCompagnie, CompagnieID: &jeu.CompagnieID,
	})
	code, trajet := lireTrajet(t, app, "/api/courses/"+jeu.CourseID.String()+"/trajet")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}
	// `testdb.CreerJeu` ne pose pas d'épingles : l'adresse en texte libre est le
	// cas courant (voir CLAUDE.md), le point GPS restant facultatif.
	if trajet.PointDepart != nil || trajet.PointArrivee != nil {
		t.Errorf("des épingles sont apparues sans avoir été posées : %+v / %+v", trajet.PointDepart, trajet.PointArrivee)
	}
}
