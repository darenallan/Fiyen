// Vérifie le cycle de vie des comptes partenaires et collaborateurs :
// création, invitation par code, activation, suspension, et surtout le
// cloisonnement — une compagnie ne touche pas aux partenaires d'une autre, un
// collaborateur ne gère pas les comptes de son entreprise.
//
//   node backend/scripts/test-partenaires.mjs
//
// L'API doit tourner (:8090) et les migrations être appliquées.
//
// Ce script cree plusieurs comptes : le groupe /api/auth est limite a 10
// requetes par minute et par IP. Enchainer deux scripts de test sans pause
// declenche des 429 qui ressemblent a des bugs. Espacer d'une minute.

const API = process.env.API_URL || 'http://localhost:8090';

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

function titre(t) {
  console.log(`\n${t}`);
}

/** Suffixe unique : le script doit pouvoir être rejoué sans conflit de nom. */
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
    // 204 sans corps
  }
  return { statut: rep.status, json };
}

/** Crée une compagnie de test et rend son jeton. */
async function nouvelleCompagnie(etiquette) {
  const suffixe = uniq();
  const rep = await appel('POST', '/api/auth/register-compagnie', {
    corps: {
      nom_compagnie: `Test ${etiquette} ${suffixe}`,
      telephone: `+2267${Math.floor(1000000 + Math.random() * 8999999)}`,
      mot_de_passe: 'motdepasse123',
    },
  });
  if (rep.statut !== 201) {
    throw new Error(`création compagnie impossible (${rep.statut}) ${JSON.stringify(rep.json)}`);
  }
  return { jeton: rep.json.token, compagnieID: rep.json.compagnie_id, suffixe };
}

const telephoneAleatoire = () => `+2267${Math.floor(1000000 + Math.random() * 8999999)}`;

async function main() {
  console.log('\nComptes partenaires et collaborateurs\n');

  const compagnieA = await nouvelleCompagnie('compagnieA');
  const compagnieB = await nouvelleCompagnie('compagnieB');

  // --- Création ---
  titre('1. Création d’un partenaire');

  const telPartenaire = telephoneAleatoire();
  const creation = await appel('POST', '/api/partenaires/', {
    jeton: compagnieA.jeton,
    corps: {
      nom: `Boutique ${compagnieA.suffixe}`,
      repere: 'Face à la station Total de Gounghin',
      telephone: telPartenaire,
      mot_de_passe: 'motdepasse123',
    },
  });

  verifier('la compagnie crée un partenaire', creation.statut === 201,
    `statut ${creation.statut} ${JSON.stringify(creation.json)}`);
  verifier('le repère est conservé',
    creation.json?.repere === 'Face à la station Total de Gounghin');
  verifier('le partenaire est actif par défaut', creation.json?.statut === 'actif');
  verifier('la visibilité par défaut est « entreprise »',
    creation.json?.visibilite_collaborateurs === 'entreprise',
    `obtenu ${creation.json?.visibilite_collaborateurs}`);
  verifier('aucune empreinte de téléphone n’est exposée',
    !JSON.stringify(creation.json ?? {}).includes('telephone'),
    JSON.stringify(creation.json));

  const partenaireID = creation.json?.id;
  if (!partenaireID) {
    console.log('\nImpossible de continuer sans partenaire.\n');
    process.exitCode = 1;
    return;
  }

  const doublon = await appel('POST', '/api/partenaires/', {
    jeton: compagnieA.jeton,
    corps: {
      nom: `boutique ${compagnieA.suffixe}`, // même nom, casse différente
      telephone: telephoneAleatoire(),
      mot_de_passe: 'motdepasse123',
    },
  });
  verifier('deux partenaires ne peuvent pas porter le même nom',
    doublon.statut === 409, `statut ${doublon.statut}`);

  // --- Connexion du partenaire ---
  titre('2. Le partenaire se connecte');

  const connexion = await appel('POST', '/api/auth/login', {
    corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
  });
  verifier('la connexion réussit', connexion.statut === 200, `statut ${connexion.statut}`);
  verifier('le rôle est « partenaire »', connexion.json?.role === 'partenaire');

  const jetonPartenaire = connexion.json?.token;
  const charge = jetonPartenaire
    ? JSON.parse(Buffer.from(jetonPartenaire.split('.')[1], 'base64url').toString('utf8'))
    : {};
  verifier('le jeton porte le partenaire_id', charge.partenaire_id === partenaireID,
    `${charge.partenaire_id} ≠ ${partenaireID}`);

  const fiche = await appel('GET', '/api/mon-partenaire', { jeton: jetonPartenaire });
  verifier('il lit la fiche de son entreprise sans en connaître l’identifiant',
    fiche.statut === 200 && fiche.json?.id === partenaireID, `statut ${fiche.statut}`);

  // --- Cloisonnement entre compagnies ---
  titre('3. Cloisonnement entre compagnies');

  const listeA = await appel('GET', '/api/partenaires/', { jeton: compagnieA.jeton });
  const listeB = await appel('GET', '/api/partenaires/', { jeton: compagnieB.jeton });
  verifier('la compagnie voit son partenaire',
    listeA.json?.some((p) => p.id === partenaireID));
  verifier('une autre compagnie ne le voit pas',
    Array.isArray(listeB.json) && !listeB.json.some((p) => p.id === partenaireID),
    JSON.stringify(listeB.json));

  const intrusion = await appel('PATCH', `/api/partenaires/${partenaireID}`, {
    jeton: compagnieB.jeton,
    corps: { statut: 'suspendu' },
  });
  verifier('une autre compagnie ne peut pas le modifier',
    intrusion.statut === 404, `statut ${intrusion.statut}`);

  const intrusionCollab = await appel('GET', `/api/partenaires/${partenaireID}/collaborateurs`, {
    jeton: compagnieB.jeton,
  });
  verifier('ni lister ses collaborateurs',
    intrusionCollab.statut === 404, `statut ${intrusionCollab.statut}`);

  const sansJeton = await appel('GET', '/api/partenaires/');
  verifier('l’API partenaires exige une authentification',
    sansJeton.statut === 401, `statut ${sansJeton.statut}`);

  const livreurTente = await appel('GET', '/api/partenaires/', { jeton: jetonPartenaire });
  verifier('un partenaire n’accède pas à l’API compagnie',
    livreurTente.statut === 403, `statut ${livreurTente.statut}`);

  // --- Invitation d'un collaborateur ---
  titre('4. Invitation d’un collaborateur');

  const telCollab = telephoneAleatoire();
  const invitation = await appel('POST', '/api/mon-partenaire/collaborateurs', {
    jeton: jetonPartenaire,
    corps: { nom: 'Ibrahim Sawadogo', telephone: telCollab },
  });
  verifier('le partenaire invite un collaborateur', invitation.statut === 201,
    `statut ${invitation.statut} ${JSON.stringify(invitation.json)}`);

  const code = invitation.json?.code;
  verifier('un code à 6 chiffres est rendu', /^\d{6}$/.test(code ?? ''), `code ${code}`);

  const liste = await appel('GET', '/api/mon-partenaire/collaborateurs', {
    jeton: jetonPartenaire,
  });
  verifier('l’invitation apparaît en attente',
    liste.json?.invitations?.some((i) => i.nom === 'Ibrahim Sawadogo'));
  verifier('le code n’est plus jamais relu',
    !liste.json?.invitations?.some((i) => i.code),
    JSON.stringify(liste.json?.invitations));

  // --- Activation ---
  titre('5. Activation du compte collaborateur');

  const mauvaisCode = await appel('POST', '/api/auth/activer-collaborateur', {
    corps: { telephone: telCollab, code: '000000', mot_de_passe: 'motdepasse123' },
  });
  verifier('un code faux est refusé', mauvaisCode.statut === 401,
    `statut ${mauvaisCode.statut}`);

  const inconnu = await appel('POST', '/api/auth/activer-collaborateur', {
    corps: { telephone: telephoneAleatoire(), code: '123456', mot_de_passe: 'motdepasse123' },
  });
  verifier('un numéro jamais invité reçoit la même réponse qu’un code faux',
    inconnu.statut === 401 &&
      JSON.stringify(inconnu.json) === JSON.stringify(mauvaisCode.json),
    `${JSON.stringify(inconnu.json)} vs ${JSON.stringify(mauvaisCode.json)}`);

  const activation = await appel('POST', '/api/auth/activer-collaborateur', {
    corps: { telephone: telCollab, code, mot_de_passe: 'motdepasse123' },
  });
  verifier('le bon code ouvre le compte', activation.statut === 201,
    `statut ${activation.statut} ${JSON.stringify(activation.json)}`);
  verifier('le rôle est « collaborateur »', activation.json?.role === 'collaborateur');
  verifier('une session est ouverte immédiatement',
    !!activation.json?.token && !!activation.json?.refresh_token);

  const jetonCollab = activation.json?.token;

  const rejeu = await appel('POST', '/api/auth/activer-collaborateur', {
    corps: { telephone: telCollab, code, mot_de_passe: 'autremotdepasse' },
  });
  verifier('un code déjà consommé ne resert pas', rejeu.statut === 401,
    `statut ${rejeu.statut}`);

  // --- Droits du collaborateur ---
  titre('6. Ce que le collaborateur peut et ne peut pas');

  const saFiche = await appel('GET', '/api/mon-partenaire', { jeton: jetonCollab });
  verifier('il lit la fiche de son entreprise',
    saFiche.statut === 200 && saFiche.json?.id === partenaireID, `statut ${saFiche.statut}`);

  const gestion = await appel('GET', '/api/mon-partenaire/collaborateurs', {
    jeton: jetonCollab,
  });
  verifier('il ne gère pas les comptes de son entreprise',
    gestion.statut === 403, `statut ${gestion.statut}`);

  const inviteAussi = await appel('POST', '/api/mon-partenaire/collaborateurs', {
    jeton: jetonCollab,
    corps: { nom: 'Complice', telephone: telephoneAleatoire() },
  });
  verifier('il ne peut pas inviter à son tour',
    inviteAussi.statut === 403, `statut ${inviteAussi.statut}`);

  const listeApres = await appel('GET', `/api/partenaires/${partenaireID}/collaborateurs`, {
    jeton: compagnieA.jeton,
  });
  verifier('la compagnie voit le collaborateur créé',
    listeApres.json?.collaborateurs?.some((c) => c.nom === 'Ibrahim Sawadogo'),
    JSON.stringify(listeApres.json?.collaborateurs));
  verifier('la liste n’expose aucune empreinte de téléphone',
    !JSON.stringify(listeApres.json ?? {}).includes('telephone_hash'));

  const collabID = listeApres.json?.collaborateurs?.find(
    (c) => c.nom === 'Ibrahim Sawadogo'
  )?.id;

  // --- Suspension ---
  titre('7. Suspension');

  const suspension = await appel(
    'PATCH',
    `/api/mon-partenaire/collaborateurs/${collabID}`,
    { jeton: jetonPartenaire, corps: { actif: false } }
  );
  verifier('le partenaire suspend son collaborateur',
    suspension.statut === 200 && suspension.json?.actif === false,
    `statut ${suspension.statut}`);

  const reconnexion = await appel('POST', '/api/auth/login', {
    corps: { telephone: telCollab, mot_de_passe: 'motdepasse123' },
  });
  verifier('un collaborateur suspendu ne se reconnecte plus',
    reconnexion.statut === 401, `statut ${reconnexion.statut}`);

  verifier('le compte reste en base (l’historique survit)',
    listeApres.json?.collaborateurs?.length >= 1);

  const suspendrePrincipal = await appel(
    'PATCH',
    `/api/mon-partenaire/collaborateurs/${charge.utilisateur_id}`,
    { jeton: jetonPartenaire, corps: { actif: false } }
  );
  verifier('le partenaire ne peut pas se suspendre lui-même',
    suspendrePrincipal.statut === 404, `statut ${suspendrePrincipal.statut}`);

  // --- Suspension de l'entreprise entière ---
  titre('8. Suspension de l’entreprise');

  const suspendrePartenaire = await appel('PATCH', `/api/partenaires/${partenaireID}`, {
    jeton: compagnieA.jeton,
    corps: { statut: 'suspendu' },
  });
  verifier('la compagnie suspend le partenaire',
    suspendrePartenaire.statut === 200 && suspendrePartenaire.json?.statut === 'suspendu',
    `statut ${suspendrePartenaire.statut}`);

  const connexionSuspendu = await appel('POST', '/api/auth/login', {
    corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
  });
  verifier('son compte principal ne se connecte plus',
    connexionSuspendu.statut === 401, `statut ${connexionSuspendu.statut}`);

  const reactivation = await appel('PATCH', `/api/partenaires/${partenaireID}`, {
    jeton: compagnieA.jeton,
    corps: { statut: 'actif' },
  });
  verifier('la réactivation est possible',
    reactivation.statut === 200 && reactivation.json?.statut === 'actif');

  const reconnexionApres = await appel('POST', '/api/auth/login', {
    corps: { telephone: telPartenaire, mot_de_passe: 'motdepasse123' },
  });
  verifier('et rend l’accès', reconnexionApres.statut === 200,
    `statut ${reconnexionApres.statut}`);

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exitCode = echoues === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}`);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exitCode = 1;
});
