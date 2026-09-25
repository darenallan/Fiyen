// Vérifie le reçu de bout en bout, contre l'API réelle : ce que la compagnie
// y lit, ce que le partenaire n'y lit pas, et ce qui n'y figure pour personne.
//
//   node backend/scripts/test-recu.mjs
//
// Les tests Go couvrent déjà les garanties une par une. Ce script sert à autre
// chose : parcourir une course jusqu'à « livrée » comme un vrai usage, et
// constater que le document imprimé raconte ce parcours. Un reçu correct sur
// une course figée ne prouve pas grand-chose.
//
// Ce script cree plusieurs comptes : le groupe /api/auth est limite a 10
// requetes par minute et par IP. Enchainer deux scripts de test sans pause
// declenche des 429 qui ressemblent a des bugs. Espacer d'une minute.

const API = process.env.API_URL || 'http://localhost:8090';

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

async function principal() {
  const suffixe = uniq();

  // --- Décor : une compagnie, son livreur, son partenaire ---------------
  const telCompagnie = tel();
  const insc = await appel('POST', '/api/auth/register-compagnie', {
    corps: {
      nom_compagnie: `Reçu Démo ${suffixe}`,
      telephone: telCompagnie,
      mot_de_passe: 'motdepasse123',
    },
  });
  if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);
  const jetonCompagnie = insc.json.token;

  const telLivreur = tel();
  const liv = await appel('POST', '/api/livreurs/', {
    jeton: jetonCompagnie,
    corps: {
      nom: 'Salif Traoré',
      telephone: telLivreur,
      mot_de_passe: 'motdepasse123',
    },
  });
  if (liv.statut !== 201) throw new Error(`livreur: ${liv.statut}`);

  const cnxLivreur = await appel('POST', '/api/auth/login', {
    corps: { telephone: telLivreur, mot_de_passe: 'motdepasse123' },
  });
  const jetonLivreur = cnxLivreur.json.token;

  // Un livreur fraîchement créé est hors service : l'assignation le refuserait.
  const dispo = await appel('PATCH', '/api/livreurs/me/statut', {
    jeton: jetonLivreur,
    corps: { statut: 'dispo' },
  });
  if (dispo.statut !== 200) throw new Error(`mise en service: ${dispo.statut} ${JSON.stringify(dispo.json)}`);

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

  // --- La commande, puis son parcours complet ---------------------------
  const cmd = await appel('POST', '/api/commandes/', {
    jeton: jetonPartenaire,
    corps: {
      destinataire_nom: 'Awa Ouédraogo',
      destinataire_telephone: tel(),
      adresse_depart: 'Boulangerie, avenue Kwamé N’Krumah',
      repere_depart: 'en face de la pharmacie',
      adresse_arrivee: 'Zone du Bois, rue 15.42',
      repere_arrivee: 'portail vert',
      description_colis: 'Deux baguettes et un gâteau',
      instructions: 'Appeler en arrivant au portail',
    },
  });
  if (cmd.statut !== 201) throw new Error(`commande: ${cmd.statut} ${JSON.stringify(cmd.json)}`);
  const courseID = cmd.json.id;

  titre('Le reçu existe avant la livraison');
  const avant = await appel('GET', `/api/commandes/${courseID}/recu`, { jeton: jetonPartenaire });
  verifier('le partenaire obtient un reçu dès la création', avant.statut === 200, `statut ${avant.statut}`);
  verifier(
    'il porte le numéro court de la commande',
    avant.json?.numero === cmd.json.numero,
    `${avant.json?.numero} ≠ ${cmd.json.numero}`
  );
  verifier(
    'son déroulé contient déjà la création',
    (avant.json?.journal ?? []).some((e) => e.type === 'creee'),
    JSON.stringify(avant.json?.journal)
  );

  const assign = await appel('PATCH', `/api/courses/${courseID}/assigner`, {
    jeton: jetonCompagnie,
    corps: { livreur_id: liv.json.id },
  });
  if (assign.statut !== 200) {
    throw new Error(`assignation: ${assign.statut} ${JSON.stringify(assign.json)}`);
  }
  for (const statut of ['recuperee', 'en_route', 'livree']) {
    const r = await appel('PATCH', `/api/courses/${courseID}/statut`, {
      jeton: jetonLivreur,
      corps: { statut },
    });
    if (r.statut !== 200) throw new Error(`statut ${statut}: ${r.statut} ${JSON.stringify(r.json)}`);
  }

  // --- La preuve de remise -----------------------------------------------
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  titre('Dépôt de la preuve');
  const depot = await appel('POST', `/api/courses/${courseID}/preuve`, {
    jeton: jetonLivreur,
    corps: {
      nom_receptionnaire: 'Fatimata Sawadogo',
      type_media: 'signature',
      media_mime: 'image/png',
      media_base64: PNG,
      capture_le: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
  });
  verifier('le livreur assigné peut déposer', depot.statut === 204, `statut ${depot.statut}`);

  // Une pièce ne se remplace pas : un second envoi est refusé, pas appliqué en
  // silence.
  const rejeu = await appel('POST', `/api/courses/${courseID}/preuve`, {
    jeton: jetonLivreur,
    corps: { nom_receptionnaire: 'Quelqu’un d’autre' },
  });
  verifier('un second dépôt est refusé', rejeu.statut === 409, `statut ${rejeu.statut}`);

  const fiche = await appel('GET', `/api/courses/${courseID}/preuve`, { jeton: jetonCompagnie });
  verifier('la compagnie lit la preuve', fiche.statut === 200, `statut ${fiche.statut}`);
  verifier(
    'le nom du réceptionnaire est conservé',
    fiche.json?.nom_receptionnaire === 'Fatimata Sawadogo',
    fiche.json?.nom_receptionnaire
  );
  // L'heure de la porte, pas celle de l'envoi : sur un réseau qui vacille, la
  // preuve arrive parfois longtemps après la remise.
  verifier(
    'capture_le précède recue_le',
    new Date(fiche.json?.capture_le) < new Date(fiche.json?.recue_le),
    `${fiche.json?.capture_le} / ${fiche.json?.recue_le}`
  );
  verifier(
    'la fiche ne transporte pas l’image',
    !('media_base64' in (fiche.json ?? {})),
    'l’image voyage avec la fiche'
  );

  const media = await fetch(`${API}/api/courses/${courseID}/preuve/media`, {
    headers: { Authorization: `Bearer ${jetonCompagnie}` },
  });
  verifier('l’image se récupère', media.status === 200, `statut ${media.status}`);
  verifier('elle est servie en image/png', media.headers.get('content-type') === 'image/png');
  verifier(
    'elle est servie avec nosniff',
    media.headers.get('x-content-type-options') === 'nosniff'
  );
  const octets = Buffer.from(await media.arrayBuffer());
  verifier(
    'elle est rendue telle quelle',
    octets.equals(Buffer.from(PNG, 'base64')),
    `${octets.length} octets`
  );

  // --- Ce que chacun lit -------------------------------------------------
  titre('Le reçu du partenaire');
  const recuP = await appel('GET', `/api/commandes/${courseID}/recu`, { jeton: jetonPartenaire });
  verifier('est lisible', recuP.statut === 200, `statut ${recuP.statut}`);
  verifier('porte le statut « livree »', recuP.json?.statut === 'livree', recuP.json?.statut);
  verifier(
    'ne nomme pas le livreur',
    !('livreur_nom' in (recuP.json ?? {})),
    JSON.stringify(recuP.json?.livreur_nom)
  );
  verifier(
    'ne contient nulle part le nom du livreur',
    !JSON.stringify(recuP.json).includes('Salif'),
    'le nom fuit par un autre champ'
  );
  verifier('nomme la compagnie', (recuP.json?.compagnie_nom ?? '').includes('Reçu Démo'), recuP.json?.compagnie_nom);
  verifier('nomme le destinataire', recuP.json?.destinataire_nom === 'Awa Ouédraogo', recuP.json?.destinataire_nom);
  verifier('reprend le repère de retrait', recuP.json?.repere_depart === 'en face de la pharmacie', recuP.json?.repere_depart);
  verifier('reprend la description du colis', (recuP.json?.description_colis ?? '').includes('baguettes'), recuP.json?.description_colis);
  verifier(
    'retrace les cinq étapes',
    (recuP.json?.journal ?? []).length === 5,
    `${(recuP.json?.journal ?? []).length} étape(s) : ${(recuP.json?.journal ?? []).map((e) => e.type).join(', ')}`
  );
  verifier(
    'les étapes sont dans l’ordre',
    (recuP.json?.journal ?? []).map((e) => e.type).join(',') ===
      'creee,assignee,recuperee,en_route,livree',
    (recuP.json?.journal ?? []).map((e) => e.type).join(',')
  );

  verifier(
    'la preuve figure sur son reçu',
    recuP.json?.preuve?.nom_receptionnaire === 'Fatimata Sawadogo',
    JSON.stringify(recuP.json?.preuve)
  );
  verifier(
    'la preuve ne nomme pas le livreur',
    !('livreur_nom' in (recuP.json?.preuve ?? {})),
    JSON.stringify(recuP.json?.preuve?.livreur_nom)
  );

  titre('Le reçu de la compagnie');
  const recuC = await appel('GET', `/api/courses/${courseID}/recu`, { jeton: jetonCompagnie });
  verifier('est lisible', recuC.statut === 200, `statut ${recuC.statut}`);
  // La compagnie emploie ce livreur : le lui masquer n'apporterait rien et lui
  // retirerait le seul moyen de savoir qui a porté le colis.
  verifier('nomme le livreur', recuC.json?.livreur_nom === 'Salif Traoré', recuC.json?.livreur_nom);
  verifier('nomme l’entreprise cliente', (recuC.json?.partenaire_nom ?? '').includes('Boulangerie'), recuC.json?.partenaire_nom);
  verifier(
    'porte le même numéro que celui du partenaire',
    recuC.json?.numero === recuP.json?.numero,
    `${recuC.json?.numero} ≠ ${recuP.json?.numero}`
  );

  verifier(
    'la preuve y nomme le livreur',
    recuC.json?.preuve?.livreur_nom === 'Salif Traoré',
    recuC.json?.preuve?.livreur_nom
  );

  titre('Ce qui n’y figure pour personne');
  const motsMonetaires = ['montant', 'prix', 'total', 'tarif', 'commission', 'frais'];
  for (const [qui, recu] of [
    ['partenaire', recuP.json],
    ['compagnie', recuC.json],
  ]) {
    const fautifs = Object.keys(recu ?? {}).filter((c) =>
      motsMonetaires.some((m) => c.toLowerCase().includes(m))
    );
    verifier(`aucun champ monétaire côté ${qui}`, fautifs.length === 0, fautifs.join(', '));
  }
  verifier(
    'aucun numéro de téléphone en clair',
    !/\+226\s?\d{8}/.test(JSON.stringify(recuP.json) + JSON.stringify(recuC.json)),
    'un numéro apparaît dans un reçu'
  );

  titre('Cloisonnement');
  const telAutre = tel();
  const autre = await appel('POST', '/api/partenaires/', {
    jeton: jetonCompagnie,
    corps: { nom: `Voisin ${suffixe}`, telephone: telAutre, mot_de_passe: 'motdepasse123' },
  });
  const cnxAutre = await appel('POST', '/api/auth/login', {
    corps: { telephone: telAutre, mot_de_passe: 'motdepasse123' },
  });
  const refuse = await appel('GET', `/api/commandes/${courseID}/recu`, { jeton: cnxAutre.json.token });
  verifier('un autre partenaire de la même compagnie est refusé', refuse.statut === 404, `statut ${refuse.statut}`);
  if (autre.statut !== 201) verifier('création du partenaire voisin', false, `statut ${autre.statut}`);

  const mediaVoisin = await fetch(`${API}/api/courses/${courseID}/preuve/media`, {
    headers: { Authorization: `Bearer ${cnxAutre.json.token}` },
  });
  verifier(
    'un autre partenaire n’atteint pas l’image de la preuve',
    mediaVoisin.status === 404,
    `statut ${mediaVoisin.status}`
  );

  const sansJeton = await appel('GET', `/api/commandes/${courseID}/recu`);
  verifier('un anonyme est refusé', sansJeton.statut === 401, `statut ${sansJeton.statut}`);

  const parLivreur = await appel('GET', `/api/courses/${courseID}/recu`, { jeton: jetonLivreur });
  // Le livreur n'a pas de reçu à imprimer : le document est un justificatif
  // pour celui qui expédie et celui qui facture, pas pour celui qui porte.
  verifier('le livreur n’a pas accès au reçu de la compagnie', parLivreur.statut === 403, `statut ${parLivreur.statut}`);

  console.log(`\n${reussis} réussis, ${echoues} échoués`);
  process.exit(echoues === 0 ? 0 : 1);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
