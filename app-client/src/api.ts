const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8090';

const CLE_TOKEN = 'fiyen_client_token';

export type StatutCourse =
  | 'en_attente'
  | 'assignee'
  | 'recuperee'
  | 'en_route'
  | 'livree'
  | 'annulee';

export interface Course {
  id: string;
  client_id: string;
  /** Volontairement absent de l'affichage : le client ne doit pas identifier son livreur. */
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
  numero_virtuel?: string;
  active: boolean;
}

export interface MessageMasque {
  id: string;
  expediteur: 'client' | 'livreur';
  contenu: string;
  created_at: string;
}

export interface PositionLivreur {
  livreur_id: string;
  latitude: number;
  longitude: number;
  horodatage: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let token: string | null = localStorage.getItem(CLE_TOKEN);
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export function setToken(valeur: string | null) {
  token = valeur;
  if (valeur) localStorage.setItem(CLE_TOKEN, valeur);
  else localStorage.removeItem(CLE_TOKEN);
}

export function getToken(): string | null {
  return token;
}

async function requete<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

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

  inscription: (nom: string, telephone: string, motDePasse: string) =>
    requete<{ token: string; client_id: string }>('/api/auth/register-client', {
      method: 'POST',
      body: JSON.stringify({ nom, telephone, mot_de_passe: motDePasse }),
    }),

  mesCourses: () => requete<Course[] | null>('/api/courses/mes-courses'),

  sessionMasquage: (courseId: string) =>
    requete<SessionMasquage>(`/api/courses/${courseId}/masquage`),

  messagesMasques: (sessionId: string) =>
    requete<MessageMasque[]>(`/api/masquage/${sessionId}/messages`),
};

export function urlWebSocketMasquage(sessionId: string): string {
  return `${WS_BASE_URL}/ws/masquage/${sessionId}?token=${encodeURIComponent(token ?? '')}`;
}

export function urlWebSocketCourse(courseId: string): string {
  return `${WS_BASE_URL}/ws/courses/${courseId}/position?token=${encodeURIComponent(token ?? '')}`;
}

export function decodeRole(jwt: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch {
    return null;
  }
}
