package masquage_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"fiyen-backend/internal/masquage"
	"fiyen-backend/internal/testdb"
)

// Ces tests portent la garantie centrale du produit : aucun numéro réel ne
// circule, le destinataire n'apprend jamais l'identité de son livreur, et le canal
// se ferme avec la course. Ils étaient jusqu'ici vérifiés à la main — donc
// reperdus à chaque modification.

func ptr(id uuid.UUID) *uuid.UUID { return &id }

// --- Accès au canal -------------------------------------------------------

func TestResoudreSession_DestinataireDeLaCourse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	s, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("le destinataire de la course doit accéder à son canal: %v", err)
	}
	if s.Role != masquage.RoleDestinataire {
		t.Errorf("rôle = %q, attendu %q", s.Role, masquage.RoleDestinataire)
	}
	if s.ID != j.SessionID {
		t.Errorf("session_id = %v, attendu %v", s.ID, j.SessionID)
	}
}

func TestResoudreSession_LivreurAssigne(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	s, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, nil, ptr(j.LivreurID))
	if err != nil {
		t.Fatalf("le livreur assigné doit accéder au canal: %v", err)
	}
	if s.Role != masquage.RoleLivreur {
		t.Errorf("rôle = %q, attendu %q", s.Role, masquage.RoleLivreur)
	}
}

func TestResoudreSession_AutreDestinataireRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	_, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, ptr(j.AutreDestinataire), nil)
	if !errors.Is(err, masquage.ErrAccesRefuse) {
		t.Fatalf("un autre destinataire doit être refusé, obtenu: %v", err)
	}
}

func TestResoudreSession_AutreLivreurRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	// Même compagnie, même flotte : être livreur ne suffit pas, il faut être
	// *le* livreur de cette course.
	_, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, nil, ptr(j.AutreLivreu))
	if !errors.Is(err, masquage.ErrAccesRefuse) {
		t.Fatalf("un livreur non assigné doit être refusé, obtenu: %v", err)
	}
}

func TestResoudreSession_SansIdentiteRefuse(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	// C'est le cas d'un jeton de compagnie : ni destinataire_id ni livreur_id. La
	// compagnie voit la course, mais pas la conversation de ses destinataires.
	_, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, nil, nil)
	if !errors.Is(err, masquage.ErrAccesRefuse) {
		t.Fatalf("un porteur sans identité doit être refusé, obtenu: %v", err)
	}
}

func TestResoudreSession_CourseInconnue(t *testing.T) {
	pool := testdb.Ouvrir(t)

	_, err := masquage.ResoudreSession(context.Background(), pool, uuid.New(), ptr(uuid.New()), nil)
	if !errors.Is(err, masquage.ErrSessionIntrouvable) {
		t.Fatalf("attendu ErrSessionIntrouvable, obtenu: %v", err)
	}
}

func TestResoudreSessionParID_MemesControles(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	// Le session_id est le seul identifiant que le front manipule : l'entrée
	// par cet identifiant doit être aussi verrouillée que l'entrée par course.
	if _, err := masquage.ResoudreSessionParID(ctx, pool, j.SessionID, ptr(j.DestinataireID), nil); err != nil {
		t.Fatalf("le destinataire doit accéder au canal par session_id: %v", err)
	}

	_, err := masquage.ResoudreSessionParID(ctx, pool, j.SessionID, ptr(j.AutreDestinataire), nil)
	if !errors.Is(err, masquage.ErrAccesRefuse) {
		t.Fatalf("un tiers doit être refusé par session_id aussi, obtenu: %v", err)
	}
}

func TestResoudreSessionParID_SessionInconnue(t *testing.T) {
	pool := testdb.Ouvrir(t)

	_, err := masquage.ResoudreSessionParID(context.Background(), pool, uuid.New(), ptr(uuid.New()), nil)
	if !errors.Is(err, masquage.ErrSessionIntrouvable) {
		t.Fatalf("attendu ErrSessionIntrouvable, obtenu: %v", err)
	}
}

// --- Ce que la session laisse filtrer -------------------------------------

func TestSession_NeRevelePasLIdentiteDeLAutrePartie(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	s, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}

	// Contrôle sur la structure sérialisée, pas sur les champs un à un : c'est
	// ce que le front reçoit réellement, et un champ ajouté par mégarde serait
	// attrapé ici.
	json := serialiser(t, s)
	for _, interdit := range []string{
		j.LivreurID.String(),
		j.CompagnieID.String(),
		"telephone",
		"livreur_id",
	} {
		if strings.Contains(json, interdit) {
			t.Errorf("la session exposée au destinataire contient %q: %s", interdit, json)
		}
	}
}

func TestSession_NumeroVirtuelAbsentParDefaut(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	s, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}
	if s.NumeroVirtuel != nil {
		t.Errorf("aucun PSTN n'est provisionné, le numéro doit rester nul (obtenu %q)", *s.NumeroVirtuel)
	}
	if strings.Contains(serialiser(t, s), "numero_virtuel") {
		t.Error("le champ numero_virtuel ne doit pas apparaître quand il est nul")
	}
}

// --- Expiration -----------------------------------------------------------

func TestSession_ActiveAvantExpiration(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	s, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}
	if !s.Active {
		t.Error("une session dont l'échéance est à venir doit être active")
	}
}

func TestSession_InactiveApresExpiration(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(-time.Minute))

	s, err := masquage.ResoudreSession(context.Background(), pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}
	if s.Active {
		t.Error("une session échue doit être inactive")
	}
}

func TestEnregistrerMessage_RefuseSiExpiree(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(-time.Minute))
	ctx := context.Background()

	s, err := masquage.ResoudreSession(ctx, pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}

	// Le point sensible : une course terminée ne doit plus permettre de
	// joindre l'autre partie, même si le front a gardé le session_id.
	if _, err := masquage.EnregistrerMessage(ctx, pool, s, "coucou"); !errors.Is(err, masquage.ErrSessionExpiree) {
		t.Fatalf("attendu ErrSessionExpiree, obtenu: %v", err)
	}

	msgs, err := masquage.ListerMessages(ctx, pool, s.ID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 0 {
		t.Errorf("aucun message ne doit avoir été écrit, obtenu %d", len(msgs))
	}
}

func TestListerMessages_HistoriqueLisibleApresExpiration(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	s, err := masquage.ResoudreSession(ctx, pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}
	if _, err := masquage.EnregistrerMessage(ctx, pool, s, "je suis en bas"); err != nil {
		t.Fatalf("écriture: %v", err)
	}

	// La course se termine.
	if _, err := pool.Exec(ctx,
		`UPDATE sessions_masquage SET expire_at = now() - interval '1 minute' WHERE id = $1`,
		s.ID); err != nil {
		t.Fatalf("clôture: %v", err)
	}

	apres, err := masquage.ResoudreSession(ctx, pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution après clôture: %v", err)
	}
	if apres.Active {
		t.Error("la session doit être close")
	}

	// Fermer le canal n'efface pas la conversation : le client doit pouvoir
	// relire ce qui a été convenu.
	msgs, err := masquage.ListerMessages(ctx, pool, s.ID)
	if err != nil {
		t.Fatalf("lecture après clôture: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Contenu != "je suis en bas" {
		t.Errorf("l'historique doit rester lisible, obtenu %+v", msgs)
	}
}

// --- Messages -------------------------------------------------------------

func TestEnregistrerMessage_PorteLeRoleDeLExpediteur(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	cote := func(destinataireID, livreurID *uuid.UUID) *masquage.Session {
		t.Helper()
		s, err := masquage.ResoudreSession(ctx, pool, j.CourseID, destinataireID, livreurID)
		if err != nil {
			t.Fatalf("résolution: %v", err)
		}
		return s
	}

	mClient, err := masquage.EnregistrerMessage(ctx, pool, cote(ptr(j.DestinataireID), nil), "vous êtes loin ?")
	if err != nil {
		t.Fatalf("écriture client: %v", err)
	}
	mLivreur, err := masquage.EnregistrerMessage(ctx, pool, cote(nil, ptr(j.LivreurID)), "5 minutes")
	if err != nil {
		t.Fatalf("écriture livreur: %v", err)
	}

	// L'expéditeur est un rôle, jamais une identité : c'est ce qui permet au
	// front d'afficher « votre livreur » sans jamais nommer personne.
	if mClient.Expediteur != masquage.RoleDestinataire {
		t.Errorf("expéditeur = %q, attendu %q", mClient.Expediteur, masquage.RoleDestinataire)
	}
	if mLivreur.Expediteur != masquage.RoleLivreur {
		t.Errorf("expéditeur = %q, attendu %q", mLivreur.Expediteur, masquage.RoleLivreur)
	}
	if strings.Contains(serialiser(t, mLivreur), j.LivreurID.String()) {
		t.Error("un message ne doit pas porter l'identifiant du livreur")
	}
}

func TestListerMessages_OrdreChronologique(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	s, err := masquage.ResoudreSession(ctx, pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}

	for _, contenu := range []string{"premier", "deuxième", "troisième"} {
		if _, err := masquage.EnregistrerMessage(ctx, pool, s, contenu); err != nil {
			t.Fatalf("écriture %q: %v", contenu, err)
		}
	}

	msgs, err := masquage.ListerMessages(ctx, pool, s.ID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 3 {
		t.Fatalf("attendu 3 messages, obtenu %d", len(msgs))
	}
	for i, attendu := range []string{"premier", "deuxième", "troisième"} {
		if msgs[i].Contenu != attendu {
			t.Errorf("message %d = %q, attendu %q", i, msgs[i].Contenu, attendu)
		}
	}
}

func TestListerMessages_CanalVideNestPasNul(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	msgs, err := masquage.ListerMessages(context.Background(), pool, j.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	// `[]` et non `null` : le front itère dessus sans garde.
	if msgs == nil {
		t.Error("un canal vide doit rendre une tranche vide, pas nil")
	}
	if len(msgs) != 0 {
		t.Errorf("attendu 0 message, obtenu %d", len(msgs))
	}
}

func TestListerMessages_IsolationEntreConversations(t *testing.T) {
	pool := testdb.Ouvrir(t)
	a := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	b := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	sa, err := masquage.ResoudreSession(ctx, pool, a.CourseID, ptr(a.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution A: %v", err)
	}
	if _, err := masquage.EnregistrerMessage(ctx, pool, sa, "secret de A"); err != nil {
		t.Fatalf("écriture A: %v", err)
	}

	msgs, err := masquage.ListerMessages(ctx, pool, b.SessionID)
	if err != nil {
		t.Fatalf("lecture B: %v", err)
	}
	if len(msgs) != 0 {
		t.Errorf("la conversation B ne doit rien voir de A, obtenu %+v", msgs)
	}
}

func TestEnregistrerMessage_ContenuHorsBornesRejete(t *testing.T) {
	pool := testdb.Ouvrir(t)
	j := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	ctx := context.Background()

	s, err := masquage.ResoudreSession(ctx, pool, j.CourseID, ptr(j.DestinataireID), nil)
	if err != nil {
		t.Fatalf("résolution: %v", err)
	}

	// La contrainte est portée par le schéma (1..1000). Le handler tronque en
	// amont ; ce test garantit que la base reste la dernière ligne de défense
	// même si un autre appelant l'oubliait.
	if _, err := masquage.EnregistrerMessage(ctx, pool, s, ""); err == nil {
		t.Error("un message vide doit être rejeté")
	}
	if _, err := masquage.EnregistrerMessage(ctx, pool, s, strings.Repeat("a", 1001)); err == nil {
		t.Error("un message de plus de 1000 caractères doit être rejeté")
	}
	if _, err := masquage.EnregistrerMessage(ctx, pool, s, strings.Repeat("a", 1000)); err != nil {
		t.Errorf("1000 caractères est la limite haute admise: %v", err)
	}
}

// --- Cloisonnement du canal temps réel ------------------------------------

func TestCanalRedis_UnParSession(t *testing.T) {
	a, b := uuid.New(), uuid.New()

	if masquage.CanalRedis(a) == masquage.CanalRedis(b) {
		t.Error("deux sessions ne doivent jamais partager un canal Redis")
	}
	if masquage.CanalRedis(a) != masquage.CanalRedis(a) {
		t.Error("le nom du canal doit être stable pour une session donnée")
	}
	if !strings.Contains(masquage.CanalRedis(a), a.String()) {
		t.Errorf("le canal doit être dérivé du session_id, obtenu %q", masquage.CanalRedis(a))
	}
}

// --- Repli PSTN -----------------------------------------------------------

func TestPSTNNonConfigure_EchoueSansSimuler(t *testing.T) {
	var f masquage.FournisseurPSTN = masquage.PSTNNonConfigure{}
	ctx := context.Background()

	numero, err := f.ProvisionnerNumero(ctx, uuid.New(), time.Now().Add(time.Hour))
	if !errors.Is(err, masquage.ErrPSTNNonConfigure) {
		t.Fatalf("attendu ErrPSTNNonConfigure, obtenu: %v", err)
	}
	// Le point important : pas de numéro plausible en cas d'échec. Un faux
	// numéro donnerait l'illusion d'un canal de secours, et le défaut ne se
	// verrait qu'au moment où un client essaie vraiment d'appeler.
	if numero != "" {
		t.Errorf("aucun numéro ne doit être rendu, obtenu %q", numero)
	}

	if err := f.LibererNumero(ctx, uuid.New()); !errors.Is(err, masquage.ErrPSTNNonConfigure) {
		t.Errorf("la libération doit échouer explicitement, obtenu: %v", err)
	}
}
