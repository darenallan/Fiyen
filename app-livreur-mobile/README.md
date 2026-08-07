# App livreur — Android (Expo)

Application native du livreur. Sa raison d'être tient en une ligne : **elle
continue de transmettre la position écran verrouillé**, ce que la PWA
(`../app-livreur`) ne peut structurellement pas faire.

Voir `../CLAUDE.md` pour le contexte produit, `../backend/README.md` pour l'API.

## Pourquoi Expo et pas Kotlin

Écart assumé par rapport au choix initial du cahier des charges (Kotlin natif) :

- Le reste du projet est en React/TypeScript — Kotlin aurait été une 5ᵉ techno à
  maintenir pour une seule application.
- Le seul besoin réellement natif, le GPS en arrière-plan, est couvert par
  `expo-location` + foreground service Android.
- EAS Update permet de corriger une flotte de livreurs sans passer par le Play
  Store, ce qui compte quand on ne peut pas récupérer les téléphones.

**Ce que ça ne remplace pas :** la PWA reste indispensable. Expo SDK 57 exige
**Android 7+ (API 24)**, et le cahier des charges impose de ne pas dépendre
uniquement du natif sur le parc de téléphones économiques.

## Démarrage

```bash
cp .env.example .env
npm install
npx expo start
```

Deux points de configuration importants :

- **`localhost` ne fonctionne pas depuis un téléphone.** Renseigner l'IP de la
  machine de développement sur le réseau local dans `.env` :
  `EXPO_PUBLIC_API_URL=http://192.168.x.x:8090`, et ajouter cette origine à
  `CORS_ORIGINS` côté backend.
- **Le suivi en arrière-plan ne marche pas dans Expo Go.** Il faut un
  *development build* :

  ```bash
  npx expo run:android      # ou : eas build --profile development --platform android
  ```

## Suivi de position

`src/tracking.ts`. La tâche est enregistrée **au chargement du module**, hors de
tout composant React : le système peut relancer l'app en arrière-plan pour un
évènement de position, et la tâche doit alors déjà exister.

- Capture toutes les **4 s** (fourchette 3-5 s du cahier des charges), via un
  foreground service Android — la notification persistante « service en cours »
  est ce qui autorise le suivi écran éteint.
- **Économie de données**, filtrage identique à la PWA : position ignorée en
  dessous de **15 m** de déplacement, avec un envoi forcé toutes les 20 s pour
  maintenir la présence (le backend déclare hors ligne après 30 s de silence).
- **Dépôt par lots** (`POST /api/livreurs/me/positions`) toutes les ~15 s ou
  tous les 4 points : une requête HTTP par position coûterait plus cher en
  en-têtes qu'en coordonnées. C'est aussi pourquoi le mobile n'utilise pas le
  WebSocket de la PWA — une tâche d'arrière-plan, réveillée par lots, ne peut
  pas maintenir une socket ouverte de façon fiable.
- **Coupure réseau** : les positions s'empilent dans AsyncStorage (max 300) et
  repartent au réveil suivant de la tâche. Chaque position porte son horodatage
  de capture ; le backend refuse d'écraser une position plus récente par un
  rejeu tardif.

Le jeton d'authentification vit lui aussi dans AsyncStorage : la tâche doit
pouvoir s'authentifier seule, sans contexte React.

## Autorisations

L'autorisation d'arrière-plan est demandée **après** celle de premier plan —
Android refuse l'inverse. Si l'utilisateur refuse « Toujours », l'app le signale
explicitement : sans elle, le suivi s'arrête à l'extinction de l'écran, et c'est
tout l'intérêt de cette application qui disparaît.

## État de vérification

Le bundle Android se construit et la configuration native se génère correctement
(permissions et `LocationTaskService` avec `foregroundServiceType="location"`
présents au manifeste). En revanche, **le comportement en arrière-plan n'a pas
été validé sur un appareil réel** — cela demande un development build installé
sur un téléphone Android. C'est la vérification à faire en priorité avant de
s'appuyer sur cette app.
