export const getProxyUrl = (url) => {
    if (window.__tidalOriginExtension) return url;
    return `https://audio-proxy.binimum.org/proxy-audio?url=${url}`;
};
