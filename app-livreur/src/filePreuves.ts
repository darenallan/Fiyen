import { api, ApiError, type BrouillonPreuve } from './api';

/**
 * File d'attente des preuves de livraison.
 *
 * Le dépôt est **découplé du passage à « livrée »** : une course close derrière
 * un envoi d'image bloquerait le livreur sur un réseau qui vacille, et la
 * livraison, elle, a bien eu lieu. La preuve part ensuite, et si elle échoue,
 * elle attend ici.
 *
 * Même principe que le cache de positions (`tracking.ts`) : `localStorage`
 * plutôt qu'IndexedDB, parce qu'une preuve est un objet JSON de quelques
 * kilo-octets et que le reste de l'application stocke déjà là.
 */

const CLE_FILE = 'fiyen_preuves_en_attente';

/**
 * Trois preuves au plus. Un quota `localStorage` est de 5 Mo environ, et une
 * photo redimensionnée en base64 pèse ~150 Ko : la borne n'est pas là pour la
 * place mais pour empêcher qu'une file oubliée grossisse indéfiniment. Un
 * livreur a une course à la fois ; au-delà de trois, c'est que quelque chose
 * ne repart pas, et la plus ancienne cède la place.
 */
const MAX_EN_ATTENTE = 3;

interface PreuveEnAttente extends BrouillonPreuve {
  course_id: string;
}

function lire(): PreuveEnAttente[] {
  try {
    const brut = localStorage.getItem(CLE_FILE);
    return brut ? (JSON.parse(brut) as PreuveEnAttente[]) : [];
  } catch {
    // Une file illisible n'est pas une raison de casser l'application : on
    // repart de zéro plutôt que de faire échouer chaque envoi suivant.
    return [];
  }
}

function ecrire(file: PreuveEnAttente[]) {
  try {
    localStorage.setItem(CLE_FILE, JSON.stringify(file.slice(-MAX_EN_ATTENTE)));
  } catch {
    // Quota dépassé : la preuve la plus ancienne part, la nouvelle reste.
    try {
      localStorage.setItem(CLE_FILE, JSON.stringify(file.slice(-1)));
    } catch {
      /* stockage indisponible : la preuve est perdue, la livraison non */
    }
  }
}

export function mettreEnAttente(courseId: string, preuve: BrouillonPreuve) {
  const file = lire().filter((p) => p.course_id !== courseId);
  file.push({ ...preuve, course_id: courseId });
  ecrire(file);
}

export function nombreEnAttente(): number {
  return lire().length;
}

/**
 * Rejoue la file. Rend le nombre de preuves parties.
 *
 * Un 409 (« une preuve existe déjà ») et un 403 retirent la preuve de la file :
 * la réessayer indéfiniment ne la ferait jamais passer. Seule une panne
 * réseau ou serveur la laisse en place.
 */
export async function rejouerFile(): Promise<number> {
  const file = lire();
  if (file.length === 0) return 0;

  const restantes: PreuveEnAttente[] = [];
  let parties = 0;

  for (const { course_id, ...preuve } of file) {
    try {
      await api.deposerPreuve(course_id, preuve);
      parties++;
    } catch (err) {
      const definitif = err instanceof ApiError && err.status >= 400 && err.status < 500;
      if (!definitif) restantes.push({ ...preuve, course_id });
    }
  }

  ecrire(restantes);
  return parties;
}

/**
 * Envoie une preuve, et la met en file si l'envoi échoue pour une raison
 * passagère. Rend `true` si elle est partie tout de suite.
 */
export async function envoyerOuMettreEnAttente(
  courseId: string,
  preuve: BrouillonPreuve
): Promise<boolean> {
  try {
    await api.deposerPreuve(courseId, preuve);
    return true;
  } catch (err) {
    // Un refus définitif (mauvais format, preuve déjà déposée) ne se rejoue
    // pas : le mettre en file ferait réessayer sans fin quelque chose que le
    // serveur ne prendra jamais.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    mettreEnAttente(courseId, preuve);
    return false;
  }
}
