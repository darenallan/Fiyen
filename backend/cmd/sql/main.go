// Commande sql : exécute le SQL lu sur l'entrée standard, dans une seule
// transaction, sur la base de DATABASE_URL (fichier .env compris).
//
//	go run ./cmd/sql < requetes.sql
//
// Sert au jeu de démonstration. Il passait par `docker exec … psql`, mais le
// client Docker de Docker Desktop peut se figer alors que Postgres répond
// parfaitement sur son port : le reset de la démo restait alors bloqué sans
// message. Passer par la même connexion que l'API supprime cette dépendance.
package main

import (
	"context"
	"io"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL manquant")
	}

	sql, err := io.ReadAll(os.Stdin)
	if err != nil {
		log.Fatalf("lecture de l'entrée : %v", err)
	}

	ctx, annuler := context.WithTimeout(context.Background(), 2*time.Minute)
	defer annuler()

	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		log.Fatalf("connexion : %v", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		log.Fatalf("transaction : %v", err)
	}
	// Protocole simple : plusieurs instructions dans une même chaîne.
	if _, err := tx.Exec(ctx, string(sql), pgx.QueryExecModeSimpleProtocol); err != nil {
		_ = tx.Rollback(ctx)
		log.Fatalf("exécution : %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("validation : %v", err)
	}
}
