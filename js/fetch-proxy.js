// Transparent fetch interceptor: rewrites *.tidal.com URLs through the local proxy
// so all TIDAL requests (Shaka segments, API calls, etc.) work without CORS issues
// without needing per-call proxy routing scattered across the codebase.

const _originalFetch = window.fetch.bind(window);

function proxyTidalUrl(url) {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        if (
            (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
            (host === 'tidal.com' || host.endsWith('.tidal.com'))
        ) {
            return `/proxy-audio?url=${encodeURIComponent(url)}`;
        }
    } catch {
        // unparseable — leave unchanged
    }
    return url;
}

window.fetch = function tidalProxyFetch(input, init) {
    if (input instanceof Request) {
        const rewritten = proxyTidalUrl(input.url);
        if (rewritten !== input.url) {
            input = new Request(rewritten, input);
        }
    } else if (typeof input === 'string' || input instanceof URL) {
        const rewritten = proxyTidalUrl(String(input));
        if (rewritten !== String(input)) {
            input = rewritten;
        }
    }
    return _originalFetch(input, init);
};

export { proxyTidalUrl };
