// Package notifications porte l'envoi de notifications push.
//
// Le service d'envoi est derrière une interface : les tests ne doivent pas
// appeler exp.host, et une compagnie qui voudrait un autre fournisseur ne doit
// pas avoir à toucher aux handlers.
package notifications

import (
	"context"
	"fmt"
)

// Notification est ce qu'on demande d'afficher. Volontairement pauvre : ni
// image, ni action, ni son personnalisé. Un livreur en course a besoin de
// savoir qu'une course l'attend, pas d'une mise en scène.
type Notification struct {
	Titre string
	Corps string
	// Donnees accompagne la notification sans être affichée. Sert à ouvrir
	// l'application sur le bon écran.
	Donnees map[string]string
}

// Resultat dit ce qu'il est advenu d'un jeton.
type Resultat struct {
	Jeton string
	// Livre vaut faux dès que le service a refusé le message.
	Livre bool
	// JetonMort signale un appareil qui ne peut plus rien recevoir :
	// désinstallation, réinitialisation. L'appelant doit alors oublier ce
	// jeton, sans quoi la table se remplit d'adresses mortes.
	JetonMort bool
	Message   string
}

// Envoyeur expédie une notification à un ensemble d'appareils.
//
// L'implémentation ne doit pas rendre d'erreur pour un jeton refusé : un
// appareil hors service n'est pas une panne du système. Seule une erreur de
// transport (réseau, service indisponible) remonte.
type Envoyeur interface {
	Envoyer(ctx context.Context, jetons []string, n Notification) ([]Resultat, error)
}

// EnvoyeurInerte n'envoie rien et le dit.
//
// Sert de valeur par défaut là où aucun envoyeur n'est branché — les tests
// d'autres paquets, par exemple. Il rend un résultat « non livré » plutôt que
// de prétendre au succès : un envoi silencieusement perdu ferait croire que
// les notifications fonctionnent.
type EnvoyeurInerte struct{}

func (EnvoyeurInerte) Envoyer(_ context.Context, jetons []string, _ Notification) ([]Resultat, error) {
	resultats := make([]Resultat, 0, len(jetons))
	for _, j := range jetons {
		resultats = append(resultats, Resultat{
			Jeton:   j,
			Livre:   false,
			Message: "aucun service de notification configuré",
		})
	}
	return resultats, nil
}

// ErrLotTropGrand signale un dépassement du plafond imposé par le service.
var ErrLotTropGrand = fmt.Errorf("lot de notifications trop grand")
