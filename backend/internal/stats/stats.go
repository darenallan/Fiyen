// Package stats agrège les courses d'une période en indicateurs de pilotage.
//
// L'agrégation est une fonction pure, sans base : la requête ramène une ligne
// par course avec les horodatages de son journal, et tout le reste se calcule
// ici, où chaque définition se lit et se teste.
package stats

import (
	"sort"
	"time"
)

// Course est une course de la période, avec les instants tirés du journal.
// Un instant absent est nil (étape pas encore atteinte, ou jamais).
type Course struct {
	Numero        string
	Statut        string
	CreeLe        time.Time
	AssigneeLe    *time.Time
	RecupereeLe   *time.Time
	LivreeLe      *time.Time
	AnnuleeLe     *time.Time
	LivreurID     string
	LivreurNom    string
	PartenaireID  string
	PartenaireNom string
	Prix          *int
}

// Delai résume une série de durées, en secondes.
type Delai struct {
	Moyenne *float64 `json:"moyenne_s"`
	Mediane *float64 `json:"mediane_s"`
	N       int      `json:"n"`
}

// Indicateurs d'une période. Voir Definitions pour le sens exact de chacun.
type Indicateurs struct {
	Creees           int      `json:"creees"`
	Livrees          int      `json:"livrees"`
	Annulees         int      `json:"annulees"`
	EnCours          int      `json:"en_cours"`
	TauxReussite     *float64 `json:"taux_reussite"`
	TauxAnnulation   *float64 `json:"taux_annulation"`
	DelaiAssignation Delai    `json:"delai_assignation"`
	DelaiPriseCharge Delai    `json:"delai_prise_en_charge"`
	DelaiLivraison   Delai    `json:"delai_livraison"`
	DureeTotale      Delai    `json:"duree_totale"`
	MontantLivre     int      `json:"montant_livre"`
	LivreesSansPrix  int      `json:"livrees_sans_prix"`
}

// LigneLivreur : activité d'un livreur sur la période.
type LigneLivreur struct {
	Nom            string `json:"nom"`
	Livrees        int    `json:"livrees"`
	EnCours        int    `json:"en_cours"`
	DelaiLivraison Delai  `json:"delai_livraison"`
}

// LignePartenaire : activité d'une entreprise cliente sur la période.
type LignePartenaire struct {
	Nom          string `json:"nom"`
	Commandes    int    `json:"commandes"`
	Livrees      int    `json:"livrees"`
	Annulees     int    `json:"annulees"`
	MontantLivre int    `json:"montant_livre"`
}

// Definitions : le texte affiché à côté de chaque indicateur. Il vit avec le
// calcul pour qu'une définition ne puisse pas changer sans que le code change.
var Definitions = map[string]string{
	"creees":                "Courses dont la création tombe dans la période, quel que soit leur état aujourd'hui.",
	"taux_reussite":         "Livrées ÷ (livrées + annulées). Les courses encore en cours ne comptent pas : on ne sait pas encore comment elles finiront.",
	"taux_annulation":       "Annulées ÷ (livrées + annulées).",
	"delai_assignation":     "De la création de la course à l'assignation d'un livreur. Mesure la réactivité de la compagnie.",
	"delai_prise_en_charge": "De la création au « colis récupéré ». C'est ce qu'attend le partenaire avant que son colis parte.",
	"delai_livraison":       "Du « colis récupéré » au « livré ». Mesure le trajet, pas l'attente.",
	"duree_totale":          "De la création au « livré ». Ce que vit le client final.",
	"montant_livre":         "Somme des prix figés à la commande (barème) des courses livrées. Les courses sans prix (pas de barème ou épingles manquantes) n'y figurent pas et sont comptées à part.",
	"mediane":               "La médiane est la valeur du milieu : une course bloquée deux heures ne la fait pas bouger, alors qu'elle tire la moyenne.",
}

func resumer(durees []float64) Delai {
	d := Delai{N: len(durees)}
	if len(durees) == 0 {
		return d
	}
	somme := 0.0
	for _, v := range durees {
		somme += v
	}
	moy := somme / float64(len(durees))
	tri := append([]float64(nil), durees...)
	sort.Float64s(tri)
	var med float64
	if n := len(tri); n%2 == 1 {
		med = tri[n/2]
	} else {
		med = (tri[n/2-1] + tri[n/2]) / 2
	}
	d.Moyenne, d.Mediane = &moy, &med
	return d
}

// ecart rend la durée b-a en secondes, ou faux si l'une manque ou si l'ordre
// est incohérent (horloge déréglée) : mieux vaut ignorer qu'une durée négative.
func ecart(a time.Time, b *time.Time) (float64, bool) {
	if b == nil {
		return 0, false
	}
	s := b.Sub(a).Seconds()
	return s, s >= 0
}

func ecartPtr(a, b *time.Time) (float64, bool) {
	if a == nil {
		return 0, false
	}
	return ecart(*a, b)
}

func ratio(n, d int) *float64 {
	if d == 0 {
		return nil
	}
	r := float64(n) / float64(d)
	return &r
}

// Calculer agrège les courses d'une période.
func Calculer(courses []Course) Indicateurs {
	var ind Indicateurs
	var assign, prise, livr, total []float64
	for _, c := range courses {
		ind.Creees++
		switch c.Statut {
		case "livree":
			ind.Livrees++
			if c.Prix != nil {
				ind.MontantLivre += *c.Prix
			} else {
				ind.LivreesSansPrix++
			}
		case "annulee":
			ind.Annulees++
		default:
			ind.EnCours++
		}
		if s, ok := ecart(c.CreeLe, c.AssigneeLe); ok {
			assign = append(assign, s)
		}
		if s, ok := ecart(c.CreeLe, c.RecupereeLe); ok {
			prise = append(prise, s)
		}
		if c.Statut == "livree" {
			if s, ok := ecartPtr(c.RecupereeLe, c.LivreeLe); ok {
				livr = append(livr, s)
			}
			if s, ok := ecart(c.CreeLe, c.LivreeLe); ok {
				total = append(total, s)
			}
		}
	}
	terminees := ind.Livrees + ind.Annulees
	ind.TauxReussite = ratio(ind.Livrees, terminees)
	ind.TauxAnnulation = ratio(ind.Annulees, terminees)
	ind.DelaiAssignation = resumer(assign)
	ind.DelaiPriseCharge = resumer(prise)
	ind.DelaiLivraison = resumer(livr)
	ind.DureeTotale = resumer(total)
	return ind
}

// ParLivreur : une ligne par livreur ayant eu au moins une course, triée par
// nombre de livraisons décroissant.
func ParLivreur(courses []Course) []LigneLivreur {
	type acc struct {
		l      LigneLivreur
		durees []float64
	}
	parID := map[string]*acc{}
	for _, c := range courses {
		if c.LivreurID == "" {
			continue
		}
		a, ok := parID[c.LivreurID]
		if !ok {
			a = &acc{l: LigneLivreur{Nom: c.LivreurNom}}
			parID[c.LivreurID] = a
		}
		switch c.Statut {
		case "livree":
			a.l.Livrees++
			if s, ok := ecartPtr(c.RecupereeLe, c.LivreeLe); ok {
				a.durees = append(a.durees, s)
			}
		case "assignee", "recuperee", "en_route":
			a.l.EnCours++
		}
	}
	lignes := make([]LigneLivreur, 0, len(parID))
	for _, a := range parID {
		a.l.DelaiLivraison = resumer(a.durees)
		lignes = append(lignes, a.l)
	}
	sort.Slice(lignes, func(i, j int) bool {
		if lignes[i].Livrees != lignes[j].Livrees {
			return lignes[i].Livrees > lignes[j].Livrees
		}
		return lignes[i].Nom < lignes[j].Nom
	})
	return lignes
}

// SaisieCompagnie : libellé des courses saisies par la compagnie elle-même.
const SaisieCompagnie = "Saisies par la compagnie"

// ParPartenaire : une ligne par entreprise cliente, plus une pour les courses
// saisies par la compagnie (commandes reçues au téléphone).
func ParPartenaire(courses []Course) []LignePartenaire {
	parID := map[string]*LignePartenaire{}
	for _, c := range courses {
		cle, nom := c.PartenaireID, c.PartenaireNom
		if cle == "" {
			nom = SaisieCompagnie
		}
		l, ok := parID[cle]
		if !ok {
			l = &LignePartenaire{Nom: nom}
			parID[cle] = l
		}
		l.Commandes++
		switch c.Statut {
		case "livree":
			l.Livrees++
			if c.Prix != nil {
				l.MontantLivre += *c.Prix
			}
		case "annulee":
			l.Annulees++
		}
	}
	lignes := make([]LignePartenaire, 0, len(parID))
	for _, l := range parID {
		lignes = append(lignes, *l)
	}
	sort.Slice(lignes, func(i, j int) bool {
		if lignes[i].Commandes != lignes[j].Commandes {
			return lignes[i].Commandes > lignes[j].Commandes
		}
		return lignes[i].Nom < lignes[j].Nom
	})
	return lignes
}

// Periode : bornes [Debut, Fin) d'une période.
type Periode struct {
	Debut time.Time `json:"debut"`
	Fin   time.Time `json:"fin"`
}

// Periodes rend le mois demandé et la période de comparaison.
//
// Pour le mois en cours, la comparaison porte sur **les mêmes jours** du mois
// précédent (du 1er au même instant) : comparer trois semaines à un mois
// complet ferait toujours croire à une baisse. Pour un mois révolu, on compare
// au mois complet précédent.
func Periodes(annee int, mois time.Month, maintenant time.Time, loc *time.Location) (Periode, Periode) {
	debut := time.Date(annee, mois, 1, 0, 0, 0, 0, loc)
	finMois := debut.AddDate(0, 1, 0)
	debutPrec := debut.AddDate(0, -1, 0)

	if maintenant.Before(finMois) && !maintenant.Before(debut) {
		finPrec := debutPrec.Add(maintenant.Sub(debut))
		if finPrec.After(debut) {
			finPrec = debut
		}
		return Periode{debut, maintenant}, Periode{debutPrec, finPrec}
	}
	return Periode{debut, finMois}, Periode{debutPrec, debut}
}
