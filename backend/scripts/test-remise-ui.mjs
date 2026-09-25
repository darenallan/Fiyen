// Vérifie la capture de la preuve **par le geste**, dans un vrai navigateur.
//
//   node backend/scripts/test-remise-ui.mjs
//
// Ce que ni les tests Go ni `test-recu.mjs` ne peuvent voir : le chemin qui va
// du doigt sur le canevas au PNG déposé en base. Une signature qui ne s'écrit
// pas — parce que le geste est pris pour un défilement, parce que le canevas
// n'a pas de contexte, parce que l'export rend une image vide — n'échoue
// nulle part. Elle arrive simplement vide, et personne ne le voit avant qu'un
// client conteste une livraison.
//
// Exige l'API sur :8090 et app-livreur sur :5175.

import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:8090';
const LIVREUR = process.env.URL_LIVREUR || 'http://localhost:5175';
const PORT_CDP = 9337;

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

// --- Décor : une course prête à être remise --------------------------------

const suffixe = uniq();

const insc = await appel('POST', '/api/auth/register-compagnie', {
  corps: {
    nom_compagnie: `Remise UI ${suffixe}`,
    telephone: tel(),
    mot_de_passe: 'motdepasse123',
  },
});
if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
const jetonCompagnie = insc.json.token;

const telLivreur = tel();
const liv = await appel('POST', '/api/livreurs/', {
  jeton: jetonCompagnie,
  corps: { nom: 'Salif Traoré', telephone: telLivreur, mot_de_passe: 'motdepasse123' },
});
if (liv.statut !== 201) throw new Error(`livreur: ${liv.statut}`);

const cnx = await appel('POST', '/api/auth/login', {
  corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' },
});
const jetonLivreur = cnx.json.token;
await appel('PATCH', '/api/livreurs/me/statut', {
  jeton: jetonLivreur,
  corps: { statut: 'dispo' },
});

// Une course créée par la compagnie exige un destinataire existant : côté
// compagnie, l'API ne le crée pas au passage comme le fait la commande d'un
// partenaire.
const dest = await appel('POST', '/api/auth/register-destinataire', {
  corps: { nom: 'Awa Ouédraogo', telephone: tel(), mot_de_passe: 'motdepasse123' },
});
if (dest.statut !== 201) throw new Error(`destinataire: ${dest.statut}`);

const course = await appel('POST', '/api/courses/', {
  jeton: jetonCompagnie,
  corps: {
    destinataire_id: dest.json.destinataire_id,
    adresse_depart: 'Marché de Rood Woko',
    adresse_arrivee: 'Zone du Bois, rue 15.42',
  },
});
if (course.statut !== 201) throw new Error(`course: ${course.statut} ${JSON.stringify(course.json)}`);
const courseID = course.json.id;

await appel('PATCH', `/api/courses/${courseID}/assigner`, {
  jeton: jetonCompagnie,
  corps: { livreur_id: liv.json.id },
});
for (const statut of ['recuperee', 'en_route']) {
  const r = await appel('PATCH', `/api/courses/${courseID}/statut`, {
    jeton: jetonLivreur,
    corps: { statut },
  });
  if (r.statut !== 200) throw new Error(`statut ${statut}: ${r.statut}`);
}

console.log(`Course ${courseID.slice(0, 8)} en route, prête à être remise.`);

// --- Navigateur ------------------------------------------------------------

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-remise-ui-${Date.now()}`);

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

const cible = await navigateur.envoyer('Target.createTarget', { url: 'about:blank' });
const session = await navigateur.envoyer('Target.attachToTarget', {
  targetId: cible.result.targetId,
  flatten: true,
});
const sid = session.result.sessionId;
await navigateur.envoyer('Page.enable', {}, sid);
await navigateur.envoyer('Runtime.enable', {}, sid);

async function evaluer(expression) {
  const rep = await navigateur.envoyer(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sid
  );
  const details = rep.result?.exceptionDetails;
  if (details) throw new Error(details.exception?.description ?? 'erreur JS');
  return rep.result?.result?.value;
}

async function aller(url) {
  await navigateur.envoyer('Page.navigate', { url }, sid);
  await pause(2500);
}

/**
 * Trace une signature avec de vrais évènements pointeur.
 *
 * `Input.dispatchMouseEvent` avec `pointerType: 'touch'` produit la même chaîne
 * d'évènements qu'un doigt : c'est le seul moyen de vérifier que le geste n'est
 * pas avalé par le défilement. Appeler la fonction de dessin directement
 * prouverait que le code sait dessiner, pas que l'utilisateur le peut.
 */
async function signer(boite) {
  const commun = { button: 'left', buttons: 1, clickCount: 1, pointerType: 'touch' };
  const point = (t) => ({
    x: Math.round(boite.x + boite.largeur * (0.1 + 0.8 * t)),
    y: Math.round(boite.y + boite.hauteur * (0.5 + 0.28 * Math.sin(t * 9))),
  });

  await navigateur.envoyer(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', ...commun, ...point(0) },
    sid
  );
  for (let i = 1; i <= 24; i++) {
    await navigateur.envoyer(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', ...commun, ...point(i / 24) },
      sid
    );
  }
  await navigateur.envoyer(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', ...commun, buttons: 0, ...point(1) },
    sid
  );
  await pause(300);
}

try {
  await aller(LIVREUR);
  await evaluer(
    'localStorage.setItem("fiyen_livreur_token", ' +
      JSON.stringify(jetonLivreur) +
      '); localStorage.setItem("fiyen_livreur_refresh", ' +
      JSON.stringify(cnx.json.refresh_token ?? '') +
      ');'
  );
  await aller(LIVREUR);

  titre('Ouverture de l’écran de remise');
  // L'application ouvre sur l'onglet « Service » ; les courses sont ailleurs.
  await evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Courses');
      if (b) b.click();
    })()
  `);
  await pause(900);

  const ouverture = await evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Colis livré');
      if (!b) return 'bouton « Colis livré » absent : ' + [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).join(' | ');
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton « Colis livré » ouvre la remise', ouverture === 'ok', String(ouverture));
  await pause(1200);

  const ecran = await evaluer(`document.body.innerText`);
  // Comparaison insensible à la casse : le libellé est en capitales par le CSS,
  // et `innerText` rend le texte tel qu'il s'affiche.
  verifier(
    'l’écran demande qui a reçu le colis',
    ecran.toLowerCase().includes('qui a reçu le colis'),
    ecran.slice(0, 200)
  );
  verifier('la signature est proposée', ecran.includes('Faire signer ici'));
  // Tout est facultatif : un écran qui ne prend pas le tracé ne doit pas
  // empêcher de clore la course.
  verifier('une remise sans image reste possible', ecran.includes('Sans image'));

  titre('Le geste');
  const boite = await evaluer(`
    (() => {
      const c = document.querySelector('.toile-signature');
      if (c) c.scrollIntoView({ block: 'center' });
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, largeur: r.width, hauteur: r.height };
    })()
  `);
  verifier('le canevas est présent et dimensionné', !!boite && boite.largeur > 50 && boite.hauteur > 50,
    JSON.stringify(boite));

  // Sans `touch-action: none`, le geste est interprété comme un défilement et
  // rien ne s'écrit. La règle ne se vérifie que par le geste.
  const touchAction = await evaluer(
    "getComputedStyle(document.querySelector('.toile-signature')).touchAction"
  );
  verifier('le canevas ne capte pas le défilement', touchAction === 'none', String(touchAction));

  if (boite) await signer(boite);

  const apresTrace = await evaluer(`document.body.innerText`);
  verifier('le tracé est reconnu', apresTrace.includes('Signature enregistrée'), apresTrace.slice(0, 300));

  const vue = await navigateur.envoyer(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    sid
  );
  if (vue.result?.data) {
    const chemin = path.join(os.tmpdir(), 'fiyen-remise.png');
    fs.writeFileSync(chemin, Buffer.from(vue.result.data, 'base64'));
    console.log(`  capture : ${chemin}`);
  }

  titre('Envoi');
  await evaluer(`
    (() => {
      const champ = document.querySelector('input[placeholder="Nom de la personne"]');
      const poseur = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      poseur.call(champ, 'Fatimata Sawadogo');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);

  const envoi = await evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim().startsWith('Confirmer'));
      if (!b) return 'bouton de confirmation absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('la confirmation part', envoi === 'ok', String(envoi));
  await pause(2500);

  titre('Ce qui est arrivé en base');
  const fiche = await appel('GET', `/api/courses/${courseID}/preuve`, { jeton: jetonCompagnie });
  verifier('une preuve existe', fiche.statut === 200, `statut ${fiche.statut}`);
  verifier('elle porte le nom saisi', fiche.json?.nom_receptionnaire === 'Fatimata Sawadogo', fiche.json?.nom_receptionnaire);
  verifier('elle est de type signature', fiche.json?.type_media === 'signature', fiche.json?.type_media);

  const media = await fetch(`${API}/api/courses/${courseID}/preuve/media`, {
    headers: { Authorization: `Bearer ${jetonCompagnie}` },
  });
  verifier('l’image se récupère', media.status === 200, `statut ${media.status}`);
  const octets = Buffer.from(await media.arrayBuffer());
  verifier('c’est bien un PNG', octets.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');

  // Le point qui compte : un canevas vide exporte un PNG parfaitement valide,
  // de quelques centaines d'octets, entièrement transparent. Comparer un
  // format ne dirait donc rien. Il faut compter les pixels réellement peints.
  const peints = compterPixelsOpaques(octets);
  verifier('le tracé contient des pixels', peints > 100, `${peints} pixel(s) opaque(s)`);

  // Et la course doit être close : la preuve ne remplace pas la livraison.
  const apres = await appel('GET', `/api/courses/${courseID}`, { jeton: jetonCompagnie });
  verifier('la course est passée à « livree »', apres.json?.statut === 'livree', apres.json?.statut);

  console.log('');
  console.log(`${reussis} réussis, ${echoues} échoués`);
  await terminer(echoues === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await terminer(1);
}

/**
 * Compte les pixels non transparents d'un PNG RGBA.
 *
 * Écrit à la main plutôt qu'avec une dépendance : le seul besoin est de
 * distinguer « quelqu'un a signé » de « le canevas était vide », et ajouter un
 * décodeur d'images au projet pour cette question serait disproportionné.
 */
function compterPixelsOpaques(png) {
  let offset = 8;
  let largeur = 0;
  let profondeur = 0;
  const morceaux = [];

  while (offset < png.length) {
    const longueur = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + longueur);
    if (type === 'IHDR') {
      largeur = data.readUInt32BE(0);
      profondeur = data[9]; // 6 = RGBA
    } else if (type === 'IDAT') {
      morceaux.push(data);
    }
    offset += 12 + longueur;
  }
  if (profondeur !== 6) return -1;

  const brut = zlib.inflateSync(Buffer.concat(morceaux));
  const parLigne = 1 + largeur * 4;
  let opaques = 0;
  for (let i = 0; i < brut.length; i += parLigne) {
    // L'octet de filtre en tête de ligne est ignoré : seuls les filtres 0 nous
    // intéressent, et `toDataURL` n'en produit pas d'autre pour un tracé simple.
    for (let x = 0; x < largeur; x++) {
      if (brut[i + 1 + x * 4 + 3] > 0) opaques++;
    }
  }
  return opaques;
}
