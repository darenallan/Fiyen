import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './client';
import type { CommandeEntrante } from './types';

/** 20 s, comme les autres listes : ces commandes arrivent à l'échelle de la
 *  minute, et le dashboard tourne parfois sur une connexion facturée. */
const INTERVALLE_MS = 20000;

/**
 * File des commandes déposées par les partenaires et pas encore assignées.
 *
 * Un **contexte** et non un simple hook : la barre latérale n'affiche que le
 * compteur, l'écran dédié affiche la liste, et les deux doivent lire le même
 * état. Deux appels d'un hook créeraient deux états indépendants — le compteur
 * resterait à « 1 » pendant vingt secondes après une assignation faite sous
 * ses yeux, et le trafic serait doublé pour rien.
 */
interface Etat {
  commandes: CommandeEntrante[];
  chargement: boolean;
  erreur: string | null;
  rafraichir: () => Promise<void>;
}

const CommandesEntrantesContext = createContext<Etat | null>(null);

export function CommandesEntrantesProvider({ children }: { children: ReactNode }) {
  const [commandes, setCommandes] = useState<CommandeEntrante[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = useCallback(async () => {
    try {
      setCommandes(await api.get<CommandeEntrante[]>('/api/dashboard/commandes-entrantes'));
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Lecture impossible');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void rafraichir();
    const timer = window.setInterval(rafraichir, INTERVALLE_MS);
    return () => clearInterval(timer);
  }, [rafraichir]);

  return (
    <CommandesEntrantesContext.Provider value={{ commandes, chargement, erreur, rafraichir }}>
      {children}
    </CommandesEntrantesContext.Provider>
  );
}

export function useCommandesEntrantes(): Etat {
  const ctx = useContext(CommandesEntrantesContext);
  if (!ctx) {
    throw new Error(
      'useCommandesEntrantes doit être utilisé sous CommandesEntrantesProvider'
    );
  }
  return ctx;
}
