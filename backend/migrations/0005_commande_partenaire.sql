-- Commande en autonomie par les partenaires.
--
-- Ce que la V2 emprunte à Glovo : le parcours « envoyer un colis » — deux
-- points, une description, un numéro court, un suivi. Ce qu'elle n'emprunte
-- pas : le catalogue, le panier, le paiement. Il n'y a ni commerce ni produit
-- dans ce schéma, et il n'y en aura pas (voir l'avertissement de CLAUDE.md).

-- ============================================================
-- Numéro de course court
-- ============================================================
--
-- Un UUID ne se dicte pas au téléphone. « FY-1042 » s'annonce, se note sur un
-- carnet et se retrouve — c'est ce que le partenaire donnera à son client et
-- ce que l'opérateur cherchera dans son dashboard.
--
-- La numérotation est **par compagnie** : deux compagnies n'ont pas à partager
-- une suite, et un partenaire ne doit pas pouvoir déduire le volume d'affaires
-- d'une autre en regardant l'écart entre deux numéros.
ALTER TABLE compagnies ADD COLUMN compteur_courses INT NOT NULL DEFAULT 1000;

ALTER TABLE courses ADD COLUMN numero INT;

-- Reprise de l'existant : les courses déjà en base reçoivent un numéro dans
-- leur ordre de création, sans quoi la contrainte NOT NULL échouerait.
WITH numerotees AS (
    SELECT id, 1000 + row_number() OVER (
        PARTITION BY compagnie_id ORDER BY created_at, id
    ) AS n
    FROM courses
)
UPDATE courses c SET numero = numerotees.n
FROM numerotees WHERE c.id = numerotees.id;

UPDATE compagnies SET compteur_courses = COALESCE(
    (SELECT max(numero) FROM courses WHERE courses.compagnie_id = compagnies.id),
    1000
);

ALTER TABLE courses ALTER COLUMN numero SET NOT NULL;
CREATE UNIQUE INDEX idx_courses_numero ON courses (compagnie_id, numero);

-- ============================================================
-- Ce que le partenaire décrit à la commande
-- ============================================================
ALTER TABLE courses
    -- « Deux cartons de tissu », « documents ». Le livreur doit savoir ce qu'il
    -- prend avant de partir : un colis encombrant ne se transporte pas à moto.
    ADD COLUMN description_colis TEXT,

    -- Repère verbal, à côté de l'adresse en texte libre. À Ouagadougou la
    -- plupart des points n'ont pas d'adresse normalisée : c'est le repère qui
    -- localise réellement, pas la ligne d'adresse.
    ADD COLUMN repere_depart TEXT,
    ADD COLUMN repere_arrivee TEXT,

    -- Consigne libre au livreur (« appeler en arrivant », « 2e étage »).
    ADD COLUMN instructions TEXT;

-- ============================================================
-- Carnet de destinataires
-- ============================================================
--
-- Pas de table dédiée : le carnet **est** l'historique des courses du
-- partenaire. Une table séparée se désynchroniserait du réel — une adresse
-- corrigée sur une course ne remonterait pas dans le carnet — et il faudrait
-- l'entretenir. Cet index rend la requête « dernier envoi par destinataire »
-- immédiate.
CREATE INDEX idx_courses_carnet
    ON courses (partenaire_id, client_id, created_at DESC)
    WHERE partenaire_id IS NOT NULL;

-- Un destinataire est identifié par son numéro : sans unicité, chaque commande
-- créerait un doublon et le carnet deviendrait illisible.
CREATE UNIQUE INDEX idx_clients_telephone ON clients (telephone_hash);
