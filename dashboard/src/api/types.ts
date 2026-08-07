export type StatutLivreur = 'offline' | 'dispo' | 'en_course';

export type StatutCourse =
  | 'en_attente'
  | 'assignee'
  | 'recuperee'
  | 'en_route'
  | 'livree'
  | 'annulee';

export interface Livreur {
  id: string;
  nom: string;
  statut: StatutLivreur;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
  position_updated_at: string | null;
  /** Présence réelle (TTL Redis), distincte du statut déclaré. */
  en_ligne: boolean;
}

export interface Course {
  id: string;
  compagnie_id: string;
  client_id: string;
  livreur_id: string | null;
  statut: StatutCourse;
  adresse_depart: string;
  adresse_arrivee: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  courses_par_statut: Partial<Record<StatutCourse, number>>;
  livreurs_par_statut: Partial<Record<StatutLivreur, number>>;
}

export interface ConfigTarifaire {
  id: string;
  compagnie_id: string;
  abonnement_mensuel: number;
  livreurs_inclus: number;
  commission_pourcentage: number;
  devise: string;
  active_a_partir: string;
  created_at: string;
}
