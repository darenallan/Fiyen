# Fiyen — mettre en ligne (HTTPS)

> Écrit le 22/10/2026 pour Daren. **Rien n'a été déployé** et aucun compte
> n'a été créé (hormis le projet Expo pour l'APK). Les prix viennent de
> recherches faites le 22/10/2026 : ils changent souvent, et plusieurs sources
> se contredisent. Tout ce qui est marqué **à vérifier** doit être reconfirmé
> sur le site de l'hébergeur avant de payer quoi que ce soit.

---

## 1. En bref

| Quoi | Où (proposition) | Coût de départ | Coût « pilote sérieux » |
| --- | --- | --- | --- |
| 4 interfaces web (dashboard, partenaire, livreur, suivi) | Cloudflare Pages | 0 $ | 0 $ |
| API Go (+ temps réel WebSocket) | Render | 0 $ (se met en veille) | ~7 $/mois, Starter, toujours allumé (**à vérifier**) |
| Base PostgreSQL + PostGIS | Neon | 0 $ (0,5 à 1 Go) | selon le volume : offre payante Neon **à vérifier** |
| Redis (présence + diffusion des positions) | Upstash | 0 $ (500 000 commandes/mois) | ~10 $/mois (offre fixe) ou au volume (**à vérifier**) |
| Nom de domaine | registraire au choix | 0 $ avec les adresses gratuites `*.pages.dev` et `*.onrender.com` | ~10 à 15 $/an pour un `.com` (**à vérifier** ; `.bf` à vérifier séparément) |
| **Total** | | **0 $** pour une démo en ligne | **~20 à 40 $/mois** pour un pilote (**à vérifier**) |

Une alternative moins chère pour un pilote, mais qui demande plus d'entretien,
est décrite au §5 (un seul petit serveur).

---

## 2. Pourquoi le HTTPS est obligatoire

Ce n'est pas une option de confort : sans HTTPS, des pièces du produit
**ne fonctionnent pas** dans le navigateur d'un téléphone.

| Fonction | Sans HTTPS |
| --- | --- |
| Position GPS de l'app livreur web | **refusée** par le navigateur (« contexte non sécurisé ») |
| Installer l'app sur l'écran d'accueil (PWA) | **impossible** |
| Mode hors ligne (service worker) | **désactivé** |
| Notifications web | **impossibles** |
| Mots de passe et jetons de session | voyagent **lisibles** sur le réseau |

Exception : `localhost` sur le PC lui-même est considéré comme sûr. C'est
pourquoi tout marche en développement, et pourquoi le GPS de l'app livreur
web ne marche **pas** quand on l'ouvre sur un téléphone par l'IP du PC.

---

## 3. Quoi héberger, dossier par dossier

### `backend/` — l'API

- **Construire** : `go build -o api ./cmd/api` (dossier `backend`).
- **Démarrer** : `./api`. Elle lit le port dans `PORT`, que Render fournit.
- **Migrations** : `go run ./cmd/migrate` avec `DATABASE_URL` pointant sur la
  base en ligne. À lancer **avant** chaque mise en ligne qui en ajoute une
  (14 migrations aujourd'hui, la dernière : `0014_baremes_livraison.sql`).
  La première active PostGIS (`CREATE EXTENSION IF NOT EXISTS postgis`).
- **Sondes** : `/health/live` (le processus tourne) pour la sonde de vie,
  `/health` (Postgres et Redis répondent) pour la disponibilité. Ne pas les
  inverser (voir `CLAUDE.md`).
- **Temps réel** : WebSocket (`/ws/...`) et Redis pub/sub. L'hébergeur doit
  garder les connexions longues : c'est le cas de Render. Une offre qui se
  met en veille coupe les WebSockets et les tâches de fond (purges).

| Variable | Valeur en ligne |
| --- | --- |
| `DATABASE_URL` | URL fournie par Neon (contient `sslmode=require`) |
| `REDIS_ADDR` | URL fournie par Upstash, forme `rediss://default:…@….upstash.io:6379` (le `rediss` active le chiffrement ; pris en charge depuis le 22/10) |
| `REDIS_PASSWORD` | vide si le mot de passe est dans l'URL |
| `JWT_SECRET` | **nouveau secret long et aléatoire**, jamais celui de développement. Le générer : `openssl rand -hex 32` |
| `JWT_DUREE_MINUTES` | `30` |
| `REFRESH_DUREE_JOURS` | `30` |
| `PURGE_INTERVALLE_HEURES` | `24` |
| `POSITION_TTL_SECONDES` | `30` |
| `MASQUAGE_DUREE_HEURES` | `4` |
| `TRACES_RETENTION_JOURS` | `30` sur l'offre gratuite de Neon (voir le calcul au §5), `90` ensuite |
| `CORS_ORIGINS` | les 4 adresses HTTPS des interfaces, séparées par des virgules, sans `/` final |
| `URL_PUBLIQUE` | `https://api.<domaine>` (c'est elle qui fabrique les liens de reçu WhatsApp) |
| `EXPO_ACCESS_TOKEN` | vide tant que la sécurité push n'est pas activée sur Expo |

**Cookies** : aucun. Les sessions passent par un en-tête `Authorization`
(jeton stocké par chaque application), donc rien à régler pour partager des
cookies entre sous-domaines. Le CORS suffit.

### Les 4 interfaces web

| Dossier | Sous-domaine proposé | Pour qui |
| --- | --- | --- |
| `dashboard/` | `app.<domaine>` | la compagnie |
| `app-partenaire/` | `partenaire.<domaine>` | les entreprises clientes |
| `app-livreur/` | `livreur.<domaine>` | les livreurs (version web, installable) |
| `app-client/` | `suivi.<domaine>` | les destinataires |

Pour chacune :

- **Construire** : `npm ci && npm run build` → le site est dans `dist/`.
- **Variables au moment du build** (elles sont inscrites dans le site) :
  - `VITE_API_BASE_URL=https://api.<domaine>`
  - `VITE_WS_BASE_URL=wss://api.<domaine>`
- **Applications à page unique** : Cloudflare Pages renvoie `index.html` pour
  les adresses comme `/tarifs` tant qu'il n'y a pas de `404.html` dans le
  dossier publié (c'est le cas ici).
- L'app livreur web devient **installable** (« Ajouter à l'écran d'accueil »)
  une fois en HTTPS : son service worker n'est actif qu'en production.

---

## 4. Domaine

- **Sans domaine (0 $)** : les adresses gratuites suffisent pour une démo
  (`fiyen-dashboard.pages.dev`, `fiyen-api.onrender.com`…). Elles font moins
  sérieux devant un client, et changer ensuite oblige à mettre à jour le CORS,
  `URL_PUBLIQUE` et les variables des 4 sites.
- **Avec un domaine** : 5 sous-domaines (`api`, `app`, `partenaire`,
  `livreur`, `suivi`). Si le domaine est géré par Cloudflare, chaque
  sous-domaine se branche en quelques clics, HTTPS automatique compris.

---

## 5. Les options, et ce qu'elles coûtent vraiment

### Ce que Fiyen consomme (estimation)

- **Redis** : environ 4 commandes par position GPS (présence + diffusion sur
  deux canaux). Avec **5 livreurs** pendant 8 h, une position toutes les 4 s :
  5 × 7 200 × 4 ≈ **144 000 commandes par jour**, soit ~4,3 millions par
  mois. L'offre gratuite d'Upstash (500 000 par mois) tient **3 à 4 jours** de
  pilote : elle ne convient qu'à la démo. Au volume, 0,20 $ les 100 000 →
  ~9 $/mois ; offre fixe à partir de ~10 $/mois (**à vérifier**).
- **Base** : la table des traces GPS reçoit ~7 000 lignes par livreur et par
  jour, de l'ordre de 1 Mo. 5 livreurs × 90 jours ≈ 450 Mo : l'offre gratuite
  de Neon (0,5 à 1 Go selon les sources) sature. D'où
  `TRACES_RETENTION_JOURS=30` tant qu'on reste en gratuit.

### Option A — Démo en ligne à 0 $

| Pièce | Service | Limites à connaître |
| --- | --- | --- |
| Interfaces | Cloudflare Pages, gratuit | 500 builds/mois, 20 000 fichiers par site (largement suffisant) |
| API | Render, offre gratuite | **mise en veille après 15 min sans visite**, ~1 min pour se réveiller ; 750 h/mois ; disque effacé à chaque redémarrage (sans effet ici : tout est en base) |
| Base | Neon, offre gratuite | 0,5 à 1 Go ; calcul suspendu si les quotas mensuels sont dépassés ; PostGIS pris en charge d'après une source tierce, **à vérifier** sur la documentation Neon |
| Redis | Upstash, offre gratuite | 500 000 commandes/mois (voir calcul) |

Bien pour : montrer Fiyen à un client depuis n'importe où. Mauvais pour : un
vrai pilote (veille de l'API, quota Redis).

> **Ne pas** prendre la base PostgreSQL gratuite de Render : elle expire au
> bout de 30 jours (90 selon une autre source, **à vérifier**).

### Option B — Pilote sérieux, services gérés (~20 à 40 $/mois, à vérifier)

- Interfaces : Cloudflare Pages, toujours gratuit.
- API : Render **Starter** (~7 $/mois, 512 Mo, toujours allumée — **à vérifier**).
- Base : Neon, offre payante d'entrée si le volume dépasse le gratuit
  (**prix à vérifier**).
- Redis : Upstash au volume ou en offre fixe (~10 $/mois, **à vérifier**).
- Domaine : ~10 à 15 $/an (**à vérifier**).

Avantages : pas de serveur à entretenir, sauvegardes de base fournies par
Neon. Inconvénient : quatre comptes à gérer.

### Option C — Un seul petit serveur (VPS), le moins cher pour un pilote

Un serveur virtuel de 2 Go de RAM (de l'ordre de 5 à 10 €/mois chez un
hébergeur européen, **à vérifier**) fait tourner le même `docker compose`
qu'en local (PostGIS + Redis), plus l'API, derrière **Caddy**, qui obtient et
renouvelle seul les certificats HTTPS. Les interfaces restent sur Cloudflare
Pages.

- Avantages : coût fixe et bas, pas de quota Redis, pas de veille.
- Inconvénients : **les sauvegardes, les mises à jour de sécurité et la
  surveillance sont à votre charge**. À ne choisir que si quelqu'un s'en occupe
  vraiment chaque semaine.

**Recommandation** : option A pour montrer Fiyen en ligne cette semaine,
option B pour le premier pilote payant.

*Autres hébergeurs regardés* : Fly.io n'a plus d'offre gratuite pour un
nouveau compte (essai de quelques heures) ; l'offre gratuite de Koyeb ne
semble plus inclure de calcul (sources contradictoires, **à vérifier**).

---

## 6. Mise en ligne pas à pas (option A puis B)

Tout ce qui suit est **à faire par Daren** : création de comptes, saisie de
secrets, paiements éventuels.

1. **Code sur GitHub (dépôt privé)**. Render et Cloudflare Pages se
   branchent sur un dépôt Git. Relire d'abord ce qui n'est pas commité
   (`PRESENTATION.md` §12), puis committer et pousser. **Vérifier qu'aucun
   `.env` ni `google-services.json` ne part** (les `.env` sont dans `.gitignore`).
2. **Base — Neon** : créer un compte, puis un projet. Choisir la région la
   plus proche du Burkina disponible (Europe). Copier l'URL de connexion.
3. **Migrations** depuis le PC, dans `backend/` :
   `DATABASE_URL="<url Neon>" go run ./cmd/migrate`.
   Si la toute première échoue sur PostGIS, l'extension n'est pas disponible
   sur l'offre : il faut changer d'option (B ou C).
4. **Redis — Upstash** : créer une base Redis (région Europe), copier l'URL
   `rediss://…`.
5. **API — Render** : nouveau « Web Service » sur le dépôt, dossier racine
   `backend`, build `go build -o api ./cmd/api`, démarrage `./api`, sonde
   `/health`. Renseigner les variables du §3 (sans `PORT`, Render le fournit).
6. **Test de l'API** : `https://<api>/health` doit afficher `"statut":"ok"`
   avec postgres et redis à `true`.
7. **Interfaces — Cloudflare Pages** : un projet par dossier (dossier racine
   `dashboard`, etc.), build `npm ci && npm run build`, dossier publié `dist`,
   variables `VITE_API_BASE_URL` et `VITE_WS_BASE_URL`. Sans Git, possible
   aussi en dépôt direct : `npx wrangler pages deploy dist`.
8. **CORS** : mettre les 4 adresses obtenues dans `CORS_ORIGINS` sur Render,
   et `URL_PUBLIQUE`. Redémarrer l'API.
9. **Données** :
   - **Production réelle** : **ne pas** lancer le jeu de démo. Créer la
     compagnie depuis l'écran « Créer un compte » du dashboard, puis ses
     livreurs et partenaires.
   - **Démo en ligne** : une base **séparée** pour la démo. Le script de démo
     exécute du SQL via `go run ./cmd/sql`, qui lit `DATABASE_URL` : le lancer
     depuis `backend/` avec `DATABASE_URL` de la base de démo et
     `API=https://<api de démo> node scripts/seed-demo.mjs`. Ne jamais mélanger
     démo et vraies données.
10. **Test de fumée** (10 min, sur un téléphone en 4G, pas en Wi-Fi) :
    - se connecter au dashboard, créer une course ;
    - app livreur web : prendre son service, **le GPS doit être demandé** ;
    - assigner, voir le livreur bouger sur la carte du dashboard ;
    - app de suivi : la carte et la messagerie fonctionnent ;
    - reçu partagé : le lien `https://<api>/r/...` s'ouvre sur un autre téléphone.
11. **Domaine** (facultatif au début) : acheter, brancher les 5
    sous-domaines, mettre à jour CORS, `URL_PUBLIQUE` et les variables `VITE_*`,
    puis relancer les builds.

---

## 7. Sauvegardes

- **Neon** garde un historique permettant une restauration à un instant
  donné (durée selon l'offre, **à vérifier**). Ce n'est pas une sauvegarde
  indépendante.
- **Sauvegarde indépendante**, une fois par semaine au minimum (par jour en
  pilote), depuis le PC :
  `pg_dump "<url Neon>" -Fc -f fiyen-AAAA-MM-JJ.dump`.
  Garder les fichiers hors du PC (disque externe, stockage en ligne).
- **Une sauvegarde qui n'a jamais été restaurée ne compte pas** (voir D7 dans
  `ROADMAP.md`) : une fois par mois, restaurer dans une base de test,
  `pg_restore -d "<url base de test>" fiyen-….dump`, puis vérifier qu'on s'y
  connecte.
- Redis ne contient rien à sauvegarder (présence et diffusion, éphémères).

## 8. Retour arrière

- **API** : Render garde les déploiements précédents. Bouton « Rollback »
  sur le précédent.
- **Interfaces** : Cloudflare Pages garde chaque déploiement. « Rollback » en
  un clic.
- **Base** : les migrations ne se défont pas. **Avant chaque migration** :
  `pg_dump` (§7). En cas de problème : restaurer ce fichier, puis revenir à la
  version précédente de l'API.

---

## 9. Ensuite : l'APK pointe vers l'API HTTPS

L'APK de test pointe par défaut vers le PC (`http://192.168.11.117:8090`).
Deux façons de la faire pointer vers l'API en ligne :

- **Sans rebuild** : sur l'écran de connexion de l'app, « Modifier l'adresse
  du serveur » → `https://api.<domaine>` → « Tester et enregistrer ».
  L'adresse est gardée sur le téléphone.
- **Pour tous les livreurs** : ajouter dans `app-livreur-mobile/eas.json` un
  profil avec `"EXPO_PUBLIC_API_URL": "https://api.<domaine>"`, retirer
  `usesCleartextTraffic` de `app.json` (le HTTP en clair n'est utile que vers
  le PC de test), puis `eas build -p android --profile <profil>`.

Pour les notifications push, il faut en plus Firebase : voir
`PRESENTATION.md`, §13, « étapes pour Daren ».

---

## Sources consultées le 22/10/2026

- Render, offre gratuite : [render.com/docs/free](https://render.com/docs/free) ;
  tarifs relevés par des tiers : [temps.sh](https://temps.sh/blog/render-pricing-2026),
  [kuberns.com](https://kuberns.com/blogs/render-pricing/)
- Neon : [neon.com/pricing](https://neon.com/pricing),
  [releases.sh (stockage gratuit porté à 1 Go)](https://releases.sh/collections/serverless-postgres/digest/2026-09-28),
  [guide tiers mentionnant PostGIS](https://guptadeepak.com/guides/migrate-supabase-postgres-to-neon/)
- Upstash : [upstash.com/pricing/redis](https://upstash.com/pricing/redis),
  [documentation de facturation](https://upstash.com/docs/redis/overall/billing)
- Cloudflare Pages : [developers.cloudflare.com/pages/platform/limits](https://developers.cloudflare.com/pages/platform/limits)
- Fly.io et Koyeb : [comparatif tiers, septembre 2026](https://flaviocopes.com/hosting-free-tiers/),
  [getdeploying.com](https://getdeploying.com/flyio-vs-koyeb)
