import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, telechargerFichier } from '../api/client';

interface Delai {
  moyenne_s: number | null;
  mediane_s: number | null;
  n: number;
}

interface Indicateurs {
  creees: number;
  livrees: number;
  annulees: number;
  en_cours: number;
  taux_reussite: number | null;
  taux_annulation: number | null;
  delai_assignation: Delai;
  delai_prise_en_charge: Delai;
  delai_livraison: Delai;
  duree_totale: Delai;
  montant_livre: number;
  livrees_sans_prix: number;
}

interface Periode {
  debut: string;
  fin: string;
}

interface Reponse {
  mois: string;
  partiel: boolean;
  periode: Periode;
  comparaison: Periode;
  indicateurs: Indicateurs;
  indicateurs_precedents: Indicateurs;
  par_livreur: { nom: string; livrees: number; en_cours: number; delai_livraison: Delai }[];
  par_partenaire: { nom: string; commandes: number; livrees: number; annulees: number; montant_livre: number }[];
  definitions: Record<string, string>;
}

const moisCourant = () => new Date().toISOString().slice(0, 7);

function duree(s: number | null): string {
  if (s === null) return '—';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

const pourcent = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)} %`);
const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} F`;

// « 1er octobre » et non « 1 octobre » : Intl n'écrit pas l'ordinal français.
const jourMois = (iso: string) => {
  const d = new Date(iso);
  const mois = d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  const jour = d.getUTCDate();
  return `${jour === 1 ? '1er' : jour} ${mois}`;
};

/**
 * Écart avec la période de comparaison, en mots et pas seulement en couleur.
 * `plusEstMieux` dit dans quel sens l'écart est une bonne nouvelle : plus de
 * courses, oui ; plus de minutes d'attente, non.
 */
function Ecart({ actuel, avant, plusEstMieux, format }: {
  actuel: number | null;
  avant: number | null;
  plusEstMieux: boolean;
  format: (v: number) => string;
}) {
  if (actuel === null || avant === null || avant === 0) {
    return <span className="ecart neutre">pas de point de comparaison</span>;
  }
  const delta = actuel - avant;
  if (Math.abs(delta) < 1e-9) return <span className="ecart neutre">stable</span>;
  const bon = delta > 0 === plusEstMieux;
  const relatif = Math.round((delta / avant) * 100);
  return (
    <span className={`ecart ${bon ? 'bon' : 'mauvais'}`}>
      {delta > 0 ? '▲' : '▼'} {delta > 0 ? '+' : ''}{relatif} %{' '}
      <span className="sr-only">{bon ? '(amélioration)' : '(dégradation)'}</span>
      <span className="ecart-detail">(avant : {format(avant)})</span>
    </span>
  );
}

function Indicateur({ titre, valeur, sous, definition, children }: {
  titre: string;
  valeur: string;
  sous?: string;
  definition: string;
  children?: ReactNode;
}) {
  return (
    <div className="stat indicateur">
      <div className="stat-libelle">{titre}</div>
      <div className="stat-valeur">{valeur}</div>
      {sous && <div className="muted-inline">{sous}</div>}
      {children}
      <details className="definition">
        <summary>Comment c’est calculé</summary>
        <p>{definition}</p>
      </details>
    </div>
  );
}

export function Statistiques() {
  const [mois, setMois] = useState(moisCourant());
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [exportEnCours, setExportEnCours] = useState(false);

  useEffect(() => {
    setDonnees(null);
    setErreur(null);
    api
      .get<Reponse>(`/api/dashboard/statistiques?mois=${mois}`)
      .then(setDonnees)
      .catch((err) => setErreur(err instanceof ApiError ? err.message : 'Statistiques indisponibles'));
  }, [mois]);

  async function exporter() {
    setExportEnCours(true);
    try {
      await telechargerFichier(`/api/dashboard/statistiques/export?mois=${mois}`, `fiyen-courses-${mois}.csv`);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Export impossible');
    } finally {
      setExportEnCours(false);
    }
  }

  const i = donnees?.indicateurs;
  const p = donnees?.indicateurs_precedents;
  const d = donnees?.definitions ?? {};

  let sousTitre = 'Chargement…';
  if (donnees) {
    const finAffichee = donnees.partiel
      ? 'à aujourd’hui'
      : `au ${jourMois(new Date(new Date(donnees.periode.fin).getTime() - 1).toISOString())}`;
    const moisComparaison = new Date(donnees.comparaison.debut).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
    sousTitre = `Du ${jourMois(donnees.periode.debut)} ${finAffichee}, comparé ${donnees.partiel ? 'aux mêmes jours' : 'au mois'} de ${moisComparaison}.`;
  }

  return (
    <div className="cascade">
      <div className="heros">
        <span className="badge">Pilotage</span>
        <h1 style={{ marginTop: 16 }}>Statistiques</h1>
        <p className="sous">{sousTitre}</p>
      </div>

      <div className="barre-outils" style={{ marginBottom: 18, alignItems: 'flex-end' }}>
        <label style={{ margin: 0 }}>
          Mois
          <input type="month" value={mois} max={moisCourant()} onChange={(e) => e.target.value && setMois(e.target.value)} style={{ display: 'block', marginTop: 4 }} />
        </label>
        <button className="secondaire" onClick={() => void exporter()} disabled={exportEnCours}>
          {exportEnCours ? 'Export…' : 'Exporter en CSV (Excel)'}
        </button>
      </div>

      {erreur && <p className="erreur" role="alert">{erreur}</p>}

      {!donnees && !erreur && <p className="muted-inline">Calcul des indicateurs…</p>}

      {donnees && i && p && (
        <>
          {i.creees === 0 ? (
            <div className="carte">
              <h2>Aucune course sur cette période</h2>
              <p className="muted-inline">Les indicateurs apparaîtront dès la première course du mois.</p>
            </div>
          ) : (
            <div className="carte" style={{ marginBottom: 18 }}>
              <h2>L’essentiel</h2>
              <div className="grille-stats grille-indicateurs">
                <Indicateur titre="Courses" valeur={String(i.creees)} sous={`${i.livrees} livrées · ${i.annulees} annulées · ${i.en_cours} en cours`} definition={d.creees}>
                  <Ecart actuel={i.creees} avant={p.creees} plusEstMieux format={String} />
                </Indicateur>
                <Indicateur titre="Taux de réussite" valeur={pourcent(i.taux_reussite)} sous={`annulation ${pourcent(i.taux_annulation)}`} definition={`${d.taux_reussite} Annulation : ${d.taux_annulation}`}>
                  <Ecart actuel={i.taux_reussite} avant={p.taux_reussite} plusEstMieux format={pourcent} />
                </Indicateur>
                <Indicateur titre="Attente avant départ du colis" valeur={duree(i.delai_prise_en_charge.mediane_s)} sous={`médiane · moyenne ${duree(i.delai_prise_en_charge.moyenne_s)}`} definition={`${d.delai_prise_en_charge} ${d.mediane}`}>
                  <Ecart actuel={i.delai_prise_en_charge.mediane_s} avant={p.delai_prise_en_charge.mediane_s} plusEstMieux={false} format={duree} />
                </Indicateur>
                <Indicateur titre="Durée du trajet" valeur={duree(i.delai_livraison.mediane_s)} sous={`médiane · moyenne ${duree(i.delai_livraison.moyenne_s)}`} definition={d.delai_livraison}>
                  <Ecart actuel={i.delai_livraison.mediane_s} avant={p.delai_livraison.mediane_s} plusEstMieux={false} format={duree} />
                </Indicateur>
                <Indicateur titre="Commande → livré" valeur={duree(i.duree_totale.mediane_s)} sous={`médiane · livreur assigné en ${duree(i.delai_assignation.mediane_s)}`} definition={`${d.duree_totale} Assignation : ${d.delai_assignation}`}>
                  <Ecart actuel={i.duree_totale.mediane_s} avant={p.duree_totale.mediane_s} plusEstMieux={false} format={duree} />
                </Indicateur>
                <Indicateur titre="Montant livré (barème)" valeur={fcfa(i.montant_livre)} sous={i.livrees_sans_prix > 0 ? `+ ${i.livrees_sans_prix} livraison(s) sans prix` : 'toutes les livraisons ont un prix'} definition={d.montant_livre}>
                  <Ecart actuel={i.montant_livre} avant={p.montant_livre} plusEstMieux format={fcfa} />
                </Indicateur>
              </div>
            </div>
          )}

          {donnees.par_livreur.length > 0 && (
            <div className="carte" style={{ marginBottom: 18 }}>
              <h2>Par livreur</h2>
              <div className="table-defilante">
                <table>
                  <thead>
                    <tr><th>Livreur</th><th>Livrées</th><th>En cours</th><th>Trajet médian</th></tr>
                  </thead>
                  <tbody>
                    {donnees.par_livreur.map((l) => (
                      <tr key={l.nom}>
                        <td>{l.nom}</td>
                        <td className="mono">{l.livrees}</td>
                        <td className="mono">{l.en_cours}</td>
                        <td className="mono">{duree(l.delai_livraison.mediane_s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {donnees.par_partenaire.length > 0 && (
            <div className="carte">
              <h2>Par client</h2>
              <div className="table-defilante">
                <table>
                  <thead>
                    <tr><th>Client</th><th>Commandes</th><th>Livrées</th><th>Annulées</th><th>Montant livré</th></tr>
                  </thead>
                  <tbody>
                    {donnees.par_partenaire.map((l) => (
                      <tr key={l.nom}>
                        <td>{l.nom}</td>
                        <td className="mono">{l.commandes}</td>
                        <td className="mono">{l.livrees}</td>
                        <td className="mono">{l.annulees}</td>
                        <td className="mono">{fcfa(l.montant_livre)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
