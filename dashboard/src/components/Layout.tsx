import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCommandesEntrantes } from '../api/CommandesEntrantesContext';
import { Marque } from './Marque';
import './Layout.css';

export function Layout() {
  const { logout } = useAuth();
  const { commandes } = useCommandesEntrantes();

  return (
    <div className="mise-en-page">
      <aside className="barre-laterale">
        <div className="marque-bloc">
          <Marque />
        </div>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'actif' : '')}>
            Tableau de bord
          </NavLink>
          <NavLink to="/livreurs" className={({ isActive }) => (isActive ? 'actif' : '')}>
            Flotte
          </NavLink>
          <NavLink to="/courses" className={({ isActive }) => (isActive ? 'actif' : '')}>
            Courses
          </NavLink>
          <NavLink to="/entrantes" className={({ isActive }) => (isActive ? 'actif' : '')}>
            Entrantes
            {/* Compteur plutôt qu'une simple pastille : « 3 » dit combien de
                clients attendent, une pastille dirait seulement « il y a
                quelque chose ». */}
            {commandes.length > 0 && (
              <span className="compteur-nav" aria-label={`${commandes.length} commande(s) en attente`}>
                {commandes.length}
              </span>
            )}
          </NavLink>
          <NavLink to="/partenaires" className={({ isActive }) => (isActive ? 'actif' : '')}>
            Partenaires
          </NavLink>
        </nav>
        <button className="secondaire" onClick={logout}>
          Déconnexion
        </button>
      </aside>
      <main className="contenu">
        <Outlet />
      </main>
    </div>
  );
}
