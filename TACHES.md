# Suivi des tâches — Fiyen V2

Découpage opérationnel de [PLAN-V2-PORTAIL-PARTENAIRES.md](PLAN-V2-PORTAIL-PARTENAIRES.md).
Une tâche = un morceau livrable et vérifiable. **Cocher au fur et à mesure.**

Convention : `[ ]` à faire · `[~]` en cours · `[x]` fait et vérifié

---

## Phase 0 — Sécuriser l'existant

- [x] Committer le travail existant *(fait côté utilisateur)*
- [x] **Refresh de JWT** — le jeton expire en 30 min sans renouvellement
  - [x] Table `sessions_refresh` (jeton haché, utilisateur, expiration, révocation)
  - [x] `POST /api/auth/refresh` + rotation du jeton à chaque usage
  - [x] `POST /api/auth/deconnexion` qui révoque
  - [x] Renouvellement transparent côté client (les 4 fronts)
  - [x] Test : une session reste vivante au-delà de 30 min
        *(`scripts/test-refresh.mjs` 19/19 · `scripts/test-session-longue.mjs` 8/8 ·
        vérifié en navigateur : jeton expiré, écran conservé, aucune reconnexion)*
- [x] **Versionner les tests du masquage** (39 assertions aujourd'hui perdues)
  - [x] Garanties de protocole — 42 tests Go
        (`internal/masquage/masquage_test.go`, `internal/handlers/masquage_test.go`,
        `internal/handlers/masquage_ws_test.go`)
  - [x] Script de bout en bout rejouable pour les garanties d'interface
        (`scripts/test-masquage-ui.mjs`, 21 vérifications)
  - [x] `go test ./...` passe
  - [x] Vérifié par mutation : casser le contrôle d'accès, l'anti-fuite
        d'identité, la revalidation d'expiration ou l'expéditeur fait bien
        échouer les tests correspondants

---

## Phase 1 — Comptes partenaires et collaborateurs

- [ ] Migration : table `partenaires`
- [ ] Migration : `utilisateurs` + `partenaire_id`, rôles `partenaire` / `collaborateur`
- [ ] Migration : `courses` + `partenaire_id`, `cree_par`
- [ ] Migration : renommer `clients` → `destinataires`
- [ ] API partenaires (créer / lister / désactiver)
- [ ] API collaborateurs (inviter par téléphone, code à 6 chiffres)
- [ ] `GET /api/partenaires/me`
- [ ] Onglet « Partenaires » au dashboard compagnie
- [ ] Désactivation sans suppression (l'historique doit survivre)
- [ ] *(reportable)* Plafonds par collaborateur

---

## Phase 2 — Commande en autonomie

- [ ] Projet `app-partenaire/` (Vite + React, charte Fiyen)
- [ ] Connexion partenaire / collaborateur
- [ ] Écran de création de course
- [ ] `POST /api/courses` ouvert au rôle partenaire
- [ ] **Carnet de destinataires** + bouton « refaire cette livraison »
- [ ] **Adresse en texte libre + repère + point sur carte optionnel**
- [ ] **Numéro de course court** (`FY-3042`)
- [ ] **File des commandes entrantes** côté compagnie (badge + compteur)
- [ ] **Mode dégradé** : brouillon local, envoi à la reconnexion
- [ ] *(reportable)* Commande groupée
- [ ] *(reportable)* Créneau souhaité

---

## Phase 3 — Notifications

- [ ] Table `jetons_push` + enregistrement du jeton Expo
- [ ] **Push au livreur à l'assignation** *(la plus importante)*
- [ ] Notifications in-app au partenaire aux étapes clés
- [ ] Choix du canal selon le coût (push gratuit, SMS réservé à 2 événements)
- [ ] Préférences par partenaire
- [ ] *(reportable)* Notifications au destinataire

---

## Phase 4 — Livraisons hors ville (relais transporteur)

- [ ] Migrations : `transporteurs`, `agences`
- [ ] Migration : `courses` + type, transporteur, agences, bordereau, frais
- [ ] Statuts étendus : `deposee_agence` → `en_transit` → `arrivee_agence`
- [ ] Choix « en ville » / « autre ville » à la commande
- [ ] Saisie du **numéro de bordereau** par le livreur au dépôt
- [ ] **État « en transit » sans carte** (assumer le trou de suivi)
- [ ] Bascule « arrivé à l'agence » depuis le dashboard + notification
- [ ] Retrait : nom du réceptionnaire à l'agence

---

## Phase 5 — Reçus, preuve de livraison et traçabilité

- [ ] Migration : `evenements_course` (journal horodaté)
- [ ] Migration : `traces_positions` en append-only
- [ ] Reçu imprimable (`@media print`), numéroté par compagnie
- [ ] Variante interurbaine du reçu (transporteur, agence, bordereau)
- [ ] **Preuve de livraison** : signature ou photo + nom du réceptionnaire
- [ ] **Lien partageable par WhatsApp**
- [ ] **Rejeu du trajet** sur la carte
- [ ] *(reportable)* Politique de rétention des traces

---

## Phase 6 — Récapitulatifs et facturation

- [ ] `GET /api/recapitulatifs` (filtres période / partenaire / collaborateur)
- [ ] **Les 4 chiffres** + comparaison au mois précédent
- [ ] Export CSV
- [ ] API d'écriture pour `config_tarifaire`
- [ ] Table `factures` + génération mensuelle
- [ ] **Encours par partenaire** + statuts + relance
- [ ] Référence de transaction mobile money au règlement
- [ ] Numérotation séquentielle sans trou
- [ ] *(reportable)* Envoi automatique de la facture

---

## Phase 7 — Anglais

- [ ] `src/i18n/fr.ts` et `en.ts` + hook `useT()` (sans bibliothèque)
- [ ] Extraction des chaînes des 4 interfaces
- [ ] Sélecteur de langue + préférence par utilisateur
- [ ] Formats de date et de montant (XOF)

---

## Dette technique (hors phases, à traiter quand ça gêne)

- [ ] Jetons de design dupliqués dans 4 projets → workspace npm
- [ ] Le code de session est lui aussi recopié dans les 4 clients d'API
- [ ] App Expo jamais testée sur un appareil réel
  - [ ] En particulier : le verrou anti-rotation-concurrente du renouvellement
        est en mémoire. Si Android relance la tâche de localisation dans un
        contexte JS distinct, deux rotations pourraient se croiser et le
        serveur y verrait un rejeu — donc une déconnexion.
- [ ] Purge des sessions expirées (`auth.Purger`) écrite mais jamais planifiée
- [ ] Aucune CI
- [ ] Pas de déploiement ni de TLS
- [ ] Pas de sauvegarde de la base

---

## Informations attendues du client

| Information | Bloque |
| --- | --- |
| Visibilité d'un collaborateur : ses courses ou toutes celles de son entreprise ? | Phase 1 |
| Mode de tarification : forfait, distance, ou abonnement ? | Phase 6 |
| Quels documents papier remplacer exactement ? | Phase 5 |
| Frais transporteur : avancés puis refacturés, ou payés directement ? | Phases 4 et 6 |
| Villes et transporteurs réellement utilisés | Phase 4 |
| Part du hors-ville dans l'activité | Ordre des phases 2 et 4 |
