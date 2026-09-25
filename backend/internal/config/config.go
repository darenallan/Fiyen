package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port              string
	DatabaseURL       string
	RedisAddr         string
	RedisPassword     string
	JWTSecret         string
	JWTDureeMinutes   int
	RefreshDureeJours int
	PurgeIntervalleH  int
	// TracesRetentionJours borne l'âge des positions conservées (voir
	// tracking.PurgerTraces). Une valeur <= 0 est refusée plus loin : elle
	// viderait la table.
	TracesRetentionJours int
	PositionTTLSecondes  int
	MasquageDureeHeures  int
	CORSOrigins          string
	// ExpoJetonAcces n'est nécessaire que si la sécurité push est activée sur
	// le tableau de bord EAS. Vide par défaut : Expo accepte les envois sans
	// authentification tant qu'elle ne l'est pas.
	ExpoJetonAcces string
	// URLPublique préfixe les liens de reçu partagés (voir
	// handlers.GenererLienRecu) : c'est cette adresse qui doit être jointe
	// depuis un téléphone quelconque, donc jamais localhost en production.
	URLPublique string
}

func Load() *Config {
	_ = godotenv.Load()

	return &Config{
		Port:            getEnv("PORT", "8080"),
		DatabaseURL:     mustEnv("DATABASE_URL"),
		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:   getEnv("REDIS_PASSWORD", ""),
		JWTSecret:       mustEnv("JWT_SECRET"),
		JWTDureeMinutes: getEnvInt("JWT_DUREE_MINUTES", 30),
		// 30 jours : un livreur qui travaille tous les jours ne ressaisit jamais
		// son mot de passe, et une session oubliée finit quand même par mourir.
		RefreshDureeJours: getEnvInt("REFRESH_DUREE_JOURS", 30),
		// La purge supprime des lignes vieilles de plus de 30 jours : une fois
		// par jour suffit largement, et un passage a lieu au démarrage.
		PurgeIntervalleH:     getEnvInt("PURGE_INTERVALLE_HEURES", 24),
		TracesRetentionJours: getEnvInt("TRACES_RETENTION_JOURS", 90),
		PositionTTLSecondes:  getEnvInt("POSITION_TTL_SECONDES", 30),
		MasquageDureeHeures:  getEnvInt("MASQUAGE_DUREE_HEURES", 4),
		CORSOrigins:          getEnv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174"),
		ExpoJetonAcces:       getEnv("EXPO_ACCESS_TOKEN", ""),
		// Le repli suppose l'API elle-même exposée sur cette adresse : c'est
		// elle qui rend la page HTML du reçu partagé (voir main.go), il n'y a
		// pas de front séparé à viser.
		URLPublique: getEnv("URL_PUBLIQUE", "http://localhost:8090"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic("variable d'environnement requise manquante: " + key)
	}
	return v
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
