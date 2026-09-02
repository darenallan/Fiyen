package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// La garantie centrale du produit veut que le destinataire ne connaisse jamais
// l'identifiant de son livreur. Le canal Redis, lui, transporte cet
// identifiant : la vue flotte de la compagnie en a besoin. C'est donc au
// moment du relais que la frontière se franchit, et ces tests la gardent.

func TestAnonymiserPosition_RetireLIdentifiantDuLivreur(t *testing.T) {
	livreurID := uuid.New()
	brut, err := json.Marshal(map[string]any{
		"livreur_id": livreurID,
		"latitude":   12.3714,
		"longitude":  -1.5197,
		"horodatage": time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("préparation: %v", err)
	}

	sortie, ok := anonymiserPosition(brut)
	if !ok {
		t.Fatal("une position valide doit être relayée")
	}

	if strings.Contains(string(sortie), livreurID.String()) {
		t.Errorf("l'identifiant du livreur fuit vers le destinataire: %s", sortie)
	}
	if strings.Contains(string(sortie), "livreur_id") {
		t.Errorf("le champ livreur_id ne doit pas subsister: %s", sortie)
	}
}

func TestAnonymiserPosition_ConserveLaPosition(t *testing.T) {
	horodatage := time.Date(2026, 8, 22, 14, 30, 0, 0, time.UTC)
	brut, _ := json.Marshal(map[string]any{
		"livreur_id": uuid.New(),
		"latitude":   12.3714,
		"longitude":  -1.5197,
		"horodatage": horodatage,
	})

	sortie, ok := anonymiserPosition(brut)
	if !ok {
		t.Fatal("relais attendu")
	}

	var pos positionAnonyme
	if err := json.Unmarshal(sortie, &pos); err != nil {
		t.Fatalf("sortie illisible: %v", err)
	}

	// Retirer l'identité ne doit pas dégrader le suivi : c'est tout l'intérêt
	// du canal, et une coordonnée arrondie déplacerait le point sur la carte.
	if pos.Latitude != 12.3714 || pos.Longitude != -1.5197 {
		t.Errorf("coordonnées altérées: %+v", pos)
	}
	if !pos.Horodatage.Equal(horodatage) {
		t.Errorf("horodatage altéré: %v", pos.Horodatage)
	}
}

func TestAnonymiserPosition_MessageIllisibleNonRelaye(t *testing.T) {
	// Plutôt que de laisser passer un contenu dont on ignore ce qu'il porte :
	// un payload non conforme pourrait contenir n'importe quoi d'autre.
	if _, ok := anonymiserPosition([]byte("{pas du json")); ok {
		t.Error("un message illisible ne doit pas être relayé")
	}
	if _, ok := anonymiserPosition(nil); ok {
		t.Error("un message vide ne doit pas être relayé")
	}
}

func TestFormaterNumero_LisibleAuTelephone(t *testing.T) {
	// Le numéro sert à être dicté : « FY tiret mille quarante-deux ». Un
	// changement de format casserait les numéros déjà communiqués aux clients.
	if got := FormaterNumero(1042); got != "FY-1042" {
		t.Errorf("FormaterNumero(1042) = %q, attendu \"FY-1042\"", got)
	}
	if got := FormaterNumero(1001); got != "FY-1001" {
		t.Errorf("FormaterNumero(1001) = %q", got)
	}
}
