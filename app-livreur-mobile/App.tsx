import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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

export default function App() {
  const [connecte, setConnecte] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
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

  async function deconnecter() {
    await deconnexionServeur();
    await definirToken(null, null);
    setConnecte(false);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: couleurs.fond }}>
        <StatusBar style="dark" />
        {connecte === null ? null : connecte ? (
          <EcranLivreur onDeconnexion={deconnecter} />
        ) : (
          <Login onConnecte={() => setConnecte(true)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
