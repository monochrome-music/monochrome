import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import path from 'path';
import uploadPlugin from './vite-plugin-upload.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';
// import purgecss from 'vite-plugin-purgecss';
import purgecss from 'vite-plugin-purgecss';
import { execSync } from 'child_process';
import { playwright } from '@vitest/browser-playwright';
import type { IncomingMessage, ServerResponse } from 'http';

function proxyAudioPlugin() {
    return {
        name: 'proxy-audio-dev',
        configureServer(server) {
            server.middlewares.use('/proxy', async (req: IncomingMessage, res: ServerResponse) => {
                const url = new URL(req.url ?? '', 'http://localhost');
                const targetUrl = url.searchParams.get('url');

                if (!targetUrl) {
                    res.writeHead(400);
                    res.end('Missing url parameter');
                    return;
                }

                try {
                    const headers = new Headers();
                    headers.set('Origin', 'https://listen.tidal.com');
                    headers.set('User-Agent', req.headers['user-agent']);

                    const upstream = await fetch(targetUrl, {
                        method: req.method,
                        headers,
                        redirect: 'follow',
                    });

                    const resHead = new Headers(upstream.headers);
                    Object.entries({
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                        'Access-Control-Expose-Headers': '*',
                    }).forEach(([key, value]) => resHead.set(key, value));

                    res.writeHead(upstream.status, { ...Object.fromEntries(resHead.entries()) });

                    const reader = upstream.body?.getReader();

                    if (reader) {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            await res.write(value);
                        }
                    }

                    res.end();
                } catch (error) {
                    res.writeHead(500);
                    res.end('Proxy Error: ' + error.message);
                }
            });
        },
    };
}

function getGitCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'unknown';
    }
}

export default defineConfig((_options) => {
    const commitHash = getGitCommitHash();

    return {
        test: {
            // https://vitest.dev/guide/browser/
            browser: {
                enabled: true,
                provider: playwright(),
                headless: !!process.env.HEADLESS,
                instances: [{ browser: 'chromium' }],
            },
        },
        base: './',
        define: {
            __COMMIT_HASH__: JSON.stringify(commitHash),
            __VITEST__: !!process.env.VITEST,
            __VITE_PROXY__: JSON.stringify(
                _options.mode == 'development' ? '/proxy' : 'https://audio-proxy.binimum.org/proxy-audio'
            ),
        },
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
            minify: 'terser',
            terserOptions: {
                compress: {
                    drop_console: true,
                    drop_debugger: true,
                },
            },
            rollupOptions: {
                treeshake: true,
            },
        },
        plugins: [
            proxyAudioPlugin(),
            purgecss({
                variables: false, // DO NOT REMOVE UNUSED VARIABLES (breaks web components like am-lyrics)
                safelist: {
                    standard: [
                        /^am-lyrics/,
                        /^lyplus-/,
                        'sidepanel',
                        'side-panel',
                        'active',
                        'show',
                        /^data-/,
                        /^modal-/,
                    ],
                    deep: [/^am-lyrics/],
                    greedy: [/^lyplus-/, /sidepanel/, /side-panel/],
                },
            }),
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
