package notifications

import (
	"context"
	"errors"
	"testing"
)

// La politique est ce qui empêche la facture de dériver. Un SMS ajouté par
// mégarde ne se voit pas en développement — il se voit sur la note de
// l'opérateur, un mois plus tard.

func TestPolitique_LeLivreurEstJointGratuitement(t *testing.T) {
	canaux := CanauxPour(EvtCourseAssignee, CibleLivreur)

	if len(canaux) != 1 || canaux[0] != CanalPush {
		t.Fatalf("le livreur doit être joint par push seul, obtenu %v", canaux)
	}
	// Il est équipé de l'application : lui envoyer un SMS serait payer pour
	// atteindre quelqu'un qu'on atteint déjà gratuitement.
	if SMSAutorise(EvtCourseAssignee, CibleLivreur) {
		t.Error("aucun SMS ne doit partir vers un livreur")
	}
}

func TestPolitique_LePartenaireNeCoutePasDeSMS(t *testing.T) {
	for _, evt := range []Evenement{
		EvtCourseAssignee, EvtCourseRecuperee, EvtCourseEnRoute,
		EvtCourseLivree, EvtCourseAnnulee,
	} {
		if SMSAutorise(evt, CiblePartenaire) {
			t.Errorf("%s : le partenaire suit son écran en direct, aucun SMS ne se justifie", evt)
		}
	}
}

func TestPolitique_ExactementDeuxSMSVersLeDestinataire(t *testing.T) {
	// Le plafond est le cœur de la décision : le destinataire n'a pas
	// l'application, donc le SMS est le seul canal — mais chacun coûte une
	// fraction non négligeable de la commission de la course.
	autorises := []Evenement{}
	for _, evt := range []Evenement{
		EvtCourseAssignee, EvtCourseRecuperee, EvtCourseEnRoute,
		EvtCourseLivree, EvtCourseAnnulee,
	} {
		if SMSAutorise(evt, CibleDestinataire) {
			autorises = append(autorises, evt)
		}
	}

	if len(autorises) != 2 {
		t.Fatalf("deux SMS au plus par course, obtenu %d : %v", len(autorises), autorises)
	}

	// « en route » lui dit de se rendre disponible, « livrée » clôt l'échange.
	// Les étapes intermédiaires ne changent rien pour lui.
	attendus := map[Evenement]bool{EvtCourseEnRoute: true, EvtCourseLivree: true}
	for _, evt := range autorises {
		if !attendus[evt] {
			t.Errorf("%s ne justifie pas un SMS au destinataire", evt)
		}
	}
}

func TestPolitique_UnCoupleAbsentNeDeclencheRien(t *testing.T) {
	// Un couple absent de la table est un « non » explicite : ajouter une
	// notification doit être une décision, pas un effet de bord.
	if canaux := CanauxPour(EvtCourseRecuperee, CibleLivreur); len(canaux) != 0 {
		t.Errorf("attendu aucun canal, obtenu %v", canaux)
	}
	if canaux := CanauxPour("evenement_inconnu", CibleDestinataire); len(canaux) != 0 {
		t.Errorf("un évènement inconnu ne doit rien déclencher, obtenu %v", canaux)
	}
}

// --- Garde-fou d'envoi ----------------------------------------------------

type smsEspion struct {
	appels int
}

func (s *smsEspion) Envoyer(context.Context, string, string) error {
	s.appels++
	return nil
}

func TestEnvoyeurSMS_RefuseHorsPolitique(t *testing.T) {
	espion := &smsEspion{}
	envoyeur := EnvoyeurSMSSousPolitique{Fournisseur: espion}

	err := envoyeur.Envoyer(context.Background(),
		EvtCourseRecuperee, CibleDestinataire, "+22670000000", "coucou")

	if !errors.Is(err, ErrSMSHorsPolitique) {
		t.Fatalf("attendu ErrSMSHorsPolitique, obtenu %v", err)
	}
	// Le point sensible : le fournisseur ne doit même pas être sollicité. Une
	// vérification faite après l'appel aurait déjà coûté le SMS.
	if espion.appels != 0 {
		t.Errorf("le fournisseur a été appelé %d fois hors politique", espion.appels)
	}
}

func TestEnvoyeurSMS_LaisseSortirCeQuiEstPrevu(t *testing.T) {
	espion := &smsEspion{}
	envoyeur := EnvoyeurSMSSousPolitique{Fournisseur: espion}

	if err := envoyeur.Envoyer(context.Background(),
		EvtCourseEnRoute, CibleDestinataire, "+22670000000", "Votre colis arrive"); err != nil {
		t.Fatalf("un envoi prévu doit passer: %v", err)
	}
	if espion.appels != 1 {
		t.Errorf("un seul envoi attendu, obtenu %d", espion.appels)
	}
}

func TestSMSNonConfigure_EchoueSansFaireSemblant(t *testing.T) {
	// Même parti pris que le repli PSTN du masquage : un envoi silencieusement
	// avalé ferait croire que le destinataire a été prévenu, et le défaut ne se
	// verrait qu'au moment où quelqu'un attend un colis dont on ne lui a rien dit.
	err := SMSNonConfigure{}.Envoyer(context.Background(), "+22670000000", "test")
	if !errors.Is(err, ErrSMSNonConfigure) {
		t.Errorf("attendu ErrSMSNonConfigure, obtenu %v", err)
	}
}

func TestEnvoyeurSMS_SansFournisseurEchoueAussi(t *testing.T) {
	envoyeur := EnvoyeurSMSSousPolitique{}

	// Autorisé par la politique, mais rien de branché : l'erreur doit le dire
	// plutôt que de rendre nil.
	err := envoyeur.Envoyer(context.Background(),
		EvtCourseLivree, CibleDestinataire, "+22670000000", "Colis remis")
	if !errors.Is(err, ErrSMSNonConfigure) {
		t.Errorf("attendu ErrSMSNonConfigure, obtenu %v", err)
	}
}
