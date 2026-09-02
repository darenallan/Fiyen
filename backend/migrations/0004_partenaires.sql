-- Comptes partenaires et collaborateurs.
--
-- Jusqu'ici, seule la compagnie créait des courses. Le client demande que ses
-- entreprises clientes puissent commander elles-mêmes — c'est le cœur de la V2.
--
-- Vocabulaire, à ne pas confondre :
--   compagnie     : la société de livraison, locataire de la plateforme
--   partenaire    : une entreprise cliente de cette compagnie (une boutique)
--   collaborateur : un employé du partenaire, qui commande en son nom
--   client        : le particulier qui reçoit le colis (inchangé)

-- ============================================================
-- Partenaires — entreprises clientes d'une compagnie
-- ============================================================
CREATE TABLE partenaires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compagnie_id UUID NOT NULL REFERENCES compagnies(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    -- Repère verbal plutôt qu'adresse postale : à Ouagadougou, la plupart des
    -- commerces n'ont pas d'adresse normalisée. « Face à la station Total de
    -- Gounghin » localise mieux qu'un numéro de rue.
    repere TEXT,
    telephone_hash TEXT,

    -- Désactivation plutôt que suppression : l'historique des courses et les
    -- factures déjà émises doivent survivre à la fin de la relation.
    statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu')),

    -- Portée de visibilité des collaborateurs. Le client n'a pas encore
    -- tranché entre « chacun voit ses courses » et « tout le monde voit celles
    -- de l'entreprise » ; le choix vit en base, par partenaire, pour que la
    -- réponse ne coûte pas une migration. Défaut au plus ouvert : c'est
    -- l'usage attendu d'une petite boutique où deux personnes se relaient.
    visibilite_collaborateurs TEXT NOT NULL DEFAULT 'entreprise'
        CHECK (visibilite_collaborateurs IN ('entreprise', 'personnelle')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partenaires_compagnie ON partenaires (compagnie_id, statut);

-- Deux partenaires d'une même compagnie ne peuvent pas porter le même nom :
-- l'opérateur les distingue à l'œil dans une liste déroulante.
CREATE UNIQUE INDEX idx_partenaires_nom_par_compagnie
    ON partenaires (compagnie_id, lower(nom));

-- ============================================================
-- Rattachement des comptes utilisateurs
-- ============================================================

-- Le rôle `partenaire` est le compte principal de l'entreprise (il gère ses
-- collaborateurs) ; `collaborateur` ne fait que commander.
ALTER TABLE utilisateurs
    ADD COLUMN partenaire_id UUID REFERENCES partenaires(id) ON DELETE CASCADE,
    ADD COLUMN nom TEXT,
    -- Suspendre un collaborateur sans effacer ce qu'il a commandé.
    ADD COLUMN actif BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('compagnie', 'livreur', 'client', 'partenaire', 'collaborateur'));

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS chk_role_reference;
ALTER TABLE utilisateurs ADD CONSTRAINT chk_role_reference CHECK (
    (role = 'compagnie'     AND compagnie_id IS NOT NULL AND livreur_id IS NULL AND client_id IS NULL AND partenaire_id IS NULL) OR
    (role = 'livreur'       AND livreur_id IS NOT NULL) OR
    (role = 'client'        AND client_id IS NOT NULL) OR
    -- Les comptes partenaire et collaborateur portent les deux rattachements :
    -- le partenaire pour savoir au nom de qui ils commandent, la compagnie
    -- pour que les requêtes du dashboard restent cloisonnées par locataire
    -- sans jointure supplémentaire.
    (role = 'partenaire'    AND partenaire_id IS NOT NULL AND compagnie_id IS NOT NULL) OR
    (role = 'collaborateur' AND partenaire_id IS NOT NULL AND compagnie_id IS NOT NULL)
);

CREATE INDEX idx_utilisateurs_partenaire ON utilisateurs (partenaire_id) WHERE partenaire_id IS NOT NULL;

-- Un seul compte principal par partenaire.
CREATE UNIQUE INDEX idx_un_compte_partenaire_principal
    ON utilisateurs (partenaire_id) WHERE role = 'partenaire';

-- ============================================================
-- Invitations de collaborateurs
-- ============================================================
--
-- Le partenaire invite par numéro ; l'invité reçoit un code à 6 chiffres qu'il
-- saisit pour ouvrir son compte. Pas de courriel : le parc visé est mobile, et
-- l'adresse électronique n'est pas un identifiant fiable ici.
--
-- Seul le **hash** du code est conservé, comme pour les mots de passe et les
-- jetons de session : une fuite de la base ne doit pas permettre d'entrer.
CREATE TABLE invitations_collaborateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partenaire_id UUID NOT NULL REFERENCES partenaires(id) ON DELETE CASCADE,
    telephone_hash TEXT NOT NULL,
    nom TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expire_at TIMESTAMPTZ NOT NULL,
    -- Un code à 6 chiffres se force en un million d'essais : le compteur borne
    -- les tentatives, faute de quoi le rate limiting HTTP serait la seule
    -- défense et il se contourne en changeant d'adresse.
    tentatives INT NOT NULL DEFAULT 0,
    consomme_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invitations_partenaire ON invitations_collaborateurs (partenaire_id);
CREATE INDEX idx_invitations_telephone ON invitations_collaborateurs (telephone_hash)
    WHERE consomme_at IS NULL;

-- ============================================================
-- Origine des courses
-- ============================================================
--
-- `partenaire_id` est nul pour les courses saisies par la compagnie elle-même :
-- c'est le fonctionnement d'aujourd'hui, qui doit continuer de marcher.
-- `cree_par` retient l'auteur réel — indispensable pour la facturation par
-- collaborateur demandée en phase 6, et impossible à reconstituer après coup.
ALTER TABLE courses
    ADD COLUMN partenaire_id UUID REFERENCES partenaires(id) ON DELETE SET NULL,
    ADD COLUMN cree_par UUID REFERENCES utilisateurs(id) ON DELETE SET NULL;

CREATE INDEX idx_courses_partenaire ON courses (partenaire_id, created_at DESC)
    WHERE partenaire_id IS NOT NULL;
CREATE INDEX idx_courses_cree_par ON courses (cree_par) WHERE cree_par IS NOT NULL;
