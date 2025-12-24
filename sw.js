//sw.js
const CACHE_NAME = 'monochrome-v2';
const urlsToCache = [
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
    '/manifest.json'
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Force activation
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
            .catch(() => {
                // Return 404 or handle offline fallback here if needed
                // For now, just ensuring the promise doesn't reject uncaught
                return new Response('Network error', { status: 408 });
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            ).then(() => self.clients.claim()); // Take control immediately
        })
    );
});