# App livreur (PWA)

Application que le livreur utilise sur son téléphone : prise de service, envoi de
sa position GPS, et avancement de ses courses. Voir `../CLAUDE.md` pour le
contexte produit, `../backend/README.md` pour l'API.

Le pendant Android natif (Kotlin) reste à faire — cette PWA est la version qui
tourne sur le parc de téléphones économiques sans dépendre d'une installation.

## Démarrage

```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:5175
```

Le backend doit tourner (`../backend`), et son `CORS_ORIGINS` doit inclure
`http://localhost:5175`.

Pour tester la PWA (service worker, installation), il faut le build de production —
en dev le service worker n'est volontairement pas enregistré :

```bash
npm run build && npm run preview
```

## Comptes

Le livreur ne s'inscrit pas lui-même : son compte est créé par sa compagnie
depuis le dashboard. Il se connecte avec le numéro de téléphone et le mot de
passe qui lui ont été communiqués.

## Cycle d'une course

Le livreur ne voit que ses propres courses non terminées, et fait avancer le
statut par un seul bouton à la fois :

| Statut | Bouton proposé | Statut suivant |
| --- | --- | --- |
| `assignee` | J'ai récupéré le colis | `recuperee` |
| `recuperee` | Je pars en livraison | `en_route` |
| `en_route` | Colis livré | `livree` |

À la livraison, le backend repasse automatiquement le livreur en `dispo` et
clôt la session de masquage du numéro.

## Tracking GPS et mode dégradé

Le réseau mobile burkinabè n'étant pas fiable, le tracking est conçu pour
fonctionner en continu malgré les coupures (`src/tracking.ts`) :

- `watchPosition` alimente en continu la dernière position connue ; un envoi est
  tenté toutes les **4 s** (fourchette 3-5 s du cahier des charges).
- **Économie de données** : une position n'est pas renvoyée si le livreur a
  bougé de moins de **15 m**, sauf toutes les 20 s pour maintenir la présence
  (le backend considère un livreur hors ligne après 30 s de silence).
- **Coupure réseau** : les positions sont empilées dans `localStorage`
  (max 300, les plus anciennes sont abandonnées au-delà) et rejouées dans
  l'ordre dès la reconnexion. La reconnexion WebSocket suit un backoff
  exponentiel de 1 s à 30 s.
- Chaque position porte son **horodatage de capture**, pas celui de l'envoi :
  le backend ignore une position rejouée plus ancienne que celle déjà
  enregistrée, pour qu'un rattrapage tardif n'écrase pas une position récente.

L'écran affiche en permanence l'état d'envoi (connecté / hors ligne) et le
nombre de positions en attente, pour que le livreur sache que sa position est
conservée même sans réseau.

Les courses sont rafraîchies toutes les 20 s seulement — interroger l'API plus
souvent coûterait de la donnée au livreur pour peu de gain.

## PWA

`public/manifest.webmanifest` (installable, plein écran, portrait) et
`public/sw.js` (coquille disponible hors ligne). Le service worker ne met
**jamais** en cache les appels `/api/` : une liste de courses périmée
induirait le livreur en erreur. Il est aussi tolérant aux défaillances de
stockage — un cache impossible à écrire ne doit pas empêcher l'app de tourner.

## Limite connue

L'app cesse d'émettre sa position quand le téléphone met le navigateur en
arrière-plan ou verrouille l'écran — limite inhérente aux PWA. C'est la
principale raison d'être de l'app Android native prévue au cahier des charges.

## Identité visuelle

Charte Fiyen Delivery — noir mat, or cuivré, kraft. Les jetons (couleurs,
typographie, élévation) sont définis dans `src/index.css` et **identiques** à ceux
de `app-client` et `app-livreur`. Ils sont recopiés plutôt que partagés via un
paquet, les projets Vite étant indépendants : toute évolution de la charte doit
être répercutée dans les trois, et dans `app-livreur-mobile/src/theme.ts`.

Voir `../app-client/README.md` pour le détail des partis pris (neutres chauds,
traitement métallique de l'or, élévation en mode sombre) et les mesures de
contraste.
