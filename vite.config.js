import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import neutralino from 'vite-plugin-neutralino';
import authGatePlugin from './vite-plugin-auth-gate.js';
import path from 'path';

export default defineConfig(({ mode }) => {
    const IS_NEUTRALINO = mode === 'neutralino';

    return {
        base: './',
        resolve: {
            alias: {
                '!': '/node_modules',
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase', '@ffmpeg/ffmpeg', '@ffmpeg/util', 'taglib-wasm'],
            external: ['taglib-wasm'],
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
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
            {
                name: 'ignore-taglib',
                resolveId(id) {
                    if (
                        id == './dist/taglib-wrapper.js' ||
                        id == '../../build/taglib-wrapper.js' ||
                        id == '../../dist/taglib-wrapper.js'
                    ) {
                        return path.resolve('node_modules/taglib-wasm/dist/taglib-wrapper.js');
                    }

                    return id;
                },
                load(id) {
                    if (id.endsWith('taglib-wasm/dist/src/worker-pool.js')) {
                        return 'export const getGlobalWorkerPool = () => { throw new Error("Worker pool is not supported in this environment"); }; export class TagLibWorkerPool { constructor() { throw new Error("Worker pool is not supported in this environment"); } } export function createWorkerPool() { throw new Error("Worker pool is not supported in this environment"); } export function terminateGlobalWorkerPool() { throw new Error("Worker pool is not supported in this environment"); }';
                    }

                    if (id.endsWith('taglib-wasm/dist/src/runtime/wasmer-sdk-loader.js')) {
                        return [
                            'export const initializeWasmer = null;',
                            'export const loadWasmerWasi = null',
                            'export const isWasmerAvailable = null;',
                            'export const WasmerExecutionError = null;',
                        ].join('\n');
                    }
                },
            },
        ],
    };
});
