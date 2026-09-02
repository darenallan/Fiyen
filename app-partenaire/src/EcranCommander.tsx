import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type BrouillonCommande, type Commande, type Destinataire } from './api';
import { ChoixPoint } from './composants/ChoixPoint';
import {
  IconeAlerte,
  IconeCarnet,
  IconeCheck,
  IconeColis,
  IconeEpingle,
  IconeFleche,
  IconeRetour,
} from './composants/Icones';

/**
 * Commander une livraison.
 *
 * Le parcours est découpé en trois temps plutôt que présenté comme un
 * formulaire unique : sur un téléphone, dix champs d'affilée découragent, et
 * une erreur en bas oblige à tout relire. Chaque étape pose une question et une
 * seule — d'où part le colis, où va-t-il, qu'est-ce que c'est.
 *
 * Ce parcours est inspiré de l'envoi de colis chez Glovo. Il ne comporte
 * volontairement ni catalogue, ni panier, ni paiement : il n'y a ni commerce ni
 * produit dans ce produit, et en inventer supposerait des données fictives.
 */

const CLE_BROUILLON = 'fiyen_partenaire_brouillon';

type Etape = 'depart' | 'arrivee' | 'colis' | 'recap';

const ETAPES: { cle: Etape; titre: string; question: string }[] = [
  { cle: 'depart', titre: 'Retrait', question: 'Où récupérer le colis ?' },
  { cle: 'arrivee', titre: 'Livraison', question: 'Où faut-il le livrer ?' },
  { cle: 'colis', titre: 'Colis', question: 'De quoi s’agit-il ?' },
  { cle: 'recap', titre: 'Envoi', question: 'Tout est bon ?' },
];

const BROUILLON_VIDE: BrouillonCommande = {
  destinataire_nom: '',
  destinataire_telephone: '',
  adresse_depart: '',
  repere_depart: '',
  latitude_depart: null,
  longitude_depart: null,
  adresse_arrivee: '',
  repere_arrivee: '',
  latitude_arrivee: null,
  longitude_arrivee: null,
  description_colis: '',
  instructions: '',
};

function lireBrouillon(): BrouillonCommande {
  try {
    const brut = localStorage.getItem(CLE_BROUILLON);
    if (!brut) return BROUILLON_VIDE;
    // Fusion avec le modèle vide : un brouillon écrit par une version
    // antérieure peut manquer des champs ajoutés depuis.
    return { ...BROUILLON_VIDE, ...(JSON.parse(brut) as Partial<BrouillonCommande>) };
  } catch {
    return BROUILLON_VIDE;
  }
}

export function EcranCommander({
  adresseParDefaut,
  onEnvoyee,
}: {
  adresseParDefaut: string;
  onEnvoyee: (commande: Commande) => void;
}) {
  const [etape, setEtape] = useState<Etape>('depart');
  const [brouillon, setBrouillon] = useState<BrouillonCommande>(() => {
    const b = lireBrouillon();
    // Le point de retrait est presque toujours la boutique elle-même : le
    // pré-remplir évite de retaper la même adresse à chaque commande.
    if (!b.adresse_depart && adresseParDefaut) b.adresse_depart = adresseParDefaut;
    return b;
  });

  const [carnet, setCarnet] = useState<Destinataire[]>([]);
  const [carnetOuvert, setCarnetOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le brouillon survit à une coupure : sur un réseau instable, perdre une
  // saisie de dix champs parce que la page s'est rechargée est inacceptable.
  useEffect(() => {
    try {
      localStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
    } catch {
      // stockage plein : la saisie continue, elle ne sera juste pas reprise
    }
  }, [brouillon]);

  useEffect(() => {
    api.carnet().then(setCarnet).catch(() => setCarnet([]));
  }, []);

  const maj = <K extends keyof BrouillonCommande>(cle: K, valeur: BrouillonCommande[K]) =>
    setBrouillon((b) => ({ ...b, [cle]: valeur }));

  const indexEtape = ETAPES.findIndex((e) => e.cle === etape);

  const etapeComplete = useMemo(() => {
    switch (etape) {
      case 'depart':
        return brouillon.adresse_depart.trim().length > 0;
      case 'arrivee':
        return (
          brouillon.adresse_arrivee.trim().length > 0 &&
          brouillon.destinataire_nom.trim().length > 0 &&
          brouillon.destinataire_telephone.trim().length >= 8
        );
      case 'colis':
        return true; // la description aide le livreur mais ne conditionne rien
      default:
        return true;
    }
  }, [etape, brouillon]);

  function reprendre(d: Destinataire) {
    setBrouillon((b) => ({
      ...b,
      destinataire_nom: d.nom,
      // Le numéro n'est pas relisible — il n'existe qu'en empreinte côté
      // serveur. Il faut le ressaisir, et l'écran le dit plutôt que de laisser
      // croire à un champ pré-rempli.
      destinataire_telephone: '',
      adresse_arrivee: d.adresse_arrivee,
      repere_arrivee: d.repere_arrivee ?? '',
      latitude_arrivee: d.latitude ?? null,
      longitude_arrivee: d.longitude ?? null,
      description_colis: b.description_colis || (d.description_habituelle ?? ''),
    }));
    setCarnetOuvert(false);
    setEtape('arrivee');
  }

  async function envoyer() {
    setErreur(null);
    setEnvoi(true);
    try {
      const commande = await api.creerCommande(brouillon);
      localStorage.removeItem(CLE_BROUILLON);
      onEnvoyee(commande);
    } catch (err) {
      setErreur(
        err instanceof ApiError
          ? err.message
          : 'Envoi impossible — vérifiez votre connexion, le brouillon est conservé.'
      );
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="app">
      <div className="heros">
        <p className="surtitre">Nouvelle livraison</p>
        <h1>{ETAPES[indexEtape].question}</h1>

        {/* Progression : le trait plein et le libellé disent où l'on en est,
            sans reposer sur la seule couleur. */}
        <ol className="fil-etapes" aria-label="Progression de la commande">
          {ETAPES.map((e, i) => (
            <li
              key={e.cle}
              className={i < indexEtape ? 'faite' : i === indexEtape ? 'courante' : ''}
              aria-current={i === indexEtape ? 'step' : undefined}
            >
              <span className="fil-pastille">
                {i < indexEtape ? <IconeCheck className="icone-mini" /> : i + 1}
              </span>
              <span className="fil-libelle">{e.titre}</span>
            </li>
          ))}
        </ol>
      </div>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte />
          <span>{erreur}</span>
        </div>
      )}

      {etape === 'depart' && (
        <section className="carte apparition">
          <label>
            Adresse de retrait
            <input
              value={brouillon.adresse_depart}
              onChange={(e) => maj('adresse_depart', e.target.value)}
              placeholder="Boutique, avenue Kwame Nkrumah"
              autoFocus
            />
          </label>
          <label>
            Repère
            <input
              value={brouillon.repere_depart}
              onChange={(e) => maj('repere_depart', e.target.value)}
              placeholder="Face à la pharmacie du Centre"
            />
          </label>
          <p className="aide">
            Le repère compte plus que l’adresse : c’est lui que le livreur
            cherchera sur place.
          </p>

          <ChoixPoint
            latitude={brouillon.latitude_depart}
            longitude={brouillon.longitude_depart}
            onChange={(lat, lon) => {
              maj('latitude_depart', lat);
              maj('longitude_depart', lon);
            }}
          />
        </section>
      )}

      {etape === 'arrivee' && (
        <section className="carte apparition">
          {carnet.length > 0 && (
            <>
              <button
                type="button"
                className="contour bloc"
                onClick={() => setCarnetOuvert((v) => !v)}
                aria-expanded={carnetOuvert}
              >
                <IconeCarnet />
                {carnetOuvert ? 'Masquer le carnet' : `Reprendre un destinataire (${carnet.length})`}
              </button>

              {carnetOuvert && (
                <ul className="carnet">
                  {carnet.map((d) => (
                    <li key={d.derniere_course_id}>
                      <button type="button" onClick={() => reprendre(d)}>
                        <span className="carnet-nom">{d.nom}</span>
                        <span className="carnet-adresse">{d.adresse_arrivee}</span>
                        <span className="carnet-compte mono-petit">
                          {d.nombre_envois} envoi{d.nombre_envois > 1 ? 's' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <label>
            Nom du destinataire
            <input
              value={brouillon.destinataire_nom}
              onChange={(e) => maj('destinataire_nom', e.target.value)}
              placeholder="Awa Ouédraogo"
            />
          </label>
          <label>
            Téléphone du destinataire
            <input
              type="tel"
              value={brouillon.destinataire_telephone}
              onChange={(e) => maj('destinataire_telephone', e.target.value)}
              placeholder="+22670000000"
            />
          </label>
          <p className="aide">
            Le numéro sert au suivi et à la messagerie. Il n’est jamais
            communiqué au livreur, ni le sien au destinataire.
          </p>

          <label>
            Adresse de livraison
            <input
              value={brouillon.adresse_arrivee}
              onChange={(e) => maj('adresse_arrivee', e.target.value)}
              placeholder="Zone du Bois, rue 15.42"
            />
          </label>
          <label>
            Repère
            <input
              value={brouillon.repere_arrivee}
              onChange={(e) => maj('repere_arrivee', e.target.value)}
              placeholder="Portail vert après le château d’eau"
            />
          </label>

          <ChoixPoint
            latitude={brouillon.latitude_arrivee}
            longitude={brouillon.longitude_arrivee}
            couleur="rust"
            onChange={(lat, lon) => {
              maj('latitude_arrivee', lat);
              maj('longitude_arrivee', lon);
            }}
          />
        </section>
      )}

      {etape === 'colis' && (
        <section className="carte apparition">
          <label>
            Contenu du colis
            <input
              value={brouillon.description_colis}
              onChange={(e) => maj('description_colis', e.target.value)}
              placeholder="Deux cartons de tissu"
              autoFocus
            />
          </label>
          <p className="aide">
            Le livreur doit savoir ce qu’il prend avant de partir : un colis
            encombrant ne se transporte pas à moto.
          </p>

          <label>
            Consigne au livreur
            <textarea
              value={brouillon.instructions}
              onChange={(e) => maj('instructions', e.target.value)}
              placeholder="Appeler en arrivant au portail, 2e étage"
              rows={3}
            />
          </label>
        </section>
      )}

      {etape === 'recap' && (
        <section className="carte apparition">
          <div className="recap-trajet">
            <div className="recap-point">
              <span className="recap-pastille depart">
                <IconeEpingle className="icone-mini" />
              </span>
              <div>
                <p className="surtitre">Retrait</p>
                <p className="recap-adresse">{brouillon.adresse_depart}</p>
                {brouillon.repere_depart && (
                  <p className="attenue">{brouillon.repere_depart}</p>
                )}
              </div>
            </div>

            <div className="recap-liaison" aria-hidden="true" />

            <div className="recap-point">
              <span className="recap-pastille arrivee">
                <IconeEpingle className="icone-mini" />
              </span>
              <div>
                <p className="surtitre">Livraison</p>
                <p className="recap-adresse">{brouillon.adresse_arrivee}</p>
                {brouillon.repere_arrivee && (
                  <p className="attenue">{brouillon.repere_arrivee}</p>
                )}
                <p className="recap-destinataire">
                  {brouillon.destinataire_nom} · {brouillon.destinataire_telephone}
                </p>
              </div>
            </div>
          </div>

          {brouillon.description_colis && (
            <div className="recap-ligne">
              <IconeColis />
              <span>{brouillon.description_colis}</span>
            </div>
          )}
          {brouillon.instructions && (
            <div className="recap-ligne">
              <IconeAlerte />
              <span>{brouillon.instructions}</span>
            </div>
          )}

          {/* Pas de prix affiché : le barème en base porte l'abonnement et la
              commission de la compagnie, pas un tarif par course. En inventer
              un donnerait un chiffre faux au partenaire. */}
          <p className="aide">
            Le tarif est celui convenu avec votre compagnie de livraison. Il
            n’est pas calculé ici.
          </p>
        </section>
      )}

      <div className="barre-actions">
        {indexEtape > 0 && (
          <button
            type="button"
            className="contour"
            onClick={() => setEtape(ETAPES[indexEtape - 1].cle)}
          >
            <IconeRetour />
            Retour
          </button>
        )}

        {etape === 'recap' ? (
          <button type="button" onClick={envoyer} disabled={envoi} className="principal">
            {envoi ? 'Envoi…' : 'Envoyer la commande'}
          </button>
        ) : (
          <button
            type="button"
            className="principal"
            disabled={!etapeComplete}
            onClick={() => setEtape(ETAPES[indexEtape + 1].cle)}
          >
            Continuer
            <IconeFleche />
          </button>
        )}
      </div>

      {!etapeComplete && etape !== 'recap' && (
        <p className="aide centre">
          {etape === 'depart'
            ? 'Indiquez au moins l’adresse de retrait.'
            : 'Le nom, le téléphone et l’adresse du destinataire sont nécessaires.'}
        </p>
      )}
    </div>
  );
}
