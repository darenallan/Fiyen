package masquage_test

import (
	"encoding/json"
	"testing"
)

// serialiser rend la forme JSON exacte qu'un front recevrait.
//
// Les contrôles de fuite portent sur cette chaîne plutôt que sur les champs un
// à un : un champ ajouté plus tard à la structure — un `livreur_id` « pratique
// pour le debug », par exemple — serait attrapé sans qu'il faille penser à
// mettre le test à jour.
func serialiser(t *testing.T, v any) string {
	t.Helper()
	brut, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("sérialisation: %v", err)
	}
	return string(brut)
}
