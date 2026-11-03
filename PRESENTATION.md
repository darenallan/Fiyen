# Fiyen — dossier de présentation client

> À lire avant la démo. Tout ce qui est marqué **✅ testé en local** a été
> exécuté sur cette machine le 21/10/2026, et **le script de la section 5 a
> été rejoué de bout en bout dans le navigateur** (commande FY-1014 : commande
> → assignation → étapes livreur → message → signature → reçu → trajet). Rien n'a encore tourné **en réel**
> (pas de serveur en ligne, pas de vrai téléphone de livreur sur le terrain).
> Les positions GPS de la démo sont **simulées** par un script.

---

## 1. Le pitch

### En trois phrases

1. Les compagnies de livraison de Ouagadougou coordonnent encore leurs livreurs
   au téléphone, sans savoir où ils sont ni garder de trace exploitable.
2. Fiyen leur donne, sans qu'elles aient à développer quoi que ce soit, un
   tableau de bord qui voit toute la flotte en direct, une application pour
   leurs livreurs, et un portail où leurs entreprises clientes commandent
   elles-mêmes.
3. Le numéro du livreur n'est jamais donné au client : ils échangent par une
   messagerie masquée, ce qui protège le livreur et empêche le contournement de
   la compagnie.

### Le problème

- **Pas de visibilité** : la compagnie ne sait pas où sont ses livreurs, donc
  ne peut ni estimer un délai ni répondre à un client qui appelle.
- **Le téléphone mange la journée** : chaque commande d'un client régulier
  (pharmacie, boutique, bureau) arrive par appel, et se ressaisit à la main.
- **Le numéro personnel du livreur circule** : le client négocie en direct et
  court-circuite la compagnie, le livreur est exposé au harcèlement, et en cas
  de litige il n'y a aucune trace.
- **Aucun historique** : pas de preuve de livraison, pas de chiffres pour
  piloter ni pour facturer.

### La solution

Une plateforme en ligne (SaaS) **louée** par la compagnie. Elle ne remplace pas
la compagnie et ne vend rien au public : **ce n'est pas une marketplace**
(pas de catalogue, pas de panier, pas de paiement en ligne). C'est l'outil de
travail de la compagnie.

### La cible

| | Qui | Ce qu'il obtient |
| --- | --- | --- |
| **Client payant** | Compagnie de livraison (de la petite structure à la PME) | Le tableau de bord, la flotte en direct, l'historique |
| Utilisateur | Livreur de la compagnie | Une app simple : ses courses, ses étapes, la messagerie |
| Utilisateur | **Partenaire** = entreprise cliente de la compagnie (pharmacie, boutique) et ses **collaborateurs** | Commander sans téléphoner, suivre, récupérer le reçu |
| Utilisateur | **Destinataire** = la personne qui reçoit le colis | Suivre l'arrivée, écrire au livreur sans échanger de numéro |

**Modèle économique** (cahier des charges) : abonnement mensuel par compagnie
(dashboard + nombre de livreurs inclus) **+** commission par course livrée.
Le barème n'est **pas fixé** : il se décide avec les premières compagnies
pilotes.

### Pourquoi Fiyen gagne

Huit arguments, chacun **montré** pendant la démo (étape du §5) et appuyé par
des tests. La phrase « à dire » est écrite pour un patron de compagnie de
Ouagadougou : courte, concrète, sans jargon.

| Argument | Ce qu'on montre | Ce qu'on dit | Preuve |
| --- | --- | --- | --- |
| **Suivi en temps réel** | Étape 1 : la carte de flotte, les livreurs qui bougent (positions simulées en démo, à dire) ; étape 5 : le point du livreur chez la destinataire. | « Vous savez où sont vos gars sans les appeler, et votre client aussi. » | Tests Go du suivi ; cloisonnement par compagnie testé |
| **Masquage des numéros** | Étape 5 : Awa et le livreur s'écrivent, aucun numéro à l'écran, pas de bouton d'appel. | « Votre client ne peut plus appeler votre livreur en direct pour se passer de vous. » | 42 tests Go + 21 vérifications à l'écran |
| **Portail partenaire autonome** | Étapes 2 et 3 : la pharmacie commande seule en 4 étapes, la commande tombe dans « Entrantes ». | « Vos clients réguliers commandent eux-mêmes : vous arrêtez de passer la journée au téléphone. » | `test-commandes` 34/34, `test-commande-ui` 10/10 |
| **Barème versionné** | Étape 2 : le prix s'affiche avant l'envoi ; étape 8 : changer un prix, l'historique s'allonge. | « Vous fixez vos prix, le client les voit avant de commander, et personne ne peut dire après coup qu'on lui avait annoncé autre chose. » | 17 tests Go + `test-commande-ui` |
| **Preuve de livraison** | Étape 6 : le livreur fait signer sur l'écran ; étape 7 : la signature et le nom sur le reçu. | « En cas de "je n'ai rien reçu", vous sortez la signature et l'heure. » | `test-remise-ui` 15/15 (compte les pixels de la signature en base) |
| **Journal infalsifiable** | Étape 7 : le déroulé horodaté du reçu (commande, assignation, récupération, livraison). | « Personne ne peut modifier l'historique après coup, même pas nous. » | Tests Go : la base refuse toute modification |
| **Statistiques patron + export** | Étape 8 : délais, taux de réussite, par livreur, par client, comparaison avec le mois dernier, fichier Excel. | « Vous voyez qui travaille bien, quel client compte, et si vous allez plus vite que le mois dernier. » | 7 tests Go ; écran vérifié |
| **Mode dégradé du livreur** | Étape 2 : recharger la page en pleine commande, le brouillon est toujours là. Sur le terrain, les positions sont gardées dans le téléphone pendant une coupure. | « Quand le réseau coupe, rien n'est perdu : ça repart tout seul quand il revient. » | Brouillon : vérifiable en démo. File de positions : testée en local, **pas encore sur un vrai réseau 3G** |

**Comparaison honnête avec « WhatsApp + cahier »**, l'outil actuel de la
plupart des compagnies :

| | WhatsApp + cahier | Fiyen |
| --- | --- | --- |
| Prendre une commande | Appel ou message, recopié à la main | Le client commande seul ; numéro court |
| Savoir où est le livreur | L'appeler | La carte, en direct |
| Numéro du livreur | Donné au client | Jamais communiqué |
| Preuve de livraison | La parole du livreur | Signature ou photo, horodatée |
| Prix | Négocié à chaque fois, oublié ensuite | Barème publié, prix figé sur la commande |
| Chiffres du mois | À recompter dans le cahier | Calculés, comparés, exportables |
| Ce que WhatsApp fait mieux | **Gratuit**, déjà installé partout, rien à apprendre | Demande un abonnement et une prise en main ; reste utile pour partager le reçu |

**Ce qu'il ne faut pas revendiquer** : la voix masquée, les SMS, le paiement
mobile money, l'attribution automatique, la facturation mensuelle et l'app
Android sur téléphone ne sont **pas** faits (voir §6). Ne comparer Fiyen à
aucun concurrent nommé : ce n'est pas une marketplace, c'est l'outil de la
compagnie, qui garde ses clients et sa marque.

---

## 2. Les applications, par rôle

Cinq interfaces, toutes en français, un seul serveur.

| Application | Pour qui | Adresse en démo |
| --- | --- | --- |
| Dashboard compagnie | la compagnie | http://localhost:5173 |
| App partenaire | l'entreprise cliente et ses collaborateurs | http://localhost:5177 |
| App livreur (web, installable) | le livreur | http://localhost:5175 |
| App destinataire | la personne qui reçoit | http://localhost:5176 |
| App livreur Android (Expo) | le livreur | téléphone — **jamais testée sur appareil** |

### Dashboard compagnie — ✅ testé en local

- **Accueil** : compteurs de courses par statut (en attente, en cours, livrées,
  annulées), barre de répartition, état de la flotte, abonnement Fiyen.
- **Statistiques** *(nouveau)* : délai d'attente avant départ du colis, durée
  du trajet, délai total (médianes et moyennes, depuis le journal horodaté),
  taux de réussite et d'annulation, activité par livreur et par client,
  montant livré, **comparaison avec les mêmes jours du mois précédent**,
  définition de chaque chiffre, **export CSV** pour Excel.
- **Tarifs** *(nouveau)* : la compagnie fixe ses prix (forfait, par zones de
  distance, ou au kilomètre), voit l'aperçu calculé, publie. Chaque
  publication est une version datée et non modifiable : l'historique est le
  journal des changements de prix.
- **Courses** : créer une course (commande reçue au téléphone), filtrer,
  **assigner** à un livreur disponible, ouvrir le **reçu** (impression,
  partage WhatsApp, **rejeu du trajet** sur la carte).
- **Commandes entrantes** : la file des commandes passées par les partenaires,
  avec un compteur dans le menu ; assignation en un clic.
- **Flotte** : la **carte en temps réel**, la présence réelle
  (« en ligne » = a envoyé une position depuis moins de 30 s), ajout d'un livreur.
- **Partenaires** : créer une entreprise cliente, la suspendre, inviter ses
  collaborateurs (code à 6 chiffres), régler qui voit quoi.

### App partenaire — ✅ testé en local

- **Commander en 4 étapes** guidées : retrait → livraison → colis →
  récapitulatif. Adresse en texte libre + repère (« portail bleu après la
  boutique »), épingle sur la carte **facultative**, carnet des destinataires
  déjà servis. Brouillon conservé si le réseau coupe.
- Chaque commande reçoit un **numéro court** dictable au téléphone (`FY-1012`).
- **Suivi en direct** : étapes, carte, annonces en bas d'écran à chaque
  changement de statut.
- **Reçu** imprimable, lien WhatsApp, rejeu du trajet. Le partenaire ne voit
  **jamais le nom du livreur**.
- **Profil** : gestion des collaborateurs, préférences de notification.
- Annulation possible tant qu'aucun livreur n'est assigné.
- **Prix annoncé** *(nouveau)* au récapitulatif, d'après le barème publié par
  la compagnie, et **figé sur la commande**. Sans barème, ou sans les épingles
  qu'il demande, l'écran dit « prix à confirmer » plutôt que d'inventer.
- Point de retrait **pré-rempli** avec l'entreprise *(nouveau)*.

### App livreur (web) — ✅ testé en local

- Prendre / terminer son service.
- Liste de ses courses, bouton de l'étape suivante : *J'ai récupéré le colis →
  Je pars en livraison → Colis livré*.
- **Itinéraire** vers le point de retrait puis de livraison (ouvre Google Maps
  sur l'adresse) — testé automatiquement (`test-itineraire-ui.mjs`, 7/7).
- **Envoi GPS** toutes les 4 s, économe (pas de renvoi sous 15 m), **file
  locale** de 300 positions si le réseau coupe, renvoyées à la reconnexion.
- **Remise** : nom du réceptionnaire + signature au doigt ou photo, sur un seul
  écran. Facultative ; si le réseau lâche, elle attend et part plus tard.
- Messagerie masquée avec le destinataire.

### App destinataire — ✅ testé en local

- Suivi de la livraison en cours : étapes + **carte en direct** du colis.
- Messagerie masquée avec le livreur (**pas de bouton d'appel**, volontairement).
- Historique de ses commandes.

### App livreur Android (Expo) — ⚠️ construite, jamais lancée sur un téléphone

Elle existe pour le GPS **en arrière-plan** (écran éteint) et, depuis le
22/10, pour les **notifications push** (« nouvelle course assignée »). Le code
se compile, la logique push est testée en simulation (9 tests), mais personne
ne l'a vue tourner sur un appareil, et le push demande encore un compte Expo
(voir §13). **Ne pas la montrer comme fonctionnelle.**

---

## 3. Architecture, expliquée simplement

```
  Dashboard ─┐
  Partenaire ┤                       ┌── PostgreSQL + PostGIS (les données, la carte)
  Livreur ───┼── HTTPS / WebSocket ──┤
  Destinat. ─┘      API en Go        └── Redis (positions en direct, diffusion)
```

- **Un seul serveur (API)**, écrit en **Go** : rapide, peu gourmand, un seul
  fichier à déployer. Il porte toutes les règles (qui a le droit de voir quoi,
  quelles étapes sont permises).
- **PostgreSQL + PostGIS** : la base de données de référence, avec l'extension
  géographique.
- **Redis** : le « standard téléphonique » du temps réel. Une position de
  livreur y est publiée, et tous les écrans qui la suivent la reçoivent
  aussitôt par WebSocket. Le cahier des charges demande moins de 5 s entre le
  GPS et l'écran ; l'envoi se fait toutes les 4 s (pas encore mesuré de bout
  en bout sur un vrai réseau mobile).
- **Interfaces web en React** : elles s'ouvrent dans n'importe quel navigateur,
  y compris sur des téléphones d'entrée de gamme, sans passer par un store.
- **App Android en Expo** : le même langage que le reste (TypeScript), mises à
  jour sans repasser par le Play Store.

### Choix qui comptent pour ce marché

| Choix | Pourquoi |
| --- | --- |
| App livreur **web d'abord**, Android ensuite | Le parc de téléphones économiques : la web app marche partout, sans store |
| **Économie de données** | Pas de position renvoyée si le livreur n'a pas bougé de 15 m ; listes rafraîchies toutes les 20 s, pas plus |
| **Mode dégradé** | Positions gardées sur le téléphone en cas de coupure, renvoyées ensuite ; brouillon de commande conservé |
| **Adresse en texte + repère** | À Ouaga, l'adresse utile est verbale ; exiger une épingle bloquerait les quartiers mal cartographiés |
| **Numéro court `FY-1042`** | Se dicte au téléphone ; propre à chaque compagnie (ne révèle pas le volume d'une autre) |
| **Journal infalsifiable** | Chaque étape (qui, quand) est écrite dans un journal que la base elle-même refuse de modifier |
| **Multi-compagnies** | Chaque compagnie ne voit que ses données — cloisonnement testé |

### Sécurité

- Numéro de téléphone **jamais stocké en clair** (empreinte SHA-256) et jamais
  transmis au client.
- **Messagerie masquée** : seules les deux extrémités d'une course y accèdent —
  la compagnie elle-même n'y a pas accès ; elle se ferme à la fin de la course.
- **Sessions** : jeton de 30 min + jeton de renouvellement de 30 jours,
  révocable, avec détection de vol (un jeton réutilisé coupe toute la session).
- **Contrôle d'accès par rôle** sur chaque route ; un partenaire ne voit jamais
  la course d'un concurrent servi par la même compagnie (testé).
- **Limitation de débit** sur la connexion (10 tentatives / minute / adresse).
- TLS (HTTPS) : **prévu au déploiement**, pas encore en place (tout tourne en
  local).

---

## 4. Lancer la démo

### Avant le rendez-vous (10 min)

1. **Démarrer Docker Desktop** et attendre qu'il soit prêt. Si la commande
   `docker` ne répond plus (c'est arrivé le 21/10) mais que
   http://localhost:8090/health dit « ok », inutile d'y toucher : Postgres et
   Redis tournent. Sinon : quitter Docker Desktop, le relancer.
2. Dans un terminal (Git Bash), à la racine du projet :

```bash
cd backend && docker compose up -d && go run ./cmd/migrate && go run ./cmd/api
```

   Laisser ce terminal ouvert (l'API écoute sur le port 8090).
   Vérifier : http://localhost:8090/health doit afficher `"statut":"ok"`.

3. Quatre autres terminaux, un par interface :

```bash
cd dashboard      && npm run dev   # http://localhost:5173
cd app-partenaire && npm run dev   # http://localhost:5177
cd app-livreur    && npm run dev   # http://localhost:5175
cd app-client     && npm run dev   # http://localhost:5176
```

4. Recharger les données de démo (efface **uniquement** les comptes de démo) :

```bash
node backend/scripts/seed-demo.mjs --reset
```

5. Lancer le simulateur GPS (fait rouler Aminata et Issouf dans Ouaga) et le
   laisser tourner pendant toute la démo :

```bash
node backend/scripts/simuler-flotte.mjs
```

6. **Attendre une minute** avant de se connecter : le seed et le simulateur
   consomment presque tout le quota de 10 connexions par minute. Se connecter
   tout de suite peut afficher « trop de requêtes ».
7. **Fermer tous les anciens onglets Fiyen**, puis ouvrir **4 onglets** dans
   une fenêtre propre et se connecter à l'avance sur chacun — voir comptes
   ci-dessous. Le `--reset` supprime les comptes de démo, donc toutes les
   sessions ouvertes avant : un ancien onglet resté ouvert se déconnecte et
   peut déconnecter avec lui le nouvel onglet de la même application (même
   stockage navigateur). **Toujours : reset d'abord, connexions ensuite.**
   Pour l'app livreur et l'app destinataire, réduire la fenêtre à la largeur
   d'un téléphone (ou F12 → mode appareil).

### Comptes de démo

Mot de passe commun : **`motdepasse123`**. Tous les noms et numéros sont fictifs.

| Rôle | Téléphone | Situation au départ |
| --- | --- | --- |
| Compagnie « Fiyen Démo » | `+22670001000` | ~120 courses sur deux mois (historique **généré pour la démo**), barème par zones publié, 2 en attente, 2 en cours |
| Partenaire « Pharmacie du Progrès » | `+22670001004` | historique de commandes |
| Collaboratrice Mariam Kaboré (pharmacie) | `+22670001005` | a passé des commandes |
| Livreur Salif Traoré | `+22670001001` | une course assignée (Gounghin → Cité An III) |
| Livreuse Aminata Zongo | `+22670001002` | **en route** vers Ouaga 2000 (simulée) |
| Livreur Issouf Sawadogo | `+22670001006` | **disponible** — c'est lui qu'on assigne en direct |
| Livreur Boukary Compaoré | `+22670001007` | hors service |
| Destinataire Awa Ouédraogo | `+22670001003` | a une course en cours avec Salif |

---

## 5. Script de démo pas à pas (≈ 15 min)

> Fil rouge : **la Pharmacie du Progrès commande une livraison pour Awa, la
> compagnie l'assigne, le livreur la porte, tout le monde suit, et il reste un
> reçu.**

### Étape 1 — Le tableau de bord de la compagnie (1 min 30)

*Onglet Dashboard, compte `+22670001000`.*

- Montrer l'accueil : compteurs, répartition, flotte.
  > « Voici ce que voit le patron de la compagnie en arrivant le matin. »
- Menu **Flotte** : la carte. Aminata et Issouf **bougent**.
  > « Chaque point est un livreur en service. La position se met à jour toutes
  > les 4 secondes. Ici les positions sont simulées, puisque nos livreurs de
  > démo ne roulent pas vraiment ; sur le terrain, c'est le GPS du téléphone. »
- Montrer Boukary « hors ligne » : la présence est **réelle**, pas déclarée.

### Étape 2 — Le partenaire commande lui-même (3 min)

*Onglet App partenaire, compte `+22670001004`.*

- > « La pharmacie est cliente régulière de la compagnie. Avant, elle
  > téléphonait. Maintenant elle commande ici. »
- **Commander une livraison** :
  1. *Retrait* : il est **déjà rempli** (« Pharmacie du Progrès », repère
     « Face à la station, enseigne verte ») — « une saisie de moins à chaque
     commande ». Toucher la carte au centre de Ouaga pour poser l'épingle, en
     disant qu'elle est **facultative** (mais qu'elle permet d'annoncer le
     prix).
  2. *Livraison* : **Reprendre un destinataire** → **Awa Ouédraogo** (nom,
     adresse et repère se remplissent). **Retaper le téléphone**
     `+22670001003` :
     > « Le numéro n'est jamais conservé en clair, même pour le carnet :
     > on le ressaisit. »
  3. *Colis* : la description habituelle est reprise toute seule.
     **Recharger la page (F5)**, puis rouvrir **Commander une livraison** :
     tout ce qui a été saisi est revenu.
     > « Quand le réseau coupe, on ne retape rien. »
  4. *Tout est bon ?* → le **prix de la course** s'affiche (1 000 F CFA si
     l'épingle de retrait est proche de la pharmacie, davantage si elle est
     posée loin) :
     > « C'est le barème que la compagnie a publié. Le prix est figé sur la
     > commande : si la compagnie change ses tarifs demain, cette commande
     > garde le sien. »
     Si l'épingle de retrait n'a pas été posée, l'écran dit « prix à
     confirmer » : c'est voulu, on n'invente pas un chiffre.
     Puis **Envoyer la commande**.
- Noter le **numéro court** (`FY-10xx`) : « il se dicte au téléphone ».
- L'écran de suivi affiche « Reçue — votre compagnie cherche un livreur ».

### Étape 3 — La compagnie assigne (1 min)

*Onglet Dashboard.*

- Le compteur du menu **Entrantes** a augmenté. Ouvrir la file (une commande
  plus ancienne, créée par le jeu de démo, y est aussi : la laisser). Le prix
  annoncé au partenaire y figure.
- Sur la nouvelle commande, choisir **Issouf Sawadogo** → **Assigner**.
  > « Un clic. Le partenaire voit l'étape changer. »
- Revenir à l'onglet partenaire : l'étape est passée à « Livreur assigné »
  (annonce en bas d'écran).

### Étape 4 — Le livreur (2 min)

*Onglet App livreur, compte `+22670001006` (Issouf), fenêtre étroite.*

- À la demande d'accès à la position, cliquer **Bloquer** : sur ce PC, la
  position d'Issouf vient du simulateur. (Si on autorise, le point sauterait
  entre la position du PC et celle simulée.)
  > « Sur son téléphone, c'est son vrai GPS. »
- Onglet **Courses** : montrer la course, puis **Itinéraire vers le retrait
  (A)** (ouvre Google Maps ; fermer l'onglet).
- **J'ai récupéré le colis**, puis **Je pars en livraison**.

### Étape 5 — Le destinataire suit et écrit (2 min)

*Onglet App destinataire, compte `+22670001003` (Awa), fenêtre étroite.*

- L'écran **Suivi** montre « Votre colis arrive », étape 4 sur 5, et le point
  du livreur sur la carte.
- Plus bas, bloc **Votre livreur** → écrire « Je suis au portail bleu » →
  **Envoyer**.
- Revenir à l'app livreur → **Contacter le client** : le message est arrivé,
  répondre.
  > « Aucun numéro n'a été échangé. Le livreur ne connaît pas le numéro d'Awa,
  > Awa ne connaît ni son numéro ni son nom. La conversation se ferme à la fin
  > de la course. Et même la compagnie ne la lit pas. »

### Étape 6 — Livraison et preuve (1 min)

*App livreur.*

- **Colis livré** → écran de remise : nom « Awa Ouédraogo », **signer**
  dans le cadre (à la souris en démo) → **Confirmer la livraison**. La course
  quitte la liste du livreur.
  > « La preuve est facultative : si le réseau coupe, la livraison est
  > enregistrée quand même et la preuve part plus tard. »

### Étape 7 — Le reçu et la traçabilité (2 min)

*App partenaire : l'écran de suivi affiche « Livrée » → **Voir le reçu**.*

- Montrer le reçu : numéro, adresses, **journal horodaté** de chaque étape,
  signature. **Pas de nom de livreur** côté partenaire.
- **Voir sur la carte** : le trajet rejoué en pointillés.
- Citer sans cliquer : le reçu se partage par WhatsApp et s'imprime sur une
  page.
- Côté Dashboard → Courses → la même course → **Reçu** : ici, le livreur est
  nommé. « Chacun voit ce qu'il doit voir. »

### Étape 8 — Le patron pilote ses chiffres et ses prix (2 min)

*Onglet Dashboard.*

- Menu **Statistiques** : courses du mois, taux de réussite, attente avant
  départ du colis, durée du trajet, avec la flèche de tendance.
  > « Comparé aux mêmes jours du mois dernier, pas au mois entier : sinon on
  > croirait toujours à une baisse. »
  Ouvrir un « Comment c'est calculé » : chaque chiffre a sa définition.
  **Dire que l'historique de la démo a été généré** (deux mois fictifs) ;
  sur une vraie compagnie, ce sont ses courses.
- Citer sans cliquer le bouton **Exporter en CSV (Excel)** : le fichier
  s'ouvre d'un double-clic.
- Menu **Tarifs** : passer la zone « jusqu'à 8 km » de 1 500 à 1 750, motif
  « Hausse du carburant », **Publier ce barème**. L'historique s'allonge.
  > « Une version publiée ne se modifie plus. Le jour où un partenaire
  > conteste un prix, on sait quel barème était en vigueur. »

### Conclusion (30 s)

> « Tout ce que vous venez de voir tourne aujourd'hui sur mon ordinateur. La
> prochaine étape, c'est de le mettre en ligne et de le faire rouler avec une
> compagnie pilote et deux ou trois de ses livreurs. »

---

## 6. Où en est le projet — statut honnête

Légende : **✅ testé en local** (tests automatisés + écrans) · **🟡 partiel**
· **⛔ non fait** · **🔒 attend une réponse du client**.
Rien n'est encore **testé en réel** (production, terrain, vrais téléphones).

### Fait

| Fonction | Statut | Preuve |
| --- | --- | --- |
| Connexion par rôle (compagnie, livreur, partenaire, collaborateur, destinataire) | ✅ | tests de sessions 19/19 |
| Courses : création, assignation manuelle, étapes, annulation | ✅ | tests commandes 34/34 |
| Suivi temps réel (dashboard, partenaire, destinataire) | ✅ | tests Go d'intégration |
| Mode dégradé du livreur (file locale, reconnexion) et brouillon de commande | ✅ | code + tests ; jamais éprouvé sur un vrai réseau 3G |
| Messagerie masquée (texte) | ✅ | tests Go + vérifications à l'écran |
| Portail partenaire + collaborateurs + invitations | ✅ | tests partenaires 39/39 |
| Commande en autonomie, carnet, numéro court | ✅ | tests commandes 34/34 |
| Annonces en direct au partenaire | ✅ | tests évènements 11/11 |
| Préférences de notification | ✅ | tests 19/19 |
| Reçu imprimable, preuve de livraison, lien WhatsApp, rejeu du trajet | ✅ | tests reçu, remise, partage, trajet |
| Journal infalsifiable + rétention des traces GPS (90 j) | ✅ | tests Go |
| Itinéraire Google Maps dans l'app livreur | ✅ | `test-itineraire-ui.mjs` 7/7 |
| Barème modifiable par la compagnie, prix annoncé et figé à la commande | ✅ | 17 tests Go (calcul + intégration) ; `test-commande-ui.mjs` 10/10 |
| Statistiques de pilotage + export CSV | ✅ | 7 tests Go ; vérifié à l'écran (sur un historique **généré** pour la démo) |
| Accessibilité : contraste AA et libellés sur 11 écrans | ✅ | audit automatisé `AUDIT=1` : 0 défaut ; fonds en dégradé non couverts par l'audit |
| Cartes chargées à la demande | ✅ | −34 à −39 % de JavaScript au premier écran (mesuré) |
| Parcours de démo complet (section 5, étapes 1 à 7) | ✅ | rejoué à la main dans Chrome le 21/10 ; écrans de l'étape 8 vérifiés le 22/10, publication d'un barème testée par l'API |

### Partiel

| Fonction | Ce qui manque |
| --- | --- |
| 🟡 Notifications push au livreur | Le serveur envoie (vérifié contre le vrai service Expo) ; l'app Android s'enregistre (testé en simulation, 9 tests) ; **jamais reçu sur un téléphone**, demande un compte Expo |
| 🟡 Appel vocal masqué | La signalisation est en place ; il manque la voix côté écran. **Aujourd'hui : texte uniquement** |
| 🟡 App Android native | Construite, bundle vérifié le 22/10, **jamais lancée sur un téléphone** |
| 🟡 Abonnement Fiyen (ce que la compagnie paie à la plateforme) | Affiché en lecture ; pas d'écran pour le modifier (inséré en base) |

### Pas fait

| Fonction | Quand |
| --- | --- |
| Mise en ligne (serveur, HTTPS, nom de domaine) | Prochaine étape — 2 à 3 jours |
| Sauvegardes de la base | Avec la mise en ligne — 1 jour |
| SMS au destinataire (« en route », « livré ») | Politique prête (2 SMS max par course) ; **aucun opérateur SMS branché** |
| Repli de l'appel masqué par le réseau téléphonique | Prévu avec Africa's Talking, couverture voix BF à vérifier |
| Attribution automatique des courses | Phase 2 |
| Paiement mobile money | Phase 2 |
| Notation livreurs / clients | Phase 2 |
| Livraisons hors ville (relais car / transporteur) | 🔒 attend : villes et transporteurs utilisés |
| Facturation mensuelle (factures, encours, relances) | 🔒 attend : mode de tarification retenu |
| Interface en anglais | Après stabilisation des écrans |
| API publique | Phase 3 |

---

## 7. Questions probables du client

**« Combien ça coûte ? »**
Modèle : abonnement mensuel par compagnie + commission par course livrée. Le
montant n'est pas arrêté **volontairement** : on le fixe avec les premières
compagnies pilotes, selon la taille de leur flotte. Les chiffres affichés dans
la démo (50 000 XOF/mois, 12,5 %) sont **un exemple**, pas une offre. Ne pas
donner de prix ferme en séance : proposer un pilote, puis une grille.

**« Comment le prix d'une course est-il calculé ? »**
C'est la compagnie qui le fixe, dans l'écran Tarifs, au choix : un forfait,
un prix par zone de distance, ou une prise en charge plus un prix au
kilomètre. La distance est mesurée entre les deux épingles posées à la
commande (à vol d'oiseau, multipliée par 1,3 pour approcher la route). Le
partenaire voit le prix avant d'envoyer, et il est figé sur la commande. Sans
épingle, l'écran dit « prix à confirmer » plutôt que d'inventer. Ce qui
manque : la **facture mensuelle**, qui attend que la compagnie ait choisi son
mode de tarification.

**« Quand est-ce que je peux l'utiliser ? »**
La base fonctionnelle est là. Pour un **pilote** : mise en ligne + sauvegardes
(≈ 1 semaine), puis 2 à 4 semaines d'essai avec une compagnie et quelques
livreurs. Les modules demandés en plus (facturation, hors-ville, anglais) sont
estimés à 3–5 semaines, **après** les réponses aux questions de la section 9.
Ne pas promettre de date sans avoir ces réponses.

**« Et si les données sont piratées ? »**
Les numéros ne sont jamais stockés en clair, les sessions sont courtes et
révocables, chaque compagnie est cloisonnée (testé), un partenaire ne voit
jamais les courses d'un concurrent (testé), la connexion est limitée contre les
essais en rafale. Le HTTPS sera actif dès la mise en ligne. Un audit externe
n'a **pas** encore été fait.

**« Le paiement mobile money (Orange Money, Moov Money) ? »**
Prévu en **phase 2**, pas dans la version actuelle. La facturation mensuelle
prévoit de noter la référence de transaction mobile money au règlement.
L'intégration demande un contrat avec un agrégateur ou l'opérateur.

**« Où est-ce hébergé ? »**
Prévu sur un hébergeur cloud (type Render), capable d'ajouter des serveurs
quand le nombre de compagnies augmente. Rien n'est en ligne aujourd'hui. Le
choix final (y compris un hébergement plus proche, en Afrique de l'Ouest) peut
se discuter selon le coût et la latence.

**« Et la maintenance ? »**
Les mises à jour se déploient côté serveur sans intervention des utilisateurs ;
l'app Android pourra se corriger à distance sans repasser par le Play Store.
Une sonde de santé (`/health`) permet de surveiller le service. Le contrat de
maintenance (délai d'intervention, disponibilité) reste à définir.

**« Les livreurs ont des petits téléphones et peu de data. »**
C'est le premier critère de conception : app web qui marche sans store, pas de
position renvoyée si le livreur ne bouge pas, mode hors ligne avec file
d'attente. **À vérifier sur le terrain** : on ne l'a pas encore mesuré sur un
vrai réseau mobile burkinabè.

**« Le livreur peut-il appeler le client ? »**
Pas avec son propre numéro — c'est voulu. Aujourd'hui, ils échangent par
messagerie masquée. L'appel vocal masqué est en cours (phase 2).

**« Le client reçoit-il un SMS ? »**
Pas encore : aucun opérateur SMS n'est branché. La règle est prête (2 SMS
maximum par course, pour maîtriser le coût). Il faut choisir un fournisseur et
vérifier son prix unitaire au Burkina.

**« Et si le réseau coupe pendant une course ? »**
Le livreur continue : ses positions sont gardées sur le téléphone et renvoyées
à la reconnexion ; il peut clôturer la course, la preuve partira plus tard. Le
partenaire garde son brouillon de commande.

**« Pouvez-vous faire l'attribution automatique ? »**
Prévu en phase 2. Aujourd'hui l'assignation est manuelle, en un clic, avec la
présence réelle des livreurs sous les yeux.

---

## 8. Limites connues — et comment en parler

| Limite | Ce qu'il faut dire |
| --- | --- |
| Les positions de la démo sont simulées | « Ce sont des positions simulées pour la démonstration ; le même chemin sert le vrai GPS du téléphone. » — **Ne jamais laisser croire que des livreurs roulent.** |
| Rien n'est en ligne | « La version que je montre tourne en local ; la mise en ligne est la prochaine étape. » |
| App Android jamais testée sur téléphone | Ne pas la montrer. « L'app web livreur est opérationnelle ; la version Android installable est en cours de validation. » |
| Pas de SMS, pas d'appel vocal | « Messagerie texte masquée aujourd'hui ; SMS et voix dépendent d'un opérateur à choisir. » |
| Pas de facturation | « Les prix et les montants livrés sont là ; la facture mensuelle se branche dès qu'on a fixé la tarification ensemble. » |
| Distance « à vol d'oiseau × 1,3 » | « C'est une estimation pour annoncer un prix ; un calcul par la route demanderait un service de cartographie payant. » |
| Historique des statistiques **généré** pour la démo | Le dire. « Ce sont deux mois fictifs pour montrer l'écran ; chez vous, ce seront vos courses. » |
| Un destinataire déjà livré via un partenaire ne peut pas encore créer son compte lui-même | Ne pas faire ce geste en démo. Il faudra une vérification du numéro par SMS pour l'ouvrir sans risque. |
| Fond de carte Esri utilisé sans clé | Bascule faite le 21/10 car CARTO n'affiche plus qu'un filigrane. Pour la production, prendre un fournisseur de tuiles avec contrat. |
| Pas d'audit de sécurité externe | « Sécurité conçue dès le départ et testée ; audit externe à prévoir avant la mise en production. » |

---

## 9. Ce qu'on attend du client

| Question | Ce qu'elle débloque |
| --- | --- |
| Mode de tarification : forfait, zones ou kilomètre ? (les trois sont prêts) | Barème réel de la compagnie, facturation mensuelle |
| Quels documents papier remplacer exactement ? | Format définitif du reçu |
| Frais transporteur : avancés puis refacturés, ou payés directement ? | Livraisons hors ville, facturation |
| Villes et transporteurs réellement utilisés, part du hors-ville | Livraisons hors ville, ordre des chantiers |
| Une compagnie pilote et 2–3 livreurs volontaires | Validation terrain (GPS, réseau, téléphones) |

---

## 10. Plan B si quelque chose plante

| Symptôme | Réaction |
| --- | --- |
| « Trop de requêtes » à la connexion | Attendre 1 minute (quota de 10 connexions / min). En parler comme d'une protection : « c'est l'anti-piratage ». |
| Une page reste blanche ou « Failed to fetch » | Vérifier http://localhost:8090/health. Si rien ne répond : relancer `go run ./cmd/api` dans `backend/`. |
| `/health` dit postgres ou redis en défaut | Docker Desktop s'est arrêté : le relancer, puis `docker compose up -d` dans `backend/`. |
| Les livreurs ne bougent plus sur la carte | Le simulateur s'est arrêté : relancer `node backend/scripts/simuler-flotte.mjs`. Ils réapparaissent en 4 s. |
| La carte est grise sans rues | Pas d'internet (le fond de carte vient d'Internet). Le suivi marche quand même ; montrer les étapes et le journal. |
| La commande `docker` ne répond plus | Si `/health` dit « ok », continuer : rien n'est cassé. Sinon : quitter Docker Desktop (icône → Quit), le relancer, puis `docker compose up -d` dans `backend/`. |
| Le prix affiché est « à confirmer » | Normal sans épingle de retrait : poser l'épingle sur la carte à l'étape Retrait. |
| Les données sont en désordre après une répétition | `node backend/scripts/seed-demo.mjs --reset` (30 s), puis attendre 1 min avant de se connecter. |
| Un onglet est déconnecté | Se reconnecter avec le compte du tableau de la section 4. Si ça recommence : fermer tous les autres onglets de la même application. |
| Issouf n'apparaît pas dans la liste « Choisir un livreur » | Il n'est pas disponible (déjà en course). Rejouer `seed-demo.mjs --reset`, ou assigner un livreur qui l'est. |
| Tout est perdu | Montrer les écrans par captures et dérouler le discours de la section 1 + statut section 6. **Préparer ces captures avant le rendez-vous.** |

**Conseil** : faire une répétition complète avant le client, puis
`seed-demo.mjs --reset` juste avant le rendez-vous.

---

## 11. Tests — comment les rejouer

| Commande | Ce qu'elle vérifie |
| --- | --- |
| `cd backend && FIYEN_TESTS_INTEGRATION=1 go test ./...` | Règles du serveur contre une vraie base et un vrai Redis |
| `node backend/scripts/test-<nom>.mjs` | Parcours complets contre l'API, ou dans Chrome pour les `-ui` |

Les scripts doivent être lancés **un par un, à une minute d'intervalle** :
enchaînés, ils dépassent le quota de connexions et échouent en 429 (c'est la
protection qui marche, pas un bug).

### Résultats du 22/10/2026 (local, régression complète)

| Suite | Type | Résultat |
| --- | --- | --- |
| `go test ./...` avec `FIYEN_TESTS_INTEGRATION=1` | unitaires + intégration Go (vraie base, vrai Redis) | ✅ tout vert, dont 12 + 5 (barème), 5 + 2 (statistiques), 2 (inscription) nouveaux |
| `gofmt` + `go vet` | analyse statique Go | ✅ |
| `tsc -b` sur les 4 fronts web + `tsc` app mobile | types TypeScript | ✅ |
| `npm test` (app-livreur-mobile) | unitaires Node, simulation du push | 9/9 |
| test-masquage-ui | Chrome headless | 21/21 |
| test-refresh | API | 19/19 |
| test-partenaires | API | 39/39 |
| test-commandes | API | 34/34 |
| test-evenements | API + WebSocket | 11/11 |
| test-preferences | API | 19/19 |
| test-notifications | API | 10/10 |
| test-jeton-herite | API | 6/6 |
| test-recu | API | 37/37 |
| test-recu-ui | Chrome headless (média « print », PDF) | 46/46 |
| test-remise-ui | Chrome headless | 15/15 |
| test-partage-ui | Chrome headless | 14/14 |
| test-trajet-ui | Chrome headless (cartes chargées à la demande comprises) | 13/13 |
| test-itineraire-ui *(nouveau)* | Chrome headless | 7/7 |
| test-commande-ui *(nouveau)* | Chrome headless, largeur mobile | 10/10 |
| test-session-longue | API avec jetons d'une minute | non rejoué (demande une API lancée spécialement) |
| `go test -race` (intégration) | détecteur de concurrence | ✅ tous les paquets |

**Total des scripts : 301 vérifications, 0 échec.** Tout est « simulé » ou
« automatisé en local » : rien n'a tourné sur un serveur en ligne ni sur un
vrai téléphone.

---

## 12. Ce qui a changé le 21/10 (non commité)

| Fichier | Changement | Pourquoi |
| --- | --- | --- |
| `backend/scripts/seed-demo.mjs` | Jeu de démo enrichi : 4 livreurs, pharmacie partenaire + collaboratrice, historique livré avec trajets, annulation, courses en cours | Chaque écran avait du contenu vide (pas de partenaire, pas d'historique) |
| idem | Le `--reset` supprime d'abord les courses | Il échouait depuis l'ajout du journal immuable : le trigger refusait la mise à NULL de l'auteur en cascade |
| `backend/scripts/simuler-flotte.mjs` (nouveau) | Positions GPS simulées pour Aminata et Issouf | Une carte de flotte vide en démo |
| 6 composants de carte (dashboard, app-client, app-partenaire) | Fond de carte CARTO → Esri gris clair + couche de noms | CARTO ne renvoie plus qu'un filigrane « API KEY REQUIRED », sans aucune rue |
| `app-livreur/src/EcranLivreur.tsx` | Bouton « Itinéraire » vers A puis B (Google Maps) | Prévu au cahier des charges, absent |
| `backend/internal/handlers/auth.go` + `auth_test.go` | Inscription d'un numéro déjà livré : 409 explicite au lieu d'une erreur 500 | Erreur opaque ; la règle de fond (vérification SMS) reste à faire |
| `backend/scripts/test-partage-ui.mjs` | Port du dashboard 5174 → 5173 | Le dashboard est fixé sur 5173 depuis la phase 5.6 |

Les modifications de `app-livreur-mobile/` (`app.json`, `package.json`,
`package-lock.json` : `expo-build-properties` pour autoriser le HTTP en clair
vers l'IP du PC pendant les essais sur téléphone) existaient **avant** cette
session. Le 22/10, ces fichiers ont été modifiés à nouveau (push, voir
ci-dessous) : l'ancienne modification y est conservée.

### Ajouté les 21-22/10 (passe produit, non commité)

| Domaine | Fichiers |
| --- | --- |
| Barème | `backend/migrations/0014_baremes_livraison.sql` (**à appliquer** : `go run ./cmd/migrate`), `backend/internal/tarifs/`, `backend/internal/handlers/bareme.go` (+ test), `courses_partenaire.go`, `cmd/api/main.go` ; `dashboard/src/pages/Bareme.tsx` ; app partenaire `api.ts`, `EcranCommander.tsx`, `EcranSuivi.tsx`, `partenaire.css` ; dashboard `CommandesEntrantes.tsx`, `types.ts` |
| Statistiques | `backend/internal/stats/`, `backend/internal/handlers/statistiques.go` (+ test) ; `dashboard/src/pages/Statistiques.tsx`, `client.ts` (téléchargement CSV) |
| Push Android | `app-livreur-mobile/src/push.ts`, `src/pushExpo.ts`, `tests/push.test.mjs`, `App.tsx`, `src/api.ts`, `app.json` (plugin), `package.json` (`expo-notifications`, `expo-constants`, script `test`) |
| Finitions et polish | barre de progression (4 `index.css` + `EcranClient.tsx`), cartes chargées à la demande (`PanneauRecu.tsx`, `Livreurs.tsx`, `EcranClient.tsx`, `EcranRecu.tsx`, `EcranCommander.tsx`, `App.tsx` partenaire), contraste et libellés (`CarteFlotte.tsx`, 4 `index.css`), états vides (`Courses.tsx`, `Livreurs.tsx`, `Dashboard.tsx`), retrait pré-rempli (`App.tsx` partenaire) |
| APK et hébergement (22/10) | `app-livreur-mobile/eas.json` (profil `preview`, APK), `app.json` (**projet EAS lié** : `extra.eas.projectId`, `owner`), `src/serveur.ts` + `src/serveurLogique.ts` + `tests/serveur.test.mjs` (adresse du serveur réglable dans l'app), `src/ecrans/Login.tsx`, `src/api.ts`, `src/tracking.ts`, `App.tsx`, `src/push.ts` (FCM absent → « non configuré »), `package.json` (versions Expo alignées) ; `backend/internal/database/redis.go` (+ test : Redis chiffré `rediss://`) ; `HEBERGEMENT.md`. Fichiers locaux non versionnés modifiés : `backend/.env` (CORS et `URL_PUBLIQUE` sur l'IP Wi-Fi), `app-livreur-mobile/.env` (IP Wi-Fi) |
| Démo et outils | `backend/cmd/sql/` (SQL du seed sans Docker), `seed-demo.mjs` (barème d'exemple + 2 mois d'historique), `backend/scripts/outils/capturer.mjs`, `test-itineraire-ui.mjs`, `test-commande-ui.mjs` |

---

## 13. Passe produit des 21-22/10 — avancement

> Reprise le 21/10 vers 23 h après la libération du disque. **Docker Desktop :
> le client `docker` reste figé**, mais Postgres (55020) et Redis (6379)
> répondent : tout fonctionne sans y toucher. Pour le débloquer : quitter
> Docker Desktop (icône de la barre des tâches → Quit), le relancer, puis
> `cd backend && docker compose up -d`. Les données sont conservées.

| Tâche | État | Tests (type) |
| --- | --- | --- |
| 1. Barème (dashboard → « Tarifs ») | ✅ fait, **vérifié à l'écran** (capture headless) | 12 unitaires Go (`internal/tarifs`) + 5 d'intégration Go, vraie base (`bareme_test.go`) |
| 2. Statistiques (dashboard → « Statistiques », export CSV) | ✅ fait, **vérifié à l'écran** avec deux mois d'historique de démo | 5 unitaires Go (`internal/stats`) + 2 d'intégration Go (`statistiques_test.go`) |
| 3. Push dans l'app Android | 🟡 **code fait et testé en simulation ; jamais reçu sur un vrai téléphone** (demande un compte Expo et un téléphone, voir plus bas) | 9 tests Node de la logique (`app-livreur-mobile/tests/push.test.mjs`, `npm test`) ; types OK ; bundle Android construit (1,6 Mo) |
| 4. Finitions | ✅ barre de progression animée par `transform` (4 copies du CSS) ; test du bouton « Itinéraire » | `test-itineraire-ui.mjs` **7/7**, Chrome headless contre l'API locale |
| 5. Passe « effet waouh » | ✅ fait (détail et mesures plus bas) | `test-commande-ui.mjs` **10/10** (Chrome headless, 390 px) ; audit contraste et libellés automatisé (`AUDIT=1`) |
| 6. « Pourquoi Fiyen gagne » + script de démo | ✅ fait (§1 et §5) | — |

**Depuis la reprise :**
- Seed : historique de **111 courses datées du 1er septembre à hier**
  (marquées données de démo dans le script). Deux bugs corrigés : les
  destinataires fictifs créés trop tard, et un type JSONB.
- Statistiques à l'écran : 61 courses en octobre (+39 % sur les mêmes jours
  de septembre), 95 % de réussite, attente avant départ 19 min (médiane),
  trajet 22 min. Textes corrigés (« Du 1er octobre à aujourd'hui »).
- Tarifs à l'écran : libellés des zones placés au-dessus des champs.
- Nouvel outil `backend/scripts/outils/capturer.mjs` : capture une page d'une
  des quatre apps, connectée avec un compte de démo, à la largeur voulue (sert
  aux vérifications visuelles et mobiles). Attention sous Git Bash : écrire le
  chemin sans barre initiale (`tarifs`, pas `/tarifs`), sinon Git Bash le
  transforme en chemin Windows.

**Barème — ce qui existe :**
- Table `baremes_livraison` (migration `0014`, **déjà appliquée sur la base
  locale**) : chaque modification publie une **nouvelle version immuable**
  (le trigger refuse tout `UPDATE`), avec date, rôle de l'auteur et motif.
  L'historique est le journal d'audit.
- Trois modes au choix de la compagnie : forfait, par zones de distance, au
  kilomètre. **Aucune valeur par défaut** : c'est la compagnie qui saisit ses
  prix. La question « quel mode ? » reste ouverte pour le client.
- Distance = vol d'oiseau entre les épingles × coefficient de détour (1,3 par
  défaut, réglable). Sans épingles, en mode zones ou kilomètre, le partenaire
  voit « prix à confirmer », jamais un chiffre inventé.
- Le prix est **figé sur la commande** (`courses.prix_estime`) : changer le
  barème ne réécrit pas les commandes passées (test dédié).
- Affiché au partenaire (récapitulatif + suivi) et à la compagnie (file des
  commandes entrantes). Le reçu ne l'affiche **pas** encore.
- `config_tarifaire` (ce que la compagnie paie à Fiyen) est inchangé ; sa
  carte d'accueil s'appelle maintenant « Votre abonnement Fiyen », pour ne pas
  la confondre avec les tarifs de la compagnie.
- Le jeu de démo publie un barème **d'exemple** (≤ 3 km 1 000 F, ≤ 8 km
  1 500 F, ≤ 15 km 2 500 F).

**Statistiques — ce qui existe :** délais (assignation, attente avant
départ, trajet, total) en médiane et en moyenne, calculés depuis le journal
horodaté ; taux de réussite et d'annulation ; par livreur ; par client ;
montant livré d'après le barème ; comparaison avec **les mêmes jours** du mois
précédent ; définition de chaque indicateur affichée ; export CSV pour Excel
(séparateur `;`, injection de formule neutralisée).

**Seed :** il n'utilise plus `docker exec … psql`, qui restait bloqué quand
Docker Desktop se fige, mais `backend/cmd/sql` (même connexion que l'API).
Reset vérifié en 16 s, historique de deux mois compris (bug corrigé).

**Push Android — ce qui existe :**
- `expo-notifications` et `expo-constants` installés (versions SDK 57),
  plugin déclaré dans `app.json` (canal « courses »).
- `src/push.ts` : la logique, testée sans téléphone. L'ordre suit la
  documentation Expo v57 : canal Android d'abord, puis permission, puis
  jeton, puis enregistrement sur le serveur (`POST /api/notifications/jeton`).
  Chaque issue a un état explicite : activé, refusé, non configuré (pas de
  projet EAS), erreur réseau (nouvel essai au retour au premier plan).
- `src/pushExpo.ts` : le branchement Expo. Bannière affichée même application
  ouverte. À la déconnexion, le serveur oublie le téléphone (un téléphone
  prêté ne reçoit pas les courses de l'ancien livreur).
- Le livreur ne voit un message que s'il peut agir (permission refusée → « activez-les
  dans les réglages ») ; un défaut de configuration n'est pas son problème.
- L'envoi côté serveur existait déjà (Phase 3.2, testé contre le vrai service
  Expo avec un jeton factice).

**Push Android — étapes pour Daren (test sur téléphone, non fait) :**
1. Créer un compte Expo (gratuit), puis dans `app-livreur-mobile/` :
   `npx eas login` et `npx eas init`. Cela inscrit `extra.eas.projectId` dans
   `app.json`. Sans lui, l'app affiche l'état « non configuré » et ne reçoit
   rien.
2. Identifiants Android : créer un projet Firebase (gratuit), ajouter l'app
   `bf.fiyen.livreur`, télécharger `google-services.json`, le déclarer dans
   `app.json` (`android.googleServicesFile`), puis déposer la clé de compte de
   service FCM V1 avec `npx eas credentials`. **Ne pas committer ces fichiers.**
3. Téléphone Android 7+ en débogage USB. Dans `.env` de l'app :
   `EXPO_PUBLIC_API_URL=http://<IP du PC>:8090`, et ajouter cette origine à
   `CORS_ORIGINS` du backend. Puis `npx expo run:android`. **Prévoir plusieurs
   Go** : SDK Android et Gradle ; Expo Go ne suffit pas.
4. Se connecter avec Issouf (`+22670001006`), accepter les notifications,
   puis depuis le dashboard lui assigner une commande : la notification doit
   arriver, téléphone verrouillé compris.
5. Se déconnecter : le jeton doit disparaître de la table `jetons_push`.

**Passe « effet waouh » — mesures avant / après :**

| Mesure | Avant | Après |
| --- | --- | --- |
| JS chargé au premier écran, dashboard (gzip) | 132 Ko | **87 Ko** (−34 %) |
| idem, app partenaire | 116 Ko | **71 Ko** (−39 %) |
| idem, app destinataire | 110 Ko | **66 Ko** (−39 %) |
| Textes sous le seuil de contraste AA (11 écrans) | 4 (3 trouvés par l'audit, 1 à l'œil sur fond dégradé) | **0** à l'audit |
| Boutons sans nom accessible (carte de flotte) | 4 | **0** |
| Champs sans libellé | 0 | 0 |

- **Cartes chargées à la demande** : Leaflet (~45 Ko compressés) ne se
  télécharge plus à l'ouverture, seulement quand une carte s'affiche. C'est
  ce qui compte sur un réseau mobile lent. Message « Chargement de la carte… »
  entre-temps.
- **Contraste** : étiquettes « Départ / Livraison » du bloc vert (destinataire,
  ~2:1 → ~7:1) ; bouton « Terminer mon service » du livreur (3,4:1 → 4,7:1) ;
  lien de crédit des cartes ; « Comment c'est calculé » (statistiques).
- **Libellés** : chaque livreur sur la carte de flotte est annoncé par son nom
  et son statut. Au passage, le nom du livreur est **échappé** dans la bulle
  de la carte (il était inséré en HTML brut).
- **Ergonomie** : le point de retrait de la commande partenaire est
  pré-rempli avec le nom et le repère de l'entreprise (une saisie de moins à
  chaque commande).
- **États vides et erreurs** : la page Courses et la page Flotte disent quoi
  faire quand elles sont vides ; « Erreur inconnue » devient « Serveur
  injoignable. Vérifiez la connexion internet, puis rechargez la page. »
- **Responsive** : les apps destinataire, livreur et partenaire, capturées à
  360 px, tiennent sans débordement.
- **Non fait** (pas de grosse refonte) : pas de nouvelles animations (les
  apps en ont déjà, neutralisées par `prefers-reduced-motion`) ; les fonds en
  dégradé (blocs verts) ne sont pas évalués par l'audit automatique.

**Tâche 6** : section « Pourquoi Fiyen gagne » (§1), script de démo ramené
à ~15 min avec le barème et les statistiques (§5), statut mis à jour (§6).

**Régression finale du 22/10** : tout vert (§11). Jeu de démo rechargé.

---

## 14. Tester sur téléphone (22/10/2026)

> Le téléphone et le PC doivent être sur **le même Wi-Fi**. Adresse du PC sur
> ce Wi-Fi le 22/10 : **`192.168.11.117`**. Elle peut changer d'un jour à
> l'autre : la vérifier avec `ipconfig` (ligne « Adresse IPv4 » de la carte
> Wi-Fi).

### Étape 1 — Ouvrir le pare-feu du PC (une fois, par Daren)

Le Wi-Fi est classé « réseau public » par Windows, qui bloque alors toute
connexion entrante. Dans un **PowerShell lancé en administrateur** :

```powershell
New-NetFirewallRule -DisplayName "Fiyen dev (Wi-Fi local)" -Direction Inbound -Protocol TCP -LocalPort 8090,5173,5175,5176,5177 -Action Allow -Profile Any -RemoteAddress LocalSubnet
```

`LocalSubnet` limite l'ouverture aux appareils du même réseau. Pour la
retirer après les essais :
`Remove-NetFirewallRule -DisplayName "Fiyen dev (Wi-Fi local)"`.

Vérification depuis le téléphone : ouvrir `http://192.168.11.117:8090/health`
dans le navigateur, qui doit afficher `"statut":"ok"`.

### Étape 2 — Installer l'APK livreur (Android)

1. Sur le téléphone, ouvrir le lien de l'APK (voir le récapitulatif de la
   session, ou la page du build sur expo.dev, qui affiche aussi un QR code).
2. Télécharger le fichier `.apk`. Android demande d'**autoriser l'installation
   depuis cette source** (Chrome ou Fichiers) : accepter pour cette fois.
   Play Protect peut avertir d'une « application inconnue » : c'est normal
   pour un APK hors Play Store.
3. Ouvrir **Fiyen Livreur**. Sur l'écran de connexion, en bas : « Serveur :
   http://192.168.11.117:8090 ». Si l'IP du PC a changé : **Modifier
   l'adresse du serveur** → nouvelle adresse → **Tester et enregistrer**.
4. Se connecter avec un livreur de démo (mot de passe `motdepasse123`) :
   - **Issouf Sawadogo `+22670001006`** : disponible, à assigner depuis le
     dashboard (le plus parlant) ;
   - Salif Traoré `+22670001001` : a déjà une course assignée.
   **Ne pas lancer le simulateur GPS en même temps pour ce livreur** : le
   simulateur fait rouler Issouf, et deux sources de positions feraient
   sauter le point sur la carte. Utiliser Salif sur le téléphone si le
   simulateur tourne.
5. Accepter la localisation (« Toujours autoriser » pour le suivi écran
   éteint) et les notifications.

**Ce qui ne marchera pas avec cet APK de test :**
- **hors du Wi-Fi du PC** (en 4G, ou PC éteint) : l'API est sur le PC ;
- **les notifications push** : il manque Firebase (FCM). L'app le détecte et
  n'affiche rien au livreur. Pour l'activer : §13, « étapes pour Daren »,
  étape 2, puis un nouveau build ;
- **le suivi écran éteint** n'a jamais été vérifié sur un vrai téléphone :
  c'est précisément ce que ce test doit établir. Le dire si ça ne marche pas.

### Étape 3 — Les apps web sur le téléphone

Les autres applications sont des sites : pas d'installation, le navigateur
du téléphone suffit. Elles tournent en ce moment avec `--host`, configurées
pour joindre l'API par l'IP du PC.

| Application | Adresse sur le Wi-Fi | Compte de démo |
| --- | --- | --- |
| Dashboard compagnie | http://192.168.11.117:5173 | `+22670001000` |
| App partenaire | http://192.168.11.117:5177 | `+22670001004` |
| App destinataire (suivi) | http://192.168.11.117:5176 | `+22670001003` |
| App livreur web | http://192.168.11.117:5175 | `+22670001001` |

- **« Ajouter à l'écran d'accueil »** : impossible tant que c'est en `http://` ;
  il faut le HTTPS (`HEBERGEMENT.md`, §2).
- **App livreur web sur téléphone** : la connexion et les étapes
  fonctionnent, mais **le GPS est refusé** par le navigateur hors HTTPS.
  Pour un livreur sur téléphone, utiliser l'APK.

Pour relancer ces serveurs en mode réseau (après un redémarrage du PC),
dans chaque dossier d'interface :

```bash
VITE_API_BASE_URL=http://<IP>:8090 VITE_WS_BASE_URL=ws://<IP>:8090 npx vite --host
```

et ajouter les origines `http://<IP>:5173`, `:5175`, `:5176`, `:5177` à
`CORS_ORIGINS` dans `backend/.env`, et `URL_PUBLIQUE=http://<IP>:8090`
(fait le 22/10 pour `192.168.11.117`), puis redémarrer l'API.
