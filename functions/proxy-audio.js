export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    try {
        const cacheUrl = new URL(request.url);
        try {
            const tidalUrl = new URL(targetUrl);
            cacheUrl.searchParams.set('cache_key', tidalUrl.pathname);
        } catch (e) {}

        const cacheKey = new Request(cacheUrl.toString(), request);
        const cache = caches.default;
        let response = await cache.match(cacheKey);

        if (!response) {
            console.log('Cache Miss. Fetching from Tidal...');

            const headers = new Headers(request.headers);
            headers.delete('host');
            headers.delete('referer');
            headers.set(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            response = await fetch(targetUrl, {
                method: request.method,
                headers: headers,
                redirect: 'follow',
                cf: {
                    cacheTtl: 2592000,
                    cacheEverything: true,
                },
            });

            if (request.method === 'GET' && response.ok) {
                const cacheResponse = new Response(response.body, response);
                cacheResponse.headers.set('Access-Control-Allow-Origin', '*');
                cacheResponse.headers.set('Cache-Control', 'public, max-age=2592000');

                cacheResponse.headers.delete('Set-Cookie');

                context.waitUntil(cache.put(cacheKey, cacheResponse.clone()));
                response = cacheResponse;
            }
        } else {
            console.log('Cache Hit! Serving from Edge.');
        }

        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        newResponse.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        newResponse.headers.set('Access-Control-Expose-Headers', '*');
        newResponse.headers.delete('content-security-policy');
        newResponse.headers.delete('x-frame-options');

        return newResponse;
    } catch (error) {
        return new Response('Proxy Error: ' + error.message, { status: 500 });
    }
}
