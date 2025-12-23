//sw.js
const CACHE_NAME = 'monochrome-v3';
const IMAGE_CACHE_NAME = 'monochrome-images-v1';
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
    '/manifest.json',
    '/assets/logo.svg',
    '/assets/appicon.png'
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

    // Cache Images (Cache-First)
    if (url.hostname === 'resources.tidal.com' || url.hostname === 'picsum.photos') {
        event.respondWith(
            caches.open(IMAGE_CACHE_NAME).then(cache => {
                return cache.match(event.request).then(response => {
                    return response || fetch(event.request).then(networkResponse => {
                        if (networkResponse.ok) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

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
    const cacheWhitelist = [CACHE_NAME, IMAGE_CACHE_NAME];
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