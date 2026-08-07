package handlers

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"fiyen-backend/internal/config"
)

// Deps regroupe les dépendances partagées par tous les handlers.
type Deps struct {
	DB     *pgxpool.Pool
	Redis  *redis.Client
	Config *config.Config
}
