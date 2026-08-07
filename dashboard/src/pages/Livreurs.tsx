import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useFlotteLive } from '../api/useFlotteLive';
import { CarteFlotte } from '../components/CarteFlotte';

function libelleStatut(statut: string, enLigne: boolean): string {
  if (!enLigne) return 'Hors ligne';
  if (statut === 'dispo') return 'Disponible';
  if (statut === 'en_course') return 'En course';
  return 'Hors service';
}

function depuisQuand(iso: string | null): string {
  if (!iso) return '—';
  const secondes = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (secondes < 60) return `il y a ${secondes} s`;
  if (secondes < 3600) return `il y a ${Math.floor(secondes / 60)} min`;
  return new Date(iso).toLocaleString('fr-FR');
}

export function Livreurs() {
  const { livreurs, connecte, chargement, erreur, rafraichir } = useFlotteLive();

  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [creationEnCours, setCreationEnCours] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreurCreation(null);
    setCreationEnCours(true);
    try {
      await api.post('/api/livreurs/', { nom, telephone, mot_de_passe: motDePasse });
      setNom('');
      setTelephone('');
      setMotDePasse('');
      await rafraichir();
    } catch (err) {
      setErreurCreation(err instanceof ApiError ? err.message : 'Création impossible');
    } finally {
      setCreationEnCours(false);
    }
  }

  const enLigne = livreurs.filter((l) => l.en_ligne).length;

  return (
    <div className="apparition">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Flotte de livreurs</h1>
        <span className={`badge ${connecte ? 'dispo' : ''}`} title="Flux de positions en direct">
          <span className={`pastille ${connecte ? 'vivante' : ''}`} />
          {connecte ? 'Suivi en direct' : 'Reconnexion'}
        </span>
      </div>

      <div className="carte" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Position en temps réel</h2>
          <span className="muted-inline">
            {enLigne} / {livreurs.length} en ligne
          </span>
        </div>
        <CarteFlotte livreurs={livreurs} />
      </div>

      <div className="carte" style={{ marginBottom: 24 }}>
        <h2>Ajouter un livreur</h2>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            Nom
            <input value={nom} onChange={(e) => setNom(e.target.value)} required style={{ display: 'block', marginTop: 4 }} />
          </label>
          <label>
            Téléphone
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="+22670000000"
              required
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              minLength={8}
              required
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          <button type="submit" disabled={creationEnCours}>
            {creationEnCours ? 'Ajout…' : 'Ajouter'}
          </button>
        </form>
        {erreurCreation && <p className="erreur">{erreurCreation}</p>}
      </div>

      <div className="carte">
        {erreur && <p className="erreur">{erreur}</p>}
        {chargement ? (
          <p>Chargement…</p>
        ) : livreurs.length === 0 ? (
          <p className="muted-inline">Aucun livreur pour le moment.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Statut</th>
                <th>Dernière position</th>
                <th>Reçue</th>
              </tr>
            </thead>
            <tbody>
              {livreurs.map((l) => (
                <tr key={l.id}>
                  <td>{l.nom}</td>
                  <td>
                    <span className={`badge ${l.en_ligne ? l.statut : ''}`}>
                      <span className="pastille" />
                      {libelleStatut(l.statut, l.en_ligne)}
                    </span>
                  </td>
                  <td>
                    {l.latitude !== null && l.longitude !== null
                      ? `${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}`
                      : '—'}
                  </td>
                  <td className="muted-inline">{depuisQuand(l.position_updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
