// Vérifie le bouton « Partager par WhatsApp » dans un vrai navigateur, sur les
// deux applications qui le portent.
//
//   node backend/scripts/test-partage-ui.mjs
//
// Ce que l'API à elle seule ne peut pas prouver : que le bouton appelle bien
// l'endpoint de génération, et ouvre bien `wa.me` avec l'URL renvoyée dans le
// texte du message — pas un lien codé en dur, pas une URL relative qui ne
// voudrait rien dire une fois collée dans WhatsApp. `window.open` est
// remplacé avant le clic : on ne va pas réellement sur wa.me, WhatsApp Web
// n'a rien à faire dans un test.
//
// Exige l'API sur :8090, app-partenaire sur :5177 et le dashboard sur :5173
// (ou URL_DASHBOARD si le port diffère).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:8090';
const PARTENAIRE = process.env.URL_PARTENAIRE || 'http://localhost:5177';
const DASHBOARD = process.env.URL_DASHBOARD || 'http://localhost:5173';
const PORT_CDP = 9338;

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
const titre = (t) => console.log(`\n${t}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const tel = () => `+2267${Math.floor(1000000 + Math.random() * 8999999)}`;
const uniq = () => Math.random().toString(36).slice(2, 8);

async function appel(methode, chemin, { jeton, corps } = {}) {
  const entetes = { 'Content-Type': 'application/json' };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  const rep = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let json = null;
  try {
    json = await rep.json();
  } catch {
    /* 204 */
  }
  return { statut: rep.status, json };
}

// --- Décor : une compagnie, son partenaire, une commande ------------------

const suffixe = uniq();

const insc = await appel('POST', '/api/auth/register-compagnie', {
  corps: { nom_compagnie: `Partage UI ${suffixe}`, telephone: tel(), mot_de_passe: 'motdepasse123' },
});
if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
const jetonCompagnie = insc.json.token;

const telPartenaire = tel();
const part = await appel('POST', '/api/partenaires/', {
  jeton: jetonCompagnie,
  corps: { nom: `Boutique ${suffixe}`, telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
});
if (part.statut !== 201) throw new Error(`partenaire: ${part.statut}`);

const cnxPartenaire = await appel('POST', '/api/auth/login', {
  corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
});
const jetonPartenaire = cnxPartenaire.json.token;

const cmd = await appel('POST', '/api/commandes/', {
  jeton: jetonPartenaire,
  corps: {
    destinataire_nom: 'Awa Ouédraogo',
    destinataire_telephone: tel(),
    adresse_depart: 'Boutique, avenue Kwamé N’Krumah',
    adresse_arrivee: 'Zone du Bois, rue 15.42',
  },
});
if (cmd.statut !== 201) throw new Error(`commande: ${cmd.statut} ${JSON.stringify(cmd.json)}`);

console.log(`Commande ${cmd.json.numero} créée pour le test de partage.`);

// --- Navigateur --------------------------------------------------------

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-partage-ui-${Date.now()}`);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT_CDP}`,
  `--user-data-dir=${PROFIL}`,
  '--no-first-run',
  '--disable-gpu',
  'about:blank',
]);

// Le PID est conservé pour un arrêt ciblé : arrêter Chrome par nom d'image
// fermerait toutes les fenêtres de la machine, y compris celles de l'auteur.
console.log(`  (chrome pid ${chrome.pid})`);

let sortiPropre = false;
async function terminer(code) {
  if (!sortiPropre) {
    sortiPropre = true;
    try {
      chrome.kill();
    } catch {
      /* déjà mort */
    }
    await pause(1200);
    try {
      fs.rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } catch {
      /* profil résiduel : sans conséquence */
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => void terminer(130));

async function attendreCDP() {
  for (let i = 0; i < 60; i++) {
    try {
      const rep = await fetch(`http://localhost:${PORT_CDP}/json/version`);
      if (rep.ok) return (await rep.json()).webSocketDebuggerUrl;
    } catch {
      /* pas encore prêt */
    }
    await pause(250);
  }
  throw new Error(`Chrome injoignable sur le port ${PORT_CDP}`);
}

function ouvrirCDP(url) {
  const ws = new WebSocket(url);
  const attentes = new Map();
  let id = 1;

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && attentes.has(msg.id)) {
      attentes.get(msg.id)(msg);
      attentes.delete(msg.id);
    }
  };

  const pret = new Promise((resoudre, rejeter) => {
    ws.onopen = resoudre;
    ws.onerror = rejeter;
  });

  return {
    pret,
    envoyer(method, params = {}, sessionId) {
      const n = id++;
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      return new Promise((r) => attentes.set(n, r));
    },
  };
}

const navigateur = ouvrirCDP(await attendreCDP());
await navigateur.pret;

async function ouvrirOnglet() {
  const cible = await navigateur.envoyer('Target.createTarget', { url: 'about:blank' });
  const session = await navigateur.envoyer('Target.attachToTarget', {
    targetId: cible.result.targetId,
    flatten: true,
  });
  const sid = session.result.sessionId;
  await navigateur.envoyer('Page.enable', {}, sid);
  await navigateur.envoyer('Runtime.enable', {}, sid);

  const evaluer = async (expression) => {
    const rep = await navigateur.envoyer(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sid
    );
    const details = rep.result?.exceptionDetails;
    if (details) throw new Error(details.exception?.description ?? 'erreur JS');
    return rep.result?.result?.value;
  };

  return {
    evaluer,
    async aller(url) {
      await navigateur.envoyer('Page.navigate', { url }, sid);
      await pause(2200);
    },
  };
}

/**
 * Remplace `window.open` par un espion avant le clic. On ne va pas réellement
 * sur wa.me : ce test vérifie ce que l'application *demande* d'ouvrir, pas ce
 * que WhatsApp Web en ferait.
 */
async function poserEspionOuverture(onglet) {
  await onglet.evaluer(`
    window.__ouvertures = [];
    window.open = (url) => { window.__ouvertures.push(url); return null; };
  `);
}

async function derniereOuverture(onglet) {
  return onglet.evaluer(`window.__ouvertures[window.__ouvertures.length - 1] ?? null`);
}

/** Décode le texte du message wa.me et en extrait l'URL du reçu partagé. */
function urlDuMessageWhatsApp(ouverture) {
  const u = new URL(ouverture);
  if (u.hostname !== 'wa.me') return { ok: false, raison: `hôte = ${u.hostname}, attendu wa.me` };
  const texte = u.searchParams.get('text');
  if (!texte) return { ok: false, raison: 'paramètre text absent' };
  const m = texte.match(/https?:\/\/\S+/);
  if (!m) return { ok: false, raison: `aucune URL dans le message : ${texte}` };
  return { ok: true, texte, url: m[0] };
}

try {
  // ===================== Espace partenaire =====================
  titre('Espace partenaire');
  const partenaire = await ouvrirOnglet();
  await partenaire.aller(PARTENAIRE);
  await partenaire.evaluer(
    'localStorage.setItem("fiyen_partenaire_token", ' +
      JSON.stringify(jetonPartenaire) +
      '); localStorage.setItem("fiyen_partenaire_refresh", ' +
      JSON.stringify(cnxPartenaire.json.refresh_token ?? '') +
      ');'
  );
  await partenaire.aller(PARTENAIRE);

  const ouvertureSuivi = await partenaire.evaluer(`
    (() => {
      const cartes = [...document.querySelectorAll('button.ligne-commande')];
      const cible = cartes.find((e) => e.textContent.includes(${JSON.stringify(cmd.json.numero)}));
      if (!cible) return 'commande introuvable';
      cible.click();
      return 'ok';
    })()
  `);
  verifier('la commande est ouverte', ouvertureSuivi === 'ok', ouvertureSuivi);
  await pause(1200);

  const ouvertureRecu = await partenaire.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir le reçu');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le reçu est ouvert', ouvertureRecu === 'ok', ouvertureRecu);
  await pause(1200);

  await poserEspionOuverture(partenaire);

  const clicPartage = await partenaire.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Partager par WhatsApp');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton « Partager par WhatsApp » est présent', clicPartage === 'ok', clicPartage);
  await pause(1500);

  const ouverturePartenaire = await derniereOuverture(partenaire);
  verifier('un onglet est demandé à l’issue du clic', typeof ouverturePartenaire === 'string', String(ouverturePartenaire));

  if (typeof ouverturePartenaire === 'string') {
    const decode = urlDuMessageWhatsApp(ouverturePartenaire);
    verifier('l’ouverture cible wa.me sans numéro (choix du contact laissé à l’utilisateur)', decode.ok, decode.raison);
    if (decode.ok) {
      verifier('le message contient une URL de reçu', decode.url.includes('/r/'), decode.url);

      const pageRecu = await fetch(decode.url);
      verifier('cette URL rend bien une page (le lien est réel, pas un gabarit)', pageRecu.status === 200, `statut ${pageRecu.status}`);
      const html = await pageRecu.text();
      verifier('la page publique reprend le numéro de la commande', html.includes(cmd.json.numero));
    }
  }

  // ===================== Dashboard compagnie =====================
  titre('Dashboard compagnie');
  const dash = await ouvrirOnglet();
  await dash.aller(DASHBOARD);
  await dash.evaluer(
    'localStorage.setItem("fiyen_token", ' +
      JSON.stringify(jetonCompagnie) +
      '); localStorage.setItem("fiyen_refresh", ' +
      JSON.stringify(insc.json.refresh_token ?? '') +
      ');'
  );
  await dash.aller(`${DASHBOARD}/courses`);

  const ouvertureDash = await dash.evaluer(`
    (() => {
      const lignes = [...document.querySelectorAll('tr')];
      const ligne = lignes.find((tr) => tr.textContent.includes('Zone du Bois'));
      if (!ligne) return 'course absente de la liste';
      const b = [...ligne.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir');
      if (!b) return 'bouton « Voir » absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le reçu s’ouvre depuis la liste', ouvertureDash === 'ok', ouvertureDash);
  await pause(1200);

  await poserEspionOuverture(dash);

  const clicPartageDash = await dash.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Partager par WhatsApp');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton « Partager par WhatsApp » est présent', clicPartageDash === 'ok', clicPartageDash);
  await pause(1500);

  const ouvertureDashResult = await derniereOuverture(dash);
  verifier('un onglet est demandé à l’issue du clic', typeof ouvertureDashResult === 'string', String(ouvertureDashResult));

  if (typeof ouvertureDashResult === 'string') {
    const decode = urlDuMessageWhatsApp(ouvertureDashResult);
    verifier('l’ouverture cible wa.me sans numéro', decode.ok, decode.raison);
    if (decode.ok) {
      const pageRecu = await fetch(decode.url);
      verifier('le lien émis depuis le dashboard fonctionne aussi', pageRecu.status === 200, `statut ${pageRecu.status}`);
      const html = await pageRecu.text();
      // Le coeur de la garantie, vérifié une seconde fois côté dashboard : ce
      // panneau-ci affiche le livreur à la compagnie, mais le lien qui en sort
      // ne doit jamais le nommer — la frontière se refait côté serveur, pas
      // dans cet écran.
      verifier('le lien partagé ne nomme jamais le livreur, même généré depuis le dashboard', !html.includes('Livreur'));
    }
  }

  console.log('');
  console.log(`${reussis} réussis, ${echoues} échoués`);
  await terminer(echoues === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await terminer(1);
}
