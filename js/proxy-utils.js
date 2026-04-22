export const getProxyUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    if (window.__tidalOriginExtension) return url;
    if (url.startsWith('blob:')) return url;
    if (url.startsWith('https://audio-proxy.binimum.org/')) return url;
    return `https://audio-proxy.binimum.org/proxy-audio?url=${url}`;
};
