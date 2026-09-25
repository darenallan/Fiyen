package handlers

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// Un journal sert de preuve. Ce qui compte n'est donc pas seulement qu'il
// s'écrive, mais qu'il ne se **réécrive** pas, et qu'il retienne ce qui était
// vrai au moment de l'action plutôt que ce qui l'est aujourd'hui.

func claimsDeTest(utilisateurID uuid.UUID, role models.Role) *middleware.Claims {
	return &middleware.Claims{UtilisateurID: utilisateurID, Role: role}
}

func TestJournal_EcritEtRelitDansLOrdre(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}
	ctx := context.Background()

	auteur := utilisateurJetable(t, pool)
	claims := claimsDeTest(auteur, models.RoleCompagnie)

	for _, typeEvt := range []string{EvtJournalCreee, EvtJournalAssignee, EvtJournalLivree} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("transaction: %v", err)
		}
		journaliser(ctx, tx, jeu.CourseID, typeEvt, claims, nil)
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
	}

	journal, err := deps.LireJournal(ctx, jeu.CourseID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(journal) != 3 {
		t.Fatalf("attendu 3 évènements, obtenu %d", len(journal))
	}

	// L'ordre chronologique est ce qui rend le journal lisible : « créée,
	// assignée, livrée » raconte une histoire, l'ordre d'insertion physique non.
	for i, attendu := range []string{EvtJournalCreee, EvtJournalAssignee, EvtJournalLivree} {
		if journal[i].Type != attendu {
			t.Errorf("évènement %d = %q, attendu %q", i, journal[i].Type, attendu)
		}
	}
}

func TestJournal_RetientLeRoleAuMomentDeLAction(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}
	ctx := context.Background()

	auteur := utilisateurJetable(t, pool)
	tx, _ := pool.Begin(ctx)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalAssignee,
		claimsDeTest(auteur, models.RoleCompagnie), nil)
	_ = tx.Commit(ctx)

	// Le compte change de rôle après coup. Le journal doit continuer de dire
	// « compagnie » : c'est ce qui était vrai quand l'assignation a eu lieu.
	if _, err := pool.Exec(ctx,
		`UPDATE utilisateurs SET role = 'livreur', livreur_id = $2, compagnie_id = NULL WHERE id = $1`,
		auteur, jeu.LivreurID); err != nil {
		// Les contraintes peuvent refuser ce changement : le test porte sur le
		// principe, pas sur la faisabilité de cette bascule précise.
		t.Skipf("bascule de rôle impossible en base (%v)", err)
	}

	journal, err := deps.LireJournal(ctx, jeu.CourseID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(journal) == 0 || journal[0].AuteurRole == nil {
		t.Fatal("le rôle de l'auteur manque")
	}
	if *journal[0].AuteurRole != string(models.RoleCompagnie) {
		t.Errorf("rôle = %q : le journal doit dire ce qui était vrai à l'instant, pas aujourd'hui",
			*journal[0].AuteurRole)
	}
}

func TestJournal_LesLignesNeSeModifientPas(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	tx, _ := pool.Begin(ctx)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalLivree,
		claimsDeTest(utilisateurJetable(t, pool), models.RoleLivreur), nil)
	_ = tx.Commit(ctx)

	// Le cœur du point : un journal qu'on peut réécrire ne prouve rien. La
	// garantie est portée par la base, pas par une convention de code — une
	// convention ne survit pas au premier script de correction lancé à la main.
	_, err := pool.Exec(ctx,
		`UPDATE evenements_course SET type = 'annulee' WHERE course_id = $1`, jeu.CourseID)
	if err == nil {
		t.Fatal("le journal doit refuser toute modification")
	}
	if !strings.Contains(err.Error(), "journal") {
		t.Errorf("le refus doit dire pourquoi : %v", err)
	}
}

func TestJournal_LaSuppressionRestePossible(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	tx, _ := pool.Begin(ctx)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalCreee, nil, nil)
	_ = tx.Commit(ctx)

	// Interdire aussi la suppression bloquerait la cascade depuis `courses` et
	// la future politique de rétention. Ce qui compte pour une preuve, c'est
	// qu'un évènement ne soit pas *altéré*.
	if _, err := pool.Exec(ctx,
		`DELETE FROM evenements_course WHERE course_id = $1`, jeu.CourseID); err != nil {
		t.Errorf("la suppression doit rester possible: %v", err)
	}
}

func TestJournal_UnEvenementSystemeNaPasDAuteur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}
	ctx := context.Background()

	tx, _ := pool.Begin(ctx)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalAnnulee, nil, nil)
	_ = tx.Commit(ctx)

	journal, err := deps.LireJournal(ctx, jeu.CourseID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(journal) != 1 {
		t.Fatalf("attendu 1 évènement, obtenu %d", len(journal))
	}
	// Nul plutôt qu'un auteur fictif : inventer un responsable serait pire que
	// de dire qu'on n'en a pas.
	if journal[0].AuteurNom != nil || journal[0].AuteurRole != nil {
		t.Errorf("un évènement système ne doit pas avoir d'auteur: %+v", journal[0])
	}
}

func TestJournal_LesDetailsSurvivent(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	deps := &Deps{DB: pool}
	ctx := context.Background()

	tx, _ := pool.Begin(ctx)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalAssignee, nil, map[string]string{
		"livreur_id": jeu.LivreurID.String(),
	})
	_ = tx.Commit(ctx)

	journal, err := deps.LireJournal(ctx, jeu.CourseID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	// Sans le livreur, le journal dirait qu'une assignation a eu lieu sans dire
	// à qui — ce qui n'aide personne à reconstituer ce qui s'est passé.
	if journal[0].Details["livreur_id"] != jeu.LivreurID.String() {
		t.Errorf("les détails doivent survivre au transport: %+v", journal[0].Details)
	}
}

func TestJournal_UneCourseSupprimeeEmporteSonJournal(t *testing.T) {
	pool := testdb.Ouvrir(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	tx, _ := pool.Begin(ctx)
	journaliser(ctx, tx, jeu.CourseID, EvtJournalCreee, nil, nil)
	_ = tx.Commit(ctx)

	// La cascade doit fonctionner malgré le trigger : sans cela, supprimer une
	// compagnie de test — ou appliquer une rétention — échouerait.
	if _, err := pool.Exec(ctx, `DELETE FROM courses WHERE id = $1`, jeu.CourseID); err != nil {
		t.Fatalf("la cascade doit passer: %v", err)
	}

	var reste int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM evenements_course WHERE course_id = $1`, jeu.CourseID).
		Scan(&reste); err != nil {
		t.Fatalf("comptage: %v", err)
	}
	if reste != 0 {
		t.Errorf("le journal doit suivre la course, %d ligne(s) restante(s)", reste)
	}
}
