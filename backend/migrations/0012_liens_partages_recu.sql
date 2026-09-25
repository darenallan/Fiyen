-- Lien de reçu partageable par WhatsApp.
--
-- Le destinataire n'a pas de compte sur la plateforme : ce lien lui donne un
-- accès en lecture seule à un seul reçu, sans authentification. Sa portée est
-- volontairement étroite — exactement ce que porte déjà le reçu du partenaire
-- (ni montant, ni téléphone, ni identité du livreur : `chargerRecu` est
-- appelé avec avecLivreur=false pour ce chemin comme pour l'autre).
--
-- Contrairement au jeton de renouvellement (`sessions_refresh`), celui-ci
-- n'est **pas haché** : il doit pouvoir être ressorti tel quel pour qu'un
-- second clic sur « Partager » redonne le même lien plutôt que d'en empiler
-- un nouveau à chaque fois. Le compromis est défendable ici — la portée est
-- un reçu en lecture seule, pas un compte entier — là où il ne le serait pas
-- pour un jeton capable d'agir au nom de l'utilisateur.

CREATE TABLE liens_partages_recu (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    -- 256 bits d'aléa (voir genererJeton) : la protection contre la
    -- devinette tient à l'entropie du jeton, pas à son secret en base.
    jeton      text NOT NULL UNIQUE,
    cree_par   uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
    expire_at  timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Sert à retrouver le lien actif d'une course sans scanner la table : posé
-- séparément de l'UNIQUE sur `jeton`, qui ne couvre pas cette recherche.
CREATE INDEX idx_liens_partages_course ON liens_partages_recu (course_id);

COMMENT ON TABLE liens_partages_recu IS
    'Lien public en lecture seule vers un reçu, pour partage par WhatsApp. Jeton en clair (voir commentaire de table) — sensibilité bien plus faible qu''un jeton de session.';
