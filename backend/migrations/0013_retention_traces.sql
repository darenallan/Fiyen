-- Rétention des traces de position (5.8).
--
-- L'index unique existant porte sur (livreur_id, horodatage) : il sert le
-- rejeu d'un trajet, pas la purge, qui filtre sur l'âge seul, tous livreurs
-- confondus. Sans cet index, chaque passage lirait la table entière — des
-- millions de lignes — pour en supprimer quelques milliers.
CREATE INDEX IF NOT EXISTS idx_traces_horodatage ON traces_positions (horodatage);
