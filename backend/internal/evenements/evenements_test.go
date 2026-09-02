package evenements_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"fiyen-backend/internal/evenements"
	"fiyen-backend/internal/testdb"
)

// Le canal porte l'auteur d'une commande pour permettre le filtrage par
// visibilité, mais cet auteur ne doit jamais atteindre le front : un
// collaborateur n'a pas à savoir qui, dans son entreprise, a passé quelle
// commande — c'est justement la règle que le filtrage applique.

func evenementDeTest(auteur *uuid.UUID) evenements.EvenementCourse {
	return evenements.EvenementCourse{
		Type:            evenements.TypeStatutCourse,
		CourseID:        uuid.New(),
		Numero:          "FY-1042",
		Statut:          "en_route",
		DestinataireNom: "Awa Ouédraogo",
		AdresseArrivee:  "Zone du Bois, rue 15.42",
		CreePar:         auteur,
		Horodatage:      time.Now().UTC(),
	}
}

func TestPublierEtSouscrire(t *testing.T) {
	rdb := testdb.OuvrirRedis(t)
	partenaire := uuid.New()

	ctx, annuler := context.WithCancel(context.Background())
	defer annuler()

	recu := make(chan []byte, 1)
	pret := make(chan struct{})
	go func() {
		close(pret)
		_ = evenements.Souscrire(ctx, rdb, partenaire, func(p []byte) {
			select {
			case recu <- p:
			default:
			}
		})
	}()
	<-pret
	// L'abonnement Redis n'est pas immédiat : publier trop tôt perdrait le
	// message et rendrait le test capricieux.
	time.Sleep(300 * time.Millisecond)

	evt := evenementDeTest(nil)
	if err := evenements.Publier(ctx, rdb, partenaire, evt); err != nil {
		t.Fatalf("publication: %v", err)
	}

	select {
	case payload := <-recu:
		var lu evenements.EvenementCourse
		if err := json.Unmarshal(payload, &lu); err != nil {
			t.Fatalf("évènement illisible: %v", err)
		}
		if lu.Numero != "FY-1042" || lu.Statut != "en_route" {
			t.Errorf("évènement altéré: %+v", lu)
		}
		if lu.DestinataireNom != "Awa Ouédraogo" {
			t.Errorf("le destinataire doit permettre d'afficher un message lisible sans requête: %+v", lu)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("aucun évènement reçu")
	}
}

func TestCloisonnementEntrePartenaires(t *testing.T) {
	rdb := testdb.OuvrirRedis(t)
	a, b := uuid.New(), uuid.New()

	ctx, annuler := context.WithCancel(context.Background())
	defer annuler()

	recu := make(chan []byte, 1)
	go func() {
		_ = evenements.Souscrire(ctx, rdb, b, func(p []byte) {
			select {
			case recu <- p:
			default:
			}
		})
	}()
	time.Sleep(300 * time.Millisecond)

	if err := evenements.Publier(ctx, rdb, a, evenementDeTest(nil)); err != nil {
		t.Fatalf("publication: %v", err)
	}

	// Un canal par partenaire : une entreprise ne doit rien apprendre de
	// l'activité d'une autre.
	select {
	case payload := <-recu:
		t.Errorf("fuite entre partenaires: %s", payload)
	case <-time.After(1200 * time.Millisecond):
	}
}

func TestAuteurDe_LuPourLeFiltrage(t *testing.T) {
	rdb := testdb.OuvrirRedis(t)
	auteur := uuid.New()
	partenaire := uuid.New()

	ctx, annuler := context.WithCancel(context.Background())
	defer annuler()

	recu := make(chan []byte, 1)
	go func() {
		_ = evenements.Souscrire(ctx, rdb, partenaire, func(p []byte) {
			select {
			case recu <- p:
			default:
			}
		})
	}()
	time.Sleep(300 * time.Millisecond)

	if err := evenements.Publier(ctx, rdb, partenaire, evenementDeTest(&auteur)); err != nil {
		t.Fatalf("publication: %v", err)
	}

	select {
	case payload := <-recu:
		lu := evenements.AuteurDe(payload)
		if lu == nil || *lu != auteur {
			t.Errorf("l'auteur doit survivre au transport pour permettre le filtrage: %v", lu)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("aucun évènement reçu")
	}
}

func TestSansAuteur_NeLaissePasFuiterLAuteur(t *testing.T) {
	auteur := uuid.New()

	// On reconstruit le payload tel qu'il circule sur Redis.
	brut, err := json.Marshal(struct {
		evenements.EvenementCourse
		CreePar *uuid.UUID `json:"cree_par,omitempty"`
	}{EvenementCourse: evenementDeTest(&auteur), CreePar: &auteur})
	if err != nil {
		t.Fatalf("préparation: %v", err)
	}

	propre, ok := evenements.SansAuteur(brut)
	if !ok {
		t.Fatal("un évènement valide doit être transmissible")
	}

	// Le point sensible : le front reçoit le statut, pas l'identité de celui
	// qui a commandé.
	if strings.Contains(string(propre), auteur.String()) {
		t.Errorf("l'auteur fuit vers le front: %s", propre)
	}
	if strings.Contains(string(propre), "cree_par") {
		t.Errorf("le champ de filtrage ne doit pas subsister: %s", propre)
	}
	// ...sans perdre ce qui sert à l'affichage.
	if !strings.Contains(string(propre), "FY-1042") {
		t.Errorf("le numéro doit être conservé: %s", propre)
	}
}

func TestSansAuteur_MessageIllisibleNonTransmis(t *testing.T) {
	if _, ok := evenements.SansAuteur([]byte("{pas du json")); ok {
		t.Error("un message illisible ne doit pas être transmis")
	}
	if _, ok := evenements.SansAuteur(nil); ok {
		t.Error("un message vide ne doit pas être transmis")
	}
}

func TestAuteurDe_AbsenceSignifieToutLeMonde(t *testing.T) {
	brut, _ := json.Marshal(evenementDeTest(nil))

	// Une commande saisie par la compagnie elle-même n'a pas d'auteur côté
	// partenaire : elle doit être visible de toute l'entreprise plutôt que
	// masquée à tous.
	if auteur := evenements.AuteurDe(brut); auteur != nil {
		t.Errorf("un évènement sans auteur doit rendre nil, obtenu %v", auteur)
	}
}
