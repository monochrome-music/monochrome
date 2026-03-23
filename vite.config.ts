import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import neutralino from 'vite-plugin-neutralino';
import authGatePlugin from './vite-plugin-auth-gate.js';
import path from 'path';
import uploadPlugin from './vite-plugin-upload.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';

export default defineConfig(({ mode }) => {
    const IS_NEUTRALINO = mode === 'neutralino';

    return {
        base: './',
        worker: {
            format: 'es',
        },
        resolve: {
            alias: {
                '!lucide': '/node_modules/lucide-static/icons',
                '!simpleicons': '/node_modules/simple-icons/icons',
                '!': '/node_modules',

                events: '/node_modules/events/events.js',
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
                stream: path.resolve(__dirname, 'stream-stub.js'), // Stub for stream module
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
        },
        server: {
            fs: {
                allow: ['.', 'node_modules'],
                // host: true,
                // allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
            },
        },
        // preview: {
        //     host: true,
        //     allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
        // },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            sourcemap: true,
        },
        plugins: [
            IS_NEUTRALINO && neutralino(),
            authGatePlugin(),
            uploadPlugin(),
            blobAssetPlugin(),
            svgUse(),
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
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
