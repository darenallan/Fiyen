import { lazy, Suspense, useEffect, useState } from 'react';
import { api, ApiError, urlMediaPreuve, type Preuve, type Recu } from './api';
import { IconeAlerte, IconeRetour } from './composants/Icones';
import type { Trajet } from './CarteTrajet';

// Chargée à la demande : Leaflet pèse ~45 Ko compressés, inutiles tant
// qu'aucune carte n'est affichée — sensible sur un réseau mobile lent.
const CarteTrajet = lazy(() => import('./CarteTrajet').then((m) => ({ default: m.CarteTrajet })));

/**
 * Reçu imprimable d'une commande.
 *
 * `@media print` plutôt qu'un générateur de PDF : moins de dépendances, et le
 * navigateur sait déjà produire un PDF depuis une page. Le document est ce
 * qu'on remet au destinataire ou qu'on classe.
 *
 * Il ne porte **aucun montant** : le barème en base est un abonnement et une
 * commission, pas un tarif par course. Inventer un chiffre sur un justificatif
 * serait pire qu'ailleurs.
 *
 * Il ne nomme **pas le livreur** : la garantie de masquage vaut aussi sur
 * papier, et le serveur ne l'envoie pas à cette audience.
 */

const ETAPES: Record<string, string> = {
  creee: 'Commande reçue',
  assignee: 'Livreur assigné',
  recuperee: 'Colis récupéré',
  en_route: 'En route',
  livree: 'Livré',
  annulee: 'Annulée',
};

/**
 * Le document change de nom selon l'avancement, et c'est le seul endroit où il
 * varie : appeler « reçu de livraison » un colis pas encore parti serait faux
 * sur un papier qu'on classe.
 */
function titreDocument(statut: string): string {
  if (statut === 'livree') return 'Reçu de livraison';
  if (statut === 'annulee') return 'Commande annulée';
  return 'Bon de commande';
}

function horodatage(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EcranRecu({
  commandeID,
  onRetour,
}: {
  commandeID: string;
  onRetour: () => void;
}) {
  const [recu, setRecu] = useState<Recu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [partageEnCours, setPartageEnCours] = useState(false);
  const [erreurPartage, setErreurPartage] = useState<string | null>(null);
  const [trajet, setTrajet] = useState<Trajet | null>(null);
  const [trajetChargement, setTrajetChargement] = useState(false);
  const [erreurTrajet, setErreurTrajet] = useState<string | null>(null);

  useEffect(() => {
    api
      .recu(commandeID)
      .then(setRecu)
      .catch((err) =>
        setErreur(err instanceof ApiError ? err.message : 'Lecture impossible')
      );
  }, [commandeID]);

  async function basculerTrajet() {
    if (trajet) {
      // Un second clic referme : la carte n'a pas de raison d'être rechargée
      // tant que la course n'a pas bougé, et un rejeu déjà livré ne bouge plus.
      setTrajet(null);
      return;
    }
    setTrajetChargement(true);
    setErreurTrajet(null);
    try {
      setTrajet(await api.trajet(commandeID));
    } catch (err) {
      setErreurTrajet(err instanceof ApiError ? err.message : 'Trajet indisponible');
    } finally {
      setTrajetChargement(false);
    }
  }

  async function partagerWhatsApp() {
    if (!recu) return;
    setPartageEnCours(true);
    setErreurPartage(null);
    try {
      const { url } = await api.lienPartageRecu(commandeID);
      // `wa.me/?text=` sans numéro : la plateforme ne connaît que
      // `telephone_hash`, jamais le numéro en clair du destinataire. C'est
      // celui qui partage qui choisit le contact depuis son propre téléphone.
      const message = `Reçu de livraison ${recu.numero} — ${recu.compagnie_nom}\n${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    } catch (err) {
      setErreurPartage(err instanceof ApiError ? err.message : 'Partage impossible');
    } finally {
      setPartageEnCours(false);
    }
  }

  if (erreur) {
    return (
      <div className="app">
        <button type="button" className="lien retour" onClick={onRetour}>
          <IconeRetour />
          Retour
        </button>
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      </div>
    );
  }

  if (!recu) {
    return (
      <div className="app">
        <p className="attenue">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Hors impression seulement : une barre d'actions sur un document
          imprimé n'a aucun sens. */}
      <div className="sans-impression">
        <button type="button" className="lien retour" onClick={onRetour}>
          <IconeRetour />
          Retour à la commande
        </button>
      </div>

      <article className="recu">
        <header className="recu-entete">
          <div>
            <p className="recu-compagnie">{recu.compagnie_nom}</p>
            {recu.partenaire_nom && (
              <p className="recu-partenaire">pour {recu.partenaire_nom}</p>
            )}
          </div>
          <div className="recu-reference">
            <p className="surtitre">{titreDocument(recu.statut)}</p>
            {/* Le numéro de la course fait office de référence : une seconde
                numérotation obligerait à demander « lequel des deux ? » à
                chaque appel. */}
            <p className="recu-numero">{recu.numero}</p>
          </div>
        </header>

        <section className="recu-trajet">
          <div>
            <p className="surtitre">Retrait</p>
            <p className="recu-adresse">{recu.adresse_depart}</p>
            {recu.repere_depart && <p className="attenue">{recu.repere_depart}</p>}
          </div>
          <div>
            <p className="surtitre">Livraison</p>
            <p className="recu-adresse">{recu.adresse_arrivee}</p>
            {recu.repere_arrivee && <p className="attenue">{recu.repere_arrivee}</p>}
            <p className="recu-destinataire">{recu.destinataire_nom}</p>
          </div>
        </section>

        {(recu.description_colis || recu.instructions) && (
          <section className="recu-bloc">
            {recu.description_colis && (
              <p>
                <span className="recu-etiquette">Colis</span>
                {recu.description_colis}
              </p>
            )}
            {recu.instructions && (
              <p>
                <span className="recu-etiquette">Consigne</span>
                {recu.instructions}
              </p>
            )}
          </section>
        )}

        {recu.preuve && <BlocPreuve courseId={commandeID} preuve={recu.preuve} />}

        <section className="recu-bloc">
          <p className="surtitre">Déroulé</p>
          {recu.journal.length === 0 ? (
            <p className="attenue">Aucune étape enregistrée.</p>
          ) : (
            <table className="recu-journal">
              <tbody>
                {recu.journal.map((e, i) => (
                  <tr key={`${e.type}-${i}`}>
                    <td className="recu-heure">{horodatage(e.horodatage)}</td>
                    <td>{ETAPES[e.type] ?? e.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="recu-bloc sans-impression">
          <div className="recu-trajet-entete">
            <p className="surtitre">Trajet</p>
            <button
              type="button"
              className="lien"
              onClick={() => void basculerTrajet()}
              disabled={trajetChargement}
            >
              {trajetChargement ? 'Chargement…' : trajet ? 'Masquer' : 'Voir sur la carte'}
            </button>
          </div>
          {erreurTrajet && <p className="attenue">{erreurTrajet}</p>}
          {/* Une carte Leaflet imprime mal (tuiles chargées en canvas) : elle
              reste un confort d'écran, le journal ci-dessus porte déjà les
              horodatages sur le papier. */}
          {trajet && (
            <Suspense fallback={<p className="attenue">Chargement de la carte…</p>}>
              <CarteTrajet trajet={trajet} />
            </Suspense>
          )}
        </section>

        <footer className="recu-pied">
          <p className="attenue">
            Document émis le {horodatage(recu.emis_le)}. Le tarif est celui
            convenu avec votre compagnie de livraison ; il ne figure pas sur ce
            reçu.
          </p>
        </footer>
      </article>

      {erreurPartage && (
        <div className="sans-impression bandeau-erreur" role="alert">
          <IconeAlerte className="icone-inline" />
          <span>{erreurPartage}</span>
        </div>
      )}

      <div className="sans-impression barre-actions">
        <button
          type="button"
          className="contour"
          onClick={() => void partagerWhatsApp()}
          disabled={partageEnCours}
        >
          {partageEnCours ? 'Préparation du lien…' : 'Partager par WhatsApp'}
        </button>
        <button type="button" className="principal" onClick={() => window.print()}>
          Imprimer
        </button>
      </div>
    </div>
  );
}

/**
 * Bloc « preuve de remise » du reçu.
 *
 * L'image est chargée à part et non incluse dans le reçu : la joindre
 * gonflerait chaque ouverture d'une centaine de kilo-octets, relus à chaque
 * fois, alors que séparée elle passe par le cache du navigateur.
 *
 * Son absence n'est pas une anomalie — la remise n'est pas conditionnée à une
 * signature — donc rien ne s'affiche plutôt qu'un « aucune preuve » qui
 * ressemblerait à un manquement.
 */
function BlocPreuve({ courseId, preuve }: { courseId: string; preuve: Preuve }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!preuve.type_media) return;
    let vivant = true;
    let cree: string | null = null;

    void urlMediaPreuve(courseId).then((u) => {
      if (!vivant) {
        // Le composant est parti avant la réponse : révoquer tout de suite,
        // sinon le blob reste en mémoire jusqu'au rechargement de la page.
        if (u) URL.revokeObjectURL(u);
        return;
      }
      cree = u;
      setUrl(u);
    });

    return () => {
      vivant = false;
      if (cree) URL.revokeObjectURL(cree);
    };
  }, [courseId, preuve.type_media]);

  return (
    <section className="recu-bloc">
      <p className="surtitre">Preuve de remise</p>
      {preuve.nom_receptionnaire && (
        <p>
          <span className="recu-etiquette">Reçu par</span>
          {preuve.nom_receptionnaire}
        </p>
      )}
      <p>
        <span className="recu-etiquette">Le</span>
        {horodatage(preuve.capture_le)}
      </p>
      {url && (
        <img
          className={`recu-preuve-media ${preuve.type_media}`}
          src={url}
          alt={
            preuve.type_media === 'signature'
              ? 'Signature du réceptionnaire'
              : 'Photo prise à la remise'
          }
        />
      )}
    </section>
  );
}
