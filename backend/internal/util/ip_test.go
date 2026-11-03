package util

import (
	"io"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func ipVue(t *testing.T, confiance bool, xff string) string {
	t.Helper()
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error { return c.SendString(IPClient(c, confiance)) })
	req := httptest.NewRequest("GET", "/", nil)
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	corps, _ := io.ReadAll(res.Body)
	return string(corps)
}

func TestIPClient_DerriereLeProxyPrendLaDerniereEntree(t *testing.T) {
	if ip := ipVue(t, true, "6.6.6.6, 203.0.113.7"); ip != "203.0.113.7" {
		t.Fatalf("attendu l'adresse ajoutée par le proxy, obtenu %q", ip)
	}
}

func TestIPClient_SansConfianceIgnoreLEnTete(t *testing.T) {
	if ip := ipVue(t, false, "6.6.6.6"); ip == "6.6.6.6" {
		t.Fatal("un client ne doit pas pouvoir choisir sa clé de limitation")
	}
}

func TestIPClient_SansEnTeteRetombeSurLAdresseTCP(t *testing.T) {
	if ip := ipVue(t, true, ""); ip == "" {
		t.Fatal("adresse vide")
	}
}
