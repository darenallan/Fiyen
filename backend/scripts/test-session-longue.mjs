// Vérifie qu'une session survit à l'expiration du jeton d'accès.
//
// Attendre les 30 minutes de production serait intenable : le test vise une API
// lancée avec JWT_DUREE_MINUTES=1 (voir le commentaire en bas), puis attend
// réellement que le jeton meure. C'est le seul moyen de prouver le rattrapage
// plutôt que de le simuler.
//
//   PORT=8091 JWT_DUREE_MINUTES=1 go run ./cmd/api &
//   API_URL=http://localhost:8091 node backend/scripts/test-session-longue.mjs

const API = process.env.API_URL || 'http://localhost:8091';
const TELEPHONE = '+22670001001';
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

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function expirationJWT(jwt) {
  const [, payload] = jwt.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp * 1000;
}

// --- Reproduction fidèle de la logique embarquée dans les fronts ---
// Si ce bloc et src/api.ts divergent, le test ne prouve plus rien : toute
// modification de l'un doit être reportée sur l'autre.

let token = null;
let refreshToken = null;
let renouvellements = 0;

async function renouveler() {
  const res = await fetch(`${API}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return false;
  const body = await res.json();
  token = body.token;
  refreshToken = body.refresh_token;
  renouvellements++;
  return true;
}

async function requete(chemin, rejeu = false) {
  const res = await fetch(`${API}${chemin}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && !rejeu && refreshToken) {
    if (await renouveler()) return requete(chemin, true);
  }
  return res.status;
}

async function main() {
  console.log('\nSurvie de la session au-delà de l’expiration du jeton\n');

  const rep = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telephone: TELEPHONE, mot_de_passe: MOT_DE_PASSE }),
  });
  const corps = await rep.json();

  verifier('connexion réussie', rep.status === 200, `statut ${rep.status}`);
  if (rep.status !== 200) {
    console.log(`\nRéponse : ${JSON.stringify(corps)}\n`);
    process.exit(1);
  }

  token = corps.token;
  refreshToken = corps.refresh_token;

  const exp = expirationJWT(token);
  const dureeVie = Math.round((exp - Date.now()) / 1000);
  console.log(`     durée de vie du jeton d’accès : ${dureeVie} s`);

  if (dureeVie > 180) {
    console.log('\n  Le jeton vit trop longtemps pour ce test.');
    console.log('  Relancer l’API avec JWT_DUREE_MINUTES=1.\n');
    process.exit(1);
  }

  verifier('le jeton initial ouvre une route protégée', (await requete('/api/courses/mes-courses')) === 200);

  // --- Attente réelle de l'expiration ---
  const attente = exp - Date.now() + 3000;
  console.log(`\n  Attente de l’expiration (${Math.round(attente / 1000)} s)…`);
  await attendre(attente);

  const expire = Math.round((Date.now() - exp) / 1000);
  console.log(`  Jeton expiré depuis ${expire} s.\n`);

  // Contrôle : le jeton est bien mort côté serveur, sans quoi la suite ne
  // prouverait rien du tout.
  const brut = await fetch(`${API}/api/courses/mes-courses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  verifier('le jeton expiré est bien refusé', brut.status === 401, `statut ${brut.status}`);

  const avant = renouvellements;
  const statut = await requete('/api/courses/mes-courses');
  verifier('la requête aboutit malgré l’expiration', statut === 200, `statut ${statut}`);
  verifier('elle a déclenché un renouvellement', renouvellements === avant + 1);
  verifier('le nouveau jeton est valide', Date.now() < expirationJWT(token));

  const suivante = await requete('/api/courses/mes-courses');
  verifier('la requête suivante passe sans renouveler', suivante === 200);
  verifier('aucun renouvellement superflu', renouvellements === avant + 1);

  console.log(`\n${reussis} vérifications passées, ${echoues} en échec\n`);
  process.exit(echoues === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nErreur :', err.message);
  console.error(`L’API tourne-t-elle sur ${API} ?\n`);
  process.exit(1);
});
