// Dead qqdl.site nodes that stopped responding. Any request targeting one
// is rewritten to the working api.monochrome.tf host before it leaves the
// browser. Ported from the yzycoin/gemini/martin UserScript so users don't
// need the userscript installed to get working playback/API calls.
const DEAD_NODES = [
    'wolf.qqdl.site',
    'vogel.qqdl.site',
    'katze.qqdl.site',
    'hund.qqdl.site',
    'maus.qqdl.site',
];
const WORKING_HOST = 'api.monochrome.tf';

function rerouteUrl(urlStr) {
    if (typeof urlStr !== 'string' || !urlStr) return urlStr;
    for (const node of DEAD_NODES) {
        if (urlStr.includes(node)) {
            return urlStr.replace(node, WORKING_HOST);
        }
    }
    return urlStr;
}

const originalFetch = window.fetch.bind(window);
window.fetch = function patchedFetch(resource, init) {
    try {
        if (typeof resource === 'string') {
            const rerouted = rerouteUrl(resource);
            if (rerouted !== resource) {
                return originalFetch(rerouted, init);
            }
        } else if (resource && typeof resource.url === 'string') {
            const rerouted = rerouteUrl(resource.url);
            if (rerouted !== resource.url) {
                return originalFetch(new Request(rerouted, resource), init);
            }
        }
    } catch {
        // Fall through to the original fetch on any unexpected input shape
    }
    return originalFetch(resource, init);
};
