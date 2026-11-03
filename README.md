# Fiyen — plateforme de livraison B2B (Burkina Faso)

Fiyen est un outil en ligne (SaaS) **loué par les compagnies de livraison** de Ouagadougou. Elles y suivent leur flotte en direct, leurs livreurs suivent leurs courses sur une app dédiée, et leurs entreprises clientes passent commande sans téléphoner.

> Ce n'est **pas** une marketplace : pas de catalogue, pas de panier, pas de paiement en ligne. C'est l'outil de travail de la compagnie.

## Ce que fait la plateforme

- **Tableau de bord compagnie** : flotte en temps réel sur carte, création et assignation des courses, livreurs, statistiques.
- **App livreur**, en PWA et en Android natif (Expo) : courses du jour, étapes (`assignee → recuperee → en_route → livree`), GPS en arrière-plan, preuve de livraison (signature).
- **Portail partenaire** : les entreprises clientes (pharmacies, boutiques…) et leurs collaborateurs commandent eux-mêmes, suivent leurs courses et récupèrent les reçus.
- **Suivi destinataire** : la personne qui reçoit le colis suit l'arrivée du livreur.
- **Numéro masqué** : livreur et client échangent par une messagerie masquée. Aucun numéro réel n'est partagé, ce qui protège le livreur et évite le contournement de la compagnie.
- **Traçabilité** : historique des statuts, preuves de livraison, reçus partageables, purge automatique des traces GPS.

## Architecture

| Dossier | Rôle | Stack | Port dev |
|---|---|---|---|
| `backend/` | API REST + WebSocket temps réel | Go 1.25 (Fiber), PostgreSQL 16 + PostGIS, Redis | 8090 |
| `dashboard/` | Back-office de la compagnie | React + Vite + TypeScript, Leaflet | 5173 |
| `app-livreur/` | App livreur (PWA) | React + Vite | 5175 |
| `app-client/` | Suivi destinataire | React + Vite, Leaflet | 5176 |
| `app-partenaire/` | Portail des entreprises clientes | React + Vite, Leaflet | 5177 |
| `app-livreur-mobile/` | App livreur Android | Expo (React Native), `expo-location`, notifications | — |
| `livraison-demo/` | Maquette HTML statique du dashboard | HTML | — |

La position des livreurs transite par Redis (présence et diffusion). L'historique et les données métier sont dans PostgreSQL/PostGIS. L'authentification utilise un JWT et un refresh token, avec contrôle d'accès par rôle (compagnie, livreur, partenaire, destinataire).

## Démarrer en local

Prérequis : Docker, Go 1.25+, Node.js 20+.

```bash
cd backend
docker compose up -d          # PostgreSQL + PostGIS (port 55020) et Redis (6379)
cp .env.example .env
go run ./cmd/migrate          # applique migrations/*.sql
node scripts/seed-demo.mjs    # compagnie, livreurs, client et courses de démo
go run ./cmd/api              # API sur http://localhost:8090
```

Dans un autre terminal, lancer l'interface voulue :

```bash
cd dashboard && npm install && npm run dev        # http://localhost:5173
```

Les autres interfaces se lancent de la même façon (`app-livreur`, `app-client`, `app-partenaire`). Les identifiants de démo sont affichés par le script de seed et détaillés dans [`backend/README.md`](backend/README.md).

App mobile :

```bash
cd app-livreur-mobile && npm install && npx expo start
```

## Configuration (backend)

Variables principales de `backend/.env` :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` / `REDIS_ADDR` | connexions PostgreSQL et Redis |
| `JWT_SECRET` | signature des jetons (valeur longue et aléatoire en production) |
| `CORS_ORIGINS` | origines autorisées (les interfaces web) |
| `URL_PUBLIQUE` | adresse publique, utilisée pour les liens de suivi et de reçu |
| `TRACES_RETENTION_JOURS` | durée de conservation des traces GPS |

`.env.example` décrit toutes les variables.

## Tests

```bash
cd backend && go test ./...
cd app-livreur-mobile && npm test
```

## Documentation

- [`PRESENTATION.md`](PRESENTATION.md) : pitch, cible et script de démo
- [`ROADMAP.md`](ROADMAP.md) et [`PLAN-V2-PORTAIL-PARTENAIRES.md`](PLAN-V2-PORTAIL-PARTENAIRES.md) : avancement et suite
- [`HEBERGEMENT.md`](HEBERGEMENT.md) : mise en ligne (Cloudflare Pages, Render, Neon, Upstash) et coûts
- [`CLAUDE.md`](CLAUDE.md) : décisions produit et techniques actées

## État

MVP fonctionnel en local : authentification par rôle, courses, suivi temps réel, messagerie masquée, portail partenaire et preuves de livraison. Pas encore déployé en production. L'appel vocal masqué (WebRTC / PSTN) n'est pas fait.
