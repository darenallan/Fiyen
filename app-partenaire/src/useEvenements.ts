import { useCallback, useEffect, useRef, useState } from 'react';
import { assurerJetonFrais, urlWebSocketEvenements, type EvenementCourse } from './api';

/**
 * Écoute les changements d'état des commandes de l'entreprise.
 *
 * Ne remplace pas le rafraîchissement périodique : sur un réseau instable la
 * socket tombe, et c'est le sondage à 20 s qui rattrape. Ce canal sert à ce
 * qu'un colis « livré » s'affiche tout de suite plutôt qu'avec vingt secondes
 * de retard — un décalage qui donne l'impression d'un outil en retard sur la
 * réalité.
 */

const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;

/** Durée d'affichage d'un bandeau avant effacement. */
const DUREE_BANDEAU_MS = 8000;

export interface Annonce {
  id: string;
  numero: string;
  texte: string;
  statut: EvenementCourse['statut'];
}

const LIBELLES: Record<EvenementCourse['statut'], string | null> = {
  // « En attente » est l'état de départ : l'annoncer répéterait ce que le
  // partenaire vient de faire.
  en_attente: null,
  assignee: 'Un livreur a été assigné',
  recuperee: 'Le colis a été récupéré',
  en_route: 'Le livreur est en route',
  livree: 'Livraison effectuée',
  annulee: 'Commande annulée',
};

export function useEvenements(onChangement?: () => void) {
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const [connecte, setConnecte] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const delaiRef = useRef(DELAI_RECONNEXION_MIN_MS);
  const monteRef = useRef(true);
  // Rangé dans une ref : la socket est ouverte une seule fois, et une closure
  // figée sur le premier rendu appellerait une version périmée du callback.
  const onChangementRef = useRef(onChangement);
  onChangementRef.current = onChangement;

  const ecarter = useCallback((id: string) => {
    setAnnonces((prec) => prec.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    monteRef.current = true;

    async function connecter() {
      if (!monteRef.current) return;
      // Le jeton part dans l'URL du handshake et ne peut pas être rejoué :
      // il doit être frais *avant* l'ouverture, pas rattrapé après.
      await assurerJetonFrais();
      if (!monteRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(urlWebSocketEvenements());
      } catch {
        programmerReconnexion();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        delaiRef.current = DELAI_RECONNEXION_MIN_MS;
        if (monteRef.current) setConnecte(true);
      };

      ws.onmessage = (event) => {
        let evt: EvenementCourse;
        try {
          evt = JSON.parse(event.data) as EvenementCourse;
        } catch {
          return;
        }
        // Un type inconnu est ignoré plutôt que supposé : le serveur pourra en
        // ajouter sans casser les versions déjà installées.
        if (evt.type !== 'statut_course') return;

        // La liste se recharge dans tous les cas : même sans bandeau, la
        // commande doit changer de section.
        onChangementRef.current?.();

        const libelle = LIBELLES[evt.statut];
        if (!libelle || !monteRef.current) return;

        const annonce: Annonce = {
          id: `${evt.course_id}-${evt.statut}`,
          numero: evt.numero,
          texte: `${libelle} — ${evt.destinataire_nom}`,
          statut: evt.statut,
        };

        setAnnonces((prec) =>
          // Un même passage de statut peut arriver deux fois si la socket se
          // reconnecte : l'afficher en double serait du bruit.
          prec.some((a) => a.id === annonce.id) ? prec : [...prec, annonce]
        );

        window.setTimeout(() => ecarter(annonce.id), DUREE_BANDEAU_MS);
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (monteRef.current) setConnecte(false);
        programmerReconnexion();
      };

      ws.onerror = () => ws.close();
    }

    function programmerReconnexion() {
      if (!monteRef.current || timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void connecter();
      }, delaiRef.current);
      // Backoff exponentiel : sur un réseau qui vacille, marteler la
      // reconnexion épuise la batterie sans rien gagner.
      delaiRef.current = Math.min(delaiRef.current * 2, DELAI_RECONNEXION_MAX_MS);
    }

    void connecter();

    return () => {
      monteRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [ecarter]);

  return { annonces, connecte, ecarter };
}
