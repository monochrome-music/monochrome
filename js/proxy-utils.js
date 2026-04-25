const DEFAULT_PARTY_BACKEND_URL = 'https://fucktidal3.valerie.sh';
const LEGACY_PROXY_BASE = 'https://audio-proxy.binimum.org';

function getConfiguredProxyBaseUrl() {
    const explicitProxy = window.__TIDAL_PROXY_URL__ || localStorage.getItem('monochrome-tidal-proxy-url');
    if (explicitProxy) {
        return String(explicitProxy).trim().replace(/\/+$/, '');
    }

    const partyBackend =
        window.__PARTY_BACKEND_URL__ ||
        localStorage.getItem('monochrome-party-backend-url') ||
        DEFAULT_PARTY_BACKEND_URL;

    try {
        return new URL(String(partyBackend), window.location.origin).origin;
    } catch {
        return LEGACY_PROXY_BASE;
    }
}

export const getProxyUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    if (window.__tidalOriginExtension) return url;
    if (url.startsWith('blob:')) return url;

    const proxyBase = getConfiguredProxyBaseUrl();
    if (url.startsWith(`${proxyBase}/proxy-audio`)) return url;
    if (url.startsWith(`${LEGACY_PROXY_BASE}/proxy-audio`)) return url;

    return `${proxyBase}/proxy-audio?url=${encodeURIComponent(url)}`;
};
