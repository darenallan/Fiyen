import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ConfigTarifaire, DashboardStats } from '../api/types';

const LIBELLES_COURSES: Record<string, string> = {
  en_attente: 'En attente',
  assignee: 'Assignées',
  recuperee: 'Récupérées',
  en_route: 'En route',
  livree: 'Livrées',
  annulee: 'Annulées',
};

const LIBELLES_LIVREURS: Record<string, string> = {
  dispo: 'Disponibles',
  en_course: 'En course',
  offline: 'Hors service',
};

/** Les statuts qui demandent une action ou un suivi sont mis en avant en or. */
const A_SURVEILLER = new Set(['en_attente', 'en_route', 'en_course']);

function Stat({ valeur, libelle, accent }: { valeur: number; libelle: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className={`stat-valeur ${accent && valeur > 0 ? 'accent' : ''}`}>{valeur}</div>
      <div className="stat-libelle">{libelle}</div>
    </div>
  );
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [config, setConfig] = useState<ConfigTarifaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardStats>('/api/dashboard/stats')
      .then(setStats)
      .catch((err) => setErreur(err instanceof ApiError ? err.message : 'Erreur inconnue'));

    api
      .get<ConfigTarifaire>('/api/dashboard/config-tarifaire')
      .then(setConfig)
      .catch(() => {
        // pas de barème configuré — non bloquant pour le tableau de bord
      });
  }, []);

  return (
    <div className="apparition">
      <h1>Tableau de bord</h1>
      {erreur && <p className="erreur">{erreur}</p>}

      <div className="carte" style={{ marginBottom: 18 }}>
        <h2>Courses</h2>
        {stats ? (
          <div className="grille-stats">
            {Object.entries(LIBELLES_COURSES).map(([cle, libelle]) => (
              <Stat
                key={cle}
                valeur={stats.courses_par_statut[cle as keyof typeof stats.courses_par_statut] ?? 0}
                libelle={libelle}
                accent={A_SURVEILLER.has(cle)}
              />
            ))}
          </div>
        ) : (
          <p className="muted-inline">Chargement…</p>
        )}
      </div>

      <div className="carte" style={{ marginBottom: 18 }}>
        <h2>Flotte</h2>
        {stats ? (
          <div className="grille-stats">
            {Object.entries(LIBELLES_LIVREURS).map(([cle, libelle]) => (
              <Stat
                key={cle}
                valeur={
                  stats.livreurs_par_statut[cle as keyof typeof stats.livreurs_par_statut] ?? 0
                }
                libelle={libelle}
                accent={A_SURVEILLER.has(cle)}
              />
            ))}
          </div>
        ) : (
          <p className="muted-inline">Chargement…</p>
        )}
      </div>

      <div className="carte">
        <h2>Barème tarifaire en vigueur</h2>
        {config ? (
          <div className="grille-stats">
            <div className="stat">
              <div className="stat-valeur accent">
                {config.abonnement_mensuel.toLocaleString('fr-FR')}
              </div>
              <div className="stat-libelle">{config.devise} par mois</div>
            </div>
            <div className="stat">
              <div className="stat-valeur">{config.livreurs_inclus}</div>
              <div className="stat-libelle">Livreurs inclus</div>
            </div>
            <div className="stat">
              <div className="stat-valeur">{config.commission_pourcentage} %</div>
              <div className="stat-libelle">Commission par course</div>
            </div>
          </div>
        ) : (
          <p className="muted-inline">Aucun barème configuré pour votre compagnie.</p>
        )}
      </div>
    </div>
  );
}
