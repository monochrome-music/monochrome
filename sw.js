//sw.js
const CACHE_NAME = 'monochrome-v4';
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
    '/js/router.js',
    '/js/events.js',
    '/js/ui-interactions.js',
    '/js/settings.js',
    '/js/lastfm.js',
    '/js/lyrics.js',
    '/js/downloads.js',
    '/js/db.js',
    '/js/metadata.js',
    '/manifest.json',
    '/assets/logo.svg',
    '/assets/appicon.png',
    '/assets/96.png'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Static Assets & App Shell (Cache-First)
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached response if found
                if (response) return response;

                // Otherwise fetch from network
                return fetch(event.request);
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
            ).then(() => self.clients.claim());
        })
    );
});