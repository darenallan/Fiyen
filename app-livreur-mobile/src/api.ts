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
  client_id: string;
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
  role: 'client' | 'livreur';
  active: boolean;
}

export interface MessageMasque {
  id: string;
  expediteur: 'client' | 'livreur';
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
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export async function chargerToken(): Promise<string | null> {
  tokenCache = await AsyncStorage.getItem(CLE_TOKEN);
  return tokenCache;
}

export async function definirToken(valeur: string | null) {
  tokenCache = valeur;
  if (valeur) await AsyncStorage.setItem(CLE_TOKEN, valeur);
  else await AsyncStorage.removeItem(CLE_TOKEN);
}

export function tokenEnMemoire(): string | null {
  return tokenCache;
}

async function requete<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenCache ?? (await chargerToken());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
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
    requete<{ token: string; role: string }>('/api/auth/login', {
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
