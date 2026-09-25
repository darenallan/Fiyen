import type { Trajet } from './CarteTrajet';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8090';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8090';

const CLE_TOKEN = 'fiyen_partenaire_token';
const CLE_REFRESH = 'fiyen_partenaire_refresh';

/**
 * Marge avant expiration à partir de laquelle on renouvelle sans attendre.
 * Le renouvellement doit être *proactif* et pas seulement déclenché par un 401 :
 * une WebSocket porte son jeton dans l'URL du handshake et ne peut pas rejouer
 * la connexion, donc le jeton doit déjà être frais quand elle s'ouvre.
 */
const MARGE_RENOUVELLEMENT_MS = 2 * 60 * 1000;

export type StatutCourse =
  | 'en_attente'
  | 'assignee'
  | 'recuperee'
  | 'en_route'
  | 'livree'
  | 'annulee';

export type RolePartenaire = 'partenaire' | 'collaborateur';

export interface Commande {
  id: string;
  /** Numéro court dictable au téléphone, « FY-1042 ». */
  numero: string;
  statut: StatutCourse;
  adresse_depart: string;
  repere_depart?: string;
  adresse_arrivee: string;
  repere_arrivee?: string;
  description_colis?: string;
  instructions?: string;
  destinataire_nom: string;
  latitude_depart?: number;
  longitude_depart?: number;
  latitude_arrivee?: number;
  longitude_arrivee?: number;
  cree_par_nom?: string;
  created_at: string;
  updated_at: string;
}

export interface Destinataire {
  nom: string;
  adresse_arrivee: string;
  repere_arrivee?: string;
  latitude?: number;
  longitude?: number;
  dernier_envoi: string;
  nombre_envois: number;
  derniere_course_id: string;
  description_habituelle?: string;
  telephone_masque: string;
}

export interface Partenaire {
  id: string;
  nom: string;
  repere?: string;
  statut: string;
  visibilite_collaborateurs: 'entreprise' | 'personnelle';
  nb_collaborateurs: number;
  nb_courses: number;
}

export interface Collaborateur {
  id: string;
  nom: string;
  role: RolePartenaire;
  actif: boolean;
  nb_courses: number;
}

export interface Invitation {
  id: string;
  nom: string;
  expire_at: string;
  code?: string;
}

export interface PreferenceNotification {
  evenement: string;
  libelle: string;
  actif: boolean;
  /** Faux quand aucun canal n'est prévu pour cette étape : le réglage est
   *  affiché mais grisé, plutôt qu'absent — le partenaire doit pouvoir
   *  constater qu'une étape existe et qu'elle ne le concerne pas. */
  modifiable: boolean;
}

/**
 * Changement d'état d'une commande, poussé en direct.
 *
 * Complète le rafraîchissement à 20 s plutôt que de le remplacer : sur un
 * réseau qui vacille, la socket tombe et c'est le sondage qui rattrape.
 */
export interface EvenementCourse {
  type: 'statut_course';
  course_id: string;
  /** Numéro court dictable au téléphone, « FY-1042 ». */
  numero: string;
  statut: StatutCourse;
  destinataire_nom: string;
  adresse_arrivee: string;
  horodatage: string;
}

/** Une étape du déroulé, telle que le journal l'a retenue. */
export interface EvenementJournal {
  type: string;
  auteur_nom?: string;
  auteur_role?: string;
  details?: Record<string, string>;
  horodatage: string;
}


/** Preuve de remise : ce qui atteste que le colis est arrivé, et à qui.
 *  Absente quand le livreur n'a rien déposé — ce n'est pas une anomalie, la
 *  remise n'est pas conditionnée à une signature. */
export interface Preuve {
  nom_receptionnaire?: string;
  type_media?: 'signature' | 'photo';
  media_mime?: string;
  media_octets?: number;
  livreur_nom?: string;
  /** Instant de la capture à la porte, distinct de `recue_le` : sur un réseau
   *  qui vacille, la preuve arrive parfois longtemps après. */
  capture_le: string;
  recue_le: string;
}

/**
 * Reçu imprimable d'une commande.
 *
 * Deux absences volontaires, à ne pas « compléter » plus tard sans y penser :
 * aucun montant (le barème est un abonnement plus une commission, pas un tarif
 * par course) et aucun nom de livreur (le serveur ne l'envoie pas à cette
 * audience — la garantie de masquage vaut aussi sur papier).
 */
export interface Recu {
  numero: string;
  statut: StatutCourse;
  compagnie_nom: string;
  partenaire_nom?: string;
  destinataire_nom: string;
  adresse_depart: string;
  repere_depart?: string;
  adresse_arrivee: string;
  repere_arrivee?: string;
  description_colis?: string;
  instructions?: string;
  cree_par_nom?: string;
  journal: EvenementJournal[];
  preuve?: Preuve;
  cree_le: string;
  /** Instant du tirage, distinct de la création : deux impressions du même
   *  reçu portent des instants différents, et c'est ce qu'on veut savoir. */
  emis_le: string;
}

/** Position relayée pour le suivi. Volontairement sans identifiant de livreur :
 *  le partenaire voit où en est son colis, pas qui le porte. */
export interface Position {
  latitude: number;
  longitude: number;
  horodatage: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let token: string | null = localStorage.getItem(CLE_TOKEN);
let refreshToken: string | null = localStorage.getItem(CLE_REFRESH);
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export function setToken(valeur: string | null, refresh?: string | null) {
  token = valeur;
  if (valeur) localStorage.setItem(CLE_TOKEN, valeur);
  else localStorage.removeItem(CLE_TOKEN);

  // `undefined` veut dire « ne touche pas au jeton de renouvellement » ;
  // `null` veut dire « efface-le ». Effacer le jeton d'accès seul n'aurait pas
  // de sens : la session serait irrécupérable alors qu'elle est encore valide.
  if (refresh !== undefined) {
    refreshToken = refresh;
    if (refresh) localStorage.setItem(CLE_REFRESH, refresh);
    else localStorage.removeItem(CLE_REFRESH);
  } else if (valeur === null) {
    refreshToken = null;
    localStorage.removeItem(CLE_REFRESH);
  }
}

export function getToken(): string | null {
  return token;
}

/** Date d'expiration du JWT, en millisecondes, ou null s'il est illisible. */
function expirationJWT(jwt: string): number | null {
  try {
    const [, payload] = jwt.split('.');
    const exp = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function decodeRole(jwt: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch {
    return null;
  }
}

/** Un seul renouvellement à la fois : sinon deux requêtes simultanées en 401
 *  feraient tourner le jeton deux fois, et la seconde rotation invaliderait la
 *  première — le serveur y verrait un rejeu et couperait toute la session. */
let renouvellementEnCours: Promise<boolean> | null = null;

async function renouveler(): Promise<boolean> {
  if (!refreshToken) return false;
  if (renouvellementEnCours) return renouvellementEnCours;

  renouvellementEnCours = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        // 401 : session révoquée ou expirée pour de bon. Une panne réseau, elle,
        // lève et laisse le jeton en place — on retentera au prochain appel.
        if (res.status === 401) setToken(null, null);
        return false;
      }
      const body = (await res.json()) as { token: string; refresh_token: string };
      setToken(body.token, body.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      renouvellementEnCours = null;
    }
  })();

  return renouvellementEnCours;
}

/**
 * Garantit un jeton d'accès valide pour les quelques minutes qui viennent.
 * À appeler avant d'ouvrir une WebSocket, dont le jeton ne peut pas être rejoué.
 */
export async function assurerJetonFrais(): Promise<boolean> {
  if (!token) return false;
  const exp = expirationJWT(token);
  if (exp === null) return true; // illisible : laisser le serveur trancher
  if (exp - Date.now() > MARGE_RENOUVELLEMENT_MS) return true;
  return renouveler();
}

/** Révoque la session côté serveur. Silencieuse en cas d'échec : l'important
 *  est d'effacer le jeton localement, ce que fait l'appelant. */
export async function deconnexionServeur(): Promise<void> {
  if (!refreshToken) return;
  try {
    await fetch(`${API_BASE_URL}/api/auth/deconnexion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // hors ligne : le jeton expirera de lui-même
  }
}

async function requete<T>(path: string, options: RequestInit = {}, rejeu = false): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    // Un 401 sur un jeton expiré se rattrape : on renouvelle et on rejoue une
    // fois. `rejeu` empêche la boucle si le serveur refuse encore.
    if (res.status === 401 && !rejeu && refreshToken) {
      if (await renouveler()) return requete<T>(path, options, true);
    }

    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.erreur ?? message;
    } catch {
      // corps non-JSON
    }
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface BrouillonCommande {
  destinataire_nom: string;
  destinataire_telephone: string;
  adresse_depart: string;
  repere_depart: string;
  latitude_depart: number | null;
  longitude_depart: number | null;
  adresse_arrivee: string;
  repere_arrivee: string;
  latitude_arrivee: number | null;
  longitude_arrivee: number | null;
  description_colis: string;
  instructions: string;
}

export const api = {
  login: (telephone: string, motDePasse: string) =>
    requete<{ token: string; refresh_token: string; role: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ telephone, mot_de_passe: motDePasse }),
    }),

  activerCollaborateur: (telephone: string, code: string, motDePasse: string) =>
    requete<{ token: string; refresh_token: string; role: string }>(
      '/api/auth/activer-collaborateur',
      {
        method: 'POST',
        body: JSON.stringify({ telephone, code, mot_de_passe: motDePasse }),
      }
    ),

  monPartenaire: () => requete<Partenaire>('/api/mon-partenaire'),

  commandes: () => requete<Commande[]>('/api/commandes/'),

  commande: (id: string) => requete<Commande>(`/api/commandes/${id}`),

  carnet: () => requete<Destinataire[]>('/api/commandes/carnet'),

  creerCommande: (brouillon: BrouillonCommande) =>
    requete<Commande>('/api/commandes/', {
      method: 'POST',
      body: JSON.stringify(brouillon),
    }),

  recu: (id: string) => requete<Recu>(`/api/commandes/${id}/recu`),

  /**
   * Génère (ou réutilise) le lien de reçu partageable par WhatsApp. Aucun
   * numéro n'est ciblé : la plateforme ne connaît que `telephone_hash`,
   * jamais le numéro en clair du destinataire.
   */
  trajet: (id: string) => requete<Trajet>(`/api/commandes/${id}/trajet`),

  lienPartageRecu: (id: string) =>
    requete<{ url: string; expire_le: string }>(`/api/commandes/${id}/lien-partage`, {
      method: 'POST',
    }),

  annulerCommande: (id: string) =>
    requete<void>(`/api/commandes/${id}/annuler`, { method: 'POST' }),

  preferencesNotification: () =>
    requete<PreferenceNotification[]>('/api/mon-partenaire/notifications'),

  majPreferenceNotification: (evenement: string, actif: boolean) =>
    requete<void>('/api/mon-partenaire/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ evenement, actif }),
    }),

  collaborateurs: () =>
    requete<{ collaborateurs: Collaborateur[]; invitations: Invitation[] }>(
      '/api/mon-partenaire/collaborateurs'
    ),

  inviterCollaborateur: (nom: string, telephone: string) =>
    requete<Invitation>('/api/mon-partenaire/collaborateurs', {
      method: 'POST',
      body: JSON.stringify({ nom, telephone }),
    }),

  majCollaborateur: (id: string, actif: boolean) =>
    requete<Collaborateur>(`/api/mon-partenaire/collaborateurs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ actif }),
    }),

  annulerInvitation: (id: string) =>
    requete<void>(`/api/mon-partenaire/invitations/${id}`, { method: 'DELETE' }),
};


/**
 * Rend l'image d'une preuve sous forme d'URL d'objet, à révoquer par
 * l'appelant.
 *
 * Elle ne peut pas être posée directement dans un `<img src>` : l'attribut ne
 * transporte pas d'en-tête `Authorization`, et l'endpoint est authentifié.
 * Une URL signée à durée courte serait l'autre option — elle ajouterait un
 * mécanisme de signature pour un seul usage.
 *
 * Rend `null` quand il n'y a pas d'image : une preuve peut n'être qu'un nom.
 */
export async function urlMediaPreuve(courseId: string): Promise<string | null> {
  await assurerJetonFrais();
  const rep = await fetch(`${API_BASE_URL}/api/courses/${courseId}/preuve/media`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!rep.ok) return null;
  return URL.createObjectURL(await rep.blob());
}

export function urlWebSocketEvenements(): string {
  return `${WS_BASE_URL}/ws/partenaire/evenements?token=${encodeURIComponent(token ?? '')}`;
}

export function urlWebSocketCourse(courseId: string): string {
  return `${WS_BASE_URL}/ws/courses/${courseId}/position?token=${encodeURIComponent(token ?? '')}`;
}
