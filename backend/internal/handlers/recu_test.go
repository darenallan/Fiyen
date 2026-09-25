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
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// Un reçu est le seul endroit du produit où une donnée quitte l'écran pour du
// papier. Ce qui s'y imprime ne se rattrape pas : d'où des tests qui portent
// moins sur le rendu que sur ce qui n'a pas le droit d'y figurer.

// partenaireJetable rattache une entreprise cliente à la compagnie du décor, et
// lui attribue la course. `CreerJeu` fabrique une course de compagnie ; un reçu
// de partenaire en a besoin d'une qui soit la sienne.
func partenaireJetable(t *testing.T, pool *pgxpool.Pool, compagnieID, courseID uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	suffixe := uuid.NewString()[:8]

	var partenaireID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO partenaires (compagnie_id, nom) VALUES ($1, $2) RETURNING id
	`, compagnieID, "Boulangerie test "+suffixe).Scan(&partenaireID); err != nil {
		t.Fatalf("partenaire: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE courses SET partenaire_id = $2 WHERE id = $1`, courseID, partenaireID); err != nil {
		t.Fatalf("rattachement de la course: %v", err)
	}
	return partenaireID
}

// appRecu monte les deux routes en injectant les claims voulus, sans passer par
// un vrai JWT : ce qu'on teste est le handler, pas l'authentification.
func appRecu(deps *Deps, claims *middleware.Claims) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("claims", claims)
		return c.Next()
	})
	app.Get("/api/courses/:id/recu", deps.RecuCourse)
	app.Get("/api/commandes/:id/recu", deps.RecuCommande)
	return app
}

// lireRecu appelle une route et rend le code et le corps décodé en carte.
// Décoder en `map` plutôt qu'en `Recu` est délibéré : un champ absent de la
// structure Go serait invisible, alors que c'est précisément l'absence d'un
// champ dans le JSON qu'on veut prouver.
func lireRecu(t *testing.T, app *fiber.App, chemin string) (int, map[string]any) {
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

func TestRecu_LePartenaireNeVoitJamaisLeLivreur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireID := partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)
	deps := &Deps{DB: pool}

	// La course du décor a un livreur assigné : sans cela le test passerait au
	// vert parce qu'il n'y a rien à masquer, ce qui ne prouverait rien.
	app := appRecu(deps, &middleware.Claims{
		Role:         models.RolePartenaire,
		PartenaireID: &partenaireID,
	})

	code, corps := lireRecu(t, app, "/api/commandes/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}
	if _, present := corps["livreur_nom"]; present {
		t.Errorf("le reçu du partenaire ne doit pas nommer le livreur : %v", corps["livreur_nom"])
	}

	// Contrôle inverse : la même course, lue par la compagnie, le nomme. Sans
	// lui, un handler qui ne lirait jamais le livreur passerait le test
	// précédent sans que la frontière soit réellement franchissable nulle part.
	appCompagnie := appRecu(deps, &middleware.Claims{
		Role:        models.RoleCompagnie,
		CompagnieID: &jeu.CompagnieID,
	})
	code, corps = lireRecu(t, appCompagnie, "/api/courses/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusOK {
		t.Fatalf("statut compagnie = %d, attendu 200", code)
	}
	if corps["livreur_nom"] == nil {
		t.Error("le reçu de la compagnie doit nommer le livreur")
	}
}

func TestRecu_UnAutrePartenaireEstRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	partenaireJetable(t, pool, jeu.CompagnieID, jeu.CourseID)

	// Un second partenaire de la **même** compagnie : le cas dangereux n'est pas
	// l'inconnu, c'est le voisin légitime qui devine un identifiant.
	var autre uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO partenaires (compagnie_id, nom) VALUES ($1, $2) RETURNING id
	`, jeu.CompagnieID, "Voisin "+uuid.NewString()[:8]).Scan(&autre); err != nil {
		t.Fatalf("second partenaire: %v", err)
	}

	app := appRecu(&Deps{DB: pool}, &middleware.Claims{
		Role:         models.RolePartenaire,
		PartenaireID: &autre,
	})

	code, _ := lireRecu(t, app, "/api/commandes/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusNotFound {
		t.Errorf("statut = %d, attendu 404", code)
	}
}

func TestRecu_UneAutreCompagnieEstRefusee(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	var autre uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		"Concurrente "+uuid.NewString()[:8]).Scan(&autre); err != nil {
		t.Fatalf("seconde compagnie: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM compagnies WHERE id = $1`, autre)
	})

	app := appRecu(&Deps{DB: pool}, &middleware.Claims{
		Role:        models.RoleCompagnie,
		CompagnieID: &autre,
	})

	code, _ := lireRecu(t, app, "/api/courses/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusNotFound {
		t.Errorf("statut = %d, attendu 404", code)
	}
}

func TestRecu_PorteLeNumeroDeLaCourseEtSonJournal(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("transaction: %v", err)
	}
	journaliser(ctx, tx, jeu.CourseID, EvtJournalCreee, nil, nil)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalLivree, nil, nil)
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	app := appRecu(deps, &middleware.Claims{
		Role:        models.RoleCompagnie,
		CompagnieID: &jeu.CompagnieID,
	})
	code, corps := lireRecu(t, app, "/api/courses/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}

	// Pas de numérotation propre au reçu : celle de la course suffit, et une
	// seconde obligerait à demander « lequel des deux ? » à chaque appel.
	numero, _ := corps["numero"].(string)
	if !strings.HasPrefix(numero, "FY-") {
		t.Errorf("numero = %q, attendu le numéro court de la course", numero)
	}

	// Le journal est ce qui distingue un reçu d'une fiche : sans lui le document
	// dirait « livrée » sans dire quand.
	journal, _ := corps["journal"].([]any)
	if len(journal) != 2 {
		t.Fatalf("journal = %d entrée(s), attendu 2", len(journal))
	}

	// `emis_le` doit être postérieur à `cree_le` : il dit quand la copie a été
	// tirée, pas quand la course est née. Les confondre ferait passer deux
	// impressions pour le même document.
	creeLe, errC := time.Parse(time.RFC3339Nano, corps["cree_le"].(string))
	emisLe, errE := time.Parse(time.RFC3339Nano, corps["emis_le"].(string))
	if errC != nil || errE != nil {
		t.Fatalf("horodatages illisibles: %v / %v", errC, errE)
	}
	if !emisLe.After(creeLe) {
		t.Errorf("emis_le (%s) doit suivre cree_le (%s)", emisLe, creeLe)
	}
}

func TestRecu_NePorteAucunMontant(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	app := appRecu(&Deps{DB: pool}, &middleware.Claims{
		Role:        models.RoleCompagnie,
		CompagnieID: &jeu.CompagnieID,
	})
	code, corps := lireRecu(t, app, "/api/courses/"+jeu.CourseID.String()+"/recu")
	if code != fiber.StatusOK {
		t.Fatalf("statut = %d, attendu 200", code)
	}

	// `config_tarifaire` porte un abonnement et une commission, pas un tarif par
	// course : il n'y a rien à calculer. Ce test est là pour qu'un futur champ
	// « montant » soit une décision prise, et non un ajout machinal — sur un
	// document qui sert de justificatif, un chiffre inventé est pire qu'aucun.
	interdits := []string{"montant", "prix", "total", "tarif", "commission", "frais"}
	for cle := range corps {
		for _, mot := range interdits {
			if strings.Contains(strings.ToLower(cle), mot) {
				t.Errorf("le reçu porte un champ monétaire %q : aucun barème par course n'existe", cle)
			}
		}
	}
}
