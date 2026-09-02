-- Préférences de notification par partenaire.
--
-- Une boutique qui fait trente livraisons par jour ne veut pas cent vingt
-- annonces ; une qui en fait deux veut tout savoir. Sans réglage, on choisit
-- forcément mal pour l'une des deux.

-- Table des **exclusions**, et non des activations.
--
-- Le défaut est « on prévient » : un partenaire qui n'a rien réglé doit être
-- au courant de ce qui arrive à ses colis. Stocker les activations aurait
-- exigé d'écrire une ligne par évènement à la création de chaque partenaire,
-- et un oubli aurait rendu quelqu'un silencieusement sourd.
--
-- Ici, une ligne absente veut dire « prévenir », ce qui est aussi le
-- comportement en cas de panne de lecture.
CREATE TABLE notifications_desactivees (
    partenaire_id UUID NOT NULL REFERENCES partenaires(id) ON DELETE CASCADE,

    -- Nom de l'évènement, aligné sur `internal/notifications.Evenement`.
    -- Pas de contrainte d'énumération : la phase 4 ajoutera les étapes
    -- interurbaines, et une contrainte imposerait une migration pour chaque
    -- nouvel évènement alors qu'un nom inconnu est sans effet.
    evenement TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (partenaire_id, evenement)
);
