package tracking

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const geoKeyPositionsLivreurs = "positions:livreurs"

func canalPositionCourse(livreurID uuid.UUID) string {
	return fmt.Sprintf("course:%s:position", livreurID.String())
}

// canalFlotteCompagnie agrège les positions de tous les livreurs d'une compagnie.
// Sans lui, le dashboard devrait s'abonner à un canal par livreur et gérer les
// arrivées/départs de la flotte en cours de session.
func canalFlotteCompagnie(compagnieID uuid.UUID) string {
	return fmt.Sprintf("compagnie:%s:positions", compagnieID.String())
}

func cleDernierVu(livreurID uuid.UUID) string {
	return fmt.Sprintf("livreur:last_seen:%s", livreurID.String())
}

type PositionMessage struct {
	LivreurID  uuid.UUID `json:"livreur_id"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	Horodatage time.Time `json:"horodatage"`
}

// EnregistrerPosition écrit la position dans Redis (GEOADD + TTL de présence),
// publie sur le canal de la course, et persiste en base pour les requêtes géospatiales.
//
// horodatage est l'instant de *capture* GPS, qui peut être antérieur à l'instant
// d'envoi : l'app livreur met les positions en cache local pendant une coupure
// réseau et les rejoue à la reconnexion. La persistance ignore donc toute position
// plus ancienne que celle déjà enregistrée, pour qu'un rejeu tardif n'écrase pas
// une position plus récente.
func EnregistrerPosition(ctx context.Context, rdb *redis.Client, pool *pgxpool.Pool, ttl time.Duration, livreurID, compagnieID uuid.UUID, lat, lon float64, horodatage time.Time) error {
	if horodatage.IsZero() {
		horodatage = time.Now()
	}

	if err := rdb.Set(ctx, cleDernierVu(livreurID), "1", ttl).Err(); err != nil {
		return fmt.Errorf("last_seen: %w", err)
	}

	msg := PositionMessage{LivreurID: livreurID, Latitude: lat, Longitude: lon, Horodatage: horodatage}
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	// Deux audiences distinctes : le client qui suit sa course, et le dashboard
	// qui surveille toute sa flotte.
	if err := rdb.Publish(ctx, canalPositionCourse(livreurID), payload).Err(); err != nil {
		return fmt.Errorf("publish course: %w", err)
	}
	if err := rdb.Publish(ctx, canalFlotteCompagnie(compagnieID), payload).Err(); err != nil {
		return fmt.Errorf("publish flotte: %w", err)
	}

	// La position courante (Redis GEO + table) ne doit refléter que la capture la
	// plus récente ; un rejeu différé plus ancien est publié mais pas persisté.
	tag, err := pool.Exec(ctx, `
		INSERT INTO positions_livreurs (livreur_id, position, updated_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)
		ON CONFLICT (livreur_id) DO UPDATE
		SET position = EXCLUDED.position, updated_at = EXCLUDED.updated_at
		WHERE positions_livreurs.updated_at < EXCLUDED.updated_at
	`, livreurID, lon, lat, horodatage)
	if err != nil {
		return fmt.Errorf("persist: %w", err)
	}

	if tag.RowsAffected() > 0 {
		if err := rdb.GeoAdd(ctx, geoKeyPositionsLivreurs, &redis.GeoLocation{
			Name:      livreurID.String(),
			Longitude: lon,
			Latitude:  lat,
		}).Err(); err != nil {
			return fmt.Errorf("geoadd: %w", err)
		}
	}

	return nil
}

// EstEnLigne vérifie la présence du livreur via la clé TTL last_seen.
func EstEnLigne(ctx context.Context, rdb *redis.Client, livreurID uuid.UUID) (bool, error) {
	n, err := rdb.Exists(ctx, cleDernierVu(livreurID)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// LivreursEnLigne renvoie, pour les livreurs demandés, ceux dont la clé de
// présence n'a pas expiré. Un seul aller-retour Redis (pipeline) : la vue flotte
// interroge la présence de toute la flotte à chaque rafraîchissement.
func LivreursEnLigne(ctx context.Context, rdb *redis.Client, livreurIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	resultat := make(map[uuid.UUID]bool, len(livreurIDs))
	if len(livreurIDs) == 0 {
		return resultat, nil
	}

	pipe := rdb.Pipeline()
	commandes := make([]*redis.IntCmd, len(livreurIDs))
	for i, id := range livreurIDs {
		commandes[i] = pipe.Exists(ctx, cleDernierVu(id))
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		return nil, err
	}

	for i, id := range livreurIDs {
		resultat[id] = commandes[i].Val() > 0
	}
	return resultat, nil
}

// SouscrirePositionCourse s'abonne au canal de position d'un livreur et transmet
// chaque message reçu au callback jusqu'à annulation du contexte.
func SouscrirePositionCourse(ctx context.Context, rdb *redis.Client, livreurID uuid.UUID, onMessage func([]byte)) error {
	return souscrire(ctx, rdb, canalPositionCourse(livreurID), onMessage)
}

// SouscrireFlotteCompagnie s'abonne aux positions de tous les livreurs d'une
// compagnie. Les livreurs ajoutés en cours de session sont couverts sans
// réabonnement, le canal étant porté par la compagnie et non par le livreur.
func SouscrireFlotteCompagnie(ctx context.Context, rdb *redis.Client, compagnieID uuid.UUID, onMessage func([]byte)) error {
	return souscrire(ctx, rdb, canalFlotteCompagnie(compagnieID), onMessage)
}

func souscrire(ctx context.Context, rdb *redis.Client, canal string, onMessage func([]byte)) error {
	sub := rdb.Subscribe(ctx, canal)
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			onMessage([]byte(msg.Payload))
		}
	}
}
