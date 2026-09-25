// Vérifie le rejeu du trajet, de l'API au rendu sur la carte.
//
//   node backend/scripts/test-trajet-ui.mjs
//
// Ce que le rendu réel peut seul confirmer : que le bouton « Voir sur la
// carte » charge effectivement `/trajet`, et qu'un élément Leaflet apparaît
// à l'écran — pas seulement que le JSON a la bonne forme.
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
const PORT_CDP = 9339;

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

// --- Décor : une compagnie, un livreur, un partenaire, une commande livrée ---

const suffixe = uniq();

const insc = await appel('POST', '/api/auth/register-compagnie', {
  corps: { nom_compagnie: `Trajet UI ${suffixe}`, telephone: tel(), mot_de_passe: 'motdepasse123' },
});
if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
const jetonCompagnie = insc.json.token;

const telLivreur = tel();
const liv = await appel('POST', '/api/livreurs/', {
  jeton: jetonCompagnie,
  corps: { nom: 'Salif Traoré', telephone: telLivreur, mot_de_passe: 'motdepasse123' },
});
if (liv.statut !== 201) throw new Error(`livreur: ${liv.statut}`);

const cnxLivreur = await appel('POST', '/api/auth/login', {
  corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' },
});
const jetonLivreur = cnxLivreur.json.token;
await appel('PATCH', '/api/livreurs/me/statut', { jeton: jetonLivreur, corps: { statut: 'dispo' } });

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
const courseID = cmd.json.id;

const assign = await appel('PATCH', `/api/courses/${courseID}/assigner`, {
  jeton: jetonCompagnie,
  corps: { livreur_id: liv.json.id },
});
if (assign.statut !== 200) throw new Error(`assignation: ${assign.statut}`);

// La fenêtre de rejeu va de l'évènement « assignee » à l'évènement « livree »
// (voir `chargerTrajet`), tous deux horodatés au moment réel où ce script les
// déclenche. Les positions doivent donc tomber entre les deux **en temps
// réel** — un décalage artificiel de quelques minutes, calculé une fois au
// début du script, tomberait hors fenêtre puisque tout ici s'enchaîne en
// quelques secondes. `horodatage` est donc omis : le serveur y met `now()`
// (voir `EnregistrerPosition`), au moment précis du dépôt.
const points = [
  { latitude: 12.365, longitude: -1.535 },
  { latitude: 12.368, longitude: -1.528 },
  { latitude: 12.371, longitude: -1.52 },
  { latitude: 12.374, longitude: -1.512 },
];
for (const p of points) {
  const r = await appel('POST', '/api/livreurs/me/positions', {
    jeton: jetonLivreur,
    corps: { positions: [p] },
  });
  if (r.statut !== 200 && r.statut !== 204) {
    throw new Error(`dépôt de position: ${r.statut} ${JSON.stringify(r.json)}`);
  }
  // Un intervalle réel, même court : sans lui, deux dépôts pourraient tomber
  // sur le même timestamp et l'un des deux serait perdu (unicité en base sur
  // livreur + horodatage).
  await pause(150);
}

for (const statut of ['recuperee', 'en_route', 'livree']) {
  const r = await appel('PATCH', `/api/courses/${courseID}/statut`, { jeton: jetonLivreur, corps: { statut } });
  if (r.statut !== 200) throw new Error(`statut ${statut}: ${r.statut}`);
}

console.log(`Commande ${cmd.json.numero} livrée, ${points.length} positions déposées.`);

titre('API');
const trajetCompagnie = await appel('GET', `/api/courses/${courseID}/trajet`, { jeton: jetonCompagnie });
verifier('le trajet se lit côté compagnie', trajetCompagnie.statut === 200, `statut ${trajetCompagnie.statut}`);
verifier(
  'il retrouve les positions déposées',
  trajetCompagnie.json?.points?.length === points.length,
  `${trajetCompagnie.json?.points?.length} point(s), attendu ${points.length}`
);

const trajetPartenaire = await appel('GET', `/api/commandes/${courseID}/trajet`, { jeton: jetonPartenaire });
verifier('le trajet se lit aussi côté partenaire', trajetPartenaire.statut === 200, `statut ${trajetPartenaire.statut}`);
verifier(
  'les deux audiences voient le même nombre de points',
  trajetPartenaire.json?.points?.length === trajetCompagnie.json?.points?.length
);

// --- Navigateur --------------------------------------------------------

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-trajet-ui-${Date.now()}`);

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
    async capturer(fichier) {
      await evaluer(`document.querySelector('.leaflet-container')?.scrollIntoView({ block: 'center' })`);
      await pause(300);
      const vue = await navigateur.envoyer(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true },
        sid
      );
      if (vue.result?.data) {
        fs.writeFileSync(path.join(os.tmpdir(), fichier), Buffer.from(vue.result.data, 'base64'));
      }
    },
  };
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

  await partenaire.evaluer(`
    (() => {
      const cartes = [...document.querySelectorAll('button.ligne-commande')];
      const cible = cartes.find((e) => e.textContent.includes(${JSON.stringify(cmd.json.numero)}));
      cible?.click();
    })()
  `);
  await pause(1200);

  await partenaire.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir le reçu');
      b?.click();
    })()
  `);
  await pause(1200);

  const avantClic = await partenaire.evaluer(`document.querySelectorAll('.leaflet-container').length`);
  verifier('aucune carte de trajet avant le clic (chargement différé)', avantClic === 0, String(avantClic));

  const clicTrajet = await partenaire.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir sur la carte');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton « Voir sur la carte » est présent', clicTrajet === 'ok', clicTrajet);
  await pause(1500);

  const carteApresClic = await partenaire.evaluer(`document.querySelectorAll('.leaflet-container').length`);
  verifier('une carte Leaflet apparaît après le clic', carteApresClic === 1, String(carteApresClic));

  const traceVisible = await partenaire.evaluer(`
    !!document.querySelector('.leaflet-container path.leaflet-interactive')
  `);
  verifier('un tracé (polyline ou marqueur) est dessiné sur la carte', traceVisible === true, String(traceVisible));
  await partenaire.capturer('fiyen-trajet-partenaire.png');

  // Masquer referme sans tout casser.
  const clicMasquer = await partenaire.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Masquer');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton devient « Masquer » puis referme la carte', clicMasquer === 'ok', clicMasquer);
  await pause(500);
  const carteApresFermeture = await partenaire.evaluer(`document.querySelectorAll('.leaflet-container').length`);
  verifier('la carte disparaît à la fermeture', carteApresFermeture === 0, String(carteApresFermeture));

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

  await dash.evaluer(`
    (() => {
      const lignes = [...document.querySelectorAll('tr')];
      const ligne = lignes.find((tr) => tr.textContent.includes('Zone du Bois'));
      const b = ligne && [...ligne.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir');
      b?.click();
    })()
  `);
  await pause(1200);

  const clicTrajetDash = await dash.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir sur la carte');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton « Voir sur la carte » est présent (dashboard)', clicTrajetDash === 'ok', clicTrajetDash);
  await pause(1500);

  const carteDash = await dash.evaluer(`document.querySelectorAll('.leaflet-container').length`);
  verifier('une carte Leaflet apparaît dans le panneau du dashboard', carteDash === 1, String(carteDash));

  const traceDashVisible = await dash.evaluer(`
    !!document.querySelector('.leaflet-container path.leaflet-interactive')
  `);
  verifier('le tracé est dessiné côté dashboard aussi', traceDashVisible === true, String(traceDashVisible));
  await dash.capturer('fiyen-trajet-dashboard.png');

  console.log('');
  console.log(`${reussis} réussis, ${echoues} échoués`);
  await terminer(echoues === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await terminer(1);
}
