import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Ouagadougou — vue par défaut tant qu'aucun point n'est posé. */
const CENTRE_DEFAUT: [number, number] = [12.3714, -1.5197];

/**
 * Sélecteur de point sur la carte.
 *
 * Le point est **facultatif**, et c'est délibéré : à Ouagadougou l'adresse
 * utile est verbale (« face à la station Total de Gounghin »), pas cartographique.
 * Exiger une épingle bloquerait la commande d'un quartier mal cartographié.
 * La carte est un complément qui aide le livreur, pas une condition.
 *
 * On pose le point d'un clic plutôt qu'en glissant un marqueur : sur un écran
 * tactile bon marché, le glisser rate souvent et déplace la carte à la place.
 */
export function ChoixPoint({
  latitude,
  longitude,
  onChange,
  couleur = 'vert',
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lon: number | null) => void;
  couleur?: 'vert' | 'rust';
}) {
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const carteRef = useRef<L.Map | null>(null);
  const marqueurRef = useRef<L.Marker | null>(null);
  // Rangée dans une ref : la carte est créée une seule fois, et une closure
  // figée sur le premier rendu appellerait une version périmée du callback.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (carteRef.current || !conteneurRef.current) return;

    const carte = L.map(conteneurRef.current, {
      center: latitude !== null && longitude !== null ? [latitude, longitude] : CENTRE_DEFAUT,
      zoom: latitude !== null ? 16 : 13,
      zoomControl: true,
      attributionControl: true,
    });

    // Tuiles claires et désaturées : les routes colorées d'OSM
    // concurrenceraient l'épingle.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
    }).addTo(carte);

    carte.on('click', (e: L.LeafletMouseEvent) => {
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    carteRef.current = carte;

    return () => {
      carte.remove();
      carteRef.current = null;
      marqueurRef.current = null;
    };
    // Volontairement au montage seul : les coordonnées suivantes sont
    // appliquées par l'effet ci-dessous, sans reconstruire la carte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const carte = carteRef.current;
    if (!carte) return;

    if (latitude === null || longitude === null) {
      if (marqueurRef.current) {
        marqueurRef.current.remove();
        marqueurRef.current = null;
      }
      return;
    }

    const point: [number, number] = [latitude, longitude];
    if (marqueurRef.current) {
      marqueurRef.current.setLatLng(point);
    } else {
      marqueurRef.current = L.marker(point, {
        icon: L.divIcon({
          className: `marqueur-point marqueur-${couleur}`,
          html: '<span></span>',
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        }),
      }).addTo(carte);
      carte.setView(point, Math.max(carte.getZoom(), 16));
    }
  }, [latitude, longitude, couleur]);

  return (
    <div className="choix-point">
      <div ref={conteneurRef} className="choix-point-carte" />
      <div className="choix-point-pied">
        {latitude !== null && longitude !== null ? (
          <>
            <span className="mono-petit">
              {latitude.toFixed(5)}, {longitude.toFixed(5)}
            </span>
            <button type="button" className="lien" onClick={() => onChange(null, null)}>
              Retirer le point
            </button>
          </>
        ) : (
          <span className="attenue">
            Touchez la carte pour situer le point — facultatif.
          </span>
        )}
      </div>
    </div>
  );
}
