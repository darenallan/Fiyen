// Vérifie le canal d'évènements du partenaire : un changement de statut lui
// parvient en direct, et la règle de visibilité s'y applique.
//
// Le point sensible est le filtrage : un collaborateur dont l'entreprise a
// choisi la visibilité « personnelle » ne doit pas voir passer les commandes
// de ses collègues. Sans ce contrôle, le canal temps réel contournerait la
// règle appliquée aux listes.
//
//   node backend/scripts/test-evenements.mjs
//
// Ce script crée plusieurs comptes : le groupe /api/auth est limité à 10
// requêtes par minute et par IP. Espacer d'une minute deux exécutions.

const API = process.env.API_URL || 'http://localhost:8090';
const WS = (process.env.API_URL || 'http://localhost:8090').replace(/^http/, 'ws');

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

async function appel(methode, chemin, { corps, jeton } = {}) {
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

/** Ouvre le canal et collecte ce qui arrive. */
function ecouter(jeton) {
  const recus = [];
  const ws = new WebSocket(`${WS}/ws/partenaire/evenements?token=${encodeURIComponent(jeton)}`);
  const pret = new Promise((resoudre, rejeter) => {
    ws.onopen = () => resoudre();
    ws.onerror = () => rejeter(new Error('connexion refusée'));
  });
  ws.onmessage = (e) => {
    try {
      recus.push(JSON.parse(e.data));
    } catch {
      /* illisible */
    }
  };
  return { ws, pret, recus };
}

const commande = (nom) => ({
  destinataire_nom: nom,
  destinataire_telephone: tel(),
  adresse_depart: 'Boutique, avenue Kwame Nkrumah',
  adresse_arrivee: 'Zone du Bois, rue 15.42',
});

async function main() {
  console.log('\nÉvènements en direct côté partenaire\n');

  const suffixe = uniq();

  // --- Décor : compagnie, livreur en service, partenaire, collaborateur ---
  const cie = await appel('POST', '/api/auth/register-compagnie', {
    corps: { nom_compagnie: `Evt ${suffixe}`, telephone: tel(), mot_de_passe: 'motdepasse123' },
  });
  if (cie.statut !== 201) throw new Error(`compagnie: ${cie.statut}`);
  const jetonCie = cie.json.token;

  const telLivreur = tel();
  await appel('POST', '/api/livreurs/', {
    jeton: jetonCie,
    corps: { nom: 'Salif Traoré', telephone: telLivreur, mot_de_passe: 'motdepasse123' },
  });
  const cnxLiv = await appel('POST', '/api/auth/login', {
    corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' },
  });
  await appel('PATCH', '/api/livreurs/me/statut', {
    jeton: cnxLiv.json.token,
    corps: { statut: 'dispo' },
  });

  const telPart = tel();
  const part = await appel('POST', '/api/partenaires/', {
    jeton: jetonCie,
    corps: { nom: `Boutique ${suffixe}`, telephone: telPart, mot_de_passe: 'motdepasse123' },
  });
  if (part.statut !== 201) throw new Error(`partenaire: ${part.statut}`);
  const partenaireID = part.json.id;

  const cnxPart = await appel('POST', '/api/auth/login', {
    corps: { telephone: telPart, mot_de_passe: 'motdepasse123' },
  });
  const jetonPart = cnxPart.json.token;

  // --- 1. Le canal fonctionne ---
  titre('1. Le partenaire reçoit ses évènements');

  const canal = ecouter(jetonPart);
  await canal.pret;
  await pause(400);

  const cmd = await appel('POST', '/api/commandes/', {
    jeton: jetonPart,
    corps: commande('Awa Ouédraogo'),
  });
  if (cmd.statut !== 201) throw new Error(`commande: ${cmd.statut}`);

  const livreurs = await appel('GET', '/api/livreurs/', { jeton: jetonCie });
  const livreur = livreurs.json.find((l) => l.statut === 'dispo');
  await appel('PATCH', `/api/courses/${cmd.json.id}/assigner`, {
    jeton: jetonCie,
    corps: { livreur_id: livreur.id },
  });

  await pause(1200);

  const assignation = canal.recus.find((e) => e.statut === 'assignee');
  verifier("l'assignation parvient au partenaire", !!assignation,
    JSON.stringify(canal.recus));
  verifier('le numéro court est transmis',
    assignation?.numero === cmd.json.numero, `${assignation?.numero} vs ${cmd.json.numero}`);
  verifier('le destinataire est nommé pour un message lisible',
    assignation?.destinataire_nom === 'Awa Ouédraogo', assignation?.destinataire_nom);

  // Le front n'a pas à savoir qui, dans l'entreprise, a passé la commande.
  verifier("l'auteur ne fuit pas vers le front",
    assignation && !('cree_par' in assignation), JSON.stringify(assignation));

  // --- 2. Le livreur avance, le partenaire suit ---
  titre('2. Chaque étape est annoncée');

  await appel('PATCH', `/api/courses/${cmd.json.id}/statut`, {
    jeton: cnxLiv.json.token,
    corps: { statut: 'recuperee' },
  });
  await pause(900);
  verifier('la récupération est annoncée',
    canal.recus.some((e) => e.statut === 'recuperee'));

  await appel('PATCH', `/api/courses/${cmd.json.id}/statut`, {
    jeton: cnxLiv.json.token,
    corps: { statut: 'en_route' },
  });
  await pause(900);
  verifier('le départ est annoncé', canal.recus.some((e) => e.statut === 'en_route'));

  await appel('PATCH', `/api/courses/${cmd.json.id}/statut`, {
    jeton: cnxLiv.json.token,
    corps: { statut: 'livree' },
  });
  await pause(900);
  verifier('la livraison est annoncée', canal.recus.some((e) => e.statut === 'livree'));

  canal.ws.close();

  // --- 3. Cloisonnement ---
  titre('3. Cloisonnement');

  const refuse = await new Promise((resoudre) => {
    const ws = new WebSocket(`${WS}/ws/partenaire/evenements?token=${encodeURIComponent(jetonCie)}`);
    let ouvert = false;
    ws.onopen = () => {
      ouvert = true;
    };
    ws.onclose = () => resoudre(true);
    ws.onerror = () => resoudre(true);
    setTimeout(() => {
      ws.close();
      resoudre(!ouvert);
    }, 2000);
  });
  verifier('la compagnie n’accède pas au canal du partenaire', refuse === true);

  const sansJeton = await new Promise((resoudre) => {
    const ws = new WebSocket(`${WS}/ws/partenaire/evenements`);
    ws.onopen = () => {
      ws.close();
      resoudre(false);
    };
    ws.onerror = () => resoudre(true);
    ws.onclose = () => resoudre(true);
  });
  verifier('le canal exige un jeton', sansJeton === true);

  // --- 4. Visibilité personnelle ---
  titre('4. Visibilité « personnelle »');

  await appel('PATCH', `/api/partenaires/${partenaireID}`, {
    jeton: jetonCie,
    corps: { visibilite_collaborateurs: 'personnelle' },
  });

  const telCollab = tel();
  const inv = await appel('POST', '/api/mon-partenaire/collaborateurs', {
    jeton: jetonPart,
    corps: { nom: 'Ibrahim Sawadogo', telephone: telCollab },
  });
  const act = await appel('POST', '/api/auth/activer-collaborateur', {
    corps: { telephone: telCollab, code: inv.json.code, mot_de_passe: 'motdepasse123' },
  });
  const jetonCollab = act.json.token;

  const canalCollab = ecouter(jetonCollab);
  await canalCollab.pret;
  await pause(400);

  // Une commande passée par le **compte principal**, pas par le collaborateur.
  const cmdPatron = await appel('POST', '/api/commandes/', {
    jeton: jetonPart,
    corps: commande('Client du patron'),
  });
  const livreurs2 = await appel('GET', '/api/livreurs/', { jeton: jetonCie });
  const dispo = livreurs2.json.find((l) => l.statut === 'dispo');
  if (dispo) {
    await appel('PATCH', `/api/courses/${cmdPatron.json.id}/assigner`, {
      jeton: jetonCie,
      corps: { livreur_id: dispo.id },
    });
  }
  await pause(1500);

  // Le cœur du point : sans filtrage, le canal temps réel contournerait la
  // règle appliquée aux listes.
  verifier(
    "un collaborateur en visibilité personnelle ne voit pas les commandes d'autrui",
    !canalCollab.recus.some((e) => e.course_id === cmdPatron.json.id),
    JSON.stringify(canalCollab.recus)
  );

  // ...mais il voit bien les siennes.
  const cmdCollab = await appel('POST', '/api/commandes/', {
    jeton: jetonCollab,
    corps: commande('Client du collaborateur'),
  });
  await appel('POST', `/api/commandes/${cmdCollab.json.id}/annuler`, { jeton: jetonCollab });
  await pause(1200);

  verifier(
    'il voit les siennes',
    canalCollab.recus.some((e) => e.course_id === cmdCollab.json.id),
    JSON.stringify(canalCollab.recus)
  );

  canalCollab.ws.close();

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exitCode = echoues === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}`);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exitCode = 1;
});
