import { useState, type FormEvent } from 'react';
import { api, ApiError, setToken, decodeRole } from './api';
import { Marque } from './Marque';

export function Login({ onConnecte }: { onConnecte: () => void }) {
  const [inscription, setInscription] = useState(false);
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const { token } = inscription
        ? await api.inscription(nom, telephone, motDePasse)
        : await api.login(telephone, motDePasse);

      if (decodeRole(token) !== 'client') {
        setErreur("Ce compte n'est pas un compte client.");
        return;
      }
      setToken(token);
      onConnecte();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="app">
      <div className="apparition" style={{ marginTop: 56 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Marque taille="grand" />
        </div>

        <h1 style={{ marginBottom: 8 }}>
          {inscription ? 'Créer un compte' : 'Connexion'}
        </h1>
        <p className="attenue" style={{ marginBottom: 28 }}>
          Suivez votre livraison en direct et contactez votre livreur.
        </p>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {inscription && (
            <div>
              <label htmlFor="nom">
                Votre nom
              </label>
              <input
                id="nom"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                required
               
              />
            </div>
          )}

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
              autoComplete={inscription ? 'new-password' : 'current-password'}
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              minLength={inscription ? 8 : undefined}
              required
             
            />
          </div>

          {erreur && <p className="erreur">{erreur}</p>}

          <button type="submit" disabled={enCours} style={{ marginTop: 8 }}>
            {enCours ? 'Patientez…' : inscription ? 'Créer mon compte' : 'Se connecter'}
          </button>
        </form>

        <button
          className="contour"
          onClick={() => {
            setInscription(!inscription);
            setErreur(null);
          }}
          style={{ marginTop: 12 }}
        >
          {inscription ? "J'ai déjà un compte" : 'Créer un compte'}
        </button>
      </div>
    </div>
  );
}
