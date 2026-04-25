import type { Serve } from 'bun';

const HOST = process.env.TIDAL_PROXY_HOST || '0.0.0.0';
const PORT = Number(process.env.TIDAL_PROXY_PORT || 8788);
const CORS_ORIGIN = process.env.TIDAL_PROXY_CORS_ORIGIN || '*';
const TARGET_ORIGIN = process.env.TIDAL_PROXY_TARGET_ORIGIN || 'https://listen.tidal.com';

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',
    'origin',
    'referer',
]);

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
        'Access-Control-Allow-Headers': 'Range,Accept,Content-Type,Authorization',
        'Access-Control-Expose-Headers':
            'Accept-Ranges,Content-Length,Content-Range,Content-Type,Cache-Control,ETag,Last-Modified',
        'Access-Control-Max-Age': '86400',
        ...extra,
    };
}

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders({
            'content-type': 'application/json;charset=UTF-8',
            'cache-control': 'no-store',
        }),
    });
}

function isAllowedTarget(targetUrl: string) {
    try {
        const parsed = new URL(targetUrl);
        return parsed.protocol === 'https:' && parsed.hostname.endsWith('.tidal.com');
    } catch {
        return false;
    }
}

function copyRequestHeaders(request: Request) {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
        if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        headers.set(key, value);
    }
    headers.set('Origin', TARGET_ORIGIN);
    headers.set('Referer', `${TARGET_ORIGIN}/`);
    return headers;
}

function copyResponseHeaders(upstream: Response) {
    const headers = new Headers();
    for (const [key, value] of upstream.headers.entries()) {
        if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        headers.set(key, value);
    }

    const cors = corsHeaders();
    for (const [key, value] of Object.entries(cors)) {
        headers.set(key, value);
    }

    return headers;
}

const serverOptions: Serve = {
    hostname: HOST,
    port: PORT,
    async fetch(request: Request) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        if (url.pathname === '/health') {
            return json({ ok: true });
        }

        if (url.pathname !== '/proxy-audio') {
            return json({ error: 'Not found' }, 404);
        }

        if (!['GET', 'HEAD'].includes(request.method)) {
            return json({ error: 'Method not allowed' }, 405);
        }

        const targetUrl = url.searchParams.get('url');
        if (!targetUrl) {
            return json({ error: 'Missing url parameter' }, 400);
        }

        if (!isAllowedTarget(targetUrl)) {
            return json({ error: 'Target must be an https://*.tidal.com URL' }, 400);
        }

        let upstream: Response;
        try {
            upstream = await fetch(targetUrl, {
                method: request.method,
                headers: copyRequestHeaders(request),
                redirect: 'follow',
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown upstream error';
            return json({ error: `Upstream request failed: ${message}` }, 502);
        }

        return new Response(request.method === 'HEAD' ? null : upstream.body, {
            status: upstream.status,
            headers: copyResponseHeaders(upstream),
        });
    },
};

// Bun provides the HTTP server runtime here; typed usage above keeps the handler itself checked.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
Bun.serve(serverOptions);

console.log(`Monochrome Tidal proxy listening on http://${HOST}:${PORT}`);
console.log(`Forwarding requests with Origin/Referer ${TARGET_ORIGIN}`);
