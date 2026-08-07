import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RouteProtegee } from './components/RouteProtegee';
import { Login } from './pages/Login';
import { RegisterCompagnie } from './pages/RegisterCompagnie';
import { Dashboard } from './pages/Dashboard';
import { Livreurs } from './pages/Livreurs';
import { Courses } from './pages/Courses';

function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route path="/inscription" element={<RegisterCompagnie />} />
      <Route
        path="/"
        element={
          <RouteProtegee>
            <Layout />
          </RouteProtegee>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="livreurs" element={<Livreurs />} />
        <Route path="courses" element={<Courses />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
