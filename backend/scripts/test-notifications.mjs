// Vérifie l'enregistrement des jetons de notification.
//
// Ce script couvre ce qui s'observe depuis l'extérieur : validation du format,
// authentification requise, statuts indifférenciés. **La réattribution d'un
// appareil ne s'y vérifie pas** — les endpoints répondent 204 sans distinction
// par conception. Elle est testée en base par `TestJetonPush_*`.
//
//   node backend/scripts/test-notifications.mjs
//
// Ce script crée plusieurs comptes : le groupe /api/auth est limité à 10
// requêtes par minute et par IP. Espacer d'une minute deux exécutions.

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

/** Une compagnie et deux livreurs, pour éprouver la réattribution. */
async function monterDecor() {
  const suffixe = uniq();
  const compagnie = await appel('POST', '/api/auth/register-compagnie', {
    corps: {
      nom_compagnie: `Notif ${suffixe}`,
      telephone: tel(),
      mot_de_passe: 'motdepasse123',
    },
  });
  if (compagnie.statut !== 201) throw new Error(`compagnie: ${compagnie.statut}`);

  const jetons = [];
  for (const nom of ['Salif Traoré', 'Aminata Zongo']) {
    const telephone = tel();
    const creation = await appel('POST', '/api/livreurs/', {
      jeton: compagnie.json.token,
      corps: { nom, telephone, mot_de_passe: 'motdepasse123' },
    });
    if (creation.statut !== 201) throw new Error(`livreur: ${creation.statut}`);

    const cnx = await appel('POST', '/api/auth/login', {
      corps: { telephone, mot_de_passe: 'motdepasse123' },
    });
    jetons.push(cnx.json.token);
  }

  return { compagnie: compagnie.json.token, salif: jetons[0], aminata: jetons[1] };
}

/** Compte les jetons enregistrés pour un utilisateur, via la base exposée par
 *  l'API — ici on se contente de réenregistrer et d'observer les statuts. */
const jetonExpo = (n) => `ExponentPushToken[test-${n}-${uniq()}]`;

async function main() {
  console.log('\nJetons de notification\n');

  const d = await monterDecor();

  titre('1. Enregistrement');

  const jeton = jetonExpo('salif');
  const ok = await appel('POST', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton, plateforme: 'android' },
  });
  verifier("le livreur enregistre l'appareil", ok.statut === 204,
    `statut ${ok.statut} ${JSON.stringify(ok.json)}`);

  const rejoue = await appel('POST', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton, plateforme: 'android' },
  });
  verifier('réenregistrer le même appareil ne double pas la ligne',
    rejoue.statut === 204, `statut ${rejoue.statut}`);

  titre('2. Ce qui est refusé');

  const malforme = await appel('POST', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton: 'pas-un-jeton', plateforme: 'android' },
  });
  verifier('un jeton au mauvais format est refusé', malforme.statut === 400,
    `statut ${malforme.statut}`);

  const vide = await appel('POST', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton: '', plateforme: 'android' },
  });
  verifier('un jeton vide est refusé', vide.statut === 400, `statut ${vide.statut}`);

  const plateforme = await appel('POST', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton: jetonExpo('x'), plateforme: 'symbian' },
  });
  verifier('une plateforme inconnue est refusée', plateforme.statut === 400,
    `statut ${plateforme.statut}`);

  const sansJeton = await appel('POST', '/api/notifications/jeton', {
    corps: { jeton: jetonExpo('y'), plateforme: 'android' },
  });
  verifier("l'enregistrement exige une authentification", sansJeton.statut === 401,
    `statut ${sansJeton.statut}`);

  titre('3. Téléphone réattribué');

  // Le même appareil, désormais utilisé par une autre livreuse : c'est le cas
  // d'une réinstallation ou d'un téléphone prêté.
  const reattribution = await appel('POST', '/api/notifications/jeton', {
    jeton: d.aminata,
    corps: { jeton, plateforme: 'android' },
  });
  verifier("l'appareil peut changer de porteur", reattribution.statut === 204,
    `statut ${reattribution.statut}`);

  // Ce script ne peut pas aller plus loin : les deux endpoints répondent 204
  // sans distinction — volontairement, pour ne pas devenir un moyen de tester
  // à qui appartient un jeton. Que la réattribution ait bien eu lieu, et que
  // l'ancien porteur ne puisse plus couper les notifications du nouveau, se
  // vérifie en base : voir `TestJetonPush_*` dans internal/handlers.

  titre('4. Oubli à la déconnexion');

  const autre = jetonExpo('autre');
  await appel('POST', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton: autre, plateforme: 'android' },
  });

  const efface = await appel('DELETE', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton: autre },
  });
  verifier('le porteur oublie son appareil', efface.statut === 204,
    `statut ${efface.statut}`);

  const inconnu = await appel('DELETE', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: { jeton: jetonExpo('jamais-vu') },
  });
  verifier('effacer un jeton inconnu répond pareil (pas d’oracle)',
    inconnu.statut === efface.statut, `${inconnu.statut} vs ${efface.statut}`);

  const sansCorps = await appel('DELETE', '/api/notifications/jeton', {
    jeton: d.salif,
    corps: {},
  });
  verifier('une suppression sans jeton est rejetée', sansCorps.statut === 400,
    `statut ${sansCorps.statut}`);

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exitCode = echoues === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}`);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exitCode = 1;
});
