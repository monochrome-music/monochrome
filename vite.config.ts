import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
            {
                name: 'proxy-audio-dev',
                configureServer(server) {
                    server.middlewares.use('/proxy-audio', (req, res, _next) => {
                        let urlParam: string | null;
                        try {
                            urlParam = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('url');
                        } catch {
                            res.writeHead(400);
                            res.end('Invalid request URL');
                            return;
                        }

                        if (!urlParam) {
                            res.writeHead(400);
                            res.end('Missing url parameter');
                            return;
                        }

                        let parsed: URL;
                        try {
                            parsed = new URL(urlParam);
                        } catch {
                            res.writeHead(400);
                            res.end('Invalid target URL');
                            return;
                        }

                        const host = parsed.hostname;
                        if (
                            (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
                            !(host === 'tidal.com' || host.endsWith('.tidal.com'))
                        ) {
                            res.writeHead(400);
                            res.end('Target host not allowed');
                            return;
                        }

                        (async () => {
                            const upstream = await fetch(urlParam!, {
                                method: req.method ?? 'GET',
                                headers: {
                                    'User-Agent':
                                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    ...(req.headers.range ? { range: req.headers.range as string } : {}),
                                },
                                redirect: 'follow',
                            });

                            const headers: Record<string, string> = {
                                'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
                                'access-control-allow-origin': '*',
                            };
                            const contentLength = upstream.headers.get('content-length');
                            const contentRange = upstream.headers.get('content-range');
                            const acceptRanges = upstream.headers.get('accept-ranges');
                            if (contentLength) headers['content-length'] = contentLength;
                            if (contentRange) headers['content-range'] = contentRange;
                            if (acceptRanges) headers['accept-ranges'] = acceptRanges;

                            res.writeHead(upstream.status, headers);

                            if (!upstream.body) {
                                res.end();
                                return;
                            }

                            const nodeStream = Readable.fromWeb(upstream.body as any);
                            req.on('close', () => nodeStream.destroy());
                            await pipeline(nodeStream, res);
                        })().catch((e: any) => {
                            if (res.writableEnded || res.destroyed) return;
                            if (!res.headersSent) {
                                res.writeHead(500);
                                res.end('Proxy error: ' + (e instanceof Error ? e.message : String(e)));
                                return;
                            }
                            res.destroy(e);
                        });
                    });
                },
            },
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
