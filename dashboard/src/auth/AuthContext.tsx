import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, getToken, setOnUnauthorized } from '../api/client';
import { decodeJwt, estExpire } from './jwt';

interface AuthState {
  token: string | null;
  compagnieId: string | null;
  estAuthentifie: boolean;
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

  const compagnieId = useMemo(() => {
    if (!token) return null;
    return decodeJwt(token)?.compagnie_id ?? null;
  }, [token]);

  function appliquerToken(nouveauToken: string) {
    setToken(nouveauToken);
    setTokenState(nouveauToken);
  }

  async function login(telephone: string, motDePasse: string) {
    const { token: nouveauToken } = await api.post<{ token: string; role: string }>(
      '/api/auth/login',
      { telephone, mot_de_passe: motDePasse },
    );
    appliquerToken(nouveauToken);
  }

  async function registerCompagnie(nomCompagnie: string, telephone: string, motDePasse: string) {
    const { token: nouveauToken } = await api.post<{ token: string; compagnie_id: string }>(
      '/api/auth/register-compagnie',
      { nom_compagnie: nomCompagnie, telephone, mot_de_passe: motDePasse },
    );
    appliquerToken(nouveauToken);
  }

  function logout() {
    setToken(null);
    setTokenState(null);
  }

  useEffect(() => {
    setOnUnauthorized(logout);
  }, []);

  const value: AuthState = {
    token,
    compagnieId,
    estAuthentifie: token !== null,
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
