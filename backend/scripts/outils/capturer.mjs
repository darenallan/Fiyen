// Capture une page d'une application Fiyen, connectée avec un compte de démo.
//
//   node backend/scripts/outils/capturer.mjs <app> <téléphone> <chemin> <largeur> <fichier.png> [hauteur]
//   ex. node backend/scripts/outils/capturer.mjs client +22670001003 / 375 suivi.png
//
// <app> : dashboard | partenaire | livreur | client. La connexion passe par
// l'API, puis la session est posée dans le stockage de la page, comme le fait
// l'application elle-même. Sert aux vérifications visuelles (largeur mobile
// comprise) sans dépendre de la fenêtre du navigateur de l'utilisateur.
//
// Consomme une connexion du quota (10 par minute).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APPS = {
  dashboard: { url: 'http://localhost:5173', cle: 'fiyen' },
  partenaire: { url: 'http://localhost:5177', cle: 'fiyen_partenaire' },
  livreur: { url: 'http://localhost:5175', cle: 'fiyen_livreur' },
  client: { url: 'http://localhost:5176', cle: 'fiyen_client' },
};

const [app, telephone, cheminBrut, largeurBrute, sortie, hauteurBrute] = process.argv.slice(2);
// Sous Git Bash, un argument « /tarifs » arrive converti en
// « C:/Program Files/Git/tarifs » (conversion de chemins MSYS). On accepte
// donc « tarifs » comme « /tarifs », et on défait la conversion si elle a eu lieu.
const chemin = '/' + String(cheminBrut ?? '').replace(/^[A-Za-z]:\/.*?\/Git\//, '').replace(/^\/+/, '');
if (!APPS[app] || !telephone || !chemin || !largeurBrute || !sortie) {
  console.error('usage : capturer.mjs <dashboard|partenaire|livreur|client> <téléphone> <chemin> <largeur> <fichier.png> [hauteur]');
  process.exit(2);
}
const largeur = Number(largeurBrute);
const hauteur = Number(hauteurBrute ?? (largeur < 600 ? 812 : 900));
const API = process.env.API_URL || 'http://localhost:8090';
const PORT_CDP = 9342;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const cnx = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ telephone, mot_de_passe: process.env.MOT_DE_PASSE || 'motdepasse123' }),
});
if (!cnx.ok) {
  console.error(`connexion refusée (${cnx.status})`);
  process.exit(1);
}
const session = await cnx.json();

const PROFIL = path.join(os.tmpdir(), `fiyen-capture-${Date.now()}`);
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${PROFIL}`,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank',
]);

async function finir(code) {
  try {
    chrome.kill();
  } catch {
    /* déjà arrêté */
  }
  await pause(1000);
  try {
    fs.rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    /* sans conséquence */
  }
  process.exit(code);
}

let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://localhost:${PORT_CDP}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {
    await pause(250);
  }
}
const ws = new WebSocket(wsUrl);
const attentes = new Map();
let n = 1;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && attentes.has(m.id)) {
    attentes.get(m.id)(m);
    attentes.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const envoyer = (method, params = {}, sessionId) => {
  const id = n++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((r) => attentes.set(id, r));
};

try {
  const { url, cle } = APPS[app];
  const cible = await envoyer('Target.createTarget', { url: 'about:blank' });
  const sid = (await envoyer('Target.attachToTarget', { targetId: cible.result.targetId, flatten: true })).result.sessionId;
  await envoyer('Page.enable', {}, sid);
  await envoyer('Emulation.setDeviceMetricsOverride', { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile: largeur < 600 }, sid);
  await envoyer('Page.navigate', { url }, sid);
  // Le stockage n'est accessible qu'une fois la page sur la bonne origine :
  // écrire trop tôt viserait about:blank et la session serait perdue.
  let posee = false;
  for (let i = 0; i < 40 && !posee; i++) {
    await pause(250);
    const rep = await envoyer('Runtime.evaluate', {
      expression: `location.origin === ${JSON.stringify(url)} && (localStorage.setItem('${cle}_token', ${JSON.stringify(session.token)}), localStorage.setItem('${cle}_refresh', ${JSON.stringify(session.refresh_token ?? '')}), true)`,
      returnByValue: true,
    }, sid);
    posee = rep.result?.result?.value === true;
  }
  if (!posee) throw new Error(`page ${url} jamais chargée`);
  // On recharge l'application avec sa session, puis on la laisse naviguer
  // elle-même (comme un clic sur le menu) : un rechargement direct sur le
  // chemin se fait rattraper par la redirection de l'écran de connexion.
  await envoyer('Page.navigate', { url }, sid);
  await pause(3000);
  if (chemin !== '/') {
    const rep = await envoyer('Runtime.evaluate', {
      expression: `(() => { const a = [...document.querySelectorAll('a')].find((e) => e.getAttribute('href') === ${JSON.stringify(chemin)}); if (a) { a.click(); return 'lien'; } history.pushState({}, '', ${JSON.stringify(chemin)}); dispatchEvent(new PopStateEvent('popstate')); return 'pushState'; })()`,
      returnByValue: true,
    }, sid);
    await pause(3500);
    const ici = await envoyer('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true }, sid);
    console.log(`navigation par ${rep.result?.result?.value ?? JSON.stringify(rep).slice(0, 300)} → ${ici.result?.result?.value}`);
  } else {
    await pause(3500);
  }
  // AUDIT=1 : contraste WCAG de chaque texte visible contre son fond réel
  // (premier ancêtre au fond opaque). Seuil AA : 4,5:1, ou 3:1 pour le gros
  // texte (≥ 24 px, ou ≥ 18,66 px en gras). Les fonds en dégradé ou en image
  // ne sont pas évalués : l'audit les signale comme tels.
  if (process.env.AUDIT === '1') {
    const rep = await envoyer('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const fond = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return { degrade: true }; const c = rgb(cs.backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] >= 0.95)) return { couleur: c.slice(0, 3) }; } return { couleur: [255, 255, 255] }; };
        const vus = new Set(); const fautes = []; let n = 0, degrades = 0;
        for (const el of document.querySelectorAll('body *')) {
          const texte = [...el.childNodes].filter((t) => t.nodeType === 3).map((t) => t.textContent.trim()).join(' ').trim();
          if (!texte) continue;
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0 || +cs.opacity === 0) continue;
          if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || (r.width <= 1 && r.height <= 1)) continue;
          const f = fond(el); if (f.degrade) { degrades++; continue; }
          const a = lum(rgb(cs.color).slice(0, 3)), b = lum(f.couleur);
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const taille = parseFloat(cs.fontSize), gras = +cs.fontWeight >= 700;
          const seuil = taille >= 24 || (gras && taille >= 18.66) ? 3 : 4.5; n++;
          const cle = texte.slice(0, 30) + ratio.toFixed(2);
          if (ratio < seuil && !vus.has(cle)) { vus.add(cle); fautes.push(ratio.toFixed(2) + ':1 < ' + seuil + ' « ' + texte.slice(0, 40) + ' » (' + cs.color + ')'); }
        }
        return { n, degrades, fautes };
      })()`,
    }, sid);
    const r = rep.result?.result?.value ?? { n: 0, degrades: 0, fautes: ['audit impossible'] };
    console.log(`contraste : ${r.n} textes évalués, ${r.degrades} sur fond dégradé non évalués, ${r.fautes.length} sous le seuil AA`);
    for (const f of r.fautes) console.log(`  ${f}`);

    // Libellés : un bouton ou un champ sans nom accessible est muet pour un
    // lecteur d'écran.
    const lib = await envoyer('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const nom = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('alt') || '').trim();
        const sansNom = [...document.querySelectorAll('button, a[href], [role=button]')].filter((el) => el.offsetParent !== null && !nom(el) && !el.querySelector('img[alt]:not([alt=""])')).map((el) => el.outerHTML.slice(0, 80));
        const champs = [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea')].filter((el) => el.offsetParent !== null && !el.closest('label') && !(el.id && document.querySelector('label[for="' + el.id + '"]')) && !el.getAttribute('aria-label')).map((el) => el.outerHTML.slice(0, 80));
        return { sansNom, champs };
      })()`,
    }, sid);
    const l = lib.result?.result?.value ?? { sansNom: [], champs: [] };
    console.log(`libellés : ${l.sansNom.length} bouton(s)/lien(s) sans nom, ${l.champs.length} champ(s) sans libellé`);
    for (const x of [...l.sansNom, ...l.champs]) console.log(`  ${x}`);
  }

  const capture = await envoyer('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
  fs.writeFileSync(sortie, Buffer.from(capture.result.data, 'base64'));
  console.log(`capture : ${sortie}`);
  await finir(0);
} catch (e) {
  console.error(e.message);
  await finir(1);
}
