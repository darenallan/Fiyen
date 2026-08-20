import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

export function RouteProtegee({ children }: { children: ReactNode }) {
  const { estAuthentifie, pret } = useAuth();

  // Au chargement, une session dont le jeton d'accès a expiré peut encore être
  // relancée par le jeton de renouvellement. Rediriger avant la réponse
  // renverrait un opérateur déjà connecté vers l'écran de connexion.
  if (!pret) {
    return (
      <div className="chargement-session" role="status" aria-live="polite">
        <span className="pastille vivante" />
        <span>Reprise de la session…</span>
      </div>
    );
  }

  if (!estAuthentifie) {
    return <Navigate to="/connexion" replace />;
  }
  return <>{children}</>;
}
