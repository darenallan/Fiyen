/**
 * Branchement réel des notifications push sur Expo (SDK 57).
 *
 * La décision vit dans `push.ts` (testée) ; ici, seulement les appels Expo.
 * Ne fonctionne **pas** dans Expo Go sur Android : il faut un development
 * build (`npx expo run:android`), et un identifiant de projet EAS dans
 * app.json (`expo.extra.eas.projectId`) pour obtenir un jeton.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';
import { enregistrerPush, type EtatPush, type Permission } from './push';

const CLE_JETON = 'fiyen_jeton_push';
const CANAL = 'courses';

// Application ouverte : une assignation s'affiche quand même en bannière,
// sinon le livreur ne la verrait qu'en regardant sa liste.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const versPermission = (s: string): Permission =>
  s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'undetermined';

export async function activerPush(): Promise<EtatPush> {
  const etat = await enregistrerPush({
    plateforme: Platform.OS,
    projectId:
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
      Constants.easConfig?.projectId,
    creerCanal: async () => {
      await Notifications.setNotificationChannelAsync(CANAL, {
        name: 'Nouvelles courses',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    },
    permissionActuelle: async () => versPermission((await Notifications.getPermissionsAsync()).status),
    demanderPermission: async () => versPermission((await Notifications.requestPermissionsAsync()).status),
    obtenirJeton: async (projectId) => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
    enregistrerSurServeur: (jeton, plateforme) => api.enregistrerJetonPush(jeton, plateforme),
  });

  if (etat.etat === 'active') {
    await AsyncStorage.setItem(CLE_JETON, etat.jeton).catch(() => undefined);
  } else if (etat.etat === 'non_configuree' || etat.etat === 'erreur') {
    console.warn(`[push] ${etat.raison}`);
  }
  return etat;
}

/**
 * À la déconnexion : le serveur oublie ce téléphone pour ce compte. Sans cela,
 * un téléphone prêté continuerait de recevoir les courses de l'ancien livreur.
 */
export async function desactiverPush(): Promise<void> {
  const jeton = await AsyncStorage.getItem(CLE_JETON).catch(() => null);
  if (!jeton) return;
  try {
    await api.oublierJetonPush(jeton);
  } catch {
    // hors ligne : la réattribution du jeton au prochain compte s'en chargera
  }
  await AsyncStorage.removeItem(CLE_JETON).catch(() => undefined);
}
