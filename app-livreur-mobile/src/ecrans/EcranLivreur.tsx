import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { api, ApiError, type Course, type Livreur, type StatutCourse } from '../api';
import { arreterSuivi, demarrerSuivi, suiviActif, tailleFile, viderFile } from '../tracking';
import { couleurs, couleurStatut, styles } from '../theme';
import { ChatMasque } from './ChatMasque';

/** Rafraîchissement lent : interroger l'API plus souvent coûterait de la donnée. */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20000;

const LIBELLES_COURSE: Record<StatutCourse, string> = {
  en_attente: 'En attente',
  assignee: 'À récupérer',
  recuperee: 'Colis récupéré',
  en_route: 'En livraison',
  livree: 'Livrée',
  annulee: 'Annulée',
};

const ETAPE_SUIVANTE: Partial<Record<StatutCourse, { statut: StatutCourse; libelle: string }>> = {
  assignee: { statut: 'recuperee', libelle: "J'ai récupéré le colis" },
  recuperee: { statut: 'en_route', libelle: 'Je pars en livraison' },
  en_route: { statut: 'livree', libelle: 'Colis livré' },
};

export function EcranLivreur({ onDeconnexion }: { onDeconnexion: () => void }) {
  const [livreur, setLivreur] = useState<Livreur | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avertissement, setAvertissement] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);
  const [suiviDemarre, setSuiviDemarre] = useState(false);
  const [enAttente, setEnAttente] = useState(0);
  const [courseEnDiscussion, setCourseEnDiscussion] = useState<string | null>(null);
  const [rafraichissement, setRafraichissement] = useState(false);

  const rafraichir = useCallback(async () => {
    try {
      const [profil, mesCourses] = await Promise.all([api.monProfil(), api.mesCourses()]);
      setLivreur(profil);
      setCourses(mesCourses ?? []);
      setErreur(null);
    } catch (err) {
      // Une coupure ne doit pas vider l'écran : on garde l'affichage précédent.
      setErreur(err instanceof ApiError ? err.message : 'Connexion au serveur impossible');
    }
  }, []);

  useEffect(() => {
    rafraichir();
    const timer = setInterval(rafraichir, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => clearInterval(timer);
  }, [rafraichir]);

  // Nombre de positions encore en attente d'envoi, pour que le livreur sache
  // que sa trace est conservée même sans réseau.
  useEffect(() => {
    const timer = setInterval(async () => {
      setEnAttente(await tailleFile());
      setSuiviDemarre(await suiviActif());
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Au retour au premier plan, on dépose sans attendre ce qui s'est accumulé.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') {
        viderFile(true);
        rafraichir();
      }
    });
    return () => sub.remove();
  }, [rafraichir]);

  const enService = livreur !== null && livreur.statut !== 'offline';

  // Le suivi suit le statut serveur : actif dès que le livreur est en service.
  useEffect(() => {
    (async () => {
      if (enService) {
        const r = await demarrerSuivi();
        if (!r.ok) {
          setAvertissement(
            r.raison === 'permission_arriere_plan_refusee'
              ? "Autorisez la localisation « Toujours » : sans elle, votre position cesse d'être transmise dès que l'écran s'éteint."
              : r.raison === 'permission_refusee'
                ? 'Autorisez la localisation pour pouvoir recevoir des courses.'
                : 'Le suivi de position n’a pas pu démarrer.',
          );
        } else {
          setAvertissement(null);
        }
      } else {
        await arreterSuivi();
      }
      setSuiviDemarre(await suiviActif());
    })();
  }, [enService]);

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

  async function quitter() {
    await arreterSuivi();
    onDeconnexion();
  }

  if (!livreur) {
    return (
      <View style={[styles.ecran, { padding: 16 }]}>
        <Text style={styles.attenue}>Chargement…</Text>
        {erreur && <Text style={styles.erreur}>{erreur}</Text>}
      </View>
    );
  }

  const libelleStatut =
    livreur.statut === 'offline'
      ? 'Hors service'
      : livreur.statut === 'dispo'
        ? 'Disponible'
        : 'En course';
  const teinte = couleurStatut(livreur.statut, livreur.statut !== 'offline');

  return (
    <ScrollView
      style={styles.ecran}
      contentContainerStyle={styles.contenu}
      refreshControl={
        <RefreshControl
          refreshing={rafraichissement}
          onRefresh={async () => {
            setRafraichissement(true);
            await rafraichir();
            setRafraichissement(false);
          }}
        />
      }
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <View>
          <Text style={styles.titre}>{livreur.nom}</Text>
          <View style={[styles.badge, { backgroundColor: teinte.fond, marginTop: 6 }]}>
            <Text style={[styles.badgeTexte, { color: teinte.texte }]}>{libelleStatut}</Text>
          </View>
        </View>
        <Pressable
          style={[styles.bouton, styles.boutonContour, { minHeight: 40, paddingHorizontal: 14 }]}
          onPress={quitter}
        >
          <Text style={[styles.boutonTexte, styles.boutonContourTexte]}>Quitter</Text>
        </Pressable>
      </View>

      <View style={styles.carte}>
        <Pressable
          style={[
            styles.bouton,
            livreur.statut !== 'offline' && styles.boutonDanger,
            (actionEnCours || livreur.statut === 'en_course') && styles.boutonInactif,
          ]}
          disabled={actionEnCours || livreur.statut === 'en_course'}
          onPress={basculerStatut}
        >
          <Text style={styles.boutonTexte}>
            {livreur.statut === 'offline' ? 'Prendre mon service' : 'Terminer mon service'}
          </Text>
        </Pressable>
        {livreur.statut === 'en_course' && (
          <Text style={[styles.attenue, { marginTop: 10 }]}>
            Terminez votre course en cours avant de quitter le service.
          </Text>
        )}
      </View>

      {enService && (
        <View style={styles.carte}>
          <Text style={styles.sousTitre}>Position GPS</Text>
          <View style={styles.ligne}>
            <Text style={styles.attenue}>Suivi</Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: suiviDemarre ? 'rgba(22,163,74,0.16)' : couleurs.bordure },
              ]}
            >
              <Text
                style={[
                  styles.badgeTexte,
                  { color: suiviDemarre ? couleurs.succes : couleurs.texteAttenue },
                ]}
              >
                {suiviDemarre ? 'Actif' : 'Inactif'}
              </Text>
            </View>
          </View>
          <View style={[styles.ligne, { borderBottomWidth: 0 }]}>
            <Text style={styles.attenue}>En attente d'envoi</Text>
            <Text style={{ fontWeight: '700', color: couleurs.texte }}>{enAttente}</Text>
          </View>
          {enAttente > 0 && (
            <Text style={[styles.attenue, { marginTop: 8 }]}>
              Vos positions sont gardées sur le téléphone et seront envoyées au retour du réseau.
            </Text>
          )}
          {suiviDemarre && (
            <Text style={[styles.attenue, { marginTop: 8 }]}>
              Le suivi continue même écran verrouillé.
            </Text>
          )}
          {avertissement && <Text style={styles.erreur}>{avertissement}</Text>}
        </View>
      )}

      {courseEnDiscussion && (
        <ChatMasque courseId={courseEnDiscussion} onFermer={() => setCourseEnDiscussion(null)} />
      )}

      <View style={styles.carte}>
        <Text style={styles.sousTitre}>Mes courses</Text>
        {courses.length === 0 ? (
          <Text style={styles.attenue}>
            {enService
              ? 'Aucune course pour le moment.'
              : 'Prenez votre service pour recevoir des courses.'}
          </Text>
        ) : (
          courses.map((course, index) => {
            const suivante = ETAPE_SUIVANTE[course.statut];
            const teinteCourse = couleurStatut(course.statut);
            return (
              <View
                key={course.id}
                style={{
                  paddingBottom: index === courses.length - 1 ? 0 : 14,
                  marginBottom: index === courses.length - 1 ? 0 : 14,
                  borderBottomWidth: index === courses.length - 1 ? 0 : 1,
                  borderBottomColor: couleurs.bordure,
                }}
              >
                <View style={[styles.badge, { backgroundColor: teinteCourse.fond }]}>
                  <Text style={[styles.badgeTexte, { color: teinteCourse.texte }]}>
                    {LIBELLES_COURSE[course.statut]}
                  </Text>
                </View>

                <View style={{ marginVertical: 10 }}>
                  <Text style={{ color: couleurs.texte, fontSize: 15 }}>
                    <Text style={{ color: couleurs.primary, fontWeight: '700' }}>A </Text>
                    {course.adresse_depart}
                  </Text>
                  <Text style={{ color: couleurs.texte, fontSize: 15, marginTop: 2 }}>
                    <Text style={{ color: couleurs.primary, fontWeight: '700' }}>B </Text>
                    {course.adresse_arrivee}
                  </Text>
                </View>

                {suivante && (
                  <Pressable
                    style={[styles.bouton, actionEnCours && styles.boutonInactif]}
                    disabled={actionEnCours}
                    onPress={() => avancerCourse(course, suivante.statut)}
                  >
                    <Text style={styles.boutonTexte}>{suivante.libelle}</Text>
                  </Pressable>
                )}

                <Pressable
                  style={[styles.bouton, styles.boutonContour, { marginTop: 8 }]}
                  onPress={() => setCourseEnDiscussion(course.id)}
                >
                  <Text style={[styles.boutonTexte, styles.boutonContourTexte]}>
                    Contacter le client
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      {erreur && <Text style={styles.erreur}>{erreur}</Text>}
    </ScrollView>
  );
}
