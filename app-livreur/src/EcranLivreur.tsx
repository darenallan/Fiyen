import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Course, type Livreur, type StatutCourse } from './api';
import { TrackingLivreur, type EtatTracking } from './tracking';
import { ChatMasque } from './ChatMasque';
import { Marque } from './Marque';

/**
 * Rafraîchissement des courses. Volontairement lent : sur un forfait data
 * burkinabè, interroger l'API trop souvent coûte au livreur. Les changements
 * qu'il déclenche lui-même mettent la liste à jour immédiatement.
 */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20000;

const LIBELLES_STATUT_COURSE: Record<StatutCourse, string> = {
  en_attente: 'En attente',
  assignee: 'À récupérer',
  recuperee: 'Colis récupéré',
  en_route: 'En livraison',
  livree: 'Livrée',
  annulee: 'Annulée',
};

/** Prochaine étape proposée au livreur pour une course donnée. */
const ETAPE_SUIVANTE: Partial<Record<StatutCourse, { statut: StatutCourse; libelle: string }>> = {
  assignee: { statut: 'recuperee', libelle: "J'ai récupéré le colis" },
  recuperee: { statut: 'en_route', libelle: 'Je pars en livraison' },
  en_route: { statut: 'livree', libelle: 'Colis livré' },
};

const ETAT_TRACKING_INITIAL: EtatTracking = {
  actif: false,
  connecte: false,
  positionsEnAttente: 0,
  dernierePosition: null,
  erreur: null,
};

export function EcranLivreur({ onDeconnexion }: { onDeconnexion: () => void }) {
  const [livreur, setLivreur] = useState<Livreur | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);
  const [etatTracking, setEtatTracking] = useState<EtatTracking>(ETAT_TRACKING_INITIAL);
  const [courseEnDiscussion, setCourseEnDiscussion] = useState<string | null>(null);

  const trackingRef = useRef<TrackingLivreur | null>(null);
  if (trackingRef.current === null) {
    trackingRef.current = new TrackingLivreur(setEtatTracking);
  }

  const rafraichir = useCallback(async () => {
    try {
      const [profil, mesCourses] = await Promise.all([api.monProfil(), api.mesCourses()]);
      setLivreur(profil);
      setCourses(mesCourses ?? []);
      setErreur(null);
    } catch (err) {
      // Une coupure réseau ne doit pas vider l'écran : on garde l'affichage
      // précédent et on signale seulement que les données peuvent dater.
      setErreur(err instanceof ApiError ? err.message : 'Connexion au serveur impossible');
    }
  }, []);

  useEffect(() => {
    rafraichir();
    const timer = window.setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(timer);
  }, [rafraichir]);

  // Le tracking suit le statut serveur : actif dès que le livreur n'est plus hors ligne.
  const enService = livreur !== null && livreur.statut !== 'offline';
  useEffect(() => {
    const tracking = trackingRef.current!;
    if (enService) tracking.demarrer();
    else tracking.arreter();
  }, [enService]);

  // Filet de sécurité : coupe le GPS et la socket si l'app est fermée/rechargée.
  useEffect(() => {
    const tracking = trackingRef.current!;
    return () => tracking.arreter();
  }, []);

  async function basculerStatut() {
    if (!livreur) return;
    setActionEnCours(true);
    try {
      const cible = livreur.statut === 'offline' ? 'dispo' : 'offline';
      const { statut } = await api.changerStatut(cible);
      setLivreur({ ...livreur, statut });
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Changement de statut impossible');
    } finally {
      setActionEnCours(false);
    }
  }

  async function avancerCourse(course: Course, statut: StatutCourse) {
    setActionEnCours(true);
    try {
      await api.changerStatutCourse(course.id, statut);
      await rafraichir();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Mise à jour impossible');
    } finally {
      setActionEnCours(false);
    }
  }

  function deconnecter() {
    trackingRef.current?.arreter();
    onDeconnexion();
  }

  if (!livreur) {
    return (
      <div className="app">
        <p className="attenue" style={{ marginTop: 48 }}>Chargement…</p>
        {erreur && <p className="erreur">{erreur}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <div className="entete">
        <Marque />
        <button className="contour discret" onClick={deconnecter}>
          Quitter
        </button>
      </div>

      <div className="carte carte-vedette apparition">
        <span className={`badge ${livreur.statut}`}>
          <span className={`pastille ${livreur.statut === 'en_course' ? 'vivante' : ''}`} />
          {livreur.statut === 'offline'
            ? 'Hors service'
            : livreur.statut === 'dispo'
              ? 'Disponible'
              : 'En course'}
        </span>
        <h1 style={{ marginTop: 12 }}>{livreur.nom}</h1>
      </div>

      <div className="carte">
        <button
          onClick={basculerStatut}
          disabled={actionEnCours || livreur.statut === 'en_course'}
          className={livreur.statut === 'offline' ? '' : 'danger'}
        >
          {livreur.statut === 'offline' ? 'Prendre mon service' : 'Terminer mon service'}
        </button>
        {livreur.statut === 'en_course' && (
          <p className="attenue" style={{ marginTop: 12 }}>
            Terminez votre course en cours avant de quitter le service.
          </p>
        )}
      </div>

      {enService && (
        <div className="carte">
          <h2>Position GPS</h2>
          <div className="ligne-etat">
            <span className="attenue">Envoi au serveur</span>
            <span className={`badge ${etatTracking.connecte ? 'dispo' : 'offline'}`}>
              <span className="pastille" />
              {etatTracking.connecte ? 'Connecté' : 'Hors ligne'}
            </span>
          </div>
          <div className="ligne-etat">
            <span className="attenue">En attente d'envoi</span>
            <strong>{etatTracking.positionsEnAttente}</strong>
          </div>
          <div className="ligne-etat">
            <span className="attenue">Dernière position</span>
            <strong>
              {etatTracking.dernierePosition
                ? `${etatTracking.dernierePosition.latitude.toFixed(4)}, ${etatTracking.dernierePosition.longitude.toFixed(4)}`
                : '—'}
            </strong>
          </div>
          {!etatTracking.connecte && etatTracking.positionsEnAttente > 0 && (
            <p className="attenue" style={{ marginTop: 12 }}>
              Vos positions sont gardées sur le téléphone et seront envoyées au retour du réseau.
            </p>
          )}
          {etatTracking.erreur && <p className="erreur">{etatTracking.erreur}</p>}
        </div>
      )}

      {courseEnDiscussion && (
        <ChatMasque courseId={courseEnDiscussion} onFermer={() => setCourseEnDiscussion(null)} />
      )}

      <div className="carte">
        <h2>Mes courses</h2>
        {courses.length === 0 ? (
          <p className="attenue" style={{ margin: 0 }}>
            {enService
              ? 'Aucune course pour le moment. Gardez l’application ouverte, la liste se met à jour toute seule.'
              : 'Prenez votre service pour recevoir des courses.'}
          </p>
        ) : (
          courses.map((course) => {
            const suivante = ETAPE_SUIVANTE[course.statut];
            return (
              <div key={course.id} className="course">
                <span className={`badge ${course.statut}`}>{LIBELLES_STATUT_COURSE[course.statut]}</span>
                <div className="trajet">
                  <div className="etape">
                    <span className="puce">A</span>
                    <span>{course.adresse_depart}</span>
                  </div>
                  <div className="etape">
                    <span className="puce">B</span>
                    <span>{course.adresse_arrivee}</span>
                  </div>
                </div>
                {suivante && (
                  <button
                    onClick={() => avancerCourse(course, suivante.statut)}
                    disabled={actionEnCours}
                  >
                    {suivante.libelle}
                  </button>
                )}
                <button
                  className="contour"
                  onClick={() => setCourseEnDiscussion(course.id)}
                  style={{ marginTop: 8 }}
                >
                  Contacter le client
                </button>
              </div>
            );
          })
        )}
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
    </div>
  );
}
