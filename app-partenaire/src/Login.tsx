import { useState, type FormEvent } from 'react';
import { api, ApiError, decodeRole, setToken } from './api';
import { Marque } from './Marque';
import { IconeAlerte } from './composants/Icones';

/**
 * Connexion, et activation d'un compte invité.
 *
 * Les deux tiennent dans le même écran : un collaborateur qui reçoit son code
 * ne sait pas qu'il doit chercher un écran différent, et l'envoyer ailleurs
 * serait une occasion de le perdre.
 */
export function Login({ onConnecte }: { onConnecte: () => void }) {
  const [activation, setActivation] = useState(false);
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const rep = activation
        ? await api.activerCollaborateur(telephone, code, motDePasse)
        : await api.login(telephone, motDePasse);

      const role = decodeRole(rep.token);
      if (role !== 'partenaire' && role !== 'collaborateur') {
        setErreur(
          "Ce compte n'est pas un compte partenaire. Utilisez l'application qui lui correspond."
        );
        return;
      }

      setToken(rep.token, rep.refresh_token);
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
          {activation ? 'Activer votre compte' : 'Connexion'}
        </h1>
        <p className="attenue" style={{ marginTop: 0, marginBottom: 24 }}>
          {activation
            ? 'Saisissez le code à 6 chiffres que votre entreprise vous a transmis.'
            : 'Espace des entreprises clientes.'}
        </p>

        {erreur && (
          <div className="bandeau-erreur" role="alert">
            <IconeAlerte />
            <span>{erreur}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="carte">
          <label>
            Téléphone
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="+22670000000"
              required
              autoComplete="username"
            />
          </label>

          {activation && (
            <label>
              Code d’invitation
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className="saisie-code"
                required
              />
            </label>
          )}

          <label>
            {activation ? 'Choisissez un mot de passe' : 'Mot de passe'}
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              minLength={8}
              required
              autoComplete={activation ? 'new-password' : 'current-password'}
            />
          </label>

          <button type="submit" className="principal bloc" disabled={enCours}>
            {enCours ? 'Un instant…' : activation ? 'Activer mon compte' : 'Se connecter'}
          </button>
        </form>

        <button
          type="button"
          className="lien centre"
          onClick={() => {
            setActivation((v) => !v);
            setErreur(null);
          }}
        >
          {activation
            ? 'J’ai déjà un compte'
            : 'J’ai reçu un code d’invitation'}
        </button>
      </div>
    </div>
  );
}
