import { useEffect, useState } from 'react';
import { getToken, setToken, setOnUnauthorized } from './api';
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

  function deconnecter() {
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
