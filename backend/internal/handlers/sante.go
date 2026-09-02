package handlers

import (
	"context"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Point de contrôle de l'état du service.
//
// L'ancienne version répondait 200 sans rien vérifier : l'API restait
// « en bonne santé » avec Postgres à terre, et diagnostiquer une panne passait
// par l'essai d'un appel métier au hasard.

// Délai au-delà duquel une dépendance est considérée en défaut.
//
// Court à dessein : un point de contrôle qui pend est pire qu'un point de
// contrôle qui échoue — l'orchestrateur attend au lieu de retirer l'instance,
// et l'opérateur ne sait pas si le service est lent ou mort.
const delaiSonde = 2 * time.Second

// Durée pendant laquelle un résultat est réutilisé.
//
// L'endpoint n'est pas authentifié : sans ce cache, marteler `/health`
// reviendrait à marteler la base. Une seconde suffit à absorber les sondes
// d'un répartiteur de charge sans masquer une panne réelle.
const dureeCacheSante = time.Second

// EtatService est le verdict pour une dépendance. Le message d'erreur brut
// n'est jamais repris : il contient l'utilisateur, la base et l'hôte, et
// `/health` est public.
type EtatService struct {
	Service string `json:"service"`
	OK      bool   `json:"ok"`
	Latence string `json:"latence,omitempty"`
}

type reponseSante struct {
	Statut    string        `json:"statut"`
	Services  []EtatService `json:"services"`
	VerifieA  time.Time     `json:"verifie_a"`
	remontant bool
}

type cacheSante struct {
	mu      sync.Mutex
	reponse reponseSante
	expireA time.Time
	remplie bool
}

// sonder mesure une dépendance et rend son verdict.
func sonder(ctx context.Context, nom string, ping func(context.Context) error) EtatService {
	debut := time.Now()
	err := ping(ctx)
	etat := EtatService{Service: nom, OK: err == nil}
	if err == nil {
		etat.Latence = time.Since(debut).Round(time.Millisecond).String()
	}
	return etat
}

// Sante — état réel du service et de ses dépendances.
//
// Répond 200 si tout répond, 503 sinon, en **nommant** le service en défaut :
// c'est ce qui distingue un diagnostic d'un simple feu rouge.
func (d *Deps) Sante(c *fiber.Ctx) error {
	rep := d.etatSante()

	if !rep.remontant {
		// 503 et non 500 : le service n'est pas cassé, il est indisponible
		// parce qu'une dépendance l'est. Un répartiteur de charge sait quoi
		// faire d'un 503, il retire l'instance du pool.
		c.Status(fiber.StatusServiceUnavailable)
	}
	return c.JSON(rep)
}

func (d *Deps) etatSante() reponseSante {
	d.sante.mu.Lock()
	defer d.sante.mu.Unlock()

	if d.sante.remplie && time.Now().Before(d.sante.expireA) {
		return d.sante.reponse
	}

	ctx, annuler := context.WithTimeout(context.Background(), delaiSonde)
	defer annuler()

	// Les deux sondes en parallèle : en série, deux dépendances lentes
	// cumuleraient leurs délais et le point de contrôle dépasserait le sien.
	var (
		attente  sync.WaitGroup
		postgres EtatService
		redis    EtatService
	)
	attente.Add(2)

	go func() {
		defer attente.Done()
		postgres = sonder(ctx, "postgres", d.DB.Ping)
	}()
	go func() {
		defer attente.Done()
		redis = sonder(ctx, "redis", func(ctx context.Context) error {
			return d.Redis.Ping(ctx).Err()
		})
	}()

	attente.Wait()

	services := []EtatService{postgres, redis}
	tout := true
	for _, s := range services {
		if !s.OK {
			tout = false
		}
	}

	statut := "ok"
	if !tout {
		statut = "degrade"
	}

	rep := reponseSante{
		Statut:    statut,
		Services:  services,
		VerifieA:  time.Now().UTC(),
		remontant: tout,
	}

	d.sante.reponse = rep
	d.sante.expireA = time.Now().Add(dureeCacheSante)
	d.sante.remplie = true

	return rep
}

// Vivant — le processus répond, sans interroger quoi que ce soit.
//
// Séparé de `/health` parce que les deux questions n'ont pas la même
// conséquence : un orchestrateur qui redémarre le service parce que Postgres
// est tombé ne répare rien et ajoute une panne à la panne. C'est cet endpoint
// qu'on branche sur la sonde de *liveness*, et `/health` sur celle de
// *readiness*.
func (d *Deps) Vivant(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"statut": "vivant"})
}
