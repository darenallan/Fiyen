import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

export function RouteProtegee({ children }: { children: ReactNode }) {
  const { estAuthentifie } = useAuth();
  if (!estAuthentifie) {
    return <Navigate to="/connexion" replace />;
  }
  return <>{children}</>;
}
