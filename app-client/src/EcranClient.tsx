import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Course, type StatutCourse } from './api';
import { CarteSuivi } from './CarteSuivi';
import { ChatMasque } from './ChatMasque';
import { Marque } from './Marque';

/** Rafraîchissement lent : le statut évolue à l'échelle de la minute. */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20000;

const EN_LIVRAISON: StatutCourse[] = ['assignee', 'recuperee', 'en_route'];

/** Étapes visibles par le client, dans l'ordre du parcours réel du colis. */
const ETAPES: { statut: StatutCourse; libelle: string }[] = [
  { statut: 'en_attente', libelle: 'Commande reçue' },
  { statut: 'assignee', libelle: 'Livreur assigné' },
  { statut: 'recuperee', libelle: 'Colis récupéré' },
  { statut: 'en_route', libelle: 'En route vers vous' },
  { statut: 'livree', libelle: 'Livré' },
];

const TITRES: Record<StatutCourse, string> = {
  en_attente: 'Commande enregistrée',
  assignee: 'Un livreur arrive',
  recuperee: 'Votre colis est pris en charge',
  en_route: 'Votre colis arrive',
  livree: 'Colis livré',
  annulee: 'Commande annulée',
};

function Etapes({ statut }: { statut: StatutCourse }) {
  // Une course annulée n'a pas de progression à montrer.
  if (statut === 'annulee') return null;

  const indexCourant = ETAPES.findIndex((e) => e.statut === statut);

  return (
    <div className="etapes">
      {ETAPES.map((etape, i) => {
        const faite = i < indexCourant;
        const courante = i === indexCourant;
        const dernier = i === ETAPES.length - 1;
        return (
          <div
            key={etape.statut}
            className={`etape-ligne ${faite ? 'faite' : ''} ${courante ? 'courante' : ''}`}
          >
            <div className="etape-piste">
              <span className="etape-point" />
              {!dernier && <span className="etape-barre" />}
            </div>
            <div className="etape-libelle">{etape.libelle}</div>
          </div>
        );
      })}
    </div>
  );
}

export function EcranClient({ onDeconnexion }: { onDeconnexion: () => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = useCallback(async () => {
    try {
      const data = await api.mesCourses();
      setCourses(data ?? []);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Connexion au serveur impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    rafraichir();
    const timer = window.setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(timer);
  }, [rafraichir]);

  // La course en cours de livraison prime sur la plus récente : un client qui
  // vient de commander ne doit pas perdre de vue la livraison déjà en route.
  const courseActive = courses.find((c) => EN_LIVRAISON.includes(c.statut)) ?? courses[0] ?? null;
  const suiviPossible = courseActive !== null && EN_LIVRAISON.includes(courseActive.statut);
  const autresCourses = courses.filter((c) => c.id !== courseActive?.id);

  return (
    <div className="app">
      <div className="entete">
        <Marque />
        <button className="contour discret" onClick={onDeconnexion}>
          Quitter
        </button>
      </div>

      {chargement ? (
        <p className="attenue">Chargement…</p>
      ) : !courseActive ? (
        <div className="carte carte-vedette apparition">
          <h1>Aucune livraison en cours</h1>
          <p className="attenue" style={{ marginTop: 10 }}>
            Votre compagnie de livraison créera la course pour vous. Vous pourrez la suivre
            ici en direct et écrire à votre livreur.
          </p>
        </div>
      ) : (
        <>
          <div className="carte carte-vedette apparition">
            <span className={`badge ${courseActive.statut === 'livree' ? 'succes' : ''}`}>
              <span className={`pastille ${suiviPossible ? 'vivante' : ''}`} />
              {courseActive.statut === 'annulee' ? 'Annulée' : 'En cours'}
            </span>

            <h1 style={{ marginTop: 14 }}>{TITRES[courseActive.statut]}</h1>

            <div className="trajet">
              <div className="trajet-point">
                <span className="trajet-marque">A</span>
                <span className="trajet-adresse">{courseActive.adresse_depart}</span>
              </div>
              <div className="trajet-point">
                <span className="trajet-marque">B</span>
                <span className="trajet-adresse">{courseActive.adresse_arrivee}</span>
              </div>
            </div>
          </div>

          <div className="carte apparition" style={{ animationDelay: '60ms' }}>
            <h2 style={{ marginBottom: 18 }}>Progression</h2>
            <Etapes statut={courseActive.statut} />
          </div>

          {suiviPossible && <CarteSuivi courseId={courseActive.id} />}

          <ChatMasque courseId={courseActive.id} />

          {autresCourses.length > 0 && (
            <div className="carte">
              <h2 style={{ marginBottom: 14 }}>Vos autres commandes</h2>
              {autresCourses.map((c) => (
                <div key={c.id} style={{ marginBottom: 14 }}>
                  <span className="badge neutre">{TITRES[c.statut]}</span>
                  <p className="attenue" style={{ marginTop: 8 }}>
                    {c.adresse_depart} → {c.adresse_arrivee}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {erreur && <p className="erreur">{erreur}</p>}
    </div>
  );
}
