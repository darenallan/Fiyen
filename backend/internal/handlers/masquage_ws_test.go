package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/gofiber/fiber/v2"
	fiberws "github.com/gofiber/websocket/v2"
	"github.com/google/uuid"

	"fiyen-backend/internal/config"
	"fiyen-backend/internal/masquage"
	"fiyen-backend/internal/middleware"
	"fiyen-backend/internal/models"
	"fiyen-backend/internal/testdb"
)

// Tests de bout en bout du canal masqué : un vrai serveur, une vraie socket,
// une vraie base et un vrai Redis.
//
// Le canal est la seule voie de contact entre un client et son livreur, et sa
// garantie — aucun numéro échangé, aucune identité révélée, plus rien après la
// course — ne tient qu'à ce handler. La vérifier à la main à chaque
// modification n'était pas tenable ; c'est ce que ces tests remplacent.

const secretTest = "secret-de-test-uniquement"

// serveurTest monte l'application réelle sur un port éphémère et rend son URL
// WebSocket. Le port est choisi par le système : les tests ne peuvent pas
// entrer en conflit entre eux ni avec l'API de développement sur :8090.
func serveurTest(t *testing.T) (string, *testdb.Jeu) {
	t.Helper()

	pool := testdb.Ouvrir(t)
	rdb := testdb.OuvrirRedis(t)
	jeu := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))

	deps := &Deps{
		DB:     pool,
		Redis:  rdb,
		Config: &config.Config{JWTSecret: secretTest, JWTDureeMinutes: 30},
	}

	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Get("/ws/masquage/:sessionId",
		middleware.AuthRequisWS(secretTest),
		func(c *fiber.Ctx) error {
			if fiberws.IsWebSocketUpgrade(c) {
				return c.Next()
			}
			return fiber.ErrUpgradeRequired
		},
		fiberws.New(deps.MasquageWS),
	)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("écoute: %v", err)
	}
	go func() { _ = app.Listener(ln) }()
	t.Cleanup(func() { _ = app.Shutdown() })

	// Laisse le serveur prendre la main avant le premier dial.
	time.Sleep(120 * time.Millisecond)

	return fmt.Sprintf("ws://%s", ln.Addr().String()), &jeu
}

func jetonDestinataire(t *testing.T, destinataireID uuid.UUID) string {
	t.Helper()
	jeton, err := middleware.GenererToken(secretTest, 30, middleware.Claims{
		UtilisateurID:  uuid.New(),
		Role:           models.RoleDestinataire,
		DestinataireID: &destinataireID,
	})
	if err != nil {
		t.Fatalf("génération du jeton: %v", err)
	}
	return jeton
}

func jetonLivreur(t *testing.T, livreurID uuid.UUID) string {
	t.Helper()
	jeton, err := middleware.GenererToken(secretTest, 30, middleware.Claims{
		UtilisateurID: uuid.New(),
		Role:          models.RoleLivreur,
		LivreurID:     &livreurID,
	})
	if err != nil {
		t.Fatalf("génération du jeton: %v", err)
	}
	return jeton
}

func connecter(t *testing.T, base string, sessionID uuid.UUID, jeton string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	url := fmt.Sprintf("%s/ws/masquage/%s?token=%s", base, sessionID, jeton)
	conn, rep, err := websocket.DefaultDialer.Dial(url, nil)
	if conn != nil {
		t.Cleanup(func() { _ = conn.Close() })
	}
	return conn, rep, err
}

// lire attend un évènement, ou échoue au bout du délai.
func lire(t *testing.T, conn *websocket.Conn) evenementCanal {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))

	_, brut, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	var evt evenementCanal
	if err := json.Unmarshal(brut, &evt); err != nil {
		t.Fatalf("décodage %q: %v", brut, err)
	}
	return evt
}

func envoyer(t *testing.T, conn *websocket.Conn, evt any) {
	t.Helper()
	if err := conn.WriteJSON(evt); err != nil {
		t.Fatalf("envoi: %v", err)
	}
}

// --- Accès ----------------------------------------------------------------

func TestWS_TiersRefuse(t *testing.T) {
	base, jeu := serveurTest(t)

	// Un client authentifié, mais qui n'est pas celui de la course.
	conn, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.AutreDestinataire))
	if err != nil {
		return // refus dès le handshake : la garantie tient
	}

	// Sinon, le serveur doit fermer la socket au lieu de laisser entrer. Une
	// socket ouverte mais silencieuse ne suffit pas : le tiers y recevrait la
	// conversation dès le premier message échangé.
	if err := attendreFermeture(conn, 3*time.Second); err != nil {
		t.Fatalf("un tiers ne doit pas pouvoir écouter le canal: %v", err)
	}
}

func TestWS_SansJetonRefuse(t *testing.T) {
	base, jeu := serveurTest(t)

	url := fmt.Sprintf("%s/ws/masquage/%s", base, jeu.SessionID)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil {
		t.Fatal("une connexion sans jeton doit être refusée")
	}
}

func TestWS_JetonDeCompagnieRefuse(t *testing.T) {
	base, jeu := serveurTest(t)

	// La compagnie voit la course dans son dashboard, mais pas la conversation
	// de son client avec son livreur. C'est une exclusion volontaire.
	compagnieID := jeu.CompagnieID
	jeton, err := middleware.GenererToken(secretTest, 30, middleware.Claims{
		UtilisateurID: uuid.New(),
		Role:          models.RoleCompagnie,
		CompagnieID:   &compagnieID,
	})
	if err != nil {
		t.Fatalf("génération du jeton: %v", err)
	}

	conn, _, err := connecter(t, base, jeu.SessionID, jeton)
	if err != nil {
		return
	}
	if err := attendreFermeture(conn, 3*time.Second); err != nil {
		t.Fatalf("la compagnie ne doit pas pouvoir écouter le canal de ses destinataires: %v", err)
	}
}

// --- Conversation ---------------------------------------------------------

func TestWS_MessageRelayeALAutrePartie(t *testing.T) {
	base, jeu := serveurTest(t)

	cote1, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	cote2, _, err := connecter(t, base, jeu.SessionID, jetonLivreur(t, jeu.LivreurID))
	if err != nil {
		t.Fatalf("connexion livreur: %v", err)
	}

	// Laisse les deux abonnements Redis s'établir.
	time.Sleep(250 * time.Millisecond)

	envoyer(t, cote1, evenementCanal{Type: "message", Contenu: "je suis devant le portail"})

	recu := lire(t, cote2)
	if recu.Contenu != "je suis devant le portail" {
		t.Errorf("contenu = %q", recu.Contenu)
	}
	if recu.Expediteur != string(masquage.RoleDestinataire) {
		t.Errorf("expéditeur = %q, attendu %q", recu.Expediteur, masquage.RoleDestinataire)
	}
	if recu.ID == nil || recu.CreatedAt == nil {
		t.Error("un message relayé doit porter son identifiant et son horodatage serveur")
	}
}

func TestWS_ExpediteurNonUsurpable(t *testing.T) {
	base, jeu := serveurTest(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	livreur, _, err := connecter(t, base, jeu.SessionID, jetonLivreur(t, jeu.LivreurID))
	if err != nil {
		t.Fatalf("connexion livreur: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	// Le client prétend être le livreur, et antidate son message.
	faux := uuid.New()
	ancien := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	envoyer(t, client, evenementCanal{
		Type:       "message",
		Contenu:    "votre colis est perdu",
		Expediteur: string(masquage.RoleLivreur),
		ID:         &faux,
		CreatedAt:  &ancien,
	})

	recu := lire(t, livreur)

	// Le rôle vient de la session, pas du message : sans cela n'importe qui
	// pourrait se faire passer pour le livreur auprès du client.
	if recu.Expediteur != string(masquage.RoleDestinataire) {
		t.Errorf("expéditeur usurpé: %q", recu.Expediteur)
	}
	if recu.ID == nil || *recu.ID == faux {
		t.Error("l'identifiant du message doit être celui attribué par le serveur")
	}
	if recu.CreatedAt == nil || recu.CreatedAt.Equal(ancien) {
		t.Error("l'horodatage doit être celui du serveur, pas celui annoncé")
	}
}

func TestWS_MessagePersisteAvantRelais(t *testing.T) {
	base, jeu := serveurTest(t)
	pool := testdb.Ouvrir(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	livreur, _, err := connecter(t, base, jeu.SessionID, jetonLivreur(t, jeu.LivreurID))
	if err != nil {
		t.Fatalf("connexion livreur: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	envoyer(t, client, evenementCanal{Type: "message", Contenu: "j'arrive dans 5 min"})
	lire(t, livreur)

	// La persistance n'est pas un détail : sur un réseau instable, un simple
	// relais perdrait tout message envoyé pendant que l'autre est déconnecté.
	msgs, err := masquage.ListerMessages(context.Background(), pool, jeu.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Contenu != "j'arrive dans 5 min" {
		t.Errorf("le message doit être en base, obtenu %+v", msgs)
	}
}

func TestWS_MessageVideIgnore(t *testing.T) {
	base, jeu := serveurTest(t)
	pool := testdb.Ouvrir(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	envoyer(t, client, evenementCanal{Type: "message", Contenu: "   \n\t  "})
	envoyer(t, client, evenementCanal{Type: "message", Contenu: "vrai message"})

	// On attend que le second soit traité pour être sûr que le premier a eu sa
	// chance : sans repère, le test passerait par simple lenteur.
	livreur, _, err := connecter(t, base, jeu.SessionID, jetonLivreur(t, jeu.LivreurID))
	if err != nil {
		t.Fatalf("connexion livreur: %v", err)
	}
	_ = livreur
	time.Sleep(500 * time.Millisecond)

	msgs, err := masquage.ListerMessages(context.Background(), pool, jeu.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Contenu != "vrai message" {
		t.Errorf("seul le message non vide doit être conservé, obtenu %+v", msgs)
	}
}

func TestWS_MessageTronqueALaLimite(t *testing.T) {
	base, jeu := serveurTest(t)
	pool := testdb.Ouvrir(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	long := ""
	for i := 0; i < 1500; i++ {
		long += "a"
	}
	envoyer(t, client, evenementCanal{Type: "message", Contenu: long})
	time.Sleep(500 * time.Millisecond)

	// Tronquer plutôt que rejeter : la contrainte SQL refuserait l'insertion et
	// le message disparaîtrait sans que l'expéditeur en soit averti.
	msgs, err := masquage.ListerMessages(context.Background(), pool, jeu.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("attendu 1 message, obtenu %d", len(msgs))
	}
	if len(msgs[0].Contenu) != tailleMaxMessage {
		t.Errorf("longueur = %d, attendu %d", len(msgs[0].Contenu), tailleMaxMessage)
	}
}

// --- Signaling WebRTC -----------------------------------------------------

func TestWS_SignalingRelayeMaisNonPersiste(t *testing.T) {
	base, jeu := serveurTest(t)
	pool := testdb.Ouvrir(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	livreur, _, err := connecter(t, base, jeu.SessionID, jetonLivreur(t, jeu.LivreurID))
	if err != nil {
		t.Fatalf("connexion livreur: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	envoyer(t, client, evenementCanal{
		Type:   "offre",
		Signal: json.RawMessage(`{"sdp":"v=0 test"}`),
	})

	recu := lire(t, livreur)
	if recu.Type != "offre" {
		t.Errorf("type = %q, attendu \"offre\"", recu.Type)
	}
	if !json.Valid(recu.Signal) || string(recu.Signal) != `{"sdp":"v=0 test"}` {
		t.Errorf("le signal doit être relayé intact, obtenu %s", recu.Signal)
	}
	if recu.Expediteur != string(masquage.RoleDestinataire) {
		t.Errorf("expéditeur = %q", recu.Expediteur)
	}

	// Le contenu WebRTC n'a aucun intérêt à être conservé, et le conserver
	// reviendrait à garder une trace de qui a appelé qui.
	msgs, err := masquage.ListerMessages(context.Background(), pool, jeu.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 0 {
		t.Errorf("le signaling ne doit rien laisser en base, obtenu %+v", msgs)
	}
}

func TestWS_TypeInconnuIgnore(t *testing.T) {
	base, jeu := serveurTest(t)
	pool := testdb.Ouvrir(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	// Le canal n'est pas un transport générique : ce qui n'est ni un message ni
	// une primitive WebRTC connue doit tomber.
	envoyer(t, client, map[string]any{"type": "systeme", "contenu": "DROP TABLE"})
	envoyer(t, client, map[string]any{"type": "", "contenu": "vide"})
	envoyer(t, client, evenementCanal{Type: "message", Contenu: "repère"})
	time.Sleep(500 * time.Millisecond)

	msgs, err := masquage.ListerMessages(context.Background(), pool, jeu.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Contenu != "repère" {
		t.Errorf("seuls les types connus doivent être traités, obtenu %+v", msgs)
	}
}

func TestWS_JsonInvalideNeFermePasLaSocket(t *testing.T) {
	base, jeu := serveurTest(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	livreur, _, err := connecter(t, base, jeu.SessionID, jetonLivreur(t, jeu.LivreurID))
	if err != nil {
		t.Fatalf("connexion livreur: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	// Sur un réseau dégradé, une trame tronquée ne doit pas coûter la
	// conversation : le serveur l'ignore et continue.
	if err := client.WriteMessage(websocket.TextMessage, []byte("{pas du json")); err != nil {
		t.Fatalf("envoi: %v", err)
	}
	envoyer(t, client, evenementCanal{Type: "message", Contenu: "toujours là"})

	if recu := lire(t, livreur); recu.Contenu != "toujours là" {
		t.Errorf("la socket doit survivre à une trame illisible, obtenu %q", recu.Contenu)
	}
}

// --- Expiration -----------------------------------------------------------

func TestWS_ConnexionRefuseeSiSessionExpiree(t *testing.T) {
	pool := testdb.Ouvrir(t)
	base, jeu := serveurTest(t)

	if _, err := pool.Exec(context.Background(),
		`UPDATE sessions_masquage SET expire_at = now() - interval '1 minute' WHERE id = $1`,
		jeu.SessionID); err != nil {
		t.Fatalf("clôture: %v", err)
	}

	conn, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		return // refusé au handshake
	}
	if err := attendreFermeture(conn, 3*time.Second); err != nil {
		t.Fatalf("un canal fermé ne doit pas accepter de connexion: %v", err)
	}
}

func TestWS_EnvoiRefuseSiSessionExpirePendantLaConnexion(t *testing.T) {
	pool := testdb.Ouvrir(t)
	base, jeu := serveurTest(t)

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion client: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	// La course se termine alors que la socket est déjà ouverte. C'est le cas
	// réel : le livreur passe la course à « livrée » pendant que le client a
	// encore son écran de chat affiché.
	if _, err := pool.Exec(context.Background(),
		`UPDATE sessions_masquage SET expire_at = now() - interval '1 minute' WHERE id = $1`,
		jeu.SessionID); err != nil {
		t.Fatalf("clôture: %v", err)
	}

	envoyer(t, client, evenementCanal{Type: "message", Contenu: "encore un mot"})
	time.Sleep(500 * time.Millisecond)

	msgs, err := masquage.ListerMessages(context.Background(), pool, jeu.SessionID)
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(msgs) != 0 {
		t.Errorf("plus rien ne doit être écrit après la clôture, obtenu %+v", msgs)
	}

	// Et la socket doit être **fermée**, pas laissée ouverte à tourner à vide.
	//
	// Distinguer la fermeture du simple silence est indispensable : un
	// `ReadMessage` sur une socket ouverte mais muette rend lui aussi une
	// erreur — un timeout — et une assertion sur `err != nil` passerait alors
	// même si le serveur avait cessé de revérifier l'expiration.
	if err := attendreFermeture(client, 3*time.Second); err != nil {
		t.Errorf("la socket doit être fermée quand le canal se ferme: %v", err)
	}
}

// attendreFermeture rend nil si la socket a bien été fermée par le serveur, et
// une erreur explicative si elle est restée ouverte (silence prolongé).
func attendreFermeture(conn *websocket.Conn, delai time.Duration) error {
	_ = conn.SetReadDeadline(time.Now().Add(delai))

	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue // trame résiduelle : on poursuit jusqu'à la fermeture
		}
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return fmt.Errorf("socket toujours ouverte après %s", delai)
		}
		return nil // fermeture effective
	}
}

// --- Cloisonnement --------------------------------------------------------

func TestWS_PasDeFuiteEntreConversations(t *testing.T) {
	pool := testdb.Ouvrir(t)
	rdb := testdb.OuvrirRedis(t)
	autre := testdb.CreerJeu(t, pool, time.Now().Add(time.Hour))
	base, jeu := serveurTest(t)
	_ = rdb

	client, _, err := connecter(t, base, jeu.SessionID, jetonDestinataire(t, jeu.DestinataireID))
	if err != nil {
		t.Fatalf("connexion: %v", err)
	}
	espion, _, err := connecter(t, base, autre.SessionID, jetonDestinataire(t, autre.DestinataireID))
	if err != nil {
		t.Fatalf("connexion seconde conversation: %v", err)
	}
	time.Sleep(250 * time.Millisecond)

	envoyer(t, client, evenementCanal{Type: "message", Contenu: "confidentiel"})

	// La seconde conversation ne doit rien recevoir : le canal Redis est
	// dérivé du session_id, pas partagé.
	_ = espion.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
	if _, brut, err := espion.ReadMessage(); err == nil {
		t.Errorf("fuite entre conversations: %s", brut)
	}
}
