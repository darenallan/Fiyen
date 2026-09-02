-- Suite du renommage : l'expéditeur d'un message masqué.
--
-- `messages_masques.expediteur` vaut « client » ou « livreur ». C'est cette
-- valeur qui décide de quel côté du fil une bulle s'affiche : la laisser à
-- « client » alors que le reste du système dit « destinataire » ferait afficher
-- tous les messages du mauvais côté dès que le front est mis à jour.
--
-- Même procédé qu'en 0006 : élargir la contrainte, convertir, resserrer.

ALTER TABLE messages_masques DROP CONSTRAINT IF EXISTS messages_masques_expediteur_check;
ALTER TABLE messages_masques ADD CONSTRAINT messages_masques_expediteur_check
    CHECK (expediteur IN ('client', 'destinataire', 'livreur'));

UPDATE messages_masques SET expediteur = 'destinataire' WHERE expediteur = 'client';

ALTER TABLE messages_masques DROP CONSTRAINT messages_masques_expediteur_check;
ALTER TABLE messages_masques ADD CONSTRAINT messages_masques_expediteur_check
    CHECK (expediteur IN ('destinataire', 'livreur'));
