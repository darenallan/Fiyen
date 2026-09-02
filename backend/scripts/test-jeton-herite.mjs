// Vérifie qu'un jeton émis **avant** le renommage `client` → `destinataire`
// reste utilisable contre l'API en cours.
//
// C'est le seul risque réel de D2 : au moment du déploiement, des jetons de la
// forme ancienne sont encore en circulation pour jusqu'à trente minutes (accès)
// et trente jours (renouvellement). S'ils cessaient d'être compris, chaque
// destinataire connecté recevrait un 403 sur tous ses écrans.
//
//   node backend/scripts/test-jeton-herite.mjs
//
// Le script forge lui-même un jeton ancien : il a donc besoin du JWT_SECRET,
// qu'il lit dans backend/.env.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL || 'http://localhost:8090';
const ICI = path.dirname(fileURLToPath(import.meta.url));

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

function lireEnv(cle) {
  const brut = fs.readFileSync(path.join(ICI, '..', '.env'), 'utf8');
  for (const ligne of brut.split('\n')) {
    const [k, ...reste] = ligne.split('=');
    if (k.trim() === cle) return reste.join('=').trim();
  }
  return null;
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Forge un JWT HS256 à la main : l'API ne sait plus en émettre d'anciens. */
function forger(charge, secret) {
  const entete = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corps = b64url(JSON.stringify(charge));
  const signature = b64url(
    crypto.createHmac('sha256', secret).update(`${entete}.${corps}`).digest()
  );
  return `${entete}.${corps}.${signature}`;
}

const tel = () => `+2267${Math.floor(1000000 + Math.random() * 8999999)}`;

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

async function main() {
  console.log('\nCompatibilité des jetons émis avant le renommage\n');

  const secret = lireEnv('JWT_SECRET');
  if (!secret) {
    console.error('JWT_SECRET introuvable dans backend/.env\n');
    process.exitCode = 1;
    return;
  }

  // Un vrai destinataire, créé par l'API courante.
  const telephone = tel();
  const inscription = await appel('POST', '/api/auth/register-destinataire', {
    corps: { nom: 'Awa Ouédraogo', telephone, mot_de_passe: 'motdepasse123' },
  });
  if (inscription.statut !== 201) {
    console.error(`inscription impossible (${inscription.statut})`);
    process.exitCode = 1;
    return;
  }

  const jetonCourant = inscription.json.token;
  const charge = JSON.parse(
    Buffer.from(jetonCourant.split('.')[1], 'base64url').toString('utf8')
  );

  verifier(
    'l’API émet désormais destinataire_id',
    typeof charge.destinataire_id === 'string',
    JSON.stringify(charge)
  );
  verifier('elle n’émet plus client_id', charge.client_id === undefined);
  verifier('le rôle émis est « destinataire »', charge.role === 'destinataire', charge.role);

  // On rejoue la forme ancienne : rôle `client`, identité dans `client_id`.
  const ancien = forger(
    {
      utilisateur_id: charge.utilisateur_id,
      role: 'client',
      client_id: charge.destinataire_id,
      exp: Math.floor(Date.now() / 1000) + 1800,
      iat: Math.floor(Date.now() / 1000),
    },
    secret
  );

  const mesCourses = await appel('GET', '/api/courses/mes-courses', { jeton: ancien });
  verifier(
    'un jeton de l’ancienne forme ouvre encore ses courses',
    mesCourses.statut === 200,
    `statut ${mesCourses.statut} ${JSON.stringify(mesCourses.json)}`
  );

  // Le rôle hérité doit franchir `RolesRequis`, qui compare des chaînes.
  const refuse = await appel('GET', '/api/partenaires/', { jeton: ancien });
  verifier(
    'il reste soumis aux mêmes restrictions de rôle',
    refuse.statut === 403,
    `statut ${refuse.statut}`
  );

  // Un jeton signé avec un autre secret ne doit pas passer sous prétexte
  // qu'il porte l'ancienne forme.
  const falsifie = forger(
    {
      utilisateur_id: charge.utilisateur_id,
      role: 'client',
      client_id: charge.destinataire_id,
      exp: Math.floor(Date.now() / 1000) + 1800,
    },
    'mauvais-secret'
  );
  const rejete = await appel('GET', '/api/courses/mes-courses', { jeton: falsifie });
  verifier(
    'la compatibilité n’affaiblit pas la vérification de signature',
    rejete.statut === 401,
    `statut ${rejete.statut}`
  );

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exitCode = echoues === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nErreur : ${err.message}`);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exitCode = 1;
});
