// Vérifie la commande en autonomie : un partenaire crée sa livraison, elle
// arrive dans la file de la compagnie, le carnet de destinataires se remplit
// tout seul, et le cloisonnement tient.
//
//   node backend/scripts/test-commandes.mjs
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

async function monterDecor(etiquette) {
  const suffixe = uniq();
  const telCompagnie = tel();
  const insc = await appel('POST', '/api/auth/register-compagnie', {
    corps: {
      nom_compagnie: `Cmd ${etiquette} ${suffixe}`,
      telephone: telCompagnie,
      mot_de_passe: 'motdepasse123',
    },
  });
  if (insc.statut !== 201) throw new Error(`compagnie: ${insc.statut}`);

  const telPartenaire = tel();
  const part = await appel('POST', '/api/partenaires/', {
    jeton: insc.json.token,
    corps: {
      nom: `Boutique ${suffixe}`,
      repere: 'Marché de Rood Woko',
      telephone: telPartenaire,
      mot_de_passe: 'motdepasse123',
    },
  });
  if (part.statut !== 201) throw new Error(`partenaire: ${part.statut}`);

  const cnx = await appel('POST', '/api/auth/login', {
    corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
  });

  return {
    compagnie: insc.json.token,
    partenaire: cnx.json.token,
    partenaireID: part.json.id,
    suffixe,
  };
}

const commande = (nom, telDest, extras = {}) => ({
  destinataire_nom: nom,
  destinataire_telephone: telDest,
  adresse_depart: 'Boutique, avenue Kwame Nkrumah',
  repere_depart: 'Face à la pharmacie',
  latitude_depart: 12.3714,
  longitude_depart: -1.5197,
  adresse_arrivee: 'Zone du Bois, rue 15.42',
  repere_arrivee: 'Portail vert après le château d’eau',
  latitude_arrivee: 12.3901,
  longitude_arrivee: -1.4885,
  description_colis: 'Deux cartons de tissu',
  instructions: 'Appeler en arrivant au portail',
  ...extras,
});

async function main() {
  console.log('\nCommande en autonomie\n');

  const a = await monterDecor('A');
  const b = await monterDecor('B');

  // --- Création ---
  titre('1. Le partenaire commande lui-même');

  const telDest = tel();
  const creation = await appel('POST', '/api/commandes/', {
    jeton: a.partenaire,
    corps: commande('Awa Ouédraogo', telDest),
  });

  verifier('la commande est créée', creation.statut === 201,
    `statut ${creation.statut} ${JSON.stringify(creation.json)}`);
  verifier('elle porte un numéro court dictable',
    /^FY-\d+$/.test(creation.json?.numero ?? ''), `numéro ${creation.json?.numero}`);
  verifier('elle part en attente', creation.json?.statut === 'en_attente');
  verifier('le repère de départ est conservé',
    creation.json?.repere_depart === 'Face à la pharmacie');
  verifier('la description du colis est conservée',
    creation.json?.description_colis === 'Deux cartons de tissu');
  verifier('les points GPS sont conservés',
    creation.json?.latitude_arrivee === 12.3901 && creation.json?.longitude_arrivee === -1.4885,
    JSON.stringify([creation.json?.latitude_arrivee, creation.json?.longitude_arrivee]));
  verifier('aucun numéro de téléphone n’est renvoyé',
    !JSON.stringify(creation.json ?? {}).includes(telDest.replace('+', '')),
    JSON.stringify(creation.json));

  const courseID = creation.json?.id;

  // --- Numérotation ---
  titre('2. Numérotation');

  const seconde = await appel('POST', '/api/commandes/', {
    jeton: a.partenaire,
    corps: commande('Ibrahim Sawadogo', tel()),
  });
  const n1 = Number(creation.json?.numero?.split('-')[1]);
  const n2 = Number(seconde.json?.numero?.split('-')[1]);
  verifier('les numéros se suivent', n2 === n1 + 1, `${n1} puis ${n2}`);

  const chezB = await appel('POST', '/api/commandes/', {
    jeton: b.partenaire,
    corps: commande('Client de B', tel()),
  });
  const nB = Number(chezB.json?.numero?.split('-')[1]);
  verifier('chaque compagnie a sa propre suite', nB <= n1,
    `A en est à ${n2}, B à ${nB} — les suites ne doivent pas être partagées`);

  // --- Validation ---
  titre('3. Saisie refusée quand elle est incohérente');

  const sansDest = await appel('POST', '/api/commandes/', {
    jeton: a.partenaire,
    corps: { ...commande('', tel()) },
  });
  verifier('un destinataire sans nom est refusé', sansDest.statut === 400,
    `statut ${sansDest.statut}`);

  const sansAdresse = await appel('POST', '/api/commandes/', {
    jeton: a.partenaire,
    corps: { ...commande('X', tel()), adresse_arrivee: '  ' },
  });
  verifier('une adresse d’arrivée vide est refusée', sansAdresse.statut === 400,
    `statut ${sansAdresse.statut}`);

  const horsBornes = await appel('POST', '/api/commandes/', {
    jeton: a.partenaire,
    corps: { ...commande('X', tel()), latitude_arrivee: 91, longitude_arrivee: 200 },
  });
  verifier('des coordonnées hors du monde sont refusées', horsBornes.statut === 400,
    `statut ${horsBornes.statut}`);

  // --- Carnet ---
  titre('4. Le carnet se remplit tout seul');

  await appel('POST', '/api/commandes/', {
    jeton: a.partenaire,
    corps: commande('Awa Ouédraogo', telDest, {
      adresse_arrivee: 'Nouvelle adresse, Ouaga 2000',
    }),
  });

  const carnet = await appel('GET', '/api/commandes/carnet', { jeton: a.partenaire });
  verifier('le carnet répond', carnet.statut === 200, `statut ${carnet.statut}`);

  const awa = carnet.json?.find((d) => d.nom === 'Awa Ouédraogo');
  verifier('le destinataire déjà servi y figure', !!awa, JSON.stringify(carnet.json));
  verifier('sans doublon malgré deux envois',
    carnet.json?.filter((d) => d.nom === 'Awa Ouédraogo').length === 1);
  verifier('avec sa dernière adresse, pas la première',
    awa?.adresse_arrivee === 'Nouvelle adresse, Ouaga 2000',
    awa?.adresse_arrivee);
  verifier('et le nombre d’envois', awa?.nombre_envois === 2, `${awa?.nombre_envois}`);
  verifier('le carnet n’expose aucun numéro de téléphone',
    !JSON.stringify(carnet.json ?? {}).includes(telDest.replace('+', '')));

  // --- Liste ---
  titre('5. Ses commandes');

  const liste = await appel('GET', '/api/commandes/', { jeton: a.partenaire });
  verifier('le partenaire voit ses commandes', liste.statut === 200 && liste.json?.length >= 3,
    `statut ${liste.statut}, ${liste.json?.length} commandes`);
  verifier('la plus récente est en tête',
    Date.parse(liste.json?.[0]?.created_at) >= Date.parse(liste.json?.[1]?.created_at));

  const fiche = await appel('GET', `/api/commandes/${courseID}`, { jeton: a.partenaire });
  verifier('il ouvre la fiche d’une commande', fiche.statut === 200 && fiche.json?.id === courseID);

  // --- Cloisonnement ---
  titre('6. Cloisonnement');

  const espion = await appel('GET', `/api/commandes/${courseID}`, { jeton: b.partenaire });
  verifier('un autre partenaire ne voit pas cette commande', espion.statut === 404,
    `statut ${espion.statut}`);

  const listeB = await appel('GET', '/api/commandes/', { jeton: b.partenaire });
  verifier('ni dans sa liste',
    !listeB.json?.some((c) => c.id === courseID));

  const carnetB = await appel('GET', '/api/commandes/carnet', { jeton: b.partenaire });
  verifier('ni dans son carnet',
    !carnetB.json?.some((d) => d.nom === 'Awa Ouédraogo'), JSON.stringify(carnetB.json));

  const compagnieCommande = await appel('POST', '/api/commandes/', {
    jeton: a.compagnie,
    corps: commande('X', tel()),
  });
  verifier('la compagnie n’emprunte pas l’API partenaire',
    compagnieCommande.statut === 403, `statut ${compagnieCommande.statut}`);

  // --- File côté compagnie ---
  titre('7. La file des commandes entrantes');

  const file = await appel('GET', '/api/dashboard/commandes-entrantes', { jeton: a.compagnie });
  verifier('la compagnie voit les commandes de ses partenaires',
    file.statut === 200 && file.json?.length >= 3,
    `statut ${file.statut}, ${file.json?.length}`);
  verifier('chaque ligne dit de quelle entreprise elle vient',
    (Array.isArray(file.json) ? file.json : []).every((c) => typeof c.partenaire_nom === 'string' && c.partenaire_nom));
  verifier('et qui l’a saisie',
    (Array.isArray(file.json) ? file.json : []).every((c) => typeof c.cree_par_nom === 'string'));
  verifier('la plus ancienne est en tête (premier arrivé, premier servi)',
    Date.parse(file.json?.[0]?.created_at) <= Date.parse(file.json?.[1]?.created_at));

  const fileB = await appel('GET', '/api/dashboard/commandes-entrantes', { jeton: b.compagnie });
  verifier('une autre compagnie ne voit pas cette file',
    !(Array.isArray(fileB.json) ? fileB.json : []).some((c) => c.id === courseID));

  // --- Annulation ---
  titre('8. Annulation');

  const annule = await appel('POST', `/api/commandes/${courseID}/annuler`, {
    jeton: a.partenaire,
  });
  verifier('une commande non assignée s’annule', annule.statut === 204,
    `statut ${annule.statut}`);

  const rejeu = await appel('POST', `/api/commandes/${courseID}/annuler`, {
    jeton: a.partenaire,
  });
  verifier('elle ne s’annule pas deux fois', rejeu.statut === 409, `statut ${rejeu.statut}`);

  const fileApres = await appel('GET', '/api/dashboard/commandes-entrantes', { jeton: a.compagnie });
  verifier('elle disparaît de la file de la compagnie',
    !(Array.isArray(fileApres.json) ? fileApres.json : []).some((c) => c.id === courseID));

  const parAutre = await appel('POST', `/api/commandes/${seconde.json?.id}/annuler`, {
    jeton: b.partenaire,
  });
  verifier('un autre partenaire ne peut pas annuler', parAutre.statut === 409,
    `statut ${parAutre.statut}`);

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exitCode = echoues === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}`);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exitCode = 1;
});
