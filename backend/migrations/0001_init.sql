-- Schéma initial — plateforme de livraison B2B (Burkina Faso)
-- Étend le schéma de base défini dans CLAUDE.md avec les comptes utilisateurs
-- (nécessaires pour l'auth par rôle) et le rattachement multi-compagnie.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ============================================================
-- Compagnies partenaires (tenants)
-- ============================================================
CREATE TABLE compagnies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'actif', -- actif|suspendu
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Barème tarifaire par compagnie (abonnement + commission)
-- Jamais de valeur codée en dur côté application — tout passe par cette table.
-- ============================================================
CREATE TABLE config_tarifaire (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compagnie_id UUID NOT NULL REFERENCES compagnies(id) ON DELETE CASCADE,
    abonnement_mensuel NUMERIC(12,2) NOT NULL,
    livreurs_inclus INT NOT NULL,
    commission_pourcentage NUMERIC(5,2) NOT NULL, -- ex: 12.50 = 12.5%
    devise TEXT NOT NULL DEFAULT 'XOF',
    active_a_partir TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_config_tarifaire_compagnie ON config_tarifaire (compagnie_id, active_a_partir DESC);

-- ============================================================
-- Livreurs — rattachés à une compagnie
-- ============================================================
CREATE TABLE livreurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compagnie_id UUID NOT NULL REFERENCES compagnies(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    telephone_hash TEXT NOT NULL,      -- jamais le numéro en clair côté client
    statut TEXT NOT NULL DEFAULT 'offline', -- offline|dispo|en_course
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_livreurs_compagnie ON livreurs (compagnie_id);

CREATE TABLE positions_livreurs (
    livreur_id UUID PRIMARY KEY REFERENCES livreurs(id) ON DELETE CASCADE,
    position GEOGRAPHY(POINT, 4326) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_position_gist ON positions_livreurs USING GIST (position);

-- ============================================================
-- Clients
-- ============================================================
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    telephone_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Comptes utilisateurs — un compte par personne, quel que soit le rôle.
-- role=compagnie  -> compagnie_id renseigné, livreur_id/client_id null (admin dashboard)
-- role=livreur    -> livreur_id renseigné
-- role=client     -> client_id renseigné
-- ============================================================
CREATE TABLE utilisateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('compagnie', 'livreur', 'client')),
    telephone_hash TEXT NOT NULL,
    mot_de_passe_hash TEXT NOT NULL,
    compagnie_id UUID REFERENCES compagnies(id) ON DELETE CASCADE,
    livreur_id UUID UNIQUE REFERENCES livreurs(id) ON DELETE CASCADE,
    client_id UUID UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_role_reference CHECK (
        (role = 'compagnie' AND compagnie_id IS NOT NULL AND livreur_id IS NULL AND client_id IS NULL) OR
        (role = 'livreur'   AND livreur_id IS NOT NULL) OR
        (role = 'client'    AND client_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX idx_utilisateurs_telephone ON utilisateurs (telephone_hash);

-- ============================================================
-- Courses
-- ============================================================
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    compagnie_id UUID NOT NULL REFERENCES compagnies(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id),
    livreur_id UUID REFERENCES livreurs(id),
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (
        statut IN ('en_attente', 'assignee', 'recuperee', 'en_route', 'livree', 'annulee')
    ),
    adresse_depart TEXT,
    adresse_arrivee TEXT,
    point_depart GEOGRAPHY(POINT, 4326),
    point_arrivee GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_compagnie ON courses (compagnie_id, statut);
CREATE INDEX idx_courses_livreur ON courses (livreur_id);
CREATE INDEX idx_courses_client ON courses (client_id);

-- ============================================================
-- Masquage du numéro — une session par course
-- ============================================================
CREATE TABLE sessions_masquage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
    numero_virtuel TEXT,          -- null si canal WebRTC pur
    expire_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
