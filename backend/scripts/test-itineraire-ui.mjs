// Vérifie le bouton « Itinéraire » de l'app livreur dans un vrai navigateur.
//
//   node backend/scripts/test-itineraire-ui.mjs
//
// Ce qui est prouvé : le bouton vise d'abord le point de retrait, puis la
// livraison une fois le colis récupéré ; il ouvre Google Maps sur l'adresse
// en texte (le livreur ne reçoit pas de coordonnées) ; aucun numéro ne part
// dans l'URL. `window.open` est espionné : on ne va pas réellement sur Google.
//
// Exige l'API sur :8090 et app-livreur sur :5175.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:8090';
const LIVREUR = process.env.URL_LIVREUR || 'http://localhost:5175';
const PORT_CDP = 9341;

let reussis = 0;
let echoues = 0;
const verifier = (l, c, d = '') => {
  if (c) {
    reussis++;
    console.log(`  ok    ${l}`);
  } else {
    echoues++;
    console.log(`  ECHEC ${l}${d ? `\n          → ${d}` : ''}`);
  }
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const tel = () => `+2267${Math.floor(1000000 + Math.random() * 8999999)}`;

async function appel(methode, chemin, { jeton, corps } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  const rep = await fetch(`${API}${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined });
  let json = null;
  try {
    json = await rep.json();
  } catch {
    /* 204 */
  }
  return { statut: rep.status, json };
}

// --- Décor : une compagnie, un livreur, une course assignée ---------------

const RETRAIT = 'Marché de Rood Woko';
const LIVRAISON = 'Zone du Bois, rue 15.42';
const telLivreur = tel();
const telDestinataire = tel();

const insc = await appel('POST', '/api/auth/register-compagnie', {
  corps: { nom_compagnie: `Itinéraire UI ${Date.now()}`, telephone: tel(), mot_de_passe: 'motdepasse123' },
});
if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
const jc = insc.json.token;

const livreur = await appel('POST', '/api/livreurs/', { jeton: jc, corps: { nom: 'Salif Traoré', telephone: telLivreur, mot_de_passe: 'motdepasse123' } });
const cnx = await appel('POST', '/api/auth/login', { corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' } });
await appel('PATCH', '/api/livreurs/me/statut', { jeton: cnx.json.token, corps: { statut: 'dispo' } });
const dest = await appel('POST', '/api/auth/register-destinataire', { corps: { nom: 'Awa Ouédraogo', telephone: telDestinataire, mot_de_passe: 'motdepasse123' } });
const course = await appel('POST', '/api/courses/', { jeton: jc, corps: { destinataire_id: dest.json.destinataire_id, adresse_depart: RETRAIT, adresse_arrivee: LIVRAISON } });
const assign = await appel('PATCH', `/api/courses/${course.json?.id}/assigner`, { jeton: jc, corps: { livreur_id: livreur.json?.id } });
if (assign.statut !== 200) throw new Error(`décor incomplet : assignation ${assign.statut} ${JSON.stringify(assign.json)}`);

// --- Navigateur ------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-itineraire-ui-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${PROFIL}`, '--no-first-run', '--disable-gpu', 'about:blank']);
console.log(`  (chrome pid ${chrome.pid})`);

async function terminer(code) {
  try {
    chrome.kill();
  } catch {
    /* déjà arrêté */
  }
  await pause(1200);
  // Le profil est supprimé : il pèse plusieurs Mo par exécution.
  try {
    fs.rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  } catch {
    /* sans conséquence */
  }
  process.exit(code);
}

async function attendreCDP() {
  for (let i = 0; i < 60; i++) {
    try {
      const rep = await fetch(`http://localhost:${PORT_CDP}/json/version`);
      if (rep.ok) return (await rep.json()).webSocketDebuggerUrl;
    } catch {
      /* pas prêt */
    }
    await pause(250);
  }
  throw new Error(`Chrome injoignable sur le port ${PORT_CDP}`);
}

const ws = new WebSocket(await attendreCDP());
const attentes = new Map();
let n = 1;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && attentes.has(m.id)) {
    attentes.get(m.id)(m);
    attentes.delete(m.id);
  }
};
await new Promise((r, e) => {
  ws.onopen = r;
  ws.onerror = e;
});
const envoyer = (method, params = {}, sessionId) => {
  const id = n++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((r) => attentes.set(id, r));
};

try {
  const cible = await envoyer('Target.createTarget', { url: 'about:blank' });
  const sid = (await envoyer('Target.attachToTarget', { targetId: cible.result.targetId, flatten: true })).result.sessionId;
  await envoyer('Page.enable', {}, sid);
  const evaluer = async (expression) => {
    const rep = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (rep.result?.exceptionDetails) throw new Error(rep.result.exceptionDetails.exception?.description ?? 'erreur JS');
    return rep.result?.result?.value;
  };
  const aller = async (url) => {
    await envoyer('Page.navigate', { url }, sid);
    await pause(2500);
  };
  const cliquer = (texte) =>
    evaluer(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(texte)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
  const derniere = () => evaluer('window.__ouvertures?.[window.__ouvertures.length - 1] ?? null');
  const espion = () => evaluer('window.__ouvertures = []; window.open = (u) => { window.__ouvertures.push(u); return null; }; true');

  console.log('\nApp livreur');
  await aller(LIVREUR);
  await evaluer(`localStorage.setItem('fiyen_livreur_token', ${JSON.stringify(cnx.json.token)}); localStorage.setItem('fiyen_livreur_refresh', ${JSON.stringify(cnx.json.refresh_token ?? '')}); true`);
  await aller(LIVREUR);
  await cliquer('Courses');
  await pause(800);
  await espion();

  verifier('le bouton vise d’abord le retrait', (await cliquer('Itinéraire vers le retrait')) === 'ok');
  let u = await derniere();
  let url = u ? new URL(u) : null;
  verifier('il ouvre Google Maps en mode itinéraire', url?.hostname === 'www.google.com' && url?.pathname === '/maps/dir/', u ?? 'aucune ouverture');
  verifier('la destination est l’adresse de retrait, en texte', url?.searchParams.get('destination') === `${RETRAIT}, Burkina Faso`, url?.searchParams.get('destination'));
  verifier('aucun numéro de téléphone dans l’URL', u && !u.includes(telLivreur.slice(4)) && !u.includes(telDestinataire.slice(4)) && !/\d{8}/.test(decodeURIComponent(u)), u);

  verifier('le colis est déclaré récupéré', (await cliquer("J'ai récupéré le colis")) === 'ok');
  await pause(1500);
  verifier('le bouton vise ensuite la livraison', (await cliquer('Itinéraire vers la livraison')) === 'ok');
  u = await derniere();
  url = u ? new URL(u) : null;
  verifier('la destination est l’adresse de livraison', url?.searchParams.get('destination') === `${LIVRAISON}, Burkina Faso`, url?.searchParams.get('destination'));
} catch (e) {
  echoues++;
  console.log(`  ECHEC inattendu : ${e.message}`);
}

console.log(`\n${reussis} vérifications passées, ${echoues} en échec`);
await terminer(echoues ? 1 : 0);
