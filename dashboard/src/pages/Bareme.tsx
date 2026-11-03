import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';

type Mode = 'forfait' | 'paliers' | 'distance';

interface Palier {
  jusqu_a_km: number;
  prix: number;
}

interface Bareme {
  mode: Mode;
  devise: string;
  prix_forfait?: number;
  paliers?: Palier[];
  prix_base?: number;
  prix_par_km?: number;
  prix_minimum?: number;
  coefficient_detour: number;
  arrondi: number;
}

interface VersionBareme extends Bareme {
  id: string;
  motif?: string;
  auteur_role?: string;
  created_at: string;
}

interface LigneApercu {
  distance_km: number;
  prix: number | null;
  raison?: string;
}

const MODES: { cle: Mode; titre: string; explication: string }[] = [
  { cle: 'forfait', titre: 'Forfait', explication: 'Un seul prix, quelle que soit la distance.' },
  { cle: 'paliers', titre: 'Par zones', explication: 'Un prix par tranche de distance : jusqu’à 3 km, jusqu’à 8 km…' },
  { cle: 'distance', titre: 'Au kilomètre', explication: 'Prise en charge + prix au kilomètre, avec un minimum.' },
];

const ARRONDIS = [1, 5, 10, 25, 50, 100];
// Distances de l'aperçu : une course de quartier, de ville, de périphérie.
const DISTANCES_APERCU = [2, 5, 8, 12, 20];

const fcfa = (n: number, devise = 'XOF') => `${n.toLocaleString('fr-FR')} ${devise === 'XOF' ? 'F CFA' : devise}`;

export function resumer(b: Bareme): string {
  switch (b.mode) {
    case 'forfait':
      return `${fcfa(b.prix_forfait ?? 0, b.devise)} par course`;
    case 'paliers':
      return (b.paliers ?? [])
        .map((p) => `jusqu’à ${p.jusqu_a_km.toLocaleString('fr-FR')} km : ${fcfa(p.prix, b.devise)}`)
        .join(' · ');
    case 'distance':
      return `${fcfa(b.prix_base ?? 0, b.devise)} + ${fcfa(b.prix_par_km ?? 0, b.devise)}/km` +
        (b.prix_minimum ? ` (minimum ${fcfa(b.prix_minimum, b.devise)})` : '');
  }
}

// Un champ vide reste vide : on ne pré-remplit aucun prix.
const versNombre = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s.replace(/\s/g, '').replace(',', '.')));
const versTexte = (n?: number) => (n === undefined || n === null ? '' : String(n));

export function Bareme() {
  const [actuel, setActuel] = useState<VersionBareme | null>(null);
  const [historique, setHistorique] = useState<VersionBareme[]>([]);
  const [chargement, setChargement] = useState(true);

  const [mode, setMode] = useState<Mode>('paliers');
  const [forfait, setForfait] = useState('');
  const [paliers, setPaliers] = useState<{ km: string; prix: string }[]>([{ km: '', prix: '' }]);
  const [base, setBase] = useState('');
  const [parKm, setParKm] = useState('');
  const [minimum, setMinimum] = useState('');
  const [detour, setDetour] = useState('1.3');
  const [arrondi, setArrondi] = useState(50);
  const [motif, setMotif] = useState('');

  const [apercu, setApercu] = useState<LigneApercu[] | null>(null);
  const [erreurApercu, setErreurApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  function charger() {
    return api
      .get<{ actuel: VersionBareme | null; historique: VersionBareme[] }>('/api/dashboard/bareme')
      .then((r) => {
        setActuel(r.actuel);
        setHistorique(r.historique);
        if (r.actuel) remplir(r.actuel);
      })
      .catch((err) => setErreur(err instanceof ApiError ? err.message : 'Lecture du barème impossible'))
      .finally(() => setChargement(false));
  }

  function remplir(v: Bareme) {
    setMode(v.mode);
    setForfait(versTexte(v.prix_forfait));
    setPaliers(v.paliers?.length ? v.paliers.map((p) => ({ km: String(p.jusqu_a_km), prix: String(p.prix) })) : [{ km: '', prix: '' }]);
    setBase(versTexte(v.prix_base));
    setParKm(versTexte(v.prix_par_km));
    setMinimum(versTexte(v.prix_minimum));
    setDetour(String(v.coefficient_detour));
    setArrondi(v.arrondi);
  }

  useEffect(() => {
    void charger();
  }, []);

  const brouillon = useMemo<Bareme>(() => {
    const b: Bareme = { mode, devise: 'XOF', coefficient_detour: Number(detour.replace(',', '.')), arrondi };
    if (mode === 'forfait') b.prix_forfait = versNombre(forfait);
    if (mode === 'paliers') {
      b.paliers = paliers
        .filter((p) => p.km.trim() !== '' || p.prix.trim() !== '')
        .map((p) => ({ jusqu_a_km: versNombre(p.km) ?? 0, prix: versNombre(p.prix) ?? 0 }));
    }
    if (mode === 'distance') {
      b.prix_base = versNombre(base);
      b.prix_par_km = versNombre(parKm);
      b.prix_minimum = versNombre(minimum);
    }
    return b;
  }, [mode, forfait, paliers, base, parKm, minimum, detour, arrondi]);

  // Aperçu calculé par le serveur, avec la même fonction que les commandes :
  // ce que la compagnie voit ici est exactement ce que verra le partenaire.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      api
        .post<{ lignes: LigneApercu[] }>('/api/dashboard/bareme/apercu', { bareme: brouillon, distances_km: DISTANCES_APERCU })
        .then((r) => {
          setApercu(r.lignes);
          setErreurApercu(null);
        })
        .catch((err) => {
          setApercu(null);
          setErreurApercu(err instanceof ApiError ? err.message : 'Aperçu indisponible');
        });
    }, 350);
    return () => clearTimeout(minuteur);
  }, [brouillon]);

  async function publier(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setSucces(null);
    if (!window.confirm('Publier ce barème ? Il s’appliquera aux prochaines commandes de vos partenaires. Les commandes déjà passées gardent leur prix.')) return;
    setEnvoi(true);
    try {
      await api.post('/api/dashboard/bareme', { ...brouillon, motif });
      setMotif('');
      setSucces('Barème publié. Il s’applique dès maintenant aux nouvelles commandes.');
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Publication impossible');
    } finally {
      setEnvoi(false);
    }
  }

  const majPalier = (i: number, cle: 'km' | 'prix', valeur: string) =>
    setPaliers((ps) => ps.map((p, j) => (j === i ? { ...p, [cle]: valeur } : p)));

  return (
    <div className="cascade">
      <div className="heros">
        <span className="badge">Tarifs</span>
        <h1 style={{ marginTop: 16 }}>Vos prix de livraison</h1>
        <p className="sous">
          {chargement
            ? 'Chargement…'
            : actuel
              ? `En vigueur : ${resumer(actuel)}`
              : 'Aucun barème publié : vos partenaires voient « prix convenu avec la compagnie ».'}
        </p>
      </div>

      <form className="carte" onSubmit={publier} style={{ marginBottom: 18 }}>
        <h2>Modifier le barème</h2>
        <fieldset className="choix-mode">
          <legend className="sr-only">Mode de calcul</legend>
          {MODES.map((m) => (
            <label key={m.cle} className={`choix-mode-option ${mode === m.cle ? 'actif' : ''}`}>
              <input type="radio" name="mode" value={m.cle} checked={mode === m.cle} onChange={() => setMode(m.cle)} />
              <strong>{m.titre}</strong>
              <span>{m.explication}</span>
            </label>
          ))}
        </fieldset>

        {mode === 'forfait' && (
          <div className="ligne-champs">
            <label>
              Prix par course (F CFA)
              <input inputMode="numeric" value={forfait} onChange={(e) => setForfait(e.target.value)} placeholder="ex. 1 000" />
            </label>
          </div>
        )}

        {mode === 'paliers' && (
          <div>
            {paliers.map((p, i) => (
              <div className="ligne-champs" key={i}>
                <label>
                  Jusqu’à (km)
                  <input inputMode="decimal" value={p.km} onChange={(e) => majPalier(i, 'km', e.target.value)} placeholder={i === 0 ? 'ex. 3' : ''} />
                </label>
                <label>
                  Prix (F CFA)
                  <input inputMode="numeric" value={p.prix} onChange={(e) => majPalier(i, 'prix', e.target.value)} placeholder={i === 0 ? 'ex. 1 000' : ''} />
                </label>
                {paliers.length > 1 && (
                  <button type="button" className="secondaire" onClick={() => setPaliers((ps) => ps.filter((_, j) => j !== i))} aria-label={`Retirer le palier ${i + 1}`}>
                    Retirer
                  </button>
                )}
              </div>
            ))}
            {paliers.length < 10 && (
              <button type="button" className="secondaire" onClick={() => setPaliers((ps) => [...ps, { km: '', prix: '' }])}>
                + Ajouter une zone
              </button>
            )}
            <p className="muted-inline" style={{ marginTop: 8 }}>
              Au-delà de la dernière zone, le prix est « à confirmer » : vous le fixez au cas par cas.
            </p>
          </div>
        )}

        {mode === 'distance' && (
          <div className="ligne-champs">
            <label>
              Prise en charge (F CFA)
              <input inputMode="numeric" value={base} onChange={(e) => setBase(e.target.value)} placeholder="ex. 500" />
            </label>
            <label>
              Par kilomètre (F CFA)
              <input inputMode="numeric" value={parKm} onChange={(e) => setParKm(e.target.value)} placeholder="ex. 150" />
            </label>
            <label>
              Minimum (facultatif)
              <input inputMode="numeric" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="ex. 1 000" />
            </label>
          </div>
        )}

        <details style={{ marginTop: 14 }}>
          <summary>Réglages de calcul</summary>
          <div className="ligne-champs">
            <label>
              Coefficient de détour
              <input inputMode="decimal" value={detour} onChange={(e) => setDetour(e.target.value)} aria-describedby="aide-detour" />
            </label>
            <label>
              Arrondi au-dessus
              <select value={arrondi} onChange={(e) => setArrondi(Number(e.target.value))}>
                {ARRONDIS.map((a) => (
                  <option key={a} value={a}>{a === 1 ? 'Aucun' : `${a} F`}</option>
                ))}
              </select>
            </label>
          </div>
          <p id="aide-detour" className="muted-inline">
            La distance est mesurée à vol d’oiseau entre les deux épingles, puis multipliée par ce
            coefficient pour approcher le trajet par la route (1,3 ≈ ville). Sans épingles, le prix
            « par zones » ou « au kilomètre » est affiché « à confirmer ».
          </p>
        </details>

        <h3 style={{ marginTop: 18 }}>Aperçu</h3>
        {erreurApercu ? (
          <p className="muted-inline" role="status">À compléter : {erreurApercu}</p>
        ) : apercu ? (
          <div className="grille-stats" aria-live="polite">
            {apercu.map((l) => (
              <div className="stat" key={l.distance_km}>
                <div className="stat-valeur">{l.prix !== null ? l.prix.toLocaleString('fr-FR') : '—'}</div>
                <div className="stat-libelle">
                  {l.distance_km} km {l.prix !== null ? '· F CFA' : '· à confirmer'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-inline">Calcul…</p>
        )}

        <label style={{ display: 'block', marginTop: 16 }}>
          Motif du changement (visible dans l’historique)
          <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={200} placeholder="ex. Hausse du carburant" style={{ width: '100%' }} />
        </label>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="submit" disabled={envoi || erreurApercu !== null}>
            {envoi ? 'Publication…' : 'Publier ce barème'}
          </button>
          {actuel && (
            <button type="button" className="secondaire" onClick={() => remplir(actuel)}>
              Revenir au barème en vigueur
            </button>
          )}
        </div>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        {succes && <p className="succes" role="status">{succes}</p>}
      </form>

      <div className="carte">
        <h2>Historique des changements</h2>
        <p className="muted-inline" style={{ marginTop: 0 }}>
          Une version publiée ne se modifie plus : chaque changement s’ajoute ici, avec sa date et son
          motif. Chaque commande garde le prix du barème en vigueur au moment où elle a été passée.
        </p>
        {historique.length === 0 ? (
          <p className="muted-inline">Aucun barème publié pour l’instant.</p>
        ) : (
          <div className="table-defilante">
            <table>
              <thead>
                <tr>
                  <th>Publié le</th>
                  <th>Barème</th>
                  <th>Motif</th>
                </tr>
              </thead>
              <tbody>
                {historique.map((v, i) => (
                  <tr key={v.id}>
                    <td className="mono">
                      {new Date(v.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                      {i === 0 && <span className="badge" style={{ marginLeft: 8 }}>en vigueur</span>}
                    </td>
                    <td>{resumer(v)}</td>
                    <td>{v.motif ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
