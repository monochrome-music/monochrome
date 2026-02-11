import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import neutralino from 'vite-plugin-neutralino';
import authGatePlugin from './vite-plugin-auth-gate.js';

export default defineConfig(({ mode }) => {
    const IS_NEUTRALINO = mode === 'neutralino';

    return {
        base: './',
        resolve: {
            alias: {
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase'],
        },
        server: {
            fs: {
                allow: ['.', 'node_modules'],
            },
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
        },
        plugins: [
            IS_NEUTRALINO && neutralino(),
            authGatePlugin(),
            VitePWA({
                registerType: 'prompt',
                workbox: {
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
                    cleanupOutdatedCaches: true,
                    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB limit
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
                            urlPattern: ({ request }) =>
                                request.destination === 'audio' || request.destination === 'video',
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
    };
});
