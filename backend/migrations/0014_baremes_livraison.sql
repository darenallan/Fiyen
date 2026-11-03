-- Barème de livraison de la compagnie : ce que coûte une course au partenaire.
--
-- À ne pas confondre avec `config_tarifaire`, qui porte ce que la compagnie
-- paie à la plateforme (abonnement + commission). Ici, c'est la compagnie qui
-- fixe ses propres prix ; aucune valeur n'est fournie par défaut.
--
-- Trois modes, parce que le client n'a pas encore tranché (forfait, distance
-- ou zones) et que chaque compagnie pourra avoir sa réponse :
--   forfait  : un prix unique par course ;
--   paliers  : un prix par tranche de distance (« zones » concentriques) ;
--   distance : prix de base + prix au kilomètre, avec un minimum.

CREATE TABLE baremes_livraison (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compagnie_id UUID NOT NULL REFERENCES compagnies(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('forfait', 'paliers', 'distance')),
    devise TEXT NOT NULL DEFAULT 'XOF',

    prix_forfait INT,
    -- [{"jusqu_a_km": 3, "prix": 1000}, ...], bornes croissantes
    paliers JSONB,
    prix_base INT,
    prix_par_km INT,
    prix_minimum INT,

    -- La distance est mesurée à vol d'oiseau entre les deux épingles, puis
    -- multipliée par ce coefficient pour approcher le trajet routier.
    coefficient_detour NUMERIC(3, 2) NOT NULL,
    -- Arrondi au multiple supérieur (pas de pièce de 1 F en circulation).
    arrondi INT NOT NULL,

    -- Pourquoi ce changement : lu dans l'historique.
    motif TEXT,

    -- Auteur **recopié**, sans clé étrangère : une clé ON DELETE SET NULL
    -- serait un UPDATE, que le trigger d'immuabilité refuserait.
    auteur_id UUID,
    auteur_role TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_baremes_compagnie ON baremes_livraison (compagnie_id, created_at DESC);

-- **Immuable**, comme le journal : modifier le barème, c'est en publier une
-- nouvelle version. L'historique des changements est la table elle-même, et
-- une commande peut toujours dire sous quel barème elle a été passée.
CREATE TRIGGER baremes_livraison_immuables
    BEFORE UPDATE ON baremes_livraison
    FOR EACH ROW EXECUTE FUNCTION refuser_modification_journal();

-- Le prix est **figé sur la commande** au moment où elle est passée : changer
-- le barème demain ne doit pas réécrire ce qui a été annoncé hier.
ALTER TABLE courses
    ADD COLUMN prix_estime INT,
    ADD COLUMN distance_estimee_m INT,
    ADD COLUMN bareme_id UUID REFERENCES baremes_livraison(id) ON DELETE SET NULL;
