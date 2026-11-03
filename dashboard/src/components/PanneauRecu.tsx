import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api, ApiError, urlMediaPreuve } from '../api/client';
import type { Preuve, Recu } from '../api/types';
import type { Trajet } from './CarteTrajet';

// Chargée à la demande : Leaflet pèse ~45 Ko compressés, inutiles tant
// qu'aucune carte n'est affichée — sensible sur un réseau mobile lent.
const CarteTrajet = lazy(() => import('./CarteTrajet').then((m) => ({ default: m.CarteTrajet })));

/**
 * Reçu d'une course, côté compagnie.
 *
 * Ouvert en boîte de dialogue plutôt qu'en page : la compagnie imprime depuis
 * sa liste, sans perdre son filtre ni sa position de défilement. Le `@media
 * print` de la feuille de styles ne laisse que le document.
 *
 * C'est le seul reçu qui **nomme le livreur** : la compagnie l'emploie, et le
 * lui masquer la priverait du seul moyen de savoir qui a porté le colis. Le
 * partenaire et le destinataire ne l'ont jamais — le serveur ne le leur envoie
 * pas.
 */

const ETAPES: Record<string, string> = {
  creee: 'Course créée',
  assignee: 'Livreur assigné',
  recuperee: 'Colis récupéré',
  en_route: 'En route',
  livree: 'Livré',
  annulee: 'Annulée',
};

function titreDocument(statut: string): string {
  if (statut === 'livree') return 'Reçu de livraison';
  if (statut === 'annulee') return 'Course annulée';
  return 'Bon de course';
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

export function PanneauRecu({ courseId, onFermer }: { courseId: string; onFermer: () => void }) {
  const [recu, setRecu] = useState<Recu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [partageEnCours, setPartageEnCours] = useState(false);
  const [erreurPartage, setErreurPartage] = useState<string | null>(null);
  const [trajet, setTrajet] = useState<Trajet | null>(null);
  const [trajetChargement, setTrajetChargement] = useState(false);
  const [erreurTrajet, setErreurTrajet] = useState<string | null>(null);
  const boite = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    api
      .get<Recu>(`/api/courses/${courseId}/recu`)
      .then(setRecu)
      .catch((err) => setErreur(err instanceof ApiError ? err.message : 'Lecture impossible'));
  }, [courseId]);

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
      setTrajet(await api.get<Trajet>(`/api/courses/${courseId}/trajet`));
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
      const { url } = await api.post<{ url: string; expire_le: string }>(
        `/api/courses/${courseId}/lien-partage`
      );
      // `wa.me/?text=` sans numéro : la plateforme ne connaît que
      // `telephone_hash`, jamais le numéro en clair du destinataire. Le lien
      // pointe vers le reçu **sans le livreur**, même si ce panneau-ci
      // l'affiche à la compagnie — la frontière se refait côté serveur.
      const message = `Reçu de livraison ${recu.numero} — ${recu.compagnie_nom}\n${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    } catch (err) {
      setErreurPartage(err instanceof ApiError ? err.message : 'Partage impossible');
    } finally {
      setPartageEnCours(false);
    }
  }

  // `showModal()` plutôt que l'attribut `open` : lui seul pose le focus dans la
  // boîte, ferme sur Échap et rend le reste de la page inerte. Reconstruire ces
  // trois comportements à la main serait moins fiable qu'un élément natif.
  useEffect(() => {
    boite.current?.showModal();
  }, []);

  return (
    <dialog ref={boite} className="panneau-recu" onClose={onFermer}>
      {erreur && <p className="erreur">{erreur}</p>}
      {!erreur && !recu && <p className="muted-inline">Chargement…</p>}

      {recu && (
        <>
          <article className="recu">
            <header className="recu-entete">
              <div>
                <p className="recu-compagnie">{recu.compagnie_nom}</p>
                {recu.partenaire_nom && <p className="recu-partenaire">pour {recu.partenaire_nom}</p>}
              </div>
              <div className="recu-reference">
                <p className="surtitre">{titreDocument(recu.statut)}</p>
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

            {(recu.livreur_nom || recu.description_colis || recu.instructions) && (
              <section className="recu-bloc">
                {recu.livreur_nom && (
                  <p>
                    <span className="recu-etiquette">Livreur</span>
                    {recu.livreur_nom}
                  </p>
                )}
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

            {recu.preuve && <BlocPreuve courseId={courseId} preuve={recu.preuve} />}

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
                        <td className="recu-auteur">{e.auteur_nom ?? ''}</td>
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
              {/* Une carte Leaflet imprime mal (tuiles chargées en canvas) :
                  elle reste un confort d'écran, le journal ci-dessus porte
                  déjà les horodatages sur le papier. */}
              {trajet && (
                <Suspense fallback={<p className="muted-inline">Chargement de la carte…</p>}>
                  <CarteTrajet trajet={trajet} />
                </Suspense>
              )}
            </section>

            <footer className="recu-pied">
              <p className="attenue">
                Document émis le {horodatage(recu.emis_le)}. Aucun montant n’y figure : la
                facturation est traitée à part.
              </p>
            </footer>
          </article>

        </>
      )}

      {erreurPartage && (
        <p className="sans-impression erreur" role="alert">
          {erreurPartage}
        </p>
      )}

      <div className="sans-impression barre-recu">
        <button className="secondaire" onClick={() => boite.current?.close()}>
          Fermer
        </button>
        {recu && (
          <button className="secondaire" onClick={() => void partagerWhatsApp()} disabled={partageEnCours}>
            {partageEnCours ? 'Préparation du lien…' : 'Partager par WhatsApp'}
          </button>
        )}
        {recu && <button onClick={() => window.print()}>Imprimer</button>}
      </div>
    </dialog>
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
