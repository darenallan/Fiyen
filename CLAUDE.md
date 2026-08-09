# Fiyen Delivery — plateforme de livraison B2B (Burkina Faso)

Ce fichier sert de contexte permanent pour Claude Code sur ce projet. Il résume les décisions déjà actées — ne pas les redemander, les appliquer.

## Contexte

Plateforme B2B (SaaS) destinée aux **compagnies de livraison existantes** au Burkina Faso, inspirée de Glovo. Objectif : leur donner un outil pour suivre leur flotte de livreurs en temps réel et sécuriser la relation client-livreur, sans qu'elles aient à développer leur propre outil.

Ce projet est indépendant de mes autres projets (Sanhia, BarkaPay, etc.) — ne pas mélanger le code, les conventions ou l'infra.

> **⚠️ Ce n'est PAS une marketplace.** Il n'y a ni commerce, ni catalogue de produits, ni panier, ni checkout, ni promotions — et il n'y en aura pas en V1. **C'est la compagnie qui crée la course pour le client**, lequel ne commande pas depuis l'application. Toute demande de refonte inspirée d'Uber Eats / DoorDash doit être confrontée à ce point avant d'être appliquée : ces écrans n'existent pas et les inventer supposerait des données fictives.

## Modèle économique

Hybride :
- Abonnement mensuel par compagnie partenaire (accès dashboard + nombre de livreurs inclus)
- Commission sur chaque course livrée via la plateforme

Le barème précis n'est pas encore fixé — ne pas coder de valeurs en dur. Table `config_tarifaire`, versionnée par `active_a_partir`, lue via `GET /api/dashboard/config-tarifaire`. Pas encore d'API d'écriture : le barème est inséré en SQL (voir le script de seed).

## Plateformes cibles

- **App livreur** : native Android **et** web app (PWA), les deux dès le départ — le parc de téléphones économiques au Burkina Faso impose de ne pas dépendre uniquement du natif.
  - Le natif se fait en **Expo (React Native)**, pas en Kotlin — décision révisée. Motifs : tout le reste du projet est en React/TypeScript, le seul besoin réellement natif (GPS en arrière-plan) est couvert par `expo-location` + foreground service, et EAS Update permet de corriger une flotte sans passer par le Play Store.
  - La PWA reste indispensable : Expo SDK 57 exige Android 7+ (API 24), la contrainte du parc économique tient toujours.
- **App / interface client** : web (PWA)
- **Dashboard compagnie** : back-office web (React)

## Périmètre du MVP

| # | Priorité | État |
| --- | --- | --- |
| 1 | Authentification par rôle (compagnie / livreur / client) | ✅ |
| 2 | Commandes : création, assignation manuelle, suivi de statut | ✅ |
| 3 | Tracking temps réel de la position des livreurs | ✅ |
| 4 | Masquage du numéro (aucun numéro réel échangé) | ✅ chat texte ; voix WebRTC et repli PSTN non faits |
| 5 | Dashboard compagnie : flotte temps réel, livreurs, stats | ✅ |

Statuts de course : `en_attente → assignee → recuperee → en_route → livree`, plus `annulee` avant `en_route`. Les transitions invalides sont rejetées côté backend (`internal/models.TransitionValide`).

Hors périmètre V1 (Phase 2+) : paiement intégré (mobile money), attribution automatique intelligente, notation, API publique.

## Stack technique

| Composant | Choix | Dossier |
| --- | --- | --- |
| Backend | Go (Fiber), API REST + WebSocket | `backend/` |
| Base de données | PostgreSQL + PostGIS | conteneur `fiyen-postgres` |
| Cache / pub-sub temps réel | Redis | conteneur `fiyen-redis` |
| Dashboard compagnie | React + Vite + Leaflet | `dashboard/` |
| App livreur (PWA) | React + Vite | `app-livreur/` |
| App livreur (natif) | Expo / React Native | `app-livreur-mobile/` |
| App client | React + Vite + Leaflet | `app-client/` |
| Hébergement | Cloud type Render, scalable horizontalement | — |

## Démarrage local

**Ports non standards, et c'est délibéré** : cette machine a déjà des PostgreSQL natifs sur 5432/5433 et un service sur 8080.

```bash
cd backend && docker compose up -d && go run ./cmd/api   # API sur :8090, Postgres sur :55020
cd dashboard     && npm run dev    # :5173
cd app-livreur   && npm run dev    # :5175
cd app-client    && npm run dev    # :5176
```

`CORS_ORIGINS` (dans `backend/.env`) doit lister les origines des fronts, sinon le navigateur bloque tout.

### Jeu de démonstration

```bash
node backend/scripts/seed-demo.mjs --reset
```

Mot de passe commun : `motdepasse123`.

| Rôle | Téléphone |
| --- | --- |
| Compagnie « Fiyen Démo » | `+22670001000` |
| Livreur Salif Traoré (a une course assignée) | `+22670001001` |
| Livreur Aminata Zongo | `+22670001002` |
| Cliente Awa Ouédraogo | `+22670001003` |

> Le script est en **Node et non en shell** : sous Git Bash sur Windows, les accents des chaînes littérales sont corrompus avant d'atteindre `curl`, ce qui produisait des « March**�** de Rood Woko » en base.

## Base de données

Le schéma vit dans `backend/migrations/*.sql`, appliqué par `go run ./cmd/migrate` (suivi dans `schema_migrations`). Tables : `compagnies`, `utilisateurs`, `livreurs`, `clients`, `courses`, `positions_livreurs`, `sessions_masquage`, `messages_masques`, `config_tarifaire`.

Le schéma initial du cahier des charges a été étendu : ajout de `compagnies` (tenants), `utilisateurs` (comptes multi-rôles nécessaires à l'auth) et rattachement de tout à `compagnie_id`.

## Tracking temps réel

- Le livreur pousse sa position toutes les 3-5 s. **Deux canaux d'entrée** :
  - `GET /ws/livreur/position` (WebSocket) — utilisé par la PWA.
  - `POST /api/livreurs/me/positions` (lot) — utilisé par l'app mobile, dont la tâche Android d'arrière-plan est réveillée par lots et ne peut pas tenir une socket ouverte. Plus économe en données.
- Chaque position est publiée sur **deux canaux Redis** : `course:{livreur_id}:position` (le client qui suit sa course) et `compagnie:{compagnie_id}:positions` (la vue flotte). Le canal porté par la compagnie évite au dashboard de s'abonner livreur par livreur.
- Chaque position porte son **horodatage de capture**, pas d'envoi. Une position rejouée après une coupure est diffusée mais **pas persistée** si elle est plus ancienne que celle en base — sinon un rattrapage tardif écraserait une position récente.
- TTL de présence : `livreur:last_seen:{id}` expire après 30 s. `GET /api/livreurs/` renvoie `en_ligne`, la présence **réelle**, à distinguer du statut déclaré.

## Masquage du numéro

Garantie centrale : aucun numéro réel n'est échangé, et le client ne connaît jamais le `livreur_id`. Seul le `session_id` circule côté front (`backend/internal/masquage`).

- **Fait et testé** : chat texte via `GET /ws/masquage/:sessionId`. Les messages sont **persistés puis relayés** — sur un réseau instable, un simple relais perdrait tout message envoyé pendant que l'autre partie est déconnectée.
- **Fait, non exploité** : le relais de signaling WebRTC (`offre` / `reponse` / `ice`) est en place et relayé sans être conservé. Il ne manque que la couche voix côté front.
- **Non fait** : le repli PSTN. `internal/masquage/pstn.go` définit l'interface ; l'implémentation par défaut **échoue explicitement** plutôt que de simuler un numéro — un faux numéro donnerait l'illusion d'un canal de secours. Pour l'activer : brancher Africa's Talking **et vérifier la couverture voix exacte au Burkina Faso**, qui varie selon les pays.

Contrôles d'accès (24 garanties couvertes par `test-masquage`) : seules les deux extrémités de la course accèdent au canal — **la compagnie elle-même en est exclue** ; « introuvable » et « accès refusé » renvoient le même 404 ; l'expiration est revérifiée **à chaque envoi**, pas seulement à la connexion.

## Système de design

Direction : **vert forêt & moutarde**, registre chaleureux-populaire, avec brillance.
Source : la maquette `fiyen-v3-vert-moutarde.html` à la racine, fournie par le client — s'y référer avant toute évolution visuelle.

Référence d'implémentation : **`app-client/src/index.css`**. Les jetons sont **recopiés** dans `app-livreur/`, `dashboard/` et `app-livreur-mobile/src/theme.ts` (projets Vite indépendants) — toute évolution doit être répercutée aux quatre endroits. Un workspace npm réglerait cette dette si le projet grandit.

| Rôle | Couleur |
| --- | --- |
| Vert forêt (surfaces sombres) | `#16332A`, `#1E4235`, `#2C5646` |
| Crème (surfaces claires) | `#F5EFE1` / `#EAE0C6` |
| Moutarde | `#E0A526` — **surface uniquement** |
| Rust (accent) | `#D9581F` — surface uniquement |
| Texte sur vert | `#F5EFE1` / `#A9BDB0` |
| Texte sur crème | `#16332A` / `#55605A` |

**Contraintes de contraste à respecter.** Les accords signature passent largement (moutarde sur vert 6,22:1 ; crème sur vert 11,89 ; vert sur moutarde 6,22). Mais trois couleurs de la maquette ne tiennent pas comme **texte** et ont des variantes dérivées :

| N'utiliser comme texte que via | Variante | Ratio |
| --- | --- | --- |
| moutarde sur crème (1,91 ✗) | `--or-texte-clair` `#8A6114` | 4,82 |
| rust sur vert (3,48 ✗) | `--rust-texte` `#F0834E` | 5,23 |
| muet sur crème (3,82 ✗) | `--tx-clair-muet` `#55605A` | 5,71 |
| succès sur crème (4,28 ✗) | `--succes-texte` `#3B6349` | 5,97 |

Typographie **auto-hébergée** (`src/polices/`, 132 Ko) : **Baloo 2** (titres, boutons, grands chiffres — ronde et chaleureuse), **Work Sans** (corps), **Space Mono** (sur-titres, horodatages, libellés de statistiques — c'est la signature de la direction). Dépendre d'un CDN ajouterait un aller-retour qui retarde le premier rendu sur réseau lent.

Gestes visuels qui font la direction :

- **Un bloc vert forêt posé sur le crème** ouvre chaque écran principal. L'inversion crée la hiérarchie mieux qu'une carte claire de plus.
- **Halo moutarde** en radial dans les blocs sombres, et **balayage lumineux oblique** (`linear-gradient(115deg, …)`) sur les surfaces sombres et les boutons — c'est la « brillance » demandée.
- **Aucun état ne repose sur la seule couleur** : trait sur l'onglet actif, halo + gras sur l'étape en cours, icône sur les bandeaux d'erreur, légende chiffrée sous la barre de répartition.
- **Icônes en SVG inline**, ni emoji (rendu variable, ne prend pas la couleur du texte) ni librairie.
- Cartes en tuiles **CARTO light_all**, désaturées — les routes colorées d'OSM concurrenceraient les marqueurs.
- Animations 160–520 ms, courbe `Expo.out`, entrée en cascade, neutralisées par `prefers-reduced-motion` sans perte d'information.

Navigation basse à 3 onglets sur les deux apps mobiles : Suivi/Commandes/Profil côté client, Service/Courses/Profil côté livreur. **Pas d'onglet « Explorer » ni « Panier »** — voir l'avertissement en tête de fichier.

> La maquette montre un encart livreur avec nom, plaque et **bouton d'appel**, ainsi que des données (ETA, gains du jour, ponctualité) qui n'existent pas dans le produit. Ne pas les reprendre : le bouton d'appel **contredirait la garantie de masquage**, et le reste demanderait des données fictives. Le contact passe par la messagerie masquée.

## Sécurité (non négociable)

- TLS sur tous les échanges
- `telephone_hash`, jamais le numéro en clair, transmis au client ou stocké en clair
- JWT courte durée + contrôle d'accès par rôle
- Respect OWASP Top 10 sur toutes les API
- Rate limiting sur les endpoints publics (auth, tracking, masquage)

## Contraintes réseau locales

- Réseau mobile instable : mode dégradé côté app livreur — positions mises en cache localement (max 300) et rejouées à la reconnexion, reconnexion WebSocket en backoff exponentiel.
- Économie de données : une position n'est pas renvoyée en dessous de **15 m** de déplacement, avec un envoi forcé toutes les 20 s pour maintenir la présence. Rafraîchissement des listes à 20 s, pas plus souvent.

## Dette et points ouverts

- **L'app Expo n'a jamais tourné sur un appareil.** Le bundle Android se construit et le manifeste natif est correct (permissions + `LocationTaskService` en `foregroundServiceType="location"`), mais le suivi en arrière-plan — sa seule raison d'être — n'est pas vérifié. Il faut un *development build* (`npx expo run:android`) ; ça ne marche pas dans Expo Go. À faire en priorité avant de s'appuyer dessus.
- Depuis un téléphone, `localhost` ne désigne pas la machine de dev : renseigner l'IP LAN dans `EXPO_PUBLIC_API_URL` et l'ajouter à `CORS_ORIGINS`.
- Jetons de design dupliqués dans 4 projets (voir ci-dessus).
- `react-router-dom` (dashboard) remonte des CVE liées au SSR/RSC — sans objet ici, SPA cliente pure.
- **MCP 21st installé, mais compte en offre gratuite : 2 récupérations de code par jour** (`mcp__21st__get_usage`). Les recherches et les aperçus sont gratuits et illimités.
  - Les composants du catalogue sont en **shadcn/Tailwind**, que ce projet n'utilise pas (CSS + variables custom). Les installer imposerait Tailwind + shadcn : à ne pas faire. **S'en servir comme référence visuelle** — télécharger les `previewUrl` et les regarder — puis adapter au CSS maison.
  - Le plugin `ui-ux-pro-max` reste utile pour les palettes et les règles UX (neutres chauds, élévation, contraste).
- Le dépôt n'a que les deux commits d'origine ; tout le travail est en attente de commit.

## Roadmap

- **Phase 1 (MVP)** : voir le tableau du périmètre — les 5 priorités sont couvertes.
- **Phase 2** : paiement mobile money, attribution automatique des courses, notation livreurs/clients, voix WebRTC sur le signaling existant, repli PSTN Africa's Talking.
- **Phase 3** : multi-compagnies avancé, analytics, API publique.
