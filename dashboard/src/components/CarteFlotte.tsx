import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Livreur } from '../api/types';

/** Ouagadougou — vue par défaut tant qu'aucun livreur n'a envoyé de position. */
const CENTRE_DEFAUT: [number, number] = [12.3714, -1.5197];
const ZOOM_DEFAUT = 12;

/* Le statut reste porté par la couleur ET par l'opacité : un livreur hors ligne
   est grisé et estompé, donc distinguable même sans percevoir la teinte. */
const COULEURS: Record<string, string> = {
  dispo: '#7cc98b',
  en_course: '#c5a059',
  offline: '#6d675f',
};

/**
 * Marqueur dessiné en CSS plutôt qu'avec l'icône par défaut de Leaflet : celle-ci
 * référence des images par URL, que les bundlers cassent, et un divIcon permet en
 * plus de coder le statut par la couleur.
 */
function iconeLivreur(livreur: Livreur): L.DivIcon {
  const couleur = livreur.en_ligne ? (COULEURS[livreur.statut] ?? COULEURS.offline) : COULEURS.offline;
  const opacite = livreur.en_ligne ? 1 : 0.55;
  return L.divIcon({
    className: 'marqueur-livreur',
    html: `<span style="
      display:block;width:16px;height:16px;border-radius:50%;
      background:${couleur};opacity:${opacite};
      border:2.5px solid #100f0d;box-shadow:0 0 0 1px rgba(255,255,255,.22);
    "></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function libelleStatut(livreur: Livreur): string {
  if (!livreur.en_ligne) return 'Hors ligne';
  if (livreur.statut === 'dispo') return 'Disponible';
  if (livreur.statut === 'en_course') return 'En course';
  return 'Hors service';
}

export function CarteFlotte({ livreurs }: { livreurs: Livreur[] }) {
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const carteRef = useRef<L.Map | null>(null);
  const marqueursRef = useRef<Map<string, L.Marker>>(new Map());
  const dejaCadreRef = useRef(false);
  const livreursRef = useRef<Livreur[]>(livreurs);
  livreursRef.current = livreurs;

  /** Recadre sur l'ensemble de la flotte localisée, à la demande de l'opérateur. */
  function recentrer() {
    const carte = carteRef.current;
    if (!carte) return;
    const points = livreursRef.current
      .filter((l) => l.latitude !== null && l.longitude !== null)
      .map((l) => [l.latitude as number, l.longitude as number] as [number, number]);
    if (points.length === 0) return;
    carte.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
  }

  // Création unique de la carte
  useEffect(() => {
    if (carteRef.current || !conteneurRef.current) return;

    const carte = L.map(conteneurRef.current, {
      center: CENTRE_DEFAUT,
      zoom: ZOOM_DEFAUT,
      zoomControl: true,
    });

    // Tuiles sombres : les tuiles OSM standard, très claires, jureraient avec
    // le noir mat de la charte et écraseraient les marqueurs cuivrés.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
    }).addTo(carte);

    carteRef.current = carte;

    return () => {
      carte.remove();
      carteRef.current = null;
      marqueursRef.current.clear();
    };
  }, []);

  // Synchronisation des marqueurs à chaque nouvelle position
  useEffect(() => {
    const carte = carteRef.current;
    if (!carte) return;

    const marqueurs = marqueursRef.current;
    const localises = livreurs.filter(
      (l): l is Livreur & { latitude: number; longitude: number } =>
        l.latitude !== null && l.longitude !== null,
    );
    const idsPresents = new Set(localises.map((l) => l.id));

    for (const [id, marqueur] of marqueurs) {
      if (!idsPresents.has(id)) {
        marqueur.remove();
        marqueurs.delete(id);
      }
    }

    for (const livreur of localises) {
      const position: [number, number] = [livreur.latitude, livreur.longitude];
      const infobulle = `<strong>${livreur.nom}</strong><br/>${libelleStatut(livreur)}`;

      const existant = marqueurs.get(livreur.id);
      if (existant) {
        existant.setLatLng(position);
        existant.setIcon(iconeLivreur(livreur));
        existant.setPopupContent(infobulle);
      } else {
        const marqueur = L.marker(position, { icon: iconeLivreur(livreur) })
          .addTo(carte)
          .bindPopup(infobulle);
        marqueurs.set(livreur.id, marqueur);
      }
    }

    // Cadrage automatique une seule fois : recadrer à chaque position
    // empêcherait l'opérateur de se déplacer librement sur la carte.
    if (!dejaCadreRef.current && localises.length > 0) {
      const bornes = L.latLngBounds(localises.map((l) => [l.latitude, l.longitude] as [number, number]));
      carte.fitBounds(bornes, { padding: [50, 50], maxZoom: 15 });
      dejaCadreRef.current = true;
    }
  }, [livreurs]);

  const aucuneLocalisation = livreurs.every((l) => l.latitude === null || l.longitude === null);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={conteneurRef}
        className="carte-flotte"
      />
      {!aucuneLocalisation && (
        <button type="button" className="bouton-recentrer" onClick={recentrer}>
          Recentrer
        </button>
      )}
      {aucuneLocalisation && (
        <p className="muted-carte">
          Aucune position reçue pour le moment — les livreurs apparaîtront ici dès qu'ils
          prendront leur service.
        </p>
      )}
    </div>
  );
}
