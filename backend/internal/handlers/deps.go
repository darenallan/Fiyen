package handlers

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"fiyen-backend/internal/config"
	"fiyen-backend/internal/notifications"
)

// Deps regroupe les dépendances partagées par tous les handlers.
//
// Toujours manipulé par pointeur : il porte un verrou (le cache du point de
// contrôle), et le copier le dupliquerait.
type Deps struct {
	DB     *pgxpool.Pool
	Redis  *redis.Client
	Config *config.Config

	// Notifications peut être nil : les handlers s'en passent alors
	// silencieusement, ce qui évite d'imposer un envoyeur aux tests qui n'en
	// ont pas besoin.
	Notifications notifications.Envoyeur

	// Cache du point de contrôle. Rangé ici plutôt qu'en variable globale :
	// un global serait partagé entre toutes les instances, ce qui fausserait
	// les tests et n'apporterait rien en production.
	sante cacheSante
}
