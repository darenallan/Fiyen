import { useEffect, useRef, useState } from 'react';
import { api, wsUrl, ApiError } from './client';
import type { Livreur } from './types';

/**
 * Message poussé par le backend sur le canal `compagnie:{id}:positions`.
 * Le `livreur_id` sert uniquement à repositionner un marqueur déjà connu :
 * l'identité du livreur vient du chargement REST initial.
 */
interface MessagePosition {
  livreur_id: string;
  latitude: number;
  longitude: number;
  horodatage: string;
}

const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 20000;

/**
 * Rafraîchissement REST de secours. Le WebSocket porte les positions, mais pas
 * les changements de statut (prise de service, assignation) ni les arrivées de
 * nouveaux livreurs : ce sondage lent les rattrape.
 */
const INTERVALLE_RAFRAICHISSEMENT_MS = 15000;

export interface EtatFlotte {
  livreurs: Livreur[];
  connecte: boolean;
  chargement: boolean;
  erreur: string | null;
}

export function useFlotteLive(): EtatFlotte & { rafraichir: () => Promise<void> } {
  const [livreurs, setLivreurs] = useState<Livreur[]>([]);
  const [connecte, setConnecte] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timerReconnexionRef = useRef<number | null>(null);
  const delaiRef = useRef(DELAI_RECONNEXION_MIN_MS);
  const montéRef = useRef(true);

  async function rafraichir() {
    try {
      const data = await api.get<Livreur[] | null>('/api/livreurs/');
      if (!montéRef.current) return;
      setLivreurs(data ?? []);
      setErreur(null);
    } catch (err) {
      if (!montéRef.current) return;
      setErreur(err instanceof ApiError ? err.message : 'Chargement de la flotte impossible');
    } finally {
      if (montéRef.current) setChargement(false);
    }
  }

  useEffect(() => {
    montéRef.current = true;
    rafraichir();
    const timer = window.setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);

    function connecter() {
      if (!montéRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl('/ws/compagnie/flotte'));
      } catch {
        programmerReconnexion();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        delaiRef.current = DELAI_RECONNEXION_MIN_MS;
        if (montéRef.current) setConnecte(true);
      };

      ws.onmessage = (event) => {
        let msg: MessagePosition;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        setLivreurs((precedents) =>
          precedents.map((l) =>
            l.id === msg.livreur_id
              ? {
                  ...l,
                  latitude: msg.latitude,
                  longitude: msg.longitude,
                  position_updated_at: msg.horodatage,
                  // Une position qui arrive prouve la présence, sans attendre
                  // le prochain sondage REST.
                  en_ligne: true,
                }
              : l,
          ),
        );
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (montéRef.current) setConnecte(false);
        programmerReconnexion();
      };

      ws.onerror = () => ws.close();
    }

    function programmerReconnexion() {
      if (!montéRef.current || timerReconnexionRef.current !== null) return;
      timerReconnexionRef.current = window.setTimeout(() => {
        timerReconnexionRef.current = null;
        connecter();
      }, delaiRef.current);
      delaiRef.current = Math.min(delaiRef.current * 2, DELAI_RECONNEXION_MAX_MS);
    }

    connecter();

    return () => {
      montéRef.current = false;
      clearInterval(timer);
      if (timerReconnexionRef.current !== null) clearTimeout(timerReconnexionRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { livreurs, connecte, chargement, erreur, rafraichir };
}
