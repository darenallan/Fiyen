package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                string
	DatabaseURL         string
	RedisAddr           string
	RedisPassword       string
	JWTSecret           string
	JWTDureeMinutes     int
	PositionTTLSecondes int
	MasquageDureeHeures int
	CORSOrigins         string
}

func Load() *Config {
	_ = godotenv.Load()

	return &Config{
		Port:                getEnv("PORT", "8080"),
		DatabaseURL:         mustEnv("DATABASE_URL"),
		RedisAddr:           getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:       getEnv("REDIS_PASSWORD", ""),
		JWTSecret:           mustEnv("JWT_SECRET"),
		JWTDureeMinutes:     getEnvInt("JWT_DUREE_MINUTES", 30),
		PositionTTLSecondes: getEnvInt("POSITION_TTL_SECONDES", 30),
		MasquageDureeHeures: getEnvInt("MASQUAGE_DUREE_HEURES", 4),
		CORSOrigins:         getEnv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174"),
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
