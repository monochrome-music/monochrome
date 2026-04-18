// Same-origin proxy for Tidal audio streams. The route is handled by:
//   - Vite dev: middleware in vite.config.ts
//   - Railway prod: server.js (node:http server with fetch passthrough)
// Using same-origin paths means the app works whatever host it's served
// from (localhost, Railway, a custom domain) without reconfiguration.
export const getProxyUrl = (url) => {
    if (typeof window !== 'undefined' && window.__tidalOriginExtension) return url;
    return `/proxy-audio?url=${encodeURIComponent(url)}`;
};
