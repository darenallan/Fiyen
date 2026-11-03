/**
 * Adresse du serveur en cours d'usage.
 *
 * Par défaut : EXPO_PUBLIC_API_URL, figée au build (profil EAS). Le livreur ou
 * l'administrateur peut la remplacer depuis l'écran de connexion ; le choix
 * est gardé sur le téléphone. La tâche GPS d'arrière-plan, qui peut tourner
 * sans que l'écran ait été ouvert, relit ce réglage elle-même.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { normaliserUrlServeur, urlWebSocketDepuis } from './serveurLogique';

const CLE = 'fiyen_serveur_api';

export const URL_PAR_DEFAUT = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8090';

let courante: string = URL_PAR_DEFAUT;
let chargement: Promise<string> | null = null;

/** Lit le réglage enregistré, une fois ; les appels suivants rendent le cache. */
export function chargerServeur(): Promise<string> {
  if (!chargement) {
    chargement = AsyncStorage.getItem(CLE)
      .then((v) => {
        const r = v ? normaliserUrlServeur(v) : null;
        courante = r && r.ok ? r.url : URL_PAR_DEFAUT;
        return courante;
      })
      .catch(() => courante);
  }
  return chargement;
}

/** Adresse de l'API (à appeler après `chargerServeur`). */
export function urlApi(): string {
  return courante;
}

export function urlWs(): string {
  return process.env.EXPO_PUBLIC_WS_URL && courante === URL_PAR_DEFAUT
    ? process.env.EXPO_PUBLIC_WS_URL
    : urlWebSocketDepuis(courante);
}

/** Enregistre une adresse déjà validée, ou revient au défaut avec null. */
export async function definirServeur(url: string | null): Promise<void> {
  if (url === null || url === URL_PAR_DEFAUT) {
    courante = URL_PAR_DEFAUT;
    await AsyncStorage.removeItem(CLE).catch(() => undefined);
  } else {
    courante = url;
    await AsyncStorage.setItem(CLE, url).catch(() => undefined);
  }
  chargement = Promise.resolve(courante);
}

/** Vérifie qu'un serveur Fiyen répond à cette adresse (5 s au plus). */
export async function testerServeur(url: string): Promise<boolean> {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), 5000);
  try {
    const rep = await fetch(`${url}/health/live`, { signal: controle.signal });
    return rep.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}
