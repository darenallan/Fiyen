import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  api,
  ApiError,
  assurerJetonFrais,
  urlWebSocketCourse,
  type Commande,
  type Position,
  type StatutCourse,
} from './api';
import { IconeAlerte, IconeCheck, IconeRetour } from './composants/Icones';

/**
 * Suivi d'une commande.
 *
 * Le flux de position est volontairement anonyme : le partenaire voit *où en
 * est* son colis, jamais *qui* le porte. C'est la même garantie que pour le
 * destinataire, et elle est appliquée côté serveur — le canal ré-encode la
 * position sans l'identifiant du livreur avant de la relayer.
 */

const CENTRE_DEFAUT: [number, number] = [12.3714, -1.5197];
const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;
const INTERVALLE_RAFRAICHISSEMENT_MS = 20000;

const ETAPES: { statut: StatutCourse; libelle: string; explication: string }[] = [
  { statut: 'en_attente', libelle: 'Reçue', explication: 'Votre compagnie cherche un livreur.' },
  { statut: 'assignee', libelle: 'Livreur assigné', explication: 'Il part récupérer le colis.' },
  { statut: 'recuperee', libelle: 'Colis récupéré', explication: 'Le colis est pris en charge.' },
  { statut: 'en_route', libelle: 'En route', explication: 'Le livreur se dirige vers le destinataire.' },
  { statut: 'livree', libelle: 'Livrée', explication: 'Le colis a été remis.' },
];

export function EcranSuivi({
  commandeID,
  onRetour,
  version = 0,
}: {
  commandeID: string;
  onRetour: () => void;
  /** Incrementee a chaque evenement recu. Seule la fiche est rechargee : la
   *  carte et la socket de position restent en place, les recreer ferait
   *  scintiller l'ecran a chaque changement de statut. */
  version?: number;
}) {
  const [commande, setCommande] = useState<Commande | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [connecte, setConnecte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annulation, setAnnulation] = useState(false);

  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const carteRef = useRef<L.Map | null>(null);
  const marqueurRef = useRef<L.Marker | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const delaiRef = useRef(DELAI_RECONNEXION_MIN_MS);
  const monteRef = useRef(true);

  // --- Fiche et statut ---
  useEffect(() => {
    monteRef.current = true;

    const charger = async () => {
      try {
        const c = await api.commande(commandeID);
        if (monteRef.current) {
          setCommande(c);
          setErreur(null);
        }
      } catch (err) {
        if (monteRef.current) {
          setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
        }
      }
    };

    void charger();
    // 20 s : le statut change à l'échelle de la minute, pas de la seconde, et
    // le réseau mobile est facturé au volume.
    const timer = window.setInterval(charger, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => {
      monteRef.current = false;
      clearInterval(timer);
    };
  }, [commandeID, version]);

  // --- Carte ---
  useEffect(() => {
    if (carteRef.current || !conteneurRef.current) return;

    const carte = L.map(conteneurRef.current, {
      center: CENTRE_DEFAUT,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });
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

  // Les deux extrémités de la course, posées dès que la fiche est connue.
  useEffect(() => {
    const carte = carteRef.current;
    if (!carte || !commande) return;

    const points: L.LatLngExpression[] = [];

    if (commande.latitude_depart != null && commande.longitude_depart != null) {
      const p: [number, number] = [commande.latitude_depart, commande.longitude_depart];
      L.marker(p, {
        icon: L.divIcon({
          className: 'marqueur-point marqueur-vert',
          html: '<span></span>',
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        }),
      }).addTo(carte);
      points.push(p);
    }
    if (commande.latitude_arrivee != null && commande.longitude_arrivee != null) {
      const p: [number, number] = [commande.latitude_arrivee, commande.longitude_arrivee];
      L.marker(p, {
        icon: L.divIcon({
          className: 'marqueur-point marqueur-rust',
          html: '<span></span>',
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        }),
      }).addTo(carte);
      points.push(p);
    }

    if (points.length > 1) {
      carte.fitBounds(L.latLngBounds(points as L.LatLngTuple[]), { padding: [40, 40] });
    } else if (points.length === 1) {
      carte.setView(points[0], 15);
    }
  }, [commande]);

  // --- Position du livreur en direct ---
  const suiviActif =
    commande !== null &&
    ['assignee', 'recuperee', 'en_route'].includes(commande.statut);

  useEffect(() => {
    if (!suiviActif) return;
    monteRef.current = true;

    async function connecter() {
      if (!monteRef.current) return;
      // Le jeton part dans l'URL du handshake et ne peut pas être rejoué :
      // il doit être frais *avant* l'ouverture, pas rattrapé après.
      await assurerJetonFrais();
      if (!monteRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(urlWebSocketCourse(commandeID));
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
        try {
          setPosition(JSON.parse(event.data) as Position);
        } catch {
          // message illisible : ignoré
        }
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
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [commandeID, suiviActif]);

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
          html: '<span class="halo-livreur"></span>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(carte);
    }
    carte.panTo(point, { animate: true });
  }, [position]);

  async function annuler() {
    setAnnulation(true);
    setErreur(null);
    try {
      await api.annulerCommande(commandeID);
      setCommande(await api.commande(commandeID));
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Annulation impossible');
    } finally {
      setAnnulation(false);
    }
  }

  if (!commande) {
    return (
      <div className="app">
        <button type="button" className="contour" onClick={onRetour}>
          <IconeRetour />
          Retour
        </button>
        {erreur ? (
          <div className="bandeau-erreur" role="alert">
            <IconeAlerte />
            <span>{erreur}</span>
          </div>
        ) : (
          <p className="attenue">Chargement…</p>
        )}
      </div>
    );
  }

  const annulee = commande.statut === 'annulee';
  const indexCourant = ETAPES.findIndex((e) => e.statut === commande.statut);

  return (
    <div className="app">
      <button type="button" className="lien retour" onClick={onRetour}>
        <IconeRetour />
        Mes commandes
      </button>

      <div className="heros">
        <p className="surtitre">{commande.numero}</p>
        <h1>{annulee ? 'Commande annulée' : ETAPES[indexCourant]?.libelle ?? commande.statut}</h1>
        <p className="heros-sous">
          {annulee
            ? 'Cette commande a été retirée avant prise en charge.'
            : ETAPES[indexCourant]?.explication}
        </p>
      </div>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      )}

      {!annulee && (
        <section className="carte apparition">
          <div className="entete">
            <h2>Suivi</h2>
            {suiviActif && (
              <span className={`badge ${connecte && position ? 'succes' : ''}`}>
                <span className={`pastille ${connecte && position ? 'vivante' : ''}`} />
                {!connecte ? 'Reconnexion' : position ? 'En direct' : 'En attente'}
              </span>
            )}
          </div>

          <div ref={conteneurRef} className="carte-suivi" />

          {!suiviActif && (
            <p className="attenue" style={{ marginTop: 12 }}>
              {commande.statut === 'en_attente'
                ? 'La position s’affichera dès qu’un livreur sera assigné.'
                : 'Course terminée.'}
            </p>
          )}
        </section>
      )}

      <section className="carte apparition">
        <h2>Étapes</h2>
        <ol className="etapes">
          {ETAPES.map((e, i) => {
            const faite = !annulee && i < indexCourant;
            const courante = !annulee && i === indexCourant;
            return (
              <li key={e.statut} className={faite ? 'faite' : courante ? 'courante' : ''}>
                <span className="etape-pastille">
                  {faite ? <IconeCheck className="icone-mini" /> : i + 1}
                </span>
                <span className="etape-libelle">{e.libelle}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="carte apparition">
        <h2>Détail</h2>
        <dl className="detail">
          <dt>Destinataire</dt>
          <dd>{commande.destinataire_nom}</dd>
          <dt>Retrait</dt>
          <dd>
            {commande.adresse_depart}
            {commande.repere_depart && <span className="attenue"> — {commande.repere_depart}</span>}
          </dd>
          <dt>Livraison</dt>
          <dd>
            {commande.adresse_arrivee}
            {commande.repere_arrivee && (
              <span className="attenue"> — {commande.repere_arrivee}</span>
            )}
          </dd>
          {commande.description_colis && (
            <>
              <dt>Colis</dt>
              <dd>{commande.description_colis}</dd>
            </>
          )}
          {commande.instructions && (
            <>
              <dt>Consigne</dt>
              <dd>{commande.instructions}</dd>
            </>
          )}
          {commande.cree_par_nom && (
            <>
              <dt>Commandée par</dt>
              <dd>{commande.cree_par_nom}</dd>
            </>
          )}
        </dl>
      </section>

      {commande.statut === 'en_attente' && (
        <button type="button" className="contour danger bloc" onClick={annuler} disabled={annulation}>
          {annulation ? 'Annulation…' : 'Annuler cette commande'}
        </button>
      )}
      {commande.statut !== 'en_attente' && !annulee && commande.statut !== 'livree' && (
        <p className="aide centre">
          Un livreur est déjà en route. Pour annuler, contactez votre compagnie
          en indiquant le numéro {commande.numero}.
        </p>
      )}
    </div>
  );
}
