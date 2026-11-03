import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Marque } from '../components/Marque';
import { IDENTIFIANTS_DEMO, MODE_DEMO } from '../api/demo';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [telephone, setTelephone] = useState(MODE_DEMO ? IDENTIFIANTS_DEMO.telephone : '');
  const [motDePasse, setMotDePasse] = useState(MODE_DEMO ? IDENTIFIANTS_DEMO.motDePasse : '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await login(telephone, motDePasse);
      navigate('/');
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '64px auto' }}>
      <div className="carte apparition">
        <div style={{ textAlign: 'center', marginBottom: 34 }}><Marque taille="grand" /></div>
        <h1>Connexion</h1>
        <p className="muted-inline" style={{ marginBottom: 22 }}>Espace compagnie partenaire.</p>
        {MODE_DEMO && (
          <div className="carte" style={{ marginBottom: 18, padding: 14 }} role="note">
            <strong>Version de démonstration</strong>
            <p className="muted-inline" style={{ marginTop: 6 }}>
              Données fictives d’une compagnie de Ouagadougou, sans serveur. Les identifiants sont
              déjà remplis : cliquez sur « Se connecter ». Assignez une commande entrante à Issouf
              pour la voir avancer toute seule.
            </p>
          </div>
        )}
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Téléphone
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="+22670000000"
              required
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              required
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          {erreur && <p className="erreur">{erreur}</p>}
          <button type="submit" disabled={enCours}>
            {enCours ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          Pas encore de compte compagnie ? <Link to="/inscription">Créer un compte</Link>
        </p>
      </div>
    </div>
  );
}
