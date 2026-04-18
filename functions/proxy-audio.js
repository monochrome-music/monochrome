export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Expose-Headers': '*',
            },
        });
    }

    try {
        const rangeHeader = request.headers.get('Range');
        const isRangeRequest = !!rangeHeader;

        // Build a cache key that includes the Range header so partial-content
        // responses don't poison the full-file cache entry (and vice versa).
        const cacheUrl = new URL(request.url);
        try {
            const tidalUrl = new URL(targetUrl);
            cacheUrl.searchParams.set('cache_key', tidalUrl.pathname);
        } catch {
            // targetUrl wasn't a valid absolute URL; fall back to the raw string
        }
        if (isRangeRequest) {
            cacheUrl.searchParams.set('cache_range', rangeHeader);
        }

        const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
        const cache = caches.default;
        let response = request.method === 'GET' ? await cache.match(cacheKey) : null;

        if (!response) {
            const headers = new Headers(request.headers);
            headers.delete('host');
            headers.delete('referer');
            headers.delete('origin');
            headers.delete('cookie');
            headers.set(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            const upstream = await fetch(targetUrl, {
                method: request.method,
                headers,
                redirect: 'follow',
                cf: {
                    cacheTtl: 2592000,
                    cacheEverything: true,
                },
            });

            // Build a response whose headers we control and whose body is a fresh
            // ReadableStream. We clone once for the cache put so the outbound
            // response body is never consumed by the cache.
            response = new Response(upstream.body, upstream);
            response.headers.set('Access-Control-Allow-Origin', '*');
            response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            response.headers.set('Access-Control-Expose-Headers', '*');
            response.headers.delete('Set-Cookie');
            response.headers.delete('content-security-policy');
            response.headers.delete('x-frame-options');

            // Only full-file GETs with 200 OK are worth caching. Skip on 206
            // (Range) so partial responses don't get reused as full responses.
            if (request.method === 'GET' && upstream.status === 200 && !isRangeRequest) {
                const cacheResponse = response.clone();
                cacheResponse.headers.set('Cache-Control', 'public, max-age=2592000');
                context.waitUntil(cache.put(cacheKey, cacheResponse));
            }
        }

        return response;
    } catch (error) {
        return new Response('Proxy Error: ' + error.message, { status: 500 });
    }
}
