export const getProxyUrl = (url) => {
    return url;
};

export const wrapTidalUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    return url
        .replace('openapi.tidal.com', 'tidal-api.geeked.wtf/openapi')
        .replace('api.tidal.com', 'tidal-api.geeked.wtf/api');
};
