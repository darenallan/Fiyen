t# Roadmap Fiyen — point par point

Découpage opérationnel de [PLAN-V2-PORTAIL-PARTENAIRES.md](PLAN-V2-PORTAIL-PARTENAIRES.md).
**Un point = un morceau livrable, vérifiable, qu'on coche.**

Convention : `[ ]` à faire · `[~]` en cours · `[x]` fait et vérifié · 🔒 bloqué

---

## Où on en est

| Bloc | État | Preuve |
| --- | --- | --- |
| Phase 0 — Sécuriser l'existant | ✅ | `go test ./...` · `test-refresh` 19/19 · `test-session-longue` 8/8 · `test-masquage-ui` 21/21 |
| Phase 1 — Partenaires et collaborateurs | ✅ | `test-partenaires` 39/39 · parcours dashboard 20/20 |
| Phase 2 — Commande en autonomie | ✅ | `test-commandes` 34/34 · parcours app partenaire 37/37 · boucle complète 18/18 |
| Reste | 5 blocs | ≈ 28 jours |

Les trois phases sont closes : le renommage `clients` → `destinataires`, seule
tâche restée ouverte, est fait (**D2**).

---

## Ordre recommandé

L'ordre n'est pas celui des numéros. Il suit trois règles : ce qui est rapide et
sans dépendance d'abord, ce qui coûte plus cher plus tard ensuite, ce qui attend
une réponse du client en dernier.

| # | Quoi | Pourquoi maintenant |
| --- | --- | --- |
| 1 | **Phase 3** | Le push au livreur est le manque le plus criant. Le backend s'écrit sans téléphone. |
| 2 | **D3** | Valide la réception réelle des notifications. Demande un téléphone Android. |
| 3 | **D5** | Une CI n'a de sens qu'avec des tests, et ils existent maintenant. |
| 4 | **Phase 5** | Les reçus sont ce que le client a demandé le plus explicitement. |
| 5 | **D6, D7** | Avant le premier vrai utilisateur, pas après. |
| 6 | **Phase 4** | Attend les villes et transporteurs réels. |
| 7 | **Phase 6** | Attend le mode de tarification. |
| 8 | **Phase 7** | Traduire en dernier : traduire des écrans qui bougent encore, c'est le faire deux fois. |

---

## Bloc D — Dette qui bloque la mise en service

*Rien ici n'ajoute de fonctionnalité. Tout y empêche de livrer à un vrai client.*

- [x] **D1 — `/health` interroge vraiment la base** · ½ j
  - `internal/handlers/sante.go` — sonde Postgres et Redis **en parallèle**,
    délai de 2 s, et **nomme** le service en défaut. Un 503 nu obligerait à
    deviner lequel des deux est tombé.
  - Le message d'erreur brut n'est jamais repris : `/health` est public et
    l'erreur de pgx contient l'utilisateur, la base et l'hôte.
  - Cache d'une seconde : l'endpoint n'est pas authentifié, sans lui le
    marteler reviendrait à marteler la base.
  - **`/health/live` ajouté** : répond 200 tant que le processus tourne. Les
    deux questions n'ont pas la même conséquence — un orchestrateur qui
    redémarre le service parce que Postgres est tombé ne répare rien. `/health`
    sur la sonde de *readiness*, `/health/live` sur celle de *liveness*.
  - *Vérifié* : 8 tests (`sante_test.go`), dont la panne simulée sans arrêter
    les conteneurs ; deux mutations (feu vert de principe, fuite de l'erreur
    brute) font bien échouer les tests. Et en vrai : `docker stop
    fiyen-postgres` → 503 nommant postgres, redis toujours vert, liveness à 200.

- [x] **D2 — Renommer `clients` → `destinataires`** · 1 j
  - Migrations `0006` (table, colonnes, index, rôle) et `0007` (l'expéditeur
    d'un message masqué). Renommage complet : table, colonnes, rôle
    utilisateur, rôle dans le canal masqué, types des 5 fronts, scripts.
  - **Compatibilité des jetons en circulation** :
    `middleware.Claims.normaliser()` reprend l'ancien claim `client_id` et
    l'ancien rôle `client`. Fait en un seul endroit plutôt que dans chaque
    handler — un `switch` qui aurait oublié un cas aurait renvoyé un 403 à un
    utilisateur légitime, et le défaut ne serait apparu qu'au déploiement.
    `GenererToken` n'émet **jamais** l'ancien claim : le réémettre prolongerait
    la transition indéfiniment.
  - **À retirer** une fois les 30 jours de vie des jetons de renouvellement
    écoulés : `ClientIDHerite`, `roleClientHerite`, `normaliser()` et
    `test-jeton-herite.mjs`.
  - Le dossier `app-client/` garde son nom : le renommer casserait les chemins
    et les `node_modules` sans rien apporter.
  - *Vérifié* : `go test ./...` (dont 5 tests de compatibilité JWT), les 5
    `tsc` et les 4 builds, `test-refresh` 19/19, `test-partenaires` 39/39,
    `test-commandes` 34/34, `test-masquage-ui` 21/21, `test-jeton-herite` 6/6.
    Schéma vérifié en base : plus aucune table ni colonne `client`.

- [ ] **D3 — Faire tourner l'app Expo sur un appareil réel** · 1–2 j
  - **Étape de validation, pas un prérequis.** Tout le backend des
    notifications s'écrit et se teste sans téléphone ; ce qui exige un
    appareil, c'est de voir une notification *arriver*. Ne pas considérer la
    Phase 3 close avant.
  - Le bundle se construit et le manifeste est correct, mais le suivi en
    arrière-plan — sa seule raison d'être — n'est pas vérifié.
  - Il faut un *development build* (`npx expo run:android`) ; Expo Go ne suffit pas.
  - Renseigner l'IP LAN dans `EXPO_PUBLIC_API_URL` et l'ajouter à `CORS_ORIGINS`.
  - À vérifier en priorité : le verrou anti-rotation-concurrente du
    renouvellement est **en mémoire**. Si Android relance la tâche de
    localisation dans un contexte JS distinct, deux rotations pourraient se
    croiser et le serveur y verrait un vol de jeton — donc une déconnexion.
  - *Fait quand* : écran éteint, 15 min, les positions arrivent en base.

- [x] **D4 — Planifier la purge des sessions expirées** · ½ j
  - `auth.PurgerPeriodiquement` tourne en arrière-plan : passage au démarrage
    puis toutes les `PURGE_INTERVALLE_HEURES` (24 par défaut). Attendre le
    premier intervalle sur un service redémarré souvent reviendrait à ne
    jamais purger.
  - **Verrou consultatif Postgres** dans la transaction de suppression :
    l'hébergement visé est scalable horizontalement, et sans lui chaque
    instance referait le même travail au même moment.
  - **Défaut trouvé et corrigé pendant la vérification** : `PURGE_INTERVALLE_HEURES=0`
    faisait paniquer `time.NewTicker` et tomber l'API au démarrage. Repli sur
    24 h avec trace au journal — un service qui ne démarre pas parce que le
    ménage est mal réglé est un bien plus gros problème que le ménage.
  - *Vérifié* : 9 tests (`internal/auth/purge_test.go`), dont ce qu'elle
    **épargne** — sessions vivantes, expirées d'hier, révoquées d'hier. Trois
    mutations (condition trop large, verrou neutralisé, pas de passage au
    démarrage) font échouer les tests. `-race` propre. Et en vrai : 2 sessions
    vieillies supprimées, la récente épargnée, passage journalisé.

- [x] **D5 — Intégration continue** · 1 j *(`.github/workflows/ci.yml`)*
  - Deux travaux : le backend (Postgres **PostGIS** + Redis en services,
    migrations, `gofmt`, `go vet`, `go test -race`) et les fronts (matrice des
    5 projets, `npm ci`, types, build).
  - `FIYEN_TESTS_INTEGRATION=1` : sans lui, les tests d'intégration s'ignorent
    quand la base manque et la CI passe au vert sans rien vérifier. C'est
    arrivé en local pendant 3.4 — ça n'aurait pas été visible ici.
  - `-race` : plusieurs handlers publient en goroutine (notifications,
    évènements, purge). Une course y est invisible sans le détecteur.
  - **Défaut trouvé en vérifiant la CI, et bien plus large qu'elle** :
    `npx tsc --noEmit` ne vérifiait **rien**. Le `tsconfig.json` de ces projets
    Vite déclare `"files": []` et délègue à des *project references* ; sans
    `-b`, `tsc` ne compile rien et rend 0 quoi qu'il arrive. J'ai utilisé cette
    commande toute la session en croyant valider les fronts. Corrigé en
    `tsc -b --noEmit`, et les 5 fronts passent la vraie vérification.
  - *Vérifié* : chaque barrière attrape une régression introduite exprès —
    fichier mal formaté, code qui ne compile pas, test cassé, erreur de type.
    `npm ci --dry-run` passe sur les 5 projets (aucun lock désynchronisé), et
    toute la chaîne backend tourne sans fichier `.env`, comme en CI.

> **Non vérifié** : le workflow n'a jamais tourné sur GitHub — il n'y a pas eu
> de push. Chaque commande a été éprouvée localement dans les conditions de la
> CI, mais la première exécution réelle reste à observer.

- [ ] **D6 — Déploiement et TLS** · 2–3 j
  - *Fait quand* : les 5 fronts et l'API répondent en HTTPS sur un domaine.

- [ ] **D7 — Sauvegarde de la base** · 1 j
  - *Fait quand* : une restauration a été testée, pas seulement une sauvegarde.

- [ ] **D8 — Jetons de design dupliqués dans 5 projets** · 1 j
  - Le code de session est recopié à l'identique lui aussi.
  - *Fait quand* : un seul fichier de jetons, importé par les 5.

---

## Phase 3 — Notifications · 4 j

- [x] **3.1 — Table `jetons_push` + enregistrement du jeton Expo** *(`0008`)*
  - `POST` / `DELETE /api/notifications/jeton`, ouverts à tous les rôles
    authentifiés : le livreur en a besoin en premier, un partenaire voudra
    suivre ses commandes de la même façon.
  - **Unicité sur le jeton, pas sur le couple.** Un téléphone réinstallé ou
    prêté garde son jeton Expo : sans réattribution, l'ancien porteur
    continuerait de recevoir les courses du nouveau.
  - Format validé avant la base : une application mal configurée se voit tout
    de suite, plutôt qu'au premier envoi raté.
  - *Vérifié* : 5 tests Go d'intégration + `scripts/test-notifications.mjs`
    (10/10). Trois mutations — réattribution retirée, filtre de suppression
    retiré, validation retirée — font échouer les tests.
  - **Défaut corrigé au passage** : `AllowMethods` du CORS ne listait pas
    `DELETE`. L'annulation d'invitation ajoutée en Phase 1 aurait été bloquée
    par le navigateur au pré-vol, sans que le serveur voie rien.
- [~] **3.2 — Push au livreur à l'assignation**
  - [x] **Côté serveur** : `internal/notifications` (interface + client Expo)
        et `handlers/notifier.go`. Contrat repris de la documentation Expo :
        lots de 100 max, verdicts rendus dans l'ordre des messages.
  - [x] **L'envoi ne bloque pas l'assignation** : il part dans une goroutine
        avec son propre contexte. Le contexte de la requête ne convient pas —
        Fiber l'annule dès la réponse envoyée. Mesuré : assignation en 54 ms
        alors que l'appel Expo suit derrière.
  - [x] **Ménage des appareils perdus** : un verdict `DeviceNotRegistered`
        supprime le jeton. Un échec passager (débit dépassé, message trop
        gros) n'y touche pas — supprimer priverait le livreur de toutes ses
        notifications suivantes pour un incident sans lendemain.
  - [x] Une réponse Expo de longueur incohérente est **refusée** plutôt
        qu'interprétée : associer un verdict au mauvais jeton ferait supprimer
        celui d'un livreur en service.
  - [ ] **Côté application mobile** : demander la permission, obtenir le jeton
        Expo et l'enregistrer. C'est du code Expo, à écrire en lisant la doc
        v57 — et cela ne se vérifie qu'avec **D3**.
  - *Vérifié* : 8 tests du client Expo contre un faux service, 5 tests du
    branchement en base, `-race` propre. Trois mutations — suppression trop
    large, incohérence acceptée, découpage retiré — font échouer les tests.
    Et contre le **vrai service Expo** : un jeton bidon a bien reçu
    `DeviceNotRegistered` et a été oublié automatiquement.
- [x] **3.3 — Notifications in-app au partenaire aux étapes clés**
  - Canal WebSocket `/ws/partenaire/evenements` sur Redis pub/sub, **un canal
    par entreprise** : un partenaire suit toutes ses livraisons depuis le même
    écran, s'abonner commande par commande multiplierait les abonnements.
  - **Complète le sondage à 20 s, ne le remplace pas** : sur un réseau qui
    vacille la socket tombe, et c'est le sondage qui rattrape.
  - **La règle de visibilité s'applique au canal.** Un collaborateur en
    visibilité « personnelle » ne voit pas passer les commandes de ses
    collègues — sans ce filtrage, le temps réel contournerait la règle
    appliquée aux listes. La portée est **relue à la connexion**, pas prise du
    jeton : un jeton vit trente minutes, le réglage a pu changer depuis.
  - L'auteur d'une commande sert au filtrage côté serveur mais **ne parvient
    jamais au front**.
  - Côté écran : bandeaux empilés en bas, `aria-live="polite"`, un état par
    icône *et* par teinte. Le rechargement passe par une prop plutôt qu'un
    remontage — remonter recréerait la carte Leaflet et sa socket de position.
  - *Vérifié* : 6 tests Go (`internal/evenements`, `-race` propre) et
    `scripts/test-evenements.mjs` 11/11, dont le cloisonnement entre
    entreprises et les deux sens de la visibilité. Une mutation qui ouvre la
    visibilité fait échouer le test.
- [x] **3.4 — Choix du canal selon le coût** *(`internal/notifications/politique.go`)*
  - **Table explicite** (évènement × cible) plutôt qu'une règle éparpillée
    dans les handlers : ce qui coûte de l'argent doit se lire d'un coup d'œil
    et se modifier à un seul endroit. Un couple absent ne déclenche **rien** —
    ajouter une notification est une décision, pas un effet de bord.
  - Livreur et partenaire : push seul, ils sont équipés. Destinataire :
    **exactement deux SMS**, « en route » (se rendre disponible) et « livrée »
    (clôt l'échange). Les étapes intermédiaires ne changent rien pour lui et
    coûteraient un SMS chacune.
  - **Garde-fou dans l'envoyeur, pas chez l'appelant** : un handler qui
    oublierait la vérification enverrait des SMS hors budget. Le fournisseur
    n'est même pas sollicité si la politique refuse — vérifier après coup
    aurait déjà coûté le message.
  - `SMSNonConfigure` **échoue explicitement**, comme le repli PSTN du
    masquage : un envoi silencieusement avalé ferait croire que le
    destinataire a été prévenu.
  - *Vérifié* : 8 tests, et quatre mutations attrapées — garde-fou retiré, SMS
    supplémentaire glissé dans la table, SMS au livreur, couple livreur retiré
    (ce dernier casse l'envoi réel, pas seulement la table).

> **Il n'existe aucune passerelle SMS dans ce projet.** La politique est prête
> et bornée, mais rien ne part : brancher un opérateur couvrant le Burkina Faso
> et **vérifier son coût unitaire réel** avant d'élargir la table. Le point 3.6
> (notifications au destinataire) en dépend.
- [x] **3.5 — Préférences par partenaire** *(`0009_preferences_notification.sql`)*
  - **Les préférences ne peuvent que restreindre**, jamais élargir : un
    partenaire qui pourrait s'accorder des canaux contournerait le plafond de
    SMS de la politique, et la facture ne se verrait qu'après. Une étape sans
    canal prévu est affichée mais **non modifiable** — plutôt qu'absente, pour
    qu'on puisse constater qu'elle existe et ne concerne pas.
  - **Table des exclusions, pas des activations.** Le défaut est « on
    prévient » : stocker les activations aurait exigé d'écrire une ligne par
    évènement à la création de chaque partenaire, et un oubli aurait rendu
    quelqu'un silencieusement sourd. Ici, ligne absente = prévenir, ce qui est
    aussi le comportement en cas de panne de lecture.
  - La préférence est lue **dans la requête de publication** : une seconde
    lecture coûterait un aller-retour pour un réglage qui ne change presque
    jamais, et pourrait tomber sur un état différent.
  - Lecture ouverte au collaborateur, écriture réservée au compte principal :
    un collaborateur qui couperait les annonces rendrait ses collègues sourds
    sans qu'ils l'aient demandé.
  - Côté écran : une bascule où le **mot** double la position du curseur —
    une bascule qui ne repose que sur la position demande de comparer deux
    lignes pour savoir laquelle est active.
  - *Vérifié* : `scripts/test-preferences.mjs`, dont l'effet réel d'une
    coupure sur le canal d'évènements.
- [ ] **3.6 — *(reportable)* Notifications au destinataire**

---

## Phase 4 — Livraisons hors ville (relais transporteur) · 6 j

🔒 *Attend du client : les villes et transporteurs réellement utilisés, et si
les frais transporteur sont avancés puis refacturés ou payés directement.*

- [ ] **4.1 — Migrations `transporteurs`, `agences`**
- [ ] **4.2 — `courses` + type, transporteur, agences, bordereau, frais**
- [ ] **4.3 — Statuts étendus** : `deposee_agence` → `en_transit` → `arrivee_agence`
- [ ] **4.4 — Choix « en ville » / « autre ville » à la commande**
- [ ] **4.5 — Numéro de bordereau saisi par le livreur au dépôt**
- [ ] **4.6 — État « en transit » sans carte**
  - Assumer le trou de suivi : le colis est dans un car, personne ne le suit.
    Mieux vaut le dire que simuler une position.
- [ ] **4.7 — Bascule « arrivé à l'agence » depuis le dashboard + notification**
- [ ] **4.8 — Retrait : nom du réceptionnaire à l'agence**

---

## Phase 5 — Reçus, preuve de livraison et traçabilité · 5 j

🔒 *Attend du client : quels documents papier remplacer exactement.*

- [x] **5.1 — Migration `evenements_course`** (journal horodaté) *(`0010`)*
  - **Immuable par la base, pas par convention** : un trigger refuse tout
    `UPDATE`. Une convention de code ne survit pas au premier script de
    correction lancé à la main, et un journal qu'on peut réécrire ne prouve
    rien.
  - La **suppression** reste permise : la cascade depuis `courses` en a besoin,
    et la rétention (5.8) aussi. Ce qui compte pour une preuve, c'est qu'un
    évènement ne soit pas *altéré*.
  - Le rôle de l'auteur est **recopié**, pas joint : un compte peut changer de
    rôle, et le journal doit dire ce qui était vrai à l'instant de l'action.
  - Branché aux quatre points de changement d'état, **dans la transaction** :
    l'évènement et le changement tombent ou passent ensemble.
  - Une écriture de journal qui échoue **ne fait pas échouer la livraison** :
    perdre une ligne de trace est moins grave que bloquer le livreur.
- [x] **5.2 — Migration `traces_positions`** en append-only *(`0010`)*
  - `positions_livreurs` écrase à chaque envoi : elle dit « où est le livreur
    maintenant », pas « par où est-il passé ».
  - Rattachée au **livreur** et non à la course : au moment où une position
    arrive, le livreur peut n'avoir aucune course, et retrouver la course
    courante coûterait une requête toutes les trois secondes. Le trajet se
    reconstitue en croisant avec les bornes de `evenements_course` — 5.1 sert 5.2.
  - Index **unique** sur `(livreur_id, horodatage)` : l'app mobile réémet un
    lot après une coupure, et un doublon ferait un aller-retour fantôme sur le
    tracé. Vérifié en rejouant un lot : 3 points, 3 horodatages.
  - *Vérifié* : 7 tests Go, dont l'immuabilité — retirer le trigger fait
    échouer le test. Et en vrai : le journal du jeu de démonstration montre
    `creee → assignee` avec le rôle de l'auteur.

> **Le volume rendra la rétention (5.8) nécessaire plus vite que « reportable »
> ne le suggère** : un livreur en service 8 h à une position toutes les 4 s
> produit ~7 000 lignes par jour. Vingt livreurs, c'est 4 millions de lignes
> par mois.
- [x] **5.3 — Reçu imprimable** (`@media print`), numéroté par compagnie
  - Le numéro court `FY-1042` **est** la référence : aucune numérotation propre
    au reçu, qui obligerait à demander « lequel des deux ? » à chaque appel.
  - Deux audiences, un seul chargement : `GET /api/courses/:id/recu`
    (compagnie, **avec** le livreur) et `GET /api/commandes/:id/recu`
    (partenaire, **sans**). Le retrait se fait à un seul endroit
    (`chargerRecu`), celui qu'on relit quand on doute.
  - Le titre suit l'avancement — « Bon de commande » avant la livraison, « Reçu
    de livraison » après : appeler « reçu » un colis pas encore parti serait
    faux sur un papier qu'on classe.
  - **Aucun montant**, ici comme ailleurs (voir 6.5).
  - Générique et volontairement pauvre : à reprendre quand le client aura dit
    quels documents papier il remplace.
  - Tests : 5 tests Go (cloisonnement, masquage, journal, absence de montant),
    `test-recu.mjs` (23, parcours complet contre l'API),
    `test-recu-ui.mjs` (42, les deux applications en média « print », PDF à
    l'appui).
- [ ] **5.4 — Variante interurbaine du reçu** 🔒 *dépend de la Phase 4*
- [x] **5.5 — Preuve de livraison** : signature ou photo + nom du réceptionnaire
  - **Découplée du passage à « livrée »** : la course se clôt d'abord, la
    preuve part ensuite et attend dans une file locale si le réseau lâche.
    Conditionner la clôture à la montée d'une image laisserait un livreur
    bloqué devant un portail.
  - **Tout est facultatif.** Un écran qui ne prend pas le tracé, un appareil
    photo qui refuse de démarrer : le colis a quand même été remis. Exiger la
    preuve ne la ferait pas apparaître, elle créerait une incitation à la
    fabriquer.
  - **Une par course, immuable** (`preuves_livraison`, trigger `UPDATE`) : une
    pièce qu'on peut réécrire ne prouve rien. Un second dépôt rend 409.
  - `capture_le` (la porte) est distinct de `created_at` (le serveur). Une date
    *future* est ignorée : une horloge déréglée ferait dater la signature de
    demain sur un document imprimé.
  - Image bornée à **512 Ko**, allowlist MIME, redimensionnement côté appareil
    à 1024 px / JPEG 0,7. Elle voyage **hors du reçu** : jointe, elle serait
    retéléchargée à chaque ouverture.
  - Le partenaire et le destinataire y ont accès, **jamais au nom du livreur**.
  - Tests : 13 tests Go, `test-recu.mjs` (37), `test-remise-ui.mjs` (15 — le
    tracé au doigt jusqu'aux pixels réellement peints en base).
- [x] **5.6 — Lien partageable par WhatsApp**
  - **Un seul jeton par course, réutilisé tant qu'il est valide** — pas
    empilé à chaque clic sur « Partager » : `liens_partages_recu`, table
    dédiée, 90 jours de validité. Contrairement au jeton de renouvellement, il
    n'est **pas haché** : sa portée est un reçu en lecture seule, pas un
    compte, et il doit pouvoir être ressorti tel quel pour la réutilisation.
  - **La page publique (`GET /r/:jeton`) est rendue en HTML côté serveur**,
    pas en JSON — celui qui l'ouvre n'a pas d'application. `html/template`
    plutôt qu'une concaténation : c'est le seul document du produit dont le
    contenu (adresses, noms) est injecté directement dans du HTML servi à un
    inconnu, l'échappement automatique n'est pas négociable.
  - **La garantie de masquage s'applique sans condition de rôle** : la page
    réutilise `chargerRecu(..., avecLivreur=false)`, comme le reçu du
    partenaire — quel que soit qui a généré le lien, compagnie comprise.
  - **`wa.me/?text=...` sans numéro de destinataire** : la plateforme ne
    connaît que `telephone_hash`, jamais le numéro en clair. C'est la personne
    qui partage qui choisit le contact depuis son propre téléphone.
  - Un jeton inconnu et un jeton expiré rendent le **même** 404 : les
    distinguer n'apprendrait rien à quelqu'un qui devine.
  - Tests : 7 tests Go, `test-partage-ui.mjs` (14, les deux applications,
    `window.open` espionné plutôt qu'une vraie navigation vers wa.me).
  - **Mutation trouvée pendant la vérification** : le contrôle d'appartenance
    de la course pour la génération côté compagnie n'avait pas de test
    dédié — une compagnie quelconque pouvait générer le lien de n'importe
    quelle course. `TestLienPartage_UneAutreCompagnieNePeutPasEnGenererUn`
    comble le trou.
  - **Dette découverte en cours de route, corrigée** : `dashboard/vite.config.ts`
    était le seul des 4 projets sans port fixe (`strictPort`) — un port 5173
    déjà pris a fait glisser le dashboard sur celui d'un projet sans rapport,
    en silence. Alignée sur les trois autres.
- [x] **5.7 — Rejeu du trajet sur la carte**
  - **`traces_positions` n'est pas rattachée à la course, mais au livreur** :
    le trajet se reconstitue en croisant deux sources — le livreur assigné
    (une course a un seul livreur, jamais réassigné une fois « assignee ») et
    les bornes temporelles du journal (`assignee` → `livree`/`annulee`).
  - **Aucune identité de livreur n'y circule** : un point GPS n'est jamais
    nommé, la même donnée sert donc aux deux audiences (compagnie et
    partenaire) sans variante `avecLivreur`.
  - Épingles de départ/arrivée reprises depuis `courses.point_depart` /
    `point_arrivee` **quand elles ont été posées** — facultatives, comme
    partout ailleurs dans la commande.
  - **Chargement différé** : le bouton « Voir sur la carte » ne récupère le
    trajet qu'au clic, pas à l'ouverture du reçu — la plupart des consultations
    n'en ont pas besoin.
  - **Scope volontairement limité aux deux apps authentifiées** (dashboard,
    app-partenaire), pas à la page publique partagée (5.6) : Leaflet + tuiles
    coûteraient des données sur une page pensée pour être légère sur un
    téléphone quelconque, et le journal y porte déjà les horodatages en texte.
  - Tests : 7 tests Go (fenêtre temporelle, cloisonnement par livreur et par
    partenaire, épingles facultatives), `test-trajet-ui.mjs` (13 — dépôt de
    positions réel, rendu Leaflet vérifié dans les deux apps, bascule
    affiche/masque).
  - **Dette découverte en vérifiant, sans rapport avec ce point** : les tuiles
    CARTO gratuites (`basemaps.cartocdn.com`, utilisées par les 3 cartes du
    produit) affichent désormais un filigrane « API KEY REQUIRED ». Visible
    sur les captures de `test-trajet-ui.mjs`, pas introduit par ce point —
    signalé en dette plus bas.
- [x] **5.8 — Politique de rétention des traces** *(`0013`, `internal/tracking/retention.go`)*
  - **Passé de « reportable » à fait** : ~7 000 lignes par livreur et par jour,
    quatre millions par mois pour vingt livreurs — la table aurait été le
    premier poste de la base.
  - Positions de plus de **90 jours** supprimées (`TRACES_RETENTION_JOURS`),
    passage au démarrage puis toutes les `PURGE_INTERVALLE_HEURES`. Le journal
    et les preuves ne sont **pas** concernés : ce sont des pièces, pas de la
    télémétrie.
  - **Suppression par lots de 20 000** : le premier passage sur une table déjà
    grosse ne doit pas tenir des millions de lignes d'un seul tenant. D'où un
    verrou consultatif **de session** (et non `_xact_lock` comme pour les
    sessions) : il doit couvrir tous les lots, pas une seule transaction.
  - **Une durée nulle ou négative est refusée** : `now() - 0` viderait la table.
    Une variable d'environnement mal réglée ne doit pas pouvoir effacer le
    trajet de tous les livreurs — repli sur 90 jours, dit au journal.
  - Index `idx_traces_horodatage` : l'index unique existant sert le rejeu par
    livreur, pas une purge par âge.
  - **Conséquence produit** : le rejeu d'un trajet (5.7) d'une course de plus de
    90 jours n'a plus de points. Le message de la carte le dit.
  - Tests : 9 (`retention_test.go`), dont ce qu'elle **épargne** de part et
    d'autre de la frontière. Six mutations font échouer les tests (borne
    décalée, un seul lot, garde de durée, verrou non pris, verrou non relâché).

---

## Phase 6 — Récapitulatifs et facturation · 5 j

🔒 *Attend du client : le mode de tarification — forfait, distance, ou abonnement.*

- [ ] **6.1 — `GET /api/recapitulatifs`** (filtres période / partenaire / collaborateur)
- [ ] **6.2 — Les 4 chiffres** + comparaison au mois précédent
- [ ] **6.3 — Export CSV**
- [ ] **6.4 — API d'écriture pour `config_tarifaire`**
- [ ] **6.5 — Prix par course** 🔒 *question ouverte*
  - `config_tarifaire` porte un abonnement et une commission, pas un tarif par
    course. L'app partenaire n'affiche donc aucun prix — inventer un chiffre
    serait pire que de n'en montrer aucun.
- [ ] **6.6 — Table `factures` + génération mensuelle**
- [ ] **6.7 — Encours par partenaire** + statuts + relance
- [ ] **6.8 — Référence de transaction mobile money au règlement**
- [ ] **6.9 — Numérotation séquentielle sans trou**
  - Même mécanique que `compagnies.compteur_courses` : incrément dans la
    transaction, ligne verrouillée.
- [ ] **6.10 — *(reportable)* Envoi automatique de la facture**

---

## Phase 7 — Anglais · 3 j

- [ ] **7.1 — `src/i18n/fr.ts` et `en.ts` + hook `useT()`** (sans bibliothèque)
- [ ] **7.2 — Extraction des chaînes des 5 interfaces**
- [ ] **7.3 — Sélecteur de langue + préférence par utilisateur**
- [ ] **7.4 — Formats de date et de montant (XOF)**

---

## Ce qu'on attend du client

| Question | Bloque | Contournement en place |
| --- | --- | --- |
| Mode de tarification : forfait, distance, ou abonnement ? | 6.4, 6.5 | Aucun prix affiché à la commande |
| Quels documents papier remplacer exactement ? | Phase 5 | — |
| Frais transporteur : avancés puis refacturés, ou payés directement ? | 4.2, Phase 6 | — |
| Villes et transporteurs réellement utilisés | Phase 4 | — |
| Part du hors-ville dans l'activité | Ordre des phases 4 et 5 | — |
| Visibilité d'un collaborateur : ses courses ou toutes ? | ~~Phase 1~~ | ✅ Réglage en base, par partenaire, défaut « entreprise » |

---

## Journal des phases livrées

<details>
<summary>Phase 0 — Sécuriser l'existant</summary>

- [x] Committer le travail existant *(fait côté utilisateur)*
- [x] **Refresh de JWT** — le jeton expirait en 30 min sans renouvellement
  - Table `sessions_refresh` (jeton haché, rotation, révocation)
  - `POST /api/auth/refresh` + rotation à chaque usage, détection de rejeu
  - `POST /api/auth/deconnexion`
  - Renouvellement transparent, réactif **et** proactif, sur les 5 fronts
  - Testé face à une vraie expiration (`JWT_DUREE_MINUTES=1`)
- [x] **Tests du masquage versionnés** — 42 tests Go + 21 vérifications d'interface
  - Vérifiés par mutation : casser le contrôle d'accès, l'anti-fuite
    d'identité, la revalidation d'expiration ou l'expéditeur fait bien échouer
    les tests correspondants

</details>

<details>
<summary>Phase 1 — Comptes partenaires et collaborateurs</summary>

- [x] Migration `partenaires` (`0004_partenaires.sql`)
- [x] `utilisateurs` + `partenaire_id`, rôles `partenaire` / `collaborateur`
- [x] `courses` + `partenaire_id`, `cree_par`
- [x] API partenaires (créer / lister / suspendre)
- [x] API collaborateurs (invitation par code à 6 chiffres, haché, 5 tentatives)
- [x] `GET /api/mon-partenaire` — sert aussi au collaborateur
- [x] Onglet « Partenaires » au dashboard
- [x] Désactivation sans suppression : l'historique et les factures survivent
- [x] Suspendre coupe les sessions ouvertes

</details>

<details>
<summary>Phase 2 — Commande en autonomie</summary>

Inspirée de l'envoi de colis chez Glovo. **Sans** catalogue, panier ni paiement :
il n'y a ni commerce ni produit dans ce schéma.

- [x] Projet `app-partenaire/` (port 5177)
- [x] Connexion partenaire / collaborateur + activation par code
- [x] Commande en quatre temps : retrait → livraison → colis → récapitulatif
- [x] `POST /api/commandes/` — groupe distinct de `/courses`
- [x] Carnet de destinataires, dérivé de l'historique
- [x] Adresse en texte libre + repère + point sur carte facultatif
- [x] Numéro court `FY-1042`, séquentiel par compagnie
- [x] File des commandes entrantes + compteur au dashboard
- [x] Mode dégradé : brouillon local conservé jusqu'à l'envoi
- [x] Annulation tant qu'aucun livreur n'est assigné
- [x] **Défaut corrigé** : le canal de suivi relayait le `livreur_id` au
      destinataire. La position est désormais anonymisée pour tous sauf la
      compagnie et le livreur lui-même.

</details>
