package auth_test

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/auth"
	"fiyen-backend/internal/testdb"
)

// La purge touche à la seule table qui porte les sessions vivantes : se
// tromper de condition déconnecterait tout le monde. Ces tests bornent ce
// qu'elle a le droit de supprimer.

// tampon est un journal lisible pendant que la boucle y écrit.
//
// `bytes.Buffer` ne convient pas : la boucle tourne dans sa propre goroutine,
// et lire le tampon en même temps est une course que `-race` signale.
type tampon struct {
	mu      sync.Mutex
	contenu strings.Builder
}

func (t *tampon) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.contenu.Write(p)
}

func (t *tampon) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.contenu.String()
}

// utilisateurJetable crée un compte minimal et rend son identifiant. Les
// sessions référencent `utilisateurs` : impossible d'en insérer sans lui.
func utilisateurJetable(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	var compagnieID, utilisateurID uuid.UUID
	suffixe := uuid.NewString()[:8]

	if err := pool.QueryRow(ctx,
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		"Test purge "+suffixe).Scan(&compagnieID); err != nil {
		t.Fatalf("compagnie: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM compagnies WHERE id = $1`, compagnieID)
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, compagnie_id)
		VALUES ('compagnie', $1, 'x', $2) RETURNING id
	`, "hash-purge-"+suffixe, compagnieID).Scan(&utilisateurID); err != nil {
		t.Fatalf("utilisateur: %v", err)
	}

	return utilisateurID
}

// poser insère une session à un état donné, en contournant `Emettre` pour
// pouvoir dater le passé.
func poser(t *testing.T, pool *pgxpool.Pool, utilisateurID uuid.UUID,
	expireAt time.Time, revoqueAt *time.Time) uuid.UUID {
	t.Helper()

	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO sessions_refresh (utilisateur_id, jeton_hash, expire_at, revoque_at)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, utilisateurID, uuid.NewString(), expireAt, revoqueAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertion session: %v", err)
	}
	return id
}

func existe(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) bool {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM sessions_refresh WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatalf("lecture: %v", err)
	}
	return n > 0
}

// --- Ce que la purge supprime, et surtout ce qu'elle épargne --------------

func TestPurger_NeTouchePasAuxSessionsVivantes(t *testing.T) {
	pool := testdb.Ouvrir(t)
	u := utilisateurJetable(t, pool)

	vivante := poser(t, pool, u, time.Now().Add(30*24*time.Hour), nil)

	if _, err := auth.Purger(context.Background(), pool); err != nil {
		t.Fatalf("purge: %v", err)
	}

	// Le point sensible : cette table porte les sessions en cours. Une
	// condition trop large déconnecterait toute la flotte d'un coup.
	if !existe(t, pool, vivante) {
		t.Error("une session encore valide a été supprimée")
	}
}

func TestPurger_EpargneUneSessionRecemmentExpiree(t *testing.T) {
	pool := testdb.Ouvrir(t)
	u := utilisateurJetable(t, pool)

	// Expirée hier : la grâce de 30 jours existe pour qu'un incident reste
	// analysable après coup — savoir qu'un jeton a existé, et quand.
	recente := poser(t, pool, u, time.Now().Add(-24*time.Hour), nil)

	if _, err := auth.Purger(context.Background(), pool); err != nil {
		t.Fatalf("purge: %v", err)
	}

	if !existe(t, pool, recente) {
		t.Error("une session expirée d'hier doit survivre à la purge")
	}
}

func TestPurger_SupprimeUneSessionExpireeDeLongueDate(t *testing.T) {
	pool := testdb.Ouvrir(t)
	u := utilisateurJetable(t, pool)

	ancienne := poser(t, pool, u, time.Now().Add(-40*24*time.Hour), nil)

	supprimees, err := auth.Purger(context.Background(), pool)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if supprimees < 1 {
		t.Errorf("aucune ligne supprimée alors qu'une session est éligible")
	}
	if existe(t, pool, ancienne) {
		t.Error("une session expirée depuis 40 jours doit être supprimée")
	}
}

func TestPurger_SupprimeUneSessionRevoqueeDeLongueDate(t *testing.T) {
	pool := testdb.Ouvrir(t)
	u := utilisateurJetable(t, pool)

	revoqueeIlYALongtemps := time.Now().Add(-40 * 24 * time.Hour)
	// Expiration lointaine : seule la révocation la rend éligible. C'est ce
	// qui vérifie la seconde branche de la condition.
	id := poser(t, pool, u, time.Now().Add(365*24*time.Hour), &revoqueeIlYALongtemps)

	if _, err := auth.Purger(context.Background(), pool); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if existe(t, pool, id) {
		t.Error("une session révoquée depuis 40 jours doit être supprimée")
	}
}

func TestPurger_EpargneUneSessionRevoqueeHier(t *testing.T) {
	pool := testdb.Ouvrir(t)
	u := utilisateurJetable(t, pool)

	hier := time.Now().Add(-24 * time.Hour)
	id := poser(t, pool, u, time.Now().Add(365*24*time.Hour), &hier)

	if _, err := auth.Purger(context.Background(), pool); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if !existe(t, pool, id) {
		t.Error("une révocation d'hier doit rester consultable")
	}
}

// --- Concurrence ----------------------------------------------------------

func TestPurger_UneSeuleInstanceTravaille(t *testing.T) {
	pool := testdb.Ouvrir(t)

	// Deux purges en même temps, comme deux instances derrière un répartiteur.
	// L'une doit se voir refuser le verrou plutôt que de refaire le travail.
	var (
		attente sync.WaitGroup
		mu      sync.Mutex
		refus   int
	)
	attente.Add(2)

	// Le verrou est tenu par une transaction ouverte à part : sans quoi les
	// deux purges pourraient se succéder trop vite pour se croiser.
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("transaction: %v", err)
	}
	var pris bool
	if err := tx.QueryRow(context.Background(),
		`SELECT pg_try_advisory_xact_lock(8140925)`).Scan(&pris); err != nil {
		t.Fatalf("verrou: %v", err)
	}
	if !pris {
		_ = tx.Rollback(context.Background())
		t.Skip("verrou déjà tenu par une autre exécution")
	}

	for i := 0; i < 2; i++ {
		go func() {
			defer attente.Done()
			_, err := auth.Purger(context.Background(), pool)
			if errors.Is(err, auth.ErrPurgeConcurrente) {
				mu.Lock()
				refus++
				mu.Unlock()
			}
		}()
	}
	attente.Wait()
	_ = tx.Rollback(context.Background())

	if refus != 2 {
		t.Errorf("le verrou étant tenu, les deux purges devaient être refusées ; %d l'ont été", refus)
	}
}

// --- Boucle périodique ----------------------------------------------------

func TestPurgerPeriodiquement_JournaliseSonPassage(t *testing.T) {
	pool := testdb.Ouvrir(t)

	var journalise tampon
	journal := log.New(&journalise, "", 0)

	ctx, annuler := context.WithCancel(context.Background())
	defer annuler()

	fini := make(chan struct{})
	go func() {
		auth.PurgerPeriodiquement(ctx, pool, time.Hour, journal)
		close(fini)
	}()

	// Un passage a lieu immédiatement : sur un service redémarré souvent,
	// attendre le premier intervalle reviendrait à ne jamais purger.
	temoin := time.After(3 * time.Second)
	for {
		if strings.Contains(journalise.String(), "purge des sessions") {
			break
		}
		select {
		case <-temoin:
			t.Fatalf("aucun passage journalisé : %q", journalise.String())
		default:
			time.Sleep(50 * time.Millisecond)
		}
	}

	annuler()
	select {
	case <-fini:
	case <-time.After(3 * time.Second):
		// Une boucle qui ignore l'annulation empêcherait un arrêt propre du
		// service et laisserait des connexions ouvertes.
		t.Fatal("la boucle n'a pas rendu la main à l'annulation du contexte")
	}
}

func TestPurgerPeriodiquement_SArreteSansRienJournaliserDeFaux(t *testing.T) {
	pool := testdb.Ouvrir(t)

	var journalise tampon
	journal := log.New(&journalise, "", 0)

	ctx, annuler := context.WithCancel(context.Background())
	annuler() // annulé avant même le démarrage

	fini := make(chan struct{})
	go func() {
		auth.PurgerPeriodiquement(ctx, pool, time.Hour, journal)
		close(fini)
	}()

	select {
	case <-fini:
	case <-time.After(3 * time.Second):
		t.Fatal("la boucle doit rendre la main immédiatement sur un contexte déjà annulé")
	}

	// Un arrêt n'est pas un incident : le journal ne doit pas crier à l'échec.
	if strings.Contains(journalise.String(), "échouée") {
		t.Errorf("un arrêt du service ne doit pas être journalisé comme un échec : %q", journalise.String())
	}
}

func TestPurgerPeriodiquement_IntervalleInvalideNeFaitPasTomberLeService(t *testing.T) {
	pool := testdb.Ouvrir(t)

	var journalise tampon
	journal := log.New(&journalise, "", 0)

	ctx, annuler := context.WithCancel(context.Background())
	defer annuler()

	// `time.NewTicker` panique sur un intervalle nul : une variable
	// d'environnement mal renseignée ferait tomber l'API au démarrage. C'est
	// arrivé, d'où ce test.
	fini := make(chan struct{})
	go func() {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("un intervalle nul a fait paniquer la boucle : %v", r)
			}
			close(fini)
		}()
		auth.PurgerPeriodiquement(ctx, pool, 0, journal)
	}()

	time.Sleep(500 * time.Millisecond)
	annuler()

	select {
	case <-fini:
	case <-time.After(3 * time.Second):
		t.Fatal("la boucle ne rend pas la main")
	}

	if !strings.Contains(journalise.String(), "intervalle invalide") {
		t.Errorf("le repli doit être signalé dans le journal : %q", journalise.String())
	}
	// Le passage au démarrage doit tout de même avoir eu lieu.
	if !strings.Contains(journalise.String(), "purge des sessions : 0") &&
		!strings.Contains(journalise.String(), "ligne(s) supprimée(s)") {
		t.Errorf("le passage au démarrage manque : %q", journalise.String())
	}
}
