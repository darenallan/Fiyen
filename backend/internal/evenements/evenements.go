// Package evenements diffuse en direct les changements d'état d'une commande
// à l'entreprise qui l'a passée.
//
// Le partenaire suit déjà ses commandes par un rafraîchissement toutes les
// 20 s. Ce canal ne le remplace pas — il reste le filet en cas de coupure —
// mais un colis « livré » qui met vingt secondes à s'afficher donne
// l'impression d'un outil en retard sur la réalité.
package evenements

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// canalPartenaire porte les évènements d'une entreprise cliente.
//
// Un canal par partenaire et non par commande : un partenaire suit toutes ses
// livraisons depuis le même écran, et s'abonner commande par commande
// multiplierait les abonnements Redis pour rien.
func canalPartenaire(partenaireID uuid.UUID) string {
	return fmt.Sprintf("partenaire:%s:evenements", partenaireID.String())
}

// EvenementCourse annonce qu'une commande a changé d'état.
//
// Il porte de quoi mettre l'écran à jour sans nouvelle requête : le numéro
// pour l'identifier, le statut, et le nom du destinataire pour que le message
// soit lisible sans aller chercher la fiche.
type EvenementCourse struct {
	Type            string    `json:"type"`
	CourseID        uuid.UUID `json:"course_id"`
	Numero          string    `json:"numero"`
	Statut          string    `json:"statut"`
	DestinataireNom string    `json:"destinataire_nom"`
	AdresseArrivee  string    `json:"adresse_arrivee"`
	// CreePar sert au filtrage : un collaborateur dont l'entreprise a choisi la
	// visibilité « personnelle » ne doit recevoir que ses propres commandes.
	// Sans ce champ, le canal temps réel contournerait la règle appliquée aux
	// listes.
	CreePar    *uuid.UUID `json:"-"`
	Horodatage time.Time  `json:"horodatage"`
}

// TypeStatutCourse est le seul type d'évènement pour l'instant. Le champ
// existe pour que le front puisse ignorer ce qu'il ne connaît pas, plutôt que
// de supposer que tout message a la même forme.
const TypeStatutCourse = "statut_course"

// Publier diffuse un évènement aux abonnés du partenaire.
//
// L'échec n'est pas remonté comme fatal par l'appelant : une notification
// perdue ne doit pas faire échouer le changement de statut, qui lui a bien eu
// lieu. Le rafraîchissement périodique rattrapera.
func Publier(ctx context.Context, rdb *redis.Client, partenaireID uuid.UUID, evt EvenementCourse) error {
	// Sérialisation avec le champ interne : les abonnés le retirent avant de
	// transmettre au front, mais le filtrage en a besoin.
	type surLeFil struct {
		EvenementCourse
		CreePar *uuid.UUID `json:"cree_par,omitempty"`
	}

	payload, err := json.Marshal(surLeFil{EvenementCourse: evt, CreePar: evt.CreePar})
	if err != nil {
		return fmt.Errorf("sérialisation de l'évènement: %w", err)
	}
	return rdb.Publish(ctx, canalPartenaire(partenaireID), payload).Err()
}

// Souscrire écoute les évènements d'un partenaire jusqu'à l'annulation du
// contexte.
func Souscrire(ctx context.Context, rdb *redis.Client, partenaireID uuid.UUID, onMessage func([]byte)) error {
	sub := rdb.Subscribe(ctx, canalPartenaire(partenaireID))
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			onMessage([]byte(msg.Payload))
		}
	}
}

// AuteurDe extrait l'auteur d'un évènement sérialisé, pour le filtrage.
//
// Rendre `nil` quand le champ manque plutôt qu'une erreur : un évènement sans
// auteur connu est diffusé à toute l'entreprise, ce qui est le comportement
// par défaut et le moins surprenant.
func AuteurDe(payload []byte) *uuid.UUID {
	var recu struct {
		CreePar *uuid.UUID `json:"cree_par"`
	}
	if err := json.Unmarshal(payload, &recu); err != nil {
		return nil
	}
	return recu.CreePar
}

// SansAuteur retire le champ de filtrage avant transmission au front.
//
// Le front n'a pas à savoir qui a passé la commande pour afficher un statut,
// et l'information n'a rien à faire sur le fil d'un collaborateur qui n'y a
// pas droit.
func SansAuteur(payload []byte) ([]byte, bool) {
	var evt EvenementCourse
	if err := json.Unmarshal(payload, &evt); err != nil {
		// Message illisible : mieux vaut ne rien transmettre que transmettre un
		// contenu dont on ne sait pas ce qu'il porte.
		return nil, false
	}
	propre, err := json.Marshal(evt)
	if err != nil {
		return nil, false
	}
	return propre, true
}
