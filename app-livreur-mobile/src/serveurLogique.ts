/**
 * Adresse du serveur Fiyen — logique seule, testée sans téléphone
 * (`tests/serveur.test.mjs`).
 *
 * L'adresse est réglable depuis l'écran de connexion : en test, l'IP du PC
 * change d'une semaine à l'autre (DHCP), et plus tard l'API passera en HTTPS.
 * Dans les deux cas, on corrige un réglage au lieu de reconstruire l'APK.
 */

export type ResultatUrl = { ok: true; url: string } | { ok: false; raison: string };

/**
 * Accepte ce qu'on tape naturellement — « 192.168.1.20:8090 »,
 * « https://api.exemple.bf/ » — et rend une origine propre, sans chemin.
 */
export function normaliserUrlServeur(saisie: string): ResultatUrl {
  let brut = saisie.trim();
  if (brut === '') return { ok: false, raison: 'adresse vide' };
  if (!/^[a-z]+:\/\//i.test(brut)) brut = `http://${brut}`;

  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return { ok: false, raison: 'adresse illisible' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, raison: 'l’adresse doit commencer par http:// ou https://' };
  }
  if (!u.hostname) return { ok: false, raison: 'nom de serveur manquant' };
  if (u.username || u.password) return { ok: false, raison: 'identifiants interdits dans l’adresse' };
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
    return { ok: false, raison: 'indiquez seulement le serveur, sans chemin (ex. https://api.exemple.bf)' };
  }
  return { ok: true, url: `${u.protocol}//${u.host}` };
}

/** Adresse WebSocket correspondante : http → ws, https → wss. */
export function urlWebSocketDepuis(api: string): string {
  return api.replace(/^http/, 'ws');
}

/**
 * Avertissement à afficher pour une adresse en clair hors réseau local :
 * les mots de passe y voyageraient lisibles par n'importe quel intermédiaire.
 */
export function avertissement(url: string): string | null {
  const u = new URL(url);
  if (u.protocol === 'https:') return null;
  const local =
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) ||
    u.hostname.endsWith('.local');
  return local ? null : 'Connexion non chiffrée (http) hors réseau local : à éviter, préférez https.';
}
