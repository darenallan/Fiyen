import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Marque } from './Marque';
import './Layout.css';

export function Layout() {
  const { logout } = useAuth();

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
