interface JwtClaims {
  utilisateur_id: string;
  role: 'compagnie' | 'livreur' | 'client';
  compagnie_id?: string;
  livreur_id?: string;
  client_id?: string;
  exp: number;
}

export function decodeJwt(token: string): JwtClaims | null {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function estExpire(claims: JwtClaims): boolean {
  return claims.exp * 1000 < Date.now();
}
