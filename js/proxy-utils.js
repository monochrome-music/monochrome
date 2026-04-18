export const getProxyUrl = (url) => {
    if (window.__tidalOriginExtension) return url;
    return `/proxy-audio?url=${encodeURIComponent(url)}`;
};
