import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Commande, type StatutCourse } from './api';
import { IconeAlerte, IconeColis, IconeFleche, IconePlus } from './composants/Icones';

const INTERVALLE_RAFRAICHISSEMENT_MS = 20000;

const LIBELLES: Record<StatutCourse, string> = {
  en_attente: 'En attente',
  assignee: 'Livreur assigné',
  recuperee: 'Colis récupéré',
  en_route: 'En route',
  livree: 'Livrée',
  annulee: 'Annulée',
};

/** Les statuts qui demandent encore quelque chose, par opposition à l'archive. */
const EN_COURS: StatutCourse[] = ['en_attente', 'assignee', 'recuperee', 'en_route'];

function quand(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function EcranCommandes({
  onOuvrir,
  onCommander,
  version = 0,
}: {
  onOuvrir: (id: string) => void;
  onCommander: () => void;
  /** Incrementee a chaque evenement recu : declenche un rechargement sans
   *  remonter le composant, ce qui perdrait la position de defilement. */
  version?: number;
}) {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = useCallback(async () => {
    try {
      setCommandes(await api.commandes());
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void rafraichir();
    const timer = window.setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(timer);
  }, [rafraichir, version]);

  const enCours = commandes.filter((c) => EN_COURS.includes(c.statut));
  const terminees = commandes.filter((c) => !EN_COURS.includes(c.statut));

  return (
    <div className="app">
      <div className="heros">
        <p className="surtitre">Vos livraisons</p>
        <h1>
          {enCours.length === 0
            ? 'Aucune livraison en cours'
            : `${enCours.length} livraison${enCours.length > 1 ? 's' : ''} en cours`}
        </h1>
      </div>

      <button type="button" className="principal bloc grand" onClick={onCommander}>
        <IconePlus />
        Commander une livraison
      </button>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      )}

      {chargement ? (
        <p className="attenue">Chargement…</p>
      ) : commandes.length === 0 ? (
        <div className="carte vide apparition">
          <IconeColis className="icone-vide" />
          <p>Vous n’avez pas encore commandé de livraison.</p>
          <p className="attenue">
            Indiquez d’où part le colis, où il va, et votre compagnie s’occupe du
            reste.
          </p>
        </div>
      ) : (
        <>
          {enCours.length > 0 && (
            <section className="apparition">
              <h2 className="titre-section">En cours</h2>
              <ul className="liste-commandes">
                {enCours.map((c) => (
                  <LigneCommande key={c.id} commande={c} onOuvrir={onOuvrir} />
                ))}
              </ul>
            </section>
          )}

          {terminees.length > 0 && (
            <section className="apparition">
              <h2 className="titre-section">Terminées</h2>
              <ul className="liste-commandes">
                {terminees.map((c) => (
                  <LigneCommande key={c.id} commande={c} onOuvrir={onOuvrir} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function LigneCommande({
  commande: c,
  onOuvrir,
}: {
  commande: Commande;
  onOuvrir: (id: string) => void;
}) {
  return (
    <li>
      <button type="button" className="ligne-commande" onClick={() => onOuvrir(c.id)}>
        <div className="ligne-tete">
          {/* Le numéro court est en tête : c'est lui qu'on cherche des yeux
              quand on a la compagnie au téléphone. */}
          <span className="numero-course">{c.numero}</span>
          <span className={`badge statut-${c.statut}`}>
            <span className="pastille" />
            {LIBELLES[c.statut]}
          </span>
        </div>
        <p className="ligne-destinataire">{c.destinataire_nom}</p>
        <p className="ligne-adresse attenue">{c.adresse_arrivee}</p>
        <div className="ligne-pied">
          <span className="mono-petit">{quand(c.created_at)}</span>
          <IconeFleche className="icone-mini" />
        </div>
      </button>
    </li>
  );
}
