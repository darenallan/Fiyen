import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';

/**
 * Entreprises clientes de la compagnie.
 *
 * Vocabulaire, à ne pas confondre : la **compagnie** est la société de
 * livraison (l'utilisateur de ce dashboard), le **partenaire** est une de ses
 * entreprises clientes, le **collaborateur** un employé de cette entreprise.
 */

interface Partenaire {
  id: string;
  nom: string;
  repere?: string;
  statut: 'actif' | 'suspendu';
  visibilite_collaborateurs: 'entreprise' | 'personnelle';
  nb_collaborateurs: number;
  nb_courses: number;
  created_at: string;
}

interface Collaborateur {
  id: string;
  nom: string;
  role: 'partenaire' | 'collaborateur';
  actif: boolean;
  nb_courses: number;
}

interface Invitation {
  id: string;
  nom: string;
  expire_at: string;
  code?: string;
}

const INTERVALLE_RAFRAICHISSEMENT_MS = 20000;

export function Partenaires() {
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [ouvert, setOuvert] = useState<string | null>(null);

  const rafraichir = useCallback(async () => {
    try {
      setPartenaires(await api.get<Partenaire[]>('/api/partenaires/'));
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void rafraichir();
    // 20 s comme partout ailleurs : la liste bouge peu, et un réseau mobile
    // facturé au volume ne justifie pas plus fréquent.
    const timer = window.setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(timer);
  }, [rafraichir]);

  const actifs = partenaires.filter((p) => p.statut === 'actif').length;

  return (
    <div className="apparition">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <h1 style={{ margin: 0 }}>Partenaires</h1>
        <span className="muted-inline">
          {actifs} actif{actifs > 1 ? 's' : ''} sur {partenaires.length}
        </span>
      </div>

      <FormulaireCreation onCree={rafraichir} />

      <div className="carte">
        {erreur && <p className="erreur">{erreur}</p>}
        {chargement ? (
          <p>Chargement…</p>
        ) : partenaires.length === 0 ? (
          <p className="muted-inline">
            Aucune entreprise cliente pour l’instant. Ajoutez-en une pour qu’elle
            passe ses commandes elle-même.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Repère</th>
                <th>Comptes</th>
                <th>Courses</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {partenaires.map((p) => (
                <LignePartenaire
                  key={p.id}
                  partenaire={p}
                  ouvert={ouvert === p.id}
                  onBasculer={() => setOuvert(ouvert === p.id ? null : p.id)}
                  onChange={rafraichir}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FormulaireCreation({ onCree }: { onCree: () => Promise<void> }) {
  const [nom, setNom] = useState('');
  const [repere, setRepere] = useState('');
  const [telephone, setTelephone] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await api.post('/api/partenaires/', {
        nom,
        repere,
        telephone,
        mot_de_passe: motDePasse,
      });
      setNom('');
      setRepere('');
      setTelephone('');
      setMotDePasse('');
      await onCree();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Création impossible');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="carte" style={{ marginBottom: 24 }}>
      <h2>Ajouter une entreprise cliente</h2>
      <p className="muted-inline" style={{ marginTop: 0, marginBottom: 14 }}>
        Le numéro et le mot de passe ouvrent son compte principal : c’est avec eux
        qu’elle se connectera pour commander.
      </p>
      <form
        onSubmit={onSubmit}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <label>
          Nom de l’entreprise
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            required
            style={{ display: 'block', marginTop: 4 }}
          />
        </label>
        <label>
          Repère
          <input
            value={repere}
            onChange={(e) => setRepere(e.target.value)}
            /* Repère verbal plutôt qu'adresse postale : à Ouagadougou la
               plupart des commerces n'ont pas d'adresse normalisée. */
            placeholder="Face à la station Total de Gounghin"
            style={{ display: 'block', marginTop: 4, minWidth: 260 }}
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
        <button type="submit" disabled={enCours}>
          {enCours ? 'Ajout…' : 'Ajouter'}
        </button>
      </form>
      {erreur && <p className="erreur">{erreur}</p>}
    </div>
  );
}

function LignePartenaire({
  partenaire: p,
  ouvert,
  onBasculer,
  onChange,
}: {
  partenaire: Partenaire;
  ouvert: boolean;
  onBasculer: () => void;
  onChange: () => Promise<void>;
}) {
  const [enCours, setEnCours] = useState(false);

  async function basculerStatut() {
    setEnCours(true);
    try {
      await api.patch(`/api/partenaires/${p.id}`, {
        statut: p.statut === 'actif' ? 'suspendu' : 'actif',
      });
      await onChange();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <tr>
        <td>{p.nom}</td>
        <td className="muted-inline">{p.repere ?? '—'}</td>
        <td>{p.nb_collaborateurs + 1}</td>
        <td>{p.nb_courses}</td>
        <td>
          <span className={`badge ${p.statut === 'actif' ? 'dispo' : ''}`}>
            <span className="pastille" />
            {p.statut === 'actif' ? 'Actif' : 'Suspendu'}
          </span>
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="secondaire" onClick={onBasculer} aria-expanded={ouvert}>
            {ouvert ? 'Masquer' : 'Comptes'}
          </button>{' '}
          <button className="secondaire" onClick={basculerStatut} disabled={enCours}>
            {p.statut === 'actif' ? 'Suspendre' : 'Réactiver'}
          </button>
        </td>
      </tr>
      {ouvert && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--creme-2)' }}>
            <Comptes partenaire={p} onChange={onChange} />
          </td>
        </tr>
      )}
    </>
  );
}

function Comptes({
  partenaire: p,
  onChange,
}: {
  partenaire: Partenaire;
  onChange: () => Promise<void>;
}) {
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le code d'une invitation n'est rendu qu'à sa création et jamais relu :
  // il est gardé ici, le temps que l'opérateur le transmette.
  const [codeAffiche, setCodeAffiche] = useState<{ nom: string; code: string } | null>(null);

  const [nomInvite, setNomInvite] = useState('');
  const [telInvite, setTelInvite] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const charger = useCallback(async () => {
    try {
      const rep = await api.get<{
        collaborateurs: Collaborateur[];
        invitations: Invitation[];
      }>(`/api/partenaires/${p.id}/collaborateurs`);
      setCollaborateurs(rep.collaborateurs);
      setInvitations(rep.invitations);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
    } finally {
      setChargement(false);
    }
  }, [p.id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function inviter(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      const inv = await api.post<Invitation>(`/api/partenaires/${p.id}/collaborateurs`, {
        nom: nomInvite,
        telephone: telInvite,
      });
      if (inv.code) setCodeAffiche({ nom: inv.nom, code: inv.code });
      setNomInvite('');
      setTelInvite('');
      await charger();
      await onChange();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Invitation impossible');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function basculerCompte(c: Collaborateur) {
    try {
      await api.patch(`/api/partenaires/${p.id}/collaborateurs/${c.id}`, { actif: !c.actif });
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Mise à jour impossible');
    }
  }

  async function annulerInvitation(inv: Invitation) {
    try {
      await api.delete(`/api/partenaires/${p.id}/invitations/${inv.id}`);
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Annulation impossible');
    }
  }

  return (
    <div style={{ padding: '16px 4px' }}>
      {erreur && <p className="erreur">{erreur}</p>}

      {codeAffiche && (
        <div className="carte" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Code d’invitation pour {codeAffiche.nom}</h3>
          <p className="code-invitation">{codeAffiche.code}</p>
          <p className="muted-inline" style={{ marginBottom: 0 }}>
            Ce code n’est affiché qu’une fois. Transmettez-le à la personne : elle
            le saisira avec son numéro pour ouvrir son compte.
          </p>
          <button
            className="secondaire"
            style={{ marginTop: 12 }}
            onClick={() => setCodeAffiche(null)}
          >
            J’ai noté le code
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 0 }}>Comptes de {p.nom}</h3>
      {chargement ? (
        <p>Chargement…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Rôle</th>
              <th>Courses</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {collaborateurs.map((c) => (
              <tr key={c.id}>
                <td>{c.nom || '—'}</td>
                <td className="muted-inline">
                  {c.role === 'partenaire' ? 'Compte principal' : 'Collaborateur'}
                </td>
                <td>{c.nb_courses}</td>
                <td>
                  <span className={`badge ${c.actif ? 'dispo' : ''}`}>
                    <span className="pastille" />
                    {c.actif ? 'Actif' : 'Suspendu'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {/* Le compte principal n'est pas suspendable : l'entreprise
                      perdrait l'accès à son propre espace. On suspend
                      l'entreprise entière depuis la ligne au-dessus. */}
                  {c.role === 'collaborateur' && (
                    <button className="secondaire" onClick={() => basculerCompte(c)}>
                      {c.actif ? 'Suspendre' : 'Réactiver'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invitations.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.nom}</td>
                <td className="muted-inline">Collaborateur</td>
                <td>—</td>
                <td>
                  <span className="badge">
                    <span className="pastille" />
                    Invitation en attente
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {/* Une invitation part souvent au mauvais numéro : pouvoir la
                      retirer évite qu'un code reste valide sept jours durant. */}
                  <button className="secondaire" onClick={() => annulerInvitation(inv)}>
                    Annuler
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        onSubmit={inviter}
        style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}
      >
        <label>
          Nom du collaborateur
          <input
            value={nomInvite}
            onChange={(e) => setNomInvite(e.target.value)}
            required
            style={{ display: 'block', marginTop: 4 }}
          />
        </label>
        <label>
          Téléphone
          <input
            type="tel"
            value={telInvite}
            onChange={(e) => setTelInvite(e.target.value)}
            placeholder="+22670000000"
            required
            style={{ display: 'block', marginTop: 4 }}
          />
        </label>
        <button type="submit" disabled={envoiEnCours}>
          {envoiEnCours ? 'Création…' : 'Inviter'}
        </button>
      </form>
      <p className="muted-inline" style={{ marginBottom: 0 }}>
        L’invitation produit un code à 6 chiffres à transmettre vous-même : la
        plateforme n’envoie pas encore de SMS.
      </p>
    </div>
  );
}
