package stats

import (
	"math"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)

func a(min int) *time.Time {
	v := t0.Add(time.Duration(min) * time.Minute)
	return &v
}

func prix(v int) *int { return &v }

func livree(num, livreur, partenaire string, assign, recup, livr int, p *int) Course {
	return Course{Numero: num, Statut: "livree", CreeLe: t0, AssigneeLe: a(assign), RecupereeLe: a(recup),
		LivreeLe: a(livr), LivreurID: livreur, LivreurNom: "L-" + livreur, PartenaireID: partenaire,
		PartenaireNom: "P-" + partenaire, Prix: p}
}

func proche(t *testing.T, nom string, got *float64, attendu float64) {
	t.Helper()
	if got == nil || math.Abs(*got-attendu) > 1e-9 {
		t.Errorf("%s = %v, attendu %v", nom, got, attendu)
	}
}

func TestCalculer_DelaisTauxEtMontant(t *testing.T) {
	courses := []Course{
		livree("1", "a", "x", 5, 20, 50, prix(1000)),  // prise 20 min, trajet 30 min
		livree("2", "a", "x", 10, 30, 90, prix(1500)), // prise 30 min, trajet 60 min
		livree("3", "b", "", 3, 10, 25, nil),          // saisie compagnie, sans prix
		{Numero: "4", Statut: "annulee", CreeLe: t0, AnnuleeLe: a(4), PartenaireID: "x", PartenaireNom: "P-x"},
		{Numero: "5", Statut: "en_route", CreeLe: t0, AssigneeLe: a(2), RecupereeLe: a(8), LivreurID: "b", LivreurNom: "L-b"},
	}
	ind := Calculer(courses)

	if ind.Creees != 5 || ind.Livrees != 3 || ind.Annulees != 1 || ind.EnCours != 1 {
		t.Fatalf("comptes : %+v", ind)
	}
	// Les courses en cours ne pèsent pas dans les taux.
	proche(t, "taux de réussite", ind.TauxReussite, 0.75)
	proche(t, "taux d'annulation", ind.TauxAnnulation, 0.25)

	// Assignation : 5, 10, 3, 2 min → moyenne 5 min, médiane 4 min.
	proche(t, "assignation moyenne", ind.DelaiAssignation.Moyenne, 5*60)
	proche(t, "assignation médiane", ind.DelaiAssignation.Mediane, 4*60)

	// Trajet (récupéré → livré) des seules livrées : 30, 60, 15 min.
	proche(t, "livraison moyenne", ind.DelaiLivraison.Moyenne, 35*60)
	if ind.DelaiLivraison.N != 3 {
		t.Errorf("livraison : %d mesures, attendu 3", ind.DelaiLivraison.N)
	}
	// Prise en charge : y compris la course en route (8 min) → 20, 30, 10, 8.
	proche(t, "prise en charge médiane", ind.DelaiPriseCharge.Mediane, 15*60)

	if ind.MontantLivre != 2500 || ind.LivreesSansPrix != 1 {
		t.Errorf("montant %d, sans prix %d ; attendu 2500 et 1", ind.MontantLivre, ind.LivreesSansPrix)
	}
}

func TestCalculer_PeriodeVideNInventeRien(t *testing.T) {
	ind := Calculer(nil)
	if ind.TauxReussite != nil || ind.DelaiLivraison.Moyenne != nil {
		t.Fatalf("une période vide doit rendre des indicateurs absents, pas des zéros : %+v", ind)
	}
}

func TestCalculer_IgnoreUneDureeNegative(t *testing.T) {
	// Horloge déréglée : la livraison serait antérieure à la récupération.
	c := livree("1", "a", "x", 5, 30, 20, nil)
	if ind := Calculer([]Course{c}); ind.DelaiLivraison.N != 0 {
		t.Fatalf("durée négative comptée : %+v", ind.DelaiLivraison)
	}
}

func TestParLivreurEtParPartenaire(t *testing.T) {
	courses := []Course{
		livree("1", "a", "x", 5, 20, 50, prix(1000)),
		livree("2", "a", "x", 10, 30, 90, prix(1500)),
		livree("3", "b", "", 3, 10, 25, nil),
		{Numero: "4", Statut: "annulee", CreeLe: t0, PartenaireID: "x", PartenaireNom: "P-x"},
	}
	l := ParLivreur(courses)
	if len(l) != 2 || l[0].Nom != "L-a" || l[0].Livrees != 2 {
		t.Fatalf("par livreur : %+v", l)
	}
	proche(t, "trajet moyen de a", l[0].DelaiLivraison.Moyenne, 45*60)

	p := ParPartenaire(courses)
	if len(p) != 2 || p[0].Nom != "P-x" || p[0].Commandes != 3 || p[0].Annulees != 1 || p[0].MontantLivre != 2500 {
		t.Fatalf("par partenaire : %+v", p)
	}
	if p[1].Nom != SaisieCompagnie {
		t.Errorf("les courses sans partenaire doivent être regroupées : %+v", p[1])
	}
}

func TestPeriodes_MoisEnCoursComparéAuxMemesJours(t *testing.T) {
	maintenant := time.Date(2026, 10, 21, 18, 0, 0, 0, time.UTC)
	cur, prec := Periodes(2026, time.October, maintenant, time.UTC)
	if !cur.Debut.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) || !cur.Fin.Equal(maintenant) {
		t.Errorf("mois en cours : %+v", cur)
	}
	if !prec.Debut.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)) ||
		!prec.Fin.Equal(time.Date(2026, 9, 21, 18, 0, 0, 0, time.UTC)) {
		t.Errorf("comparaison : %+v, attendu 1er → 21 septembre 18 h", prec)
	}

	// Mois révolu : comparaison au mois complet précédent.
	cur, prec = Periodes(2026, time.September, maintenant, time.UTC)
	if !cur.Fin.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) ||
		!prec.Debut.Equal(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)) ||
		!prec.Fin.Equal(cur.Debut) {
		t.Errorf("mois révolu : %+v / %+v", cur, prec)
	}

	// 31 mars : février n'a pas 31 jours, la comparaison ne déborde pas sur mars.
	fin := time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC)
	_, prec = Periodes(2026, time.March, fin, time.UTC)
	if prec.Fin.After(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("comparaison débordante : %+v", prec)
	}
}
