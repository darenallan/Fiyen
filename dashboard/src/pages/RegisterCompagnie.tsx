import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Marque } from '../components/Marque';

export function RegisterCompagnie() {
  const { registerCompagnie } = useAuth();
  const navigate = useNavigate();
  const [nomCompagnie, setNomCompagnie] = useState('');
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await registerCompagnie(nomCompagnie, telephone, motDePasse);
      navigate('/');
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Inscription impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '64px auto' }}>
      <div className="carte apparition">
        <div style={{ textAlign: 'center', marginBottom: 34 }}><Marque taille="grand" /></div>
        <h1>Créer un compte</h1>
        <p className="muted-inline" style={{ marginBottom: 22 }}>Inscrivez votre compagnie de livraison.</p>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Nom de la compagnie
            <input
              value={nomCompagnie}
              onChange={(e) => setNomCompagnie(e.target.value)}
              required
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
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
            Mot de passe (8 caractères min.)
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              minLength={8}
              required
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          {erreur && <p className="erreur">{erreur}</p>}
          <button type="submit" disabled={enCours}>
            {enCours ? 'Création…' : 'Créer le compte'}
          </button>
        </form>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          Déjà un compte ? <Link to="/connexion">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
