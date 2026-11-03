package util

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

// IPClient renvoie l'adresse du client, qui sert de clé aux limiteurs.
//
// Derrière le proxy de Render, c.IP() est l'adresse du proxy pour toutes les
// requêtes : sans cette fonction, tous les clients partageraient le même
// compteur, et un seul attaquant bloquerait la connexion de tout le monde.
// On ne lit X-Forwarded-For que si le déploiement le déclare (TRUST_PROXY=1),
// sinon n'importe quel client choisirait sa clé. Le proxy ajoute l'adresse
// qu'il a vue en fin de liste : c'est la seule entrée qu'un client ne peut pas
// forger.
func IPClient(c *fiber.Ctx, faireConfianceAuProxy bool) string {
	if faireConfianceAuProxy {
		if xff := c.Get(fiber.HeaderXForwardedFor); xff != "" {
			parties := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parties[len(parties)-1]); ip != "" {
				return ip
			}
		}
	}
	return c.IP()
}
