package handlers

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"

	"fiyen-backend/internal/notifications"
)

// Envoi des notifications depuis les handlers.
//
// Le point délicat est le **moment** de l'envoi : appeler un service tiers au
// milieu d'une requête HTTP fait dépendre le temps de réponse de l'opérateur
// de la disponibilité d'Expo. L'assignation d'une course doit répondre tout de
// suite ; la notification part derrière.

// delaiNotification borne un envoi lancé en arrière-plan. Le contexte de la
// requête ne convient pas : Fiber l'annule dès la réponse envoyée, ce qui
// couperait l'appel à peine commencé.
const delaiNotification = 15 * time.Second

// notifierUtilisateur expédie une notification à tous les appareils d'une
// personne, **sans bloquer l'appelant**.
//
// Le couple (évènement, cible) est consulté dans la politique : ce qui n'y
// figure pas ne part pas. Ajouter une notification doit être une décision
// prise dans `politique.go`, pas un effet de bord d'un appel oublié ici.
//
// Les échecs sont journalisés et non remontés : une notification perdue ne
// doit pas faire échouer l'assignation d'une course, qui elle a bien eu lieu.
func (d *Deps) notifierUtilisateur(
	utilisateurID uuid.UUID,
	evt notifications.Evenement,
	cible notifications.Cible,
	n notifications.Notification,
) {
	if d.Notifications == nil {
		return
	}

	// Aucun canal prévu : il n'y a rien à faire, et surtout rien à journaliser
	// — c'est le cas de la plupart des couples.
	if !contient(notifications.CanauxPour(evt, cible), notifications.CanalPush) {
		return
	}

	go func() {
		ctx, annuler := context.WithTimeout(context.Background(), delaiNotification)
		defer annuler()

		jetons, err := d.jetonsDe(ctx, utilisateurID)
		if err != nil {
			log.Printf("notification : lecture des jetons de %s échouée : %v", utilisateurID, err)
			return
		}
		if len(jetons) == 0 {
			// Cas courant et normal : le livreur n'a pas encore ouvert
			// l'application mobile, ou n'a pas accordé la permission.
			return
		}

		resultats, err := d.Notifications.Envoyer(ctx, jetons, n)
		if err != nil {
			log.Printf("notification : envoi échoué pour %s : %v", utilisateurID, err)
			// Les résultats partiels restent exploitables : un lot a pu partir
			// avant la panne.
		}

		d.oublierJetonsMorts(ctx, resultats)
	}()
}

func (d *Deps) jetonsDe(ctx context.Context, utilisateurID uuid.UUID) ([]string, error) {
	rows, err := d.DB.Query(ctx,
		`SELECT jeton FROM jetons_push WHERE utilisateur_id = $1`, utilisateurID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jetons := []string{}
	for rows.Next() {
		var j string
		if err := rows.Scan(&j); err != nil {
			return nil, err
		}
		jetons = append(jetons, j)
	}
	return jetons, rows.Err()
}

// oublierJetonsMorts retire les appareils qui ne peuvent plus rien recevoir.
//
// Sans ce ménage, la table se remplit d'adresses mortes : chaque envoi
// coûterait de plus en plus cher pour un nombre de livraisons constant, et les
// journaux se rempliraient d'échecs sans intérêt.
func (d *Deps) oublierJetonsMorts(ctx context.Context, resultats []notifications.Resultat) {
	morts := []string{}
	for _, r := range resultats {
		if r.JetonMort {
			morts = append(morts, r.Jeton)
		}
	}
	if len(morts) == 0 {
		return
	}

	if _, err := d.DB.Exec(ctx,
		`DELETE FROM jetons_push WHERE jeton = ANY($1)`, morts); err != nil {
		log.Printf("notification : purge de %d jeton(s) mort(s) échouée : %v", len(morts), err)
		return
	}
	log.Printf("notification : %d appareil(s) hors service oublié(s)", len(morts))
}

// notifierLivreurAssignation prévient un livreur qu'une course lui est confiée.
//
// C'est la notification qui justifie toute la phase : sans elle, le livreur
// doit regarder son écran pour savoir qu'une course l'attend, et elle reste en
// file pendant qu'il fait autre chose.
func (d *Deps) notifierLivreurAssignation(livreurID uuid.UUID, courseID uuid.UUID, numero int, arrivee string) {
	ctx, annuler := context.WithTimeout(context.Background(), 5*time.Second)
	defer annuler()

	// Le compte du livreur, pas le livreur : les jetons sont rattachés à un
	// utilisateur, seul porteur d'une session sur un appareil.
	var utilisateurID uuid.UUID
	if err := d.DB.QueryRow(ctx,
		`SELECT id FROM utilisateurs WHERE livreur_id = $1`, livreurID).
		Scan(&utilisateurID); err != nil {
		// Un livreur sans compte est possible : la compagnie l'a créé mais il
		// ne s'est jamais connecté. Rien à notifier.
		return
	}

	d.notifierUtilisateur(
		utilisateurID,
		notifications.EvtCourseAssignee,
		notifications.CibleLivreur,
		notifications.Notification{
			Titre: "Nouvelle course " + FormaterNumero(numero),
			// L'adresse d'arrivée plutôt que celle de départ : c'est elle qui dit
			// au livreur si la course l'arrange, avant même d'ouvrir l'app.
			Corps: "Livraison vers " + arrivee,
			Donnees: map[string]string{
				"type":      string(notifications.EvtCourseAssignee),
				"course_id": courseID.String(),
			},
		},
	)
}

func contient(canaux []notifications.Canal, cherche notifications.Canal) bool {
	for _, c := range canaux {
		if c == cherche {
			return true
		}
	}
	return false
}
