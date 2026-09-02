-- Jetons de notification push.
--
-- Aujourd'hui, un livreur doit regarder son écran pour savoir qu'une course
-- l'attend. C'est le manque le plus criant du produit : la course reste en
-- file pendant qu'il fait autre chose.

CREATE TABLE jetons_push (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,

    -- Jeton Expo, de la forme `ExponentPushToken[...]`. Stocké en clair : il
    -- faut le transmettre tel quel au service d'envoi. Ce n'est pas un secret
    -- d'authentification, mais il permet d'écrire sur l'écran de quelqu'un —
    -- d'où la contrainte d'unicité plus bas.
    jeton TEXT NOT NULL,

    plateforme TEXT NOT NULL CHECK (plateforme IN ('android', 'ios', 'web')),

    -- Un livreur peut avoir deux téléphones, ou en changer sans se déconnecter
    -- du premier. On garde donc plusieurs jetons par personne et on envoie à
    -- tous : mieux vaut une notification en double qu'une notification perdue.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- **Unicité sur le jeton, pas sur le couple.** Un téléphone réinstallé ou passé
-- d'un livreur à l'autre garde le même jeton Expo : sans cette contrainte,
-- l'ancien propriétaire continuerait de recevoir les courses du nouveau.
-- L'enregistrement fait un ON CONFLICT qui réattribue le jeton.
CREATE UNIQUE INDEX idx_jetons_push_jeton ON jetons_push (jeton);
CREATE INDEX idx_jetons_push_utilisateur ON jetons_push (utilisateur_id);
