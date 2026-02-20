import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import neutralino from 'vite-plugin-neutralino';
import authGatePlugin from './vite-plugin-auth-gate.js';

function desktopAuthPlugin() {
    const pendingTokens = new Map();
    return {
        name: 'desktop-auth',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = req.url.split('?')[0];

                if (url === '/api/auth/desktop-callback' && req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk) => (body += chunk));
                    req.on('end', () => {
                        try {
                            const { sessionId, idToken, accessToken } = JSON.parse(body);
                            if (sessionId && idToken) {
                                pendingTokens.set(sessionId, { idToken, accessToken });
                                setTimeout(() => pendingTokens.delete(sessionId), 5 * 60 * 1000);
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ ok: true }));
                            } else {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'Missing fields' }));
                            }
                        } catch {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid JSON' }));
                        }
                    });
                    return;
                }

                if (url === '/api/auth/desktop-poll' && req.method === 'GET') {
                    const parsed = new URL(req.url, 'http://localhost');
                    const sessionId = parsed.searchParams.get('sessionId');
                    const tokens = pendingTokens.get(sessionId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (tokens) {
                        pendingTokens.delete(sessionId);
                        res.end(JSON.stringify({ ok: true, idToken: tokens.idToken, accessToken: tokens.accessToken }));
                    } else {
                        res.end(JSON.stringify({ ok: false }));
                    }
                    return;
                }

                next();
            });
        },
    };
}

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
        },
        plugins: [
            IS_NEUTRALINO && neutralino(),
            desktopAuthPlugin(),
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
        ],
    };
});
