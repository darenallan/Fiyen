import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { urlWebSocketCourse, assurerJetonFrais, type PositionLivreur } from './api';

/** Ouagadougou — vue par défaut avant la première position reçue. */
const CENTRE_DEFAUT: [number, number] = [12.3714, -1.5197];

const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;

/**
 * Suivi en direct du livreur pour la course en cours.
 *
 * Le canal ne transporte qu'une position : le client voit *où* est son colis,
 * jamais *qui* le porte.
 */
export function CarteSuivi({ courseId }: { courseId: string }) {
  const [position, setPosition] = useState<PositionLivreur | null>(null);
  const [connecte, setConnecte] = useState(false);

  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const carteRef = useRef<L.Map | null>(null);
  const marqueurRef = useRef<L.Marker | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const delaiRef = useRef(DELAI_RECONNEXION_MIN_MS);
  const montéRef = useRef(true);

  useEffect(() => {
    if (carteRef.current || !conteneurRef.current) return;

    const carte = L.map(conteneurRef.current, {
      center: CENTRE_DEFAUT,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });

    // Tuiles claires et désaturées : elles laissent le marqueur terracotta
    // ressortir, là où les tuiles OSM standard (routes rouges et jaunes)
    // entreraient en concurrence avec lui.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
    }).addTo(carte);

    carteRef.current = carte;

    return () => {
      carte.remove();
      carteRef.current = null;
      marqueurRef.current = null;
    };
  }, []);

  useEffect(() => {
    montéRef.current = true;

    async function connecter() {
      if (!montéRef.current) return;
      // Le jeton part dans l'URL du handshake et ne peut pas être rejoué :
      // il doit être frais *avant* l'ouverture, pas rattrapé après.
      await assurerJetonFrais();
      if (!montéRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(urlWebSocketCourse(courseId));
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
        try {
          setPosition(JSON.parse(event.data) as PositionLivreur);
        } catch {
          // message illisible : ignoré
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (montéRef.current) setConnecte(false);
        programmerReconnexion();
      };

      ws.onerror = () => ws.close();
    }

    function programmerReconnexion() {
      if (!montéRef.current || timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void connecter();
      }, delaiRef.current);
      delaiRef.current = Math.min(delaiRef.current * 2, DELAI_RECONNEXION_MAX_MS);
    }

    void connecter();

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

  // Recentrage systématique : le client suit un seul livreur et n'a pas de
  // raison de naviguer sur la carte, contrairement à l'opérateur du dashboard.
  useEffect(() => {
    const carte = carteRef.current;
    if (!carte || !position) return;

    const point: [number, number] = [position.latitude, position.longitude];

    if (marqueurRef.current) {
      marqueurRef.current.setLatLng(point);
    } else {
      marqueurRef.current = L.marker(point, {
        icon: L.divIcon({
          className: 'marqueur-livreur',
          // Halo pulsant : un point fixe se perdrait parmi les rues.
          html: `<span class="halo-livreur"></span>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(carte);
      carte.setView(point, 15);
    }
    carte.panTo(point, { animate: true });
  }, [position]);

  return (
    <div className="carte apparition" style={{ animationDelay: '120ms' }}>
      <div className="entete" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Suivi en direct</h2>
        <span className={`badge ${connecte && position ? 'succes' : ''}`}>
          <span className={`pastille ${connecte && position ? 'vivante' : ''}`} />
          {!connecte ? 'Reconnexion' : position ? 'En direct' : 'En attente'}
        </span>
      </div>

      <div ref={conteneurRef} className="carte-suivi" />

      {!position && (
        <p className="attenue" style={{ marginTop: 12 }}>
          La position s’affichera dès que votre livreur sera en route.
        </p>
      )}
    </div>
  );
}
