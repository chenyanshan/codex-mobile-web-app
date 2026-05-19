const STATIC_CACHE = 'codex-web-static-2026-05-19-thread-activity-details-v16';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/pwa-pull-refresh.js',
  '/app.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          event.waitUntil(
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone())),
          );
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
