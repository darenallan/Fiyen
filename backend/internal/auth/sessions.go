// Package auth gère les sessions longues : émission, rotation et révocation
// des jetons de renouvellement.
//
// Séparation des rôles entre les deux jetons :
//   - le **jeton d'accès** (JWT) est court et non révocable — il porte les
//     droits et évite d'interroger la base à chaque requête ;
//   - le **jeton de renouvellement** est long et révocable — il vit en base et
//     permet de couper une session compromise.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrJetonInvalide = errors.New("jeton de renouvellement invalide")
	ErrJetonExpire   = errors.New("jeton de renouvellement expiré")
	// ErrJetonRejoue signale la présentation d'un jeton déjà remplacé : le
	// signe qu'il a été volé. Toute la chaîne est alors révoquée.
	ErrJetonRejoue = errors.New("jeton de renouvellement déjà utilisé")
	// ErrPurgeConcurrente signale qu'une autre instance tient déjà le verrou.
	// Ce n'est pas un incident : c'est le fonctionnement normal d'un service
	// scalé horizontalement, et l'appelant doit le traiter comme tel.
	ErrPurgeConcurrente = errors.New("purge déjà en cours sur une autre instance")
)

// Identifiant du verrou consultatif de la purge. Arbitraire mais **stable** :
// deux instances ne se reconnaissent que si elles emploient le même nombre.
const cleVerrouPurge int64 = 8_140_925

// IntervallePurgeParDefaut sert de repli quand la configuration est invalide.
// La purge ne supprime que des lignes vieilles de plus de 30 jours : une fois
// par jour est déjà généreux.
const IntervallePurgeParDefaut = 24 * time.Hour

// Session décrit un jeton de renouvellement tel qu'il vit en base.
type Session struct {
	ID            uuid.UUID
	UtilisateurID uuid.UUID
	ExpireAt      time.Time
}

// hacher réduit le jeton à une empreinte. Un SHA-256 nu suffit ici, là où un
// mot de passe exigerait bcrypt : le jeton fait 256 bits d'aléa, il n'est pas
// devinable par force brute.
func hacher(jeton string) string {
	somme := sha256.Sum256([]byte(jeton))
	return hex.EncodeToString(somme[:])
}

func genererJeton() (string, error) {
	octets := make([]byte, 32)
	if _, err := rand.Read(octets); err != nil {
		return "", fmt.Errorf("génération aléatoire: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(octets), nil
}

// Emettre crée un jeton de renouvellement pour un utilisateur.
// Le jeton en clair n'est renvoyé qu'ici : seul son hash est conservé.
func Emettre(ctx context.Context, pool *pgxpool.Pool, utilisateurID uuid.UUID, duree time.Duration) (string, error) {
	jeton, err := genererJeton()
	if err != nil {
		return "", err
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO sessions_refresh (utilisateur_id, jeton_hash, expire_at)
		VALUES ($1, $2, $3)
	`, utilisateurID, hacher(jeton), time.Now().Add(duree))
	if err != nil {
		return "", fmt.Errorf("enregistrement session: %w", err)
	}

	return jeton, nil
}

// Renouveler échange un jeton contre un nouveau (rotation) et rend l'identité
// de l'utilisateur, à charge de l'appelant de reconstruire un jeton d'accès.
//
// La rotation systématique permet de détecter un vol : si un jeton déjà
// remplacé revient, c'est que deux porteurs l'utilisent.
func Renouveler(ctx context.Context, pool *pgxpool.Pool, jeton string, duree time.Duration) (uuid.UUID, string, error) {
	var (
		id            uuid.UUID
		utilisateurID uuid.UUID
		expireAt      time.Time
		remplacePar   *uuid.UUID
		revoqueAt     *time.Time
	)

	err := pool.QueryRow(ctx, `
		SELECT id, utilisateur_id, expire_at, remplace_par, revoque_at
		FROM sessions_refresh WHERE jeton_hash = $1
	`, hacher(jeton)).Scan(&id, &utilisateurID, &expireAt, &remplacePar, &revoqueAt)

	if err == pgx.ErrNoRows {
		return uuid.Nil, "", ErrJetonInvalide
	}
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("lecture session: %w", err)
	}

	// Jeton rejoué : quelqu'un d'autre s'en sert. On coupe toutes les sessions
	// de l'utilisateur plutôt que de laisser cohabiter le voleur et la victime.
	if remplacePar != nil {
		_ = RevoquerTout(ctx, pool, utilisateurID)
		return uuid.Nil, "", ErrJetonRejoue
	}

	if revoqueAt != nil {
		return uuid.Nil, "", ErrJetonInvalide
	}
	if time.Now().After(expireAt) {
		return uuid.Nil, "", ErrJetonExpire
	}

	nouveau, err := genererJeton()
	if err != nil {
		return uuid.Nil, "", err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var nouveauID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO sessions_refresh (utilisateur_id, jeton_hash, expire_at)
		VALUES ($1, $2, $3) RETURNING id
	`, utilisateurID, hacher(nouveau), time.Now().Add(duree)).Scan(&nouveauID); err != nil {
		return uuid.Nil, "", fmt.Errorf("insertion nouvelle session: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE sessions_refresh SET remplace_par = $1 WHERE id = $2
	`, nouveauID, id); err != nil {
		return uuid.Nil, "", fmt.Errorf("rotation: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, "", fmt.Errorf("commit: %w", err)
	}

	return utilisateurID, nouveau, nil
}

// Revoquer coupe une session précise (déconnexion volontaire).
func Revoquer(ctx context.Context, pool *pgxpool.Pool, jeton string) error {
	_, err := pool.Exec(ctx, `
		UPDATE sessions_refresh SET revoque_at = now()
		WHERE jeton_hash = $1 AND revoque_at IS NULL
	`, hacher(jeton))
	return err
}

// RevoquerTout coupe toutes les sessions d'un utilisateur : changement de mot
// de passe, ou jeton rejoué.
func RevoquerTout(ctx context.Context, pool *pgxpool.Pool, utilisateurID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
		UPDATE sessions_refresh SET revoque_at = now()
		WHERE utilisateur_id = $1 AND revoque_at IS NULL
	`, utilisateurID)
	return err
}

// Purger supprime les sessions expirées ou révoquées de longue date. À appeler
// périodiquement : sans cela la table grossit indéfiniment.
func Purger(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	// Verrou pris dans la même transaction que la suppression : l'hébergement
	// visé est scalable horizontalement, et sans lui chaque instance referait
	// le même travail au même moment.
	//
	// `_xact_lock` plutôt que `_lock` : il est relâché au commit, donc aucune
	// fuite possible si la transaction échoue. Un verrou de session, lui,
	// resterait accroché à une connexion que le pool recyclerait ensuite.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("transaction de purge: %w", err)
	}
	defer tx.Rollback(ctx)

	var obtenu bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, cleVerrouPurge).
		Scan(&obtenu); err != nil {
		return 0, fmt.Errorf("verrou de purge: %w", err)
	}
	if !obtenu {
		return 0, ErrPurgeConcurrente
	}

	tag, err := tx.Exec(ctx, `
		DELETE FROM sessions_refresh
		WHERE expire_at < now() - interval '30 days'
		   OR (revoque_at IS NOT NULL AND revoque_at < now() - interval '30 days')
	`)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit de purge: %w", err)
	}
	return tag.RowsAffected(), nil
}

// PurgerPeriodiquement fait le ménage jusqu'à l'annulation du contexte.
//
// Un premier passage a lieu immédiatement : sur un service redémarré souvent,
// attendre le premier intervalle reviendrait à ne jamais purger.
//
// Bloquant — à lancer dans une goroutine. La fonction ne rend la main qu'à
// l'annulation du contexte, ce qui la rend testable sans attendre un jour.
func PurgerPeriodiquement(ctx context.Context, pool *pgxpool.Pool, intervalle time.Duration, journal *log.Logger) {
	// `time.NewTicker` panique sur un intervalle nul ou négatif : une variable
	// d'environnement mal renseignée ferait tomber le service au démarrage.
	// Un service qui ne démarre pas parce que le ménage est mal réglé est un
	// bien plus gros problème que le ménage lui-même.
	if intervalle <= 0 {
		journal.Printf("purge des sessions : intervalle invalide (%s), repli sur %s",
			intervalle, IntervallePurgeParDefaut)
		intervalle = IntervallePurgeParDefaut
	}

	passage := func() {
		// Délai propre : une purge qui traîne ne doit pas empêcher l'arrêt du
		// service, et la table est petite — si ça dépasse, quelque chose ne va
		// pas et il vaut mieux abandonner ce passage que bloquer le suivant.
		ctxPassage, annuler := context.WithTimeout(ctx, 2*time.Minute)
		defer annuler()

		supprimees, err := Purger(ctxPassage, pool)
		switch {
		case errors.Is(err, ErrPurgeConcurrente):
			// Une autre instance s'en charge : c'est le fonctionnement normal
			// d'un service scalé, pas un incident.
			journal.Println("purge des sessions : déjà en cours sur une autre instance")
		case errors.Is(err, context.Canceled):
			// Arrêt du service pendant le passage : rien à signaler.
		case err != nil:
			journal.Printf("purge des sessions échouée : %v", err)
		default:
			journal.Printf("purge des sessions : %d ligne(s) supprimée(s)", supprimees)
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
