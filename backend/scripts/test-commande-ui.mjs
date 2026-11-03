// Parcours de commande du partenaire dans un vrai navigateur, prix compris.
//
//   node backend/scripts/test-commande-ui.mjs
//
// Ce qui est prouvé à l'écran : le point de retrait est pré-rempli avec
// l'entreprise ; le récapitulatif annonce le prix du barème publié par la
// compagnie ; la commande envoyée porte ce prix sur son suivi. Et, sans
// barème, aucun prix n'est inventé.
//
// Exige l'API sur :8090 et app-partenaire sur :5177.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:8090';
const PARTENAIRE = process.env.URL_PARTENAIRE || 'http://localhost:5177';
const PORT_CDP = 9343;

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
// Les montants s'affichent avec des espaces insécables fines (fr-FR).
const normaliser = (s) => String(s ?? '').replace(/[\s\u202f\u00a0]+/g, ' ');

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

// --- Décor : une compagnie, son barème (forfait), un partenaire -------------

const NOM_PARTENAIRE = `Boutique Wend-Panga ${Date.now() % 10000}`;
const REPERE = 'Face au marché, porte verte';
const insc = await appel('POST', '/api/auth/register-compagnie', {
  corps: { nom_compagnie: `Commande UI ${Date.now()}`, telephone: tel(), mot_de_passe: 'motdepasse123' },
});
if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
const jc = insc.json.token;
const telPartenaire = tel();
const part = await appel('POST', '/api/partenaires/', { jeton: jc, corps: { nom: NOM_PARTENAIRE, repere: REPERE, telephone: telPartenaire, mot_de_passe: 'motdepasse123' } });
if (part.statut !== 201) throw new Error(`partenaire: ${part.statut}`);
const cnx = await appel('POST', '/api/auth/login', { corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' } });

// --- Navigateur --------------------------------------------------------------

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-commande-ui-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${PROFIL}`, '--no-first-run', '--disable-gpu', 'about:blank']);
console.log(`  (chrome pid ${chrome.pid})`);

async function terminer(code) {
  try {
    chrome.kill();
  } catch {
    /* déjà arrêté */
  }
  await pause(1200);
  try {
    fs.rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
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
  const cible = await envoyer('Target.createTarget', { url: 'about:blank' });
  const sid = (await envoyer('Target.attachToTarget', { targetId: cible.result.targetId, flatten: true })).result.sessionId;
  await envoyer('Page.enable', {}, sid);
  await envoyer('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
  const evaluer = async (expression) => {
    const rep = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (rep.result?.exceptionDetails) throw new Error(rep.result.exceptionDetails.exception?.description ?? 'erreur JS');
    return rep.result?.result?.value;
  };
  const cliquer = (texte) =>
    evaluer(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(texte)})); if (!b) return 'absent'; b.click(); return 'ok'; })()`);
  // Saisie dans un champ React contrôlé : le setter natif, puis l'évènement.
  const saisir = (placeholder, valeur) =>
    evaluer(`(() => { const c = document.querySelector('input[placeholder=${JSON.stringify(placeholder)}]'); if (!c) return 'absent'; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(c, ${JSON.stringify(valeur)}); c.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  const valeur = (placeholder) => evaluer(`document.querySelector('input[placeholder=${JSON.stringify(placeholder)}]')?.value ?? null`);
  const texte = () => evaluer('document.body.innerText');

  async function ouvrirCommande() {
    await envoyer('Page.navigate', { url: PARTENAIRE }, sid);
    await pause(2500);
    await evaluer(`localStorage.removeItem('fiyen_partenaire_brouillon'); localStorage.setItem('fiyen_partenaire_token', ${JSON.stringify(cnx.json.token)}); localStorage.setItem('fiyen_partenaire_refresh', ${JSON.stringify(cnx.json.refresh_token ?? '')}); true`);
    await envoyer('Page.navigate', { url: PARTENAIRE }, sid);
    await pause(2500);
    return cliquer('Commander une livraison');
  }

  async function allerAuRecap() {
    await cliquer('Continuer');
    await pause(500);
    await saisir('Awa Ouédraogo', 'Awa Ouédraogo');
    await saisir('+22670000000', tel());
    await saisir('Zone du Bois, rue 15.42', 'Cité An III, porte 42');
    await cliquer('Continuer');
    await pause(500);
    await cliquer('Continuer');
    await pause(2000);
  }

  console.log('\nSans barème publié');
  verifier('l’écran de commande s’ouvre', (await ouvrirCommande()) === 'ok');
  await pause(1500);
  verifier('le retrait est pré-rempli avec le nom de l’entreprise', (await valeur('Boutique, avenue Kwame Nkrumah')) === NOM_PARTENAIRE, await valeur('Boutique, avenue Kwame Nkrumah'));
  verifier('et avec son repère', (await valeur('Face à la pharmacie du Centre')) === REPERE, await valeur('Face à la pharmacie du Centre'));
  await allerAuRecap();
  let t = normaliser(await texte());
  verifier('le récapitulatif est affiché', t.includes('Tout est bon'));
  verifier('aucun prix inventé sans barème', !/\d F CFA/.test(t) && /barème/.test(t), t.slice(t.indexOf('Tout est bon'), t.indexOf('Tout est bon') + 400));

  // La compagnie publie un forfait : la prochaine commande l'annonce.
  const pub = await appel('POST', '/api/dashboard/bareme', { jeton: jc, corps: { mode: 'forfait', prix_forfait: 1500, coefficient_detour: 1.3, arrondi: 50, motif: 'test UI' } });
  if (pub.statut !== 201) throw new Error(`barème: ${pub.statut}`);

  console.log('\nAvec un forfait de 1 500 F publié');
  verifier('l’écran de commande s’ouvre', (await ouvrirCommande()) === 'ok');
  await pause(1500);
  await allerAuRecap();
  t = normaliser(await texte());
  verifier('le récapitulatif annonce le prix du barème', t.toLowerCase().includes('prix de la course') && t.includes('1 500 F CFA'), t.slice(t.indexOf('Tout est bon'), t.indexOf('Tout est bon') + 400));
  verifier('l’envoi part', (await cliquer('Envoyer la commande')) === 'ok');
  await pause(3000);
  t = normaliser(await texte());
  verifier('le suivi s’ouvre sur la commande créée', /FY-\d+/.test(t), t.slice(0, 200));
  verifier('le suivi affiche le prix figé', t.includes('1 500 F CFA') && t.includes('barème au moment de la commande'), t.slice(0, 900));
} catch (e) {
  echoues++;
  console.log(`  ECHEC inattendu : ${e.message}`);
}

console.log(`\n${reussis} vérifications passées, ${echoues} en échec`);
await terminer(echoues ? 1 : 0);
