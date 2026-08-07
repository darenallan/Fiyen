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

Application mono-écran : le client se connecte (ou crée son compte), puis voit sa
livraison en cours — trajet, statut, carte de suivi et conversation.

Le MVP suppose **une course active à la fois** : la plus récente est affichée.
Les courses sont créées par la compagnie, pas par le client.

## Ce que le client ne voit jamais

C'est la garantie centrale du produit, et elle se joue autant côté API que côté UI :

- Aucun **numéro de téléphone**, ni le sien ni celui du livreur.
- Aucune **identité du livreur** : pas de nom, et le `livreur_id` n'est pas
  exposé — l'API de masquage ne renvoie qu'un `session_id`.
- La carte de suivi ne transporte qu'une **position** : le client voit *où* est
  son colis, jamais *qui* le porte.

## Identité visuelle

Charte Fiyen Delivery, portée par `src/index.css` sous forme de variables :

| Rôle | Couleur | Usage |
| --- | --- | --- |
| Or cuivré | `#C5A059` | marque, titres forts, actions principales |
| Kraft | `#D2B48C` | repères de trajet — rappel du colis |
| Blanc cassé | `#F5F5F5` | texte courant |
| Fond de page | `#100F0D` | neutre chaud |
| Surface (carte) | `#1C1A16` | neutre chaud |
| Surface haute | `#2B2721` | éléments en relief |
| Bordure | `#403930` | séparations |

Trois partis pris qui font la différence entre « thème sombre » et « premium » :

- **Neutres chauds, jamais gris froids.** Un gris neutre fait paraître l'or terne et
  sale ; toutes les palettes de luxe reposent sur des neutres chauds (famille « stone »).
  Le noir de marque `#1A1A1A` reste la matière de référence ; le fond de page descend
  légèrement en dessous pour que l'élévation des cartes se voie.
- **L'or est traité en métal, pas en aplat.** Le laiton ne se lit comme un métal que
  s'il porte un clair et un sombre : dégradé sur les boutons, les bulles, le logotype
  (peint dans les lettres via `background-clip: text`) et les points d'étape franchis.
- **L'élévation vient de l'ombre et d'un liseré haut**, pas du contraste de luminance —
  la formule WCAG écrase les écarts dans les tons sombres et n'est pas un bon guide ici.

L'extrémité sombre du dégradé est bornée à `#B08E4C` : plus bas, le bas des lettres du
logotype (4,14:1) et le texte des boutons (4,35:1) repassaient sous le seuil de 4,5:1.
Après correction, tout le dégradé tient : logotype 5,64:1, texte de bouton 5,93 à 11,05:1.

Typographie : **Oswald** en capitales pour les titres et la marque, **Montserrat** pour le
corps de texte. Les deux sont **auto-hébergées** (`src/polices/`, 68 Ko au total) : sur un
réseau mobile instable, dépendre d'un CDN de polices ajoute un aller-retour qui retarde le
premier rendu. Ce sont des polices variables — un fichier par famille couvre toutes les
graisses.

Tous les couples de couleurs dépassent le seuil WCAG AA (texte sur carte : 14,9:1 ; texte
secondaire : 7,2:1 ; or sur carte : 6,6:1 ; kraft sur carte : 8,2:1).

Deux choix liés au thème sombre :

- La carte utilise les tuiles **CARTO dark_matter** : les tuiles OSM standard, très claires,
  jureraient avec le noir mat et écraseraient le marqueur cuivré.
- Le marqueur du livreur est une pastille dorée à halo pulsant — un point fixe se perdrait
  sur un fond sombre.

Les animations sont courtes (180–420 ms, courbe `Expo.out`) et ne portent jamais
d'information à elles seules : `prefers-reduced-motion` les neutralise sans rien retirer.

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
