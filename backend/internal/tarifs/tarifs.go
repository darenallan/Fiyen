// Package tarifs calcule le prix d'une course à partir du barème de la
// compagnie. Aucune valeur n'y est codée : tout vient du barème saisi par la
// compagnie elle-même.
//
// Le calcul vit ici, à un seul endroit, et sert à la fois l'aperçu du
// dashboard, l'estimation affichée au partenaire et le prix figé sur la
// commande. Trois copies du calcul finiraient par donner trois prix.
package tarifs

import (
	"errors"
	"fmt"
	"math"
)

// Les trois façons de tarifer qu'une compagnie peut choisir.
const (
	ModeForfait  = "forfait"
	ModePaliers  = "paliers"
	ModeDistance = "distance"
)

// Bornes de bon sens. Elles ne fixent pas de prix : elles refusent la faute de
// frappe (un zéro de trop) avant qu'elle ne s'affiche chez tous les partenaires.
const (
	PrixMax       = 1_000_000
	DistanceMaxKm = 500
	PaliersMax    = 10
	DetourMin     = 1.0
	DetourMax     = 2.0
)

// ArrondisPermis : multiples auxquels un prix peut être arrondi (en XOF).
var ArrondisPermis = []int{1, 5, 10, 25, 50, 100}

// Palier : jusqu'à cette distance (incluse), ce prix.
type Palier struct {
	JusquAKm float64 `json:"jusqu_a_km"`
	Prix     int     `json:"prix"`
}

// Bareme est une version du barème d'une compagnie.
type Bareme struct {
	Mode              string   `json:"mode"`
	Devise            string   `json:"devise"`
	PrixForfait       *int     `json:"prix_forfait,omitempty"`
	Paliers           []Palier `json:"paliers,omitempty"`
	PrixBase          *int     `json:"prix_base,omitempty"`
	PrixParKm         *int     `json:"prix_par_km,omitempty"`
	PrixMinimum       *int     `json:"prix_minimum,omitempty"`
	CoefficientDetour float64  `json:"coefficient_detour"`
	Arrondi           int      `json:"arrondi"`
}

// Raisons pour lesquelles un prix ne peut pas être annoncé. Elles sont
// destinées à être affichées telles quelles au partenaire.
var (
	ErrDistanceInconnue = errors.New("prix à confirmer par la compagnie : placez le retrait et la livraison sur la carte pour obtenir une estimation")
	ErrHorsPaliers      = errors.New("prix à confirmer par la compagnie : la distance dépasse le dernier palier du barème")
)

func prixValide(nom string, p *int, requis bool) error {
	if p == nil {
		if requis {
			return fmt.Errorf("%s est requis", nom)
		}
		return nil
	}
	if *p < 0 || *p > PrixMax {
		return fmt.Errorf("%s doit être compris entre 0 et %d", nom, PrixMax)
	}
	return nil
}

// Valider refuse un barème incohérent. Les messages sont faits pour être
// affichés sur le formulaire.
func Valider(b Bareme) error {
	if b.Devise == "" {
		return errors.New("devise requise")
	}
	if b.CoefficientDetour < DetourMin || b.CoefficientDetour > DetourMax {
		return fmt.Errorf("le coefficient de détour doit être entre %.1f et %.1f", DetourMin, DetourMax)
	}
	arrondiOK := false
	for _, a := range ArrondisPermis {
		if b.Arrondi == a {
			arrondiOK = true
		}
	}
	if !arrondiOK {
		return fmt.Errorf("arrondi non permis : %v", ArrondisPermis)
	}

	switch b.Mode {
	case ModeForfait:
		if err := prixValide("le prix forfaitaire", b.PrixForfait, true); err != nil {
			return err
		}
		if *b.PrixForfait == 0 {
			return errors.New("le prix forfaitaire doit être supérieur à 0")
		}
	case ModePaliers:
		if len(b.Paliers) == 0 {
			return errors.New("au moins un palier est requis")
		}
		if len(b.Paliers) > PaliersMax {
			return fmt.Errorf("%d paliers au plus", PaliersMax)
		}
		precedent := 0.0
		for i, p := range b.Paliers {
			if p.JusquAKm <= precedent {
				return fmt.Errorf("palier %d : les distances doivent être strictement croissantes", i+1)
			}
			if p.JusquAKm > DistanceMaxKm {
				return fmt.Errorf("palier %d : %d km au plus", i+1, DistanceMaxKm)
			}
			if p.Prix <= 0 || p.Prix > PrixMax {
				return fmt.Errorf("palier %d : le prix doit être compris entre 1 et %d", i+1, PrixMax)
			}
			precedent = p.JusquAKm
		}
	case ModeDistance:
		if err := prixValide("le prix de base", b.PrixBase, true); err != nil {
			return err
		}
		if err := prixValide("le prix au kilomètre", b.PrixParKm, true); err != nil {
			return err
		}
		if err := prixValide("le prix minimum", b.PrixMinimum, false); err != nil {
			return err
		}
		if *b.PrixBase == 0 && *b.PrixParKm == 0 {
			return errors.New("le prix de base et le prix au kilomètre ne peuvent pas être tous deux nuls")
		}
	default:
		return errors.New("mode inconnu : forfait, paliers ou distance")
	}
	return nil
}

// DistanceMetres : distance à vol d'oiseau (haversine) entre deux points.
func DistanceMetres(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

// DistanceEstimee applique le coefficient de détour à la distance à vol
// d'oiseau. Rend nil si l'un des deux points manque.
func DistanceEstimee(b Bareme, latD, lonD, latA, lonA *float64) *int {
	if latD == nil || lonD == nil || latA == nil || lonA == nil {
		return nil
	}
	m := int(math.Round(DistanceMetres(*latD, *lonD, *latA, *lonA) * b.CoefficientDetour))
	return &m
}

func arrondirAuDessus(prix float64, pas int) int {
	if pas <= 1 {
		return int(math.Ceil(prix))
	}
	return int(math.Ceil(prix/float64(pas))) * pas
}

// Calculer rend le prix d'une course. `distanceM` est la distance estimée
// (coefficient de détour déjà appliqué) ; nil si les épingles manquent.
//
// Une erreur n'est pas une panne : c'est la raison, affichable, pour laquelle
// aucun prix n'est annoncé. Mieux vaut « à confirmer » qu'un chiffre faux.
func Calculer(b Bareme, distanceM *int) (int, error) {
	switch b.Mode {
	case ModeForfait:
		return arrondirAuDessus(float64(*b.PrixForfait), b.Arrondi), nil

	case ModePaliers:
		if distanceM == nil {
			return 0, ErrDistanceInconnue
		}
		km := float64(*distanceM) / 1000
		for _, p := range b.Paliers {
			if km <= p.JusquAKm {
				return arrondirAuDessus(float64(p.Prix), b.Arrondi), nil
			}
		}
		return 0, ErrHorsPaliers

	case ModeDistance:
		if distanceM == nil {
			return 0, ErrDistanceInconnue
		}
		km := float64(*distanceM) / 1000
		prix := float64(*b.PrixBase) + km*float64(*b.PrixParKm)
		if b.PrixMinimum != nil && prix < float64(*b.PrixMinimum) {
			prix = float64(*b.PrixMinimum)
		}
		return arrondirAuDessus(prix, b.Arrondi), nil
	}
	return 0, errors.New("mode inconnu")
}
