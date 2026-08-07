import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { chargerToken, definirToken, setOnUnauthorized } from './src/api';
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
      setConnecte(token !== null);
    })();

    setOnUnauthorized(() => {
      // Jeton expiré : on coupe aussi le suivi, qui ne pourrait plus rien déposer.
      arreterSuivi();
      definirToken(null);
      setConnecte(false);
    });
  }, []);

  async function deconnecter() {
    await definirToken(null);
    setConnecte(false);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: couleurs.fond }}>
        <StatusBar style="light" />
        {connecte === null ? null : connecte ? (
          <EcranLivreur onDeconnexion={deconnecter} />
        ) : (
          <Login onConnecte={() => setConnecte(true)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
