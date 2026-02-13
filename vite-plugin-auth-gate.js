import { loadEnv } from 'vite';
import cookieSession from 'cookie-session';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

export default function authGatePlugin() {
    let env = {};

    return {
        name: 'auth-gate',

        config(_, { mode }) {
            env = loadEnv(mode, process.cwd(), '');
        },

        configurePreviewServer(server) {
            const AUTH_ENABLED = (env.AUTH_ENABLED ?? 'false') !== 'false';
            const FIREBASE_CONFIG = env.FIREBASE_CONFIG;
            const POCKETBASE_URL = env.POCKETBASE_URL;
            const AUTH_GOOGLE_ENABLED = env.AUTH_GOOGLE_ENABLED;
            const AUTH_EMAIL_ENABLED = env.AUTH_EMAIL_ENABLED;

            // Parse Firebase config once (used for injection + auth verification)
            let parsedFirebaseConfig = null;
            let PROJECT_ID = env.FIREBASE_PROJECT_ID || 'monochrome-database';
            if (FIREBASE_CONFIG) {
                try {
                    parsedFirebaseConfig = JSON.parse(FIREBASE_CONFIG);
                    if (parsedFirebaseConfig.projectId) PROJECT_ID = parsedFirebaseConfig.projectId;
                } catch (e) {
                    console.error('Invalid FIREBASE_CONFIG JSON:', e.message);
                    process.exit(1);
                }
            }

            // --- Build injection script (always, for both auth gate and env config) ---

            const flags = [];
            if (AUTH_ENABLED) flags.push('window.__AUTH_GATE__=true');
            const authProviderOverrides = {};
            if (AUTH_GOOGLE_ENABLED !== undefined) {
                authProviderOverrides.google = AUTH_GOOGLE_ENABLED !== 'false';
            }
            if (AUTH_EMAIL_ENABLED !== undefined) {
                // Firebase calls it "password" provider; env uses "EMAIL" for clarity
                authProviderOverrides.password = AUTH_EMAIL_ENABLED !== 'false';
            }
            if (Object.keys(authProviderOverrides).length > 0) {
                flags.push(`window.__AUTH_PROVIDERS__=${JSON.stringify(authProviderOverrides)}`);
            }
            if (parsedFirebaseConfig) flags.push(`window.__FIREBASE_CONFIG__=${JSON.stringify(parsedFirebaseConfig)}`);
            if (POCKETBASE_URL) flags.push(`window.__POCKETBASE_URL__=${JSON.stringify(POCKETBASE_URL)}`);
            const configScript = flags.length > 0 ? `<script>${flags.join(';')};</script>` : null;

            // --- Pre-build injected HTML pages ---

            const distDir = join(process.cwd(), 'dist');

            let indexHtml = null;
            const indexPath = join(distDir, 'index.html');
            if (configScript && existsSync(indexPath)) {
                indexHtml = readFileSync(indexPath, 'utf-8');
                indexHtml = indexHtml.replace('</head>', `${configScript}\n</head>`);
            }

            let loginHtml = null;
            if (AUTH_ENABLED) {
                const loginPath = join(distDir, 'login.html');
                if (existsSync(loginPath)) {
                    loginHtml = readFileSync(loginPath, 'utf-8');
                    if (configScript) loginHtml = loginHtml.replace('</head>', `${configScript}\n</head>`);
                }
            }

            // --- /health (always available) ---

            server.middlewares.use((req, res, next) => {
                if (req.url.split('?')[0] === '/health') {
                    res.end('OK');
                    return;
                }
                next();
            });

            // --- Auth gate (only when enabled) ---

            if (AUTH_ENABLED) {
                const AUTH_SECRET = env.AUTH_SECRET;
                const SESSION_MAX_AGE = Number(env.SESSION_MAX_AGE) || 7 * 24 * 60 * 60 * 1000;

                if (!AUTH_SECRET) {
                    console.error('AUTH_SECRET is required when AUTH_ENABLED=true');
                    process.exit(1);
                }

                console.log(`Auth gate enabled (Firebase project: ${PROJECT_ID})`);

                const JWKS = createRemoteJWKSet(
                    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
                );

                server.middlewares.use(
                    cookieSession({
                        name: 'mono_session',
                        keys: [AUTH_SECRET],
                        maxAge: SESSION_MAX_AGE,
                        httpOnly: true,
                        sameSite: 'lax',
                    })
                );

                server.middlewares.use(async (req, res, next) => {
                    const url = req.url.split('?')[0];

                    if (url === '/login' || url === '/login.html') {
                        if (req.session && req.session.uid) {
                            res.writeHead(302, { Location: '/' });
                            res.end();
                            return;
                        }
                        if (loginHtml) {
                            res.setHeader('Content-Type', 'text/html');
                            res.setHeader('Cache-Control', 'no-store');
                            res.end(loginHtml);
                        } else {
                            res.statusCode = 404;
                            res.end('Login page not found');
                        }
                        return;
                    }

                    if (url === '/api/auth/login' && req.method === 'POST') {
                        try {
                            const body = await parseBody(req);
                            if (!body.token) {
                                res.statusCode = 400;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify({ error: 'Missing token' }));
                                return;
                            }
                            const { payload } = await jwtVerify(body.token, JWKS, {
                                issuer: `https://securetoken.google.com/${PROJECT_ID}`,
                                audience: PROJECT_ID,
                            });
                            req.session.uid = payload.sub;
                            req.session.email = payload.email;
                            req.session.iat = Date.now();
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ ok: true }));
                        } catch (err) {
                            console.error('Token verification failed:', err.message);
                            res.statusCode = 401;
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ error: 'Invalid token' }));
                        }
                        return;
                    }

                    if (url === '/api/auth/logout' && req.method === 'POST') {
                        req.session = null;
                        res.setHeader('Clear-Site-Data', '"cache", "storage"');
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ ok: true }));
                        return;
                    }

                    if (!req.session || !req.session.uid) {
                        const ext = extname(url);
                        if (ext && ext !== '.html') {
                            res.statusCode = 401;
                            res.end('Unauthorized');
                        } else {
                            res.writeHead(302, { Location: '/login' });
                            res.end();
                        }
                        return;
                    }

                    // Authenticated: serve injected index.html for HTML routes
                    const ext = extname(url);
                    if ((!ext || ext === '.html') && indexHtml) {
                        res.setHeader('Content-Type', 'text/html');
                        res.setHeader('Cache-Control', 'no-store');
                        res.end(indexHtml);
                        return;
                    }

                    next();
                });
            } else if (indexHtml) {
                // No auth gate, but env config needs injection into HTML
                server.middlewares.use((req, res, next) => {
                    const url = req.url.split('?')[0];
                    const ext = extname(url);
                    if (!ext || ext === '.html') {
                        res.setHeader('Content-Type', 'text/html');
                        res.end(indexHtml);
                        return;
                    }
                    next();
                });
            }
        },
    };
}
