import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * `localhost` ne désigne pas la machine de développement depuis un téléphone :
 * en test sur appareil réel, renseigner l'IP de la machine sur le réseau local
 * via EXPO_PUBLIC_API_URL (voir README).
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8090';
export const WS_BASE_URL =
  process.env.EXPO_PUBLIC_WS_URL ?? API_BASE_URL.replace(/^http/, 'ws');

const CLE_TOKEN = 'fiyen_livreur_token';
const CLE_REFRESH = 'fiyen_livreur_refresh';

/**
 * Marge avant expiration à partir de laquelle on renouvelle sans attendre.
 * Le renouvellement doit être *proactif* : la tâche de localisation envoie ses
 * lots depuis l'arrière-plan, sans interface pour signaler un échec, et une
 * WebSocket porte son jeton dans l'URL du handshake sans pouvoir le rejouer.
 */
const MARGE_RENOUVELLEMENT_MS = 5 * 60 * 1000;

export type StatutLivreur = 'offline' | 'dispo' | 'en_course';

export type StatutCourse =
  | 'en_attente'
  | 'assignee'
  | 'recuperee'
  | 'en_route'
  | 'livree'
  | 'annulee';

export interface Livreur {
  id: string;
  compagnie_id: string;
  nom: string;
  statut: StatutLivreur;
  created_at: string;
}

export interface Course {
  id: string;
  destinataire_id: string;
  livreur_id: string | null;
  statut: StatutCourse;
  adresse_depart: string;
  adresse_arrivee: string;
  created_at: string;
  updated_at: string;
}

export interface SessionMasquage {
  session_id: string;
  course_id: string;
  expire_at: string;
  role: 'destinataire' | 'livreur';
  active: boolean;
}

export interface MessageMasque {
  id: string;
  expediteur: 'destinataire' | 'livreur';
  contenu: string;
  created_at: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Le jeton vit dans AsyncStorage et non en mémoire : la tâche de localisation
 * s'exécute hors du contexte React, y compris après que le système a relancé
 * l'app en arrière-plan, et doit pouvoir s'authentifier seule.
 */
let tokenCache: string | null = null;
let refreshCache: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export async function chargerToken(): Promise<string | null> {
  const [acces, refresh] = await Promise.all([
    AsyncStorage.getItem(CLE_TOKEN),
    AsyncStorage.getItem(CLE_REFRESH),
  ]);
  tokenCache = acces;
  refreshCache = refresh;
  return tokenCache;
}

export async function definirToken(valeur: string | null, refresh?: string | null) {
  tokenCache = valeur;
  if (valeur) await AsyncStorage.setItem(CLE_TOKEN, valeur);
  else await AsyncStorage.removeItem(CLE_TOKEN);

  // `undefined` veut dire « ne touche pas au jeton de renouvellement » ;
  // `null` veut dire « efface-le ». Effacer le jeton d'accès seul n'aurait pas
  // de sens : la session serait irrécupérable alors qu'elle est encore valide.
  if (refresh !== undefined) {
    refreshCache = refresh;
    if (refresh) await AsyncStorage.setItem(CLE_REFRESH, refresh);
    else await AsyncStorage.removeItem(CLE_REFRESH);
  } else if (valeur === null) {
    refreshCache = null;
    await AsyncStorage.removeItem(CLE_REFRESH);
  }
}

export function tokenEnMemoire(): string | null {
  return tokenCache;
}

/** Date d'expiration du JWT, en millisecondes, ou null s'il est illisible. */
function expirationJWT(jwt: string): number | null {
  try {
    const [, payload] = jwt.split('.');
    // Même décodage que decodeRole : atob n'existe pas sur Hermes.
    const json = decodeBase64(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Un seul renouvellement à la fois : deux rotations concurrentes feraient
 * passer la seconde pour un rejeu côté serveur, qui couperait la session.
 *
 * Le verrou est en mémoire, donc valable au sein d'un même contexte JS. La
 * tâche de localisation partage ce contexte tant que l'app vit ; si Android la
 * relance seule après avoir tué le processus, les deux contextes pourraient se
 * marcher dessus. À vérifier lors du premier essai sur appareil réel — c'est la
 * dette « app Expo jamais exécutée » notée dans CLAUDE.md.
 */
let renouvellementEnCours: Promise<boolean> | null = null;

async function renouveler(): Promise<boolean> {
  // Relecture depuis le stockage : la tâche de localisation peut avoir été
  // relancée dans un contexte où le cache mémoire est vide.
  const refresh = refreshCache ?? (await AsyncStorage.getItem(CLE_REFRESH));
  if (!refresh) return false;
  if (renouvellementEnCours) return renouvellementEnCours;

  renouvellementEnCours = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        // 401 : session révoquée ou expirée pour de bon. Une coupure réseau,
        // elle, lève et laisse le jeton en place — on retentera plus tard.
        if (res.status === 401) await definirToken(null, null);
        return false;
      }
      const body = (await res.json()) as { token: string; refresh_token: string };
      await definirToken(body.token, body.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      renouvellementEnCours = null;
    }
  })();

  return renouvellementEnCours;
}

/**
 * Garantit un jeton d'accès valide pour les minutes qui viennent.
 *
 * Appelée aussi par la tâche de localisation d'arrière-plan, qui s'exécute hors
 * contexte React : sans elle, un livreur en course depuis plus de 30 minutes
 * verrait ses lots de positions rejetés en 401 sans que rien ne le lui dise.
 */
export function renouvelerSession(): Promise<boolean> {
  return renouveler();
}

export async function assurerJetonFrais(): Promise<boolean> {
  const token = tokenCache ?? (await chargerToken());
  if (!token) return false;
  const exp = expirationJWT(token);
  if (exp === null) return true; // illisible : laisser le serveur trancher
  if (exp - Date.now() > MARGE_RENOUVELLEMENT_MS) return true;
  return renouveler();
}

/** Révoque la session côté serveur. Silencieuse en cas d'échec : l'important
 *  est d'effacer le jeton localement, ce que fait l'appelant. */
export async function deconnexionServeur(): Promise<void> {
  const refresh = refreshCache ?? (await AsyncStorage.getItem(CLE_REFRESH));
  if (!refresh) return;
  try {
    await fetch(`${API_BASE_URL}/api/auth/deconnexion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {
    // hors ligne : le jeton expirera de lui-même
  }
}

async function requete<T>(path: string, options: RequestInit = {}, rejeu = false): Promise<T> {
  const token = tokenCache ?? (await chargerToken());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    // Un 401 sur un jeton expiré se rattrape : on renouvelle et on rejoue une
    // fois. `rejeu` empêche la boucle si le serveur refuse encore.
    if (res.status === 401 && !rejeu) {
      if (await renouveler()) return requete<T>(path, options, true);
    }

    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.erreur ?? message;
    } catch {
      // corps non-JSON
    }
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  login: (telephone: string, motDePasse: string) =>
    requete<{ token: string; refresh_token: string; role: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ telephone, mot_de_passe: motDePasse }),
    }),

  monProfil: () => requete<Livreur>('/api/livreurs/me'),

  changerStatut: (statut: 'dispo' | 'offline') =>
    requete<{ statut: StatutLivreur }>('/api/livreurs/me/statut', {
      method: 'PATCH',
      body: JSON.stringify({ statut }),
    }),

  mesCourses: () => requete<Course[] | null>('/api/courses/mes-courses'),

  changerStatutCourse: (courseId: string, statut: StatutCourse) =>
    requete<{ statut: StatutCourse }>(`/api/courses/${courseId}/statut`, {
      method: 'PATCH',
      body: JSON.stringify({ statut }),
    }),

  sessionMasquage: (courseId: string) =>
    requete<SessionMasquage>(`/api/courses/${courseId}/masquage`),

  messagesMasques: (sessionId: string) =>
    requete<MessageMasque[]>(`/api/masquage/${sessionId}/messages`),
};

export function urlWebSocketMasquage(sessionId: string, token: string): string {
  return `${WS_BASE_URL}/ws/masquage/${sessionId}?token=${encodeURIComponent(token)}`;
}

export function decodeRole(jwt: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    // atob n'existe pas sur Hermes : décodage base64url manuel.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeBase64(base64);
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(entree: string): string {
  const propre = entree.replace(/=+$/, '');
  let bits = 0;
  let valeur = 0;
  let sortie = '';

  for (const caractere of propre) {
    const index = ALPHABET.indexOf(caractere);
    if (index === -1) continue;
    valeur = (valeur << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      sortie += String.fromCharCode((valeur >> bits) & 0xff);
    }
  }

  // Les payloads JWT sont en UTF-8 ; on repasse les octets en texte.
  try {
    return decodeURIComponent(
      sortie
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  } catch {
    return sortie;
  }
}
