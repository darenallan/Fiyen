const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8090';

const CLE_TOKEN = 'fiyen_livreur_token';
const CLE_REFRESH = 'fiyen_livreur_refresh';

/**
 * Marge avant expiration à partir de laquelle on renouvelle sans attendre.
 * Le renouvellement doit être *proactif* et pas seulement déclenché par un 401 :
 * une WebSocket porte son jeton dans l'URL du handshake et ne peut pas rejouer
 * la connexion, donc le jeton doit déjà être frais quand elle s'ouvre.
 */
const MARGE_RENOUVELLEMENT_MS = 2 * 60 * 1000;

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

/** Canal de contact masqué : ni numéro réel, ni identité de l'autre partie. */
export interface SessionMasquage {
  session_id: string;
  course_id: string;
  expire_at: string;
  role: 'destinataire' | 'livreur';
  numero_virtuel?: string;
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

let token: string | null = localStorage.getItem(CLE_TOKEN);
let refreshToken: string | null = localStorage.getItem(CLE_REFRESH);
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export function setToken(valeur: string | null, refresh?: string | null) {
  token = valeur;
  if (valeur) localStorage.setItem(CLE_TOKEN, valeur);
  else localStorage.removeItem(CLE_TOKEN);

  // `undefined` veut dire « ne touche pas au jeton de renouvellement » ;
  // `null` veut dire « efface-le ». Effacer le jeton d'accès seul n'aurait pas
  // de sens : la session serait irrécupérable alors qu'elle est encore valide.
  if (refresh !== undefined) {
    refreshToken = refresh;
    if (refresh) localStorage.setItem(CLE_REFRESH, refresh);
    else localStorage.removeItem(CLE_REFRESH);
  } else if (valeur === null) {
    refreshToken = null;
    localStorage.removeItem(CLE_REFRESH);
  }
}

export function getToken(): string | null {
  return token;
}

/** Date d'expiration du JWT, en millisecondes, ou null s'il est illisible. */
function expirationJWT(jwt: string): number | null {
  try {
    const [, payload] = jwt.split('.');
    const exp = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Un seul renouvellement à la fois : sinon deux requêtes simultanées en 401
 *  feraient tourner le jeton deux fois, et la seconde rotation invaliderait la
 *  première — le serveur y verrait un rejeu et couperait toute la session. */
let renouvellementEnCours: Promise<boolean> | null = null;

async function renouveler(): Promise<boolean> {
  if (!refreshToken) return false;
  if (renouvellementEnCours) return renouvellementEnCours;

  renouvellementEnCours = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        // 401 : session révoquée ou expirée pour de bon. Une panne réseau, elle,
        // lève et laisse le jeton en place — on retentera au prochain appel.
        if (res.status === 401) setToken(null, null);
        return false;
      }
      const body = (await res.json()) as { token: string; refresh_token: string };
      setToken(body.token, body.refresh_token);
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
 * Garantit un jeton d'accès valide pour les quelques minutes qui viennent.
 * À appeler avant d'ouvrir une WebSocket, dont le jeton ne peut pas être rejoué.
 */
export async function assurerJetonFrais(): Promise<boolean> {
  if (!token) return false;
  const exp = expirationJWT(token);
  if (exp === null) return true; // illisible : laisser le serveur trancher
  if (exp - Date.now() > MARGE_RENOUVELLEMENT_MS) return true;
  return renouveler();
}

/** Révoque la session côté serveur. Silencieuse en cas d'échec : l'important
 *  est d'effacer le jeton localement, ce que fait l'appelant. */
export async function deconnexionServeur(): Promise<void> {
  if (!refreshToken) return;
  try {
    await fetch(`${API_BASE_URL}/api/auth/deconnexion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // hors ligne : le jeton expirera de lui-même
  }
}

async function requete<T>(path: string, options: RequestInit = {}, rejeu = false): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    // Un 401 sur un jeton expiré se rattrape : on renouvelle et on rejoue une
    // fois. `rejeu` empêche la boucle si le serveur refuse encore.
    if (res.status === 401 && !rejeu && refreshToken) {
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

export function urlWebSocketMasquage(sessionId: string): string {
  return `${WS_BASE_URL}/ws/masquage/${sessionId}?token=${encodeURIComponent(token ?? '')}`;
}

export function urlWebSocketPosition(): string {
  return `${WS_BASE_URL}/ws/livreur/position?token=${encodeURIComponent(token ?? '')}`;
}

export function decodeRole(jwt: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}
