import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [
        VitePWA({
            registerType: 'prompt',
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
                cleanupOutdatedCaches: true,
                // Define runtime caching strategies
                runtimeCaching: [
                    {
                        urlPattern: ({ request }) => request.destination === 'image',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'images',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                            },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'audio' || request.destination === 'video',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'media',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                            },
                            rangeRequests: true, // Support scrubbing
                        },
                    },
                ],
            },
            includeAssets: ['instances.json', 'discord.html'],
            manifest: false, // Use existing public/manifest.json
        }),
    ],
});
