/**
 * Jeu de démonstration : une compagnie, deux livreurs, une destinataire, deux courses.
 * Permet de se connecter aux trois interfaces sans créer de comptes à la main.
 *
 *   node backend/scripts/seed-demo.mjs
 *
 * Écrit en Node et non en shell : sous Git Bash sur Windows, les accents des
 * chaînes littérales sont corrompus avant d'atteindre curl, ce qui produisait
 * des « March� de Rood Woko » en base. Node lit sa source en UTF-8 et `fetch`
 * envoie un corps JSON correctement encodé, quel que soit le système.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const API = process.env.API ?? 'http://localhost:8090';
const MDP = 'motdepasse123';

const TEL = {
  compagnie: '+22670001000',
  livreur1: '+22670001001',
  livreur2: '+22670001002',
  client: '+22670001003',
};

async function appel(methode, chemin, corps, token) {
  const res = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });

  const texte = await res.text();
  let data = null;
  try {
    data = texte ? JSON.parse(texte) : null;
  } catch {
    /* réponse non-JSON */
  }

  if (!res.ok) {
    const message = data?.erreur ?? res.statusText;
    throw new Error(`${methode} ${chemin} → ${res.status} : ${message}`);
  }
  return data;
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fiyen-postgres', 'psql', '-U', 'fiyen', '-d', 'fiyen', '-q', '-c', sql],
    { stdio: 'pipe' },
  );
}

/**
 * Supprime les comptes de démo pour pouvoir rejouer le script.
 *
 * Le ciblage se fait par hash du téléphone — le même que celui calculé par le
 * backend — car le numéro n'est jamais stocké en clair. Seuls ces quatre comptes
 * sont touchés : aucune donnée réelle n'est concernée.
 */
function reinitialiser() {
  const hash = (tel) => createHash('sha256').update(tel).digest('hex');
  const hashes = Object.values(TEL).map((t) => `'${hash(t)}'`).join(',');

  // Les compagnies et destinataires suppriment en cascade leurs livreurs, courses,
  // comptes et sessions de masquage.
  psql(`DELETE FROM compagnies WHERE id IN (
          SELECT compagnie_id FROM utilisateurs
          WHERE telephone_hash IN (${hashes}) AND compagnie_id IS NOT NULL)`);
  psql(`DELETE FROM destinataires WHERE telephone_hash IN (${hashes})`);
  psql(`DELETE FROM utilisateurs WHERE telephone_hash IN (${hashes})`);
}

async function main() {
  try {
    await fetch(`${API}/health`);
  } catch {
    console.error(`Backend injoignable sur ${API}. Démarrez-le d'abord (go run ./cmd/api).`);
    process.exit(1);
  }

  if (process.argv.includes('--reset')) {
    console.log('== Réinitialisation des comptes de démo ==');
    try {
      reinitialiser();
      console.log('  anciens comptes supprimés');
    } catch {
      console.error('  échec : le conteneur fiyen-postgres est-il démarré ?');
      process.exit(1);
    }
  }

  console.log('== Compagnie ==');
  const compagnie = await appel('POST', '/api/auth/register-compagnie', {
    nom_compagnie: 'Fiyen Démo',
    telephone: TEL.compagnie,
    mot_de_passe: MDP,
  });
  console.log('  créée');

  console.log('== Livreurs ==');
  const livreur1 = await appel(
    'POST',
    '/api/livreurs/',
    { nom: 'Salif Traoré', telephone: TEL.livreur1, mot_de_passe: MDP },
    compagnie.token,
  );
  await appel(
    'POST',
    '/api/livreurs/',
    { nom: 'Aminata Zongo', telephone: TEL.livreur2, mot_de_passe: MDP },
    compagnie.token,
  );
  console.log('  Salif Traoré + Aminata Zongo');

  console.log('== Client ==');
  const client = await appel('POST', '/api/auth/register-destinataire', {
    nom: 'Awa Ouédraogo',
    telephone: TEL.client,
    mot_de_passe: MDP,
  });
  console.log('  Awa Ouédraogo');

  console.log('== Courses ==');
  // Course 1 : assignée, pour que le suivi et le chat masqué soient utilisables
  // immédiatement depuis l'app client et l'app livreur.
  const course1 = await appel(
    'POST',
    '/api/courses/',
    {
      destinataire_id: client.destinataire_id,
      adresse_depart: 'Pharmacie Nabi Yar, Gounghin',
      adresse_arrivee: 'Cité An III, porte 42',
    },
    compagnie.token,
  );

  const sessionLivreur = await appel('POST', '/api/auth/login', {
    telephone: TEL.livreur1,
    mot_de_passe: MDP,
  });
  await appel('PATCH', '/api/livreurs/me/statut', { statut: 'dispo' }, sessionLivreur.token);
  await appel(
    'PATCH',
    `/api/courses/${course1.id}/assigner`,
    { livreur_id: livreur1.id },
    compagnie.token,
  );
  console.log('  course 1 assignée à Salif (suivi + chat prêts)');

  // Course 2 : laissée en attente, pour tester l'assignation depuis le dashboard.
  await appel(
    'POST',
    '/api/courses/',
    {
      destinataire_id: client.destinataire_id,
      adresse_depart: 'Marché de Rood Woko',
      adresse_arrivee: 'Ouaga 2000, secteur 15',
    },
    compagnie.token,
  );
  console.log('  course 2 en attente (à assigner depuis le dashboard)');

  console.log('== Barème tarifaire ==');
  // Pas d'API d'écriture : le barème est administré hors application pour l'instant.
  try {
    psql(`INSERT INTO config_tarifaire
            (compagnie_id, abonnement_mensuel, livreurs_inclus, commission_pourcentage, devise)
          VALUES ('${compagnie.compagnie_id}', 50000, 10, 12.5, 'XOF')`);
    console.log('  50 000 XOF/mois, 10 livreurs inclus, 12,5 % de commission');
  } catch {
    console.log('  ignoré (conteneur fiyen-postgres introuvable)');
  }

  console.log(`
================= IDENTIFIANTS DE DÉMO =================
Mot de passe pour tous les comptes : ${MDP}

  Dashboard compagnie   http://localhost:5173
    ${TEL.compagnie}   (Fiyen Démo)

  App livreur (PWA)     http://localhost:5175
    ${TEL.livreur1}   (Salif Traoré — a déjà une course)
    ${TEL.livreur2}   (Aminata Zongo — sans course)

  App client            http://localhost:5176
    ${TEL.client}   (Awa Ouédraogo)

L'app mobile Expo utilise les mêmes comptes livreur.
========================================================`);
}

main().catch((err) => {
  console.error(`\nÉchec : ${err.message}`);
  console.error('Si les comptes de démo existent déjà, réinitialisez la base — voir backend/README.md.');
  process.exit(1);
});
