-- Jetons de renouvellement de session.
--
-- Le jeton d'accès JWT est volontairement court (30 min) : il n'est pas
-- révocable, donc plus il vit longtemps, plus un vol coûte cher. Le jeton de
-- renouvellement, lui, est stocké côté serveur et donc révocable — c'est lui
-- qui porte la durée de vie longue et évite qu'un livreur soit déconnecté en
-- pleine course.
--
-- Seul le **hash** du jeton est conservé : une fuite de la base ne permet pas
-- de rejouer les sessions, exactement comme pour les mots de passe.

CREATE TABLE sessions_refresh (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    jeton_hash TEXT NOT NULL UNIQUE,
    expire_at TIMESTAMPTZ NOT NULL,

    -- Rotation : à chaque renouvellement, l'ancien jeton est marqué comme
    -- remplacé et pointe vers son successeur. Si un jeton déjà remplacé est
    -- présenté, c'est qu'il a été volé — on révoque alors toute la chaîne.
    remplace_par UUID REFERENCES sessions_refresh(id) ON DELETE SET NULL,
    revoque_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_refresh_utilisateur ON sessions_refresh (utilisateur_id);
CREATE INDEX idx_sessions_refresh_expiration ON sessions_refresh (expire_at);
