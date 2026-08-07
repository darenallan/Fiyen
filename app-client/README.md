# App client (web)

Interface du client final : suivre sa livraison en direct et écrire à son livreur
sans échanger de numéro. Voir `../CLAUDE.md` pour le contexte produit,
`../backend/README.md` pour l'API.

## Démarrage

```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:5176
```

Le backend doit tourner (`../backend`), et son `CORS_ORIGINS` doit inclure
`http://localhost:5176`.

## Écrans

Navigation basse à trois onglets, correspondant à ce que le produit fait
réellement : le client ne commande pas dans un catalogue (c'est sa compagnie de
livraison qui crée la course), donc ni « Explorer » ni « Panier ».

| Onglet | Contenu |
| --- | --- |
| Suivi | Livraison en cours : statut, trajet, progression en 5 étapes, carte, conversation |
| Commandes | Historique de toutes ses courses |
| Profil | Rappel de la garantie de masquage, déconnexion |

La course **en cours de livraison** prime sur la plus récente : un client qui
vient de commander ne doit pas perdre de vue la livraison déjà en route.

Chargement : des squelettes reproduisent la forme du contenu à venir, pour que
la mise en page ne se décale pas à l'arrivée des données — ce qui compte
d'autant plus que le réseau peut être lent.

## Ce que le client ne voit jamais

C'est la garantie centrale du produit, et elle se joue autant côté API que côté UI :

- Aucun **numéro de téléphone**, ni le sien ni celui du livreur.
- Aucune **identité du livreur** : pas de nom, et le `livreur_id` n'est pas
  exposé — l'API de masquage ne renvoie qu'un `session_id`.
- La carte de suivi ne transporte qu'une **position** : le client voit *où* est
  son colis, jamais *qui* le porte.

## Identité visuelle

Système de design clair, défini dans `src/index.css` sous forme de jetons. Cette
feuille **fait référence** : `app-livreur`, `dashboard` et
`app-livreur-mobile/src/theme.ts` en recopient les jetons (projets indépendants),
toute évolution doit y être répercutée.

| Rôle | Couleur | Usage |
| --- | --- | --- |
| Primary | `#C4451A` | actions principales, marque, étape en cours |
| Secondary | `#116E68` | repère de départ, éléments de confiance |
| Accent | `#E8A317` | ce qui doit attirer l'œil (héritier de l'or de la charte) |
| Background | `#FBF7F2` | fond de page, légèrement chaud |
| Surface | `#FFFFFF` | cartes |
| Text | `#1A1A1A` / `#57504B` / `#7C736C` | principal / secondaire / atténué |
| Semantic | `#12805A` `#9A5B00` `#C8352F` `#1D5FD0` | succès / avertissement / erreur / info |

Continuité de marque : le noir `#1A1A1A` de la charte initiale devient la couleur
de texte, et l'or cuivré devient l'accent — l'identité survit au passage en clair.

**Contrastes vérifiés** (WCAG AA, seuil 4,5:1) : blanc sur primary 4,98 ; primary
sur surface 4,98 ; blanc sur secondary 6,08 ; texte sur fond 16,3 ; texte
secondaire 7,9 ; atténué 4,64 ; succès 4,93 ; avertissement 5,43 ; erreur 5,24 ;
info 5,83. `--primary-vif` (#E85D2A) est plus lumineux mais **réservé aux aplats
décoratifs**, jamais au texte.

Deux règles qui tiennent tout :

- **Aucun état ne repose sur la seule couleur.** L'étape en cours porte un halo
  et un libellé en gras ; l'onglet actif de la navigation porte un trait
  supérieur ; les bandeaux d'erreur portent une icône ; la barre de répartition
  du dashboard est doublée d'une légende chiffrée.
- **Icônes en SVG inline**, pas d'emoji (rendu variable selon le téléphone, ne
  prend pas la couleur du texte) ni de librairie (poids inutile sur réseau lent).

Cartes : tuiles **CARTO light_all**, désaturées — les routes colorées d'OSM
entreraient en concurrence avec le marqueur terracotta.

Animations courtes (160–400 ms, courbe `Expo.out`), neutralisées par
`prefers-reduced-motion` sans perte d'information.

## Suivi et conversation

- **Carte** (`src/CarteSuivi.tsx`) — WebSocket `/ws/courses/:id/position`.
  Contrairement au dashboard, la carte se **recentre à chaque position** : le
  client suit un seul livreur et n'a pas de raison de naviguer sur la carte.
- **Conversation** (`src/ChatMasque.tsx`) — WebSocket `/ws/masquage/:sessionId`.
  Les messages sont persistés côté serveur : sur un réseau instable, un message
  envoyé pendant que l'autre est déconnecté ne doit pas être perdu.

Les deux se reconnectent automatiquement (backoff exponentiel 1 s → 15 s).

Le canal se ferme avec la course : après livraison, l'historique reste lisible
mais plus rien ne peut y être envoyé.
