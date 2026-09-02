package middleware

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"fiyen-backend/internal/models"
)

// Le renommage `client` → `destinataire` a changé la forme des jetons. Ceux
// déjà en circulation restent valides jusqu'à trente jours : sans la
// normalisation testée ici, leurs porteurs perdraient leur identité et
// recevraient un 403 sur chaque écran.

const secret = "secret-de-test"

// jetonHerite fabrique un jeton à l'ancienne forme, telle qu'elle était émise
// avant le renommage. On ne peut pas passer par GenererToken : il n'écrit plus
// l'ancien claim, c'est justement ce qu'on vérifie plus bas.
func jetonHerite(t *testing.T, clientID uuid.UUID) string {
	t.Helper()

	charge := jwt.MapClaims{
		"utilisateur_id": uuid.New().String(),
		"role":           "client",
		"client_id":      clientID.String(),
		"exp":            time.Now().Add(time.Hour).Unix(),
		"iat":            time.Now().Unix(),
	}
	signe, err := jwt.NewWithClaims(jwt.SigningMethodHS256, charge).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("signature: %v", err)
	}
	return signe
}

func lire(t *testing.T, jeton string) *Claims {
	t.Helper()
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(jeton, claims, func(*jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		t.Fatalf("lecture du jeton: %v", err)
	}
	claims.normaliser()
	return claims
}

func TestNormaliser_UnJetonHeriteGardeSonIdentite(t *testing.T) {
	client := uuid.New()

	claims := lire(t, jetonHerite(t, client))

	// Sans reprise de l'ancien claim, `DestinataireID` resterait nil et
	// l'utilisateur serait refusé partout — alors que son jeton est valide.
	if claims.DestinataireID == nil {
		t.Fatal("l'ancien claim client_id doit être repris en destinataire_id")
	}
	if *claims.DestinataireID != client {
		t.Errorf("destinataire_id = %v, attendu %v", *claims.DestinataireID, client)
	}
}

func TestNormaliser_UnJetonHeritePorteLeNouveauRole(t *testing.T) {
	claims := lire(t, jetonHerite(t, uuid.New()))

	// `RolesRequis(RoleDestinataire)` compare des chaînes : un rôle resté
	// « client » ne matcherait aucune route.
	if claims.Role != models.RoleDestinataire {
		t.Errorf("rôle = %q, attendu %q", claims.Role, models.RoleDestinataire)
	}
}

func TestNormaliser_NEcrasePasUnJetonCourant(t *testing.T) {
	courant := uuid.New()
	herite := uuid.New()

	// Un jeton portant les deux claims — cas impossible en pratique, mais qui
	// fige la priorité : le champ courant fait foi.
	charge := jwt.MapClaims{
		"utilisateur_id":  uuid.New().String(),
		"role":            "destinataire",
		"destinataire_id": courant.String(),
		"client_id":       herite.String(),
		"exp":             time.Now().Add(time.Hour).Unix(),
	}
	signe, err := jwt.NewWithClaims(jwt.SigningMethodHS256, charge).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("signature: %v", err)
	}

	claims := lire(t, signe)
	if *claims.DestinataireID != courant {
		t.Errorf("le claim courant doit primer : %v au lieu de %v", *claims.DestinataireID, courant)
	}
}

func TestNormaliser_LaisseLesAutresRolesIntacts(t *testing.T) {
	for _, role := range []models.Role{
		models.RoleCompagnie, models.RoleLivreur,
		models.RolePartenaire, models.RoleCollaborateur,
	} {
		claims := &Claims{Role: role}
		claims.normaliser()
		if claims.Role != role {
			t.Errorf("le rôle %q a été altéré en %q", role, claims.Role)
		}
	}
}

func TestGenererToken_NeReemetPasLAncienClaim(t *testing.T) {
	destinataire := uuid.New()
	ancien := uuid.New()

	jeton, err := GenererToken(secret, 30, Claims{
		UtilisateurID:  uuid.New(),
		Role:           models.RoleDestinataire,
		DestinataireID: &destinataire,
		// Un appelant qui le renseignerait par erreur ne doit pas prolonger la
		// transition : le champ est effacé à l'émission.
		ClientIDHerite: &ancien,
	})
	if err != nil {
		t.Fatalf("génération: %v", err)
	}

	charge := decoderCharge(t, jeton)
	if _, present := charge["client_id"]; present {
		// Réémettre l'ancien claim ferait vivre la compatibilité indéfiniment,
		// et on ne saurait jamais quand la retirer.
		t.Errorf("le jeton émis ne doit plus porter client_id : %v", charge)
	}
	if charge["destinataire_id"] != destinataire.String() {
		t.Errorf("destinataire_id = %v, attendu %v", charge["destinataire_id"], destinataire)
	}
	if charge["role"] != string(models.RoleDestinataire) {
		t.Errorf("rôle émis = %v", charge["role"])
	}
}

// decoderCharge lit la charge utile sans vérifier la signature : le test
// s'intéresse à ce qui est écrit, pas à sa validité.
func decoderCharge(t *testing.T, jeton string) map[string]any {
	t.Helper()

	parties := strings.Split(jeton, ".")
	if len(parties) != 3 {
		t.Fatalf("jeton malformé: %q", jeton)
	}
	brut, err := jwt.NewParser().DecodeSegment(parties[1])
	if err != nil {
		t.Fatalf("décodage: %v", err)
	}
	var charge map[string]any
	if err := json.Unmarshal(brut, &charge); err != nil {
		t.Fatalf("charge illisible: %v", err)
	}
	return charge
}
