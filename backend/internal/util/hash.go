package util

import (
	"crypto/sha256"
	"encoding/hex"

	"golang.org/x/crypto/bcrypt"
)

// HashTelephone produit un hash déterministe du numéro de téléphone réel.
// Déterministe (et non salé) car on doit pouvoir rechercher un compte par
// numéro à la connexion — le numéro en clair, lui, n'est jamais stocké.
func HashTelephone(telephone string) string {
	sum := sha256.Sum256([]byte(telephone))
	return hex.EncodeToString(sum[:])
}

func HashMotDePasse(motDePasse string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(motDePasse), bcrypt.DefaultCost)
	return string(hash), err
}

func VerifierMotDePasse(hash, motDePasse string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(motDePasse)) == nil
}
