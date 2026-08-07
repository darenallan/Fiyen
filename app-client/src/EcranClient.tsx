import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Course, type StatutCourse } from './api';
import { CarteSuivi } from './CarteSuivi';
import { ChatMasque } from './ChatMasque';
import { Marque } from './Marque';
import { NavBas, type Onglet } from './composants/NavBas';
import { SqueletteCourse, SqueletteEtapes } from './composants/Squelette';
import { IconeAlerte, IconeColis, IconeMoto, IconeVerrou } from './composants/Icones';

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

/** Ce que le client doit comprendre en une phrase, sans avoir à déduire. */
const EXPLICATIONS: Record<StatutCourse, string> = {
  en_attente: 'Votre compagnie cherche un livreur disponible.',
  assignee: 'Il part récupérer votre colis.',
  recuperee: 'Le colis est entre ses mains.',
  en_route: 'Suivez sa position en direct ci-dessous.',
  livree: 'Livraison terminée. Merci !',
  annulee: 'Cette commande a été annulée.',
};

function libelleBadge(statut: StatutCourse): { texte: string; classe: string } {
  if (statut === 'livree') return { texte: 'Livrée', classe: 'succes' };
  if (statut === 'annulee') return { texte: 'Annulée', classe: 'erreur' };
  if (statut === 'en_attente') return { texte: 'En attente', classe: '' };
  return { texte: 'En cours', classe: 'actif' };
}

function Etapes({ statut }: { statut: StatutCourse }) {
  if (statut === 'annulee') return null;
  const indexCourant = ETAPES.findIndex((e) => e.statut === statut);

  return (
    <div className="etapes">
      {ETAPES.map((etape, i) => {
        const faite = i < indexCourant;
        const courante = i === indexCourant;
        return (
          <div
            key={etape.statut}
            className={`etape-ligne ${faite ? 'faite' : ''} ${courante ? 'courante' : ''}`}
          >
            <div className="etape-piste">
              <span className="etape-point" />
              {i < ETAPES.length - 1 && <span className="etape-barre" />}
            </div>
            <div className="etape-libelle">
              {etape.libelle}
              {courante && <span className="sr-only"> — étape en cours</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Trajet({ course }: { course: Course }) {
  return (
    <div className="trajet">
      <div className="trajet-point">
        <span className="trajet-marque" aria-hidden="true">A</span>
        <span className="trajet-adresse">
          <span className="muet" style={{ display: 'block' }}>Départ</span>
          {course.adresse_depart}
        </span>
      </div>
      <div className="trajet-point">
        <span className="trajet-marque" aria-hidden="true">B</span>
        <span className="trajet-adresse">
          <span className="muet" style={{ display: 'block' }}>Livraison</span>
          {course.adresse_arrivee}
        </span>
      </div>
    </div>
  );
}

export function EcranClient({ onDeconnexion }: { onDeconnexion: () => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<Onglet>('suivi');

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

  return (
    <>
      <div className="app">
        <div className="entete">
          <Marque />
          {onglet !== 'profil' && (
            <span className="muet">
              {courses.length > 0 ? `${courses.length} commande${courses.length > 1 ? 's' : ''}` : ''}
            </span>
          )}
        </div>

        {erreur && (
          <div className="bandeau-erreur" role="status">
            <IconeAlerte className="icone-inline" />
            <span>{erreur}</span>
          </div>
        )}

        {onglet === 'suivi' && (
          <>
            {chargement ? (
              <>
                <SqueletteCourse />
                <SqueletteEtapes />
              </>
            ) : !courseActive ? (
              <div className="carte etat-vide apparition">
                <div className="illus">
                  <IconeColis />
                </div>
                <h1>Aucune livraison</h1>
                <p className="attenue" style={{ marginTop: 10 }}>
                  Votre compagnie de livraison créera la course pour vous. Vous pourrez la
                  suivre ici en direct et écrire à votre livreur.
                </p>
              </div>
            ) : (
              <>
                <div className="carte carte-vedette apparition">
                  {(() => {
                    const b = libelleBadge(courseActive.statut);
                    return (
                      <span className={`badge ${b.classe}`}>
                        <span className={`pastille ${suiviPossible ? 'vivante' : ''}`} />
                        {b.texte}
                      </span>
                    );
                  })()}

                  <h1 style={{ marginTop: 14 }}>{TITRES[courseActive.statut]}</h1>
                  <p className="attenue" style={{ marginTop: 6 }}>
                    {EXPLICATIONS[courseActive.statut]}
                  </p>

                  <Trajet course={courseActive} />
                </div>

                <div className="carte apparition" style={{ animationDelay: '60ms' }}>
                  <h2 style={{ marginBottom: 18 }}>Progression</h2>
                  <Etapes statut={courseActive.statut} />
                </div>

                {suiviPossible && <CarteSuivi courseId={courseActive.id} />}

                <ChatMasque courseId={courseActive.id} />
              </>
            )}
          </>
        )}

        {onglet === 'commandes' && (
          <div className="apparition">
            <h1 style={{ marginBottom: 18 }}>Mes commandes</h1>
            {chargement ? (
              <SqueletteCourse />
            ) : courses.length === 0 ? (
              <div className="carte etat-vide">
                <div className="illus">
                  <IconeMoto />
                </div>
                <h3>Aucune commande</h3>
                <p className="attenue" style={{ marginTop: 8 }}>
                  Vos livraisons apparaîtront ici.
                </p>
              </div>
            ) : (
              courses.map((c) => {
                const b = libelleBadge(c.statut);
                return (
                  <div key={c.id} className="carte">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <span className={`badge ${b.classe}`}>{TITRES[c.statut]}</span>
                      <span className="muet">
                        {new Date(c.created_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </div>
                    <Trajet course={c} />
                  </div>
                );
              })
            )}
          </div>
        )}

        {onglet === 'profil' && (
          <div className="apparition">
            <h1 style={{ marginBottom: 18 }}>Mon profil</h1>

            <div className="carte">
              <h2 style={{ marginBottom: 14 }}>Confidentialité</h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="jeton-info" aria-hidden="true">
                  <IconeVerrou />
                </span>
                <p className="attenue" style={{ margin: 0 }}>
                  Votre numéro de téléphone n'est jamais communiqué à votre livreur, et le
                  sien ne vous est jamais communiqué. Vous échangez uniquement via la
                  messagerie de l'application, qui se ferme à la fin de la course.
                </p>
              </div>
            </div>

            <div className="carte">
              <h2 style={{ marginBottom: 14 }}>Session</h2>
              <button className="contour" onClick={onDeconnexion}>
                Se déconnecter
              </button>
            </div>
          </div>
        )}
      </div>

      <NavBas actif={onglet} onChange={setOnglet} livraisonEnCours={suiviPossible} />
    </>
  );
}
