/**
 * Mode démo : un faux serveur Fiyen embarqué dans l'app.
 *
 * Activé uniquement par EXPO_PUBLIC_DEMO=1 (profil EAS « demo »). Il sert à
 * envoyer l'APK à un prospect qui n'a ni serveur ni compte : tout tourne dans
 * le téléphone, avec des données fictives. Les positions GPS ne quittent pas
 * l'appareil. Sans la variable, ce module ne change rien au comportement.
 */

import type { Course, Livreur, MessageMasque, SessionMasquage, StatutCourse } from './api';

export const MODE_DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

export const IDENTIFIANTS_DEMO = { telephone: '+22670000001', motDePasse: 'demo' };

/** Délai avant qu'une nouvelle course soit « assignée par la compagnie ». */
const DELAI_NOUVELLE_COURSE_MS = 8000;

// ---------------------------------------------------------------- données

const il_y_a = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const MODELES: Array<Pick<Course, 'adresse_depart' | 'adresse_arrivee'>> = [
  { adresse_depart: 'Pharmacie du Progrès, avenue Kwame Nkrumah', adresse_arrivee: 'Ouaga 2000, secteur 15, villa 112 (portail vert)' },
  { adresse_depart: 'Boulangerie Wend Kuuni, Gounghin', adresse_arrivee: 'Cité An III, immeuble B, 2e étage' },
  { adresse_depart: 'Marina Market, Zone du Bois', adresse_arrivee: 'Patte d’Oie, derrière la station-service' },
  { adresse_depart: 'Clinique Les Genêts, Koulouba', adresse_arrivee: 'Dassasgho, rue 28.45, porte 17' },
  { adresse_depart: 'Librairie Jeunesse d’Afrique, avenue de la Nation', adresse_arrivee: 'Tampouy, près du marché' },
];

interface Etat {
  livreur: Livreur;
  courses: Course[];
  messages: Record<string, MessageMasque[]>;
  prochainModele: number;
  minuteurCourse: ReturnType<typeof setTimeout> | null;
}

function etatInitial(): Etat {
  return {
    livreur: {
      id: 'demo-livreur',
      compagnie_id: 'demo-compagnie',
      nom: 'Issouf Ouédraogo',
      statut: 'offline',
      created_at: il_y_a(60 * 24 * 40),
    },
    courses: [
      {
        id: 'FY-1021',
        destinataire_id: 'demo-dest-1',
        livreur_id: 'demo-livreur',
        statut: 'assignee',
        ...MODELES[0],
        created_at: il_y_a(12),
        updated_at: il_y_a(4),
      },
      {
        id: 'FY-1018',
        destinataire_id: 'demo-dest-2',
        livreur_id: 'demo-livreur',
        statut: 'livree',
        adresse_depart: 'Restaurant Le Verdoyant, avenue Dimdolobsom',
        adresse_arrivee: 'Ministère de la Santé, Ouaga 2000',
        created_at: il_y_a(180),
        updated_at: il_y_a(140),
      },
    ],
    messages: {},
    prochainModele: 1,
    minuteurCourse: null,
  };
}

let etat = etatInitial();

/** Repart de zéro : appelée à chaque connexion pour que la démo se rejoue. */
export function reinitialiserDemo() {
  if (etat.minuteurCourse) clearTimeout(etat.minuteurCourse);
  etat = etatInitial();
}

// ---------------------------------------------------------------- règles

/** Mêmes transitions que le backend (internal/models.TransitionValide). */
const TRANSITIONS: Partial<Record<StatutCourse, StatutCourse[]>> = {
  en_attente: ['assignee', 'annulee'],
  assignee: ['recuperee', 'annulee'],
  recuperee: ['en_route', 'annulee'],
  en_route: ['livree'],
};

const ACTIVES: StatutCourse[] = ['assignee', 'recuperee', 'en_route'];

function majStatutLivreur() {
  if (etat.livreur.statut === 'offline') return;
  const enCourse = etat.courses.some((c) => c.statut === 'recuperee' || c.statut === 'en_route');
  etat.livreur.statut = enCourse ? 'en_course' : 'dispo';
}

/** Quand le livreur est libre et en service, la « compagnie » lui confie une course. */
function planifierNouvelleCourse() {
  if (etat.minuteurCourse || etat.livreur.statut === 'offline') return;
  if (etat.courses.some((c) => ACTIVES.includes(c.statut))) return;
  etat.minuteurCourse = setTimeout(() => {
    etat.minuteurCourse = null;
    if (etat.livreur.statut === 'offline') return;
    const modele = MODELES[etat.prochainModele % MODELES.length];
    etat.prochainModele += 1;
    const numero = 1021 + etat.prochainModele;
    etat.courses.unshift({
      id: `FY-${numero}`,
      destinataire_id: `demo-dest-${numero}`,
      livreur_id: 'demo-livreur',
      statut: 'assignee',
      ...modele,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }, DELAI_NOUVELLE_COURSE_MS);
}

// ---------------------------------------------------------------- faux serveur

export class ErreurDemo extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** btoa n'existe pas sur Hermes : encodage base64 manuel d'un texte ASCII. */
function base64(texte: string): string {
  let sortie = '';
  for (let i = 0; i < texte.length; i += 3) {
    const a = texte.charCodeAt(i);
    const b = i + 1 < texte.length ? texte.charCodeAt(i + 1) : -1;
    const c = i + 2 < texte.length ? texte.charCodeAt(i + 2) : -1;
    const n = (a << 16) | (Math.max(b, 0) << 8) | Math.max(c, 0);
    sortie += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    sortie += b < 0 ? '=' : ALPHABET[(n >> 6) & 63];
    sortie += c < 0 ? '=' : ALPHABET[n & 63];
  }
  return sortie;
}

/** Jeton au format JWT (non signé) : l'app n'en lit que `role` et `exp`. */
function jetonDemo(): string {
  const b64url = (o: object) =>
    base64(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ role: 'livreur', sub: 'demo-livreur', exp })}.demo`;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function corps(options: RequestInit): Record<string, unknown> {
  try {
    return typeof options.body === 'string' ? JSON.parse(options.body) : {};
  } catch {
    return {};
  }
}

function sessionDe(courseId: string): SessionMasquage {
  const course = etat.courses.find((c) => c.id === courseId);
  if (!course) throw new ErreurDemo('Course introuvable', 404);
  return {
    session_id: `sess-${courseId}`,
    course_id: courseId,
    expire_at: new Date(Date.now() + 3_600_000).toISOString(),
    role: 'livreur',
    active: course.statut !== 'livree' && course.statut !== 'annulee',
  };
}

/** Répond comme le backend Go, avec une latence réseau crédible. */
export async function repondreDemo<T>(path: string, options: RequestInit = {}): Promise<T> {
  await attendre(250 + Math.random() * 250);
  const methode = (options.method ?? 'GET').toUpperCase();
  const b = corps(options);
  let m: RegExpMatchArray | null;

  if (path === '/api/auth/login' && methode === 'POST') {
    if (b.telephone !== IDENTIFIANTS_DEMO.telephone || b.mot_de_passe !== IDENTIFIANTS_DEMO.motDePasse) {
      throw new ErreurDemo('Identifiants incorrects (démo : +22670000001 / demo)', 401);
    }
    reinitialiserDemo();
    return { token: jetonDemo(), refresh_token: 'demo-refresh', role: 'livreur' } as T;
  }

  if (path === '/api/livreurs/me') return { ...etat.livreur } as T;

  if (path === '/api/livreurs/me/statut' && methode === 'PATCH') {
    const cible = b.statut as 'dispo' | 'offline';
    if (cible === 'offline' && etat.livreur.statut === 'en_course') {
      throw new ErreurDemo('Terminez votre course avant de quitter le service', 409);
    }
    etat.livreur.statut = cible;
    majStatutLivreur();
    planifierNouvelleCourse();
    return { statut: etat.livreur.statut } as T;
  }

  if (path === '/api/courses/mes-courses') return etat.courses.map((c) => ({ ...c })) as T;

  if ((m = path.match(/^\/api\/courses\/([^/]+)\/statut$/)) && methode === 'PATCH') {
    const course = etat.courses.find((c) => c.id === m![1]);
    if (!course) throw new ErreurDemo('Course introuvable', 404);
    const cible = b.statut as StatutCourse;
    if (etat.livreur.statut === 'offline') {
      throw new ErreurDemo('Prenez votre service avant de commencer la course', 409);
    }
    if (!TRANSITIONS[course.statut]?.includes(cible)) {
      throw new ErreurDemo(`Transition refusée : ${course.statut} → ${cible}`, 409);
    }
    course.statut = cible;
    course.updated_at = new Date().toISOString();
    majStatutLivreur();
    if (cible === 'livree') planifierNouvelleCourse();
    return { statut: cible } as T;
  }

  if ((m = path.match(/^\/api\/courses\/([^/]+)\/masquage$/))) return sessionDe(m[1]) as T;

  if ((m = path.match(/^\/api\/masquage\/sess-([^/]+)\/messages$/))) {
    return [...(etat.messages[m[1]] ?? messagesDeDepart(m[1]))] as T;
  }

  if (path === '/api/notifications/jeton') return undefined as T;

  throw new ErreurDemo(`Route absente de la démo : ${methode} ${path}`, 404);
}

// ---------------------------------------------------------------- chat masqué

type Abonne = (message: MessageMasque) => void;
const abonnes: Record<string, Set<Abonne>> = {};

function messagesDeDepart(courseId: string): MessageMasque[] {
  const depart: MessageMasque[] = [
    {
      id: `${courseId}-0`,
      expediteur: 'destinataire',
      contenu: 'Bonjour, je suis disponible jusqu’à 18 h. Écrivez-moi ici en arrivant svp.',
      created_at: il_y_a(3),
    },
  ];
  etat.messages[courseId] = depart;
  return depart;
}

function reponseClient(contenu: string): string {
  const t = contenu.toLowerCase();
  if (/(arriv|devant|portail|suis là|suis la)/.test(t)) return 'D’accord, je descends tout de suite 🙏';
  if (/(retard|bouchon|embouteill|minute)/.test(t)) return 'Pas de souci, merci de prévenir.';
  if (/(où|adresse|repère|repere)/.test(t)) return 'Portail vert, à côté de la boutique de transfert d’argent.';
  return 'Merci, bien reçu !';
}

function diffuser(courseId: string, message: MessageMasque) {
  (etat.messages[courseId] ??= messagesDeDepart(courseId)).push(message);
  abonnes[courseId]?.forEach((cb) => cb(message));
}

/** Remplace la WebSocket : même forme de messages, même ordre d'arrivée. */
export const chatDemo = {
  abonner(sessionId: string, cb: Abonne): () => void {
    const courseId = sessionId.replace(/^sess-/, '');
    (abonnes[courseId] ??= new Set()).add(cb);
    return () => {
      abonnes[courseId]?.delete(cb);
    };
  },
  envoyer(sessionId: string, contenu: string) {
    const courseId = sessionId.replace(/^sess-/, '');
    const id = `${courseId}-${Date.now()}`;
    diffuser(courseId, { id, expediteur: 'livreur', contenu, created_at: new Date().toISOString() });
    setTimeout(() => {
      diffuser(courseId, {
        id: `${id}-r`,
        expediteur: 'destinataire',
        contenu: reponseClient(contenu),
        created_at: new Date().toISOString(),
      });
    }, 2200);
  },
};
