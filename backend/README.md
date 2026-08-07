# Backend — Plateforme de livraison B2B (Burkina Faso)

API Go (Fiber) + PostgreSQL/PostGIS + Redis. Voir `../CLAUDE.md` pour le contexte produit complet.

## Démarrage

```bash
docker compose up -d        # Postgres+PostGIS (port 55020) + Redis (port 6379)
cp .env.example .env
go run ./cmd/migrate        # applique les migrations SQL (migrations/*.sql)
go run ./cmd/api            # démarre l'API sur le port défini dans .env (8090 par défaut)
```

> Ports non standards (55020 pour Postgres, 8090 pour l'API) : cette machine a déjà des
> instances PostgreSQL natives sur 5432/5433 et un autre service sur 8080. Adapter
> `.env` et `docker-compose.yml` si l'environnement change.

## Jeu de démonstration

```bash
node scripts/seed-demo.mjs           # première fois
node scripts/seed-demo.mjs --reset   # rejouer (supprime d'abord les comptes de démo)
```

Crée une compagnie, deux livreurs, un client, deux courses (une assignée, une en attente)
et un barème tarifaire, puis affiche les identifiants de connexion. Mot de passe commun :
`motdepasse123`.

> Script en Node et non en shell : sous Git Bash sur Windows, les accents des chaînes
> littérales sont corrompus avant d'atteindre `curl`, ce qui produisait des
> « March**�** de Rood Woko » en base. Node lit sa source en UTF-8 et `fetch` envoie un
> corps correctement encodé, quel que soit le système.

| Rôle | Téléphone | Interface |
| --- | --- | --- |
| Compagnie « Fiyen Démo » | `+22670001000` | dashboard (`:5173`) |
| Livreur Salif Traoré (a une course) | `+22670001001` | app livreur (`:5175`) ou mobile |
| Livreur Aminata Zongo | `+22670001002` | app livreur (`:5175`) ou mobile |
| Client Awa Ouédraogo | `+22670001003` | app client (`:5176`) |

### Réinitialiser

`--reset` supprime les quatre comptes de démo (ciblés par hash de téléphone, donc sans
toucher à d'autres données) avant de les recréer. Pour repartir d'une base entièrement
vide :

```bash
docker compose down -v && docker compose up -d
go run ./cmd/migrate && node scripts/seed-demo.mjs
```

## Structure

- `cmd/api` — point d'entrée du serveur HTTP/WebSocket
- `cmd/migrate` — runner de migrations (suit les fichiers appliqués dans `schema_migrations`)
- `migrations/` — schéma SQL, dans l'ordre d'application
- `internal/config` — chargement de la configuration (`.env`)
- `internal/database` — connexions PostgreSQL (pgxpool) et Redis
- `internal/models` — types partagés + règles de transition de statut des courses
- `internal/middleware` — JWT (REST + WebSocket) et contrôle d'accès par rôle
- `internal/handlers` — logique des endpoints REST
- `internal/tracking` — écriture/lecture des positions (Redis GEOADD + pub/sub, persistance PostGIS)
- `internal/util` — hash téléphone (jamais en clair) et mot de passe (bcrypt)

## Rôles et comptes

Un compte (`utilisateurs`) a un rôle (`compagnie`, `livreur`, `client`) et un JWT qui porte
les identifiants correspondants (`compagnie_id`, `livreur_id`, `client_id`).

- `POST /api/auth/register-compagnie` — crée une compagnie + son premier compte admin
- `POST /api/auth/register-client` — auto-inscription client
- `POST /api/auth/login` — commun à tous les rôles
- `POST /api/livreurs/` (compagnie) — crée un livreur + son compte de connexion
- `GET /api/livreurs/me` (livreur) — son propre nom et statut
- `PATCH /api/livreurs/me/statut` (livreur) — bascule `dispo`/`offline`
- `GET /api/courses/mes-courses` (livreur ou client) — ses courses non terminées : celles qui
  lui sont assignées pour un livreur, celles qu'il a commandées pour un client
  (`?toutes=1` pour l'historique)
- `GET /api/clients/recherche?telephone=` (compagnie) — résout un numéro en `client_id`

> `CORS_ORIGINS` doit lister les origines des fronts (dashboard, app livreur),
> sinon le navigateur bloque tous les appels.

## Courses — cycle de vie

`en_attente → assignee → recuperee → en_route → livree` (ou `annulee` avant `en_route`).
Les transitions invalides sont rejetées (`internal/models.TransitionValide`).
L'assignation ouvre automatiquement une session de masquage numéro (`sessions_masquage`,
expire après `MASQUAGE_DUREE_HEURES`) ; elle est clôturée à `livree`/`annulee`.

## Tracking temps réel

- `GET /ws/livreur/position` (rôle livreur) — le livreur pousse
  `{"latitude":.., "longitude":.., "horodatage":".."}` toutes les 3-5s ; le backend écrit dans
  Redis (GEOADD + TTL de présence `livreur:last_seen:{id}`) et persiste en PostGIS.
  `horodatage` (ISO 8601, optionnel) est l'instant de **capture** GPS : l'app livreur met ses
  positions en cache pendant une coupure réseau et les rejoue ensuite. Une position rejouée plus
  ancienne que celle déjà en base est publiée mais **pas** persistée, pour qu'un rattrapage
  tardif n'écrase pas une position plus récente.
- `POST /api/livreurs/me/positions` (livreur) — dépôt **par lots** :
  `{"positions":[{"latitude":..,"longitude":..,"horodatage":".."}]}`. Complète le WebSocket
  plutôt que de le remplacer : l'app mobile suit la position via une tâche Android
  d'arrière-plan, réveillée par lots, qui ne peut pas tenir une socket ouverte de façon
  fiable. Le dépôt groupé est aussi plus économe en données. Réponse : `traitees` /
  `recues` — « traitées » et non « enregistrées », une position rejouée périmée étant
  diffusée mais volontairement pas persistée.
- `GET /ws/courses/:id/position` (compagnie, client ou livreur assigné) — s'abonne à la position
  live du livreur assigné à cette course via canal Redis pub/sub.
- `GET /ws/compagnie/flotte` (compagnie) — s'abonne aux positions de **tous** ses livreurs.
  Chaque position est publiée sur deux canaux : `course:{livreur_id}:position` (le client qui
  suit sa course) et `compagnie:{compagnie_id}:positions` (la vue flotte). Un canal porté par la
  compagnie évite au dashboard de s'abonner livreur par livreur et de gérer les arrivées/départs
  de la flotte en cours de session.
- `GET /api/livreurs/` renvoie `en_ligne`, la présence **réelle** issue du TTL Redis, à distinguer
  du statut déclaré : un livreur `dispo` dont le téléphone a perdu le réseau n'est plus joignable.
- Authentification WebSocket : header `Authorization: Bearer <token>` ou query `?token=` (les
  navigateurs ne permettent pas de fixer des en-têtes personnalisés sur le handshake WS).

## Masquage du numéro

Garantie centrale : **aucun numéro réel n'est échangé**, et le client ne connaît jamais
le `livreur_id`. Seul le `session_id` circule côté front (`internal/masquage`).

- `GET /api/courses/:id/masquage` (client ou livreur assigné) — le `session_id` du canal,
  le rôle de l'appelant et l'état d'activité. Ni numéro, ni identité de l'interlocuteur.
- `GET /api/masquage/:sessionId/messages` — historique de la conversation.
- `GET /ws/masquage/:sessionId` — canal temps réel. Deux familles d'évènements :
  - `message` — persisté **puis** relayé. La persistance n'est pas un confort : sur un
    réseau instable, un message envoyé pendant que l'autre partie est déconnectée serait
    perdu par un simple relais.
  - `offre` / `reponse` / `ice` — signaling WebRTC pour l'appel in-app, **relayé sans être
    conservé** ; le serveur ne garde rien du contenu WebRTC.

Contrôles d'accès, tous vérifiés par tests (`24 garanties`) :

- Seules les **deux extrémités** de la course accèdent au canal. La compagnie elle-même
  en est exclue : elle gère la course, pas la conversation.
- « Session introuvable » et « accès refusé » renvoient le **même 404**, pour ne pas
  laisser deviner quelles courses existent.
- L'expiration est revérifiée **à chaque envoi**, pas seulement à la connexion : une course
  peut se terminer alors que la socket est encore ouverte. Après livraison, la socket est
  fermée et l'historique devient lisible seulement.

### Repli PSTN (à intégrer)

`internal/masquage/pstn.go` définit l'interface `FournisseurPSTN` (numéro virtuel loué le
temps de la course, jamais celui d'un participant). L'implémentation par défaut
`PSTNNonConfigure` **échoue explicitement** plutôt que de simuler un numéro : un faux
numéro donnerait l'illusion d'un canal de secours et le défaut ne se verrait qu'au moment
où un client tente réellement d'appeler.

Pour l'activer : implémenter l'interface avec Africa's Talking et l'injecter dans les
handlers. À vérifier au moment de l'intégration — la couverture **voix** exacte pour le
Burkina Faso, qui varie selon les pays et n'est pas garantie par la seule disponibilité
SMS/USSD.

## Barème tarifaire

Aucune valeur codée en dur : `config_tarifaire` porte l'abonnement mensuel, les livreurs
inclus et la commission par compagnie, versionné dans le temps via `active_a_partir`.
`GET /api/dashboard/config-tarifaire` renvoie le barème en vigueur.
