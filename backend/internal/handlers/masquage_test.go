package handlers

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"fiyen-backend/internal/masquage"
)

// Ces tests portent sur la couche HTTP et sur le protocole du canal : ce que
// le client apprend d'une erreur, et ce qu'il peut faire dire au serveur.

// --- Traduction des erreurs -----------------------------------------------

func statutDe(t *testing.T, err error) int {
	t.Helper()
	var fe *fiber.Error
	if !errors.As(err, &fe) {
		t.Fatalf("erreur non-Fiber: %v", err)
	}
	return fe.Code
}

func TestErreurMasquage_IntrouvableEtRefuseIndistinguables(t *testing.T) {
	introuvable := erreurMasquage(masquage.ErrSessionIntrouvable)
	refuse := erreurMasquage(masquage.ErrAccesRefuse)

	// La garantie : un curieux ne doit pas pouvoir distinguer « cette course
	// n'existe pas » de « elle existe mais n'est pas la vôtre ». Sinon il
	// énumère les courses de la plateforme avec un simple compte client.
	if statutDe(t, introuvable) != fiber.StatusNotFound {
		t.Errorf("introuvable = %d, attendu 404", statutDe(t, introuvable))
	}
	if statutDe(t, refuse) != fiber.StatusNotFound {
		t.Errorf("accès refusé = %d, attendu 404", statutDe(t, refuse))
	}
	if introuvable.Error() != refuse.Error() {
		t.Errorf("les deux messages doivent être identiques:\n  %q\n  %q",
			introuvable.Error(), refuse.Error())
	}
}

func TestErreurMasquage_ExpireeEstDistincte(t *testing.T) {
	// Ici la distinction est voulue : le canal a existé, l'utilisateur y avait
	// droit, et il doit comprendre que la course est terminée plutôt que de
	// croire à une panne.
	if got := statutDe(t, erreurMasquage(masquage.ErrSessionExpiree)); got != fiber.StatusGone {
		t.Errorf("expirée = %d, attendu 410", got)
	}
}

func TestErreurMasquage_ErreurInconnueNeFuitPas(t *testing.T) {
	err := erreurMasquage(errors.New("pq: relation \"sessions_masquage\" does not exist"))

	if got := statutDe(t, err); got != fiber.StatusInternalServerError {
		t.Errorf("erreur inconnue = %d, attendu 500", got)
	}
	// Le détail technique ne doit pas remonter au client.
	if strings.Contains(err.Error(), "sessions_masquage") {
		t.Errorf("le message interne fuit vers le client: %q", err.Error())
	}
}

// --- Protocole du canal ---------------------------------------------------

// L'usurpation d'expéditeur est vérifiée là où elle compte, sur le vrai
// handler : voir TestWS_ExpediteurNonUsurpable. Un test qui se contenterait de
// décoder la structure ici passerait même si MasquageWS reprenait le champ
// annoncé par le client.

func TestTypesSignaling_LimitesAuxPrimitivesWebRTC(t *testing.T) {
	for _, attendu := range []string{"offre", "reponse", "ice"} {
		if !typesSignaling[attendu] {
			t.Errorf("%q doit être relayé", attendu)
		}
	}
	// Tout le reste est ignoré par MasquageWS : le canal n'est pas un
	// transport générique dans lequel on pourrait glisser autre chose.
	for _, refuse := range []string{"message", "appel", "systeme", "", "OFFRE", "eval"} {
		if typesSignaling[refuse] {
			t.Errorf("%q ne doit pas être traité comme du signaling", refuse)
		}
	}
}

func TestEvenementCanal_SignalNonPersiste(t *testing.T) {
	// Le signaling WebRTC est relayé tel quel mais jamais conservé : la
	// structure de sortie d'un signal ne porte ni id ni horodatage, ce qui
	// distingue à l'œil un évènement relayé d'un message enregistré.
	evt := evenementCanal{
		Type:       "offre",
		Signal:     json.RawMessage(`{"sdp":"v=0"}`),
		Expediteur: "client",
	}
	sortie := serialiserEvt(t, evt)

	if strings.Contains(sortie, `"id"`) || strings.Contains(sortie, "created_at") {
		t.Errorf("un signal relayé ne doit porter ni id ni horodatage: %s", sortie)
	}
	if !strings.Contains(sortie, "sdp") {
		t.Errorf("le contenu du signal doit être relayé intact: %s", sortie)
	}
}

func TestEvenementCanal_ChampsVidesOmis(t *testing.T) {
	// Un message ne traîne pas un champ `signal` vide, et inversement : sur un
	// réseau facturé au volume, chaque octet répété à 3-5 s compte.
	msg := serialiserEvt(t, evenementCanal{Type: "message", Contenu: "ok", Expediteur: "client"})
	if strings.Contains(msg, "signal") {
		t.Errorf("un message ne doit pas porter de champ signal: %s", msg)
	}
}

func TestTailleMaxMessage_AlignéeSurLaContrainteSQL(t *testing.T) {
	// La contrainte du schéma est `length(contenu) BETWEEN 1 AND 1000`. Si les
	// deux divergent, le handler tronque à une taille que la base refuse et le
	// message est perdu sans explication.
	if tailleMaxMessage != 1000 {
		t.Errorf("tailleMaxMessage = %d, la contrainte SQL impose 1000", tailleMaxMessage)
	}
}

func serialiserEvt(t *testing.T, evt evenementCanal) string {
	t.Helper()
	brut, err := json.Marshal(evt)
	if err != nil {
		t.Fatalf("sérialisation: %v", err)
	}
	return string(brut)
}
