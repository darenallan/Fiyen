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
  destinataire_id: string;
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

/**
 * Commande déposée par une entreprise cliente et pas encore assignée.
 *
 * Distincte de `Course` : elle porte ce que le partenaire a saisi (repères,
 * description du colis, consigne) et ce qui l'identifie côté opérateur (le nom
 * de l'entreprise, celui de la personne qui a commandé).
 */
export interface CommandeEntrante {
  id: string;
  /** Numéro court dictable au téléphone, « FY-1042 ». */
  numero: string;
  statut: StatutCourse;
  adresse_depart: string;
  repere_depart?: string;
  adresse_arrivee: string;
  repere_arrivee?: string;
  description_colis?: string;
  instructions?: string;
  destinataire_nom: string;
  latitude_depart?: number;
  longitude_depart?: number;
  latitude_arrivee?: number;
  longitude_arrivee?: number;
  cree_par_nom?: string;
  partenaire_nom: string;
  created_at: string;
  updated_at: string;
}

/** Une étape du déroulé, telle que le journal l'a retenue. */
export interface EvenementJournal {
  type: string;
  auteur_nom?: string;
  auteur_role?: string;
  details?: Record<string, string>;
  horodatage: string;
}


/** Preuve de remise : ce qui atteste que le colis est arrivé, et à qui.
 *  Absente quand le livreur n'a rien déposé — ce n'est pas une anomalie, la
 *  remise n'est pas conditionnée à une signature. */
export interface Preuve {
  nom_receptionnaire?: string;
  type_media?: 'signature' | 'photo';
  media_mime?: string;
  media_octets?: number;
  livreur_nom?: string;
  /** Instant de la capture à la porte, distinct de `recue_le` : sur un réseau
   *  qui vacille, la preuve arrive parfois longtemps après. */
  capture_le: string;
  recue_le: string;
}

/**
 * Reçu imprimable d'une course.
 *
 * `livreur_nom` n'est renseigné que sur ce reçu-ci : celui du partenaire ne le
 * porte pas, et ce n'est pas un oubli — la garantie de masquage vaut aussi sur
 * papier.
 *
 * Aucun montant n'y figure : `config_tarifaire` porte un abonnement et une
 * commission, pas un tarif par course.
 */
export interface Recu {
  numero: string;
  statut: StatutCourse;
  compagnie_nom: string;
  partenaire_nom?: string;
  destinataire_nom: string;
  adresse_depart: string;
  repere_depart?: string;
  adresse_arrivee: string;
  repere_arrivee?: string;
  description_colis?: string;
  instructions?: string;
  cree_par_nom?: string;
  livreur_nom?: string;
  journal: EvenementJournal[];
  preuve?: Preuve;
  cree_le: string;
  /** Instant du tirage, distinct de la création. */
  emis_le: string;
}
