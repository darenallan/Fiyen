package notifications

import (
	"context"
	"errors"
	"fmt"
)

// Politique de choix du canal.
//
// Le push est gratuit, le SMS est payant. Au Burkina Faso, un SMS coûte une
// fraction non négligeable de la commission d'une course : en envoyer un à
// chaque changement de statut reviendrait à payer pour prévenir, et à le payer
// plus cher que ce que la course rapporte.
//
// D'où une table **explicite** plutôt qu'une règle éparpillée dans les
// handlers : ce qui coûte de l'argent doit se lire d'un coup d'œil, et se
// modifier à un seul endroit.

// Canal par lequel une notification peut partir.
type Canal string

const (
	// CanalPush passe par le service de notifications. Gratuit.
	CanalPush Canal = "push"
	// CanalSMS passe par un opérateur. **Payant, et facturé à l'unité.**
	CanalSMS Canal = "sms"
)

// Evenement identifie ce qui vient de se produire.
type Evenement string

const (
	EvtCourseAssignee  Evenement = "course_assignee"
	EvtCourseRecuperee Evenement = "course_recuperee"
	EvtCourseEnRoute   Evenement = "course_en_route"
	EvtCourseLivree    Evenement = "course_livree"
	EvtCourseAnnulee   Evenement = "course_annulee"
)

// Cible désigne qui doit être prévenu. Distincte du rôle applicatif : c'est
// une question d'équipement, pas de droits.
type Cible string

const (
	// CibleLivreur a l'application : il est joignable gratuitement.
	CibleLivreur Cible = "livreur"
	// CiblePartenaire a l'application web ouverte pendant sa journée.
	CiblePartenaire Cible = "partenaire"
	// CibleDestinataire n'a **probablement pas** l'application : c'est un
	// particulier qui reçoit un colis, pas un utilisateur du produit.
	CibleDestinataire Cible = "destinataire"
)

type regle struct {
	evenement Evenement
	cible     Cible
}

// canaux dit par quoi joindre chacun, pour chaque évènement.
//
// Un couple absent de cette table ne déclenche **rien**. C'est délibéré :
// ajouter une notification doit être une décision, pas un effet de bord.
var canaux = map[regle][]Canal{
	// Le livreur est équipé et en service : le push suffit, et c'est la
	// notification qui justifie toute la phase.
	{EvtCourseAssignee, CibleLivreur}: {CanalPush},

	// Le partenaire suit son écran en direct (canal WebSocket). Le push le
	// rattrape quand il a fermé l'onglet.
	{EvtCourseAssignee, CiblePartenaire}: {CanalPush},
	{EvtCourseEnRoute, CiblePartenaire}:  {CanalPush},
	{EvtCourseLivree, CiblePartenaire}:   {CanalPush},
	{EvtCourseAnnulee, CiblePartenaire}:  {CanalPush},

	// Le destinataire n'a pas l'application. Deux SMS, pas un de plus :
	//   — « en route » lui dit de se rendre disponible ;
	//   — « livrée » clôt l'échange et sert de preuve.
	// Les étapes intermédiaires ne changent rien pour lui et coûteraient le
	// prix d'un SMS chacune.
	{EvtCourseEnRoute, CibleDestinataire}: {CanalSMS},
	{EvtCourseLivree, CibleDestinataire}:  {CanalSMS},
}

// CanauxPour rend les canaux à emprunter pour un couple donné.
//
// Une tranche vide veut dire « ne rien envoyer », et c'est un résultat normal :
// la plupart des couples ne méritent aucune notification.
func CanauxPour(evt Evenement, cible Cible) []Canal {
	return canaux[regle{evt, cible}]
}

// SMSAutorise dit si la politique prévoit un SMS pour ce couple.
//
// Sert de garde-fou au fournisseur : un appelant qui demanderait un SMS hors
// politique se le verra refuser. Sans ce contrôle, une seule ligne ajoutée
// ailleurs pourrait multiplier la facture sans que personne ne s'en aperçoive
// avant de la recevoir.
func SMSAutorise(evt Evenement, cible Cible) bool {
	for _, c := range CanauxPour(evt, cible) {
		if c == CanalSMS {
			return true
		}
	}
	return false
}

// ErrSMSHorsPolitique signale une demande d'envoi que la politique n'autorise
// pas.
var ErrSMSHorsPolitique = errors.New("envoi SMS non prévu pour cet évènement")

// ErrSMSNonConfigure signale qu'aucun opérateur n'est branché.
var ErrSMSNonConfigure = errors.New("aucune passerelle SMS configurée")

// FournisseurSMS envoie un message court à un numéro.
//
// Le numéro n'est jamais stocké en clair côté Fiyen : l'appelant doit le
// fournir au moment de l'envoi, et il ne transite pas par les journaux.
type FournisseurSMS interface {
	Envoyer(ctx context.Context, telephone string, texte string) error
}

// SMSNonConfigure est le fournisseur par défaut.
//
// Il **échoue explicitement** au lieu de faire semblant, comme le repli PSTN du
// masquage. Un envoi silencieusement avalé ferait croire que le destinataire a
// été prévenu, et le défaut ne se verrait qu'au moment où quelqu'un attend un
// colis dont on ne lui a rien dit.
//
// Pour l'activer : implémenter cette interface avec un opérateur couvrant le
// Burkina Faso, et vérifier le coût unitaire réel avant d'élargir la politique.
type SMSNonConfigure struct{}

func (SMSNonConfigure) Envoyer(context.Context, string, string) error {
	return ErrSMSNonConfigure
}

// EnvoyeurSMSSousPolitique enveloppe un fournisseur et refuse tout envoi que la
// politique ne prévoit pas.
//
// La vérification est ici plutôt que chez l'appelant : un handler qui
// oublierait de la faire enverrait des SMS hors budget, et rien ne s'y
// opposerait.
type EnvoyeurSMSSousPolitique struct {
	Fournisseur FournisseurSMS
}

func (e EnvoyeurSMSSousPolitique) Envoyer(
	ctx context.Context, evt Evenement, cible Cible, telephone, texte string,
) error {
	if !SMSAutorise(evt, cible) {
		return fmt.Errorf("%w: %s vers %s", ErrSMSHorsPolitique, evt, cible)
	}
	if e.Fournisseur == nil {
		return ErrSMSNonConfigure
	}
	return e.Fournisseur.Envoyer(ctx, telephone, texte)
}
