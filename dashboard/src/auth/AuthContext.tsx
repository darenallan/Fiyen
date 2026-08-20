import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  setToken,
  getToken,
  setOnUnauthorized,
  assurerJetonFrais,
  deconnexionServeur,
} from '../api/client';
import { decodeJwt, estExpire } from './jwt';

/** Renouvellement proactif : au démarrage puis toutes les 5 minutes. Sans cela,
 *  un onglet resté ouvert repart avec un jeton mort et les WebSockets — qui
 *  portent le jeton dans leur URL de handshake — échoueraient. */
const PERIODE_VERIFICATION_MS = 5 * 60 * 1000;

interface AuthState {
  token: string | null;
  compagnieId: string | null;
  estAuthentifie: boolean;
  /** Faux tant que la tentative de restauration de session n'a pas tranché :
   *  afficher l'écran de connexion avant serait un clignotement injustifié. */
  pret: boolean;
  login: (telephone: string, motDePasse: string) => Promise<void>;
  registerCompagnie: (nomCompagnie: string, telephone: string, motDePasse: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function tokenValide(token: string | null): string | null {
  if (!token) return null;
  const claims = decodeJwt(token);
  if (!claims || estExpire(claims)) return null;
  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => tokenValide(getToken()));
  // Un jeton stocké mais expiré n'est plus une raison de déconnecter : le jeton
  // de renouvellement peut encore relancer la session. On attend la réponse.
  const [pret, setPret] = useState(() => tokenValide(getToken()) !== null);

  const compagnieId = useMemo(() => {
    if (!token) return null;
    return decodeJwt(token)?.compagnie_id ?? null;
  }, [token]);

  function appliquerToken(nouveauToken: string, refresh: string) {
    setToken(nouveauToken, refresh);
    setTokenState(nouveauToken);
    setPret(true);
  }

  async function login(telephone: string, motDePasse: string) {
    const { token: nouveauToken, refresh_token } = await api.post<{
      token: string;
      refresh_token: string;
      role: string;
    }>('/api/auth/login', { telephone, mot_de_passe: motDePasse });
    appliquerToken(nouveauToken, refresh_token);
  }

  async function registerCompagnie(nomCompagnie: string, telephone: string, motDePasse: string) {
    const { token: nouveauToken, refresh_token } = await api.post<{
      token: string;
      refresh_token: string;
      compagnie_id: string;
    }>('/api/auth/register-compagnie', {
      nom_compagnie: nomCompagnie,
      telephone,
      mot_de_passe: motDePasse,
    });
    appliquerToken(nouveauToken, refresh_token);
  }

  function logout() {
    void deconnexionServeur();
    setToken(null);
    setTokenState(null);
    setPret(true);
  }

  useEffect(() => {
    setOnUnauthorized(logout);
  }, []);

  useEffect(() => {
    let actif = true;

    const verifier = async () => {
      const ok = await assurerJetonFrais();
      if (!actif) return;
      setTokenState(ok ? getToken() : null);
      setPret(true);
    };

    void verifier();
    const timer = window.setInterval(verifier, PERIODE_VERIFICATION_MS);
    // Une machine en veille gèle les minuteries : revenir sur l'onglet doit
    // relancer la vérification plutôt qu'attendre le prochain tour.
    document.addEventListener('visibilitychange', verifier);

    return () => {
      actif = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', verifier);
    };
  }, []);

  const value: AuthState = {
    token,
    compagnieId,
    estAuthentifie: token !== null,
    pret,
    login,
    registerCompagnie,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé sous AuthProvider');
  return ctx;
}
