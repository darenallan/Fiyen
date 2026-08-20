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
)

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
	tag, err := pool.Exec(ctx, `
		DELETE FROM sessions_refresh
		WHERE expire_at < now() - interval '30 days'
		   OR (revoque_at IS NOT NULL AND revoque_at < now() - interval '30 days')
	`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
