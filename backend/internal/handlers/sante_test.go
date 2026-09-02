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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"fiyen-backend/internal/testdb"
)

// Le point de contrôle doit dire la vérité, y compris quand elle est mauvaise.
// L'ancienne version répondait 200 avec Postgres à terre ; ces tests
// garantissent qu'on ne revient pas à un feu vert de principe.

// appTest monte les deux routes sur une application jetable et rend le corps
// et le code de la réponse.
func appelSante(t *testing.T, deps *Deps, chemin string) (int, string) {
	t.Helper()

	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Get("/health", deps.Sante)
	app.Get("/health/live", deps.Vivant)

	// Fiber v2 prend le délai en millisecondes. Généreux : il doit couvrir la
	// sonde (2 s) plus la latence d'une machine chargée, sinon le test échoue
	// pour une raison qui n'a rien à voir avec ce qu'il vérifie.
	rep, err := app.Test(httptest.NewRequest(http.MethodGet, chemin, nil), 8000)
	if err != nil {
		t.Fatalf("appel %s: %v", chemin, err)
	}
	defer rep.Body.Close()

	corps, err := io.ReadAll(rep.Body)
	if err != nil {
		t.Fatalf("lecture du corps: %v", err)
	}
	return rep.StatusCode, string(corps)
}

// depsMortes construit des dépendances pointant vers des adresses où rien
// n'écoute. C'est ce qui permet de tester la panne sans arrêter les conteneurs
// — un test qui exigerait `docker compose stop` ne serait jamais rejoué.
func depsMortes(t *testing.T, postgresVivant, redisVivant bool) *Deps {
	t.Helper()

	var pool *pgxpool.Pool
	if postgresVivant {
		pool = testdb.Ouvrir(t)
	} else {
		// Port 1 : réservé, rien n'y écoute jamais.
		p, err := pgxpool.New(context.Background(),
			"postgres://absent:absent@127.0.0.1:1/absent?sslmode=disable")
		if err != nil {
			t.Fatalf("pool mort: %v", err)
		}
		pool = p
		t.Cleanup(p.Close)
	}

	var rdb *redis.Client
	if redisVivant {
		rdb = testdb.OuvrirRedis(t)
	} else {
		rdb = redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
		t.Cleanup(func() { _ = rdb.Close() })
	}

	return &Deps{DB: pool, Redis: rdb}
}

func decoder(t *testing.T, corps string) reponseSante {
	t.Helper()
	var rep reponseSante
	if err := json.Unmarshal([]byte(corps), &rep); err != nil {
		t.Fatalf("réponse illisible (%s): %v", corps, err)
	}
	return rep
}

func etatDe(rep reponseSante, service string) (EtatService, bool) {
	for _, s := range rep.Services {
		if s.Service == service {
			return s, true
		}
	}
	return EtatService{}, false
}

// --- Cas nominal ----------------------------------------------------------

func TestSante_ToutRepond(t *testing.T) {
	deps := depsMortes(t, true, true)

	code, corps := appelSante(t, deps, "/health")
	if code != http.StatusOK {
		t.Fatalf("code = %d, attendu 200 (%s)", code, corps)
	}

	rep := decoder(t, corps)
	if rep.Statut != "ok" {
		t.Errorf("statut = %q, attendu \"ok\"", rep.Statut)
	}

	// Les deux dépendances doivent être nommées même quand tout va bien :
	// c'est ce qui permet de voir d'un coup d'œil ce qui est réellement sondé.
	for _, service := range []string{"postgres", "redis"} {
		etat, present := etatDe(rep, service)
		if !present {
			t.Errorf("%s absent de la réponse: %s", service, corps)
			continue
		}
		if !etat.OK {
			t.Errorf("%s devrait répondre", service)
		}
		if etat.Latence == "" {
			t.Errorf("%s : la latence manque, elle sert à repérer une base qui rame", service)
		}
	}
}

// --- Pannes ---------------------------------------------------------------

func TestSante_PostgresTombe(t *testing.T) {
	deps := depsMortes(t, false, true)

	code, corps := appelSante(t, deps, "/health")

	// 503 et non 500 : le service n'est pas cassé, il est indisponible parce
	// qu'une dépendance l'est. Un répartiteur de charge sait quoi en faire.
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, attendu 503 (%s)", code, corps)
	}

	rep := decoder(t, corps)
	if rep.Statut != "degrade" {
		t.Errorf("statut = %q, attendu \"degrade\"", rep.Statut)
	}

	// Le cœur du point : **nommer** le service en défaut. Un 503 nu obligerait
	// à deviner lequel des deux est tombé.
	postgres, _ := etatDe(rep, "postgres")
	if postgres.OK {
		t.Error("postgres est injoignable et doit être signalé comme tel")
	}

	redis, _ := etatDe(rep, "redis")
	if !redis.OK {
		t.Error("redis répond : une panne ne doit pas contaminer le verdict de l'autre")
	}
}

func TestSante_RedisTombe(t *testing.T) {
	deps := depsMortes(t, true, false)

	code, corps := appelSante(t, deps, "/health")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, attendu 503 (%s)", code, corps)
	}

	rep := decoder(t, corps)
	redis, _ := etatDe(rep, "redis")
	if redis.OK {
		t.Error("redis est injoignable et doit être signalé comme tel")
	}
	postgres, _ := etatDe(rep, "postgres")
	if !postgres.OK {
		t.Error("postgres répond et doit rester marqué comme tel")
	}
}

func TestSante_NeFuitPasLesIdentifiants(t *testing.T) {
	deps := depsMortes(t, false, false)

	_, corps := appelSante(t, deps, "/health")

	// `/health` est public. Le message d'erreur de pgx contient l'utilisateur,
	// la base et l'hôte — le reprendre tel quel les afficherait à tout venant.
	for _, interdit := range []string{"user=", "database=", "password", "absent", "127.0.0.1", "dial tcp"} {
		if strings.Contains(corps, interdit) {
			t.Errorf("la réponse expose %q : %s", interdit, corps)
		}
	}
}

// --- Délai ----------------------------------------------------------------

func TestSante_RepondMalgreUneDependanceMuette(t *testing.T) {
	deps := depsMortes(t, false, false)

	// Un point de contrôle qui pend est pire qu'un point de contrôle qui
	// échoue : l'orchestrateur attend au lieu de retirer l'instance.
	debut := time.Now()
	code, _ := appelSante(t, deps, "/health")
	ecoule := time.Since(debut)

	if code != http.StatusServiceUnavailable {
		t.Errorf("code = %d, attendu 503", code)
	}
	// Les deux sondes tournent en parallèle : le total doit rester dans
	// l'enveloppe d'une seule, avec de la marge pour une machine chargée.
	if ecoule > delaiSonde+2*time.Second {
		t.Errorf("réponse en %s, au-delà du délai de sonde (%s)", ecoule, delaiSonde)
	}
}

// --- Cache ----------------------------------------------------------------

func TestSante_CacheEviteDeMartelerLaBase(t *testing.T) {
	deps := depsMortes(t, true, true)

	_, premier := appelSante(t, deps, "/health")
	_, second := appelSante(t, deps, "/health")

	// L'endpoint n'est pas authentifié : sans cache, le marteler reviendrait à
	// marteler la base. Deux appels rapprochés rendent le même instantané.
	if decoder(t, premier).VerifieA != decoder(t, second).VerifieA {
		t.Error("deux appels rapprochés doivent réutiliser la même sonde")
	}
}

func TestSante_CacheExpire(t *testing.T) {
	deps := depsMortes(t, true, true)

	_, premier := appelSante(t, deps, "/health")
	time.Sleep(dureeCacheSante + 200*time.Millisecond)
	_, second := appelSante(t, deps, "/health")

	// Un cache qui ne périme pas masquerait une panne survenue depuis.
	if decoder(t, premier).VerifieA == decoder(t, second).VerifieA {
		t.Errorf("après %s, une nouvelle sonde doit avoir lieu", dureeCacheSante)
	}
}

// --- Liveness -------------------------------------------------------------

func TestVivant_RepondMemeToutTombe(t *testing.T) {
	deps := depsMortes(t, false, false)

	// Un orchestrateur qui redémarre le service parce que Postgres est tombé
	// ne répare rien et ajoute une panne à la panne. C'est cet endpoint qu'on
	// branche sur la sonde de *liveness*.
	code, corps := appelSante(t, deps, "/health/live")
	if code != http.StatusOK {
		t.Fatalf("code = %d, attendu 200 (%s)", code, corps)
	}
	if !strings.Contains(corps, "vivant") {
		t.Errorf("réponse inattendue: %s", corps)
	}
}
