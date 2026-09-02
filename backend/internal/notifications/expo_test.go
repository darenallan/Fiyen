package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Le service d'Expo n'est jamais appelé pour de vrai ici : un test qui
// dépendrait d'exp.host échouerait sans réseau et enverrait des notifications
// à des appareils inexistants. On rejoue son contrat, tel que documenté.

// faussExpo monte un service qui répond ce qu'on lui dit, et retient ce qu'il
// a reçu.
type fauxExpo struct {
	serveur *httptest.Server
	recu    [][]map[string]any
	reponse func(nbMessages int) (int, string)
}

func nouveauFauxExpo(t *testing.T, reponse func(int) (int, string)) *fauxExpo {
	t.Helper()

	f := &fauxExpo{reponse: reponse}
	f.serveur = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		corps, _ := io.ReadAll(r.Body)
		var messages []map[string]any
		_ = json.Unmarshal(corps, &messages)
		f.recu = append(f.recu, messages)

		code, charge := f.reponse(len(messages))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = io.WriteString(w, charge)
	}))
	t.Cleanup(f.serveur.Close)
	return f
}

func (f *fauxExpo) envoyeur() *EnvoyeurExpo {
	return &EnvoyeurExpo{URL: f.serveur.URL, Client: f.serveur.Client()}
}

// toutOK construit une réponse où chaque message passe.
func toutOK(n int) (int, string) {
	verdicts := make([]string, n)
	for i := range verdicts {
		verdicts[i] = `{"status":"ok","id":"ticket"}`
	}
	return http.StatusOK, `{"data":[` + strings.Join(verdicts, ",") + `]}`
}

func TestExpo_EnvoiSimple(t *testing.T) {
	faux := nouveauFauxExpo(t, toutOK)

	resultats, err := faux.envoyeur().Envoyer(context.Background(),
		[]string{"ExponentPushToken[a]", "ExponentPushToken[b]"},
		Notification{Titre: "Nouvelle course FY-1042", Corps: "Livraison vers Zone du Bois"})
	if err != nil {
		t.Fatalf("envoi: %v", err)
	}

	if len(resultats) != 2 {
		t.Fatalf("attendu 2 résultats, obtenu %d", len(resultats))
	}
	for _, r := range resultats {
		if !r.Livre {
			t.Errorf("%s devait être livré", r.Jeton)
		}
	}

	if len(faux.recu) != 1 || len(faux.recu[0]) != 2 {
		t.Fatalf("un seul lot de deux messages attendu, reçu %v", faux.recu)
	}
	msg := faux.recu[0][0]
	if msg["title"] != "Nouvelle course FY-1042" {
		t.Errorf("titre transmis = %v", msg["title"])
	}
	// « high » réveille l'appareil Android : une course qui attend n'a pas
	// vocation à patienter jusqu'au prochain réveil du système.
	if msg["priority"] != "high" {
		t.Errorf("priorité = %v, attendu \"high\"", msg["priority"])
	}
}

func TestExpo_AssocieChaqueVerdictAuBonJeton(t *testing.T) {
	// Le second appareil est perdu, les deux autres vont bien. Expo répond
	// dans l'ordre des messages : se tromper d'indice ferait supprimer le
	// jeton d'un livreur en service.
	faux := nouveauFauxExpo(t, func(int) (int, string) {
		return http.StatusOK, `{"data":[
			{"status":"ok","id":"t1"},
			{"status":"error","message":"parti","details":{"error":"DeviceNotRegistered"}},
			{"status":"ok","id":"t3"}
		]}`
	})

	jetons := []string{"ExponentPushToken[a]", "ExponentPushToken[b]", "ExponentPushToken[c]"}
	resultats, err := faux.envoyeur().Envoyer(context.Background(), jetons, Notification{})
	if err != nil {
		t.Fatalf("envoi: %v", err)
	}

	attendu := map[string]struct{ livre, mort bool }{
		"ExponentPushToken[a]": {true, false},
		"ExponentPushToken[b]": {false, true},
		"ExponentPushToken[c]": {true, false},
	}
	for _, r := range resultats {
		a, connu := attendu[r.Jeton]
		if !connu {
			t.Errorf("jeton inattendu dans les résultats: %s", r.Jeton)
			continue
		}
		if r.Livre != a.livre || r.JetonMort != a.mort {
			t.Errorf("%s : livré=%v mort=%v, attendu livré=%v mort=%v",
				r.Jeton, r.Livre, r.JetonMort, a.livre, a.mort)
		}
	}
}

func TestExpo_ReponseIncoherenteRefusee(t *testing.T) {
	// Moins de verdicts que de messages : on ne peut plus dire à quel jeton
	// chacun se rapporte. Attribuer au hasard ferait supprimer un jeton valide.
	faux := nouveauFauxExpo(t, func(int) (int, string) {
		return http.StatusOK, `{"data":[{"status":"ok","id":"t1"}]}`
	})

	_, err := faux.envoyeur().Envoyer(context.Background(),
		[]string{"ExponentPushToken[a]", "ExponentPushToken[b]"}, Notification{})
	if err == nil {
		t.Fatal("une réponse de longueur incohérente doit être refusée")
	}
	if !strings.Contains(err.Error(), "incohérente") {
		t.Errorf("message peu explicite: %v", err)
	}
}

func TestExpo_ErreurDeRequeteRemonte(t *testing.T) {
	faux := nouveauFauxExpo(t, func(int) (int, string) {
		return http.StatusBadRequest,
			`{"errors":[{"code":"PUSH_TOO_MANY_NOTIFICATIONS","message":"trop de messages"}]}`
	})

	resultats, err := faux.envoyeur().Envoyer(context.Background(),
		[]string{"ExponentPushToken[a]"}, Notification{})
	if err == nil {
		t.Fatal("une erreur au niveau de la requête doit remonter")
	}
	// Aucun message n'est parti : rendre des résultats « livrés » ferait
	// croire à un succès.
	if len(resultats) != 0 {
		t.Errorf("aucun résultat attendu, obtenu %d", len(resultats))
	}
}

func TestExpo_DecoupeEnLotsDeCent(t *testing.T) {
	faux := nouveauFauxExpo(t, toutOK)

	// Expo refuse au-delà de 100 messages par requête. Envoyer 250 jetons doit
	// produire trois appels, pas une erreur.
	jetons := make([]string, 250)
	for i := range jetons {
		jetons[i] = fmt.Sprintf("ExponentPushToken[%d]", i)
	}

	resultats, err := faux.envoyeur().Envoyer(context.Background(), jetons, Notification{})
	if err != nil {
		t.Fatalf("envoi: %v", err)
	}
	if len(resultats) != 250 {
		t.Errorf("attendu 250 résultats, obtenu %d", len(resultats))
	}
	if len(faux.recu) != 3 {
		t.Fatalf("attendu 3 lots, obtenu %d", len(faux.recu))
	}
	for i, taille := range []int{100, 100, 50} {
		if len(faux.recu[i]) != taille {
			t.Errorf("lot %d : %d messages, attendu %d", i, len(faux.recu[i]), taille)
		}
	}
}

func TestExpo_JetonDAccesTransmisSeulementSiPresent(t *testing.T) {
	var entetes []string
	serveur := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entetes = append(entetes, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t"}]}`)
	}))
	defer serveur.Close()

	sans := &EnvoyeurExpo{URL: serveur.URL, Client: serveur.Client()}
	if _, err := sans.Envoyer(context.Background(), []string{"ExponentPushToken[a]"}, Notification{}); err != nil {
		t.Fatalf("envoi sans jeton: %v", err)
	}

	avec := &EnvoyeurExpo{URL: serveur.URL, JetonAcces: "secret", Client: serveur.Client()}
	if _, err := avec.Envoyer(context.Background(), []string{"ExponentPushToken[a]"}, Notification{}); err != nil {
		t.Fatalf("envoi avec jeton: %v", err)
	}

	// Envoyer un en-tête `Authorization` vide ferait refuser la requête par
	// Expo quand la sécurité push est activée.
	if entetes[0] != "" {
		t.Errorf("aucun en-tête attendu sans jeton, obtenu %q", entetes[0])
	}
	if entetes[1] != "Bearer secret" {
		t.Errorf("en-tête = %q", entetes[1])
	}
}

func TestExpo_ServiceInjoignable(t *testing.T) {
	// Port 1 : rien n'y écoute jamais.
	e := &EnvoyeurExpo{URL: "http://127.0.0.1:1/", Client: &http.Client{Timeout: time.Second}}

	if _, err := e.Envoyer(context.Background(),
		[]string{"ExponentPushToken[a]"}, Notification{}); err == nil {
		t.Fatal("un service injoignable doit remonter une erreur")
	}
}

func TestEnvoyeurInerte_NePretendPasAuSucces(t *testing.T) {
	resultats, err := EnvoyeurInerte{}.Envoyer(context.Background(),
		[]string{"ExponentPushToken[a]"}, Notification{})
	if err != nil {
		t.Fatalf("l'envoyeur inerte ne doit pas échouer: %v", err)
	}
	// Prétendre au succès ferait croire que les notifications fonctionnent là
	// où rien n'est branché.
	if len(resultats) != 1 || resultats[0].Livre {
		t.Errorf("l'envoyeur inerte ne doit rien déclarer livré: %+v", resultats)
	}
}
