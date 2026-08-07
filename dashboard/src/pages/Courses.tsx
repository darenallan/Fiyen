import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Course, Livreur } from '../api/types';

const LIBELLES_STATUT: Record<string, string> = {
  en_attente: 'En attente',
  assignee: 'Assignée',
  recuperee: 'Récupérée',
  en_route: 'En route',
  livree: 'Livrée',
  annulee: 'Annulée',
};

export function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [livreursDispo, setLivreursDispo] = useState<Livreur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<string>('');

  const [telephoneClient, setTelephoneClient] = useState('');
  const [adresseDepart, setAdresseDepart] = useState('');
  const [adresseArrivee, setAdresseArrivee] = useState('');
  const [creationEnCours, setCreationEnCours] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  const [assignationsEnCours, setAssignationsEnCours] = useState<Record<string, string>>({});

  async function chargerCourses() {
    setChargement(true);
    try {
      const path = filtre ? `/api/courses/?statut=${filtre}` : '/api/courses/';
      const data = await api.get<Course[]>(path);
      setCourses(data ?? []);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setChargement(false);
    }
  }

  async function chargerLivreursDispo() {
    try {
      const data = await api.get<Livreur[]>('/api/livreurs/');
      setLivreursDispo((data ?? []).filter((l) => l.statut === 'dispo'));
    } catch {
      // non bloquant pour l'affichage des courses
    }
  }

  useEffect(() => {
    chargerCourses();
    chargerLivreursDispo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtre]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreurCreation(null);
    setCreationEnCours(true);
    try {
      const client = await api.get<{ id: string; nom: string }>(
        `/api/clients/recherche?telephone=${encodeURIComponent(telephoneClient)}`,
      );
      await api.post('/api/courses/', {
        client_id: client.id,
        adresse_depart: adresseDepart,
        adresse_arrivee: adresseArrivee,
      });
      setTelephoneClient('');
      setAdresseDepart('');
      setAdresseArrivee('');
      await chargerCourses();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setErreurCreation("Aucun client trouvé pour ce numéro — le client doit d'abord s'inscrire.");
      } else {
        setErreurCreation(err instanceof ApiError ? err.message : 'Création impossible');
      }
    } finally {
      setCreationEnCours(false);
    }
  }

  async function assigner(courseId: string) {
    const livreurId = assignationsEnCours[courseId];
    if (!livreurId) return;
    try {
      await api.patch(`/api/courses/${courseId}/assigner`, { livreur_id: livreurId });
      await chargerCourses();
      await chargerLivreursDispo();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Assignation impossible');
    }
  }

  return (
    <div className="apparition">
      <h1>Courses</h1>

      <div className="carte" style={{ marginBottom: 24 }}>
        <h2>Créer une course</h2>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            Téléphone du client
            <input
              type="tel"
              value={telephoneClient}
              onChange={(e) => setTelephoneClient(e.target.value)}
              placeholder="+22670000000"
              required
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          <label>
            Adresse de départ
            <input
              value={adresseDepart}
              onChange={(e) => setAdresseDepart(e.target.value)}
              required
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          <label>
            Adresse d'arrivée
            <input
              value={adresseArrivee}
              onChange={(e) => setAdresseArrivee(e.target.value)}
              required
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          <button type="submit" disabled={creationEnCours}>
            {creationEnCours ? 'Création…' : 'Créer'}
          </button>
        </form>
        {erreurCreation && <p className="erreur">{erreurCreation}</p>}
      </div>

      <div className="carte">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Liste des courses</h2>
          <select value={filtre} onChange={(e) => setFiltre(e.target.value)}>
            <option value="">Tous les statuts</option>
            {Object.entries(LIBELLES_STATUT).map(([cle, libelle]) => (
              <option key={cle} value={cle}>
                {libelle}
              </option>
            ))}
          </select>
        </div>

        {erreur && <p className="erreur">{erreur}</p>}
        {chargement ? (
          <p>Chargement…</p>
        ) : courses.length === 0 ? (
          <p className="muted-inline">Aucune course.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Trajet</th>
                <th>Statut</th>
                <th>Créée le</th>
                <th>Assignation</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.adresse_depart} → {c.adresse_arrivee}
                  </td>
                  <td>
                    <span className={`badge ${c.statut}`}>{LIBELLES_STATUT[c.statut]}</span>
                  </td>
                  <td>{new Date(c.created_at).toLocaleString('fr-FR')}</td>
                  <td>
                    {c.statut === 'en_attente' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          value={assignationsEnCours[c.id] ?? ''}
                          onChange={(e) =>
                            setAssignationsEnCours((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                        >
                          <option value="">Choisir un livreur…</option>
                          {livreursDispo.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.nom}
                            </option>
                          ))}
                        </select>
                        <button
                          className="secondaire"
                          disabled={!assignationsEnCours[c.id]}
                          onClick={() => assigner(c.id)}
                        >
                          Assigner
                        </button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
