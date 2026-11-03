import { useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  chargerToken,
  definirToken,
  setOnUnauthorized,
  assurerJetonFrais,
  deconnexionServeur,
} from './src/api';
import { Login } from './src/ecrans/Login';
import { EcranLivreur } from './src/ecrans/EcranLivreur';
// L'import enregistre la tâche de localisation au chargement du module, avant
// tout rendu : le système peut relancer l'app en arrière-plan pour un évènement
// de position, et la tâche doit alors déjà être définie.
import { arreterSuivi } from './src/tracking';
import { couleurs } from './src/theme';
import { activerPush, desactiverPush } from './src/pushExpo';
import { messagePourLeLivreur, type EtatPush } from './src/push';
import { chargerServeur } from './src/serveur';
import { MODE_DEMO } from './src/demo';

export default function App() {
  const [connecte, setConnecte] = useState<boolean | null>(null);
  const [etatPush, setEtatPush] = useState<EtatPush | null>(null);

  useEffect(() => {
    (async () => {
      await chargerServeur();
      const token = await chargerToken();
      // Un jeton d'accès expiré ne condamne plus la session : le jeton de
      // renouvellement peut la relancer sans redemander le mot de passe.
      if (token !== null) await assurerJetonFrais();
      setConnecte((await chargerToken()) !== null);
    })();

    setOnUnauthorized(() => {
      // Session réellement finie (le renouvellement a déjà échoué en amont) :
      // on coupe aussi le suivi, qui ne pourrait plus rien déposer.
      arreterSuivi();
      definirToken(null, null);
      setConnecte(false);
    });
  }, []);

  // Le retour au premier plan est le bon moment pour rafraîchir : le téléphone
  // a pu rester en veille des heures, et le livreur va agir tout de suite.
  useEffect(() => {
    if (!connecte) return;

    const abonnement = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') void assurerJetonFrais();
    });
    return () => abonnement.remove();
  }, [connecte]);

  // Notifications push : demandées une fois connecté (le jeton est rattaché au
  // compte), et retentées au retour au premier plan si l'essai a échoué —
  // typiquement un réseau coupé au moment de joindre Expo.
  useEffect(() => {
    if (!connecte || MODE_DEMO) return; // démo : pas de serveur pour router les push
    void activerPush().then(setEtatPush);
    const abonnement = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') {
        setEtatPush((precedent) => {
          if (precedent?.etat === 'erreur') void activerPush().then(setEtatPush);
          return precedent;
        });
      }
    });
    return () => abonnement.remove();
  }, [connecte]);

  async function deconnecter() {
    // Avant la déconnexion serveur : il faut encore une session valide pour
    // dire au serveur d'oublier ce téléphone.
    await desactiverPush();
    setEtatPush(null);
    await deconnexionServeur();
    await definirToken(null, null);
    setConnecte(false);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: couleurs.fond }}>
        <StatusBar style="dark" />
        {connecte && etatPush && messagePourLeLivreur(etatPush) && (
          <Text
            accessibilityRole="alert"
            style={{ backgroundColor: couleurs.fond, color: couleurs.texte, padding: 12, fontSize: 13 }}
          >
            {messagePourLeLivreur(etatPush)}
          </Text>
        )}
        {connecte === null ? null : connecte ? (
          <EcranLivreur onDeconnexion={deconnecter} />
        ) : (
          <Login onConnecte={() => setConnecte(true)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
