const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let token: string | null = localStorage.getItem('fiyen_token');
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(callback: () => void) {
  onUnauthorized = callback;
}

export function setToken(value: string | null) {
  token = value;
  if (value) {
    localStorage.setItem('fiyen_token', value);
  } else {
    localStorage.removeItem('fiyen_token');
  }
}

export function getToken(): string | null {
  return token;
}

async function requete<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
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
};

export function wsUrl(path: string): string {
  const base = (import.meta.env.VITE_WS_BASE_URL as string) ?? 'ws://localhost:8090';
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${path}${sep}token=${encodeURIComponent(token ?? '')}`;
}
