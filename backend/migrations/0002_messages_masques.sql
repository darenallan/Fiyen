-- Messages échangés dans le canal masqué d'une course.
--
-- Persistés — et non relayés à la volée — parce que le réseau mobile est
-- instable : un message envoyé pendant que l'autre partie est déconnectée
-- serait perdu par un simple relais. Ils disparaissent avec la course
-- (ON DELETE CASCADE), le canal étant inutilisable une fois la course terminée.

CREATE TABLE messages_masques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions_masquage(id) ON DELETE CASCADE,
    -- Qui a écrit, sans jamais stocker d'identité directe : le front n'affiche
    -- que "client" ou "livreur", jamais un identifiant réel.
    expediteur TEXT NOT NULL CHECK (expediteur IN ('client', 'livreur')),
    contenu TEXT NOT NULL CHECK (length(contenu) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_masques_session ON messages_masques (session_id, created_at);
