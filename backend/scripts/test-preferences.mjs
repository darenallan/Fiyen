// Vérifie les préférences de notification d'un partenaire.
//
// Le point qui compte : une préférence coupée doit réellement **empêcher**
// l'annonce d'arriver. Un réglage qui s'enregistre sans rien changer serait
// pire que pas de réglage du tout.
//
//   node backend/scripts/test-preferences.mjs
//
// Ce script crée plusieurs comptes : le groupe /api/auth est limité à 10
// requêtes par minute et par IP. Espacer d'une minute deux exécutions.

const API = process.env.API_URL || 'http://localhost:8090';
const WS = API.replace(/^http/, 'ws');

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

async function main() {
  console.log('\nPréférences de notification\n');

  const suffixe = uniq();

  const cie = await appel('POST', '/api/auth/register-compagnie', {
    corps: { nom_compagnie: `Pref ${suffixe}`, telephone: tel(), mot_de_passe: 'motdepasse123' },
  });
  if (cie.statut !== 201) throw new Error(`compagnie: ${cie.statut}`);
  const jetonCie = cie.json.token;

  // Deux livreurs en service : le test assigne deux courses, et un livreur
  // assigne passe en `en_course` — un seul ne suffirait pas pour la seconde.
  const jetonsLivreurs = [];
  for (const nom of ['Salif Traoré', 'Aminata Zongo']) {
    const telLivreur = tel();
    await appel('POST', '/api/livreurs/', {
      jeton: jetonCie,
      corps: { nom, telephone: telLivreur, mot_de_passe: 'motdepasse123' },
    });
    const cnx = await appel('POST', '/api/auth/login', {
      corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' },
    });
    await appel('PATCH', '/api/livreurs/me/statut', {
      jeton: cnx.json.token,
      corps: { statut: 'dispo' },
    });
    // On retient l'identifiant en même temps que le jeton : après
    // assignation, il faut agir avec le jeton du livreur *réellement* choisi,
    // pas avec le premier de la liste.
    const profil = await appel('GET', '/api/livreurs/me', { jeton: cnx.json.token });
    jetonsLivreurs.push({ id: profil.json.id, jeton: cnx.json.token });
  }
  const jetonDuLivreur = (id) => jetonsLivreurs.find((l) => l.id === id)?.jeton;

  const telPart = tel();
  const part = await appel('POST', '/api/partenaires/', {
    jeton: jetonCie,
    corps: { nom: `Boutique ${suffixe}`, telephone: telPart, mot_de_passe: 'motdepasse123' },
  });
  if (part.statut !== 201) throw new Error(`partenaire: ${part.statut}`);
  const cnxPart = await appel('POST', '/api/auth/login', {
    corps: { telephone: telPart, mot_de_passe: 'motdepasse123' },
  });
  const jetonPart = cnxPart.json.token;

  // --- 1. État par défaut ---
  titre('1. Par défaut, tout est activé');

  const liste = await appel('GET', '/api/mon-partenaire/notifications', { jeton: jetonPart });
  verifier('les préférences se lisent', liste.statut === 200, `statut ${liste.statut}`);
  verifier('les cinq étapes sont proposées', liste.json?.length === 5,
    `${liste.json?.length} étape(s)`);

  // Un partenaire qui n'a rien réglé doit être au courant de ce qui arrive à
  // ses colis : le défaut ne peut pas être le silence.
  verifier('toutes sont actives sans réglage',
    liste.json?.every((p) => p.actif === true), JSON.stringify(liste.json));
  verifier('chaque étape porte un libellé lisible',
    liste.json?.every((p) => typeof p.libelle === 'string' && p.libelle.length > 3));
  verifier('les étapes sont dans l’ordre du déroulé',
    liste.json?.[0]?.evenement === 'course_assignee' &&
      liste.json?.[3]?.evenement === 'course_livree',
    liste.json?.map((p) => p.evenement).join(', '));

  // La politique de coût ne prévoit aucun canal partenaire pour « récupérée » :
  // le réglage est affiché mais non modifiable, plutôt qu'absent.
  const recuperee = liste.json?.find((p) => p.evenement === 'course_recuperee');
  verifier('une étape sans canal prévu est signalée non modifiable',
    recuperee?.modifiable === false, JSON.stringify(recuperee));

  // --- 2. Couper une étape ---
  titre('2. Couper une étape la fait taire');

  const canal = ecouter(jetonPart);
  await canal.pret;
  await pause(400);

  const coupe = await appel('PATCH', '/api/mon-partenaire/notifications', {
    jeton: jetonPart,
    corps: { evenement: 'course_assignee', actif: false },
  });
  verifier('la coupure est enregistrée', coupe.statut === 204, `statut ${coupe.statut}`);

  const apres = await appel('GET', '/api/mon-partenaire/notifications', { jeton: jetonPart });
  verifier('elle se relit comme inactive',
    apres.json?.find((p) => p.evenement === 'course_assignee')?.actif === false);
  verifier('les autres restent actives',
    apres.json?.filter((p) => p.evenement !== 'course_assignee').every((p) => p.actif));

  // Le cœur du point : le réglage doit avoir un effet réel.
  const cmd = await appel('POST', '/api/commandes/', {
    jeton: jetonPart,
    corps: {
      destinataire_nom: 'Awa Ouédraogo',
      destinataire_telephone: tel(),
      adresse_depart: 'Boutique',
      adresse_arrivee: 'Zone du Bois',
    },
  });
  const livreurs = await appel('GET', '/api/livreurs/', { jeton: jetonCie });
  const livreur = livreurs.json.find((l) => l.statut === 'dispo');
  await appel('PATCH', `/api/courses/${cmd.json.id}/assigner`, {
    jeton: jetonCie,
    corps: { livreur_id: livreur.id },
  });
  await pause(1500);

  verifier("l'assignation coupée n'est pas annoncée",
    !canal.recus.some((e) => e.statut === 'assignee'),
    JSON.stringify(canal.recus));

  // ...alors qu'une étape restée active passe toujours.
  const avance = await appel('PATCH', `/api/courses/${cmd.json.id}/statut`, {
    jeton: jetonDuLivreur(livreur.id),
    corps: { statut: 'recuperee' },
  });
  verifier('le livreur assigné fait avancer la course', avance.statut === 200,
    `statut ${avance.statut} ${JSON.stringify(avance.json)}`);
  await pause(1200);
  verifier('une étape restée active passe toujours',
    canal.recus.some((e) => e.statut === 'recuperee'),
    JSON.stringify(canal.recus));

  // --- 3. Réactiver ---
  titre('3. Réactiver la remet en service');

  await appel('PATCH', '/api/mon-partenaire/notifications', {
    jeton: jetonPart,
    corps: { evenement: 'course_assignee', actif: true },
  });

  const cmd2 = await appel('POST', '/api/commandes/', {
    jeton: jetonPart,
    corps: {
      destinataire_nom: 'Ibrahim Sawadogo',
      destinataire_telephone: tel(),
      adresse_depart: 'Boutique',
      adresse_arrivee: 'Gounghin',
    },
  });
  const livreurs2 = await appel('GET', '/api/livreurs/', { jeton: jetonCie });
  const dispo = livreurs2.json.find((l) => l.statut === 'dispo');
  const assignation = dispo
    ? await appel('PATCH', `/api/courses/${cmd2.json.id}/assigner`, {
        jeton: jetonCie,
        corps: { livreur_id: dispo.id },
      })
    : { statut: 0 };
  verifier('un second livreur reste disponible pour la seconde course',
    assignation.statut === 200,
    dispo ? `statut ${assignation.statut}` : 'aucun livreur disponible');

  await pause(1500);
  verifier("l'assignation est de nouveau annoncée",
    canal.recus.some((e) => e.course_id === cmd2.json.id && e.statut === 'assignee'),
    JSON.stringify(canal.recus));

  canal.ws.close();

  // --- 4. Ce qui est refusé ---
  titre('4. Ce qui est refusé');

  const inconnu = await appel('PATCH', '/api/mon-partenaire/notifications', {
    jeton: jetonPart,
    corps: { evenement: 'course_teleportee', actif: false },
  });
  // Accepter n'importe quelle chaîne remplirait la table de lignes sans effet,
  // impossibles à distinguer d'une faute de frappe.
  verifier('un évènement inconnu est refusé', inconnu.statut === 400,
    `statut ${inconnu.statut}`);

  const sansActif = await appel('PATCH', '/api/mon-partenaire/notifications', {
    jeton: jetonPart,
    corps: { evenement: 'course_livree' },
  });
  verifier('le champ actif est obligatoire', sansActif.statut === 400,
    `statut ${sansActif.statut}`);

  const parCompagnie = await appel('GET', '/api/mon-partenaire/notifications', {
    jeton: jetonCie,
  });
  verifier('la compagnie n’accède pas aux préférences du partenaire',
    parCompagnie.statut === 403, `statut ${parCompagnie.statut}`);

  // --- 5. Le collaborateur lit mais ne règle pas ---
  titre('5. Le collaborateur lit, le compte principal règle');

  const telCollab = tel();
  const inv = await appel('POST', '/api/mon-partenaire/collaborateurs', {
    jeton: jetonPart,
    corps: { nom: 'Ibrahim Sawadogo', telephone: telCollab },
  });
  const act = await appel('POST', '/api/auth/activer-collaborateur', {
    corps: { telephone: telCollab, code: inv.json.code, mot_de_passe: 'motdepasse123' },
  });
  const jetonCollab = act.json.token;

  const lecture = await appel('GET', '/api/mon-partenaire/notifications', { jeton: jetonCollab });
  verifier('il constate ce que son entreprise a réglé', lecture.statut === 200,
    `statut ${lecture.statut}`);

  const ecriture = await appel('PATCH', '/api/mon-partenaire/notifications', {
    jeton: jetonCollab,
    corps: { evenement: 'course_livree', actif: false },
  });
  // Un collaborateur qui couperait les notifications rendrait ses collègues
  // sourds sans qu'ils l'aient demandé.
  verifier('mais il ne peut pas les modifier', ecriture.statut === 403,
    `statut ${ecriture.statut}`);

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exitCode = echoues === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}`);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exitCode = 1;
});
