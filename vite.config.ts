import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';
import uploadPlugin from './vite-plugin-upload.js';
// import purgecss from 'vite-plugin-purgecss';
import { playwright } from '@vitest/browser-playwright';
import { execSync } from 'child_process';
import purgecss from 'vite-plugin-purgecss';

function proxyAudioPlugin() {
    const REQUEST_HEADER_BLOCKLIST = new Set([
        'host',
        'origin',
        'referer',
        'cookie',
        'connection',
        'upgrade',
        'te',
        'trailer',
        'transfer-encoding',
    ]);
    return {
        name: 'proxy-audio-dev',
        configureServer(server) {
            server.middlewares.use('/proxy-audio', async (req, res) => {
                const reqUrl = new URL(req.url || '/', 'http://localhost');
                const target = reqUrl.searchParams.get('url');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204, {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                        'Access-Control-Allow-Headers': '*',
                        'Access-Control-Max-Age': '86400',
                    });
                    res.end();
                    return;
                }

                if (!target) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Missing url parameter');
                    return;
                }

                let parsed;
                try {
                    parsed = new URL(target);
                } catch {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid url parameter');
                    return;
                }
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Only http(s) URLs are allowed');
                    return;
                }

                const forwardHeaders: Record<string, string> = {};
                for (const [key, value] of Object.entries(req.headers)) {
                    if (REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
                    if (Array.isArray(value)) forwardHeaders[key] = value.join(', ');
                    else if (value != null) forwardHeaders[key] = String(value);
                }
                forwardHeaders['user-agent'] =
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

                let upstream;
                try {
                    upstream = await fetch(target, {
                        method: req.method,
                        headers: forwardHeaders,
                        redirect: 'follow',
                    });
                } catch (e: any) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end('Upstream fetch failed: ' + (e?.message || 'unknown'));
                    return;
                }

                const outHeaders: Record<string, string> = {};
                upstream.headers.forEach((value, key) => {
                    const k = key.toLowerCase();
                    if (k === 'set-cookie' || k === 'content-security-policy' || k === 'x-frame-options') return;
                    outHeaders[key] = value;
                });
                outHeaders['Access-Control-Allow-Origin'] = '*';
                outHeaders['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
                outHeaders['Access-Control-Expose-Headers'] = '*';

                res.writeHead(upstream.status, outHeaders);

                if (!upstream.body) {
                    res.end();
                    return;
                }
                const reader = upstream.body.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (!res.write(Buffer.from(value))) {
                            await new Promise((resolve) => res.once('drain', resolve));
                        }
                    }
                } catch {
                    // client disconnected — ignore
                } finally {
                    res.end();
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
