package middleware

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"fiyen-backend/internal/models"
)

type Claims struct {
	UtilisateurID uuid.UUID   `json:"utilisateur_id"`
	Role          models.Role `json:"role"`
	CompagnieID   *uuid.UUID  `json:"compagnie_id,omitempty"`
	LivreurID     *uuid.UUID  `json:"livreur_id,omitempty"`
	// DestinataireID désigne celui qui reçoit le colis. Anciennement
	// `client_id` — voir `normaliser` pour la transition.
	DestinataireID *uuid.UUID `json:"destinataire_id,omitempty"`
	// PartenaireID est porté par les rôles partenaire et collaborateur. Il vient
	// du jeton et jamais du corps d'une requête : sans cela, un collaborateur
	// pourrait commander au nom d'une autre entreprise.
	PartenaireID *uuid.UUID `json:"partenaire_id,omitempty"`

	// ClientIDHerite reçoit l'ancien claim `client_id`. Il n'est **jamais**
	// écrit à l'émission : il n'existe que pour comprendre les jetons émis
	// avant le renommage, qui restent valides jusqu'à trente jours.
	//
	// À retirer une fois cette fenêtre passée — voir D2 dans ROADMAP.md.
	ClientIDHerite *uuid.UUID `json:"client_id,omitempty"`

	jwt.RegisteredClaims
}

// roleClientHerite est l'ancien nom du rôle destinataire. Comme le claim
// ci-dessus, il ne survit que le temps que les jetons en circulation expirent.
const roleClientHerite models.Role = "client"

// normaliser ramène un jeton hérité à la forme courante.
//
// Fait ici, en un seul endroit, plutôt que dans chaque handler : un `switch`
// qui aurait oublié un cas aurait renvoyé un 403 à un utilisateur légitime,
// et le défaut ne serait apparu qu'au déploiement.
func (c *Claims) normaliser() {
	if c.DestinataireID == nil && c.ClientIDHerite != nil {
		c.DestinataireID = c.ClientIDHerite
	}
	if c.Role == roleClientHerite {
		c.Role = models.RoleDestinataire
	}
}

func GenererToken(secret string, dureeMinutes int, claims Claims) (string, error) {
	// L'ancien claim n'est jamais réémis : il ne sert qu'à lire les jetons
	// antérieurs au renommage. Le réécrire prolongerait la transition
	// indéfiniment.
	claims.ClientIDHerite = nil

	claims.RegisteredClaims = jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(dureeMinutes) * time.Minute)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// AuthRequis vérifie le JWT et place les claims dans le contexte de la requête.
func AuthRequis(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" || len(header) < 8 || header[:7] != "Bearer " {
			return fiber.NewError(fiber.StatusUnauthorized, "en-tête Authorization manquant ou invalide")
		}
		tokenStr := header[7:]

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			return fiber.NewError(fiber.StatusUnauthorized, "token invalide ou expiré")
		}

		claims.normaliser()
		c.Locals("claims", claims)
		return c.Next()
	}
}

// AuthRequisWS vérifie le JWT pour une connexion WebSocket. Les navigateurs ne
// pouvant pas fixer d'en-têtes personnalisés sur le handshake (contrainte PWA),
// le token est aussi accepté en query param ?token=... en plus du header Bearer.
func AuthRequisWS(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			header := c.Get("Authorization")
			if len(header) > 7 && header[:7] == "Bearer " {
				tokenStr = header[7:]
			}
		}
		if tokenStr == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "token manquant")
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			return fiber.NewError(fiber.StatusUnauthorized, "token invalide ou expiré")
		}

		claims.normaliser()
		c.Locals("claims", claims)
		return c.Next()
	}
}

// RolesRequis restreint l'accès aux rôles listés. À utiliser après AuthRequis.
func RolesRequis(roles ...models.Role) fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, ok := c.Locals("claims").(*Claims)
		if !ok {
			return fiber.NewError(fiber.StatusUnauthorized, "non authentifié")
		}
		for _, r := range roles {
			if claims.Role == r {
				return c.Next()
			}
		}
		return fiber.NewError(fiber.StatusForbidden, "accès refusé pour ce rôle")
	}
}

func ClaimsDe(c *fiber.Ctx) *Claims {
	claims, _ := c.Locals("claims").(*Claims)
	return claims
}
