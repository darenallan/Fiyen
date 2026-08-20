// Package testdb ouvre une connexion vers la base de développement pour les
// tests d'intégration.
//
// Pourquoi une vraie base plutôt que des bouchons : les garanties du masquage
// (qui a le droit de lire quel canal, ce qui reste lisible après expiration,
// l'isolation entre deux conversations) sont portées par les requêtes SQL
// elles-mêmes. Un faux dépôt qui rendrait ce qu'on lui demande validerait le
// test sans rien prouver du produit.
//
// En l'absence de base, les tests s'ignorent au lieu d'échouer : `go test ./...`
// doit rester exécutable sur une machine où le conteneur ne tourne pas.
//
// Ce confort a un revers : une intégration continue mal configurée passerait au
// vert sans rien vérifier. Poser FIYEN_TESTS_INTEGRATION=1 rend alors l'absence
// de base fatale — c'est ce qu'il faudra mettre dans la CI le jour où elle
// existera.
package testdb

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// exigeIntegration rend l'absence de base ou de Redis fatale au lieu de
// silencieuse. Sans cela, une CI mal configurée afficherait un vert trompeur.
func exigeIntegration() bool {
	return os.Getenv("FIYEN_TESTS_INTEGRATION") == "1"
}

// indisponible ignore le test, ou le fait échouer si l'intégration est exigée.
func indisponible(t *testing.T, format string, args ...any) {
	t.Helper()
	if exigeIntegration() {
		t.Fatalf("FIYEN_TESTS_INTEGRATION=1 mais "+format, args...)
	}
	t.Skipf(format, args...)
}

// Ouvrir rend un pool vers la base de développement, ou ignore le test.
func Ouvrir(t *testing.T) *pgxpool.Pool {
	t.Helper()

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = valeurEnv(t, "DATABASE_URL")
	}
	if url == "" {
		indisponible(t, "DATABASE_URL absente et backend/.env introuvable")
	}

	ctx, annuler := context.WithTimeout(context.Background(), 5*time.Second)
	defer annuler()

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		indisponible(t, "base injoignable (%v)", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		indisponible(t, "base injoignable (%v) — lancer `docker compose up -d` dans backend/", err)
	}

	t.Cleanup(pool.Close)
	return pool
}

// valeurEnv remonte l'arborescence jusqu'au .env du backend : `go test`
// s'exécute dans le répertoire du paquet, pas à la racine du module.
func valeurEnv(t *testing.T, cle string) string {
	t.Helper()

	rep, err := os.Getwd()
	if err != nil {
		return ""
	}

	for i := 0; i < 5; i++ {
		chemin := filepath.Join(rep, ".env")
		if _, err := os.Stat(chemin); err == nil {
			vars, err := godotenv.Read(chemin)
			if err != nil {
				return ""
			}
			return vars[cle]
		}
		parent := filepath.Dir(rep)
		if parent == rep {
			break
		}
		rep = parent
	}
	return ""
}

// OuvrirRedis rend un client Redis vers l'instance de développement, ou ignore
// le test. Le canal temps réel du masquage passe par du pub/sub : le tester
// sans Redis reviendrait à ne pas le tester.
func OuvrirRedis(t *testing.T) *redis.Client {
	t.Helper()

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = valeurEnv(t, "REDIS_ADDR")
	}
	if addr == "" {
		addr = "localhost:6379"
	}

	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: valeurEnv(t, "REDIS_PASSWORD"),
	})

	ctx, annuler := context.WithTimeout(context.Background(), 3*time.Second)
	defer annuler()

	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		indisponible(t, "Redis injoignable sur %s (%v) — lancer `docker compose up -d` dans backend/", addr, err)
	}

	t.Cleanup(func() { _ = client.Close() })
	return client
}

// Jeu regroupe les identifiants d'un décor de test isolé.
type Jeu struct {
	CompagnieID uuid.UUID
	ClientID    uuid.UUID
	AutreClient uuid.UUID
	LivreurID   uuid.UUID
	AutreLivreu uuid.UUID
	CourseID    uuid.UUID
	SessionID   uuid.UUID
}

// CreerJeu monte un décor complet : une compagnie, deux clients, deux livreurs,
// une course assignée et sa session de masquage.
//
// Les seconds client et livreur ne sont pas du décorum : ce sont eux qui
// permettent de vérifier qu'un tiers légitime du système reste exclu du canal.
//
// Tout est supprimé en fin de test, y compris en cas d'échec.
func CreerJeu(t *testing.T, pool *pgxpool.Pool, expireAt time.Time) Jeu {
	t.Helper()
	ctx := context.Background()

	var j Jeu
	suffixe := uuid.NewString()[:8]

	exec := func(requete string, dest *uuid.UUID, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, requete, args...).Scan(dest); err != nil {
			t.Fatalf("préparation du décor (%s): %v", requete[:40], err)
		}
	}

	exec(`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`, &j.CompagnieID,
		"Test masquage "+suffixe)

	// Le nettoyage est posé aussitôt la compagnie créée : si une insertion
	// suivante échoue, le décor partiel ne reste pas en base.
	t.Cleanup(func() {
		nettoyer := context.Background()
		_, _ = pool.Exec(nettoyer, `DELETE FROM compagnies WHERE id = $1`, j.CompagnieID)
		// Les clients ne dépendent pas de la compagnie : ils survivraient à la
		// cascade, et `courses.client_id` n'a pas de ON DELETE CASCADE — d'où
		// cette suppression après celle des courses.
		_, _ = pool.Exec(nettoyer, `DELETE FROM clients WHERE id = ANY($1)`,
			[]uuid.UUID{j.ClientID, j.AutreClient})
	})

	exec(`INSERT INTO clients (nom, telephone_hash) VALUES ($1, $2) RETURNING id`,
		&j.ClientID, "Cliente test "+suffixe, "hash-client-"+suffixe)
	exec(`INSERT INTO clients (nom, telephone_hash) VALUES ($1, $2) RETURNING id`,
		&j.AutreClient, "Tiers test "+suffixe, "hash-tiers-"+suffixe)

	exec(`INSERT INTO livreurs (compagnie_id, nom, telephone_hash, statut)
	      VALUES ($1, $2, $3, 'dispo') RETURNING id`,
		&j.LivreurID, j.CompagnieID, "Livreur test "+suffixe, "hash-livreur-"+suffixe)
	exec(`INSERT INTO livreurs (compagnie_id, nom, telephone_hash, statut)
	      VALUES ($1, $2, $3, 'dispo') RETURNING id`,
		&j.AutreLivreu, j.CompagnieID, "Autre livreur "+suffixe, "hash-livreur2-"+suffixe)

	exec(`INSERT INTO courses (compagnie_id, client_id, livreur_id, statut,
	                           adresse_depart, adresse_arrivee)
	      VALUES ($1, $2, $3, 'assignee', $4, $5) RETURNING id`,
		&j.CourseID, j.CompagnieID, j.ClientID, j.LivreurID,
		"Marché de Rood Woko", "Zone du Bois")

	exec(`INSERT INTO sessions_masquage (course_id, expire_at) VALUES ($1, $2) RETURNING id`,
		&j.SessionID, j.CourseID, expireAt)

	return j
}
