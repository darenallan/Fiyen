import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  urlWebSocketMasquage,
  assurerJetonFrais,
  type MessageMasque,
  type SessionMasquage,
} from './api';

const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;

/**
 * Conversation masquée avec le livreur.
 *
 * Le client ne voit jamais qui est son livreur : ni nom, ni numéro, ni
 * identifiant. Seul le `session_id` de la course identifie le canal, et il
 * devient inutilisable une fois la livraison faite.
 */
export function ChatMasque({ courseId }: { courseId: string }) {
  const [session, setSession] = useState<SessionMasquage | null>(null);
  const [messages, setMessages] = useState<MessageMasque[]>([]);
  const [brouillon, setBrouillon] = useState('');
  const [connecte, setConnecte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const delaiRef = useRef(DELAI_RECONNEXION_MIN_MS);
  const montéRef = useRef(true);
  const filRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    montéRef.current = true;

    (async () => {
      try {
        const s = await api.sessionMasquage(courseId);
        if (!montéRef.current) return;
        setSession(s);

        const histo = await api.messagesMasques(s.session_id);
        if (!montéRef.current) return;
        setMessages(histo ?? []);

        if (s.active) void connecter(s.session_id);
      } catch (err) {
        if (!montéRef.current) return;
        setErreur(
          err instanceof ApiError && err.status === 404
            ? 'Vous pourrez écrire à votre livreur dès qu’il sera assigné.'
            : 'Impossible d’ouvrir la conversation.',
        );
      }
    })();

    async function connecter(sessionId: string) {
      if (!montéRef.current) return;
      // Le jeton part dans l'URL du handshake et ne peut pas être rejoué :
      // il doit être frais *avant* l'ouverture, pas rattrapé après.
      await assurerJetonFrais();
      if (!montéRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(urlWebSocketMasquage(sessionId));
      } catch {
        programmerReconnexion(sessionId);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        delaiRef.current = DELAI_RECONNEXION_MIN_MS;
        if (montéRef.current) setConnecte(true);
      };

      ws.onmessage = (event) => {
        let evt: { type: string; id?: string } & MessageMasque;
        try {
          evt = JSON.parse(event.data);
        } catch {
          return;
        }
        if (evt.type !== 'message') return; // le signaling WebRTC ne s'affiche pas
        setMessages((prec) =>
          prec.some((m) => m.id === evt.id)
            ? prec
            : [...prec, { id: evt.id!, expediteur: evt.expediteur, contenu: evt.contenu, created_at: evt.created_at }],
        );
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (montéRef.current) setConnecte(false);
        programmerReconnexion(sessionId);
      };

      ws.onerror = () => ws.close();
    }

    function programmerReconnexion(sessionId: string) {
      if (!montéRef.current || timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void connecter(sessionId);
      }, delaiRef.current);
      delaiRef.current = Math.min(delaiRef.current * 2, DELAI_RECONNEXION_MAX_MS);
    }

    return () => {
      montéRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [courseId]);

  // On fait défiler le fil lui-même, pas la page : `scrollIntoView` entraînerait
  // tout le document et ferait atterrir l'utilisateur au milieu de l'écran,
  // au lieu du haut où se trouve l'essentiel.
  useEffect(() => {
    const fil = filRef.current;
    if (fil) fil.scrollTop = fil.scrollHeight;
  }, [messages]);

  function envoyer(e: FormEvent) {
    e.preventDefault();
    const contenu = brouillon.trim();
    if (!contenu || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'message', contenu }));
    setBrouillon('');
  }

  const canalFerme = session !== null && !session.active;

  return (
    <div className="carte apparition" style={{ animationDelay: '180ms' }}>
      <h2 style={{ marginBottom: 6 }}>Votre livreur</h2>
      <p className="attenue" style={{ marginBottom: 16 }}>
        Écrivez-lui sans échanger vos numéros.
      </p>

      {erreur && <p className="erreur">{erreur}</p>}

      {session && (
        <>
          <div className="fil-messages" ref={filRef}>
            {messages.length === 0 ? (
              <p className="attenue" style={{ margin: 0 }}>
                Aucun message pour le moment.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`bulle ${m.expediteur === 'destinataire' ? 'moi' : 'lui'}`}>
                  {m.contenu}
                </div>
              ))
            )}
          </div>

          {canalFerme ? (
            <p className="attenue" style={{ marginTop: 14 }}>
              Votre course est terminée, ce canal est fermé.
            </p>
          ) : (
            <form onSubmit={envoyer} className="zone-saisie">
              <input
                value={brouillon}
                onChange={(e) => setBrouillon(e.target.value)}
                placeholder={connecte ? 'Votre message…' : 'Reconnexion…'}
                maxLength={1000}
                aria-label="Message au livreur"
              />
              <button type="submit" disabled={!connecte || brouillon.trim() === ''}>
                Envoyer
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
