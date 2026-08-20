import { urlWebSocketPosition, assurerJetonFrais } from './api';

const CLE_FILE_ATTENTE = 'fiyen_positions_en_attente';

/** Cadence d'envoi, dans la fourchette 3-5s prévue au cahier des charges. */
const INTERVALLE_ENVOI_MS = 4000;

/**
 * En dessous de ce déplacement, la position n'est pas renvoyée : sur un réseau
 * mobile facturé à la donnée, réémettre une position immobile est du gaspillage.
 * Un renvoi est tout de même forcé passé INTERVALLE_MAX_IMMOBILE_MS pour que le
 * backend ne considère pas le livreur hors ligne (TTL de présence de 30s).
 */
const SEUIL_DEPLACEMENT_METRES = 15;
const INTERVALLE_MAX_IMMOBILE_MS = 20000;

/**
 * Plafond de la file locale. Au-delà, les positions les plus anciennes sont
 * abandonnées : lors d'une longue coupure, la trace récente vaut mieux qu'un
 * historique complet qu'on ne pourra de toute façon pas rejouer utilement.
 */
const TAILLE_MAX_FILE = 300;

const DELAI_RECONNEXION_MIN_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 30000;

export interface PositionCapturee {
  latitude: number;
  longitude: number;
  horodatage: string;
}

export interface EtatTracking {
  actif: boolean;
  connecte: boolean;
  positionsEnAttente: number;
  dernierePosition: PositionCapturee | null;
  erreur: string | null;
}

function chargerFile(): PositionCapturee[] {
  try {
    const brut = localStorage.getItem(CLE_FILE_ATTENTE);
    return brut ? (JSON.parse(brut) as PositionCapturee[]) : [];
  } catch {
    return [];
  }
}

function sauvegarderFile(file: PositionCapturee[]) {
  try {
    localStorage.setItem(CLE_FILE_ATTENTE, JSON.stringify(file));
  } catch {
    // quota dépassé : on continue en mémoire, la file sera purgée à l'envoi
  }
}

/** Distance approximative en mètres entre deux points (formule de haversine). */
function distanceMetres(a: PositionCapturee, lat: number, lon: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat - a.latitude) * rad;
  const dLon = (lon - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class TrackingLivreur {
  private ws: WebSocket | null = null;
  private watchId: number | null = null;
  private timerEnvoi: number | null = null;
  private timerReconnexion: number | null = null;
  private delaiReconnexion = DELAI_RECONNEXION_MIN_MS;

  private file: PositionCapturee[] = chargerFile();
  private positionCourante: GeolocationPosition | null = null;
  private dernierEnvoi: PositionCapturee | null = null;
  private actif = false;
  private erreur: string | null = null;

  private onEtat: (etat: EtatTracking) => void;

  constructor(onEtat: (etat: EtatTracking) => void) {
    this.onEtat = onEtat;
  }

  private notifier() {
    this.onEtat({
      actif: this.actif,
      connecte: this.ws?.readyState === WebSocket.OPEN,
      positionsEnAttente: this.file.length,
      dernierePosition: this.dernierEnvoi,
      erreur: this.erreur,
    });
  }

  demarrer() {
    if (this.actif) return;
    this.actif = true;
    this.erreur = null;

    if (!('geolocation' in navigator)) {
      this.erreur = "Ce téléphone ne permet pas la géolocalisation.";
      this.actif = false;
      this.notifier();
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.positionCourante = pos;
        if (this.erreur) {
          this.erreur = null;
          this.notifier();
        }
      },
      (err) => {
        this.erreur =
          err.code === err.PERMISSION_DENIED
            ? 'Autorisez la localisation pour pouvoir recevoir des courses.'
            : 'Position GPS indisponible pour le moment.';
        this.notifier();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );

    void this.connecter();
    this.timerEnvoi = window.setInterval(() => this.capturerEtEnvoyer(), INTERVALLE_ENVOI_MS);
    this.notifier();
  }

  arreter() {
    this.actif = false;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.timerEnvoi !== null) {
      clearInterval(this.timerEnvoi);
      this.timerEnvoi = null;
    }
    if (this.timerReconnexion !== null) {
      clearTimeout(this.timerReconnexion);
      this.timerReconnexion = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this.notifier();
  }

  private async connecter() {
    if (!this.actif) return;
    // Le jeton part dans l'URL du handshake et ne peut pas être rejoué : il
    // doit être frais *avant* l'ouverture. Sans cela, un livreur en course
    // depuis plus de 30 minutes verrait sa remontée de position s'arrêter.
    await assurerJetonFrais();
    if (!this.actif) return;

    try {
      this.ws = new WebSocket(urlWebSocketPosition());
    } catch {
      this.programmerReconnexion();
      return;
    }

    this.ws.onopen = () => {
      this.delaiReconnexion = DELAI_RECONNEXION_MIN_MS;
      this.viderFile(); // rejoue immédiatement ce qui a été mis en cache hors ligne
      this.notifier();
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.notifier();
      this.programmerReconnexion();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private programmerReconnexion() {
    if (!this.actif || this.timerReconnexion !== null) return;

    this.timerReconnexion = window.setTimeout(() => {
      this.timerReconnexion = null;
      void this.connecter();
    }, this.delaiReconnexion);

    this.delaiReconnexion = Math.min(this.delaiReconnexion * 2, DELAI_RECONNEXION_MAX_MS);
  }

  /** Prend la dernière position connue, la met en file, puis tente de vider la file. */
  private capturerEtEnvoyer() {
    const pos = this.positionCourante;
    if (pos) {
      const { latitude, longitude } = pos.coords;
      const maintenant = Date.now();

      const immobile =
        this.dernierEnvoi !== null &&
        distanceMetres(this.dernierEnvoi, latitude, longitude) < SEUIL_DEPLACEMENT_METRES &&
        maintenant - Date.parse(this.dernierEnvoi.horodatage) < INTERVALLE_MAX_IMMOBILE_MS;

      if (!immobile) {
        const capture: PositionCapturee = {
          latitude,
          longitude,
          horodatage: new Date(maintenant).toISOString(),
        };
        this.file.push(capture);
        if (this.file.length > TAILLE_MAX_FILE) {
          this.file = this.file.slice(-TAILLE_MAX_FILE);
        }
        this.dernierEnvoi = capture;
        sauvegarderFile(this.file);
      }
    }

    this.viderFile();
    this.notifier();
  }

  /** Envoie toute la file dans l'ordre chronologique tant que la socket est ouverte. */
  private viderFile() {
    if (this.ws?.readyState !== WebSocket.OPEN || this.file.length === 0) return;

    while (this.file.length > 0) {
      const position = this.file[0];
      try {
        this.ws.send(JSON.stringify(position));
        this.file.shift();
      } catch {
        break; // socket tombée en cours de vidage : le reste part à la reconnexion
      }
    }

    sauvegarderFile(this.file);
  }
}
