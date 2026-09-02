package handlers

import (
	"context"
	"log"
	"time"

	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/evenements"
	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
)

// Canal des évènements d'une entreprise cliente.

// EvenementsPartenaireWS — le partenaire suit en direct l'avancement de ses
// commandes.
//
// Complète le rafraîchissement périodique plutôt que de le remplacer : sur un
// réseau qui vacille, la socket tombe et c'est le sondage à 20 s qui rattrape.
func (d *Deps) EvenementsPartenaireWS(conn *websocket.Conn) {
	defer conn.Close()

	claims, ok := conn.Locals("claims").(*middleware.Claims)
	if !ok || claims.PartenaireID == nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rôle non autorisé"))
		return
	}

	ctx := context.Background()

	// La portée de visibilité est relue à la connexion, pas prise du jeton :
	// le partenaire peut l'avoir changée depuis, et un jeton vit trente
	// minutes. Sans cela, le canal temps réel contournerait pendant tout ce
	// temps la règle appliquée aux listes.
	restreint, err := d.visibiliteRestreinte(ctx, claims)
	if err != nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "erreur interne"))
		return
	}

	subCtx, annuler := context.WithCancel(ctx)
	defer annuler()

	// Le partenaire n'envoie rien : cette lecture ne sert qu'à détecter la
	// fermeture de l'onglet pour libérer l'abonnement Redis.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				annuler()
				return
			}
		}
	}()

	_ = evenements.Souscrire(subCtx, d.Redis, *claims.PartenaireID, func(payload []byte) {
		if restreint {
			auteur := evenements.AuteurDe(payload)
			// Un évènement sans auteur connu passe : c'est une commande saisie
			// par la compagnie elle-même, que toute l'entreprise doit voir.
			if auteur != nil && *auteur != claims.UtilisateurID {
				return
			}
		}

		propre, ok := evenements.SansAuteur(payload)
		if !ok {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, propre); err != nil {
			annuler()
		}
	})
}

// visibiliteRestreinte dit si l'appelant ne doit voir que ses propres
// commandes. Le compte principal voit toujours tout : c'est lui qui répond de
// l'activité de son entreprise.
func (d *Deps) visibiliteRestreinte(ctx context.Context, claims *middleware.Claims) (bool, error) {
	if claims.Role != models.RoleCollaborateur {
		return false, nil
	}

	var visibilite string
	if err := d.DB.QueryRow(ctx,
		`SELECT visibilite_collaborateurs FROM partenaires WHERE id = $1`,
		*claims.PartenaireID).Scan(&visibilite); err != nil {
		return false, err
	}
	return visibilite == string(models.VisibilitePersonnelle), nil
}

// publierEvenementCourse annonce un changement d'état aux abonnés du
// partenaire concerné.
//
// Sans effet pour une course saisie par la compagnie sans partenaire : il n'y
// a personne à prévenir.
func (d *Deps) publierEvenementCourse(courseID uuid.UUID, statut models.StatutCourse) {
	if d.Redis == nil {
		return
	}

	go func() {
		// Contexte propre : celui de la requête est annulé par Fiber dès la
		// réponse envoyée, ce qui couperait la publication.
		ctx, annuler := context.WithTimeout(context.Background(), 5*time.Second)
		defer annuler()

		var (
			partenaireID    *uuid.UUID
			creePar         *uuid.UUID
			numero          int
			destinataireNom string
			adresseArrivee  string
		)
		err := d.DB.QueryRow(ctx, `
			SELECT co.partenaire_id, co.cree_par, co.numero,
			       d.nom, COALESCE(co.adresse_arrivee, '')
			FROM courses co
			JOIN destinataires d ON d.id = co.destinataire_id
			WHERE co.id = $1
		`, courseID).Scan(&partenaireID, &creePar, &numero, &destinataireNom, &adresseArrivee)
		if err != nil {
			log.Printf("évènement : lecture de la course %s échouée : %v", courseID, err)
			return
		}
		if partenaireID == nil {
			return
		}

		evt := evenements.EvenementCourse{
			Type:            evenements.TypeStatutCourse,
			CourseID:        courseID,
			Numero:          FormaterNumero(numero),
			Statut:          string(statut),
			DestinataireNom: destinataireNom,
			AdresseArrivee:  adresseArrivee,
			CreePar:         creePar,
			Horodatage:      time.Now().UTC(),
		}

		if err := evenements.Publier(ctx, d.Redis, *partenaireID, evt); err != nil {
			// Une notification perdue ne remet pas en cause le changement de
			// statut, qui a bien eu lieu. Le sondage à 20 s rattrapera.
			log.Printf("évènement : publication pour la course %s échouée : %v", courseID, err)
		}
	}()
}
