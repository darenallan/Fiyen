import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { API_BASE_URL, chargerToken } from './api';

/**
 * Nom de la tâche de localisation. La tâche est enregistrée au chargement du
 * module (voir plus bas), avant tout rendu React : le système peut relancer
 * l'app en arrière-plan pour un évènement de position, et la tâche doit alors
 * déjà exister.
 */
export const TACHE_POSITION = 'fiyen-suivi-position';

const CLE_FILE = 'fiyen_positions_en_attente';
const CLE_DERNIER_ENVOI = 'fiyen_dernier_envoi';
const CLE_DERNIERE_RETENUE = 'fiyen_derniere_position_retenue';

/** Cadence de capture, dans la fourchette 3-5 s du cahier des charges. */
const INTERVALLE_CAPTURE_MS = 4000;

/**
 * Filtrage identique à la PWA : en dessous de ce déplacement, la position n'est
 * pas retenue — réémettre une position immobile coûte de la donnée pour rien.
 * Un envoi reste forcé passé INTERVALLE_MAX_IMMOBILE_MS pour que le backend ne
 * considère pas le livreur hors ligne (TTL de présence de 30 s).
 */
const SEUIL_DEPLACEMENT_METRES = 15;
const INTERVALLE_MAX_IMMOBILE_MS = 20000;

/**
 * Dépôt groupé plutôt qu'une requête par position : sur un forfait data, l'en-tête
 * HTTP répété coûterait plus cher que les coordonnées elles-mêmes.
 */
const TAILLE_LOT = 4;
const INTERVALLE_ENVOI_MS = 15000;

/** Au-delà, les positions les plus anciennes sont abandonnées : lors d'une longue
 *  coupure, la trace récente vaut mieux qu'un historique complet. */
const TAILLE_MAX_FILE = 300;

export interface PositionCapturee {
  latitude: number;
  longitude: number;
  horodatage: string;
}

async function lireFile(): Promise<PositionCapturee[]> {
  try {
    const brut = await AsyncStorage.getItem(CLE_FILE);
    return brut ? (JSON.parse(brut) as PositionCapturee[]) : [];
  } catch {
    return [];
  }
}

async function ecrireFile(file: PositionCapturee[]) {
  try {
    await AsyncStorage.setItem(CLE_FILE, JSON.stringify(file));
  } catch {
    // stockage plein : on continue, la file sera purgée au prochain envoi réussi
  }
}

export async function tailleFile(): Promise<number> {
  return (await lireFile()).length;
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

/** Applique le filtre anti-gaspillage puis met la position en file. */
async function retenirPosition(latitude: number, longitude: number, horodatageMs: number) {
  const brutRetenue = await AsyncStorage.getItem(CLE_DERNIERE_RETENUE);
  const derniere = brutRetenue ? (JSON.parse(brutRetenue) as PositionCapturee) : null;

  if (derniere) {
    const immobile =
      distanceMetres(derniere, latitude, longitude) < SEUIL_DEPLACEMENT_METRES &&
      horodatageMs - Date.parse(derniere.horodatage) < INTERVALLE_MAX_IMMOBILE_MS;
    if (immobile) return;
  }

  const capture: PositionCapturee = {
    latitude,
    longitude,
    horodatage: new Date(horodatageMs).toISOString(),
  };

  const file = await lireFile();
  file.push(capture);
  await ecrireFile(file.length > TAILLE_MAX_FILE ? file.slice(-TAILLE_MAX_FILE) : file);
  await AsyncStorage.setItem(CLE_DERNIERE_RETENUE, JSON.stringify(capture));
}

/**
 * Envoie la file au backend si le lot est assez gros ou l'attente assez longue.
 * En cas d'échec réseau, la file est conservée telle quelle et repartira au
 * prochain réveil de la tâche.
 */
export async function viderFile(forcer = false): Promise<void> {
  const file = await lireFile();
  if (file.length === 0) return;

  const dernierEnvoi = Number((await AsyncStorage.getItem(CLE_DERNIER_ENVOI)) ?? 0);
  const attenteEcoulee = Date.now() - dernierEnvoi >= INTERVALLE_ENVOI_MS;
  if (!forcer && file.length < TAILLE_LOT && !attenteEcoulee) return;

  const token = await chargerToken();
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/livreurs/me/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ positions: file }),
    });

    if (!res.ok) {
      // 401 : jeton expiré — inutile de conserver des positions qu'on ne pourra
      // plus déposer, l'écran de connexion reprendra la main.
      if (res.status === 401) await ecrireFile([]);
      return;
    }

    // Seules les positions envoyées sont retirées : celles capturées pendant la
    // requête restent en file.
    const restantes = (await lireFile()).slice(file.length);
    await ecrireFile(restantes);
    await AsyncStorage.setItem(CLE_DERNIER_ENVOI, String(Date.now()));
  } catch {
    // hors ligne : la file est conservée
  }
}

// Enregistrement au chargement du module, hors de tout composant React.
TaskManager.defineTask(TACHE_POSITION, async ({ data, error }) => {
  if (error) return;

  const positions = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  if (!positions?.length) return;

  for (const pos of positions) {
    await retenirPosition(pos.coords.latitude, pos.coords.longitude, pos.timestamp);
  }
  await viderFile();
});

export type ResultatDemarrage =
  | { ok: true }
  | { ok: false; raison: 'permission_refusee' | 'permission_arriere_plan_refusee' | 'erreur' };

/**
 * Demande les autorisations puis démarre le suivi.
 *
 * L'autorisation d'arrière-plan doit être demandée **après** celle de premier
 * plan : Android refuse l'inverse. Elle est ce qui distingue cette app de la
 * PWA — sans elle, le suivi s'arrête à l'extinction de l'écran.
 */
export async function demarrerSuivi(): Promise<ResultatDemarrage> {
  try {
    const premierPlan = await Location.requestForegroundPermissionsAsync();
    if (premierPlan.status !== 'granted') return { ok: false, raison: 'permission_refusee' };

    const arrierePlan = await Location.requestBackgroundPermissionsAsync();
    if (arrierePlan.status !== 'granted') {
      return { ok: false, raison: 'permission_arriere_plan_refusee' };
    }

    if (await Location.hasStartedLocationUpdatesAsync(TACHE_POSITION)) return { ok: true };

    await Location.startLocationUpdatesAsync(TACHE_POSITION, {
      accuracy: Location.Accuracy.High,
      timeInterval: INTERVALLE_CAPTURE_MS,
      // Le filtrage à 15 m est fait en JS, pas ici : le seuil natif empêcherait
      // aussi l'envoi périodique qui maintient la présence à l'arrêt.
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Fiyen — service en cours',
        notificationBody: 'Votre position est transmise à votre compagnie.',
        notificationColor: '#7C3AED',
      },
    });

    return { ok: true };
  } catch {
    return { ok: false, raison: 'erreur' };
  }
}

export async function arreterSuivi(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TACHE_POSITION)) {
      await Location.stopLocationUpdatesAsync(TACHE_POSITION);
    }
  } catch {
    // rien à faire : le suivi n'était pas actif
  }
  // Dernière tentative de dépôt pour ne pas perdre la fin de trajet.
  await viderFile(true);
}

export async function suiviActif(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TACHE_POSITION);
  } catch {
    return false;
  }
}
