// sw.js
const SW_VERSION = 'monochrome-v9'; // Note To Self: Change Every Deploy
const CACHE_NAME = `monochrome-${SW_VERSION}`;

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',

  '/js/app.js',
  '/js/api.js',
  '/js/player.js',
  '/js/storage.js',
  '/js/ui.js',
  '/js/utils.js',
  '/js/cache.js',
  '/js/router.js',
  '/js/events.js',
  '/js/ui-interactions.js',
  '/js/settings.js',
  '/js/lastfm.js',
  '/js/lyrics.js',
  '/js/downloads.js',
  '/js/db.js',
  '/js/metadata.js',
  '/js/vibrant-color.js',

  '/manifest.json',
  '/assets/logo.svg',
  '/assets/appicon.png',
  '/assets/96.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req)
    )
  );
});
