import { useState, type FormEvent } from 'react';
import { api, ApiError, setToken, decodeRole } from './api';
import { Marque } from './Marque';

export function Login({ onConnecte }: { onConnecte: () => void }) {
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const { token, refresh_token } = await api.login(telephone, motDePasse);
      if (decodeRole(token) !== 'livreur') {
        setErreur("Ce compte n'est pas un compte livreur.");
        return;
      }
      setToken(token, refresh_token);
      onConnecte();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="app">
      <div className="apparition" style={{ marginTop: 52 }}>
        <div style={{ textAlign: 'center', marginBottom: 38 }}>
          <Marque taille="grand" />
        </div>

        <h1 style={{ marginBottom: 8 }}>Connexion</h1>
        <p className="attenue" style={{ marginBottom: 26 }}>
          Utilisez le numéro fourni par votre compagnie.
        </p>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="tel">
              Téléphone
            </label>
            <input
              id="tel"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="+22670000000"
              required
             
            />
          </div>

          <div>
            <label htmlFor="mdp">
              Mot de passe
            </label>
            <input
              id="mdp"
              type="password"
              autoComplete="current-password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              required
             
            />
          </div>

          {erreur && <p className="erreur">{erreur}</p>}

          <button type="submit" disabled={enCours} style={{ marginTop: 8 }}>
            {enCours ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
