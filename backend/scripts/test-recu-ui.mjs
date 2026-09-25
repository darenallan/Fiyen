// Vérifie le reçu **à l'écran et sur le papier**, dans un vrai navigateur.
//
//   node backend/scripts/test-recu-ui.mjs
//
// Ce que les tests Go ne peuvent pas voir : ce que le CSS d'impression laisse
// passer. Une règle `@media print` mal ciblée n'échoue nulle part — elle sort
// simplement une navigation basse et un bouton « Imprimer » sur la feuille, ou
// pire, laisse visible ce qui devait disparaître. Le seul juge est le moteur de
// rendu, en média « print ».
//
// Exige l'API sur :8090, app-partenaire sur :5177 et le dashboard sur :5173.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.API_URL || 'http://localhost:8090';
const PARTENAIRE = process.env.URL_PARTENAIRE || 'http://localhost:5177';
const DASHBOARD = process.env.URL_DASHBOARD || 'http://localhost:5173';
const PORT_CDP = 9336;

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

// --- Décor, monté par l'API ------------------------------------------------

const NOM_LIVREUR = 'Salif Traoré';
const suffixe = uniq();

const telCompagnie = tel();
const insc = await appel('POST', '/api/auth/register-compagnie', {
  corps: {
    nom_compagnie: `Reçu UI ${suffixe}`,
    telephone: telCompagnie,
    mot_de_passe: 'motdepasse123',
  },
});
if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
const jetonCompagnie = insc.json.token;

const telLivreur = tel();
const liv = await appel('POST', '/api/livreurs/', {
  jeton: jetonCompagnie,
  corps: { nom: NOM_LIVREUR, telephone: telLivreur, mot_de_passe: 'motdepasse123' },
});
if (liv.statut !== 201) throw new Error(`livreur: ${liv.statut}`);

const cnxLivreur = await appel('POST', '/api/auth/login', {
  corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' },
});
const jetonLivreur = cnxLivreur.json.token;
await appel('PATCH', '/api/livreurs/me/statut', {
  jeton: jetonLivreur,
  corps: { statut: 'dispo' },
});

const telPartenaire = tel();
const part = await appel('POST', '/api/partenaires/', {
  jeton: jetonCompagnie,
  corps: {
    nom: `Boulangerie ${suffixe}`,
    repere: 'Marché de Rood Woko',
    telephone: telPartenaire,
    mot_de_passe: 'motdepasse123',
  },
});
if (part.statut !== 201) throw new Error(`partenaire: ${part.statut}`);

const cnxPartenaire = await appel('POST', '/api/auth/login', {
  corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
});
const jetonPartenaire = cnxPartenaire.json.token;

const telDestinataire = tel();
const cmd = await appel('POST', '/api/commandes/', {
  jeton: jetonPartenaire,
  corps: {
    destinataire_nom: 'Awa Ouédraogo',
    destinataire_telephone: telDestinataire,
    adresse_depart: 'Boulangerie, avenue Kwamé N’Krumah',
    repere_depart: 'en face de la pharmacie',
    adresse_arrivee: 'Zone du Bois, rue 15.42',
    repere_arrivee: 'portail vert',
    description_colis: 'Deux baguettes et un gâteau',
    instructions: 'Appeler en arrivant au portail',
  },
});
if (cmd.statut !== 201) throw new Error(`commande: ${cmd.statut} ${JSON.stringify(cmd.json)}`);

const assign = await appel('PATCH', `/api/courses/${cmd.json.id}/assigner`, {
  jeton: jetonCompagnie,
  corps: { livreur_id: liv.json.id },
});
if (assign.statut !== 200) throw new Error(`assignation: ${assign.statut}`);
for (const statut of ['recuperee', 'en_route', 'livree']) {
  const r = await appel('PATCH', `/api/courses/${cmd.json.id}/statut`, {
    jeton: jetonLivreur,
    corps: { statut },
  });
  if (r.statut !== 200) throw new Error(`statut ${statut}: ${r.statut}`);
}

// Une preuve est déposée : sans elle, les assertions d'impression ne diraient
// rien du bloc le plus lourd du document — celui qui porte une image et qui
// peut faire déborder la page.
// Signature de démonstration : un vrai PNG, produit par
// `scripts/outils/generer-signature.mjs`. Un échantillon écrit à la main
// passerait la comparaison d'octets du test d'API et serait pourtant
// refusé par le navigateur — c'est arrivé.
const SIGNATURE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAIwAAAAsCAYAAAC33FDQAAAA+0lEQVR4nO3YQXLCQAwEQF7B' +
  'I3Ll/28jVw44WRstO7K7q3yDlRAjyvh2AwAAAODV/fHz3LpW90aYv8IiNF/SZfgjYUnt/TS6' +
  'DH+0l7S+hyQP/lWXjd3bQ0rfQ9KH/67P0det6PuT2imz3nTWjT36nk9V1Fw96002tl5VvbjQ' +
  '2Nh6lXWiAmNj6804PyIwV9/YGX0n3ONNc/WNnXlu5ZkRbGz92cJy4MxuG9vlV3YZG1tfx31L' +
  'wPld/oEJS0CdLs94hCWgXspT5P/qXyIsNnZfDyPXqj6nsbH7CYuNPaRLnyWSPlzHsJxSty+h' +
  'S5+n1SksBBAWAAAAAAAAYMQvs/8ZxwxXHHYAAAAASUVORK5CYII=';

const preuve = await appel('POST', `/api/courses/${cmd.json.id}/preuve`, {
  jeton: jetonLivreur,
  corps: {
    nom_receptionnaire: 'Fatimata Sawadogo',
    type_media: 'signature',
    media_mime: 'image/png',
    media_base64: SIGNATURE_PNG,
    capture_le: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
});
if (preuve.statut !== 204) {
  throw new Error(`preuve: ${preuve.statut} ${JSON.stringify(preuve.json)}`);
}

console.log(`Commande ${cmd.json.numero} livrée, livreur « ${NOM_LIVREUR} », preuve déposée.`);

// --- Navigateur ------------------------------------------------------------

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), `fiyen-recu-ui-${Date.now()}`);

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

/**
 * Un onglet par application : le dashboard et l'espace partenaire n'ont ni le
 * même occupant ni la même origine, et les mélanger ferait porter au second la
 * session du premier.
 */
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
    async media(nom) {
      await navigateur.envoyer('Emulation.setEmulatedMedia', { media: nom }, sid);
      await pause(400);
    },
    async capturer(fichier) {
      const vue = await navigateur.envoyer(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true },
        sid
      );
      if (vue.result?.data) {
        fs.writeFileSync(path.join(os.tmpdir(), fichier), Buffer.from(vue.result.data, 'base64'));
      }
    },
    async pdf() {
      const rep = await navigateur.envoyer(
        'Page.printToPDF',
        { printBackground: false, preferCSSPageSize: false },
        sid
      );
      return rep.result?.data;
    },
    visible(selecteur) {
      return evaluer(
        '(() => {' +
          '  const e = document.querySelector(' + JSON.stringify(selecteur) + ');' +
          '  if (!e) return "absent";' +
          '  const s = getComputedStyle(e);' +
          '  return (s.visibility !== "hidden" && s.display !== "none") ? "visible" : "masque";' +
          '})()'
      );
    },
  };
}

/** Ce qu'un reçu doit dire, quelle que soit l'application qui l'affiche. */
async function verifierContenuCommun(onglet, texte) {
  verifier('il porte le numéro court', texte.includes(cmd.json.numero), texte.slice(0, 120));
  // Comparaison insensible à la casse : le sur-titre est en petites capitales
  // par le CSS, et `innerText` rend le texte tel qu'il s'affiche.
  verifier(
    'il porte le titre « Reçu de livraison »',
    texte.toLowerCase().includes('reçu de livraison'),
    texte.slice(0, 160)
  );
  verifier('il nomme le destinataire', texte.includes('Awa Ouédraogo'));
  verifier('il reprend le repère de retrait', texte.includes('en face de la pharmacie'));
  verifier('il retrace la livraison', texte.includes('Livré'));
  verifier('il porte la preuve de remise', texte.includes('Fatimata Sawadogo'), texte.slice(0, 400));
  verifier(
    'aucun numéro de téléphone',
    !/\+?226\s?\d{7,8}/.test(texte),
    'un numéro apparaît sur le document'
  );
  // Le barème en base est un abonnement plus une commission : il n'existe aucun
  // tarif par course à afficher, et un chiffre inventé sur un justificatif
  // serait pire qu'aucun.
  for (const mot of ['FCFA', 'Total', 'Montant', 'Prix']) {
    verifier(`aucune mention « ${mot} »`, !texte.includes(mot));
  }
}

/**
 * Bascule en média « print » et juge la feuille, pas l'écran.
 *
 * La garantie utile n'est pas « ces éléments-là disparaissent » — une liste
 * d'exceptions se périme dès qu'on ajoute un bandeau au-dessus du reçu. C'est
 * « rien d'autre que le reçu ne s'imprime », vérifié sur l'arbre entier.
 */
async function verifierImpression(onglet, masques, nomPdf) {
  await onglet.media('print');

  verifier('le document reste visible', (await onglet.visible('.recu')) === 'visible');
  for (const [libelle, selecteur] of masques) {
    const etat = await onglet.visible(selecteur);
    verifier(libelle, etat !== 'visible', etat);
  }

  const imagePreuve = await onglet.evaluer(`
    (() => {
      const img = document.querySelector('.recu-preuve-media');
      if (!img) return 'absente du document';
      // naturalWidth à 0 alors que complete est vrai : l'image est arrivée
      // mais le navigateur a refusé de la décoder. Un octet faux suffit.
      if (!img.complete || img.naturalWidth === 0) return 'chargement échoué';
      return 'ok';
    })()
  `);
  // L'image est récupérée à part, avec un en-tête d'authentification : une URL
  // d'objet mal révoquée ou un 401 se verrait ici, et nulle part ailleurs.
  verifier('la signature est chargée sur la feuille', imagePreuve === 'ok', String(imagePreuve));

  const intrus = await onglet.evaluer(`
    (() => {
      const visibles = [...document.body.querySelectorAll('*')].filter((e) => {
        if (e.closest('.recu')) return false;
        if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE') return false;
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || s.display === 'none') return false;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return (e.innerText || '').trim().length > 0;
      });
      return visibles
        .map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''))
        .slice(0, 6);
    })()
  `);
  verifier(
    'rien hors du reçu ne reste visible',
    Array.isArray(intrus) && intrus.length === 0,
    Array.isArray(intrus) ? intrus.join(', ') : String(intrus)
  );

  // Le PDF est la sortie réelle du chemin d'impression : si un sélecteur mal
  // ciblé laissait passer la navigation, elle serait dans ce fichier.
  const donnees = await onglet.pdf();
  verifier('l’impression produit un PDF', typeof donnees === 'string' && donnees.length > 1000);

  if (donnees) {
    const chemin = path.join(os.tmpdir(), nomPdf);
    fs.writeFileSync(chemin, Buffer.from(donnees, 'base64'));
    // Une page, et une seule. Un reçu qui déborde ne lève aucune erreur : il
    // sort suivi d'une feuille à moitié vide, ce que personne ne remarque
    // avant d'avoir imprimé une pile.
    const brut = Buffer.from(donnees, 'base64').toString('latin1');
    const pages = (brut.match(/\/Type\s*\/Page[^s]/g) || []).length;
    verifier('le reçu tient sur une seule page', pages === 1, `${pages} page(s)`);
    console.log(`  PDF : ${chemin}`);
  }

  await onglet.media('screen');
}

function bilanEtSortie(code) {
  console.log('');
  console.log(`${reussis} réussis, ${echoues} échoués`);
  return terminer(code);
}

try {
  // ===================== Espace partenaire =====================
  //
  // La session est posée directement : ce script teste le rendu du reçu, pas
  // l'écran de connexion — que `test-masquage-ui.mjs` parcourt déjà.
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

  titre('Espace partenaire — parcours jusqu’au reçu');
  const ouvertureSuivi = await partenaire.evaluer(
    '(() => {' +
      // Le bouton lui-même, pas un ancêtre : le li qui l'entoure porte le même
      // texte mais aucun gestionnaire de clic.
      '  const cartes = [...document.querySelectorAll("button.ligne-commande")];' +
      '  const cible = cartes.find((e) => e.textContent.includes(' +
      JSON.stringify(cmd.json.numero) +
      '));' +
      '  if (!cible) return "commande introuvable dans la liste";' +
      '  cible.click();' +
      '  return "ok";' +
      '})()'
  );
  verifier('la commande est visible dans la liste', ouvertureSuivi === 'ok', ouvertureSuivi);
  await pause(1500);

  const ouvertureRecu = await partenaire.evaluer(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Voir le reçu');
      if (!b) return 'bouton absent';
      b.click();
      return 'ok';
    })()
  `);
  verifier('le bouton « Voir le reçu » est présent', ouvertureRecu === 'ok', ouvertureRecu);
  await pause(1800);

  titre('Espace partenaire — ce que le reçu montre');
  const textePartenaire = await partenaire.evaluer(
    "document.querySelector('.recu')?.innerText ?? ''"
  );
  verifier('le document est rendu', textePartenaire.length > 0, 'aucun élément .recu');
  if (textePartenaire.length === 0) {
    // Sans document, tout ce qui suit passerait au vert : un écran vide ne
    // contient ni numéro de téléphone, ni nom de livreur, ni montant.
    console.log('  (arret : les garanties suivantes ne prouveraient rien sur un ecran vide)');
    await bilanEtSortie(1);
  }
  await verifierContenuCommun(partenaire, textePartenaire);
  // Le cœur du produit : le partenaire ne connaît jamais son livreur, sur
  // papier comme à l'écran.
  verifier(
    'aucune trace du nom du livreur',
    !textePartenaire.includes('Salif'),
    'le livreur apparaît à l’écran'
  );

  await partenaire.capturer(`fiyen-recu-${cmd.json.numero}-partenaire.png`);

  titre('Espace partenaire — en média « print »');
  await verifierImpression(
    partenaire,
    [
      ['la navigation basse disparaît', '.nav-bas'],
      ['le bouton « Imprimer » disparaît', '.barre-actions'],
      ['le lien de retour disparaît', '.sans-impression'],
    ],
    `fiyen-recu-${cmd.json.numero}-partenaire.pdf`
  );

  // ===================== Dashboard compagnie =====================
  //
  // Le reçu y vit dans un <dialog> ouvert en `showModal()`, donc dans le *top
  // layer* : c'est le cas où une règle d'impression écrite pour un flux normal
  // se comporte autrement. Le vérifier de tête ne suffit pas.
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

  titre('Dashboard — ouverture du reçu');
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
  verifier('le bouton « Voir » ouvre le reçu', ouvertureDash === 'ok', ouvertureDash);
  await pause(1800);

  titre('Dashboard — ce que le reçu montre');
  const texteDash = await dash.evaluer("document.querySelector('.recu')?.innerText ?? ''");
  verifier('le document est rendu', texteDash.length > 0, 'aucun élément .recu');
  if (texteDash.length === 0) await bilanEtSortie(1);

  await verifierContenuCommun(dash, texteDash);
  // Le contrôle inverse du précédent : ici le livreur **doit** apparaître. Sans
  // lui, un serveur qui ne renverrait jamais le nom passerait la garantie de
  // masquage sans qu'elle prouve quoi que ce soit.
  verifier('le livreur est nommé', texteDash.includes('Salif Traoré'), texteDash.slice(0, 200));
  verifier('l’entreprise cliente est nommée', texteDash.includes('Boulangerie'), texteDash.slice(0, 200));

  const modale = await dash.evaluer(
    "document.querySelector('dialog.panneau-recu')?.open === true"
  );
  verifier('le reçu est bien dans une boîte modale', modale === true, String(modale));

  await dash.capturer(`fiyen-recu-${cmd.json.numero}-dashboard.png`);

  titre('Dashboard — en média « print »');
  await verifierImpression(
    dash,
    [
      ['la barre latérale disparaît', 'nav'],
      ['les boutons de la boîte disparaissent', '.barre-recu'],
    ],
    `fiyen-recu-${cmd.json.numero}-dashboard.pdf`
  );

  await bilanEtSortie(echoues === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await terminer(1);
}
