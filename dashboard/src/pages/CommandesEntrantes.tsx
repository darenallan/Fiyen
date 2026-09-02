import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useCommandesEntrantes } from '../api/CommandesEntrantesContext';
import type { CommandeEntrante, Livreur } from '../api/types';
import './CommandesEntrantes.css';

/**
 * File des commandes passées par les entreprises clientes.
 *
 * C'est la contrepartie de la commande en autonomie : sans cet écran, une
 * commande déposée par un partenaire attendrait qu'un opérateur pense à
 * rafraîchir la liste générale des courses.
 *
 * Les plus anciennes sont en tête — premier arrivé, premier servi. C'est le
 * serveur qui trie ; l'écran ne réordonne pas, sous peine de faire attendre
 * une commande parce qu'elle est passée sous la ligne de flottaison.
 */

function attenteDepuis(iso: string): { texte: string; urgent: boolean } {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return { texte: 'à l’instant', urgent: false };
  if (minutes < 60) return { texte: `${minutes} min`, urgent: minutes >= 15 };
  const heures = Math.floor(minutes / 60);
  return { texte: `${heures} h`, urgent: true };
}

export function CommandesEntrantes() {
  const { commandes, chargement, erreur, rafraichir } = useCommandesEntrantes();
  const [livreursDispo, setLivreursDispo] = useState<Livreur[]>([]);
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);

  useEffect(() => {
    const charger = async () => {
      try {
        const livreurs = await api.get<Livreur[]>('/api/livreurs/');
        setLivreursDispo(livreurs.filter((l) => l.statut === 'dispo'));
      } catch {
        // La liste des livreurs n'est pas critique pour lire la file : on
        // laisse l'écran s'afficher, l'assignation redemandera.
      }
    };
    void charger();
    const timer = window.setInterval(charger, 20000);
    return () => clearInterval(timer);
  }, []);

  async function assigner(commande: CommandeEntrante) {
    const livreurId = choix[commande.id];
    if (!livreurId) return;

    setErreurAction(null);
    setEnCours(commande.id);
    try {
      await api.patch(`/api/courses/${commande.id}/assigner`, { livreur_id: livreurId });
      await rafraichir();
    } catch (err) {
      setErreurAction(
        err instanceof ApiError ? err.message : 'Assignation impossible'
      );
    } finally {
      setEnCours(null);
    }
  }

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
        <h1 style={{ margin: 0 }}>Commandes entrantes</h1>
        <span className="muted-inline">
          {commandes.length === 0
            ? 'File vide'
            : `${commandes.length} en attente d’assignation`}
        </span>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {erreurAction && <p className="erreur">{erreurAction}</p>}

      {chargement ? (
        <div className="carte">
          <p>Chargement…</p>
        </div>
      ) : commandes.length === 0 ? (
        <div className="carte">
          <p className="muted-inline">
            Aucune commande en attente. Celles que vos entreprises clientes
            passent depuis leur espace apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="file-entrantes">
          {commandes.map((c) => {
            const attente = attenteDepuis(c.created_at);
            return (
              <article key={c.id} className="carte commande-entrante">
                <header className="entrante-tete">
                  <div>
                    <span className="numero-course">{c.numero}</span>
                    <span className="entrante-partenaire">{c.partenaire_nom}</span>
                  </div>
                  {/* L'attente porte un mot en plus de la couleur : « 25 min »
                      se lit même sans percevoir la teinte. */}
                  <span className={`badge ${attente.urgent ? 'attente-longue' : ''}`}>
                    <span className="pastille" />
                    {attente.urgent ? `En attente ${attente.texte}` : attente.texte}
                  </span>
                </header>

                <div className="entrante-trajet">
                  <div className="entrante-point">
                    <span className="entrante-puce depart" aria-hidden="true" />
                    <div>
                      <p className="entrante-adresse">{c.adresse_depart}</p>
                      {c.repere_depart && (
                        <p className="muted-inline">{c.repere_depart}</p>
                      )}
                    </div>
                  </div>
                  <div className="entrante-liaison" aria-hidden="true" />
                  <div className="entrante-point">
                    <span className="entrante-puce arrivee" aria-hidden="true" />
                    <div>
                      <p className="entrante-adresse">{c.adresse_arrivee}</p>
                      {c.repere_arrivee && (
                        <p className="muted-inline">{c.repere_arrivee}</p>
                      )}
                      <p className="muted-inline">Pour {c.destinataire_nom}</p>
                    </div>
                  </div>
                </div>

                {(c.description_colis || c.instructions) && (
                  <dl className="entrante-detail">
                    {c.description_colis && (
                      <>
                        <dt>Colis</dt>
                        <dd>{c.description_colis}</dd>
                      </>
                    )}
                    {c.instructions && (
                      <>
                        <dt>Consigne</dt>
                        <dd>{c.instructions}</dd>
                      </>
                    )}
                  </dl>
                )}

                <footer className="entrante-pied">
                  {c.cree_par_nom && (
                    <span className="muted-inline">Commandée par {c.cree_par_nom}</span>
                  )}
                  <div className="entrante-actions">
                    <select
                      value={choix[c.id] ?? ''}
                      onChange={(e) => setChoix((p) => ({ ...p, [c.id]: e.target.value }))}
                      aria-label={`Livreur pour la commande ${c.numero}`}
                    >
                      <option value="">Choisir un livreur…</option>
                      {livreursDispo.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nom}
                          {l.en_ligne ? '' : ' (hors ligne)'}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => assigner(c)}
                      disabled={!choix[c.id] || enCours === c.id}
                    >
                      {enCours === c.id ? 'Assignation…' : 'Assigner'}
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {livreursDispo.length === 0 && commandes.length > 0 && (
        <p className="muted-inline" style={{ marginTop: 12 }}>
          Aucun livreur disponible pour l’instant : les commandes restent en
          file jusqu’à ce qu’un livreur repasse en service.
        </p>
      )}
    </div>
  );
}
