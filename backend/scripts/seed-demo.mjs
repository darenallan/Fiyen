/**
 * Jeu de démonstration — Ouagadougou, noms et numéros fictifs.
 *
 *   node backend/scripts/seed-demo.mjs --reset
 *
 * Construit, uniquement via l'API (donc avec les mêmes règles que l'usage réel) :
 *   - une compagnie, quatre livreurs, une destinataire avec compte ;
 *   - une entreprise partenaire (pharmacie) et une collaboratrice ;
 *   - un historique de courses livrées, avec journal et trajet GPS rejouable ;
 *   - des courses en cours et en attente, pour que chaque écran ait du contenu.
 *
 * Pour animer la carte pendant la démo : node backend/scripts/simuler-flotte.mjs
 *
 * Écrit en Node et non en shell : sous Git Bash sur Windows, les accents des
 * chaînes littérales sont corrompus avant d'atteindre curl, ce qui produisait
 * des « March� de Rood Woko » en base. Node lit sa source en UTF-8 et `fetch`
 * envoie un corps JSON correctement encodé, quel que soit le système.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const API = process.env.API ?? 'http://localhost:8090';
const MDP = 'motdepasse123';

// Tous les numéros sont fictifs (plage +226 70 00 10 xx). Le reset cible
// exactement cette liste, rien d'autre.
const TEL = {
  compagnie: '+22670001000',
  livreur1: '+22670001001',
  livreur2: '+22670001002',
  client: '+22670001003',
  partenaire: '+22670001004',
  collaboratrice: '+22670001005',
  livreur3: '+22670001006',
  livreur4: '+22670001007',
  dest1: '+22670001008',
  dest2: '+22670001009',
  dest3: '+22670001010',
};

// Lieux de Ouagadougou (coordonnées approximatives, à l'échelle du quartier).
const LIEUX = {
  pharmacie: { adresse: 'Pharmacie du Progrès, avenue Kwame Nkrumah', repere: 'Face à la station, enseigne verte', lat: 12.3712, lon: -1.5199 },
  gounghin: { adresse: 'Pharmacie Nabi Yar, Gounghin', lat: 12.3655, lon: -1.5452 },
  citeAn3: { adresse: 'Cité An III, porte 42', repere: 'Portail bleu après la boutique Wend-Panga', lat: 12.3728, lon: -1.5127 },
  roodWoko: { adresse: 'Marché de Rood Woko', lat: 12.3683, lon: -1.5236 },
  ouaga2000: { adresse: 'Ouaga 2000, secteur 15', repere: 'Derrière l’échangeur, villa crème', lat: 12.3176, lon: -1.4932 },
  zoneBois: { adresse: 'Zone du Bois, rue 15.42', repere: 'Portail vert après le château d’eau', lat: 12.3858, lon: -1.4893 },
  patteOie: { adresse: 'Patte d’Oie, rue 17.58', repere: 'À côté du maquis Le Baobab', lat: 12.3318, lon: -1.5139 },
  tampouy: { adresse: 'Tampouy, secteur 21', repere: 'Mosquée blanche, deuxième rue à gauche', lat: 12.4048, lon: -1.5571 },
  dassasgho: { adresse: 'Dassasgho, rue 29.07', repere: 'Face à l’école primaire', lat: 12.3794, lon: -1.4712 },
  pissy: { adresse: 'Pissy, secteur 17', repere: 'Près de la gare routière', lat: 12.3412, lon: -1.5748 },
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

// Le SQL passe par `cmd/sql`, la même connexion que l'API (DATABASE_URL), et
// non plus par `docker exec … psql` : le client Docker de Docker Desktop peut
// se figer alors que Postgres répond, ce qui bloquait le reset sans message.
let executableSQL = null;
function psql(sql) {
  if (!executableSQL) {
    executableSQL = path.join(os.tmpdir(), `fiyen-sql${process.platform === 'win32' ? '.exe' : ''}`);
    execFileSync('go', ['build', '-o', executableSQL, './cmd/sql'], { cwd: BACKEND, stdio: 'pipe', timeout: 180000 });
  }
  return execFileSync(executableSQL, [], {
    cwd: BACKEND,
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

/**
 * Supprime les comptes de démo pour pouvoir rejouer le script.
 *
 * Le ciblage se fait par hash du téléphone — le même que celui calculé par le
 * backend — car le numéro n'est jamais stocké en clair. Seuls les numéros de
 * TEL sont touchés : aucune donnée réelle n'est concernée.
 */
function reinitialiser() {
  const hash = (tel) => createHash('sha256').update(tel).digest('hex');
  const hashes = Object.values(TEL).map((t) => `'${hash(t)}'`).join(',');

  // Les courses d'abord, et leur journal avec elles (la suppression y est
  // permise). Sinon, supprimer un compte demanderait à la base de mettre à
  // NULL l'auteur de ses évènements — un UPDATE que le trigger d'immuabilité
  // du journal refuse, et le reset échoue.
  psql(`DELETE FROM courses WHERE compagnie_id IN (
          SELECT compagnie_id FROM utilisateurs
          WHERE telephone_hash IN (${hashes}) AND compagnie_id IS NOT NULL)
        OR destinataire_id IN (SELECT id FROM destinataires WHERE telephone_hash IN (${hashes}))`);
  // La compagnie supprime en cascade ses livreurs, partenaires et le reste.
  psql(`DELETE FROM compagnies WHERE id IN (
          SELECT compagnie_id FROM utilisateurs
          WHERE telephone_hash IN (${hashes}) AND compagnie_id IS NOT NULL)`);
  psql(`DELETE FROM utilisateurs WHERE telephone_hash IN (${hashes})`);
  psql(`DELETE FROM destinataires WHERE telephone_hash IN (${hashes})`);
}

const connexion = async (tel) =>
  (await appel('POST', '/api/auth/login', { telephone: tel, mot_de_passe: MDP })).token;

/** Points intermédiaires entre deux lieux, avec un léger écart pour ne pas tracer une règle. */
function pointsEntre(a, b, n = 6) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bruit = i === 0 || i === n ? 0 : Math.sin(i * 2.3) * 0.0012;
    pts.push({ latitude: a.lat + (b.lat - a.lat) * t + bruit, longitude: a.lon + (b.lon - a.lon) * t - bruit });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Historique daté, pour que l'écran Statistiques ait deux mois à comparer.
//
// Ces courses sont **fabriquées pour la démonstration** : insérées en SQL avec
// des dates passées, puisque l'API date tout à l'instant présent. Le journal
// reste immuable — on n'y fait qu'insérer. Pas de trace GPS pour elles : le
// rejeu du trajet n'a rien à montrer, et c'est voulu.
// ---------------------------------------------------------------------------

const PREMIER_JOUR_HISTORIQUE = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
};

// Générateur pseudo-aléatoire à graine fixe : le jeu de démo est le même à
// chaque `--reset`, donc les chiffres annoncés pendant une répétition restent
// vrais le jour de la démo.
function generateur(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function distanceKm(a, b) {
  const r = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h)) * 1.3; // même coefficient que le barème de démo
}

// Même grille que le barème publié plus haut.
const prixDemo = (km) => (km <= 3 ? 1000 : km <= 8 ? 1500 : km <= 15 ? 2500 : null);

function insererHistorique(compagnieId, idsLivreurs, partenaireId) {
  const alea = generateur(2026);
  const entre = (min, max) => min + alea() * (max - min);
  const choisir = (t) => t[Math.floor(alea() * t.length)];
  const hash = (tel) => createHash('sha256').update(tel).digest('hex');
  const destinataire = (tel) => `(SELECT id FROM destinataires WHERE telephone_hash = '${hash(tel)}')`;
  const utilisateur = (tel) => `(SELECT id FROM utilisateurs WHERE telephone_hash = '${hash(tel)}')`;
  const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
  const pt = (l) => `ST_SetSRID(ST_MakePoint(${l.lon}, ${l.lat}), 4326)::geography`;

  const arrivees = [LIEUX.zoneBois, LIEUX.patteOie, LIEUX.citeAn3, LIEUX.tampouy, LIEUX.ouaga2000, LIEUX.dassasgho, LIEUX.pissy, LIEUX.gounghin];
  const telsDest = [TEL.dest1, TEL.dest2, TEL.dest3, TEL.client];
  const livreurs = Object.values(idsLivreurs);
  const colis = ['Ordonnance', 'Médicaments, sachet scellé', 'Lait infantile', 'Matériel médical', 'Crème et soins', 'Vitamines'];

  const debut = PREMIER_JOUR_HISTORIQUE();
  const hier = new Date();
  hier.setUTCHours(0, 0, 0, 0);

  const instructions = [];
  for (let jour = new Date(debut); jour < hier; jour = new Date(jour.getTime() + 86400000)) {
    const moisCourant = jour.getUTCMonth() === new Date().getUTCMonth();
    const dimanche = jour.getUTCDay() === 0;
    // Croissance d'un mois sur l'autre : c'est ce qu'un patron veut voir, et
    // la démo doit montrer que l'écran le fait apparaître.
    const parJour = dimanche ? Math.round(entre(0, 1.4)) : Math.round(entre(moisCourant ? 2 : 1, moisCourant ? 4.6 : 3.6));
    for (let k = 0; k < parJour; k++) {
      const cree = new Date(jour.getTime() + entre(7, 18.5) * 3600000);
      const parPartenaire = alea() < 0.72;
      const depart = parPartenaire ? LIEUX.pharmacie : choisir([LIEUX.roodWoko, LIEUX.gounghin]);
      const arrivee = choisir(arrivees.filter((a) => a !== depart));
      const km = distanceKm(depart, arrivee);
      const prix = parPartenaire ? prixDemo(km) : null;
      const annulee = alea() < (moisCourant ? 0.05 : 0.09);
      const livreur = choisir(livreurs);
      // Le mois en cours est un peu plus réactif : l'outil fait gagner du temps.
      const tAssign = new Date(cree.getTime() + entre(2, moisCourant ? 9 : 15) * 60000);
      const tRecup = new Date(tAssign.getTime() + entre(8, 22) * 60000);
      const tLivre = new Date(tRecup.getTime() + (km * 2.6 + entre(6, 14)) * 60000);
      const fin = annulee ? new Date(cree.getTime() + entre(2, 8) * 60000) : tLivre;
      const auteurCreation = parPartenaire ? (alea() < 0.6 ? TEL.partenaire : TEL.collaboratrice) : TEL.compagnie;
      const roleCreation = parPartenaire ? (auteurCreation === TEL.partenaire ? 'partenaire' : 'collaborateur') : 'compagnie';

      const evts = [[`'creee'`, utilisateur(auteurCreation), lit(roleCreation), cree, 'NULL']];
      if (annulee) {
        evts.push([`'annulee'`, utilisateur(auteurCreation), lit(roleCreation), fin, 'NULL']);
      } else {
        evts.push([`'assignee'`, utilisateur(TEL.compagnie), `'compagnie'`, tAssign, lit(JSON.stringify({ livreur_id: livreur }))]);
        evts.push([`'recuperee'`, 'NULL', `'livreur'`, tRecup, 'NULL']);
        evts.push([`'en_route'`, 'NULL', `'livreur'`, new Date(tRecup.getTime() + 60000), 'NULL']);
        evts.push([`'livree'`, 'NULL', `'livreur'`, tLivre, 'NULL']);
      }
      const valeursEvts = evts
        .map(([t, a, r, d, det]) => `(${t}, ${a}, ${r}, ${lit(d.toISOString())}::timestamptz, ${det === 'NULL' ? 'NULL' : det + '::jsonb'})`)
        .join(', ');

      instructions.push(`
WITH n AS (
  UPDATE compagnies SET compteur_courses = compteur_courses + 1 WHERE id = ${lit(compagnieId)} RETURNING compteur_courses
), c AS (
  INSERT INTO courses (compagnie_id, destinataire_id, livreur_id, partenaire_id, cree_par, numero, statut,
    adresse_depart, repere_depart, point_depart, adresse_arrivee, repere_arrivee, point_arrivee,
    description_colis, prix_estime, distance_estimee_m, bareme_id, created_at, updated_at)
  SELECT ${lit(compagnieId)}, ${destinataire(choisir(telsDest))}, ${annulee ? 'NULL' : lit(livreur)},
    ${parPartenaire ? lit(partenaireId) : 'NULL'}, ${utilisateur(auteurCreation)}, n.compteur_courses,
    ${annulee ? `'annulee'` : `'livree'`},
    ${lit(depart.adresse)}, ${depart.repere ? lit(depart.repere) : 'NULL'}, ${parPartenaire ? pt(depart) : 'NULL'},
    ${lit(arrivee.adresse)}, ${arrivee.repere ? lit(arrivee.repere) : 'NULL'}, ${parPartenaire ? pt(arrivee) : 'NULL'},
    ${lit(choisir(colis))}, ${prix ?? 'NULL'}, ${parPartenaire ? Math.round(km * 1000) : 'NULL'},
    ${parPartenaire ? `(SELECT id FROM baremes_livraison WHERE compagnie_id = ${lit(compagnieId)} ORDER BY created_at DESC LIMIT 1)` : 'NULL'},
    ${lit(cree.toISOString())}::timestamptz, ${lit(fin.toISOString())}::timestamptz
  FROM n RETURNING id
)
INSERT INTO evenements_course (course_id, type, auteur_id, auteur_role, created_at, details)
SELECT c.id, v.t, v.a::uuid, v.r, v.d, v.det::jsonb FROM c,
  (VALUES ${valeursEvts}) AS v(t, a, r, d, det);`);
    }
  }

  // Les destinataires fictifs n'existent qu'une fois commandés par l'API, plus
  // loin dans le script : on les crée ici d'abord, sous le même nom.
  const noms = { [TEL.dest1]: 'Moussa Ilboudo', [TEL.dest2]: 'Fatimata Sanou', [TEL.dest3]: 'Rasmané Kaboré' };
  const destinataires = Object.entries(noms)
    .map(([tel, nom]) => `INSERT INTO destinataires (nom, telephone_hash) VALUES (${lit(nom)}, '${hash(tel)}') ON CONFLICT (telephone_hash) DO NOTHING;`)
    .join('\n');
  psql(destinataires + '\n' + instructions.join('\n'));
  return instructions.length;
}

/** Dépose des positions une par une, horodatage laissé au serveur (voir CLAUDE.md, rejeu du trajet). */
async function deposerTrajet(tokenLivreur, points) {
  for (const p of points) {
    await appel('POST', '/api/livreurs/me/positions', { positions: [p] }, tokenLivreur);
  }
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
      console.error('  échec : Postgres est-il démarré (port 55020) et Go installé ?');
      process.exit(1);
    }
  }

  console.log('== Compagnie ==');
  const compagnie = await appel('POST', '/api/auth/register-compagnie', {
    nom_compagnie: 'Fiyen Démo',
    telephone: TEL.compagnie,
    mot_de_passe: MDP,
  });
  const tc = compagnie.token;
  console.log('  Fiyen Démo');

  console.log('== Barème de livraison (exemple de démo) ==');
  // Publié avant les commandes pour qu'elles portent un prix. Ce sont les
  // prix de la compagnie fictive, pas une grille recommandée.
  await appel('POST', '/api/dashboard/bareme', {
    mode: 'paliers',
    coefficient_detour: 1.3,
    arrondi: 50,
    paliers: [
      { jusqu_a_km: 3, prix: 1000 },
      { jusqu_a_km: 8, prix: 1500 },
      { jusqu_a_km: 15, prix: 2500 },
    ],
    motif: 'Grille de lancement (démo)',
  }, tc);
  console.log('  par zones : ≤ 3 km 1 000 F · ≤ 8 km 1 500 F · ≤ 15 km 2 500 F');

  console.log('== Livreurs ==');
  const creerLivreur = (nom, telephone) =>
    appel('POST', '/api/livreurs/', { nom, telephone, mot_de_passe: MDP }, tc);
  const ids = {
    salif: (await creerLivreur('Salif Traoré', TEL.livreur1)).id,
    aminata: (await creerLivreur('Aminata Zongo', TEL.livreur2)).id,
    issouf: (await creerLivreur('Issouf Sawadogo', TEL.livreur3)).id,
    boukary: (await creerLivreur('Boukary Compaoré', TEL.livreur4)).id,
  };
  const jetons = {
    salif: await connexion(TEL.livreur1),
    aminata: await connexion(TEL.livreur2),
    issouf: await connexion(TEL.livreur3),
    boukary: await connexion(TEL.livreur4),
  };
  for (const t of Object.values(jetons)) {
    await appel('PATCH', '/api/livreurs/me/statut', { statut: 'dispo' }, t);
  }
  console.log('  Salif Traoré, Aminata Zongo, Issouf Sawadogo, Boukary Compaoré');

  console.log('== Destinataire avec compte ==');
  const client = await appel('POST', '/api/auth/register-destinataire', {
    nom: 'Awa Ouédraogo',
    telephone: TEL.client,
    mot_de_passe: MDP,
  });
  console.log('  Awa Ouédraogo');

  console.log('== Partenaire et collaboratrice ==');
  const partenaire = await appel('POST', '/api/partenaires/', {
    nom: 'Pharmacie du Progrès',
    repere: LIEUX.pharmacie.repere,
    telephone: TEL.partenaire,
    mot_de_passe: MDP,
  }, tc);
  const tp = await connexion(TEL.partenaire);
  const invitation = await appel('POST', `/api/partenaires/${partenaire.id}/collaborateurs`, {
    nom: 'Mariam Kaboré',
    telephone: TEL.collaboratrice,
  }, tc);
  const collab = await appel('POST', '/api/auth/activer-collaborateur', {
    telephone: TEL.collaboratrice,
    code: invitation.code,
    mot_de_passe: MDP,
  });
  const tm = collab.token;
  console.log('  Pharmacie du Progrès + Mariam Kaboré (collaboratrice)');

  console.log('== Historique de deux mois (statistiques) ==');
  try {
    const n = insererHistorique(compagnie.compagnie_id, ids, partenaire.id);
    console.log(`  ${n} courses datées du ${PREMIER_JOUR_HISTORIQUE().toLocaleDateString('fr-FR')} à hier`);
  } catch (e) {
    console.log(`  ignoré : ${(e.stderr?.toString() || e.message).trim().split('\n').pop()}`);
  }

  // Une commande passée par le partenaire, depuis sa pharmacie.
  const commander = (token, dest, telDest, arrivee, colis, instructions = '') =>
    appel('POST', '/api/commandes/', {
      destinataire_nom: dest,
      destinataire_telephone: telDest,
      adresse_depart: LIEUX.pharmacie.adresse,
      repere_depart: LIEUX.pharmacie.repere,
      latitude_depart: LIEUX.pharmacie.lat,
      longitude_depart: LIEUX.pharmacie.lon,
      adresse_arrivee: arrivee.adresse,
      repere_arrivee: arrivee.repere ?? '',
      latitude_arrivee: arrivee.lat,
      longitude_arrivee: arrivee.lon,
      description_colis: colis,
      instructions,
    }, token);

  /** Fait vivre une course jusqu'à « livrée », positions comprises. */
  async function livrer(courseId, qui, depart, arrivee) {
    await appel('PATCH', `/api/courses/${courseId}/assigner`, { livreur_id: ids[qui] }, tc);
    await deposerTrajet(jetons[qui], [{ latitude: depart.lat, longitude: depart.lon }]);
    await appel('PATCH', `/api/courses/${courseId}/statut`, { statut: 'recuperee' }, jetons[qui]);
    await appel('PATCH', `/api/courses/${courseId}/statut`, { statut: 'en_route' }, jetons[qui]);
    await deposerTrajet(jetons[qui], pointsEntre(depart, arrivee));
    await appel('PATCH', `/api/courses/${courseId}/statut`, { statut: 'livree' }, jetons[qui]);
  }

  console.log('== Historique livré ==');
  const historique = [
    [tp, 'Moussa Ilboudo', TEL.dest1, LIEUX.zoneBois, 'Ordonnance + 2 boîtes de paracétamol', 'issouf'],
    [tm, 'Fatimata Sanou', TEL.dest2, LIEUX.patteOie, 'Sachet scellé, traitement antipaludique', 'aminata'],
    [tp, 'Awa Ouédraogo', TEL.client, LIEUX.citeAn3, 'Lait infantile, 2 boîtes', 'salif'],
    [tm, 'Rasmané Kaboré', TEL.dest3, LIEUX.tampouy, 'Tensiomètre (carton)', 'boukary'],
    [tp, 'Moussa Ilboudo', TEL.dest1, LIEUX.zoneBois, 'Renouvellement d’ordonnance', 'aminata'],
    [tm, 'Fatimata Sanou', TEL.dest2, LIEUX.patteOie, 'Crème dermatologique', 'issouf'],
  ];
  for (const [token, nom, tel, lieu, colis, qui] of historique) {
    const c = await commander(token, nom, tel, lieu, colis);
    await livrer(c.id, qui, LIEUX.pharmacie, lieu);
    console.log(`  ${c.numero} livrée — ${nom}, ${lieu.adresse}`);
  }
  // Deux courses saisies par la compagnie elle-même (commande reçue au téléphone).
  for (const [dep, arr, qui] of [
    [LIEUX.roodWoko, LIEUX.dassasgho, 'boukary'],
    [LIEUX.gounghin, LIEUX.pissy, 'salif'],
  ]) {
    const c = await appel('POST', '/api/courses/', {
      destinataire_id: client.destinataire_id,
      adresse_depart: dep.adresse,
      adresse_arrivee: arr.adresse,
    }, tc);
    await livrer(c.id, qui, dep, arr);
    console.log(`  course compagnie livrée — ${dep.adresse} → ${arr.adresse}`);
  }

  console.log('== Annulation ==');
  const annulee = await commander(tp, 'Rasmané Kaboré', TEL.dest3, LIEUX.tampouy, 'Commande en double');
  await appel('POST', `/api/commandes/${annulee.id}/annuler`, null, tp);
  console.log(`  ${annulee.numero} annulée par le partenaire`);

  console.log('== Courses en cours ==');
  // Course en route, commandée par la collaboratrice : de quoi suivre en direct
  // côté partenaire (simuler-flotte.mjs fait avancer Aminata).
  const enRoute = await commander(tm, 'Fatimata Sanou', TEL.dest2, LIEUX.ouaga2000,
    'Insuline (glacière)', 'Garder au frais, remettre en main propre');
  await appel('PATCH', `/api/courses/${enRoute.id}/assigner`, { livreur_id: ids.aminata }, tc);
  await appel('PATCH', `/api/courses/${enRoute.id}/statut`, { statut: 'recuperee' }, jetons.aminata);
  await appel('PATCH', `/api/courses/${enRoute.id}/statut`, { statut: 'en_route' }, jetons.aminata);
  await deposerTrajet(jetons.aminata, pointsEntre(LIEUX.pharmacie, LIEUX.ouaga2000).slice(0, 3));
  console.log(`  ${enRoute.numero} en route avec Aminata → Ouaga 2000`);

  console.log('== Courses en attente ==');
  const attente = await commander(tp, 'Awa Ouédraogo', TEL.client, LIEUX.citeAn3,
    'Vitamines et sirop pour enfant', 'Sonner deux fois');
  console.log(`  ${attente.numero} commandée par la pharmacie, à assigner (file « Commandes entrantes »)`);
  await appel('POST', '/api/courses/', {
    destinataire_id: client.destinataire_id,
    adresse_depart: LIEUX.roodWoko.adresse,
    adresse_arrivee: LIEUX.ouaga2000.adresse,
  }, tc);
  console.log('  Rood Woko → Ouaga 2000 : course compagnie en attente');

  // Course 1, créée en dernier pour être la plus récente côté destinataire :
  // assignée à Salif, suivi et chat masqué utilisables tout de suite
  // (test-masquage-ui.mjs s'appuie dessus).
  const course1 = await appel('POST', '/api/courses/', {
    destinataire_id: client.destinataire_id,
    adresse_depart: LIEUX.gounghin.adresse,
    adresse_arrivee: LIEUX.citeAn3.adresse,
  }, tc);
  await appel('PATCH', `/api/courses/${course1.id}/assigner`, { livreur_id: ids.salif }, tc);
  await deposerTrajet(jetons.salif, [{ latitude: LIEUX.gounghin.lat, longitude: LIEUX.gounghin.lon }]);
  console.log('  Gounghin → Cité An III : assignée à Salif (suivi + chat prêts)');

  // Issouf reste disponible pour l'assignation en direct ; Boukary finit son service.
  await deposerTrajet(jetons.issouf, [{ latitude: LIEUX.roodWoko.lat, longitude: LIEUX.roodWoko.lon }]);
  await appel('PATCH', '/api/livreurs/me/statut', { statut: 'offline' }, jetons.boukary);

  console.log('== Barème tarifaire ==');
  // Pas d'API d'écriture : le barème est administré hors application pour l'instant.
  // Valeurs d'exemple, pas une grille commerciale.
  try {
    psql(`INSERT INTO config_tarifaire
            (compagnie_id, abonnement_mensuel, livreurs_inclus, commission_pourcentage, devise)
          VALUES ('${compagnie.compagnie_id}', 50000, 10, 12.5, 'XOF')`);
    console.log('  50 000 XOF/mois, 10 livreurs inclus, 12,5 % de commission (exemple)');
  } catch {
    console.log('  ignoré (base injoignable)');
  }

  console.log(`
================= IDENTIFIANTS DE DÉMO =================
Mot de passe pour tous les comptes : ${MDP}

  Dashboard compagnie   http://localhost:5173
    ${TEL.compagnie}   Fiyen Démo

  App partenaire        http://localhost:5177
    ${TEL.partenaire}   Pharmacie du Progrès (compte principal)
    ${TEL.collaboratrice}   Mariam Kaboré (collaboratrice)

  App livreur (PWA)     http://localhost:5175
    ${TEL.livreur1}   Salif Traoré — course assignée (Gounghin → Cité An III)
    ${TEL.livreur2}   Aminata Zongo — en route vers Ouaga 2000
    ${TEL.livreur3}   Issouf Sawadogo — disponible
    ${TEL.livreur4}   Boukary Compaoré — hors service

  App destinataire      http://localhost:5176
    ${TEL.client}   Awa Ouédraogo

Pour animer la carte : node backend/scripts/simuler-flotte.mjs
========================================================`);
}

main().catch((err) => {
  console.error(`\nÉchec : ${err.message}`);
  console.error('Si les comptes de démo existent déjà, relancez avec --reset.');
  process.exit(1);
});
