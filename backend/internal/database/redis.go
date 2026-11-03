package database

import (
	"context"
	"strings"

	"github.com/redis/go-redis/v9"
)

// optionsRedis accepte deux formes pour REDIS_ADDR :
//   - « hôte:port » (local, docker compose), mot de passe dans REDIS_PASSWORD ;
//   - une URL « redis://… » ou « rediss://… » (hébergeurs comme Upstash), dont
//     le second schéma impose TLS. Sans cette forme, un Redis hébergé — qui
//     exige une connexion chiffrée — refuserait l'API dès le démarrage.
func optionsRedis(addr, password string) (*redis.Options, error) {
	if strings.HasPrefix(addr, "redis://") || strings.HasPrefix(addr, "rediss://") {
		opts, err := redis.ParseURL(addr)
		if err != nil {
			return nil, err
		}
		if opts.Password == "" && password != "" {
			opts.Password = password
		}
		return opts, nil
	}
	return &redis.Options{Addr: addr, Password: password, DB: 0}, nil
}

func NewRedisClient(ctx context.Context, addr, password string) (*redis.Client, error) {
	opts, err := optionsRedis(addr, password)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return client, nil
}
