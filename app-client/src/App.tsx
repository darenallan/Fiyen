import { useEffect, useState } from 'react';
import { api, getToken, setToken, setOnUnauthorized, assurerJetonFrais } from './api';
import { Login } from './Login';
import { EcranClient } from './EcranClient';

function App() {
  const [connecte, setConnecte] = useState(() => getToken() !== null);

  useEffect(() => {
    setOnUnauthorized(() => {
      setToken(null);
      setConnecte(false);
    });
  }, []);

  // Renouvellement proactif : au démarrage puis toutes les 5 minutes. Sans
  // cela, un onglet resté ouvert repart avec un jeton mort et les WebSockets
  // — qui portent le jeton dans leur URL de handshake — échoueraient.
  useEffect(() => {
    if (!connecte) return;

    let actif = true;
    const verifier = async () => {
      const ok = await assurerJetonFrais();
      if (actif && !ok && getToken() === null) setConnecte(false);
    };

    void verifier();
    const timer = setInterval(verifier, 5 * 60 * 1000);
    // Un téléphone en veille gèle les minuteries : revenir sur l'onglet doit
    // relancer la vérification plutôt qu'attendre le prochain tour.
    document.addEventListener('visibilitychange', verifier);

    return () => {
      actif = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', verifier);
    };
  }, [connecte]);

  function deconnecter() {
    void api.deconnexion();
    setToken(null);
    setConnecte(false);
  }

  return connecte ? (
    <EcranClient onDeconnexion={deconnecter} />
  ) : (
    <Login onConnecte={() => setConnecte(true)} />
  );
}

export default App;
