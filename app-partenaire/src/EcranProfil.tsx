import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  type Collaborateur,
  type Invitation,
  type Partenaire,
  type PreferenceNotification,
  type RolePartenaire,
} from './api';
import { IconeAlerte, IconeCloche, IconeCroix, IconeEquipe, IconeVerrou } from './composants/Icones';

/**
 * Profil de l'entreprise et gestion de son équipe.
 *
 * Un collaborateur voit la fiche mais pas la gestion des comptes : c'est la
 * seule chose qui le distingue du compte principal, et le serveur l'applique
 * de son côté — l'écran ne fait que refléter cette règle.
 */
export function EcranProfil({
  role,
  onDeconnexion,
}: {
  role: RolePartenaire;
  onDeconnexion: () => void;
}) {
  const [partenaire, setPartenaire] = useState<Partenaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .monPartenaire()
      .then(setPartenaire)
      .catch((err) =>
        setErreur(err instanceof ApiError ? err.message : 'Lecture impossible')
      );
  }, []);

  return (
    <div className="app">
      <div className="heros">
        <p className="surtitre">Votre entreprise</p>
        <h1>{partenaire?.nom ?? '…'}</h1>
        {partenaire?.repere && <p className="heros-sous">{partenaire.repere}</p>}
      </div>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      )}

      {partenaire && (
        <section className="carte apparition">
          <div className="chiffres">
            <div>
              <p className="chiffre">{partenaire.nb_courses}</p>
              <p className="surtitre">Livraisons</p>
            </div>
            <div>
              <p className="chiffre">{partenaire.nb_collaborateurs + 1}</p>
              <p className="surtitre">Comptes</p>
            </div>
          </div>
        </section>
      )}

      <Notifications role={role} />

      {role === 'partenaire' && <Equipe />}

      <section className="carte apparition">
        <h2>Confidentialité</h2>
        <div className="ligne-info">
          <span className="jeton-info" aria-hidden="true">
            <IconeVerrou />
          </span>
          <p className="attenue">
            Les numéros de vos destinataires ne sont jamais communiqués aux
            livreurs, ni ceux des livreurs à vos destinataires. Les échanges
            passent par une messagerie qui se ferme à la fin de la course.
          </p>
        </div>
      </section>

      <section className="carte apparition">
        <h2>Session</h2>
        <button type="button" className="contour" onClick={onDeconnexion}>
          Se déconnecter
        </button>
      </section>
    </div>
  );
}

/**
 * Réglages de notification.
 *
 * En lecture pour tous, en écriture pour le seul compte principal : un
 * collaborateur qui couperait les annonces rendrait ses collègues sourds sans
 * qu'ils l'aient demandé.
 */
function Notifications({ role }: { role: RolePartenaire }) {
  const [preferences, setPreferences] = useState<PreferenceNotification[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setPreferences(await api.preferencesNotification());
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function basculer(p: PreferenceNotification) {
    setEnCours(p.evenement);
    setErreur(null);
    try {
      await api.majPreferenceNotification(p.evenement, !p.actif);
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Mise à jour impossible');
    } finally {
      setEnCours(null);
    }
  }

  if (preferences.length === 0 && !erreur) return null;

  return (
    <section className="carte apparition">
      <div className="entete">
        <h2>Ce que vous voulez savoir</h2>
        <IconeCloche />
      </div>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      )}

      <ul className="liste-reglages">
        {preferences.map((p) => (
          <li key={p.evenement}>
            <span className={p.modifiable ? '' : 'attenue'}>{p.libelle}</span>

            {role === 'partenaire' && p.modifiable ? (
              <button
                type="button"
                className={`bascule ${p.actif ? 'active' : ''}`}
                onClick={() => basculer(p)}
                disabled={enCours === p.evenement}
                role="switch"
                aria-checked={p.actif}
                aria-label={p.libelle}
              >
                <span className="bascule-pastille" />
                {/* Le mot double la position du curseur : l'état reste lisible
                    sans percevoir la couleur ni comparer deux positions. */}
                <span className="bascule-mot">{p.actif ? 'Oui' : 'Non'}</span>
              </button>
            ) : (
              <span className="mono-petit">
                {!p.modifiable ? 'Non concerné' : p.actif ? 'Oui' : 'Non'}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="aide">
        {role === 'partenaire'
          ? 'Coupez ce que vous ne voulez pas voir passer. Les autres comptes de votre entreprise suivent le même réglage.'
          : 'Ces réglages sont ceux de votre entreprise. Seul le compte principal peut les modifier.'}
      </p>
    </section>
  );
}

function Equipe() {
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le code n'est rendu qu'à la création et jamais relu : il est gardé ici le
  // temps que le partenaire le transmette.
  const [code, setCode] = useState<{ nom: string; code: string } | null>(null);

  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    try {
      const rep = await api.collaborateurs();
      setCollaborateurs(rep.collaborateurs);
      setInvitations(rep.invitations);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function inviter(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      const inv = await api.inviterCollaborateur(nom, telephone);
      if (inv.code) setCode({ nom: inv.nom, code: inv.code });
      setNom('');
      setTelephone('');
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Invitation impossible');
    } finally {
      setEnvoi(false);
    }
  }

  async function basculer(c: Collaborateur) {
    try {
      await api.majCollaborateur(c.id, !c.actif);
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Mise à jour impossible');
    }
  }

  async function annuler(inv: Invitation) {
    try {
      await api.annulerInvitation(inv.id);
      await charger();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Annulation impossible');
    }
  }

  return (
    <section className="carte apparition">
      <div className="entete">
        <h2>Votre équipe</h2>
        <IconeEquipe />
      </div>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      )}

      {code && (
        <div className="encart-code">
          <p className="surtitre">Code pour {code.nom}</p>
          <p className="code-invitation">{code.code}</p>
          <p className="attenue">
            Affiché une seule fois. Transmettez-le : la personne le saisira avec
            son numéro pour ouvrir son compte.
          </p>
          <button type="button" className="contour" onClick={() => setCode(null)}>
            J’ai noté le code
          </button>
        </div>
      )}

      <ul className="liste-comptes">
        {collaborateurs.map((c) => (
          <li key={c.id}>
            <div>
              <p className="compte-nom">{c.nom || '—'}</p>
              <p className="attenue mono-petit">
                {c.role === 'partenaire' ? 'Compte principal' : 'Collaborateur'} ·{' '}
                {c.nb_courses} livraison{c.nb_courses > 1 ? 's' : ''}
              </p>
            </div>
            {/* Le compte principal n'est pas suspendable : l'entreprise
                perdrait l'accès à son propre espace. */}
            {c.role === 'collaborateur' && (
              <button type="button" className="lien" onClick={() => basculer(c)}>
                {c.actif ? 'Suspendre' : 'Réactiver'}
              </button>
            )}
          </li>
        ))}

        {invitations.map((inv) => (
          <li key={inv.id}>
            <div>
              <p className="compte-nom">{inv.nom}</p>
              <p className="attenue mono-petit">Invitation en attente</p>
            </div>
            <button type="button" className="lien" onClick={() => annuler(inv)}>
              <IconeCroix className="icone-mini" />
              Annuler
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={inviter} className="form-invitation">
        <label>
          Nom
          <input value={nom} onChange={(e) => setNom(e.target.value)} required />
        </label>
        <label>
          Téléphone
          <input
            type="tel"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
            placeholder="+22670000000"
            required
          />
        </label>
        <button type="submit" disabled={envoi}>
          {envoi ? 'Création…' : 'Inviter'}
        </button>
      </form>
      <p className="aide">
        L’invitation produit un code à 6 chiffres à transmettre vous-même : la
        plateforme n’envoie pas encore de SMS.
      </p>
    </section>
  );
}
