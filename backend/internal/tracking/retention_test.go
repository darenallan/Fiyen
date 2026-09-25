package tracking_test

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

	"fiyen-backend/internal/testdb"
	"fiyen-backend/internal/tracking"
)

// La rétention supprime des données qu'on ne reconstitue pas. Ces tests bornent
// donc ce qu'elle a le droit de toucher : ce qui compte, c'est moins qu'elle
// supprime le vieux que qu'elle **épargne** le récent, et qu'aucune
// configuration ne puisse la faire tout supprimer.

const retention = 90 * 24 * time.Hour

// tampon est un journal lisible pendant que la boucle y écrit (`bytes.Buffer`
// serait une course que `-race` signale).
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

// poserTraces insère `n` positions pour un livreur, espacées d'une seconde à
// partir de `debut`. L'unicité (livreur, horodatage) l'exige.
func poserTraces(t *testing.T, pool *pgxpool.Pool, livreurID uuid.UUID, debut time.Time, n int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO traces_positions (livreur_id, position, horodatage)
		SELECT $1, ST_SetSRID(ST_MakePoint(-1.52, 12.37), 4326)::geography,
		       $2::timestamptz + (g * interval '1 second')
		FROM generate_series(1, $3) g
	`, livreurID, debut, n); err != nil {
		t.Fatalf("pose des traces: %v", err)
	}
}

func compter(t *testing.T, pool *pgxpool.Pool, livreurID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM traces_positions WHERE livreur_id = $1`, livreurID).Scan(&n); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	return n
}

func TestPurgerTraces_SupprimeLeVieuxEtEpargneLeRecent(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	// De part et d'autre de la frontière : la veille de l'échéance doit
	// survivre, le lendemain doit partir. Un « plus de 90 jours » écrit
	// « au moins 90 » supprimerait une journée de trop.
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-retention-48*time.Hour), 10) // périmées
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-retention+48*time.Hour), 7)  // presque périmées
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-time.Hour), 5)               // récentes

	if _, err := tracking.PurgerTraces(context.Background(), pool, retention); err != nil {
		t.Fatalf("purge: %v", err)
	}

	if reste := compter(t, pool, jeu.LivreurID); reste != 12 {
		t.Errorf("il devait rester 12 traces (7 presque périmées + 5 récentes), il en reste %d", reste)
	}
}

func TestPurgerTraces_LaRetentionVautPourTousLesLivreurs(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	vieux := time.Now().Add(-retention - 24*time.Hour)
	poserTraces(t, pool, jeu.LivreurID, vieux, 4)
	poserTraces(t, pool, jeu.AutreLivreu, vieux, 4)
	poserTraces(t, pool, jeu.AutreLivreu, time.Now().Add(-time.Minute), 3)

	if _, err := tracking.PurgerTraces(context.Background(), pool, retention); err != nil {
		t.Fatalf("purge: %v", err)
	}

	// La purge se fait par âge, tous livreurs confondus : ne la restreindre à
	// aucun d'eux, mais ne rien prendre au récent de l'autre.
	if n := compter(t, pool, jeu.LivreurID); n != 0 {
		t.Errorf("le premier livreur devait être vidé de ses traces périmées, il en reste %d", n)
	}
	if n := compter(t, pool, jeu.AutreLivreu); n != 3 {
		t.Errorf("le second livreur devait garder ses 3 traces récentes, il en a %d", n)
	}
}

func TestPurgerTraces_VideUneTablePlusGrosseQuUnLot(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	// Deux lots et demi : sans la boucle, un seul lot serait supprimé et le
	// reste attendrait le lendemain — puis encore le suivant, sans jamais
	// rattraper un retard de plusieurs mois.
	n := tracking.TailleLotRetention*2 + tracking.TailleLotRetention/2
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-retention-72*time.Hour), n)
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-time.Hour), 3)

	supprimees, err := tracking.PurgerTraces(context.Background(), pool, retention)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}

	if supprimees < int64(n) {
		t.Errorf("au moins %d suppressions attendues, %d rapportées", n, supprimees)
	}
	if reste := compter(t, pool, jeu.LivreurID); reste != 3 {
		t.Errorf("il devait ne rester que les 3 récentes, il en reste %d", reste)
	}
}

func TestPurgerTraces_RefuseUneDureeNulleOuNegative(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-time.Hour), 6)

	// `now() - 0` supprimerait tout : une variable d'environnement mal
	// renseignée ne doit jamais pouvoir effacer le trajet de tous les livreurs.
	for _, duree := range []time.Duration{0, -time.Hour, -retention} {
		if _, err := tracking.PurgerTraces(context.Background(), pool, duree); err == nil {
			t.Errorf("une durée de %s aurait dû être refusée", duree)
		}
	}

	if n := compter(t, pool, jeu.LivreurID); n != 6 {
		t.Errorf("les traces ne devaient pas être touchées, il en reste %d sur 6", n)
	}
}

func TestPurgerTraces_UneSeuleInstanceTravaille(t *testing.T) {
	pool := testdb.Ouvrir(t)

	// Le verrou est tenu par une connexion à part, comme le ferait une autre
	// instance en plein passage.
	autre, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatalf("connexion: %v", err)
	}
	defer autre.Release()

	var pris bool
	if err := autre.QueryRow(context.Background(),
		`SELECT pg_try_advisory_lock(8140926)`).Scan(&pris); err != nil {
		t.Fatalf("verrou: %v", err)
	}
	if !pris {
		t.Skip("verrou déjà tenu par une autre exécution")
	}
	defer func() {
		_, _ = autre.Exec(context.Background(), `SELECT pg_advisory_unlock(8140926)`)
	}()

	_, err = tracking.PurgerTraces(context.Background(), pool, retention)
	if !errors.Is(err, tracking.ErrRetentionConcurrente) {
		t.Errorf("le verrou étant tenu, la purge devait être refusée ; obtenu : %v", err)
	}
}

func TestPurgerTraces_RelacheSonVerrou(t *testing.T) {
	pool := testdb.Ouvrir(t)

	// `autre` est prise avant la purge : le pool ne peut donc pas la lui
	// prêter, et la purge travaille sur une **autre** session. Un verrou de
	// session resté accroché à cette connexion empêcherait `autre` de le
	// prendre — un verrou fuité bloquerait la purge à tous les passages
	// suivants, sans qu'aucune erreur ne le dise.
	autre, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatalf("connexion: %v", err)
	}
	defer autre.Release()

	if _, err := tracking.PurgerTraces(context.Background(), pool, retention); err != nil {
		t.Fatalf("purge: %v", err)
	}

	var pris bool
	if err := autre.QueryRow(context.Background(),
		`SELECT pg_try_advisory_lock(8140926)`).Scan(&pris); err != nil {
		t.Fatalf("verrou: %v", err)
	}
	if !pris {
		t.Fatal("la purge a laissé son verrou : le passage suivant serait refusé")
	}
	_, _ = autre.Exec(context.Background(), `SELECT pg_advisory_unlock(8140926)`)
}

func TestPurgerTracesPeriodiquement_UneDureeInvalideNeVidePasLaTable(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	poserTraces(t, pool, jeu.LivreurID, time.Now().Add(-time.Hour), 8)

	journal := &tampon{}
	ctx, annuler := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() {
		defer close(fini)
		// Durée à zéro : sans repli, le premier passage supprimerait tout.
		tracking.PurgerTracesPeriodiquement(ctx, pool, 0, time.Hour, log.New(journal, "", 0))
	}()

	time.Sleep(700 * time.Millisecond)
	annuler()
	<-fini

	if n := compter(t, pool, jeu.LivreurID); n != 8 {
		t.Errorf("une durée nulle a effacé des traces récentes : il en reste %d sur 8", n)
	}
	if !strings.Contains(journal.String(), "durée invalide") {
		t.Errorf("le repli doit être dit au journal, obtenu : %q", journal.String())
	}
}

func TestPurgerTracesPeriodiquement_IntervalleInvalideNeFaitPasTomberLeService(t *testing.T) {
	pool := testdb.Ouvrir(t)

	journal := &tampon{}
	ctx, annuler := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() {
		defer close(fini)
		// `time.NewTicker(0)` panique : une variable mal réglée ne doit pas
		// faire tomber l'API au démarrage.
		tracking.PurgerTracesPeriodiquement(ctx, pool, retention, 0, log.New(journal, "", 0))
	}()

	time.Sleep(700 * time.Millisecond)
	annuler()
	<-fini

	if !strings.Contains(journal.String(), "intervalle invalide") {
		t.Errorf("le repli doit être dit au journal, obtenu : %q", journal.String())
	}
}

func TestPurgerTracesPeriodiquement_JournaliseSonPassage(t *testing.T) {
	pool := testdb.Ouvrir(t)

	journal := &tampon{}
	ctx, annuler := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() {
		defer close(fini)
		tracking.PurgerTracesPeriodiquement(ctx, pool, retention, time.Hour, log.New(journal, "", 0))
	}()

	// Passage immédiat au démarrage : attendre le premier intervalle sur un
	// service redémarré souvent reviendrait à ne jamais purger.
	time.Sleep(700 * time.Millisecond)
	annuler()
	<-fini

	if !strings.Contains(journal.String(), "rétention des traces") {
		t.Errorf("le premier passage doit avoir lieu tout de suite, journal : %q", journal.String())
	}
}
