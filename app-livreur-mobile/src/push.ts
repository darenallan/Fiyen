/**
 * Enregistrement des notifications push — logique seule, sans Expo.
 *
 * Les dépendances (permission, jeton, serveur) sont injectées : la décision
 * « que faire, dans quel ordre, que dire au livreur » se teste ainsi sans
 * téléphone (`tests/push.test.mjs`). Le branchement réel est dans `pushExpo.ts`.
 *
 * Ordre imposé par la documentation Expo v57 : sur Android 13+, le canal de
 * notification doit exister **avant** la demande de permission et de jeton,
 * sinon la fenêtre de permission ne s'affiche pas.
 */

export type Permission = 'granted' | 'denied' | 'undetermined';

export type EtatPush =
  | { etat: 'active'; jeton: string }
  | { etat: 'refusee' }
  | { etat: 'non_configuree'; raison: string }
  | { etat: 'indisponible'; raison: string }
  | { etat: 'erreur'; raison: string };

export interface DependancesPush {
  plateforme: string;
  projectId: string | null | undefined;
  creerCanal: () => Promise<void>;
  permissionActuelle: () => Promise<Permission>;
  demanderPermission: () => Promise<Permission>;
  obtenirJeton: (projectId: string) => Promise<string>;
  enregistrerSurServeur: (jeton: string, plateforme: string) => Promise<void>;
}

/** Même format que celui que le serveur valide (`ExponentPushToken[...]`). */
export const FORMAT_JETON = /^Expo(nent)?PushToken\[[^\]]+\]$/;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function enregistrerPush(d: DependancesPush): Promise<EtatPush> {
  if (d.plateforme !== 'android' && d.plateforme !== 'ios') {
    return { etat: 'indisponible', raison: 'notifications push réservées à l’application installée' };
  }

  if (d.plateforme === 'android') {
    try {
      await d.creerCanal();
    } catch (e) {
      return { etat: 'erreur', raison: `canal de notification : ${message(e)}` };
    }
  }

  let permission = await d.permissionActuelle();
  if (permission !== 'granted') permission = await d.demanderPermission();
  if (permission !== 'granted') return { etat: 'refusee' };

  // Sans identifiant de projet EAS, Expo ne délivre pas de jeton. On le dit
  // plutôt que d'échouer en silence : c'est une étape de configuration, pas
  // une panne.
  if (!d.projectId) {
    return {
      etat: 'non_configuree',
      raison: 'identifiant de projet EAS absent (app.json → expo.extra.eas.projectId)',
    };
  }

  let jeton: string;
  try {
    jeton = await d.obtenirJeton(d.projectId);
  } catch (e) {
    // Sans identifiants Firebase (google-services.json absent du build),
    // Android ne délivre jamais de jeton : c'est de la configuration, pas une
    // panne passagère, et le livreur n'y peut rien.
    if (/firebase|fcm|google-services/i.test(message(e))) {
      return {
        etat: 'non_configuree',
        raison: 'Firebase (FCM) non configuré : google-services.json absent du build Android',
      };
    }
    // Sinon, appel réseau vers Expo : sur un réseau instable il échoue, et on
    // réessaiera au prochain démarrage ou retour au premier plan.
    return { etat: 'erreur', raison: `jeton Expo indisponible : ${message(e)}` };
  }
  if (!FORMAT_JETON.test(jeton)) {
    return { etat: 'erreur', raison: 'jeton Expo au format inattendu' };
  }

  try {
    await d.enregistrerSurServeur(jeton, d.plateforme);
  } catch (e) {
    return { etat: 'erreur', raison: `enregistrement sur le serveur : ${message(e)}` };
  }
  return { etat: 'active', jeton };
}

/** Phrase à montrer au livreur, ou null quand il n'y a rien à lui dire. */
export function messagePourLeLivreur(e: EtatPush): string | null {
  switch (e.etat) {
    case 'active':
    case 'indisponible':
      return null;
    case 'refusee':
      return 'Notifications désactivées : activez-les dans les réglages du téléphone pour être prévenu des nouvelles courses.';
    case 'non_configuree':
      // Problème de configuration de l'application, pas du livreur.
      return null;
    case 'erreur':
      return 'Notifications momentanément indisponibles : la liste des courses se met quand même à jour toute seule.';
  }
}
