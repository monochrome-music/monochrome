const AMP_API_BASE = 'https://amp-api.music.apple.com';
const CACHE_SECONDS = 24 * 60 * 60;

function normalize(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function findSong(data, title, artist) {
    const songs = Object.values(data?.resources?.songs || {});
    const candidates = songs.length ? songs : data?.results?.songs?.data || [];
    return (
        candidates.find(
            (song) =>
                normalize(song?.attributes?.name) === normalize(title) &&
                normalize(song?.attributes?.artistName) === normalize(artist)
        ) || candidates.find((song) => normalize(song?.attributes?.name) === normalize(title))
    );
}

function albumIdFromSong(song) {
    return (
        song?.relationships?.albums?.data?.[0]?.id ||
        song?.attributes?.url?.match(/\/album\/[^/]+\/(\d+)(?:\?|$)/)?.[1] ||
        null
    );
}

function aspectRatio(width, height) {
    if (!width || !height) return 'unknown';
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.02) return '1:1';
    if (Math.abs(ratio - 0.75) < 0.02) return '3:4';
    if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16';
    return `${width}:${height}`;
}

function selectVideoCover(album) {
    const editorialVideo = album?.attributes?.editorialVideo || {};
    const covers = Object.entries(editorialVideo)
        .map(([kind, item]) => {
            const hlsUrl = typeof item?.video === 'string' ? item.video : item?.video?.url;
            if (!hlsUrl) return null;
            const frame = item.previewFrame || {};
            return {
                kind,
                aspectRatio: aspectRatio(frame.width, frame.height),
                hlsUrl,
                previewFrameUrl: frame.url || null,
            };
        })
        .filter(Boolean);
    return (
        covers.find((cover) => cover.kind === 'motionDetailSquare') ||
        covers.find((cover) => cover.kind === 'motionSquareVideo1x1') ||
        covers.find((cover) => cover.aspectRatio === '1:1') ||
        covers[0] ||
        null
    );
}

async function appleJson(url, authorization, origin) {
    const response = await fetch(url, { headers: { Authorization: authorization, Origin: origin } });
    if (!response.ok) {
        const error = new Error(`Apple Music returned ${response.status}`);
        error.status = response.status;
        error.retryAfter = response.headers.get('Retry-After');
        throw error;
    }
    return response.json();
}

function jsonResponse(body, status = 200, headers = {}) {
    return Response.json(body, {
        status,
        headers: {
            'Cache-Control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
            ...headers,
        },
    });
}

export async function onRequest({ request }) {
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
    const requestUrl = new URL(request.url);
    const authorization = request.headers.get('Authorization');
    if (!authorization) return jsonResponse({ error: 'Missing Apple Music authorization' }, 401);

    const storefront = requestUrl.searchParams.get('storefront') || 'us';
    if (!/^[a-z]{2}$/i.test(storefront)) return jsonResponse({ error: 'Invalid storefront' }, 400);

    const cache = globalThis.caches?.default;
    const cached = await cache?.match(request);
    if (cached) return cached;

    try {
        let albumId = requestUrl.searchParams.get('albumId');
        if (!albumId) {
            const title = requestUrl.searchParams.get('title');
            const artist = requestUrl.searchParams.get('artist');
            if (!title || !artist) return jsonResponse({ error: 'Missing title and artist' }, 400);
            if (title.length > 300 || artist.length > 300)
                return jsonResponse({ error: 'Search value is too long' }, 400);

            const searchUrl = new URL(`/v1/catalog/${storefront.toLowerCase()}/search`, AMP_API_BASE);
            searchUrl.searchParams.set('term', `${title} ${artist}`);
            searchUrl.searchParams.set('types', 'songs');
            searchUrl.searchParams.set('limit', '10');
            searchUrl.searchParams.set('relate[songs]', 'albums');
            const search = await appleJson(searchUrl, authorization, requestUrl.origin);
            albumId = albumIdFromSong(findSong(search, title, artist));
        }

        if (!albumId) {
            const response = jsonResponse({ cover: null });
            await cache?.put(request, response.clone());
            return response;
        }
        if (!/^[a-z0-9.-]+$/i.test(albumId)) return jsonResponse({ error: 'Invalid album ID' }, 400);
        const albumUrl = new URL(`/v1/catalog/${storefront.toLowerCase()}/albums/${albumId}`, AMP_API_BASE);
        albumUrl.searchParams.set('extend', 'editorialVideo');
        const album = (await appleJson(albumUrl, authorization, requestUrl.origin))?.data?.[0];
        const response = jsonResponse({ cover: selectVideoCover(album) });
        await cache?.put(request, response.clone());
        return response;
    } catch (error) {
        if (error.status === 429) {
            return jsonResponse(
                { error: error.message },
                429,
                error.retryAfter ? { 'Retry-After': error.retryAfter } : {}
            );
        }
        return jsonResponse({ error: error.message }, 502);
    }
}
