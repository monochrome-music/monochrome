export const isTidalAudioUrl = () => false;

export const getProxyUrl = (url) => {
    if (!url) return url;
    return url;
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'lol.samidy.workers.dev/openapi')
        .replace('api.tidal.com', 'lol.samidy.workers.dev/api')
        .replace('https://tidal.com', 'https://lol.samidy.workers.dev/tidal');
};
