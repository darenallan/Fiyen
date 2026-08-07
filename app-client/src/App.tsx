import { useEffect, useState } from 'react';
import { getToken, setToken, setOnUnauthorized } from './api';
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

  function deconnecter() {
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
