/* eslint-disable no-undef */
export const getProxyUrl = (url) => {
    if (window.__tidalOriginExtension) return url;
    return `${__VITE_PROXY__}?url=${encodeURIComponent(url)}`;
};

export function patchFetch() {
    if (__VITE_PROXY__ && !window.__tidalOriginExtension) {
        const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');

        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            set(value) {
                console.log(value);
                const alreadyProxied = value.includes(__VITE_PROXY__);

                if (!alreadyProxied) {
                    const realUrl = new URL(value, window.location.href).href;
                    if (originalSrcDescriptor && originalSrcDescriptor.set) {
                        originalSrcDescriptor.set.call(this, getProxyUrl(realUrl));
                    } else {
                        this.setAttribute('src', getProxyUrl(realUrl));
                    }
                }
            },
            get() {
                return originalSrcDescriptor ? originalSrcDescriptor.get.call(this) : this.getAttribute('src');
            },
        });

        const ogFetch = window.fetch;
        window.fetch = async function (input, init, ...rest) {
            let url = typeof input === 'string' ? new URL(input, window.location.href) : input.url;
            if (url.href.includes(__VITE_PROXY__)) {
                return await ogFetch(input, init, ...rest);
            } else if (
                url.hostname.toLowerCase().endsWith('tidal.com') &&
                !url.hostname.toLowerCase().endsWith('api.tidal.com')
            ) {
                return await ogFetch(getProxyUrl(url.href), init, ...rest);
            } else {
                return await ogFetch(input, init, ...rest);
            }
        };
    }
}
