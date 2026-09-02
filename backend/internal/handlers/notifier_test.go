package handlers

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"fiyen-backend/internal/notifications"
	"fiyen-backend/internal/testdb"
)

// L'envoi part dans une goroutine : l'assignation d'une course ne doit pas
// attendre un service tiers. Ces tests vérifient donc *qu'il part*, et surtout
// ce qu'il advient des appareils hors service.

// envoyeurEspion retient ce qu'on lui demande d'envoyer et rend le verdict
// qu'on lui dicte.
type envoyeurEspion struct {
	mu       sync.Mutex
	appels   int
	jetons   []string
	derniere notifications.Notification
	verdict  func(jetons []string) []notifications.Resultat
	signal   chan struct{}
}

func nouvelEspion(verdict func([]string) []notifications.Resultat) *envoyeurEspion {
	return &envoyeurEspion{verdict: verdict, signal: make(chan struct{}, 8)}
}

func (e *envoyeurEspion) Envoyer(_ context.Context, jetons []string, n notifications.Notification) ([]notifications.Resultat, error) {
	e.mu.Lock()
	e.appels++
	e.jetons = append(e.jetons, jetons...)
	e.derniere = n
	e.mu.Unlock()

	// Signale l'appel pour que le test n'ait pas à deviner un délai.
	select {
	case e.signal <- struct{}{}:
	default:
	}

	if e.verdict != nil {
		return e.verdict(jetons), nil
	}
	resultats := make([]notifications.Resultat, 0, len(jetons))
	for _, j := range jetons {
		resultats = append(resultats, notifications.Resultat{Jeton: j, Livre: true})
	}
	return resultats, nil
}

func (e *envoyeurEspion) attendre(t *testing.T) {
	t.Helper()
	select {
	case <-e.signal:
	case <-time.After(5 * time.Second):
		t.Fatal("aucune notification envoyée dans le délai")
	}
}

func (e *envoyeurEspion) etat() (int, []string, notifications.Notification) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.appels, append([]string(nil), e.jetons...), e.derniere
}

// livreurAvecCompte crée un livreur, son compte utilisateur et ses appareils.
func livreurAvecCompte(t *testing.T, pool *pgxpool.Pool, jetonsPush ...string) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	suffixe := uuid.NewString()[:8]

	var compagnieID, livreurID, utilisateurID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO compagnies (nom) VALUES ($1) RETURNING id`,
		"Test notif "+suffixe).Scan(&compagnieID); err != nil {
		t.Fatalf("compagnie: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM compagnies WHERE id = $1`, compagnieID)
	})

	if err := pool.QueryRow(ctx, `
		INSERT INTO livreurs (compagnie_id, nom, telephone_hash, statut)
		VALUES ($1, 'Salif Traoré', $2, 'dispo') RETURNING id
	`, compagnieID, "hash-liv-"+suffixe).Scan(&livreurID); err != nil {
		t.Fatalf("livreur: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO utilisateurs (role, telephone_hash, mot_de_passe_hash, compagnie_id, livreur_id)
		VALUES ('livreur', $1, 'x', $2, $3) RETURNING id
	`, "hash-liv-"+suffixe, compagnieID, livreurID).Scan(&utilisateurID); err != nil {
		t.Fatalf("utilisateur: %v", err)
	}

	for _, j := range jetonsPush {
		if _, err := pool.Exec(ctx, `
			INSERT INTO jetons_push (utilisateur_id, jeton, plateforme)
			VALUES ($1, $2, 'android')
		`, utilisateurID, j); err != nil {
			t.Fatalf("jeton push: %v", err)
		}
	}

	return livreurID, utilisateurID
}

func compterJetons(t *testing.T, pool *pgxpool.Pool, utilisateurID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM jetons_push WHERE utilisateur_id = $1`, utilisateurID).Scan(&n); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	return n
}

func jetonPush(n int) string {
	return fmt.Sprintf("ExponentPushToken[%s-%d]", uuid.NewString()[:8], n)
}

// --- Ce qui part ----------------------------------------------------------

func TestNotifierLivreur_EnvoieAuxAppareilsDuLivreur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	a, b := jetonPush(1), jetonPush(2)
	livreurID, _ := livreurAvecCompte(t, pool, a, b)

	espion := nouvelEspion(nil)
	deps := &Deps{DB: pool, Notifications: espion}

	courseID := uuid.New()
	deps.notifierLivreurAssignation(livreurID, courseID, 1042, "Zone du Bois, rue 15.42")
	espion.attendre(t)

	appels, jetons, notif := espion.etat()
	if appels != 1 {
		t.Errorf("un seul envoi attendu, obtenu %d", appels)
	}

	// Les deux appareils reçoivent : un livreur peut avoir deux téléphones, et
	// mieux vaut une notification en double qu'une notification perdue.
	if len(jetons) != 2 {
		t.Errorf("les deux appareils doivent recevoir, obtenu %v", jetons)
	}

	if !strings.Contains(notif.Titre, "FY-1042") {
		t.Errorf("le titre doit porter le numéro dictable: %q", notif.Titre)
	}
	// L'adresse d'arrivée, pas celle de départ : c'est elle qui dit au livreur
	// si la course l'arrange, avant même d'ouvrir l'application.
	if !strings.Contains(notif.Corps, "Zone du Bois") {
		t.Errorf("le corps doit porter la destination: %q", notif.Corps)
	}
	if notif.Donnees["course_id"] != courseID.String() {
		t.Errorf("la course doit être identifiée pour ouvrir le bon écran: %v", notif.Donnees)
	}
}

func TestNotifierLivreur_SansAppareilNEnvoieRien(t *testing.T) {
	pool := testdb.Ouvrir(t)
	livreurID, _ := livreurAvecCompte(t, pool) // aucun jeton

	espion := nouvelEspion(nil)
	deps := &Deps{DB: pool, Notifications: espion}

	deps.notifierLivreurAssignation(livreurID, uuid.New(), 1, "quelque part")

	// Cas courant et normal : le livreur n'a pas encore ouvert l'application
	// mobile, ou n'a pas accordé la permission. Rien ne doit partir.
	time.Sleep(700 * time.Millisecond)
	if appels, _, _ := espion.etat(); appels != 0 {
		t.Errorf("aucun envoi attendu sans appareil, obtenu %d", appels)
	}
}

func TestNotifierLivreur_SansEnvoyeurNePaniquePas(t *testing.T) {
	pool := testdb.Ouvrir(t)
	livreurID, _ := livreurAvecCompte(t, pool, jetonPush(1))

	// `Notifications` peut être nil — c'est le cas des tests qui n'en ont pas
	// besoin. Le handler doit s'en passer sans broncher.
	deps := &Deps{DB: pool}
	deps.notifierLivreurAssignation(livreurID, uuid.New(), 1, "quelque part")
	time.Sleep(300 * time.Millisecond)
}

// --- Ménage des appareils perdus ------------------------------------------

func TestNotifierLivreur_OublieLesAppareilsPerdus(t *testing.T) {
	pool := testdb.Ouvrir(t)
	vivant, mort := jetonPush(1), jetonPush(2)
	livreurID, utilisateurID := livreurAvecCompte(t, pool, vivant, mort)

	espion := nouvelEspion(func(jetons []string) []notifications.Resultat {
		resultats := make([]notifications.Resultat, 0, len(jetons))
		for _, j := range jetons {
			resultats = append(resultats, notifications.Resultat{
				Jeton:     j,
				Livre:     j != mort,
				JetonMort: j == mort,
			})
		}
		return resultats
	})

	deps := &Deps{DB: pool, Notifications: espion}
	deps.notifierLivreurAssignation(livreurID, uuid.New(), 1, "Zone du Bois")
	espion.attendre(t)

	// Le ménage a lieu après l'envoi : on laisse le temps à la suppression.
	echeance := time.Now().Add(5 * time.Second)
	for time.Now().Before(echeance) {
		if compterJetons(t, pool, utilisateurID) == 1 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Sans ce ménage, la table se remplit d'adresses mortes : chaque envoi
	// coûterait de plus en plus cher pour un nombre de livraisons constant.
	restants := compterJetons(t, pool, utilisateurID)
	if restants != 1 {
		t.Fatalf("l'appareil perdu doit être oublié, %d jeton(s) restant(s)", restants)
	}

	var subsistant string
	if err := pool.QueryRow(context.Background(),
		`SELECT jeton FROM jetons_push WHERE utilisateur_id = $1`, utilisateurID).
		Scan(&subsistant); err != nil {
		t.Fatalf("lecture: %v", err)
	}
	// Le point sensible : supprimer le mauvais jeton couperait les
	// notifications d'un livreur en service.
	if subsistant != vivant {
		t.Errorf("le mauvais jeton a été supprimé : reste %q, attendu %q", subsistant, vivant)
	}
}

func TestNotifierLivreur_UnEchecSimpleNeSupprimeRien(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeton := jetonPush(1)
	livreurID, utilisateurID := livreurAvecCompte(t, pool, jeton)

	// Message trop gros, débit dépassé, panne passagère : l'appareil existe
	// toujours. Le supprimer priverait le livreur de toutes ses notifications
	// suivantes pour un incident sans lendemain.
	espion := nouvelEspion(func(jetons []string) []notifications.Resultat {
		return []notifications.Resultat{{
			Jeton: jetons[0], Livre: false, JetonMort: false, Message: "MessageRateExceeded",
		}}
	})

	deps := &Deps{DB: pool, Notifications: espion}
	deps.notifierLivreurAssignation(livreurID, uuid.New(), 1, "Zone du Bois")
	espion.attendre(t)
	time.Sleep(500 * time.Millisecond)

	if n := compterJetons(t, pool, utilisateurID); n != 1 {
		t.Errorf("un échec passager ne doit rien supprimer, %d jeton(s) restant(s)", n)
	}
}
