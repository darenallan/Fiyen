# Dashboard compagnie

Back-office web des compagnies de livraison partenaires : suivi de la flotte en
temps réel, gestion des livreurs et des courses. Voir `../CLAUDE.md` pour le
contexte produit, `../backend/README.md` pour l'API.

## Démarrage

```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:5173 (ou 5174 si occupé)
```

Le backend doit tourner (`../backend`), et son `CORS_ORIGINS` doit inclure
l'origine servie par Vite.

## Pages

| Page | Contenu |
| --- | --- |
| Tableau de bord | Compteurs de courses et de livreurs par statut, barème tarifaire en vigueur |
| Flotte | Carte temps réel, ajout de livreurs, tableau des positions |
| Courses | Création, filtrage par statut, assignation d'un livreur disponible |

L'accès est réservé au rôle `compagnie` ; un 401 de l'API déconnecte
automatiquement (`src/api/client.ts`).

## Suivi de flotte en temps réel

`src/api/useFlotteLive.ts` combine deux sources, parce qu'aucune ne suffit
seule :

- **WebSocket** `/ws/compagnie/flotte` — les positions GPS, poussées par le
  backend depuis un canal Redis propre à la compagnie. Reconnexion automatique
  avec backoff exponentiel (1 s → 20 s).
- **Sondage REST** toutes les 15 s — rattrape ce que le flux de positions ne
  transporte pas : changements de statut, prise de service, livreurs ajoutés
  en cours de session.

La carte (`src/components/CarteFlotte.tsx`) utilise Leaflet et les tuiles
OpenStreetMap. Deux choix à connaître :

- Les marqueurs sont des `divIcon` CSS, pas l'icône Leaflet par défaut : celle-ci
  référence des images par URL que les bundlers cassent, et un marqueur CSS
  permet en plus de coder le statut par la couleur.
- Le cadrage automatique n'a lieu **qu'une fois**, au premier chargement.
  Recadrer à chaque position empêcherait l'opérateur de naviguer sur la carte ;
  un bouton « Recentrer » rétablit la vue d'ensemble à la demande.

### Statut déclaré vs présence réelle

Un livreur peut être `dispo` en base tout en ayant perdu le réseau. L'API
renvoie donc `en_ligne`, calculé sur la clé TTL Redis (30 s sans position →
hors ligne), et c'est cette valeur qui pilote l'affichage : un livreur injoignable
apparaît « Hors ligne » et son marqueur est grisé, quel que soit son statut déclaré.

## Dépendances

`react-router-dom` remonte des CVE liées au rendu serveur (SSR/RSC, server
actions). Elles ne s'appliquent pas ici : le dashboard est une SPA cliente pure,
sans SSR ni server actions.

## Identité visuelle

Charte Fiyen Delivery — noir mat, or cuivré, kraft. Les jetons (couleurs,
typographie, élévation) sont définis dans `src/index.css` et **identiques** à ceux
de `app-client` et `app-livreur`. Ils sont recopiés plutôt que partagés via un
paquet, les projets Vite étant indépendants : toute évolution de la charte doit
être répercutée dans les trois, et dans `app-livreur-mobile/src/theme.ts`.

Voir `../app-client/README.md` pour le détail des partis pris (neutres chauds,
traitement métallique de l'or, élévation en mode sombre) et les mesures de
contraste.
