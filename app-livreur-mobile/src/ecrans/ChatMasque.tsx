import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import {
  api,
  ApiError,
  chargerToken,
  urlWebSocketMasquage,
  type MessageMasque,
  type SessionMasquage,
} from '../api';
import { couleurs, styles } from '../theme';

const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;

/**
 * Conversation masquée avec le client.
 *
 * Aucun numéro n'est affiché ni saisi : l'interlocuteur n'est désigné que par
 * son rôle, et le canal est identifié par le seul `session_id`.
 */
export function ChatMasque({ courseId, onFermer }: { courseId: string; onFermer: () => void }) {
  const [session, setSession] = useState<SessionMasquage | null>(null);
  const [messages, setMessages] = useState<MessageMasque[]>([]);
  const [brouillon, setBrouillon] = useState('');
  const [connecte, setConnecte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delaiRef = useRef(DELAI_RECONNEXION_MIN_MS);
  const monteRef = useRef(true);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    monteRef.current = true;

    function programmerReconnexion(sessionId: string) {
      if (!monteRef.current || timerRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        connecter(sessionId);
      }, delaiRef.current);
      delaiRef.current = Math.min(delaiRef.current * 2, DELAI_RECONNEXION_MAX_MS);
    }

    async function connecter(sessionId: string) {
      if (!monteRef.current) return;
      const token = await chargerToken();
      if (!token) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(urlWebSocketMasquage(sessionId, token));
      } catch {
        programmerReconnexion(sessionId);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        delaiRef.current = DELAI_RECONNEXION_MIN_MS;
        if (monteRef.current) setConnecte(true);
      };

      ws.onmessage = (event) => {
        let evt: { type: string; id?: string } & MessageMasque;
        try {
          evt = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (evt.type !== 'message') return; // le signaling WebRTC ne s'affiche pas
        setMessages((prec) =>
          prec.some((m) => m.id === evt.id)
            ? prec
            : [
                ...prec,
                {
                  id: evt.id!,
                  expediteur: evt.expediteur,
                  contenu: evt.contenu,
                  created_at: evt.created_at,
                },
              ],
        );
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (monteRef.current) setConnecte(false);
        programmerReconnexion(sessionId);
      };

      ws.onerror = () => ws.close();
    }

    (async () => {
      try {
        const s = await api.sessionMasquage(courseId);
        if (!monteRef.current) return;
        setSession(s);

        const histo = await api.messagesMasques(s.session_id);
        if (!monteRef.current) return;
        setMessages(histo ?? []);

        if (s.active) connecter(s.session_id);
      } catch (err) {
        if (!monteRef.current) return;
        setErreur(
          err instanceof ApiError && err.status === 404
            ? "Le canal de contact n'est pas encore ouvert."
            : "Impossible d'ouvrir la conversation.",
        );
      }
    })();

    return () => {
      monteRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [courseId]);

  function envoyer() {
    const contenu = brouillon.trim();
    if (!contenu || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'message', contenu }));
    setBrouillon('');
  }

  const canalFerme = session !== null && !session.active;
  const peutEnvoyer = connecte && brouillon.trim() !== '';

  return (
    <View style={styles.carte}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.sousTitre}>Contacter le client</Text>
          <Text style={[styles.attenue, { marginTop: -8, marginBottom: 12 }]}>
            Vos numéros restent masqués des deux côtés.
          </Text>
        </View>
        <Pressable
          style={[styles.bouton, styles.boutonContour, { minHeight: 40, paddingHorizontal: 14 }]}
          onPress={onFermer}
        >
          <Text style={[styles.boutonTexte, styles.boutonContourTexte]}>Fermer</Text>
        </Pressable>
      </View>

      {erreur && <Text style={styles.erreur}>{erreur}</Text>}

      {session && (
        <>
          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: 260 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.length === 0 ? (
              <Text style={styles.attenue}>Aucun message pour le moment.</Text>
            ) : (
              messages.map((m) => {
                const moi = m.expediteur === 'livreur';
                return (
                  <View
                    key={m.id}
                    style={{
                      alignSelf: moi ? 'flex-end' : 'flex-start',
                      backgroundColor: moi ? couleurs.or : couleurs.bordure,
                      borderRadius: 14,
                      paddingHorizontal: 13,
                      paddingVertical: 9,
                      marginBottom: 8,
                      maxWidth: '82%',
                    }}
                  >
                    <Text style={{ color: moi ? couleurs.encre : couleurs.texte, fontSize: 15 }}>
                      {m.contenu}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          {canalFerme ? (
            <Text style={[styles.attenue, { marginTop: 12 }]}>
              La course est terminée, ce canal est fermé.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <TextInput
                style={[styles.champ, { flex: 1, marginTop: 0 }]}
                value={brouillon}
                onChangeText={setBrouillon}
                placeholder={connecte ? 'Votre message…' : 'Reconnexion…'}
                placeholderTextColor={couleurs.texteAttenue}
                maxLength={1000}
                onSubmitEditing={envoyer}
              />
              <Pressable
                style={[styles.bouton, { paddingHorizontal: 18 }, !peutEnvoyer && styles.boutonInactif]}
                disabled={!peutEnvoyer}
                onPress={envoyer}
              >
                <Text style={styles.boutonTexte}>Envoyer</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}
