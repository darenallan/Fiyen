# Plateforme de livraison B2B — Burkina Faso

Ce fichier sert de contexte permanent pour Claude Code sur ce projet. Il résume les décisions déjà actées — ne pas les redemander, les appliquer.

## Contexte

Plateforme B2B (SaaS) destinée aux **compagnies de livraison existantes** au Burkina Faso, inspirée de Glovo. Objectif : leur donner un outil pour suivre leur flotte de livreurs en temps réel et sécuriser la relation client-livreur, sans qu'elles aient à développer leur propre outil.

Ce projet est indépendant de mes autres projets (Sanhia, BarkaPay, etc.) — ne pas mélanger le code, les conventions ou l'infra.

## Modèle économique

Hybride :
- Abonnement mensuel par compagnie partenaire (accès dashboard + nombre de livreurs inclus)
- Commission sur chaque course livrée via la plateforme

Le barème précis n'est pas encore fixé — ne pas coder de valeurs en dur, prévoir une table de configuration modifiable.

## Plateformes cibles

- **App livreur** : native Android **et** web app (PWA), les deux dès le départ — le parc de téléphones économiques au Burkina Faso impose de ne pas dépendre uniquement du natif.
  - Le natif se fait en **Expo (React Native)**, pas en Kotlin — décision révisée. Motifs : tout le reste du projet est en React/TypeScript, le seul besoin réellement natif (GPS en arrière-plan) est couvert par `expo-location` + foreground service, et EAS Update permet de corriger une flotte sans passer par le Play Store.
  - La PWA reste indispensable : Expo SDK 57 exige Android 7+ (API 24), la contrainte du parc économique tient toujours.
- **App / interface client** : web (PWA)
- **Dashboard compagnie** : back-office web (React)

## Périmètre du MVP

À livrer en V1, dans cet ordre de priorité :
1. Authentification par rôle (compagnie / livreur / client)
2. Gestion complète des commandes : création, **assignation** (manuelle puis auto), suivi de **statut** (en attente → assignée → récupérée → en route → livrée)
3. Tracking temps réel de la position des livreurs
4. Masquage du numéro entre client et livreur (aucun numéro réel échangé)
5. Dashboard compagnie : vue flotte en temps réel + gestion des livreurs + stats de base

Hors périmètre V1 (Phase 2+) : paiement intégré (mobile money), attribution automatique intelligente, notation, API publique.

## Stack technique

| Composant | Choix |
| --- | --- |
| Backend | Go (Fiber), API REST + WebSocket |
| Base de données | PostgreSQL + extension PostGIS |
| Cache / pub-sub temps réel | Redis |
| Dashboard compagnie | React |
| App livreur | Android natif via **Expo / React Native** + PWA |
| App client | Web (React) |
| Hébergement | Cloud type Render, scalable horizontalement |

## Schéma de base de données (point de départ)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE livreurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    telephone_hash TEXT NOT NULL,      -- jamais le numéro en clair côté client
    statut TEXT NOT NULL DEFAULT 'offline', -- offline|dispo|en_course
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE positions_livreurs (
    livreur_id UUID REFERENCES livreurs(id),
    position GEOGRAPHY(POINT, 4326) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (livreur_id)
);
CREATE INDEX idx_position_gist ON positions_livreurs USING GIST (position);

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL,
    livreur_id UUID REFERENCES livreurs(id),
    statut TEXT NOT NULL DEFAULT 'en_attente',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions_masquage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) UNIQUE,
    numero_virtuel TEXT,          -- null si canal WebRTC pur
    expire_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

## Tracking temps réel

- Le livreur pousse sa position GPS toutes les 3-5s via WebSocket vers le backend Go.
- Le backend écrit dans Redis (`GEOADD`) pour les requêtes géospatiales, et publie sur un canal `course:{livreur_id}:position`.
- Le client (ou le dashboard compagnie) s'abonne au canal de sa course active pour recevoir les mises à jour en direct.
- TTL de présence : une clé `livreur:last_seen:{id}` expire après 30s d'inactivité → statut "hors ligne" si dépassé.

## Masquage du numéro

Principe : jamais d'échange direct du numéro réel entre client et livreur.

- **Approche principale** : appel/message in-app via WebRTC (fonctionne en data, pas de dépendance opérateur).
- **Fallback PSTN** : Africa's Talking (couvre le Burkina Faso en SMS/USSD/voix) pour générer un numéro virtuel temporaire le temps de la course, si la connexion data est instable. Vérifier la couverture voix exacte pour le Burkina Faso au moment de l'intégration — elle varie selon les pays.
- Chaque course génère une `session_masquage` avec un `expire_at` — le canal est fermé et inutilisable une fois la course terminée.
- Le `livreur_id` réel n'est jamais exposé au client : seul le `session_id` circule côté front.

## Sécurité (non négociable)

- TLS sur tous les échanges
- `telephone_hash`, jamais le numéro en clair, transmis au client ou stocké en clair
- JWT courte durée + contrôle d'accès par rôle
- Respect OWASP Top 10 sur toutes les API
- Rate limiting sur les endpoints publics (notamment ceux liés au tracking et au masquage)

## Contraintes réseau locales

- Le réseau mobile au Burkina Faso n'est pas toujours stable : prévoir un mode dégradé côté app livreur (mise en cache locale des positions, envoi différé si perte de connexion).
- Optimiser la fréquence de mise à jour GPS pour limiter la conso de data.

## Roadmap

- **Phase 1 (MVP)** : voir "Périmètre du MVP" ci-dessus
- **Phase 2** : paiement mobile money, attribution automatique des courses, notation livreurs/clients
- **Phase 3** : multi-compagnies avancé, analytics, API publique
