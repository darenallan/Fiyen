import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RouteProtegee } from './components/RouteProtegee';
import { Login } from './pages/Login';
import { RegisterCompagnie } from './pages/RegisterCompagnie';
import { Dashboard } from './pages/Dashboard';
import { Livreurs } from './pages/Livreurs';
import { Courses } from './pages/Courses';
import { Partenaires } from './pages/Partenaires';
import { CommandesEntrantes } from './pages/CommandesEntrantes';
import { CommandesEntrantesProvider } from './api/CommandesEntrantesContext';

function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route path="/inscription" element={<RegisterCompagnie />} />
      <Route
        path="/"
        element={
          <RouteProtegee>
            {/* Le fournisseur enveloppe la mise en page ET les écrans : le
                compteur de la barre latérale et la file doivent lire le même
                état, pas deux sondages qui se désynchronisent. */}
            <CommandesEntrantesProvider>
              <Layout />
            </CommandesEntrantesProvider>
          </RouteProtegee>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="livreurs" element={<Livreurs />} />
        <Route path="courses" element={<Courses />} />
        <Route path="partenaires" element={<Partenaires />} />
        <Route path="entrantes" element={<CommandesEntrantes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
