// Vérifie dans un vrai navigateur ce que le masquage garantit **à l'écran** :
// aucun numéro affiché, aucune identité révélée, aucun bouton d'appel, et une
// conversation qui circule effectivement entre les deux parties.
//
// Les tests Go couvrent le protocole ; ceux-ci couvrent ce que l'utilisateur
// voit. Les deux sont nécessaires : un backend irréprochable ne garantit rien
// si l'interface affiche le numéro qu'elle a reçu par ailleurs.
//
// Prérequis — tout doit tourner :
//   backend/  : docker compose up -d && go run ./cmd/api     (:8090)
//   app-livreur/ : npm run dev                                (:5175)
//   app-client/  : npm run dev                                (:5176)
//   node backend/scripts/seed-demo.mjs --reset
//
// Puis :  node backend/scripts/test-masquage-ui.mjs

import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:8090';
const URL_CLIENT = process.env.URL_CLIENT || 'http://localhost:5176';
const URL_LIVREUR = process.env.URL_LIVREUR || 'http://localhost:5175';
const PORT_CDP = 9334;

// Jeu de démonstration : la cliente et le livreur de la course assignée.
const CLIENTE = { telephone: '+22670001003', motDePasse: 'motdepasse123', nom: 'Awa' };
const LIVREUR = { telephone: '+22670001001', motDePasse: 'motdepasse123', nom: 'Salif' };

let reussis = 0;
let echoues = 0;

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis++;
    console.log(`  ok    ${libelle}`);
  } else {
    echoues++;
    console.log(`  ECHEC ${libelle}${detail ? `\n          → ${detail}` : ''}`);
  }
}

function titre(texte) {
  console.log(`\n${texte}`);
}

// --- Contrôles préalables -------------------------------------------------

async function joignable(url) {
  try {
    const rep = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return rep.status < 500;
  } catch {
    return false;
  }
}

const services = [
  ['API', `${API}/health`],
  ['app-client', URL_CLIENT],
  ['app-livreur', URL_LIVREUR],
];

const absents = [];
for (const [nom, url] of services) {
  if (!(await joignable(url))) absents.push(`${nom} (${url})`);
}
if (absents.length) {
  console.error(`\nServices injoignables : ${absents.join(', ')}`);
  console.error('Voir les prérequis en tête de ce fichier.\n');
  process.exit(1);
}

// --- Pilotage du navigateur ----------------------------------------------

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-masquage-ui-${Date.now()}`);

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
    // Windows garde le profil verrouillé le temps que Chrome relâche ses
    // fichiers : effacer trop tôt lève EPERM et masquerait le résultat du test.
    await pause(1200);
    try {
      fs.rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } catch {
      // profil résiduel dans le dossier temporaire : sans conséquence
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

/** Connexion CDP minimale : un id croissant, une table d'attentes. */
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
    ws,
    envoyer(method, params = {}, sessionId) {
      const n = id++;
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      return new Promise((r) => attentes.set(n, r));
    },
  };
}

const navigateur = ouvrirCDP(await attendreCDP());
await navigateur.pret;

/**
 * Chaque partie a son propre contexte de navigateur : sans cela le client et le
 * livreur partageraient le même localStorage, et la seconde connexion écraserait
 * la première.
 */
async function ouvrirOnglet(url) {
  const ctx = await navigateur.envoyer('Target.createBrowserContext');
  const cible = await navigateur.envoyer('Target.createTarget', {
    url: 'about:blank',
    browserContextId: ctx.result.browserContextId,
  });
  const session = await navigateur.envoyer('Target.attachToTarget', {
    targetId: cible.result.targetId,
    flatten: true,
  });
  const sid = session.result.sessionId;

  await navigateur.envoyer('Page.enable', {}, sid);
  await navigateur.envoyer('Runtime.enable', {}, sid);
  await navigateur.envoyer('Page.navigate', { url }, sid);
  await pause(2500);

  return {
    async evaluer(expression) {
      const rep = await navigateur.envoyer(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sid
      );
      const details = rep.result?.exceptionDetails;
      if (details) throw new Error(details.exception?.description ?? 'erreur JS');
      return rep.result?.result?.value;
    },
  };
}

/** Remplit le formulaire de connexion comme le ferait un utilisateur. */
async function seConnecter(onglet, { telephone, motDePasse }) {
  await onglet.evaluer(`
    (() => {
      const champs = [...document.querySelectorAll('input')];
      const poser = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const tel = champs.find(c => c.type === 'tel') ?? champs[0];
      const mdp = champs.find(c => c.type === 'password') ?? champs[1];
      poser(tel, ${JSON.stringify(telephone)});
      poser(mdp, ${JSON.stringify(motDePasse)});
      document.querySelector('form').requestSubmit();
    })()
  `);
  await pause(3500);
}

const texte = (onglet) => onglet.evaluer('document.body.innerText');
const html = (onglet) => onglet.evaluer('document.documentElement.outerHTML');

/** Clique le premier bouton dont le libellé correspond, et dit s'il existait. */
async function cliquer(page, motif, attente = 1200) {
  const trouve = await page.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => ${motif}.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()
  `);
  if (trouve) await pause(attente);
  return trouve;
}

/** Écrit dans le champ de conversation et envoie. */
async function ecrire(onglet, message) {
  await onglet.evaluer(`
    (() => {
      const champ = document.querySelector('textarea, input[aria-label*="essage"], input[placeholder*="essage"]');
      if (!champ) throw new Error('champ de message introuvable');
      const proto = champ.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(champ, ${JSON.stringify(message)});
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      (champ.closest('form') ?? document.querySelector('form')).requestSubmit();
    })()
  `);
  await pause(1800);
}

// --- Ce qu'on cherche à ne pas trouver -----------------------------------

/**
 * Cherche un numéro burkinabè affiché.
 *
 * La précision compte autant que la sensibilité : une page contient des
 * horodatages, des identifiants et des montants, tous faits de chiffres. Un
 * motif trop large crierait au loup à chaque exécution, et le test finirait
 * par être ignoré — ce qui reviendrait à ne pas l'avoir.
 *
 * Deux formes seulement sont retenues :
 *   - l'indicatif +226 suivi de 8 chiffres ;
 *   - 8 chiffres isolés commençant par 5, 6 ou 7 (préfixes mobiles au Burkina),
 *     à condition de ne pas être un fragment d'un nombre plus long.
 */
function chercherNumero(contenu) {
  const trouves = [];

  // Les formes avec indicatif sont cherchées d'abord, puis retirées du texte :
  // « +226 70 00 10 03 » contient sinon aussi une forme locale, et le même
  // numéro serait compté deux fois — un rapport d'échec trompeur.
  const avecIndicatif = /\+?\s?226[\s.-]?(?:\d[\s.-]?){8}/g;
  const reste = contenu.replace(avecIndicatif, (m) => {
    trouves.push(m.trim());
    return ' '.repeat(m.length);
  });

  const local = /(?<!\d)([567](?:[\s.-]?\d){7})(?!\d)/g;
  for (const m of reste.matchAll(local)) trouves.push(m[0].trim());

  return trouves;
}

/** Suffixe unique sans chiffre, pour distinguer deux exécutions du script. */
function jeton() {
  const lettres = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: 6 }, () => lettres[Math.floor(Math.random() * 26)]).join('');
}

// --- Déroulé --------------------------------------------------------------

try {
  console.log('\nGaranties de masquage visibles à l’écran\n');

  titre('0. Auto-contrôle du détecteur de numéros');
  // Sans ce contrôle, un détecteur cassé ferait passer toutes les garanties
  // « aucun numéro à l'écran » au vert sans rien vérifier — le pire des cas :
  // un test qui rassure à tort.
  verifier(
    'un numéro avec indicatif est détecté',
    chercherNumero('appelez le +226 70 00 10 03 svp').length === 1
  );
  verifier(
    'un numéro local à 8 chiffres est détecté',
    chercherNumero('mon numero est 70001003').length === 1
  );
  verifier(
    'un horodatage n’est pas pris pour un numéro',
    chercherNumero(`commande du ${Date.now()} à 14h30`).length === 0,
    chercherNumero(`commande du ${Date.now()}`).join(', ')
  );
  verifier(
    'un identifiant UUID n’est pas pris pour un numéro',
    chercherNumero('id 3f2b1c8a-9d4e-4f1a-8b2c-1d3e5f7a9b0c').length === 0,
    chercherNumero('id 3f2b1c8a-9d4e-4f1a-8b2c-1d3e5f7a9b0c').join(', ')
  );

  // Identités réelles, connues du test mais qu'aucune interface ne doit montrer.
  const idsCourse = await (async () => {
    const rep = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telephone: LIVREUR.telephone, mot_de_passe: LIVREUR.motDePasse }),
    });
    if (!rep.ok) throw new Error(`connexion livreur impossible (${rep.status})`);
    const { token } = await rep.json();
    const charge = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    return { livreurID: charge.livreur_id };
  })();

  titre('1. Connexion des deux parties');
  const client = await ouvrirOnglet(URL_CLIENT);
  const livreur = await ouvrirOnglet(URL_LIVREUR);

  await seConnecter(client, CLIENTE);
  await seConnecter(livreur, LIVREUR);

  const texteClient = await texte(client);
  const texteLivreur = await texte(livreur);

  verifier(
    'la cliente accède à son suivi',
    !/Connexion|Créer un compte/.test(texteClient.slice(0, 200)),
    texteClient.slice(0, 120)
  );
  verifier(
    'le livreur accède à ses courses',
    !/Connexion/.test(texteLivreur.slice(0, 200)),
    texteLivreur.slice(0, 120)
  );

  titre('2. Ce que la cliente ne doit pas voir');
  const htmlClient = await html(client);

  verifier(
    'aucun numéro de téléphone à l’écran',
    chercherNumero(texteClient).length === 0,
    chercherNumero(texteClient).join(', ')
  );
  verifier(
    'le nom du livreur n’apparaît pas',
    !texteClient.includes(LIVREUR.nom) && !texteClient.includes('Traoré'),
    'le nom du livreur est affiché'
  );
  verifier(
    'l’identifiant du livreur n’est pas dans le DOM',
    !htmlClient.includes(idsCourse.livreurID),
    `livreur_id ${idsCourse.livreurID} présent dans la page`
  );
  verifier(
    'aucun bouton d’appel',
    !/Appeler|Téléphoner|tel:/i.test(htmlClient),
    'un bouton d’appel contredirait la garantie de masquage'
  );
  verifier(
    'le stockage local ne contient aucun numéro',
    chercherNumero(await client.evaluer('JSON.stringify(localStorage)')).length === 0
  );

  titre('3. Ce que le livreur ne doit pas voir');
  const htmlLivreur = await html(livreur);

  verifier(
    'aucun numéro de téléphone à l’écran',
    chercherNumero(texteLivreur).length === 0,
    chercherNumero(texteLivreur).join(', ')
  );
  verifier(
    'aucun bouton d’appel',
    !/Appeler|Téléphoner|tel:/i.test(htmlLivreur),
    'un bouton d’appel contredirait la garantie de masquage'
  );

  titre('4. La conversation circule');

  // Le bouton « Contacter le client » vit sur l'onglet Courses, pas sur
  // l'onglet d'accueil : il faut naviguer comme le ferait le livreur.
  verifier('le livreur peut ouvrir son onglet Courses', await cliquer(livreur, /^Courses/));
  verifier(
    'le livreur peut ouvrir le canal de contact',
    await cliquer(livreur, /Contacter/i, 2200)
  );

  const messageClient = `bonjour depuis le test client ${jeton()}`;
  await ecrire(client, messageClient);

  const recuParLivreur = await texte(livreur);
  verifier(
    'le message de la cliente parvient au livreur',
    recuParLivreur.includes(messageClient),
    'message non reçu côté livreur'
  );

  const messageLivreur = `bien recu depuis le test livreur ${jeton()}`;
  await ecrire(livreur, messageLivreur);
  await pause(1200);

  const recuParClient = await texte(client);
  verifier(
    'la réponse du livreur parvient à la cliente',
    recuParClient.includes(messageLivreur),
    'message non reçu côté client'
  );
  verifier(
    'la conversation reste anonyme après échange',
    !recuParClient.includes(LIVREUR.nom) && !recuParClient.includes('Traoré'),
    'le nom du livreur apparaît dans la conversation'
  );
  verifier(
    'aucun numéro n’apparaît après échange',
    chercherNumero(recuParClient).length === 0,
    chercherNumero(recuParClient).join(', ')
  );

  titre('5. Ce que l’interface promet à l’utilisateur');

  // La promesse est affichée dans l'espace de confidentialité de chaque app.
  await cliquer(client, /^Profil/);
  verifier(
    'la cliente est informée que son numéro reste masqué',
    /jamais communiqué/i.test(await texte(client)),
    'la promesse de masquage n’est pas affichée'
  );

  await cliquer(livreur, /^Profil/);
  verifier(
    'le livreur est informé de la même garantie',
    /jamais communiqué/i.test(await texte(livreur)),
    'la promesse de masquage n’est pas affichée'
  );
} catch (err) {
  echoues++;
  console.error(`\n  ECHEC inattendu : ${err.message}`);
} finally {
  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  await terminer(echoues === 0 ? 0 : 1);
}
