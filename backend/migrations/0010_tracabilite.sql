-- Traçabilité : journal des évènements et trace des positions.
--
-- Ce que ces deux tables rendent possible et qui ne l'est pas aujourd'hui :
-- dire *quand* et *par qui* une course a changé d'état, et rejouer le trajet
-- qu'a réellement suivi le livreur. Ni l'un ni l'autre ne se reconstitue après
-- coup — `courses` ne garde que l'état courant, et `positions_livreurs` que la
-- dernière position connue.

-- ============================================================
-- Journal des évènements d'une course
-- ============================================================
CREATE TABLE evenements_course (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,

    -- Aligné sur les statuts de course, plus `creee` qui n'est pas un statut.
    -- Pas de contrainte d'énumération : la phase 4 ajoutera les étapes
    -- interurbaines, et un type inconnu se lit sans casser quoi que ce soit.
    type TEXT NOT NULL,

    -- Qui a provoqué l'évènement. Nul pour ce que le système fait seul.
    -- ON DELETE SET NULL : un compte supprimé ne doit pas emporter l'histoire
    -- des courses qu'il a traitées.
    auteur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,

    -- Rôle **au moment de l'action**, recopié et non joint. Un compte peut
    -- changer de rôle ; le journal doit dire ce qui était vrai à l'instant, pas
    -- ce qui est vrai aujourd'hui.
    auteur_role TEXT,

    -- Ce que l'évènement porte en propre : livreur assigné, motif d'annulation,
    -- nom du réceptionnaire. En JSONB parce que chaque type a ses champs, et
    -- qu'une colonne par cas laisserait la table pleine de vide.
    details JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evenements_course ON evenements_course (course_id, created_at);

-- **Interdiction de modifier.** Un journal qu'on peut réécrire ne prouve rien :
-- c'est toute la différence entre une trace et une table ordinaire.
--
-- La suppression reste permise — la cascade depuis `courses` en a besoin, et
-- la politique de rétention en aura besoin aussi. Ce qui compte pour une
-- preuve, c'est qu'un évènement ne soit pas *altéré*.
-- La fonction nomme la table par `TG_TABLE_NAME` : elle sert aussi à
-- `traces_positions`, et un message en dur désignerait la mauvaise.
CREATE OR REPLACE FUNCTION refuser_modification_journal()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% est un journal : ses lignes ne se modifient pas', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evenements_course_immuables
    BEFORE UPDATE ON evenements_course
    FOR EACH ROW EXECUTE FUNCTION refuser_modification_journal();

-- ============================================================
-- Trace des positions
-- ============================================================
--
-- `positions_livreurs` écrase la position à chaque envoi : elle répond à « où
-- est le livreur maintenant », pas à « par où est-il passé ».
--
-- Rattachée au **livreur** et non à la course : au moment où une position
-- arrive, le livreur peut n'avoir aucune course assignée, et retrouver la
-- course courante coûterait une requête supplémentaire toutes les trois
-- secondes. Le trajet d'une course se reconstitue en croisant cette table avec
-- les bornes temporelles que donne `evenements_course`.
CREATE TABLE traces_positions (
    -- BIGSERIAL et non UUID : c'est la table qui grossit le plus vite, et huit
    -- octets valent mieux que seize répétés des millions de fois.
    id BIGSERIAL PRIMARY KEY,
    livreur_id UUID NOT NULL REFERENCES livreurs(id) ON DELETE CASCADE,
    position GEOGRAPHY(POINT, 4326) NOT NULL,

    -- Horodatage de **capture**, pas d'écriture : une position rejouée après
    -- une coupure réseau doit se replacer au bon endroit dans le trajet.
    horodatage TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un seul index, **unique**, qui sert deux buts d'un coup :
--   — la lecture prévue, « les positions de ce livreur entre deux instants » ;
--   — l'unicité, parce que l'app mobile réémet un lot après une coupure et
--     qu'un doublon ferait un aller-retour fantôme sur le tracé.
CREATE UNIQUE INDEX idx_traces_livreur_horodatage
    ON traces_positions (livreur_id, horodatage);

CREATE TRIGGER traces_positions_immuables
    BEFORE UPDATE ON traces_positions
    FOR EACH ROW EXECUTE FUNCTION refuser_modification_journal();
