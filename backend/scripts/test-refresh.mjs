// Vérifie le cycle de vie d'une session : émission, renouvellement avec
// rotation, révocation, et détection de rejeu.
//
// En Node comme seed-demo.mjs : sous Git Bash sur Windows, les accents des
// chaînes littérales sont corrompus avant d'atteindre curl.
//
//   node backend/scripts/test-refresh.mjs

const API = process.env.API_URL || 'http://localhost:8090';
const TELEPHONE = '+22670001001'; // Salif Traoré, jeu de démonstration
const MOT_DE_PASSE = 'motdepasse123';

let reussis = 0;
let echoues = 0;

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis++;
    console.log(`  ok   ${libelle}`);
  } else {
    echoues++;
    console.log(`  ECHEC ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

async function poster(chemin, corps) {
  const rep = await fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  let json = null;
  try {
    json = await rep.json();
  } catch {
    // 204 sans corps
  }
  return { statut: rep.status, json };
}

async function avecJeton(chemin, jeton) {
  const rep = await fetch(`${API}${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });
  return rep.status;
}

// Décode la charge utile d'un JWT sans vérifier la signature — on veut juste
// lire `exp` pour prouver que le nouveau jeton porte bien une date plus tardive.
function chargeJWT(jeton) {
  const partie = jeton.split('.')[1];
  return JSON.parse(Buffer.from(partie, 'base64url').toString('utf8'));
}

async function main() {
  console.log('\nCycle de session — renouvellement du jeton\n');

  // --- 1. Connexion ---
  console.log('1. Connexion');
  const connexion = await poster('/api/auth/login', {
    telephone: TELEPHONE,
    mot_de_passe: MOT_DE_PASSE,
  });
  verifier('la connexion réussit', connexion.statut === 200, `statut ${connexion.statut}`);
  verifier('un jeton d’accès est renvoyé', !!connexion.json?.token);
  verifier('un jeton de renouvellement est renvoyé', !!connexion.json?.refresh_token);

  if (!connexion.json?.refresh_token) {
    console.log('\nImpossible de continuer sans jeton de renouvellement.');
    if (connexion.statut === 429) {
      // Le groupe /api/auth est limité à 10 requêtes par minute et par IP :
      // deux exécutions rapprochées de ce script suffisent à l'atteindre.
      console.log('Limite de débit atteinte — attendre une minute et relancer.\n');
    } else {
      console.log('Le jeu de démonstration est-il chargé ? node backend/scripts/seed-demo.mjs --reset\n');
    }
    process.exit(1);
  }

  const acces1 = connexion.json.token;
  const refresh1 = connexion.json.refresh_token;

  verifier(
    'le jeton d’accès ouvre une route protégée',
    (await avecJeton('/api/courses/mes-courses', acces1)) === 200
  );

  // --- 2. Renouvellement ---
  console.log('\n2. Renouvellement');
  const renouv = await poster('/api/auth/refresh', { refresh_token: refresh1 });
  verifier('le renouvellement réussit', renouv.statut === 200, `statut ${renouv.statut}`);

  const acces2 = renouv.json?.token;
  const refresh2 = renouv.json?.refresh_token;

  verifier('un nouveau jeton d’accès est renvoyé', !!acces2);
  verifier('le jeton de renouvellement a tourné', !!refresh2 && refresh2 !== refresh1);
  verifier(
    'le rôle est relu en base et conservé',
    renouv.json?.role === 'livreur',
    `rôle ${renouv.json?.role}`
  );

  if (acces2) {
    const exp1 = chargeJWT(acces1).exp;
    const exp2 = chargeJWT(acces2).exp;
    verifier(
      'la nouvelle expiration est postérieure',
      exp2 >= exp1,
      `${exp1} → ${exp2}`
    );
    verifier(
      'le nouveau jeton ouvre une route protégée',
      (await avecJeton('/api/courses/mes-courses', acces2)) === 200
    );
  }

  // --- 3. Détection de rejeu ---
  console.log('\n3. Détection de rejeu');
  const rejeu = await poster('/api/auth/refresh', { refresh_token: refresh1 });
  verifier('un jeton déjà remplacé est refusé', rejeu.statut === 401, `statut ${rejeu.statut}`);
  verifier(
    'le refus ne dit pas pourquoi',
    rejeu.json?.erreur === 'session invalide',
    JSON.stringify(rejeu.json)
  );

  const apresRejeu = await poster('/api/auth/refresh', { refresh_token: refresh2 });
  verifier(
    'le rejeu a coupé toute la chaîne, y compris le jeton courant',
    apresRejeu.statut === 401,
    `statut ${apresRejeu.statut}`
  );

  // --- 4. Déconnexion ---
  console.log('\n4. Déconnexion');
  const reconnexion = await poster('/api/auth/login', {
    telephone: TELEPHONE,
    mot_de_passe: MOT_DE_PASSE,
  });
  const refresh3 = reconnexion.json?.refresh_token;
  verifier('une nouvelle session peut être ouverte', !!refresh3);

  const deco = await poster('/api/auth/deconnexion', { refresh_token: refresh3 });
  verifier('la déconnexion répond 204', deco.statut === 204, `statut ${deco.statut}`);

  const apresDeco = await poster('/api/auth/refresh', { refresh_token: refresh3 });
  verifier(
    'un jeton révoqué ne renouvelle plus',
    apresDeco.statut === 401,
    `statut ${apresDeco.statut}`
  );

  const decoInconnu = await poster('/api/auth/deconnexion', { refresh_token: 'jeton-inexistant' });
  verifier(
    'déconnecter un jeton inconnu répond aussi 204 (pas d’oracle)',
    decoInconnu.statut === 204,
    `statut ${decoInconnu.statut}`
  );

  // --- 5. Entrées invalides ---
  console.log('\n5. Entrées invalides');
  const vide = await poster('/api/auth/refresh', {});
  verifier('un corps sans jeton est rejeté en 400', vide.statut === 400, `statut ${vide.statut}`);

  const bidon = await poster('/api/auth/refresh', { refresh_token: 'nawak' });
  verifier('un jeton inventé est rejeté en 401', bidon.statut === 401, `statut ${bidon.statut}`);

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exit(echoues === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nErreur :', err.message);
  console.error('L’API tourne-t-elle sur ' + API + ' ?\n');
  process.exit(1);
});
