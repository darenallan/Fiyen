import { MODE_DEMO, repondreDemo, ErreurDemo, csvDemo } from './demo';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090';

const CLE_TOKEN = 'fiyen_token';
const CLE_REFRESH = 'fiyen_refresh';

/**
 * Marge avant expiration à partir de laquelle on renouvelle sans attendre.
 * Le renouvellement doit être *proactif* et pas seulement déclenché par un 401 :
 * une WebSocket porte son jeton dans l'URL du handshake et ne peut pas rejouer
 * la connexion, donc le jeton doit déjà être frais quand elle s'ouvre.
 */
const MARGE_RENOUVELLEMENT_MS = 2 * 60 * 1000;

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

export function setOnUnauthorized(callback: () => void) {
  onUnauthorized = callback;
}

export function setToken(value: string | null, refresh?: string | null) {
  token = value;
  if (value) {
    localStorage.setItem(CLE_TOKEN, value);
  } else {
    localStorage.removeItem(CLE_TOKEN);
  }

  // `undefined` veut dire « ne touche pas au jeton de renouvellement » ;
  // `null` veut dire « efface-le ». Effacer le jeton d'accès seul n'aurait pas
  // de sens : la session serait irrécupérable alors qu'elle est encore valide.
  if (refresh !== undefined) {
    refreshToken = refresh;
    if (refresh) {
      localStorage.setItem(CLE_REFRESH, refresh);
    } else {
      localStorage.removeItem(CLE_REFRESH);
    }
  } else if (value === null) {
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
  if (MODE_DEMO) return true; // le jeton de démo dure un an
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
  if (!refreshToken || MODE_DEMO) return;
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
  if (MODE_DEMO) {
    try {
      return await repondreDemo<T>(path, options);
    } catch (err) {
      if (err instanceof ErreurDemo) throw new ApiError(err.message, err.status);
      throw err;
    }
  }

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

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
      // corps non-JSON, on garde le statusText
    }
    if (res.status === 401) {
      onUnauthorized?.();
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => requete<T>(path),
  post: <T>(path: string, body?: unknown) =>
    requete<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    requete<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => requete<T>(path, { method: 'DELETE' }),
};


/**
 * Rend l'image d'une preuve sous forme d'URL d'objet, à révoquer par
 * l'appelant.
 *
 * Elle ne peut pas être posée directement dans un `<img src>` : l'attribut ne
 * transporte pas d'en-tête `Authorization`, et l'endpoint est authentifié.
 * Une URL signée à durée courte serait l'autre option — elle ajouterait un
 * mécanisme de signature pour un seul usage.
 *
 * Rend `null` quand il n'y a pas d'image : une preuve peut n'être qu'un nom.
 */
export async function urlMediaPreuve(courseId: string): Promise<string | null> {
  if (MODE_DEMO) return null; // le jeu de démo n'a pas de photo de remise
  await assurerJetonFrais();
  const rep = await fetch(`${API_BASE_URL}/api/courses/${courseId}/preuve/media`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!rep.ok) return null;
  return URL.createObjectURL(await rep.blob());
}

/**
 * Télécharge un fichier d'un endpoint authentifié. Un simple lien `<a href>`
 * ne porterait pas l'en-tête `Authorization` : on passe par un blob.
 */
export async function telechargerFichier(path: string, nomParDefaut: string): Promise<void> {
  let nom = nomParDefaut;
  let blob: Blob;
  if (MODE_DEMO) {
    blob = new Blob([csvDemo(path)], { type: 'text/csv;charset=utf-8' });
  } else {
    await assurerJetonFrais();
    const rep = await fetch(`${API_BASE_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!rep.ok) throw new ApiError('Téléchargement impossible', rep.status);
    nom = /filename="([^"]+)"/.exec(rep.headers.get('Content-Disposition') ?? '')?.[1] ?? nomParDefaut;
    blob = await rep.blob();
  }
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function wsUrl(path: string): string {
  const base = (import.meta.env.VITE_WS_BASE_URL as string) ?? 'ws://localhost:8090';
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${path}${sep}token=${encodeURIComponent(token ?? '')}`;
}
