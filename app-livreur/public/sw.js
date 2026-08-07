// Service worker de l'app livreur.
//
// Rôle volontairement limité : rendre la coquille de l'app disponible hors ligne
// (réseau mobile instable au Burkina Faso). Les appels API et le WebSocket ne
// sont jamais mis en cache — les positions en attente sont gérées côté app dans
// localStorage, pas ici, car elles doivent survivre à une mise à jour du worker.

const CACHE = 'fiyen-livreur-v1';
const COQUILLE = ['/', '/index.html', '/manifest.webmanifest', '/icone-192.png', '/icone-512.png'];

self.addEventListener('install', (event) => {
  // Volontairement tolérant : `cache.addAll` rejette en bloc dès qu'une seule
  // ressource échoue (stockage plein, navigation privée, 404), ce qui ferait
  // échouer l'installation et priverait le livreur de tout service worker.
  // On met donc en cache au mieux, et l'app reste fonctionnelle en ligne même
  // si la mise en cache n'a pas abouti.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(COQUILLE.map((url) => cache.add(url))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Jamais de cache sur l'API : une liste de courses périmée induirait le
  // livreur en erreur. Hors ligne, l'app garde son dernier état en mémoire.
  if (url.pathname.startsWith('/api/') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Navigation : réseau d'abord, cache en secours (appli utilisable hors ligne).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match('/index.html')
          .catch(() => undefined)
          .then((r) => r ?? Response.error()),
      ),
    );
    return;
  }

  // Ressources statiques : cache d'abord, puis réseau. Toute défaillance du
  // stockage est absorbée — elle ne doit jamais empêcher de servir la requête.
  event.respondWith(
    caches
      .match(request)
      .catch(() => undefined)
      .then(
        (enCache) =>
          enCache ??
          fetch(request).then((reponse) => {
            if (reponse.ok && url.origin === self.location.origin) {
              const copie = reponse.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(request, copie))
                .catch(() => undefined);
            }
            return reponse;
          }),
      ),
  );
});
