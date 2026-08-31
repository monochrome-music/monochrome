const DEFAULT_TYPES = ['songs', 'albums', 'artists', 'music-videos', 'playlists'];
const TOKEN_URL = 'https://am-mint.binimum.org/token';
const TOKEN_STORAGE_KEY = 'apple-music-api-token';
const SECTION_TO_APPLE_TYPE = {
    tracks: 'songs',
    albums: 'albums',
    artists: 'artists',
    videos: 'music-videos',
    playlists: 'playlists',
};
let memoryToken = null;
let tokenRequestPromise = null;

function normalize(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function decodeJwtExpiration(token) {
    try {
        const payload = token.split('.')[1];
        if (!payload) return 0;
        const base64 = payload
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(payload.length / 4) * 4, '=');
        return Number(JSON.parse(atob(base64)).exp || 0) * 1000;
    } catch {
        return 0;
    }
}

function readStoredToken() {
    if (memoryToken?.expiresAt > Date.now()) return memoryToken;
    try {
        const stored = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY));
        if (stored?.token && stored.expiresAt > Date.now()) {
            memoryToken = stored;
            return stored;
        }
        localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // Storage can be unavailable in private browsing or non-browser tests.
    }
    memoryToken = null;
    return null;
}

function storeToken(token) {
    memoryToken = token;
    try {
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
    } catch {
        // The in-memory cache still avoids repeated requests for this session.
    }
}

function clearToken() {
    memoryToken = null;
    try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // Ignore unavailable browser storage.
    }
}

export async function getAppleMusicToken(options = {}) {
    if (!options.forceRefresh) {
        const cached = readStoredToken();
        if (cached) return cached;
    }

    if (!tokenRequestPromise) {
        tokenRequestPromise = (async () => {
            const response = await fetch(TOKEN_URL);
            if (!response.ok) throw new Error(`Apple Music token request failed with status ${response.status}`);
            const data = await response.json();
            const token = data.dev_token || data.token;
            const expiresAt = decodeJwtExpiration(token);
            if (!token || !expiresAt || expiresAt <= Date.now())
                throw new Error('Apple Music token response is invalid');

            const cached = { token, storefront: data.storefront_id || '', expiresAt };
            storeToken(cached);
            return cached;
        })().finally(() => {
            tokenRequestPromise = null;
        });
    }
    return tokenRequestPromise;
}

async function appleFetch(url, tokenInfo, options = {}, retry = true) {
    const response = await fetch(url, {
        mode: 'cors',
        signal: options.signal,
        headers: buildAppleRequestHeaders(tokenInfo, options),
    });
    if (response.status === 401 && retry) {
        clearToken();
        const refreshed = await getAppleMusicToken({ signal: options.signal, forceRefresh: true });
        return appleFetch(url, refreshed, options, false);
    }
    return response;
}

function scoreMatch(section, appleResource, currentItem) {
    const attributes = appleResource?.attributes || {};
    const appleName = normalize(attributes.name);
    if (section === 'artists') return appleName && appleName === normalize(currentItem.name) ? 100 : 0;
    if (section === 'playlists') {
        return appleName && appleName === normalize(currentItem.title || currentItem.name) ? 100 : 0;
    }
    if (section === 'albums') {
        if (attributes.upc && currentItem.upc && String(attributes.upc) === String(currentItem.upc)) return 150;
        if (!appleName || appleName !== normalize(currentItem.title || currentItem.name)) return 0;
        return normalize(attributes.artistName) === normalize(currentItem.artist?.name) ? 120 : 70;
    }
    if (attributes.isrc && currentItem.isrc && normalize(attributes.isrc) === normalize(currentItem.isrc)) return 160;
    if (!appleName || appleName !== normalize(currentItem.title || currentItem.name)) return 0;
    let score = 70;
    if (normalize(attributes.artistName) === normalize(currentItem.artist?.name)) score += 40;
    if (normalize(attributes.albumName) === normalize(currentItem.album?.title)) score += 10;
    return score;
}

export function rankSearchSection(section, currentSection, appleResources = []) {
    const items = currentSection?.items || [];
    if (items.length < 2 || appleResources.length === 0) return currentSection;
    const remaining = new Set(items.map((_, index) => index));
    const ranked = [];
    for (const appleResource of appleResources) {
        let bestIndex = -1;
        let bestScore = 0;
        for (const index of remaining) {
            const score = scoreMatch(section, appleResource, items[index]);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }
        if (bestIndex >= 0 && bestScore >= 70) {
            ranked.push(items[bestIndex]);
            remaining.delete(bestIndex);
        }
    }
    for (const index of remaining) ranked.push(items[index]);
    return { ...currentSection, items: ranked };
}

export function rankSearchResults(currentResults, appleResponse) {
    const results = appleResponse?.results;
    if (!results) return currentResults;
    const ranked = { ...currentResults };
    for (const [section, appleType] of Object.entries(SECTION_TO_APPLE_TYPE)) {
        if (currentResults?.[section]) {
            ranked[section] = rankSearchSection(section, currentResults[section], results[appleType]?.data);
        }
    }
    return ranked;
}

function artworkUrl(artwork, width = 640, height = width) {
    return artwork?.url?.replace('{w}', String(width)).replace('{h}', String(height)).replace('{f}', 'jpg') || '';
}

function lyricSnippet(resource) {
    const snippet = resource?.meta?.snippets?.find((item) => item?.kind === 'lyric' && item.text);
    return snippet?.text?.replace(/<[^>]*>/g, '').trim() || '';
}

function idFromAppleUrl(url, type) {
    if (!url) return '';
    return String(url).match(new RegExp(`/${type}/[^/]+/(\\d+)(?:[/?]|$)`))?.[1] || '';
}

function appleArtist(name, url = '') {
    const appleMusicId = idFromAppleUrl(url, 'artist');
    return {
        id: appleMusicId ? `apple:artist:${appleMusicId}` : '',
        appleMusicId,
        name: name || 'Unknown Artist',
        provider: 'apple',
    };
}

export function normalizeAppleTrack(resource, type = 'track') {
    const attributes = resource?.attributes || {};
    const artist = appleArtist(attributes.artistName, attributes.artistUrl);
    const cover = artworkUrl(attributes.artwork);
    const albumResource = resource?.relationships?.albums?.data?.[0];
    const albumId = albumResource?.id || idFromAppleUrl(attributes.url, 'album');
    return {
        id: `apple:${type}:${resource.id}`,
        appleMusicId: resource.id,
        provider: 'apple',
        type,
        title: attributes.name || 'Unknown Title',
        duration: Math.round((attributes.durationInMillis || 0) / 1000),
        explicit: attributes.contentRating === 'explicit',
        isrc: attributes.isrc || '',
        url: attributes.url || '',
        artist,
        artists: [artist],
        album: {
            id: albumId ? `apple:album:${albumId}` : '',
            appleMusicId: albumId || '',
            title: attributes.albumName || '',
            cover,
            releaseDate: attributes.releaseDate,
        },
        cover,
        image: cover,
        imageId: cover,
        releaseDate: attributes.releaseDate,
        trackNumber: attributes.trackNumber,
        volumeNumber: attributes.discNumber,
        lyricSnippet: lyricSnippet(resource),
        isUnavailable: false,
    };
}

export function normalizeAppleAlbum(resource) {
    const attributes = resource?.attributes || {};
    const artist = appleArtist(attributes.artistName, attributes.artistUrl);
    return {
        id: `apple:album:${resource.id}`,
        appleMusicId: resource.id,
        provider: 'apple',
        title: attributes.name || 'Unknown Album',
        artist,
        artists: [artist],
        cover: artworkUrl(attributes.artwork),
        explicit: attributes.contentRating === 'explicit',
        copyright: attributes.copyright,
        releaseDate: attributes.releaseDate,
        numberOfTracks: attributes.trackCount || 0,
        upc: attributes.upc,
        type: attributes.isSingle ? 'SINGLE' : 'ALBUM',
        _href: `/album/apple/${resource.id}`,
        appleMusicUrl: attributes.url || '',
    };
}

export function normalizeAppleArtist(resource) {
    const attributes = resource?.attributes || {};
    return {
        id: `apple:artist:${resource.id}`,
        appleMusicId: resource.id,
        provider: 'apple',
        name: attributes.name || 'Unknown Artist',
        picture: artworkUrl(attributes.artwork),
        biography: attributes.editorialNotes?.standard || attributes.editorialNotes?.short || '',
        popularity: 0,
        artistRoles: [],
        _href: `/artist/apple/${resource.id}`,
        appleMusicUrl: attributes.url || '',
    };
}

export function normalizeApplePlaylist(resource) {
    const attributes = resource?.attributes || {};
    const id = `apple:playlist:${resource.id}`;
    return {
        id,
        uuid: id,
        appleMusicId: resource.id,
        provider: 'apple',
        title: attributes.name || 'Unknown Playlist',
        image: artworkUrl(attributes.artwork),
        numberOfTracks: resource?.relationships?.tracks?.meta?.total || 0,
        _href: `/playlist/apple/${resource.id}`,
        appleMusicUrl: attributes.url || '',
    };
}

function hydrateResource(appleResponse, reference) {
    if (!reference) return reference;
    const resource = appleResponse?.resources?.[reference.type]?.[reference.id];
    if (!resource) return reference;
    return {
        ...resource,
        meta: { ...resource.meta, ...reference.meta },
    };
}

function appleSection(section, mapper, appleResponse) {
    const items = section?.data || [];
    return {
        items: items.map((item) => mapper(hydrateResource(appleResponse, item))),
        limit: items.length,
        offset: 0,
        totalNumberOfItems: section?.meta?.total ?? items.length,
    };
}

export function normalizeAppleSearchResults(appleResponse) {
    const results = appleResponse?.results || {};
    return {
        tracks: appleSection(results.songs || results.song, (resource) => normalizeAppleTrack(resource), appleResponse),
        videos: appleSection(
            results['music-videos'] || results.music_video,
            (resource) => normalizeAppleTrack(resource, 'video'),
            appleResponse
        ),
        albums: appleSection(results.albums || results.album, normalizeAppleAlbum, appleResponse),
        artists: appleSection(results.artists || results.artist, normalizeAppleArtist, appleResponse),
        playlists: appleSection(results.playlists || results.playlist, normalizeApplePlaylist, appleResponse),
    };
}

export function extractSearchSuggestions(appleResponse) {
    const suggestions = appleResponse?.results?.suggestions;
    if (!Array.isArray(suggestions)) return [];
    const seen = new Set();
    return suggestions
        .map((suggestion) => {
            if (suggestion?.kind === 'terms' && suggestion.searchTerm) {
                return {
                    kind: 'term',
                    searchTerm: suggestion.searchTerm.trim(),
                    displayTerm: (suggestion.displayTerm || suggestion.searchTerm).trim(),
                };
            }
            if (suggestion?.kind !== 'topResults' || suggestion.content?.type !== 'songs') return null;
            const resource = hydrateResource(appleResponse, suggestion.content);
            if (!resource?.attributes) return null;
            const track = normalizeAppleTrack(resource);
            return {
                kind: 'song',
                searchTerm: track.title,
                displayTerm: track.title,
                subtitle: track.artist.name,
                image: artworkUrl(resource.attributes.artwork, 80),
                lyricSnippet: track.lyricSnippet,
                track,
            };
        })
        .filter(Boolean)
        .filter((suggestion) => {
            const key = suggestion.kind === 'song' ? suggestion.track.id : normalize(suggestion.searchTerm);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

export function selectVideoCover(covers = []) {
    const squareKinds = ['motionDetailSquare', 'motionSquareVideo1x1'];
    return (
        squareKinds.map((kind) => covers.find((cover) => cover.kind === kind)).find(Boolean) ||
        covers.find((cover) => cover.aspectRatio === '1:1') ||
        covers[0] ||
        null
    );
}

function findSong(data, title, artist) {
    const songs = Object.values(data?.resources?.songs || {});
    const candidates = songs.length ? songs : data?.results?.songs?.data || [];
    const normalizedTitle = normalize(title);
    const normalizedArtist = normalize(artist);
    return (
        candidates.find((song) => {
            const attributes = song?.attributes || {};
            return (
                normalize(attributes.name) === normalizedTitle && normalize(attributes.artistName) === normalizedArtist
            );
        }) || candidates.find((song) => normalize(song?.attributes?.name) === normalizedTitle)
    );
}

function albumIdFromSong(song) {
    const relationshipId = song?.relationships?.albums?.data?.[0]?.id;
    if (relationshipId) return String(relationshipId);
    return song?.attributes?.url?.match(/\/album\/[^/]+\/(\d+)(?:\?|$)/)?.[1] || null;
}

function aspectRatio(width, height) {
    if (!width || !height) return 'unknown';
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.02) return '1:1';
    if (Math.abs(ratio - 0.75) < 0.02) return '3:4';
    if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16';
    return `${width}:${height}`;
}

export function extractVideoCovers(album) {
    const editorialVideo = album?.attributes?.editorialVideo || {};
    const seen = new Set();
    const covers = [];
    for (const [kind, item] of Object.entries(editorialVideo)) {
        const url = typeof item?.video === 'string' ? item.video : item?.video?.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const frame = item.previewFrame || {};
        covers.push({
            kind,
            aspectRatio: aspectRatio(frame.width, frame.height),
            hlsUrl: url,
            previewFrameUrl: frame.url || null,
        });
    }
    return covers;
}

function inferStorefront() {
    const locale = globalThis.navigator?.language || '';
    const region = locale.split('-')[1];
    return /^[a-z]{2}$/i.test(region || '') ? region.toLowerCase() : 'us';
}

export function resolveStorefront(requestedStorefront, tokenStorefront) {
    if (/^[a-z]{2}$/i.test(requestedStorefront || '')) return requestedStorefront.toLowerCase();
    if (/^[a-z]{2}$/i.test(tokenStorefront || '')) return tokenStorefront.toLowerCase();
    return inferStorefront();
}

export function buildAppleRequestHeaders(tokenInfo, options = {}) {
    const headers = { Authorization: `Bearer ${tokenInfo.token}` };
    const origin = options.origin || globalThis.location?.origin;
    if (origin && origin !== 'null') headers.Origin = origin;
    return headers;
}

export class AppleMusicSearchAPI {
    constructor() {
        this.suggestionCache = new Map();
    }

    async remainingPages(next, options = {}, maximumPages = 20) {
        if (!next) return [];
        const token = await getAppleMusicToken(options);
        const items = [];
        let pageUrl = next;
        let pageCount = 0;
        while (pageUrl && pageCount < maximumPages) {
            const response = await appleFetch(new URL(pageUrl, 'https://api.music.apple.com'), token, options);
            if (!response.ok) break;
            const page = await response.json();
            items.push(...(page.data || []));
            pageUrl = page.next;
            pageCount += 1;
        }
        return items;
    }

    async catalogResource(type, id, options = {}, params = {}) {
        const token = await getAppleMusicToken(options);
        const storefront = resolveStorefront(options.storefront, token.storefront);
        const url = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/${type}/${id}`);
        for (const [key, value] of Object.entries(params)) {
            if (value != null && value !== '') url.searchParams.set(key, String(value));
        }
        const response = await appleFetch(url, token, options);
        if (!response.ok) throw new Error(`Apple Music ${type} lookup failed with status ${response.status}`);
        return response.json();
    }

    async artistView(id, view, options = {}) {
        const token = await getAppleMusicToken(options);
        const storefront = resolveStorefront(options.storefront, token.storefront);
        const url = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/artists/${id}/view/${view}`);
        url.searchParams.set('limit', String(Math.min(options.limit || 25, 25)));
        url.searchParams.set('extend[songs]', 'artistUrl');
        url.searchParams.set('extend[albums]', 'artistUrl');
        const response = await appleFetch(url, token, options);
        if (!response.ok) return [];
        return (await response.json())?.data || [];
    }

    async track(id, options = {}) {
        const isVideo = String(id).startsWith('apple:video:');
        const appleId = typeof id === 'string' ? id.replace(/^apple:(?:track|video):/, '') : id;
        const type = isVideo ? 'music-videos' : 'songs';
        const response = await this.catalogResource(type, appleId, options, {
            'extend[songs]': 'artistUrl',
            'extend[albums]': 'artistUrl',
            include: 'albums,artists',
        });
        const resource = response?.data?.[0];
        if (!resource) throw new Error(`Apple Music ${isVideo ? 'video' : 'track'} was not found`);
        return normalizeAppleTrack(resource, isVideo ? 'video' : 'track');
    }

    async album(id, options = {}) {
        const [response, videoCover] = await Promise.all([
            this.catalogResource('albums', id, options, {
                include: 'tracks,artists',
                'extend[songs]': 'artistUrl',
                'extend[albums]': 'artistUrl',
            }),
            this.albumVideoCover(id, options).catch(() => null),
        ]);
        const resource = response?.data?.[0];
        if (!resource) throw new Error('Apple Music album was not found');
        const album = normalizeAppleAlbum(resource);
        if (videoCover?.hlsUrl) album.videoCoverUrl = videoCover.hlsUrl;
        const trackRelationship = resource.relationships?.tracks || {};
        const trackResources = [
            ...(trackRelationship.data || []),
            ...(await this.remainingPages(trackRelationship.next, options)),
        ];
        const tracks = trackResources.map((track) => {
            const normalized = normalizeAppleTrack(track);
            normalized.album = {
                id: album.id,
                appleMusicId: album.appleMusicId,
                title: album.title,
                cover: album.cover,
                releaseDate: album.releaseDate,
            };
            if (!normalized.artist.id) normalized.artist = normalized.artists[0] = album.artist;
            normalized.copyright = album.copyright;
            return normalized;
        });
        album.numberOfTracks = tracks.length || album.numberOfTracks;
        return { album, tracks };
    }

    async artist(id, options = {}) {
        const [response, tracks, albums, singles, similar, videos] = await Promise.all([
            this.catalogResource('artists', id, options),
            this.artistView(id, 'top-songs', options),
            this.artistView(id, 'full-albums', options),
            this.artistView(id, 'singles', options),
            this.artistView(id, 'similar-artists', options),
            this.artistView(id, 'top-music-videos', options),
        ]);
        const resource = response?.data?.[0];
        if (!resource) throw new Error('Apple Music artist was not found');
        const artist = normalizeAppleArtist(resource);
        const attachArtist = (track) => {
            const normalized = normalizeAppleTrack(track, track.type === 'music-videos' ? 'video' : 'track');
            if (!normalized.artist.id) normalized.artist = normalized.artists[0] = artist;
            return normalized;
        };
        return {
            ...artist,
            tracks: tracks.map(attachArtist),
            albums: albums.map(normalizeAppleAlbum),
            eps: singles.map(normalizeAppleAlbum),
            videos: videos.map(attachArtist),
            similar: similar.map(normalizeAppleArtist),
        };
    }

    async playlist(id, options = {}) {
        const response = await this.catalogResource('playlists', id, options, {
            include: 'tracks',
            'extend[songs]': 'artistUrl',
        });
        const resource = response?.data?.[0];
        if (!resource) throw new Error('Apple Music playlist was not found');
        const playlist = normalizeApplePlaylist(resource);
        const trackRelationship = resource.relationships?.tracks || {};
        const trackResources = [
            ...(trackRelationship.data || []),
            ...(await this.remainingPages(trackRelationship.next, options)),
        ];
        const tracks = trackResources
            .filter((track) => track.type === 'songs')
            .map((track) => normalizeAppleTrack(track));
        playlist.numberOfTracks = tracks.length || playlist.numberOfTracks;
        return { playlist, tracks };
    }

    async search(query, options = {}) {
        const token = await getAppleMusicToken(options);
        const storefront = resolveStorefront(options.storefront, token.storefront);
        const url = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/search`);
        url.searchParams.set('art[url]', 'f');
        url.searchParams.set('extend', 'artistUrl');
        url.searchParams.set('format[resources]', 'map');
        url.searchParams.set('l', globalThis.navigator?.language || 'en-US');
        // url.searchParams.set('platform', 'web');
        url.searchParams.set('relate[songs]', 'albums');
        url.searchParams.set('term', query);
        url.searchParams.set('types', (options.types || DEFAULT_TYPES).join(','));
        url.searchParams.set('limit', String(Math.min(options.limit || 25, 25)));
        url.searchParams.set('with', 'lyricHighlights,lyrics,naturalLanguage,serverBubbles,subtitles');
        const response = await appleFetch(url, token, options);
        if (!response.ok) throw new Error(`Apple Music search failed with status ${response.status}`);
        return response.json();
    }

    async suggestions(query, options = {}) {
        const token = await getAppleMusicToken(options);
        const storefront = resolveStorefront(options.storefront, token.storefront);
        const cacheKey = `${storefront}:${normalize(query)}`;
        if (this.suggestionCache.has(cacheKey)) return this.suggestionCache.get(cacheKey);

        const url = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/search/suggestions`);
        url.searchParams.set('art[url]', 'f');
        url.searchParams.set('format[resources]', 'map');
        url.searchParams.set('kinds', 'terms,topResults');
        url.searchParams.set('l', globalThis.navigator?.language || 'en-US');
        url.searchParams.set('limit[results:terms]', String(Math.min(options.termLimit || 5, 10)));
        url.searchParams.set('limit[results:topResults]', String(Math.min(options.topResultsLimit || 5, 10)));
        // url.searchParams.set('platform', 'web');
        url.searchParams.set('term', query);
        url.searchParams.set('types', 'songs');
        url.searchParams.set('with', 'naturalLanguage');
        const response = await appleFetch(url, token, options);
        if (!response.ok) throw new Error(`Apple Music suggestions failed with status ${response.status}`);
        const result = extractSearchSuggestions(await response.json());
        this.suggestionCache.set(cacheKey, result);
        if (this.suggestionCache.size > 50) this.suggestionCache.delete(this.suggestionCache.keys().next().value);
        return result;
    }

    async videoCover(title, artist, options = {}) {
        const token = await getAppleMusicToken(options);
        const storefront = resolveStorefront(options.storefront, token.storefront);
        const searchUrl = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/search`);
        searchUrl.searchParams.set('term', `${title} ${artist}`);
        searchUrl.searchParams.set('types', 'songs');
        searchUrl.searchParams.set('limit', '10');
        searchUrl.searchParams.set('relate[songs]', 'albums');
        const searchResponse = await appleFetch(searchUrl, token, options);
        if (!searchResponse.ok) throw new Error(`Apple Music video search failed with status ${searchResponse.status}`);
        const albumId = albumIdFromSong(findSong(await searchResponse.json(), title, artist));
        if (!albumId) return null;

        const albumUrl = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}`);
        albumUrl.searchParams.set('extend', 'editorialVideo');
        const albumResponse = await appleFetch(albumUrl, token, options);
        if (!albumResponse.ok) throw new Error(`Apple Music album lookup failed with status ${albumResponse.status}`);
        const album = (await albumResponse.json())?.data?.[0];
        return selectVideoCover(extractVideoCovers(album));
    }

    async albumVideoCover(albumId, options = {}) {
        const token = await getAppleMusicToken(options);
        const storefront = resolveStorefront(options.storefront, token.storefront);
        const albumUrl = new URL(`https://api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}`);
        albumUrl.searchParams.set('extend', 'editorialVideo');
        const response = await appleFetch(albumUrl, token, options);
        if (!response.ok) return null;
        return selectVideoCover(extractVideoCovers((await response.json())?.data?.[0]));
    }
}
