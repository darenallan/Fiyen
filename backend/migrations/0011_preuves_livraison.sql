-- Preuve de livraison : ce qui atteste que le colis est arrivé, et à qui.
--
-- Une seule ligne par course, posée en une fois. La preuve se recueille sur le
-- pas de la porte, d'un seul geste : nom du réceptionnaire, et une signature ou
-- une photo. Autoriser des ajouts successifs obligerait à rendre la ligne
-- modifiable, or c'est une pièce — elle ne se retouche pas.
--
-- La preuve **ne conditionne pas** le passage à « livrée ». Un appareil dont
-- l'écran ne prend pas la signature, ou dont l'appareil photo refuse de
-- démarrer, ne doit pas empêcher un livreur de clore sa course : l'exiger
-- créerait surtout une incitation à la fabriquer.

CREATE TABLE preuves_livraison (
    -- Clé primaire sur la course : une preuve et une seule. Un second envoi est
    -- refusé par la base, pas seulement par le handler.
    course_id       uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,

    -- Recopié plutôt que joint depuis `courses` : le livreur assigné peut
    -- changer après coup, et la preuve doit dire qui l'a recueillie.
    livreur_id      uuid NOT NULL REFERENCES livreurs(id),

    -- La partie la moins coûteuse et la plus utile : c'est un nom qui clôt une
    -- contestation, pas une image floue.
    nom_receptionnaire text,

    type_media      text CHECK (type_media IN ('signature', 'photo')),
    media           bytea,
    media_mime      text,
    media_octets    integer,

    -- Instant de la capture sur l'appareil, distinct de `created_at` qui est
    -- celui de la réception par le serveur. Sur un réseau qui vacille, l'envoi
    -- peut arriver longtemps après la porte ; le document doit dire quand la
    -- signature a été donnée, pas quand elle est parvenue.
    capture_le      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    -- Une preuve vide n'en est pas une.
    CONSTRAINT preuve_non_vide CHECK (
        nom_receptionnaire IS NOT NULL OR media IS NOT NULL
    ),

    -- Les quatre colonnes du média vont ensemble : une image sans type ni
    -- taille ne se sert pas, et un type sans image ne prouve rien.
    CONSTRAINT media_coherent CHECK (
        (media IS NULL AND type_media IS NULL AND media_mime IS NULL AND media_octets IS NULL)
        OR
        (media IS NOT NULL AND type_media IS NOT NULL AND media_mime IS NOT NULL AND media_octets IS NOT NULL)
    ),

    -- Borne dure, doublée côté handler. Le handler rend un message utile ; la
    -- base garantit qu'aucun autre chemin d'écriture ne la contourne.
    CONSTRAINT media_borne CHECK (media_octets IS NULL OR media_octets <= 524288)
);

CREATE INDEX idx_preuves_livreur ON preuves_livraison (livreur_id);

-- Immuable par la base, comme le journal : une pièce qu'on peut réécrire ne
-- prouve rien. La suppression reste permise — la cascade depuis `courses` en a
-- besoin, et une politique de rétention en aura besoin aussi.
CREATE TRIGGER preuves_livraison_immuables
    BEFORE UPDATE ON preuves_livraison
    FOR EACH ROW EXECUTE FUNCTION refuser_modification_journal();

COMMENT ON TABLE preuves_livraison IS
    'Preuve de remise : nom du réceptionnaire, signature ou photo. Une par course, immuable.';
COMMENT ON COLUMN preuves_livraison.capture_le IS
    'Instant de capture sur l''appareil du livreur, à distinguer de created_at (réception serveur).';
