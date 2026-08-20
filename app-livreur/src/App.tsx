import { useEffect, useState } from 'react';
import { getToken, setToken, setOnUnauthorized, assurerJetonFrais, deconnexionServeur } from './api';
import { Login } from './Login';
import { EcranLivreur } from './EcranLivreur';

function App() {
  const [connecte, setConnecte] = useState(() => getToken() !== null);

  useEffect(() => {
    setOnUnauthorized(() => {
      setToken(null);
      setConnecte(false);
    });
  }, []);

  // Renouvellement proactif : au démarrage puis toutes les 5 minutes. Sur un
  // téléphone laissé en poche toute la journée, c'est ce qui évite au livreur
  // de se retrouver déconnecté en pleine course — la WebSocket de position
  // porte le jeton dans son URL et ne peut pas le rattraper après coup.
  useEffect(() => {
    if (!connecte) return;

    let actif = true;
    const verifier = async () => {
      const ok = await assurerJetonFrais();
      if (actif && !ok && getToken() === null) setConnecte(false);
    };

    void verifier();
    const timer = setInterval(verifier, 5 * 60 * 1000);
    // Un téléphone en veille gèle les minuteries : le retour au premier plan
    // doit relancer la vérification plutôt qu'attendre le prochain tour.
    document.addEventListener('visibilitychange', verifier);

    return () => {
      actif = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', verifier);
    };
  }, [connecte]);

  function deconnecter() {
    void deconnexionServeur();
    setToken(null);
    setConnecte(false);
  }

  return connecte ? (
    <EcranLivreur onDeconnexion={deconnecter} />
  ) : (
    <Login onConnecte={() => setConnecte(true)} />
  );
}

export default App;
