package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/config"
	"fiyen-backend/internal/testdb"
	"fiyen-backend/internal/util"
)

func appInscription(deps *Deps) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Post("/api/auth/register-destinataire", deps.RegisterDestinataire)
	return app
}

func inscrire(t *testing.T, app *fiber.App, telephone string) int {
	t.Helper()
	corps := fmt.Sprintf(`{"nom":"Test","telephone":%q,"mot_de_passe":"motdepasse123"}`, telephone)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register-destinataire", strings.NewReader(corps))
	req.Header.Set("Content-Type", "application/json")
	rep, err := app.Test(req, 5000)
	if err != nil {
		t.Fatalf("appel: %v", err)
	}
	defer rep.Body.Close()
	return rep.StatusCode
}

// Un numéro qui a déjà reçu une livraison de partenaire existe dans
// `destinataires` sans compte. L'inscription doit le dire (409), pas tomber en
// 500 — et surtout ne pas rattacher silencieusement l'historique à un compte
// dont personne n'a vérifié qu'il possède le numéro.
func TestInscriptionDestinataire_NumeroDejaLivreRend409SansCreerDeCompte(t *testing.T) {
	pool := testdb.Ouvrir(t)
	ctx := context.Background()
	deps := &Deps{DB: pool, Config: &config.Config{JWTSecret: "secret-de-test", JWTDureeMinutes: 30, RefreshDureeJours: 30}}
	app := appInscription(deps)

	telephone := "+2267" + strings.ReplaceAll(uuid.NewString(), "-", "")[:7]
	hash := util.HashTelephone(telephone)
	if _, err := pool.Exec(ctx, `INSERT INTO destinataires (nom, telephone_hash) VALUES ('Déjà livré', $1)`, hash); err != nil {
		t.Fatalf("destinataire: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM destinataires WHERE telephone_hash = $1`, hash)
	})

	if statut := inscrire(t, app, telephone); statut != fiber.StatusConflict {
		t.Fatalf("statut = %d, attendu 409", statut)
	}

	var comptes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM utilisateurs WHERE telephone_hash = $1`, hash).Scan(&comptes); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	if comptes != 0 {
		t.Fatalf("%d compte(s) créé(s) pour un numéro non vérifié", comptes)
	}
}

func TestInscriptionDestinataire_NumeroNeufRend201(t *testing.T) {
	pool := testdb.Ouvrir(t)
	deps := &Deps{DB: pool, Config: &config.Config{JWTSecret: "secret-de-test", JWTDureeMinutes: 30, RefreshDureeJours: 30}}
	app := appInscription(deps)

	telephone := "+2267" + strings.ReplaceAll(uuid.NewString(), "-", "")[:7]
	hash := util.HashTelephone(telephone)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM destinataires WHERE telephone_hash = $1`, hash)
	})

	if statut := inscrire(t, app, telephone); statut != fiber.StatusCreated {
		t.Fatalf("statut = %d, attendu 201", statut)
	}
}
