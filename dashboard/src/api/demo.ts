/**
 * Mode démo du dashboard : un faux serveur Fiyen embarqué dans la page.
 *
 * Activé uniquement par VITE_DEMO=1 (`npm run build:demo`). Les données sont
 * celles du jeu de démo (`backend/scripts/seed-demo.mjs`), enregistrées une fois
 * dans `demo-donnees.json`, puis rejouées ici. Les dates sont décalées à
 * l'ouverture pour que « il y a 2 h » reste vrai quel que soit le jour où le
 * prospect ouvre le fichier. Rien ne quitte le navigateur, hormis les tuiles de
 * la carte.
 */

import donnees from './demo-donnees.json';
import type { CommandeEntrante, Course, Livreur, StatutCourse, StatutLivreur } from './types';

export const MODE_DEMO = import.meta.env.VITE_DEMO === '1';

export const IDENTIFIANTS_DEMO = { telephone: '+22670001000', motDePasse: 'motdepasse123' };

type Routes = Record<string, unknown>;

// ---------------------------------------------------------------- décalage des dates

const CAPTURE = Date.parse((donnees as { capture_le: string }).capture_le);
const DECALAGE_MS = Date.now() - CAPTURE;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function decaler<T>(v: T): T {
  if (typeof v === 'string' && ISO.test(v)) {
    return new Date(Date.parse(v) + DECALAGE_MS).toISOString() as T;
  }
  if (Array.isArray(v)) return v.map(decaler) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = decaler(x);
    return o as T;
  }
  return v;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** « 2026-11 » demandé aujourd'hui → mois correspondant au moment de l'enregistrement. */
function moisEnregistre(mois: string): string {
  const [a, m] = mois.split('-').map(Number);
  const aujourdHui = new Date();
  const capture = new Date(CAPTURE);
  const ecart =
    (aujourdHui.getUTCFullYear() - capture.getUTCFullYear()) * 12 +
    (aujourdHui.getUTCMonth() - capture.getUTCMonth());
  return new Date(Date.UTC(a, m - 1 - ecart, 1)).toISOString().slice(0, 7);
}

// ---------------------------------------------------------------- état

const R = (donnees as { routes: Routes }).routes;
const CSV = (donnees as { export_csv: Record<string, string> }).export_csv;

interface Partenaire {
  id: string;
  compagnie_id?: string;
  nom: string;
  repere?: string;
  statut: 'actif' | 'suspendu';
  visibilite_collaborateurs: 'entreprise' | 'personnelle';
  nb_collaborateurs: number;
  nb_courses: number;
  created_at: string;
}
interface Collaborateur {
  id: string;
  nom: string;
  role: 'partenaire' | 'collaborateur';
  actif: boolean;
  nb_courses: number;
  created_at?: string;
}
interface Invitation {
  id: string;
  nom: string;
  expire_at: string;
  code?: string;
}
interface Collabs {
  collaborateurs: Collaborateur[];
  invitations?: Invitation[];
  [k: string]: unknown;
}

const nouvelId = () => 'demo-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const maintenant = () => new Date().toISOString();
const ilYA = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();

const destinataires: Record<string, string> = {};

const etat = {
  livreurs: decaler(clone(R['/api/livreurs/'] as Livreur[])),
  courses: decaler(clone(R['/api/courses/'] as Course[])),
  entrantes: decaler(clone(R['/api/dashboard/commandes-entrantes'] as CommandeEntrante[])),
  partenaires: decaler(clone(R['/api/partenaires/'] as Partenaire[])),
  collabs: {} as Record<string, Collabs>,
  bareme: decaler(clone(R['/api/dashboard/bareme'])) as {
    actuel: Record<string, unknown> | null;
    historique: Record<string, unknown>[];
  },
  recus: {} as Record<string, Record<string, unknown>>,
  numero: 1142,
};

for (const p of etat.partenaires) {
  etat.collabs[p.id] = decaler(clone(R[`/api/partenaires/${p.id}/collaborateurs`] as Collabs));
}

// Le jeu de démo crée toutes ses courses au même instant : la liste afficherait
// 141 fois la même date. On étale l'historique sur deux mois (déterministe),
// les courses en cours restent récentes.
{
  let rang = 0;
  for (const c of etat.courses) {
    if (c.statut !== 'livree' && c.statut !== 'annulee') {
      const debut = Date.now() - (20 + 15 * rang++) * 60_000;
      c.created_at = new Date(debut).toISOString();
      c.updated_at = new Date(debut + 10 * 60_000).toISOString();
    }
  }
  const finies = etat.courses.filter((c) => c.statut === 'livree' || c.statut === 'annulee');
  finies.forEach((c, i) => {
    const pas = (60 * 86_400_000) / Math.max(finies.length, 1);
    // Heures de bureau à Ouaga (8 h – 19 h UTC), pas de course à 3 h du matin.
    const jour = new Date(Date.now() - 3 * 3_600_000 - i * pas);
    jour.setUTCHours(8 + ((i * 7) % 11), (i * 17) % 60, 0, 0);
    c.created_at = jour.toISOString();
    c.updated_at = new Date(jour.getTime() + (25 + ((i * 13) % 35)) * 60_000).toISOString();
  });
}

// Le jeu de démo n'a qu'un partenaire : on en ajoute trois pour un écran crédible.
const AUTRES_PARTENAIRES: Array<[string, string, number, number, number]> = [
  ['Boulangerie Wend Kuuni', 'Gounghin, en face de l’école', 2, 31, 38],
  ['Clinique Les Genêts', 'Koulouba, portail bleu', 3, 18, 25],
  ['Marina Market Zone du Bois', 'Zone du Bois, parking client', 1, 9, 12],
];
for (const [nom, repere, nbc, nbcourses, jours] of AUTRES_PARTENAIRES) {
  const id = nouvelId();
  etat.partenaires.push({
    id,
    nom,
    repere,
    statut: 'actif',
    visibilite_collaborateurs: 'entreprise',
    nb_collaborateurs: nbc,
    nb_courses: nbcourses,
    created_at: ilYA(jours),
  });
  etat.collabs[id] = {
    collaborateurs: [
      { id: nouvelId(), nom, role: 'partenaire', actif: true, nb_courses: Math.round(nbcourses * 0.6), created_at: ilYA(jours) },
      ...['Fatimata Sawadogo', 'Ali Zerbo', 'Rasmata Kinda'].slice(0, nbc - 1).map((n, i) => ({
        id: nouvelId(),
        nom: n,
        role: 'collaborateur' as const,
        actif: true,
        nb_courses: Math.round((nbcourses * 0.4) / (i + 1)),
        created_at: ilYA(jours - 3),
      })),
    ],
    invitations: [],
  };
}

const livreur = (id: string | null | undefined) => etat.livreurs.find((l) => l.id === id);

function majStatutLivreurs() {
  for (const l of etat.livreurs) {
    if (l.statut === 'offline') continue;
    const occupe = etat.courses.some(
      (c) => c.livreur_id === l.id && ['assignee', 'recuperee', 'en_route'].includes(c.statut),
    );
    l.statut = occupe ? 'en_course' : 'dispo';
  }
}

function recuDe(courseId: string): Record<string, unknown> | null {
  if (etat.recus[courseId]) return etat.recus[courseId];
  const enr = R[`/api/courses/${courseId}/recu`];
  if (enr) return (etat.recus[courseId] = decaler(clone(enr)) as Record<string, unknown>);
  return null;
}

function journaliser(courseId: string, type: string, details?: Record<string, string>) {
  const recu = recuDe(courseId);
  if (!recu) return;
  (recu.journal as unknown[]).push({
    type,
    auteur_role: type === 'assignee' ? 'compagnie' : 'livreur',
    ...(details ? { details } : {}),
    horodatage: maintenant(),
  });
  recu.statut = etat.courses.find((c) => c.id === courseId)?.statut;
}

// ---------------------------------------------------------------- course en direct

/** Après une assignation, la course avance seule : la démo montre le suivi. */
function faireAvancer(courseId: string) {
  const etapes: Array<[number, StatutCourse]> = [
    [15_000, 'recuperee'],
    [30_000, 'en_route'],
    [75_000, 'livree'],
  ];
  for (const [delai, statut] of etapes) {
    setTimeout(() => {
      const c = etat.courses.find((x) => x.id === courseId);
      if (!c || c.statut === 'annulee' || c.statut === 'livree') return;
      c.statut = statut;
      c.updated_at = maintenant();
      journaliser(courseId, statut);
      majStatutLivreurs();
    }, delai);
  }
}

// ---------------------------------------------------------------- positions (remplace la WebSocket)

const CENTRE = { lat: 12.3714, lng: -1.5197 };
export interface MessagePositionDemo {
  livreur_id: string;
  latitude: number;
  longitude: number;
  horodatage: string;
}
type AbonnePosition = (m: MessagePositionDemo) => void;
const abonnesPositions = new Set<AbonnePosition>();
let minuteurPositions: number | null = null;
const phases: Record<string, number> = {};

function tickPositions() {
  etat.livreurs.forEach((l, i) => {
    if (l.statut === 'offline') return;
    // Chaque livreur tourne sur sa propre boucle dans Ouaga ; plus vite en course.
    const vitesse = l.statut === 'en_course' ? 0.045 : 0.012;
    phases[l.id] = (phases[l.id] ?? i * 1.7) + vitesse;
    const t = phases[l.id];
    const rayon = 0.018 + 0.006 * i;
    const lat = CENTRE.lat + Math.sin(i * 2.1) * 0.02 + rayon * Math.sin(t);
    const lng = CENTRE.lng + Math.cos(i * 2.1) * 0.025 + rayon * Math.cos(t * 0.8);
    l.latitude = +lat.toFixed(5);
    l.longitude = +lng.toFixed(5);
    l.position_updated_at = maintenant();
    l.en_ligne = true;
    const msg = { livreur_id: l.id, latitude: l.latitude, longitude: l.longitude, horodatage: l.position_updated_at };
    abonnesPositions.forEach((cb) => cb(msg));
  });
}

export function abonnerPositions(cb: AbonnePosition): () => void {
  abonnesPositions.add(cb);
  if (minuteurPositions === null) minuteurPositions = window.setInterval(tickPositions, 2000);
  return () => {
    abonnesPositions.delete(cb);
    if (abonnesPositions.size === 0 && minuteurPositions !== null) {
      clearInterval(minuteurPositions);
      minuteurPositions = null;
    }
  };
}

// ---------------------------------------------------------------- barème

interface Bareme {
  mode: 'forfait' | 'paliers' | 'distance';
  prix_forfait?: number;
  paliers?: { jusqu_a_km: number; prix: number }[];
  prix_base?: number;
  prix_par_km?: number;
  prix_minimum?: number;
  coefficient_detour: number;
  arrondi: number;
}

function prix(b: Bareme, km: number): { prix: number | null; raison?: string } {
  const d = km * (b.coefficient_detour || 1);
  let p: number;
  if (b.mode === 'forfait') p = b.prix_forfait ?? 0;
  else if (b.mode === 'paliers') {
    const palier = [...(b.paliers ?? [])]
      .sort((x, y) => x.jusqu_a_km - y.jusqu_a_km)
      .find((x) => d <= x.jusqu_a_km);
    if (!palier) return { prix: null, raison: 'Au-delà du dernier palier' };
    p = palier.prix;
  } else {
    p = Math.max(b.prix_minimum ?? 0, (b.prix_base ?? 0) + (b.prix_par_km ?? 0) * d);
  }
  const a = b.arrondi || 1;
  return { prix: Math.ceil(p / a) * a };
}

// ---------------------------------------------------------------- faux serveur

export class ErreurDemo extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function jetonDemo(): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const compagnie = etat.courses[0]?.compagnie_id ?? 'demo-compagnie';
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ utilisateur_id: 'demo', role: 'compagnie', compagnie_id: compagnie, exp })}.demo`;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function corps(options: RequestInit): Record<string, unknown> {
  try {
    return typeof options.body === 'string' ? JSON.parse(options.body) : {};
  } catch {
    return {};
  }
}

function compter(statuts: string[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const s of statuts) acc[s] = (acc[s] ?? 0) + 1;
  return acc;
}

export async function repondreDemo<T>(path: string, options: RequestInit = {}): Promise<T> {
  await attendre(120 + Math.random() * 180);
  const methode = (options.method ?? 'GET').toUpperCase();
  const b = corps(options);
  const [chemin, chaine = ''] = path.split('?');
  const params = new URLSearchParams(chaine);
  const ok = (v: unknown) => clone(v) as T;
  let m: RegExpMatchArray | null;

  // ---- authentification
  if (chemin === '/api/auth/login' && methode === 'POST') {
    if (b.telephone !== IDENTIFIANTS_DEMO.telephone || b.mot_de_passe !== IDENTIFIANTS_DEMO.motDePasse) {
      throw new ErreurDemo('Identifiants incorrects (démo : +22670001000 / motdepasse123)', 401);
    }
    return ok({ token: jetonDemo(), refresh_token: 'demo-refresh', role: 'compagnie' });
  }
  if (chemin === '/api/auth/register-compagnie' && methode === 'POST') {
    return ok({ token: jetonDemo(), refresh_token: 'demo-refresh', compagnie_id: 'demo-compagnie' });
  }

  // ---- tableau de bord
  if (chemin === '/api/dashboard/stats') {
    return ok({
      courses_par_statut: compter(etat.courses.map((c) => c.statut)),
      livreurs_par_statut: compter(etat.livreurs.map((l) => l.statut)) as Partial<Record<StatutLivreur, number>>,
    });
  }
  if (chemin === '/api/dashboard/config-tarifaire') return ok(decaler(R['/api/dashboard/config-tarifaire']));
  if (chemin === '/api/dashboard/commandes-entrantes') {
    return ok(etat.entrantes.filter((c) => c.statut === 'en_attente'));
  }
  if (chemin === '/api/dashboard/statistiques') {
    const mois = params.get('mois') ?? new Date().toISOString().slice(0, 7);
    const enr = R[`/api/dashboard/statistiques?mois=${moisEnregistre(mois)}`];
    if (!enr) throw new ErreurDemo('Pas de données pour ce mois dans la démo', 404);
    return ok({ ...(decaler(clone(enr)) as object), mois });
  }

  // ---- barème
  if (chemin === '/api/dashboard/bareme' && methode === 'GET') return ok(etat.bareme);
  if (chemin === '/api/dashboard/bareme/apercu' && methode === 'POST') {
    const bareme = b.bareme as Bareme;
    const distances = (b.distances_km as number[]) ?? [];
    return ok({ lignes: distances.map((km) => ({ distance_km: km, ...prix(bareme, km) })) });
  }
  if (chemin === '/api/dashboard/bareme' && methode === 'POST') {
    const { motif, ...bareme } = b;
    const version = { ...bareme, id: nouvelId(), motif, auteur_role: 'compagnie', created_at: maintenant() };
    if (etat.bareme.actuel) etat.bareme.historique.unshift(etat.bareme.actuel);
    etat.bareme.actuel = version;
    return ok(version);
  }

  // ---- livreurs
  if (chemin === '/api/livreurs/' && methode === 'GET') return ok(etat.livreurs);
  if (chemin === '/api/livreurs/' && methode === 'POST') {
    if (!b.nom || !b.telephone) throw new ErreurDemo('Nom et téléphone obligatoires', 400);
    const l: Livreur = {
      id: nouvelId(),
      nom: String(b.nom),
      statut: 'offline',
      created_at: maintenant(),
      latitude: null,
      longitude: null,
      position_updated_at: null,
      en_ligne: false,
    };
    etat.livreurs.push(l);
    return ok(l);
  }

  // ---- courses
  if (chemin === '/api/courses/' && methode === 'GET') {
    const statut = params.get('statut');
    const liste = statut ? etat.courses.filter((c) => c.statut === statut) : etat.courses;
    return ok(liste.length ? liste : null);
  }
  if (chemin === '/api/courses/' && methode === 'POST') {
    const c: Course = {
      id: nouvelId(),
      compagnie_id: etat.courses[0]?.compagnie_id ?? 'demo-compagnie',
      destinataire_id: String(b.destinataire_id),
      livreur_id: null,
      statut: 'en_attente',
      adresse_depart: String(b.adresse_depart),
      adresse_arrivee: String(b.adresse_arrivee),
      created_at: maintenant(),
      updated_at: maintenant(),
    };
    etat.courses.unshift(c);
    etat.recus[c.id] = {
      numero: `FY-${etat.numero++}`,
      statut: 'en_attente',
      compagnie_nom: 'Fiyen Démo',
      destinataire_nom: destinataires[c.destinataire_id] ?? 'Awa Ouédraogo',
      adresse_depart: c.adresse_depart,
      adresse_arrivee: c.adresse_arrivee,
      journal: [{ type: 'creee', auteur_role: 'compagnie', horodatage: c.created_at }],
      cree_le: c.created_at,
      emis_le: c.created_at,
    };
    return ok(c);
  }
  if ((m = chemin.match(/^\/api\/courses\/([^/]+)\/assigner$/)) && methode === 'PATCH') {
    const id = m[1];
    const l = livreur(b.livreur_id as string);
    if (!l) throw new ErreurDemo('Livreur introuvable', 404);
    if (l.statut !== 'dispo') throw new ErreurDemo('Ce livreur n’est pas disponible', 409);
    let c = etat.courses.find((x) => x.id === id);
    const entrante = etat.entrantes.find((x) => x.id === id);
    if (!c && entrante) {
      c = {
        id,
        compagnie_id: etat.courses[0]?.compagnie_id ?? 'demo-compagnie',
        destinataire_id: 'demo-dest',
        livreur_id: null,
        statut: 'en_attente',
        adresse_depart: entrante.adresse_depart,
        adresse_arrivee: entrante.adresse_arrivee,
        created_at: entrante.created_at,
        updated_at: entrante.updated_at,
      };
      etat.courses.unshift(c);
    }
    if (!c) throw new ErreurDemo('Course introuvable', 404);
    if (c.statut !== 'en_attente') throw new ErreurDemo('Course déjà assignée', 409);
    c.statut = 'assignee';
    c.livreur_id = l.id;
    c.updated_at = maintenant();
    if (entrante) entrante.statut = 'assignee';
    const recu = recuDe(id);
    if (recu) recu.livreur_nom = l.nom;
    journaliser(id, 'assignee', { livreur_id: l.id });
    majStatutLivreurs();
    faireAvancer(id);
    return ok({ statut: 'assignee' });
  }
  if ((m = chemin.match(/^\/api\/courses\/([^/]+)\/recu$/))) {
    const id = m[1];
    const r = recuDe(id);
    if (!r) throw new ErreurDemo('Reçu introuvable', 404);
    return ok({ ...r, statut: etat.courses.find((c) => c.id === id)?.statut ?? r.statut, emis_le: maintenant() });
  }
  if ((m = chemin.match(/^\/api\/courses\/([^/]+)\/trajet$/))) {
    const t = R[`/api/courses/${m[1]}/trajet`];
    if (!t) throw new ErreurDemo('Aucun trajet enregistré', 404);
    return ok(decaler(t));
  }
  if ((m = chemin.match(/^\/api\/courses\/([^/]+)\/lien-partage$/)) && methode === 'POST') {
    return ok({ url: 'https://suivi.fiyen.example/demo', expire_le: new Date(Date.now() + 86_400_000).toISOString() });
  }

  // ---- destinataires
  if (chemin === '/api/destinataires/recherche') {
    const tel = (params.get('telephone') ?? '').replace(/\s/g, '');
    if (tel === '+22670001003') return ok(R['/api/destinataires/recherche?telephone=%2B22670001003']);
    if (!/^\+?\d{8,}$/.test(tel)) throw new ErreurDemo('Numéro invalide', 400);
    const id = 'demo-dest-' + tel.slice(-4);
    destinataires[id] = `Client ${tel.slice(-4)}`;
    return ok({ id, nom: destinataires[id] });
  }

  // ---- partenaires
  if (chemin === '/api/partenaires/' && methode === 'GET') return ok(etat.partenaires);
  if (chemin === '/api/partenaires/' && methode === 'POST') {
    const p: Partenaire = {
      id: nouvelId(),
      nom: String(b.nom),
      repere: b.repere ? String(b.repere) : undefined,
      statut: 'actif',
      visibilite_collaborateurs: 'entreprise',
      nb_collaborateurs: 1,
      nb_courses: 0,
      created_at: maintenant(),
    };
    etat.partenaires.push(p);
    etat.collabs[p.id] = {
      collaborateurs: [{ id: nouvelId(), nom: p.nom, role: 'partenaire', actif: true, nb_courses: 0 }],
      invitations: [],
    };
    return ok(p);
  }
  if ((m = chemin.match(/^\/api\/partenaires\/([^/]+)$/)) && methode === 'PATCH') {
    const id = m[1];
    const p = etat.partenaires.find((x) => x.id === id);
    if (!p) throw new ErreurDemo('Partenaire introuvable', 404);
    Object.assign(p, b);
    return ok(p);
  }
  if ((m = chemin.match(/^\/api\/partenaires\/([^/]+)\/collaborateurs$/))) {
    const c = (etat.collabs[m[1]] ??= { collaborateurs: [], invitations: [] });
    if (methode === 'GET') return ok(c);
    const inv: Invitation = {
      id: nouvelId(),
      nom: String(b.nom),
      expire_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      code: String(Math.floor(100000 + Math.random() * 900000)),
    };
    (c.invitations ??= []).push({ id: inv.id, nom: inv.nom, expire_at: inv.expire_at });
    return ok(inv);
  }
  if ((m = chemin.match(/^\/api\/partenaires\/([^/]+)\/collaborateurs\/([^/]+)$/)) && methode === 'PATCH') {
    const [, pid, cid] = m;
    const c = etat.collabs[pid]?.collaborateurs.find((x) => x.id === cid);
    if (!c) throw new ErreurDemo('Collaborateur introuvable', 404);
    Object.assign(c, b);
    return ok(c);
  }
  if ((m = chemin.match(/^\/api\/partenaires\/([^/]+)\/invitations\/([^/]+)$/)) && methode === 'DELETE') {
    const [, pid, iid] = m;
    const c = etat.collabs[pid];
    if (c) c.invitations = (c.invitations ?? []).filter((i) => i.id !== iid);
    return undefined as T;
  }

  throw new ErreurDemo(`Fonction absente de la démo : ${methode} ${chemin}`, 404);
}

/** Export CSV du mois, rejoué depuis l'enregistrement. */
export function csvDemo(path: string): string {
  const mois = new URLSearchParams(path.split('?')[1] ?? '').get('mois') ?? '';
  return CSV[moisEnregistre(mois)] ?? 'numero;statut\n';
}
