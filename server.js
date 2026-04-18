// server.js — Production server for Railway: serves the built Vite app
// and provides a CORS-enabled /proxy-audio?url=... passthrough so the
// <audio crossorigin="anonymous"> element can fetch Tidal streams without
// browser CORS errors, and Web Audio can tap the graph.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.gz': 'application/gzip',
    '.br': 'application/brotli',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
};

function sendNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
}

function serveStatic(req, res) {
    // Strip query string, normalize
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const safePath = path.normalize(path.join(DIST_DIR, urlPath));
    if (!safePath.startsWith(DIST_DIR)) {
        sendNotFound(res);
        return;
    }

    fs.stat(safePath, (err, stat) => {
        if (err || !stat.isFile()) {
            // SPA fallback — serve index.html for unknown paths
            const indexPath = path.join(DIST_DIR, 'index.html');
            fs.readFile(indexPath, (readErr, data) => {
                if (readErr) {
                    sendNotFound(res);
                    return;
                }
                res.writeHead(200, { 'Content-Type': MIME['.html'] });
                res.end(data);
            });
            return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(safePath).pipe(res);
    });
}

// Hop-by-hop + security-sensitive headers we strip before forwarding upstream
const REQUEST_HEADER_BLOCKLIST = new Set([
    'host',
    'origin',
    'referer',
    'cookie',
    'connection',
    'upgrade',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
    'x-railway-edge',
    'x-railway-request-id',
    'x-request-start',
]);

async function handleProxyAudio(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const target = url.searchParams.get('url');

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

    const forwardHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
        if (Array.isArray(value)) forwardHeaders[key] = value.join(', ');
        else if (value != null) forwardHeaders[key] = value;
    }
    // Tidal CDN rejects requests that don't look like a real browser
    forwardHeaders['user-agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    let upstream;
    try {
        upstream = await fetch(target, {
            method: req.method,
            headers: forwardHeaders,
            redirect: 'follow',
        });
    } catch (e) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Upstream fetch failed: ' + (e?.message || 'unknown'));
        return;
    }

    const outHeaders = {};
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
        // Client disconnected or upstream stream error — just end
    } finally {
        res.end();
    }
}

const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/proxy-audio') {
        handleProxyAudio(req, res).catch((e) => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end('Proxy error: ' + (e?.message || 'unknown'));
        });
        return;
    }
    serveStatic(req, res);
});

server.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}, serving ${DIST_DIR}`);
});
