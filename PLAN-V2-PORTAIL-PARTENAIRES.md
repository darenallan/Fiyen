# Plan V2 — Portail partenaires, reçus et facturation

Demande client recueillie le 11/08/2026, transmise en dictée. Ce document fixe
la lecture du besoin, ce qu'il change dans le produit, et le plan
d'implémentation détaillé.

> **Le seul risque qui compte : que le partenaire retourne au téléphone.**
> Un formulaire trop long, une adresse à ressaisir, un statut qu'il ne voit
> pas — et il rappelle. Chaque arbitrage de ce document se juge là-dessus.

---

## 1. Ce que le client demande

| # | Besoin |
| --- | --- |
| 1 | Ses **partenaires** (entreprises clientes) lancent leurs commandes eux-mêmes, au lieu de téléphoner |
| 2 | Gérer des **comptes collaborateurs** rattachés à ces partenaires |
| 3 | Un **reçu** par livraison, contenant toutes les informations de la course |
| 4 | Des **récapitulatifs mensuels** de toutes les livraisons |
| 5 | **Facturation** envoyée aux partenaires en fin de mois |
| 6 | **Traçabilité** : garder une trace de tout, consultable et exportable |
| 7 | **Notifications** automatiques (ajouté : sans elles, le n°1 ne tient pas) |
| 8 | **Livraisons hors ville** par relais transporteur (car Rahimo & assimilés) |
| 9 | Interface disponible **en anglais** |

**Le vrai problème métier** : la compagnie perd son temps au téléphone à prendre
des commandes, et n'a pas de trace exploitable pour facturer. Tout le reste en
découle.

---

## 2. Ce que ça change dans le produit

CLAUDE.md pose aujourd'hui : *« C'est la compagnie qui crée la course pour le
client. »* **Le besoin n°1 renverse ce principe** : un partenaire crée
lui-même ses courses.

Ce n'est **pas** un virage vers une marketplace — il n'y a toujours ni
catalogue, ni panier, ni checkout. C'est l'ajout d'un **portail
professionnel** : un client B2B récurrent (pharmacie, boutique, bureau) commande
en autonomie et reçoit une facture mensuelle. Le positionnement B2B est
renforcé, pas abandonné.

Conséquence sur les rôles. Aujourd'hui : `compagnie`, `livreur`, `client`.
Demain il faut distinguer :

- **partenaire** — l'entreprise cliente (personne morale, facturée)
- **collaborateur** — un employé du partenaire, qui commande en son nom
- **destinataire** — celui qui reçoit le colis (l'actuel `client`)

Le `client` actuel devient le **destinataire**. C'est un renommage à assumer
tôt : plus on attend, plus il coûte.

---

## 3. Plan d'implémentation

Chaque phase distingue trois niveaux, pour pouvoir réduire la voilure sans
casser la cohérence :

- **Socle** — sans quoi la fonctionnalité n'existe pas
- **Ce qui fait la différence** — ce qui empêche le retour au téléphone
- **Peut attendre** — utile, mais reportable sans dommage

---

### Phase 0 — Sécuriser l'existant  ·  ~1 j

Prérequis. Sans ça, on construit sur du sable.

- **Committer le travail existant** — le dépôt n'a que ses 2 commits d'origine.
- **Refresh de JWT.** Le jeton expire en 30 min sans renouvellement : un
  collaborateur perdrait sa session en pleine saisie de commande, un livreur en
  pleine course.
- **Versionner les tests du masquage** (39 assertions aujourd'hui non
  rejouables). Les phases suivantes touchent aux rôles et à l'autorisation :
  sans filet, on casse la garantie centrale du produit sans s'en apercevoir.

---

### Phase 1 — Comptes partenaires et collaborateurs  ·  ~4 j

#### Socle

```sql
partenaires     id, compagnie_id, nom, adresse, contact, actif, created_at
utilisateurs    + partenaire_id, + rôles 'partenaire' | 'collaborateur'
courses         + partenaire_id, + cree_par (utilisateur_id)
```
Renommer `clients` → `destinataires` dans la foulée.

- `POST/GET/PATCH /api/partenaires` (compagnie) — créer, lister, désactiver
- `POST /api/partenaires/:id/collaborateurs` — inviter
- `GET /api/partenaires/me` (partenaire/collaborateur)
- Onglet « Partenaires » au dashboard compagnie

#### Ce qui fait la différence

- **Invitation par numéro de téléphone**, pas par e-mail : beaucoup de
  collaborateurs n'ont pas d'adresse professionnelle. Code à 6 chiffres.
- **Désactivation, jamais suppression.** Un collaborateur qui part garde son
  historique — sinon les récapitulatifs passés deviennent faux.

#### Peut attendre

- **Plafonds par collaborateur** : « 5 courses par jour », ou validation du
  gérant au-delà d'un montant. Besoin B2B classique, et ça rassure le patron
  qui ouvre des accès à ses employés.

---

### Phase 2 — Commande en autonomie  ·  ~7 j

**Le cœur de la demande.** C'est ce qui supprime les appels.

#### Socle

- Nouvelle interface `app-partenaire/` (React + Vite, charte Fiyen).
- Écran de création de course : destinataire, point de retrait, note.
- `POST /api/courses` ouvert au rôle partenaire, rattaché automatiquement à son
  `partenaire_id`.
- Côté compagnie : file des courses entrantes à assigner.

#### Ce qui fait la différence

- **Carnet de destinataires.** Une pharmacie livre aux mêmes cliniques chaque
  semaine. Si elle doit retaper l'adresse à chaque fois, elle rappellera.
  Destinataires enregistrés + bouton **« refaire cette livraison »** en deux
  clics : c'est ça qui fidélise à la plateforme.
- **Adresse en texte libre + champ « repère » + point sur carte en option.**
  À Ouagadougou on dit « derrière la station Total de Gounghin », pas
  « 12 rue X ». Un formulaire *rue / ville / code postal* ferait échouer la
  saisie — c'est l'erreur la plus coûteuse de cette phase.
- **File des commandes entrantes visible** côté compagnie : badge, compteur,
  signal sonore. Le jour où les partenaires commandent seuls, quelqu'un doit
  les voir arriver — sinon les commandes dorment et la confiance s'effondre en
  une semaine.
- **Numéro de course court** (`FY-3042`). Les gens s'appelleront encore parfois ;
  un UUID est impossible à dicter au téléphone.
- **Mode dégradé** : brouillon local si le réseau coupe pendant la saisie, envoi
  à la reconnexion. Même logique que le cache de positions déjà en place côté
  livreur.

#### Peut attendre

- **Commande groupée** : 8 colis un matin = 8 formulaires aujourd'hui. Import ou
  saisie multiple. Deviendra vite indispensable si le volume monte.
- **Créneau souhaité** : « à récupérer avant 11 h ».

---

### Phase 3 — Notifications  ·  ~4 j

Remontée volontairement avant les reçus : **sans elle, la phase 2 perd son
intérêt.** Le partenaire commande, personne ne bouge, il rappelle.

#### Socle

- **Push Expo au livreur à l'assignation d'une course.** La plus importante de
  toutes : sans elle, toute la chaîne est cassée.
- Notification in-app au partenaire aux étapes clés.

#### Ce qui fait la différence

- **Hiérarchiser par canal selon le coût.** Le SMS est le canal fiable au
  Burkina Faso, mais il se paie au message. Donc : push quand l'app est
  installée (gratuit), **SMS réservé à deux événements** — course assignée au
  livreur, colis livré au partenaire — WhatsApp en voie intermédiaire.
- Préférences de notification par partenaire, et regroupement pour ne pas
  saturer.

#### Peut attendre

- Notifications au destinataire (il a déjà le suivi en direct).

---

### Phase 4 — Livraisons hors ville (relais transporteur)  ·  ~5 j

Le colis quitte Ouagadougou par car (Rahimo, TCV, STAF…). Le livreur le dépose
à l'agence de départ ; le destinataire le retire à l'agence de sa ville. **Ce
n'est pas de la sous-traitance de livraison** : aucune autre société ne fait du
porte-à-porte, c'est un simple relais.

Placée ici parce qu'elle a besoin des notifications (prévenir le destinataire
d'aller retirer) et qu'elle détermine la forme du reçu (phase 5).

#### Socle

```sql
transporteurs   id, nom, actif
agences         id, transporteur_id, ville, adresse, telephone
courses         + type ('locale' | 'interurbaine')
                + transporteur_id, agence_depart_id, agence_arrivee_id
                + numero_bordereau, frais_transporteur
```

**Parcours étendu pour une course interurbaine :**

```text
en_attente → assignee → recuperee → deposee_agence
           → en_transit → arrivee_agence → livree
```

- À la commande, le partenaire choisit **« en ville »** ou **« vers une autre
  ville »**. S'il choisit la seconde, il sélectionne la ville de destination et
  l'application propose les transporteurs qui la desservent.
- Le livreur, à l'étape **dépôt**, saisit le **numéro de bordereau** remis par
  l'agence. C'est le pivot de toute la traçabilité de cette phase : sans lui,
  plus rien n'est suivable une fois le colis dans le car.
- Le destinataire reçoit **transporteur, agence de retrait, numéro de bordereau
  et horaires d'ouverture**.

#### Ce qui fait la différence

- **Assumer explicitement le trou de suivi.** Pendant le trajet en car, il n'y a
  aucune position GPS. Si l'écran laisse une carte figée, le client appelle —
  exactement ce qu'on cherche à éviter. Il faut un état dédié qui dit clairement
  « votre colis voyage, arrivée prévue à telle agence », sans carte.
- **Marquer l'arrivée à l'agence.** Quelqu'un doit basculer le statut quand le
  car arrive. Le plus simple : la compagnie le fait depuis le dashboard, et la
  notification part automatiquement au destinataire.
- **Le retrait est une remise comme une autre** : le destinataire signe ou son
  nom est saisi à l'agence, comme pour une livraison classique.

#### Peut attendre

- Répertoire complet des agences et horaires par ville. Commencer avec les
  villes réellement desservies (Bobo-Dioulasso, Koudougou, Ouahigouya…) plutôt
  qu'un annuaire exhaustif.
- Rapprochement automatique du bordereau avec le transporteur, si l'un d'eux
  expose un jour une API — aucun ne le fait aujourd'hui.

---

### Phase 5 — Reçus, preuve de livraison et traçabilité  ·  ~6 j

#### Socle

- **Journal de course** : horodatage de chaque changement de statut (table
  `evenements_course`) — qui a créé, qui a assigné, qui a changé quoi, et quand.
  Aujourd'hui seul `updated_at` existe, donc un reçu ne peut rien détailler.
- **Historique des positions** : `positions_livreurs` a `livreur_id` en clé
  primaire — une seule ligne, écrasée à chaque envoi. Table `traces_positions`
  en append-only.
- **Reçu** : numéro séquentiel par compagnie, généré à la livraison. Course,
  partenaire, collaborateur émetteur, destinataire, adresses, horodatages des
  5 étapes, livreur. Impression via `@media print` plutôt qu'une bibliothèque
  PDF — plus léger, et suffisant.
- Pour une course **interurbaine**, le reçu porte en plus le transporteur,
  l'agence de retrait et le **numéro de bordereau**.

#### Ce qui fait la différence

- **Preuve de livraison.** Un reçu sans preuve n'est qu'un papier. Signature sur
  l'écran du livreur ou photo du colis remis, **plus le nom de qui a
  réceptionné**. C'est ce qui tranche un litige — et c'est probablement ce que
  « dématérialiser les bons de livraison » voulait dire.
- **Lien partageable par WhatsApp** plutôt qu'un PDF en pièce jointe : le PDF ne
  sera pas ouvert, le lien le sera dix fois plus.
- **Rejeu du trajet** sur la carte : « montre-moi le chemin qu'a pris le
  livreur » règle un litige en dix secondes.

#### Peut attendre

- **Politique de rétention.** Une position toutes les 4 s × 20 livreurs × 10 h
  fait beaucoup de lignes : détail fin sur 30 jours, puis tracé simplifié.
  À prévoir avant que le volume ne devienne un problème, pas dès le premier jour.

---

### Phase 6 — Récapitulatifs et facturation  ·  ~6 j

#### Socle

- `GET /api/recapitulatifs?debut=&fin=&partenaire_id=&collaborateur_id=`
- Export **CSV** (pas Excel : lisible partout, aucune dépendance).
- Table `factures` (partenaire, période, lignes, total, statut).
- **API d'écriture pour `config_tarifaire`** : la table existe mais le barème
  s'insère aujourd'hui en SQL.

#### Ce qui fait la différence

- **Le récapitulatif n'est pas une liste, c'est quatre chiffres** : nombre de
  courses, montant total, part livrée dans les temps, collaborateur le plus
  actif. **Et la comparaison au mois précédent** — c'est ce qui le rend utile
  plutôt que décoratif. La liste détaillée vient après.
- **Le suivi de paiement compte plus que la facture elle-même.** Générer un PDF
  est facile ; ce dont il a besoin, c'est **l'encours par partenaire** : qui lui
  doit combien, depuis quand. Statuts émise → envoyée → payée → **en retard**,
  avec bouton de relance.
- **Référence de transaction mobile money** (Orange Money / Moov) enregistrée au
  règlement. Ça boucle le cycle sans intégrer le paiement, pour un coût quasi nul.
- **Numérotation séquentielle et sans trou** : sinon la facture ne vaut rien
  fiscalement.

#### Peut attendre

- Envoi automatique de la facture par e-mail/WhatsApp en fin de mois.

> Le **paiement en ligne** reste hors périmètre. La facture est émise ; le
> règlement se fait hors plateforme, comme aujourd'hui.

---

### Phase 7 — Anglais  ·  ~2 j

**Ce n'est pas une traduction, c'est un segment de marché.** Ouagadougou
concentre ONG, ambassades et organisations internationales — exactement le type
de partenaire qui commande régulièrement, exige des factures propres et
travaille en anglais. Vu ainsi, cette phase est un argument commercial, pas une
finition.

- Extraction des chaînes dans `src/i18n/fr.ts` et `en.ts`. **Pas de
  bibliothèque** : un dictionnaire typé et un hook `useT()` suffisent pour deux
  langues et évitent 40 Ko de dépendance sur un réseau lent.
- Sélecteur de langue au profil, préférence stockée par utilisateur.
- Formats de date et de montant (XOF).
- **Ne pas traduire les adresses** : les noms de lieux restent en français.

---

## 4. Informations que tu as déjà et qu'il me faudra

Ces points sont tranchés côté client, mais je ne les ai pas. À me transmettre au
moment d'attaquer la phase concernée :

| Information | Nécessaire pour |
| --- | --- |
| Un collaborateur voit-il ses propres courses seulement, ou toutes celles de son entreprise ? | Phase 1 |
| Mode de tarification : forfait par course, distance, ou abonnement ? | Phase 6 |
| Quels documents papier exactement remplacer ? | Phase 5 (preuve de livraison) |
| Les frais du transporteur sont-ils avancés par la compagnie puis refacturés, ou payés directement par le partenaire ? | Phase 4 et 6 |
| Quelles villes et quels transporteurs sont réellement utilisés aujourd'hui ? | Phase 4 |

Le point « service de transport partenaire » est désormais compris et planifié
en phase 4 : il s'agit du relais par car, pas d'une sous-traitance de livraison.

---

## 5. Ordre recommandé et charge

```text
Phase 0  Sécuriser l'existant      1 j   ──► indispensable
Phase 1  Comptes                   4 j   ──► socle
Phase 2  Commande en autonomie     7 j   ──► LE bénéfice attendu
Phase 3  Notifications             4 j   ──► sans quoi la phase 2 ne tient pas
Phase 4  Livraisons hors ville     5 j   ──► selon la part du hors-ville
Phase 5  Reçus + traçabilité       6 j   ──► socle de la facturation
Phase 6  Récap + factures          6 j   ──► le second bénéfice
Phase 7  Anglais                   2 j   ──► quand les écrans sont stables
                                  ────
                                   35 j
```

**Chemin le plus court vers de la valeur démontrable : phases 0 → 1 → 2 → 3,
soit ~16 jours** pour que les partenaires arrêtent de téléphoner et que les
livreurs soient prévenus.

**Où placer la phase 4 dépend d'un chiffre que je n'ai pas** : la part des
livraisons hors ville. Si elle est importante, il faut la remonter juste après
la phase 2 — sinon les partenaires continueront d'appeler pour ces courses-là,
et le bénéfice sera à moitié perdu.

En ne gardant que le **socle** de chaque phase (sans les colonnes « ce qui fait
la différence »), on descend autour de 20 jours — mais on prend le risque que
les partenaires reviennent au téléphone, ce qui viderait le projet de son sens.
Les lignes « ce qui fait la différence » sont là pour être défendues, pas
sacrifiées en premier.
