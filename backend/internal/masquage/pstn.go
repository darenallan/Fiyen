package masquage

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrPSTNNonConfigure signale qu'aucun fournisseur de numéros virtuels n'est
// branché. C'est le cas par défaut : le canal in-app (data) reste utilisable.
var ErrPSTNNonConfigure = errors.New("repli PSTN non configuré")

// FournisseurPSTN loue un numéro virtuel temporaire servant de relais entre le
// client et le livreur quand la connexion data ne permet pas le canal in-app.
//
// Le numéro rendu est un numéro **loué à l'opérateur**, jamais celui d'un
// participant : c'est ce qui préserve la garantie de masquage sur le canal voix.
type FournisseurPSTN interface {
	// ProvisionnerNumero réserve un numéro relais pour la durée de la course.
	ProvisionnerNumero(ctx context.Context, sessionID uuid.UUID, expireAt time.Time) (string, error)
	// LibererNumero rend le numéro au pool dès la course terminée, pour qu'il ne
	// puisse plus servir à joindre l'autre partie.
	LibererNumero(ctx context.Context, sessionID uuid.UUID) error
}

// PSTNNonConfigure est le fournisseur par défaut.
//
// Il échoue explicitement au lieu de simuler un numéro : un faux numéro donnerait
// l'illusion d'un canal de secours fonctionnel, et le défaut ne se verrait qu'au
// moment où un client essaie réellement d'appeler son livreur.
//
// Pour activer le repli, implémenter cette interface avec Africa's Talking
// (couvre le Burkina Faso en SMS/USSD/voix) et l'injecter dans les handlers.
// À vérifier au moment de l'intégration : la couverture **voix** exacte pour le
// Burkina Faso, qui varie selon les pays et n'est pas garantie par la seule
// disponibilité SMS/USSD.
type PSTNNonConfigure struct{}

func (PSTNNonConfigure) ProvisionnerNumero(context.Context, uuid.UUID, time.Time) (string, error) {
	return "", ErrPSTNNonConfigure
}

func (PSTNNonConfigure) LibererNumero(context.Context, uuid.UUID) error {
	return ErrPSTNNonConfigure
}
