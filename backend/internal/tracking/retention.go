package tracking

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Rétention des traces de position.
//
// `traces_positions` grossit de ~7 000 lignes par livreur et par jour : vingt
// livreurs, quatre millions de lignes par mois. Sans purge, la base devient
// l'objet le plus lourd du produit, pour des données dont la valeur tombe vite
// — un trajet se consulte dans les jours qui suivent une livraison.
//
// Le journal (`evenements_course`) et les preuves ne sont **pas** concernés :
// ce sont des pièces, pas de la télémétrie.
//
// Conséquence à connaître : le rejeu d'un trajet (5.7) d'une course plus
// ancienne que la rétention n'a plus de points à montrer.

// DureeRetentionParDefaut : assez pour qu'une contestation de livraison ait le
// temps d'arriver, assez court pour que la table reste maniable.
const DureeRetentionParDefaut = 90 * 24 * time.Hour

// IntervalleRetentionParDefaut sert de repli quand la configuration est invalide.
const IntervalleRetentionParDefaut = 24 * time.Hour

// TailleLotRetention borne chaque suppression. Le premier passage sur une
// table déjà grosse ne doit pas tenir un verrou de ligne sur des millions de
// lignes d'un seul tenant, ni produire un unique gros journal de transaction.
const TailleLotRetention = 20_000

// Identifiant du verrou consultatif. Arbitraire mais **stable**, et distinct de
// celui de la purge des sessions (`auth`) : deux tâches sans rapport ne doivent
// pas s'exclure.
const cleVerrouRetention int64 = 8_140_926

// ErrRetentionConcurrente signale qu'une autre instance tient déjà le verrou.
// Fonctionnement normal d'un service scalé horizontalement, pas un incident.
var ErrRetentionConcurrente = errors.New("rétention déjà en cours sur une autre instance")

// PurgerTraces supprime les traces plus anciennes que `duree`, par lots, et
// rend le nombre de lignes supprimées.
//
// `duree` nulle ou négative est **refusée** : `now() - 0` supprimerait toute la
// table. Une variable d'environnement mal renseignée ne doit jamais pouvoir
// effacer le trajet de tous les livreurs.
func PurgerTraces(ctx context.Context, pool *pgxpool.Pool, duree time.Duration) (int64, error) {
	if duree <= 0 {
		return 0, fmt.Errorf("durée de rétention invalide : %s", duree)
	}

	// Verrou de **session** sur une connexion dédiée, et non `_xact_lock` comme
	// pour les sessions : la suppression se fait en plusieurs transactions (un
	// lot chacune), or le verrou doit couvrir l'ensemble — sinon deux instances
	// se répartiraient les lots et se gêneraient. Il est relâché explicitement,
	// et de toute façon à la fermeture de la connexion si le processus tombe.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return 0, fmt.Errorf("connexion de rétention: %w", err)
	}
	defer conn.Release()

	var obtenu bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, cleVerrouRetention).
		Scan(&obtenu); err != nil {
		return 0, fmt.Errorf("verrou de rétention: %w", err)
	}
	if !obtenu {
		return 0, ErrRetentionConcurrente
	}
	defer func() {
		// Contexte propre : si celui du passage est annulé, le verrou doit
		// quand même être relâché avant que la connexion retourne au pool —
		// sinon il resterait accroché à une connexion recyclée.
		liberation, annuler := context.WithTimeout(context.Background(), 5*time.Second)
		defer annuler()
		_, _ = conn.Exec(liberation, `SELECT pg_advisory_unlock($1)`, cleVerrouRetention)
	}()

	// La borne est calculée **une fois** : un passage long ne doit pas voir sa
	// frontière avancer d'un lot à l'autre.
	limite := time.Now().Add(-duree)

	var total int64
	for {
		tag, err := conn.Exec(ctx, `
			DELETE FROM traces_positions
			WHERE id IN (
				SELECT id FROM traces_positions
				WHERE horodatage < $1
				ORDER BY horodatage
				LIMIT $2
			)
		`, limite, TailleLotRetention)
		if err != nil {
			return total, err
		}
		total += tag.RowsAffected()

		if tag.RowsAffected() < TailleLotRetention {
			return total, nil
		}
	}
}

// PurgerTracesPeriodiquement applique la rétention jusqu'à l'annulation du
// contexte. Bloquant — à lancer dans une goroutine. Un premier passage a lieu
// immédiatement : sur un service redémarré souvent, attendre le premier
// intervalle reviendrait à ne jamais purger.
func PurgerTracesPeriodiquement(ctx context.Context, pool *pgxpool.Pool, duree, intervalle time.Duration, journal *log.Logger) {
	// `time.NewTicker` panique sur un intervalle nul ou négatif, et une durée
	// nulle viderait la table : dans les deux cas on retombe sur le défaut et on
	// le dit, plutôt que de faire tomber le service ou d'effacer des données.
	if intervalle <= 0 {
		journal.Printf("rétention des traces : intervalle invalide (%s), repli sur %s",
			intervalle, IntervalleRetentionParDefaut)
		intervalle = IntervalleRetentionParDefaut
	}
	if duree <= 0 {
		journal.Printf("rétention des traces : durée invalide (%s), repli sur %s",
			duree, DureeRetentionParDefaut)
		duree = DureeRetentionParDefaut
	}

	passage := func() {
		// Plus long que pour les sessions : le premier passage sur une table
		// déjà grosse supprime des millions de lignes, lot après lot. Ce délai
		// borne le passage sans l'empêcher d'aboutir ; le suivant reprend là où
		// celui-ci s'est arrêté.
		ctxPassage, annuler := context.WithTimeout(ctx, 15*time.Minute)
		defer annuler()

		supprimees, err := PurgerTraces(ctxPassage, pool, duree)
		switch {
		case errors.Is(err, ErrRetentionConcurrente):
			journal.Println("rétention des traces : déjà en cours sur une autre instance")
		case errors.Is(err, context.Canceled):
			// Arrêt du service pendant le passage : rien à signaler.
		case err != nil:
			journal.Printf("rétention des traces échouée après %d ligne(s) : %v", supprimees, err)
		default:
			journal.Printf("rétention des traces : %d ligne(s) supprimée(s) (au-delà de %s)",
				supprimees, duree)
		}
	}

	passage()

	ticker := time.NewTicker(intervalle)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			passage()
		}
	}
}
