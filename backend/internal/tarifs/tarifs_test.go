package tarifs

import (
	"errors"
	"testing"
)

func p(v int) *int { return &v }

func base(mode string) Bareme {
	return Bareme{Mode: mode, Devise: "XOF", CoefficientDetour: 1.3, Arrondi: 50}
}

func TestForfait_PrixUniqueArrondi(t *testing.T) {
	b := base(ModeForfait)
	b.PrixForfait = p(1020)
	if err := Valider(b); err != nil {
		t.Fatal(err)
	}
	// Le forfait ne dépend pas de la distance, même inconnue.
	got, err := Calculer(b, nil)
	if err != nil || got != 1050 {
		t.Fatalf("got %d, %v ; attendu 1050", got, err)
	}
}

func TestPaliers_ChoisitLaTrancheEtBornesIncluses(t *testing.T) {
	b := base(ModePaliers)
	b.Paliers = []Palier{{3, 1000}, {7, 1500}, {15, 2500}}
	if err := Valider(b); err != nil {
		t.Fatal(err)
	}
	cas := []struct {
		m    int
		prix int
	}{{0, 1000}, {3000, 1000}, {3001, 1500}, {7000, 1500}, {14999, 2500}}
	for _, c := range cas {
		got, err := Calculer(b, p(c.m))
		if err != nil || got != c.prix {
			t.Errorf("%d m : got %d, %v ; attendu %d", c.m, got, err, c.prix)
		}
	}
}

func TestPaliers_AuDelaDuDernierRendAConfirmer(t *testing.T) {
	b := base(ModePaliers)
	b.Paliers = []Palier{{3, 1000}}
	if _, err := Calculer(b, p(3500)); !errors.Is(err, ErrHorsPaliers) {
		t.Fatalf("attendu ErrHorsPaliers, got %v", err)
	}
}

func TestDistance_BasePlusKmMinimumEtArrondi(t *testing.T) {
	b := base(ModeDistance)
	b.PrixBase, b.PrixParKm, b.PrixMinimum = p(500), p(200), p(1000)
	if err := Valider(b); err != nil {
		t.Fatal(err)
	}
	// 1 km : 500 + 200 = 700 < minimum 1000.
	if got, _ := Calculer(b, p(1000)); got != 1000 {
		t.Errorf("1 km : %d, attendu le minimum 1000", got)
	}
	// 6,3 km : 500 + 1260 = 1760 → arrondi au-dessus à 1800.
	if got, _ := Calculer(b, p(6300)); got != 1800 {
		t.Errorf("6,3 km : %d, attendu 1800", got)
	}
}

func TestSansEpinglesPasDePrixInvente(t *testing.T) {
	for _, mode := range []string{ModePaliers, ModeDistance} {
		b := base(mode)
		b.Paliers = []Palier{{5, 1000}}
		b.PrixBase, b.PrixParKm = p(500), p(200)
		if _, err := Calculer(b, nil); !errors.Is(err, ErrDistanceInconnue) {
			t.Errorf("%s sans distance : attendu ErrDistanceInconnue, got %v", mode, err)
		}
	}
	if DistanceEstimee(base(ModeDistance), nil, nil, nil, nil) != nil {
		t.Error("distance estimée sans points")
	}
}

func TestDistanceEstimee_AppliqueLeDetour(t *testing.T) {
	// Pharmacie (centre) → Ouaga 2000 : ~6,7 km à vol d'oiseau.
	latD, lonD, latA, lonA := 12.3712, -1.5199, 12.3176, -1.4932
	vol := DistanceMetres(latD, lonD, latA, lonA)
	if vol < 6000 || vol > 7500 {
		t.Fatalf("distance à vol d'oiseau incohérente : %.0f m", vol)
	}
	b := base(ModeDistance)
	got := DistanceEstimee(b, &latD, &lonD, &latA, &lonA)
	if got == nil || float64(*got) < vol*1.29 || float64(*got) > vol*1.31 {
		t.Fatalf("détour non appliqué : %v pour %.0f", got, vol)
	}
}

func TestValider_RefuseLesIncoherences(t *testing.T) {
	cas := map[string]Bareme{}

	b := base(ModeForfait)
	cas["forfait absent"] = b

	b = base(ModeForfait)
	b.PrixForfait = p(0)
	cas["forfait nul"] = b

	b = base(ModeForfait)
	b.PrixForfait = p(PrixMax + 1)
	cas["zéro de trop"] = b

	b = base(ModePaliers)
	cas["aucun palier"] = b

	b = base(ModePaliers)
	b.Paliers = []Palier{{5, 1000}, {3, 1500}}
	cas["paliers décroissants"] = b

	b = base(ModePaliers)
	b.Paliers = []Palier{{5, 1000}, {5, 1500}}
	cas["paliers égaux"] = b

	b = base(ModePaliers)
	b.Paliers = []Palier{{5, 0}}
	cas["palier gratuit"] = b

	b = base(ModeDistance)
	b.PrixBase, b.PrixParKm = p(0), p(0)
	cas["distance tout à zéro"] = b

	b = base(ModeDistance)
	b.PrixBase, b.PrixParKm = p(-5), p(100)
	cas["prix négatif"] = b

	b = base(ModeForfait)
	b.PrixForfait = p(1000)
	b.Arrondi = 7
	cas["arrondi exotique"] = b

	b = base(ModeForfait)
	b.PrixForfait = p(1000)
	b.CoefficientDetour = 3
	cas["détour absurde"] = b

	b = base("au_poids")
	cas["mode inconnu"] = b

	for nom, b := range cas {
		if Valider(b) == nil {
			t.Errorf("%s : accepté à tort", nom)
		}
	}
}
