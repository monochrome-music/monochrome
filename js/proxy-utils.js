/* eslint-disable no-undef */
export const getProxyUrl = (url) => {
    if (window.__tidalOriginExtension) return url;
    return `${__VITE_PROXY__ ?? 'https://audio-proxy.binimum.org/proxy-audio'}?url=${encodeURIComponent(url)}`;
};
