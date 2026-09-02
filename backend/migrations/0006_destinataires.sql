-- Renommage : `clients` devient `destinataires`.
--
-- En V1, « client » désignait sans ambiguïté le particulier qui reçoit le
-- colis. Depuis la V2, la compagnie a des entreprises **clientes** (les
-- partenaires), qui ont elles-mêmes des clients. Le mot ne dit plus de qui on
-- parle. « Destinataire » ne désigne qu'une chose : celui à qui le colis va.
--
-- Renommage pur : aucune donnée n'est perdue, aucune colonne n'est ajoutée.
-- Postgres conserve les données et les contraintes à travers un ALTER ... RENAME.

ALTER TABLE clients RENAME TO destinataires;

ALTER TABLE courses RENAME COLUMN client_id TO destinataire_id;
ALTER TABLE utilisateurs RENAME COLUMN client_id TO destinataire_id;

-- Les index et contraintes gardent leur ancien nom après un renommage de
-- table : les renommer aussi évite qu'un futur lecteur cherche une table
-- `clients` qui n'existe plus.
ALTER INDEX IF EXISTS idx_clients_telephone RENAME TO idx_destinataires_telephone;
ALTER INDEX IF EXISTS idx_courses_client RENAME TO idx_courses_destinataire;

-- ============================================================
-- Le rôle suit le même chemin
-- ============================================================
--
-- Laisser le rôle s'appeler `client` alors que la table s'appelle
-- `destinataires` aurait fait un renommage à moitié fait — exactement le genre
-- d'incohérence qui coûte une relecture à chaque fois qu'on y revient.
--
-- La contrainte doit accepter les deux valeurs le temps de convertir les
-- lignes, sinon l'UPDATE viole la contrainte qu'il est en train de satisfaire.

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('compagnie', 'livreur', 'client', 'destinataire', 'partenaire', 'collaborateur'));

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS chk_role_reference;
ALTER TABLE utilisateurs ADD CONSTRAINT chk_role_reference CHECK (
    (role = 'compagnie'     AND compagnie_id IS NOT NULL AND livreur_id IS NULL AND destinataire_id IS NULL AND partenaire_id IS NULL) OR
    (role = 'livreur'       AND livreur_id IS NOT NULL) OR
    (role IN ('client', 'destinataire') AND destinataire_id IS NOT NULL) OR
    (role = 'partenaire'    AND partenaire_id IS NOT NULL AND compagnie_id IS NOT NULL) OR
    (role = 'collaborateur' AND partenaire_id IS NOT NULL AND compagnie_id IS NOT NULL)
);

UPDATE utilisateurs SET role = 'destinataire' WHERE role = 'client';

-- Une fois les lignes converties, `client` n'a plus de raison d'être accepté.
-- Le laisser passer permettrait à un futur code de le réintroduire sans que
-- rien ne s'y oppose.
ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('compagnie', 'livreur', 'destinataire', 'partenaire', 'collaborateur'));

ALTER TABLE utilisateurs DROP CONSTRAINT chk_role_reference;
ALTER TABLE utilisateurs ADD CONSTRAINT chk_role_reference CHECK (
    (role = 'compagnie'     AND compagnie_id IS NOT NULL AND livreur_id IS NULL AND destinataire_id IS NULL AND partenaire_id IS NULL) OR
    (role = 'livreur'       AND livreur_id IS NOT NULL) OR
    (role = 'destinataire'  AND destinataire_id IS NOT NULL) OR
    (role = 'partenaire'    AND partenaire_id IS NOT NULL AND compagnie_id IS NOT NULL) OR
    (role = 'collaborateur' AND partenaire_id IS NOT NULL AND compagnie_id IS NOT NULL)
);
