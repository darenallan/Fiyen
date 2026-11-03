import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Ouagadougou — vue par défaut si le trajet n'a pas de point exploitable. */
const CENTRE_DEFAUT: [number, number] = [12.3714, -1.5197];

export interface PointGeo {
  latitude: number;
  longitude: number;
}

export interface PointTrajet extends PointGeo {
  horodatage: string;
}

export interface Trajet {
  points: PointTrajet[];
  point_depart?: PointGeo;
  point_arrivee?: PointGeo;
}

/**
 * Rejeu statique d'un trajet déjà parcouru.
 *
 * Contrairement à `CarteFlotte` (plusieurs livreurs, position qui bouge), il
 * n'y a ici qu'une ligne fixe : pas de mise à jour en direct, pas de
 * recentrage automatique répété. La carte se cadre une fois sur l'ensemble du
 * tracé et n'a plus de raison de bouger seule.
 */
export function CarteTrajet({ trajet }: { trajet: Trajet }) {
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const carteRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (carteRef.current || !conteneurRef.current) return;

    const carte = L.map(conteneurRef.current, {
      center: CENTRE_DEFAUT,
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16,
      maxZoom: 19,
      attribution: 'Fond de carte &copy; Esri, HERE, Garmin, &copy; contributeurs OpenStreetMap',
    }).addTo(carte);
    // Noms de quartiers et de voies, en couche séparée sur le fond gris.
    // (CARTO light_all ne sert plus qu'un filigrane « API KEY REQUIRED ».)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16,
      maxZoom: 19,
    }).addTo(carte);

    carteRef.current = carte;

    return () => {
      carte.remove();
      carteRef.current = null;
    };
  }, []);

  useEffect(() => {
    const carte = carteRef.current;
    if (!carte) return;

    const bornes: [number, number][] = [];

    if (trajet.point_depart) {
      const p: [number, number] = [trajet.point_depart.latitude, trajet.point_depart.longitude];
      L.circleMarker(p, {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#12805a',
        fillOpacity: 1,
      })
        .addTo(carte)
        .bindTooltip('Retrait', { permanent: false });
      bornes.push(p);
    }

    if (trajet.points.length > 1) {
      const ligne = trajet.points.map((p) => [p.latitude, p.longitude] as [number, number]);
      // Trait pointillé plutôt qu'une route réelle : ce sont des positions
      // GPS espacées de plusieurs secondes, pas un tracé routier — le
      // présenter comme une vraie route suggérerait une précision qu'il n'a
      // pas.
      L.polyline(ligne, { color: '#16332a', weight: 3, opacity: 0.75, dashArray: '1 8', lineCap: 'round' }).addTo(
        carte
      );
      bornes.push(...ligne);
    }

    if (trajet.point_arrivee) {
      const p: [number, number] = [trajet.point_arrivee.latitude, trajet.point_arrivee.longitude];
      L.circleMarker(p, {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#c4451a',
        fillOpacity: 1,
      })
        .addTo(carte)
        .bindTooltip('Livraison', { permanent: false });
      bornes.push(p);
    }

    if (bornes.length > 0) {
      carte.fitBounds(L.latLngBounds(bornes), { padding: [40, 40], maxZoom: 16 });
    }
  }, [trajet]);

  const rienAAfficher =
    trajet.points.length === 0 && !trajet.point_depart && !trajet.point_arrivee;

  return (
    <div style={{ position: 'relative' }}>
      <div ref={conteneurRef} className="carte-trajet" />
      {rienAAfficher && (
        <p className="muted-carte">
          Aucune position enregistrée pour ce trajet — le livreur n'était peut-être pas encore
          en service, l'application n'a pas pu transmettre sa position, ou la course est trop
          ancienne : les positions ne sont conservées que pendant une durée limitée.
        </p>
      )}
    </div>
  );
}
