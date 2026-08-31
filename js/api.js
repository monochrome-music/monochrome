//js/api.js
import {
    RATE_LIMIT_ERROR_MESSAGE,
    deriveTrackQuality,
    delay,
    isTrackUnavailable,
    getExtensionFromBlob,
    getTrackDiscNumber,
    normalizeQualityToken,
    isAtmosQuality,
    isAc4AtmosQuality,
    getTrackCoverId,
    getCoverBlob,
} from './utils.js';
import {
    preferDolbyAtmosSettings,
    trackDateSettings,
    devModeSettings,
    unifiedPlaybackSettings,
    deezerFallbackSettings,
} from './storage.js';
import { APICache } from './cache.js';
import { DashDownloader } from './dash-downloader.ts';
import { HlsDownloader } from './hls-downloader.js';
import { getProxyUrl, wrapTidalUrl } from './proxy-utils.js';
import { loadFfmpeg, FfmpegError, ffmpeg } from './ffmpeg.js';
import { triggerDownload, applyAudioPostProcessing } from './download-utils.ts';
import { isCustomFormat } from './ffmpegFormats.ts';
import { DownloadProgress } from './progressEvents.js';
import { resolveDownloadTotalBytes } from './downloadProgressUtils.js';
import { readableStreamIterator } from './readableStreamIterator.js';
import { HiFiClient, TidalResponse } from './HiFi.ts';
import { canUseNativeAmazonCenc, getAmazonDecrypterCodec, canBrowserStreamAtmosQuality } from './platform-detection.js';
import {
    TrackAlbum,
    EnrichedAlbum,
    EnrichedTrack,
    ReplayGain,
    PlaybackInfo,
    Track,
    Album,
    PreparedVideo,
    PreparedTrack,
} from './container-classes.js';

export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';
export const UNSUPPORTED_PLAYBACK_CODEC_CODE = 'UNSUPPORTED_PLAYBACK_CODEC';
export const STRICT_QUALITY_UNAVAILABLE_CODE = 'STRICT_QUALITY_UNAVAILABLE';
export { resolveDownloadTotalBytes };
let lastAudioSourceMissingNotifyAt = 0;
const UNIFIED_PLAYBACK_RATE_LIMITED_UNTIL_KEY = 'unified-playback-rate-limited-until';
const UNIFIED_PLAYBACK_RATE_LIMIT_DURATION_MS = 30 * 60 * 1000;
const UNIFIED_TURNSTILE_JWT_KEY = 'unified-playback-turnstile-jwt';
const UNIFIED_TURNSTILE_EXPIRY_KEY = 'unified-playback-turnstile-expiry';
const UNIFIED_TURNSTILE_SITE_KEY = '0x4AAAAAADgxqF6QVMm0GLHH';
const UNIFIED_TURNSTILE_EXPIRY_LEEWAY_SECONDS = 15;

function createAudioSourceReportDetails(track, fallbackId, quality, intent, unifiedPlayback) {
    const artistNames = Array.isArray(track?.artists)
        ? track.artists.map((artist) => artist?.name || (typeof artist === 'string' ? artist : null)).filter(Boolean)
        : [];
    const artist =
        artistNames.join(', ') ||
        track?.artist?.name ||
        (typeof track?.artist === 'string' ? track.artist : null) ||
        null;
    return {
        track: {
            id: track?.id ?? fallbackId ?? null,
            title: track?.title || track?.name || null,
            artist,
            album:
                track?.album?.title ||
                track?.album?.name ||
                (typeof track?.album === 'string' ? track.album : null) ||
                null,
            isrc: track?.isrc || null,
            provider:
                track?.provider || (String(track?.id ?? fallbackId ?? '').startsWith('apple:') ? 'apple' : 'tidal'),
        },
        requestedQuality: quality || null,
        intent,
        unifiedPlayback,
    };
}

function notifyAudioSourceMissing(details = null) {
    const now = Date.now();
    if (now - lastAudioSourceMissingNotifyAt < 3000) return;
    lastAudioSourceMissingNotifyAt = now;
    import('./downloads.js')
        .then((m) =>
            m.showNotification('Could not find Audio Source', {
                type: 'error',
                details,
            })
        )
        .catch(() => {});
}

export class LosslessAPI {
    constructor(settings) {
        this.settings = settings;
        this.cache = new APICache({
            maxSize: 200,
            ttl: 1000 * 60 * 30,
        });
        this.streamCache = new Map();
        this.unifiedPlaybackRequests = new Map();
        this.unifiedPlaybackFailures = new Map();
        this.turnstileLoadPromise = null;
        this._combinedSearchUnavailable = false;

        setInterval(
            async () => {
                await this.cache.clearExpired();
                this.pruneStreamCache();
            },
            1000 * 60 * 5
        );
    }

    pruneStreamCache() {
        if (this.streamCache.size > 50) {
            const entries = Array.from(this.streamCache.entries());
            const toDelete = entries.slice(0, entries.length - 50);
            toDelete.forEach(([key]) => this.streamCache.delete(key));
        }
    }

    usesSingleUsePlaybackUrls() {
        return false;
    }

    async fetchWithRetry(relativePath, options = {}) {
        const type = options.type || 'api';
        const isSearchRequest = relativePath.startsWith('/search/');
        const getInstances = async (forceRefresh = false) => {
            if (forceRefresh && this.settings && typeof this.settings.refreshInstances === 'function') {
                try {
                    await this.settings.refreshInstances();
                } catch (refreshError) {
                    console.warn('Failed to refresh API instances from uptime workers:', refreshError);
                }
            }

            let instances = await this.settings.getInstances(type);
            if (options.userInstancesOnly) {
                instances = instances.filter((i) => i.isUser);
                if (instances.length === 0) {
                    throw new Error(`No user API instances configured for type: ${type}`);
                }
            } else if (instances.length === 0) {
                throw new Error(`No API instances configured for type: ${type}`);
            }

            if (options.minVersion) {
                instances = instances.filter((instance) => {
                    if (!instance.version) return false;
                    return parseFloat(instance.version) >= parseFloat(options.minVersion);
                });
                if (instances.length === 0) {
                    throw new Error(
                        `No API instances configured for type: ${type} with minVersion: ${options.minVersion}`
                    );
                }
            }

            if (options.allowedDomains) {
                instances = instances.filter((instance) => {
                    const url = typeof instance === 'string' ? instance : instance.url;
                    return options.allowedDomains.some((domain) => url.includes(domain));
                });
                if (instances.length === 0) {
                    throw new Error(
                        `No API instances configured for type: ${type} matching allowedDomains: ${options.allowedDomains.join(', ')}`
                    );
                }
            }

            return instances;
        };

        const tryInstances = async (instances) => {
            const maxTotalAttempts = instances.length * 2; // Allow some retries across instances
            let lastError = null;
            let instanceIndex = Math.floor(Math.random() * instances.length);

            for (let attempt = 1; attempt <= maxTotalAttempts; attempt++) {
                const instance = instances[instanceIndex % instances.length];
                const baseUrl = typeof instance === 'string' ? instance : instance.url;

                const isTidal = baseUrl.includes('api.tidal.com') || baseUrl.includes('openapi.tidal.com');
                const targetUrl = baseUrl.endsWith('/')
                    ? `${baseUrl}${relativePath.substring(1)}`
                    : `${baseUrl}${relativePath}`;

                const url = isTidal ? wrapTidalUrl(targetUrl) : targetUrl;

                try {
                    const response = await fetch(url, { signal: options.signal });

                    if (response.status === 429) {
                        console.warn(`Rate limit hit on ${baseUrl}. Trying next instance...`);
                        instanceIndex++;
                        await delay(500);
                        continue;
                    }

                    if (response.ok) {
                        return response;
                    }

                    if (response.status === 401) {
                        const errorData = await response
                            .clone()
                            .json()
                            .catch(() => null);
                        if (errorData?.subStatus === 11002) {
                            console.warn(`Auth failed on ${baseUrl}. Trying next instance...`);
                            instanceIndex++;
                            continue;
                        }
                    }

                    if (response.status >= 500) {
                        console.warn(`Server error ${response.status} on ${baseUrl}. Trying next instance...`);
                        instanceIndex++;
                        continue;
                    }

                    lastError = new Error(`Request failed with status ${response.status}`);
                    instanceIndex++;
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    lastError = error;
                    console.warn(`Network error on ${baseUrl}: ${error.message}. Trying next instance...`);
                    instanceIndex++;
                    await delay(200);
                }
            }

            throw lastError || new Error(`All API instances failed for: ${relativePath}`);
        };

        if (devModeSettings.isEnabled()) {
            const devBaseUrl = devModeSettings.getUrl().replace(/\/+$/, '');
            const url = devBaseUrl + (relativePath.startsWith('/') ? relativePath : '/' + relativePath);

            if (import.meta.env.DEV) {
                console.log('[dev-mode]', url);
            }

            const response = await fetch(url, { signal: options.signal });
            if (!response.ok) {
                throw new Error(`Dev mode request failed: ${response.status} ${response.statusText}`);
            }
            return response;
        }

        const shouldTryNative = type !== 'streaming';
        let nativeError = null;

        if (shouldTryNative) {
            try {
                if (import.meta.env.DEV) {
                    console.log(relativePath);
                }

                // HiFiClient.query fans out across the native TIDAL endpoints used by the route
                // implementation, including api.tidal.com and openapi.tidal.com where applicable.
                return await HiFiClient.instance.query(relativePath);
            } catch (err) {
                if (options.directOnly) {
                    throw err;
                }

                nativeError = err;

                if (import.meta.env.DEV && isSearchRequest) {
                    console.warn(
                        `[search] native TIDAL query failed for ${relativePath}, trying HiFi worker instances`,
                        err
                    );
                } else {
                    console.warn(
                        `Native TIDAL query failed for ${relativePath}. Falling back to configured HiFi API instances...`,
                        err
                    );
                }
            }
        }

        try {
            return await tryInstances(await getInstances(false));
        } catch (error) {
            if (type === 'streaming' || options.userInstancesOnly) {
                throw error;
            }
        }

        try {
            return await tryInstances(await getInstances(true));
        } catch (error) {
            // GRRRRR T YOU PISS ME OFFFF
            if (nativeError && /^No (user )?API instances configured/.test(error?.message || '')) {
                throw new Error(
                    "This is an error on the DSPs end :( their v1 API is down, and sadly we're unable to fix it on our side. It should resolve itself after some time, however.",
                    { cause: nativeError }
                );
            }
            throw error;
        }
    }

    findSearchSection(source, key, visited) {
        if (!source || typeof source !== 'object') return;

        if (Array.isArray(source)) {
            for (const e of source) {
                const f = this.findSearchSection(e, key, visited);
                if (f) return f;
            }
            return;
        }

        if (visited.has(source)) return;
        visited.add(source);

        if ('items' in source && Array.isArray(source.items)) return source;

        if (key in source) {
            const f = this.findSearchSection(source[key], key, visited);
            if (f) return f;
        }

        for (const v of Object.values(source)) {
            const f = this.findSearchSection(v, key, visited);
            if (f) return f;
        }
    }

    buildSearchResponse(section) {
        const items = section?.items ?? [];
        return {
            items,
            limit: section?.limit ?? items.length,
            offset: section?.offset ?? 0,
            totalNumberOfItems: section?.totalNumberOfItems ?? items.length,
        };
    }

    normalizeSearchResponse(data, key) {
        const section = this.findSearchSection(data, key, new Set());
        return this.buildSearchResponse(section);
    }

    prepareTrack(track) {
        let normalized = { ...track };

        if (track.type && typeof track.type === 'string') {
            const lowType = track.type.toLowerCase();
            if (lowType.includes('video')) {
                normalized.type = 'video';
            } else if (lowType.includes('track')) {
                normalized.type = 'track';
            } else {
                normalized.type = lowType;
            }
        }

        if (!normalized.artist && Array.isArray(normalized.artists) && normalized.artists.length > 0) {
            normalized.artist = normalized.artists[0];
        } else if (normalized.artist && !normalized.artists) {
            normalized.artists = [normalized.artist];
        }

        if (track.album) {
            normalized.album = { ...track.album };
            if (track.album.releaseDate) {
                normalized.album.releaseDate = track.album.releaseDate;
            }
        }

        const derivedQuality = deriveTrackQuality(normalized);
        if (derivedQuality && normalized.audioQuality !== derivedQuality) {
            normalized.audioQuality = derivedQuality;
        }

        normalized.isUnavailable = isTrackUnavailable(normalized);

        return normalized.type == 'video' ? new PreparedVideo(normalized) : new PreparedTrack(normalized);
    }

    prepareAlbum(album) {
        if (!album.artist && Array.isArray(album.artists) && album.artists.length > 0) {
            return { ...album, artist: album.artists[0] };
        }
        return album;
    }

    preparePlaylist(playlist) {
        return playlist;
    }

    prepareVideo(video) {
        let normalized = { ...video, type: 'video' };

        if (!video.artist && Array.isArray(video.artists) && video.artists.length > 0) {
            normalized.artist = video.artists[0];
        }

        return normalized;
    }

    prepareArtist(artist) {
        if (!artist.type && Array.isArray(artist.artistTypes) && artist.artistTypes.length > 0) {
            return { ...artist, type: artist.artistTypes[0] };
        }
        return artist;
    }

    async enrichTracksWithAlbumDates(tracks, maxRequests = 20) {
        if (!trackDateSettings.useAlbumYear()) return tracks;

        const albumIdsToFetch = [];
        for (const track of tracks) {
            if (!track.album?.releaseDate && track.album?.id && !albumIdsToFetch.includes(track.album.id)) {
                albumIdsToFetch.push(track.album.id);
            }
        }

        if (albumIdsToFetch.length === 0) return tracks;

        // Limit the number of albums to fetch to prevent spamming
        const limitedIds = albumIdsToFetch.slice(0, maxRequests);
        if (albumIdsToFetch.length > maxRequests) {
            console.warn(`[Enrich] Too many albums to fetch (${albumIdsToFetch.length}). limiting to ${maxRequests}.`);
        }

        const albumDateMap = new Map();

        // Chunk requests to avoid spamming
        const chunkSize = 5;
        for (let i = 0; i < limitedIds.length; i += chunkSize) {
            const chunk = limitedIds.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map((id) => this.getAlbum(id)));

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const id = chunk[j];
                if (result.status === 'fulfilled' && result.value.album?.releaseDate) {
                    albumDateMap.set(id, result.value.album.releaseDate);
                }
            }
        }

        return tracks.map((track) => {
            if (!track.album?.releaseDate && track.album?.id && albumDateMap.has(track.album.id)) {
                return { ...track, album: { ...track.album, releaseDate: albumDateMap.get(track.album.id) } };
            }
            return track;
        });
    }

    async enrichTracksWithAlbumCover(tracks, maxRequests = 20) {
        if (!Array.isArray(tracks) || tracks.length === 0) return tracks;

        const albumIdsToFetch = [];
        for (const track of tracks) {
            if (!track?.album?.cover && track?.album?.id && !albumIdsToFetch.includes(track.album.id)) {
                albumIdsToFetch.push(track.album.id);
            }
        }

        if (albumIdsToFetch.length === 0) return tracks;

        const limitedIds = albumIdsToFetch.slice(0, maxRequests);

        const coverMap = new Map();
        const chunkSize = 5;
        for (let i = 0; i < limitedIds.length; i += chunkSize) {
            const chunk = limitedIds.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map((id) => this.getAlbum(id)));
            for (let j = 0; j < results.length; j++) {
                const r = results[j];
                if (r.status === 'fulfilled' && r.value?.album?.cover) {
                    coverMap.set(chunk[j], r.value.album.cover);
                }
            }
        }

        if (coverMap.size === 0) return tracks;

        return tracks.map((track) => {
            if (!track?.album?.cover && track?.album?.id && coverMap.has(track.album.id)) {
                return { ...track, album: { ...track.album, cover: coverMap.get(track.album.id) } };
            }
            return track;
        });
    }

    async enrichArtistsWithPicture(artists, maxRequests = 10) {
        if (!Array.isArray(artists) || artists.length === 0) return artists;

        const idsToFetch = [];
        for (const artist of artists) {
            if (!artist?.picture && artist?.id && !idsToFetch.includes(artist.id)) {
                idsToFetch.push(artist.id);
            }
        }

        if (idsToFetch.length === 0) return artists;

        const limitedIds = idsToFetch.slice(0, maxRequests);

        const pictureMap = new Map();
        const chunkSize = 5;
        for (let i = 0; i < limitedIds.length; i += chunkSize) {
            const chunk = limitedIds.slice(i, i + chunkSize);
            const results = await Promise.allSettled(chunk.map((id) => this.getArtist(id, { lightweight: true })));
            for (let j = 0; j < results.length; j++) {
                const r = results[j];
                if (r.status === 'fulfilled' && r.value?.picture) {
                    pictureMap.set(chunk[j], r.value.picture);
                }
            }
        }

        if (pictureMap.size === 0) return artists;

        return artists.map((artist) => {
            if (!artist?.picture && artist?.id && pictureMap.has(artist.id)) {
                return { ...artist, picture: pictureMap.get(artist.id) };
            }
            return artist;
        });
    }

    parseTrackLookup(data) {
        const entries = Array.isArray(data) ? data : [data];
        let track, info, originalTrackUrl;

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;

            if (!track && 'duration' in entry) {
                track = entry;
                continue;
            }

            if (!info && 'manifest' in entry) {
                info = entry;
                continue;
            }

            if (!originalTrackUrl && 'OriginalTrackUrl' in entry) {
                const candidate = entry.OriginalTrackUrl;
                if (typeof candidate === 'string') {
                    originalTrackUrl = candidate;
                }
            }
        }

        if (!track || !info) {
            throw new Error('Malformed track response');
        }

        return { track, info, originalTrackUrl };
    }

    extractStreamUrlFromManifest(manifest) {
        if (!manifest) return null;

        try {
            let decoded;
            if (typeof manifest === 'string') {
                try {
                    decoded = atob(manifest);
                } catch {
                    decoded = manifest;
                }
            } else if (typeof manifest === 'object') {
                if (manifest.urls && Array.isArray(manifest.urls)) {
                    const priorityKeywords = ['flac', 'lossless', 'hi-res', 'high'];
                    const sortedUrls = [...manifest.urls].sort((a, b) => {
                        const aLow = String(a ?? '').toLowerCase();
                        const bLow = String(b ?? '').toLowerCase();
                        const aScore = priorityKeywords.findIndex((k) => aLow.includes(k));
                        const bScore = priorityKeywords.findIndex((k) => bLow.includes(k));

                        const finalAScore = aScore === -1 ? 999 : aScore;
                        const finalBScore = bScore === -1 ? 999 : bScore;

                        return finalAScore - finalBScore;
                    });
                    return sortedUrls[0];
                }
                if (manifest.urls?.[0]) return manifest.urls[0];
                return null;
            } else {
                return null;
            }

            // Check if it's a DASH manifest (XML)
            if (decoded.includes('<MPD')) {
                const blob = new Blob([decoded], { type: 'application/dash+xml' });
                return URL.createObjectURL(blob);
            }

            try {
                const parsed = JSON.parse(decoded);
                if (parsed?.urls && Array.isArray(parsed.urls)) {
                    const priorityKeywords = ['flac', 'lossless', 'hi-res', 'high'];
                    const sortedUrls = [...parsed.urls].sort((a, b) => {
                        const aLow = String(a ?? '').toLowerCase();
                        const bLow = String(b ?? '').toLowerCase();
                        const aScore = priorityKeywords.findIndex((k) => aLow.includes(k));
                        const bScore = priorityKeywords.findIndex((k) => bLow.includes(k));
                        const finalAScore = aScore === -1 ? 999 : aScore;
                        const finalBScore = bScore === -1 ? 999 : bScore;
                        return finalAScore - finalBScore;
                    });
                    return sortedUrls[0];
                }
                if (parsed?.urls?.[0]) {
                    return parsed.urls[0];
                }
            } catch {
                const match = decoded.match(/https?:\/\/[\w\-.~:?#[@!$&'()*+,;=%/]+/);
                return match ? match[0] : null;
            }
        } catch (error) {
            console.error('Failed to decode manifest:', error);
            return null;
        }
    }

    deduplicateAlbums(albums) {
        const unique = new Map();

        for (const album of albums) {
            // Key based on title and numberOfTracks (excluding duration and explicit)
            const key = JSON.stringify([album.title, album.numberOfTracks || 0]);

            if (unique.has(key)) {
                const existing = unique.get(key);

                // Priority 1: Explicit
                if (album.explicit && !existing.explicit) {
                    unique.set(key, album);
                    continue;
                }
                if (!album.explicit && existing.explicit) {
                    continue;
                }

                // Priority 2: More Metadata Tags (if explicit status is same)
                const existingTags = existing.mediaMetadata?.tags?.length || 0;
                const newTags = album.mediaMetadata?.tags?.length || 0;

                if (newTags > existingTags) {
                    unique.set(key, album);
                }
            } else {
                unique.set(key, album);
            }
        }

        return Array.from(unique.values());
    }

    async search(query, options = {}) {
        const cached = await this.cache.get('search_all', query);
        if (cached) return cached;

        if (!this._combinedSearchUnavailable) {
            try {
                const response = await this.fetchWithRetry(`/search/?q=${encodeURIComponent(query)}`, options);
                const data = await response.json();

                const extractSection = (key) => this.normalizeSearchResponse(data, key);

                const tracksData = extractSection('tracks');
                const artistsData = extractSection('artists');
                const albumsData = extractSection('albums');
                const playlistsData = extractSection('playlists');
                const videosData = extractSection('videos');

                const preparedTracks = tracksData.items.map((t) => this.prepareTrack(t));
                const preparedArtists = artistsData.items.map((a) => this.prepareArtist(a));

                const [enrichedTracks, enrichedArtists] = await Promise.all([
                    this.enrichTracksWithAlbumCover(preparedTracks),
                    options.enrichArtists === false
                        ? Promise.resolve(preparedArtists)
                        : this.enrichArtistsWithPicture(preparedArtists),
                ]);

                const results = {
                    tracks: {
                        ...tracksData,
                        items: enrichedTracks,
                    },
                    artists: {
                        ...artistsData,
                        items: enrichedArtists,
                    },
                    albums: {
                        ...albumsData,
                        items: albumsData.items.map((a) => this.prepareAlbum(a)),
                    },
                    playlists: playlistsData
                        ? {
                              ...playlistsData,
                              items: playlistsData.items.map((p) => this.preparePlaylist(p)),
                          }
                        : { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
                    videos: {
                        ...videosData,
                        items: videosData.items.map((v) => this.prepareTrack(v)),
                    },
                };

                await this.cache.set('search_all', query, results);

                return results;
            } catch (error) {
                if (error.name === 'AbortError') throw error;

                this._combinedSearchUnavailable = true;

                if (import.meta.env.DEV) {
                    console.warn('[search] combined search failed, using HiFi scoped fallback', error);
                }
            }
        }

        const [tracks, videos, artists, albums, playlists] = await Promise.all([
            this.searchTracks(query, options).catch(() => ({ items: [] })),
            this.searchVideos(query, options).catch(() => ({ items: [] })),
            this.searchArtists(query, options).catch(() => ({ items: [] })),
            this.searchAlbums(query, options).catch(() => ({ items: [] })),
            this.searchPlaylists(query, options).catch(() => ({ items: [] })),
        ]);

        return {
            tracks,
            videos,
            artists,
            albums,
            playlists,
        };
    }

    async searchTracks(query, options = {}) {
        const cached = await this.cache.get('search_tracks', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?s=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'tracks');
            const preparedTracks = normalized.items.map((t) => this.prepareTrack(t));
            const enrichedTracks = await this.enrichTracksWithAlbumCover(preparedTracks);
            const result = {
                ...normalized,
                items: enrichedTracks,
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_tracks', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Track search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchTracksByIsrc(isrc, options = {}) {
        const normalizedIsrc = String(isrc || '').trim();
        if (!normalizedIsrc) return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };

        const cacheKey = `isrc:${normalizedIsrc}`;
        const cached = await this.cache.get('search_tracks', cacheKey);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?i=${encodeURIComponent(normalizedIsrc)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'tracks');
            const preparedTracks = normalized.items.map((t) => this.prepareTrack(t));
            const enrichedTracks = await this.enrichTracksWithAlbumCover(preparedTracks);
            const result = {
                ...normalized,
                items: enrichedTracks,
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_tracks', cacheKey, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('ISRC track search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchArtists(query, options = {}) {
        const cached = await this.cache.get('search_artists', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?a=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'artists');
            const preparedArtists = normalized.items.map((a) => this.prepareArtist(a));
            const enrichedArtists = await this.enrichArtistsWithPicture(preparedArtists);
            const result = {
                ...normalized,
                items: enrichedArtists,
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_artists', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Artist search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchAlbums(query, options = {}) {
        const cached = await this.cache.get('search_albums', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?al=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'albums');
            const preparedItems = normalized.items.map((a) => this.prepareAlbum(a));
            const result = {
                ...normalized,
                items: this.deduplicateAlbums(preparedItems),
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_albums', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Album search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchPlaylists(query, options = {}) {
        const cached = await this.cache.get('search_playlists', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?p=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'playlists');
            const result = {
                ...normalized,
                items: normalized.items.map((p) => this.preparePlaylist(p)),
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_playlists', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Playlist search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchVideos(query, options = {}) {
        const cached = await this.cache.get('search_videos', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?v=${encodeURIComponent(query)}`, {
                ...options,
            });
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'videos');
            const result = {
                ...normalized,
                items: normalized.items.map((v) => this.prepareVideo(v)),
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('search_videos', query, result);
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Video search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async getVideo(id) {
        const cached = await this.cache.get('video', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/video/?id=${id}`, {
            type: 'streaming',
        });
        const jsonResponse = await response.json();

        const data = jsonResponse.data || jsonResponse;

        const result = {
            track: data,
            info: data,
            originalTrackUrl: data.OriginalTrackUrl || null,
        };

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('video', id, result);
        }
        return result;
    }

    async getAlbum(id) {
        const cached = await this.cache.get('album', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/album/?id=${id}`);
        const jsonData = await response.json();

        // Unwrap the data property if it exists
        const data = jsonData.data || jsonData;

        let album, tracksSection;

        if (data && typeof data === 'object' && !Array.isArray(data)) {
            // Check for album metadata at root level
            if ('numberOfTracks' in data || 'title' in data) {
                album = this.prepareAlbum(data);
            }

            // Set tracksSection if items exist
            if ('items' in data) {
                tracksSection = data;

                // If we still don't have album but have items with tracks, try to extract album from first track
                if (!album && data.items && data.items.length > 0) {
                    const firstItem = data.items[0];
                    const track = firstItem.item || firstItem;

                    // Check if track has album property
                    if (track && track.album) {
                        album = this.prepareAlbum(track.album);
                    }
                }
            }
        }

        if (!album) throw new Error('Album not found');

        // If album exists but has no artist, try to extract from tracks
        if (!album.artist && tracksSection?.items && tracksSection.items.length > 0) {
            const firstTrack = tracksSection.items[0];
            const track = firstTrack.item || firstTrack;
            if (track && track.artist) {
                album = { ...album, artist: track.artist };
            }
        }

        // If album exists but has no releaseDate, try to extract from tracks
        if (!album.releaseDate && tracksSection?.items && tracksSection.items.length > 0) {
            const firstTrack = tracksSection.items[0];
            const track = firstTrack.item || firstTrack;

            if (track) {
                if (track.album && track.album.releaseDate) {
                    album = { ...album, releaseDate: track.album.releaseDate };
                } else if (track.streamStartDate) {
                    album = { ...album, releaseDate: track.streamStartDate.split('T')[0] };
                }
            }
        }

        let tracks = (tracksSection?.items || []).map((i) => this.prepareTrack(i.item || i));

        // Handle pagination if there are more tracks
        if (album && album.numberOfTracks > tracks.length) {
            let offset = tracks.length;
            const SAFE_MAX_TRACKS = 10000;

            while (tracks.length < album.numberOfTracks && tracks.length < SAFE_MAX_TRACKS) {
                try {
                    const nextResponse = await this.fetchWithRetry(`/album/?id=${id}&offset=${offset}&limit=500`);
                    const nextJson = await nextResponse.json();
                    const nextData = nextJson.data || nextJson;

                    let nextItems = [];

                    if (nextData.items) {
                        nextItems = nextData.items;
                    } else if (Array.isArray(nextData)) {
                        for (const entry of nextData) {
                            if (entry && typeof entry === 'object' && 'items' in entry && Array.isArray(entry.items)) {
                                nextItems = entry.items;
                                break;
                            }
                        }
                    }

                    if (!nextItems || nextItems.length === 0) break;

                    const preparedItems = nextItems.map((i) => this.prepareTrack(i.item || i));
                    if (preparedItems.length === 0) break;

                    // Safeguard: If API ignores offset, it returns the first page again.
                    // Check if the first new item matches the very first track we have.
                    if (tracks.length > 0 && preparedItems[0].id === tracks[0].id) {
                        break;
                    }

                    // Also check if the first new item matches the last track we have (overlap check)
                    if (tracks.length > 0 && preparedItems[0].id === tracks[tracks.length - 1].id) {
                        // If it's just one overlap, maybe we should skip it?
                        // But usually offset should be precise.
                        // If we see exact same id as first track, it's definitely a loop.
                    }

                    tracks = tracks.concat(preparedItems);
                    offset += preparedItems.length;
                } catch (error) {
                    console.error(`Error fetching album tracks at offset ${offset}:`, error);
                    break;
                }
            }
        }

        // Enrich tracks with album releaseDate if available
        if (album?.releaseDate) {
            tracks = tracks.map((track) => {
                if (track.album && !track.album.releaseDate) {
                    return { ...track, album: { ...track.album, releaseDate: album.releaseDate } };
                }
                return track;
            });
        }

        tracks = tracks.map((t) => {
            if (t.album) {
                // Propagate the parent album's cover to each track's album sub-object when
                // the API omits it in the per-track album object (common for album endpoints).
                t.album = new TrackAlbum({
                    ...t.album,
                    cover: t.album.cover || album.cover,
                });
            }

            return new Track(t);
        });

        album = new Album(album);

        const result = { album, tracks };

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('album', id, result);
        }
        return result;
    }

    async getPlaylist(id) {
        const cached = await this.cache.get('playlist', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/playlist/?id=${id}`);
        const jsonData = await response.json();

        // Unwrap the data property if it exists
        const data = jsonData.data || jsonData;

        let playlist = null;
        let tracksSection = null;

        // Check for direct playlist property (common in v2 responses)
        if (data.playlist) {
            playlist = data.playlist;
        }

        // Check for direct items property
        if (data.items) {
            tracksSection = { items: data.items };
        }

        // Fallback: iterate if we still missed something or if structure is flat array
        if (!playlist || !tracksSection) {
            const entries = Array.isArray(data) ? data : [data];
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;

                if (
                    !playlist &&
                    ('uuid' in entry || 'numberOfTracks' in entry || ('title' in entry && 'id' in entry))
                ) {
                    playlist = entry;
                }

                if (!tracksSection && 'items' in entry) {
                    tracksSection = entry;
                }
            }
        }

        // Fallback 2: If we have a list of entries but no explicit playlist object, try to find one that looks like a playlist
        if (!playlist && Array.isArray(data)) {
            for (const entry of data) {
                if (entry && typeof entry === 'object' && ('uuid' in entry || 'numberOfTracks' in entry)) {
                    playlist = entry;
                    break;
                }
            }
        }

        if (!playlist) throw new Error('Playlist not found');

        let tracks = (tracksSection?.items || []).map((i) => this.prepareTrack(i.item || i));

        // Handle pagination if there are more tracks
        if (playlist.numberOfTracks > tracks.length) {
            let offset = tracks.length;
            const SAFE_MAX_TRACKS = 10000;

            while (tracks.length < playlist.numberOfTracks && tracks.length < SAFE_MAX_TRACKS) {
                try {
                    const nextResponse = await this.fetchWithRetry(`/playlist/?id=${id}&offset=${offset}`);
                    const nextJson = await nextResponse.json();
                    const nextData = nextJson.data || nextJson;

                    let nextItems = [];

                    if (nextData.items) {
                        nextItems = nextData.items;
                    } else if (Array.isArray(nextData)) {
                        for (const entry of nextData) {
                            if (entry && typeof entry === 'object' && 'items' in entry && Array.isArray(entry.items)) {
                                nextItems = entry.items;
                                break;
                            }
                        }
                    }

                    if (!nextItems || nextItems.length === 0) break;

                    const preparedItems = nextItems.map((i) => this.prepareTrack(i.item || i));
                    if (preparedItems.length === 0) break;

                    // Safeguard: If API ignores offset, it returns the first page again.
                    // Check if the first new item matches the very first track we have.
                    if (tracks.length > 0 && preparedItems[0].id === tracks[0].id) {
                        break;
                    }

                    tracks = tracks.concat(preparedItems);
                    offset += preparedItems.length;
                } catch (error) {
                    console.error(`Error fetching playlist tracks at offset ${offset}:`, error);
                    break;
                }
            }
        }

        // Enrich tracks with album release dates
        // Removed to reduce API load. Playlists can be very large.
        // tracks = await this.enrichTracksWithAlbumDates(tracks);

        tracks = tracks.map((t) => {
            if (t.album) {
                t.album = new TrackAlbum(t.album);
            }

            return new Track(t);
        });

        const result = { playlist, tracks };

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('playlist', id, result);
        }
        return result;
    }

    async getMix(id) {
        const cached = await this.cache.get('mix', id);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/mix/?id=${id}`, { type: 'api', minVersion: '2.3' });
        const data = await response.json();

        const mixData = data.mix;
        const items = data.items || [];

        if (!mixData) {
            throw new Error('Mix metadata not found');
        }

        let tracks = items.map((i) => this.prepareTrack(i.item || i));

        // Enrich tracks with album release dates
        // Limited to reduce API load
        tracks = await this.enrichTracksWithAlbumDates(tracks, 10);

        tracks = tracks.map((t) => {
            if (t.album) {
                t.album = new TrackAlbum(t.album);
            }

            return new Track(t);
        });

        const mix = {
            id: mixData.id,
            title: mixData.title,
            subTitle: mixData.subTitle,
            description: mixData.description,
            mixType: mixData.mixType,
            cover: mixData.images?.LARGE?.url || mixData.images?.MEDIUM?.url || mixData.images?.SMALL?.url || null,
        };

        const result = { mix, tracks };
        if (!(response instanceof TidalResponse)) {
            await this.cache.set('mix', id, result);
        }
        return result;
    }

    async getArtistSocials(artistName) {
        const cacheKey = `artist_socials_${artistName}`;
        const cached = await this.cache.get('artist', cacheKey);
        if (cached) return cached;

        try {
            const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`;
            const searchRes = await fetch(searchUrl, {
                headers: { 'User-Agent': 'Monochrome/2.0.0 ( https://github.com/monochrome-music/monochrome )' },
            });
            const searchData = await searchRes.json();

            if (!searchData.artists || searchData.artists.length === 0) return [];

            const artist = searchData.artists[0];
            const mbid = artist.id;

            const detailsUrl = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`;
            const detailsRes = await fetch(detailsUrl, {
                headers: { 'User-Agent': 'Monochrome/2.0.0 ( https://github.com/monochrome-music/monochrome )' },
            });
            const detailsData = await detailsRes.json();

            const links = [];
            if (detailsData.relations) {
                for (const rel of detailsData.relations) {
                    if (
                        [
                            'social network',
                            'streaming',
                            'official homepage',
                            'youtube',
                            'soundcloud',
                            'bandcamp',
                        ].includes(rel.type)
                    ) {
                        links.push({ type: rel.type, url: rel.url.resource });
                    }
                }
            }

            await this.cache.set('artist', cacheKey, links);
            return links;
        } catch (e) {
            console.warn('Failed to fetch artist socials:', e);
            return [];
        }
    }

    async getArtist(artistId, options = {}) {
        const cacheKey = options.lightweight ? `artist_${artistId}_light` : `artist_${artistId}`;
        if (!options.skipCache) {
            const cached = await this.cache.get('artist', cacheKey);
            if (cached) return cached;
        }

        const primaryResponse = await this.fetchWithRetry(`/artist/?id=${artistId}`);
        const primaryJsonData = await primaryResponse.json();

        // Unwrap data property if it exists, then unwrap artist property if it exists
        let primaryData = primaryJsonData.data || primaryJsonData;
        const rawArtist = primaryData.artist || (Array.isArray(primaryData) ? primaryData[0] : primaryData);

        if (!rawArtist) throw new Error('Primary artist details not found.');

        const artist = {
            ...this.prepareArtist(rawArtist),
            picture: rawArtist.picture || null,
            name: rawArtist.name || 'Unknown Artist',
        };

        const albumMap = new Map();
        const trackMap = new Map();
        const videoMap = new Map();

        const isTrack = (v) => v?.id && (v.duration || v.trackNumber != null || v.type === 'track');
        const isAlbum = (v) =>
            v?.id && ('numberOfTracks' in v || 'numberOfItems' in v || v.type === 'album' || v.type === 'ALBUM');
        const isVideo = (v) => v?.id && (!!v.type?.toLowerCase().includes('video') || v.type === 'VIDEO');

        const scan = (value, visited) => {
            if (!value || typeof value !== 'object' || visited.has(value)) return;
            visited.add(value);

            if (Array.isArray(value)) {
                value.forEach((item) => scan(item, visited));
                return;
            }

            const item = value.item || value;
            const type = (item.type || '').toLowerCase();

            if (isAlbum(item) || type === 'album') albumMap.set(item.id, this.prepareAlbum(item));
            if ((isTrack(item) || type === 'track') && !isAlbum(item) && !isVideo(item)) {
                trackMap.set(item.id, this.prepareTrack(item));
            }
            if (isVideo(item) || type === 'video') videoMap.set(item.id, this.prepareVideo(item));

            Object.values(value).forEach((nested) => scan(nested, visited));
        };

        const visited = new Set();
        scan(primaryData, visited);

        if (albumMap.size === 0) {
            try {
                if (import.meta.env.DEV) {
                    console.log('No albums in primary response, trying fallback fetch');
                }
                const albumsResponse = await this.fetchWithRetry(`/artist/?f=${artistId}&skip_tracks=true`);
                const albumsData = await albumsResponse.json();
                scan(albumsData, visited);
            } catch (e) {
                console.warn('Fallback album fetch failed:', e);
            }
        }

        const matchesArtistId = (item) => {
            const candidateIds = [
                item.artistId,
                item.artist_id,
                item.artist?.id,
                ...(Array.isArray(item.artists) ? item.artists.map((a) => a.id) : []),
                ...(Array.isArray(item.artistRoles) ? item.artistRoles.map((r) => r.artist?.id) : []),
            ].filter((id) => id != null);

            if (item.artist && (typeof item.artist === 'number' || typeof item.artist === 'string')) {
                candidateIds.push(item.artist);
            }

            return candidateIds.some((id) => Number(id) === Number(artist.id) || Number(id) === Number(artistId));
        };

        if (!options.lightweight) {
            try {
                const videoSearch = await this.searchVideos(artist.name);
                if (videoSearch && videoSearch.items) {
                    for (const item of videoSearch.items) {
                        if (matchesArtistId(item) && !videoMap.has(item.id)) {
                            videoMap.set(item.id, item);
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch additional videos via search:', e);
            }
        }

        const rawReleases = Array.from(albumMap.values()).filter(matchesArtistId);
        const allReleases = this.deduplicateAlbums(rawReleases).sort(
            (a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0)
        );

        const eps = allReleases.filter((a) => a.type === 'EP' || a.type === 'SINGLE');
        const albums = allReleases.filter((a) => !eps.includes(a));

        const topTracks = Array.from(trackMap.values())
            .filter(matchesArtistId)
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 15);

        const videos = Array.from(videoMap.values()).sort(
            (a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0)
        );

        // Enrich tracks with album release dates
        const tracks = options.lightweight ? topTracks : await this.enrichTracksWithAlbumDates(topTracks);

        const result = { ...artist, albums, eps, tracks, videos };

        if (!(primaryResponse instanceof TidalResponse)) {
            await this.cache.set('artist', cacheKey, result);
        }
        return result;
    }

    async getArtistTopTracks(artistId, options = {}) {
        const offset = options.offset || 0;
        const limit = options.limit || 15;
        console.log('[getArtistTopTracks] Called:', { artistId, offset, limit, options });

        const cacheKey = `artist_tracks_${artistId}_${offset}_${limit}`;
        if (!options.skipCache) {
            const cached = await this.cache.get('artist', cacheKey);
            if (cached) return cached;
        }

        try {
            // Use f parameter with skip_tracks=true to get toptracks from the dedicated endpoint
            const response = await this.fetchWithRetry(
                `/artist/?f=${artistId}&skip_tracks=true&offset=${offset}&limit=${limit}`
            );
            const jsonData = await response.json();

            let data = jsonData.data || jsonData;
            console.log(
                '[getArtistTopTracks] Raw response data keys:',
                Object.keys(data),
                'tracks:',
                data.tracks?.length
            );

            // Extract tracks from the response
            let tracks = [];

            // Check for tracks array directly (from toptracks endpoint)
            if (Array.isArray(data.tracks)) {
                tracks = data.tracks;
            }

            // Also scan for tracks in the data structure
            if (tracks.length === 0) {
                const trackMap = new Map();
                const isTrack = (v) => v?.id && v.duration;

                const scan = (value, visited) => {
                    if (!value || typeof value !== 'object' || visited.has(value)) return;
                    visited.add(value);

                    if (Array.isArray(value)) {
                        value.forEach((item) => scan(item, visited));
                        return;
                    }

                    const item = value.item || value;
                    if (isTrack(item)) {
                        trackMap.set(item.id, this.prepareTrack(item));
                    }

                    Object.values(value).forEach((nested) => scan(nested, visited));
                };

                const visited = new Set();
                scan(data, visited);
                tracks = Array.from(trackMap.values());
            }

            tracks = tracks.map((t) => this.prepareTrack(t)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            tracks = await this.enrichTracksWithAlbumDates(tracks);

            // Safeguard: If API ignores offset, it returns the same first tracks
            const hasMore = tracks.length === limit && (offset === 0 || tracks[0]?.id !== options.firstTrackId);
            const result = {
                tracks,
                offset,
                limit,
                hasMore,
            };

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('artist', cacheKey, result);
            }
            return result;
        } catch (e) {
            console.warn('Failed to fetch artist top tracks:', e);
            return { tracks: [], offset, limit, hasMore: false };
        }
    }

    async getSimilarArtists(artistId) {
        const cached = await this.cache.get('similar_artists', artistId);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/artist/similar/?id=${artistId}`, {
                type: 'api',
                minVersion: '2.3',
            });
            const data = await response.json();

            // Handle various response structures
            const items = data.artists || data.items || data.data || (Array.isArray(data) ? data : []);

            const result = items.map((artist) => this.prepareArtist(artist));

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('similar_artists', artistId, result);
            }
            return result;
        } catch (e) {
            console.warn('Failed to fetch similar artists:', e);
            return [];
        }
    }

    async getArtistBiography(artistId) {
        const cacheKey = `artist_bio_v1_${artistId}`;
        const cached = await this.cache.get('artist', cacheKey);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/artist/bio/?id=${artistId}`, { type: 'api' });

            if (response.ok) {
                const { data } = await response.json();
                if (data && data.text) {
                    const bio = {
                        text: data.text,
                        source: data.source || 'Tidal',
                    };
                    if (!(response instanceof TidalResponse)) {
                        await this.cache.set('artist', cacheKey, bio);
                    }
                    return bio;
                }
            }
        } catch (e) {
            console.warn('Failed to fetch Tidal biography:', e);
        }
        return null;
    }

    async getSimilarAlbums(albumId) {
        const cached = await this.cache.get('similar_albums', albumId);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/album/similar/?id=${albumId}`, {
                type: 'api',
                minVersion: '2.3',
            });
            const data = await response.json();

            const items = data.items || data.albums || data.data || (Array.isArray(data) ? data : []);

            const result = items.map((album) => this.prepareAlbum(album));

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('similar_albums', albumId, result);
            }
            return result;
        } catch (e) {
            console.warn('Failed to fetch similar albums:', e);
            return [];
        }
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, options = {}) {
        if (!tracks || tracks.length === 0) return [];

        const seenTrackIds = new Set(tracks.map((t) => t.id));
        const recommendedTracks = [];

        const seedTracks = tracks.slice(0, 3);
        for (const seed of seedTracks) {
            if (!seed?.id) continue;
            try {
                const recs = await this.getTrackRecommendations(seed.id);
                for (const t of recs) {
                    if (t?.id && !seenTrackIds.has(t.id)) {
                        seenTrackIds.add(t.id);
                        recommendedTracks.push(t);
                    }
                }
            } catch (e) {
                console.warn(`Failed to get mix recommendations for track ${seed.id}:`, e);
            }
        }

        if (recommendedTracks.length === 0) {
            const artistMap = new Map();
            for (const track of tracks) {
                const artists = track.artists || (track.artist ? [track.artist] : []);
                for (const artist of artists) {
                    if (artist?.id) artistMap.set(artist.id, artist);
                }
            }
            const artistsToProcess = Array.from(artistMap.values()).slice(0, 10);
            for (const artist of artistsToProcess) {
                try {
                    const artistData = await this.getArtist(artist.id, {
                        lightweight: true,
                        skipCache: options.refresh,
                    });
                    if (artistData?.tracks) {
                        for (const t of artistData.tracks) {
                            if (t?.id && !seenTrackIds.has(t.id)) {
                                seenTrackIds.add(t.id);
                                recommendedTracks.push(this.prepareTrack(t));
                            }
                        }
                    }
                } catch (e) {}
            }
        }

        const shuffled = recommendedTracks.sort(() => 0.5 - Math.random());
        const sliced = shuffled.slice(0, limit);
        return this.enrichTracksWithAlbumCover(sliced);
    }

    normalizeTrackResponse(apiResponse) {
        if (!apiResponse || typeof apiResponse !== 'object') {
            return apiResponse;
        }

        // unwrap { version, data } if present
        const raw = apiResponse.data ?? apiResponse;

        // fabricate the track object expected by parseTrackLookup
        const trackStub = {
            duration: raw.duration ?? 0,
            id: raw.trackId ?? null,
        };

        // return exactly what parseTrackLookup expects
        return [trackStub, raw];
    }

    getTrackManifestFormats(quality) {
        switch (normalizeQualityToken(quality) || quality) {
            case 'DOLBY_ATMOS_EAC3_HIGH':
            case 'DOLBY_ATMOS_EAC3_LOW':
                return ['EAC3_JOC'];
            case 'HI_RES_LOSSLESS':
                return ['FLAC_HIRES'];
            case 'LOSSLESS':
                return ['FLAC'];
            case 'HIGH':
                return ['AACLC'];
            case 'LOW':
                return ['HEAACV1'];
            default:
                return ['FLAC'];
        }
    }

    getAdaptiveTrackManifestFormats() {
        return ['FLAC_HIRES', 'FLAC', 'AACLC', 'HEAACV1', 'EAC3_JOC'];
    }

    shouldUseAdaptiveTrackManifest(download = false) {
        if (download || typeof localStorage === 'undefined') {
            return false;
        }

        try {
            return (localStorage.getItem('adaptive-playback-quality') || '').toLowerCase() === 'auto';
        } catch {
            return false;
        }
    }

    getAudioQualityFromManifestFormats(formats = []) {
        if (formats.includes('EAC3_JOC')) return 'DOLBY_ATMOS_EAC3_HIGH';
        if (formats.includes('FLAC_HIRES')) return 'HI_RES_LOSSLESS';
        if (formats.includes('FLAC')) return 'LOSSLESS';
        if (formats.includes('AACLC')) return 'HIGH';
        if (formats.includes('HEAACV1')) return 'LOW';
        return null;
    }

    async normalizeTrackManifestResponse(apiResponse, quality) {
        if (!apiResponse || typeof apiResponse !== 'object') {
            return apiResponse;
        }

        const raw = apiResponse.data?.data ?? apiResponse.data ?? apiResponse;
        const attributes = raw?.attributes ?? {};
        const manifestUrl = attributes.uri;

        if (!manifestUrl) {
            throw new Error('Malformed track manifests response');
        }

        const manifestResponse = await fetch(manifestUrl);
        if (!manifestResponse.ok) {
            throw new Error(`Failed to fetch signed track manifest: HTTP ${manifestResponse.status}`);
        }

        const manifestText = await manifestResponse.text();
        const manifestMimeType =
            manifestResponse.headers.get('content-type') ||
            (manifestText.includes('<MPD') ? 'application/dash+xml' : 'application/octet-stream');
        const normalizedQuality =
            this.getAudioQualityFromManifestFormats(attributes.formats) || normalizeQualityToken(quality) || 'HIGH';

        const isHiRes = normalizedQuality === 'HI_RES_LOSSLESS';
        const isLossless = normalizedQuality === 'LOSSLESS' || isHiRes;
        const trackNorm = attributes.trackAudioNormalizationData || {};
        const albumNorm = attributes.albumAudioNormalizationData || {};

        const info = {
            trackId: Number(raw.id) || null,
            assetPresentation: attributes.trackPresentation || 'FULL',
            audioQuality: normalizedQuality,
            manifestMimeType,
            manifestHash: attributes.hash || '',
            manifest: btoa(manifestText),
            bitDepth: isHiRes ? 24 : isLossless ? 16 : undefined,
            sampleRate: isHiRes ? 96000 : isLossless ? 44100 : undefined,
            replayGain: trackNorm.replayGain,
            trackReplayGain: trackNorm.replayGain,
            trackPeakAmplitude: trackNorm.peakAmplitude,
            albumReplayGain: albumNorm.replayGain,
            albumPeakAmplitude: albumNorm.peakAmplitude,
            drmData: attributes.drmData || null,
            formats: attributes.formats || [],
        };

        const trackStub = {
            duration: raw.duration ?? 0,
            id: Number(raw.id) || null,
        };

        return [trackStub, info];
    }

    async getTrackMetadata(id) {
        const cacheKey = `meta_${id}`;
        const cached = await this.cache.get('track', cacheKey);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/info/?id=${id}`, { type: 'api' });
        const json = await response.json();
        const data = json.data || json;

        let track;
        const items = Array.isArray(data) ? data : [data];
        const found = items.find((i) => i.id == id || (i.item && i.item.id == id));

        if (found) {
            track = this.prepareTrack(found.item || found);
            await this.cache.set('track', cacheKey, track);
            return track;
        }

        throw new Error('Track metadata not found');
    }

    async getTrackRecommendations(id) {
        const cached = await this.cache.get('recommendations', id);
        if (cached) return cached;

        try {
            const token = await HiFiClient.instance?.fetchToken?.().catch(() => null);
            const headers = token ? { Authorization: `Bearer ${token}` } : {};

            const mixUrl = wrapTidalUrl(
                `https://tidal.com/v1/tracks/${id}/mix?countryCode=US&locale=en_US&deviceType=BROWSER`
            );
            const mixResponse = await fetch(mixUrl, { headers });
            if (!mixResponse.ok) {
                throw new Error(`Failed to fetch track mix: HTTP ${mixResponse.status}`);
            }
            const mixJson = await mixResponse.json();
            const mixId = mixJson.id || mixJson.data?.id;
            if (!mixId) return [];

            const itemsUrl = wrapTidalUrl(
                `https://tidal.com/v1/mixes/${mixId}/items?countryCode=US&locale=en_US&deviceType=BROWSER`
            );
            const itemsResponse = await fetch(itemsUrl, { headers });
            if (!itemsResponse.ok) {
                throw new Error(`Failed to fetch mix items: HTTP ${itemsResponse.status}`);
            }
            const itemsJson = await itemsResponse.json();
            let rawItems = itemsJson.items || itemsJson.data?.items || [];

            if (rawItems.length > 0) {
                const firstTrack = rawItems[0]?.item || rawItems[0]?.track || rawItems[0];
                if (firstTrack && String(firstTrack.id) === String(id)) {
                    rawItems = rawItems.slice(1);
                }
            }

            const tracks = rawItems
                .map((entry) => entry.item || entry.track || entry)
                .filter((item) => item && (item.id || item.title))
                .map((item) => this.prepareTrack(item));

            await this.cache.set('recommendations', id, tracks);
            return tracks;
        } catch (error) {
            console.error('Failed to fetch recommendations via track mix API:', error);
            return [];
        }
    }

    async getTrackFromDevMode(id, quality = 'LOSSLESS') {
        const devBaseUrl = devModeSettings.getUrl().replace(/\/+$/, '');
        const requestedQuality = normalizeQualityToken(quality) || quality || 'LOSSLESS';
        const params = new URLSearchParams({
            id: String(id),
            quality: requestedQuality,
            adaptive: 'false',
        });
        for (const format of this.getTrackManifestFormats(quality)) {
            params.append('formats', format);
        }

        const url = `${devBaseUrl}/trackManifests/?${params.toString()}`;
        if (import.meta.env.DEV) {
            console.log('[dev-mode]', url);
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Dev mode request failed: ${response.status} ${response.statusText}`);
        }
        const jsonResponse = await response.json();
        return this.parseTrackLookup(await this.normalizeTrackManifestResponse(jsonResponse, quality));
    }

    async getTrack(id, quality = 'LOSSLESS', { adaptive = false } = {}) {
        const cacheKey = `${id}_${quality}_${adaptive ? 'adaptive' : 'fixed'}`;
        const cached = await this.cache.get('track', cacheKey);
        if (cached) return cached;

        const requestedQuality = normalizeQualityToken(quality) || quality || 'LOSSLESS';
        const params = new URLSearchParams({
            id: String(id),
            quality: requestedQuality,
            adaptive: String(adaptive),
        });
        const formats = adaptive ? this.getAdaptiveTrackManifestFormats() : this.getTrackManifestFormats(quality);
        for (const format of formats) {
            params.append('formats', format);
        }

        const response = await this.fetchWithRetry(`/trackManifests/?${params.toString()}`, { type: 'streaming' });
        const jsonResponse = await response.json();
        const result = this.parseTrackLookup(await this.normalizeTrackManifestResponse(jsonResponse, quality));

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('track', cacheKey, result);
        }
        return result;
    }

    getDeezerStreamFormat(quality = 'LOSSLESS') {
        const map = {
            HI_RES_LOSSLESS: 'FLAC',
            LOSSLESS: 'FLAC',
            HIGH: 'MP3_320',
            LOW: 'MP3_128',
            NORMAL: 'MP3_128',
        };
        return map[quality] || map[normalizeQualityToken(quality)] || 'FLAC';
    }

    async getDeezerStreamUrl(isrc, quality = 'LOSSLESS') {
        if (!isrc || !deezerFallbackSettings.isEnabled()) return null;
        const baseUrl = deezerFallbackSettings.getApiBaseUrl().replace(/\/+$/, '');
        if (!baseUrl) return null;
        const format = this.getDeezerStreamFormat(quality);
        const url = `${baseUrl}/stream/?isrc=${encodeURIComponent(isrc)}&format=${encodeURIComponent(format)}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);
            const res = await fetch(getProxyUrl(url), { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok && res.status !== 405 && res.status !== 501) return null;
        } catch (e) {
            console.warn(`Deezer fallback failed for ISRC ${isrc}:`, e);
            return null;
        }
        return { url, format, provider: 'deezer', rgInfo: null };
    }

    getAmazonMusicQuality(quality = 'LOSSLESS', { preferAdaptiveAuto = false } = {}) {
        let adaptiveQuality = null;
        try {
            adaptiveQuality =
                typeof localStorage !== 'undefined'
                    ? localStorage.getItem('adaptive-playback-quality') || 'auto'
                    : null;
        } catch {}
        if (preferAdaptiveAuto && String(adaptiveQuality || '').toLowerCase() === 'auto') {
            // Let the unified API check exact UHD and then exact HD cache keys.
            return null;
        }

        const qualityMap = {
            auto: 'UHD',
            AUTO: 'UHD',
            ADAPTIVE: 'UHD',
            HI_RES_LOSSLESS: 'UHD',
            LOSSLESS: 'HD',
            HIGH: 'SD_HIGH',
            LOW: 'SD_LOW',
            NORMAL: 'SD_MEDIUM',
            DOLBY_ATMOS_EAC3_HIGH: 'DOLBY_ATMOS_EAC3_HIGH',
            DOLBY_ATMOS_EAC3_LOW: 'DOLBY_ATMOS_EAC3_LOW',
            DOLBY_ATMOS_AC4_HIGH: 'DOLBY_ATMOS_AC4_HIGH',
            DOLBY_ATMOS_AC4_LOW: 'DOLBY_ATMOS_AC4_LOW',
        };
        return qualityMap[quality] || qualityMap[normalizeQualityToken(quality)] || 'HD';
    }

    getUnifiedPlaybackRateLimitedUntil() {
        try {
            return Number(localStorage.getItem(UNIFIED_PLAYBACK_RATE_LIMITED_UNTIL_KEY) || 0);
        } catch {
            return this.unifiedPlaybackRateLimitedUntil || 0;
        }
    }

    isUnifiedPlaybackRateLimited() {
        return Date.now() < this.getUnifiedPlaybackRateLimitedUntil();
    }

    setUnifiedPlaybackRateLimited(response = null) {
        const retryAfter = response?.headers?.get?.('Retry-After');
        const seconds = Number(retryAfter);
        const retryAt = Date.parse(retryAfter || '');
        const until =
            Number.isFinite(seconds) && seconds > 0
                ? Date.now() + seconds * 1000
                : Number.isFinite(retryAt)
                  ? retryAt
                  : Date.now() + UNIFIED_PLAYBACK_RATE_LIMIT_DURATION_MS;
        this.unifiedPlaybackRateLimitedUntil = until;
        try {
            localStorage.setItem(UNIFIED_PLAYBACK_RATE_LIMITED_UNTIL_KEY, String(until));
        } catch {}

        for (const [key, value] of this.streamCache.entries()) {
            if (value?.provider === 'amazon' || value?.provider === 'monochrome') {
                this.streamCache.delete(key);
            }
        }

        console.warn('Unified Playback API rate limited the client; temporarily falling back');
    }

    getAmazonSelectedQualityInfo(trackInfo) {
        if (!Array.isArray(trackInfo?.available_qualities)) return null;
        return trackInfo.available_qualities.find((item) => item.quality === trackInfo.quality_selected) || null;
    }

    getAmazonCodecString(codec) {
        const normalized = String(codec || '').toLowerCase();
        if (normalized === 'flac') return 'fLaC';
        if (normalized === 'opus') return 'Opus';
        if (normalized === 'aac' || normalized === 'aac-lc' || normalized === 'mp4a') return 'mp4a.40.2';
        if (['eac3', 'e-ac-3', 'eac3-joc', 'eac3_joc', 'ec-3'].includes(normalized)) return 'ec-3';
        if (normalized === 'ac4' || normalized === 'ac-4') return 'ac-4';
        return normalized;
    }

    getAmazonDecryptionKey(data) {
        return (
            data?.decryption_key ||
            data?.decryptionKey ||
            data?.encryption?.key?.value ||
            data?.decryption?.key?.value ||
            data?.decryption?.key ||
            data?.drm?.decryption_key ||
            data?.drm?.decryptionKey ||
            null
        );
    }

    getAmazonMimeType(qualityInfo = null) {
        const codec = this.getAmazonCodecString(qualityInfo?.codec);
        return codec ? `audio/mp4; codecs="${codec}"` : 'audio/mp4';
    }

    getAmazonQualityDisplay(trackInfo, qualityInfo = null) {
        const quality = String(trackInfo?.quality_selected || trackInfo?.quality_requested || '')
            .trim()
            .toUpperCase();
        if (qualityInfo?.bitDepth && qualityInfo?.sampleRate) {
            const sampleRate =
                qualityInfo.sampleRate === 44100 ? '44.1' : String(Math.round(qualityInfo.sampleRate / 1000));
            const prefix = qualityInfo.bitDepth > 16 || qualityInfo.sampleRate > 48000 ? 'HD' : 'FLAC';
            return `${prefix} ${qualityInfo.bitDepth}/${sampleRate}`;
        }
        return quality.replace(/^UHD_/, 'HD ').replace(/^HD_/, 'FLAC ').replace(/_/g, ' ');
    }

    async fetchWithTimeout(url, options = {}, timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            return await fetch(url, {
                ...options,
                signal: options.signal || controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async loadTurnstile() {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            throw new Error('Turnstile is only available in the browser');
        }
        if (window.turnstile) return window.turnstile;
        if (this.turnstileLoadPromise) return this.turnstileLoadPromise;

        this.turnstileLoadPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-unified-playback-turnstile]');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile')), {
                    once: true,
                });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            script.dataset.unifiedPlaybackTurnstile = 'true';
            script.onload = () => resolve(window.turnstile);
            script.onerror = () => reject(new Error('Failed to load Turnstile'));
            document.head.appendChild(script);
        }).finally(() => {
            this.turnstileLoadPromise = null;
        });

        return this.turnstileLoadPromise;
    }

    getUnifiedTurnstileContainer() {
        let panel = document.getElementById('unified-playback-turnstile-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'unified-playback-turnstile-panel';
            panel.style.position = 'fixed';
            panel.style.right = '16px';
            panel.style.bottom = '84px';
            panel.style.zIndex = '9999';
            panel.style.padding = '12px';
            panel.style.border = '1px solid var(--border)';
            panel.style.borderRadius = 'var(--radius-md)';
            panel.style.background = 'var(--card)';
            panel.style.color = 'var(--foreground)';
            panel.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.28)';
            panel.style.display = 'none';
            panel.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 0.5rem;">Cloudflare verification</div>
                <div id="unified-playback-turnstile-container"></div>
            `;
            document.body.appendChild(panel);
        }
        return panel.querySelector('#unified-playback-turnstile-container');
    }

    async getUnifiedTurnstileResponse() {
        const turnstile = await this.loadTurnstile();
        const container = this.getUnifiedTurnstileContainer();
        const panel = document.getElementById('unified-playback-turnstile-panel');
        container.innerHTML = '';

        return await new Promise((resolve, reject) => {
            let widgetId = null;
            let timeoutId = null;
            let settled = false;
            const finish = (error, token = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                // Remove the widget, but keep the container attached to the DOM.
                // Cloudflare's SDK schedules an internal reset asynchronously when a
                // widget settles, and it throws "Nothing to reset found for provided
                // container" if the container was already detached. Hiding the panel
                // instead of removing it keeps the container reachable so that
                // cleanup can complete without erroring.
                if (widgetId != null && turnstile.remove) {
                    try {
                        turnstile.remove(widgetId);
                    } catch {}
                }
                if (panel) panel.style.display = 'none';
                if (error) reject(error);
                else resolve(token);
            };
            timeoutId = setTimeout(() => finish(new Error('Turnstile timed out')), 30000);

            try {
                widgetId = turnstile.render(container, {
                    sitekey: UNIFIED_TURNSTILE_SITE_KEY,
                    action: 'auth',
                    execution: 'execute',
                    appearance: 'interaction-only',
                    theme: 'auto',
                    'before-interactive-callback': () => {
                        if (panel) panel.style.display = 'block';
                    },
                    callback: (token) => finish(null, token),
                    'error-callback': () => finish(new Error('Turnstile failed')),
                    'expired-callback': () => finish(new Error('Turnstile expired')),
                });
                turnstile.execute(widgetId);
            } catch (error) {
                finish(error);
            }
        });
    }

    getJwtExpiry(token) {
        try {
            const encoded = token.split('.')[1];
            const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
            return Number(JSON.parse(atob(padded)).exp || 0);
        } catch {
            return 0;
        }
    }

    clearUnifiedTurnstileJwt() {
        try {
            localStorage.removeItem(UNIFIED_TURNSTILE_JWT_KEY);
            localStorage.removeItem(UNIFIED_TURNSTILE_EXPIRY_KEY);
        } catch {}
    }

    getCachedUnifiedTurnstileJwt() {
        try {
            const jwt = localStorage.getItem(UNIFIED_TURNSTILE_JWT_KEY);
            const expiry = Number(localStorage.getItem(UNIFIED_TURNSTILE_EXPIRY_KEY) || 0);
            if (!jwt || expiry <= Math.floor(Date.now() / 1000) + UNIFIED_TURNSTILE_EXPIRY_LEEWAY_SECONDS) {
                this.clearUnifiedTurnstileJwt();
                return null;
            }
            return jwt;
        } catch {
            return null;
        }
    }

    async getUnifiedTurnstileJwt({ forceRefresh = false } = {}) {
        if (!forceRefresh) {
            const cachedJwt = this.getCachedUnifiedTurnstileJwt();
            if (cachedJwt) return cachedJwt;
            if (this._unifiedTurnstileJwtPromise) return this._unifiedTurnstileJwtPromise;
        } else {
            this.clearUnifiedTurnstileJwt();
        }

        const apiToken = unifiedPlaybackSettings.getApiToken().trim();
        if (!apiToken) return null;

        this._unifiedTurnstileJwtPromise = (async () => {
            const turnstileToken = await this.getUnifiedTurnstileResponse();
            const apiBaseUrl = unifiedPlaybackSettings.getApiBaseUrl().replace(/\/+$/, '');
            const response = await this.fetchWithTimeout(
                `${apiBaseUrl}/api/auth/turnstile`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ turnstile_token: turnstileToken }),
                    cache: 'no-store',
                },
                15000
            );
            if (!response.ok) {
                throw new Error(`Unified Playback Turnstile exchange failed: ${response.status}`);
            }

            const data = await response.json();
            const jwt = String(data.access_token || data.jwt || data.token || '').trim();
            if (!jwt) {
                throw new Error('Unified Playback Turnstile exchange returned no JWT');
            }
            const expiry = this.getJwtExpiry(jwt) || Math.floor(Date.now() / 1000) + 60 * 60;
            localStorage.setItem(UNIFIED_TURNSTILE_JWT_KEY, jwt);
            localStorage.setItem(UNIFIED_TURNSTILE_EXPIRY_KEY, String(expiry));
            return jwt;
        })().finally(() => {
            this._unifiedTurnstileJwtPromise = null;
        });

        return this._unifiedTurnstileJwtPromise;
    }

    bytesToHex(bytes) {
        return Array.from(bytes)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    escapeXml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    formatDurationForMpd(seconds) {
        const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
        return `PT${duration.toFixed(3).replace(/\.?0+$/, '')}S`;
    }

    formatKeyIdUuid(keyId) {
        const normalized = String(keyId || '')
            .replace(/-/g, '')
            .toLowerCase();
        if (normalized.length !== 32) return normalized;
        return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
    }

    readMp4Uint32(bytes, offset) {
        if (offset + 4 > bytes.length) return null;
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    }

    readMp4Uint64(bytes, offset) {
        const high = this.readMp4Uint32(bytes, offset);
        const low = this.readMp4Uint32(bytes, offset + 4);
        if (high == null || low == null) return null;
        return high * 2 ** 32 + low;
    }

    readMp4Type(bytes, offset) {
        if (offset + 4 > bytes.length) return null;
        return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    }

    findTopLevelMp4Boxes(buffer) {
        const bytes = new Uint8Array(buffer);
        const boxes = [];
        let offset = 0;

        while (offset + 8 <= bytes.length) {
            const size32 = this.readMp4Uint32(bytes, offset);
            const type = this.readMp4Type(bytes, offset + 4);
            if (!size32 || !type) break;

            let size = size32;
            let headerSize = 8;
            if (size32 === 1) {
                size = this.readMp4Uint64(bytes, offset + 8);
                headerSize = 16;
            } else if (size32 === 0) {
                size = bytes.length - offset;
            }

            if (!Number.isFinite(size) || size < headerSize || offset + size > bytes.length) break;
            boxes.push({
                type,
                start: offset,
                end: offset + size - 1,
                size,
                headerSize,
            });
            offset += size;
        }

        return boxes;
    }

    findCencDefaultKid(buffer) {
        const bytes = new Uint8Array(buffer);

        for (let i = 4; i < bytes.length - 32; i++) {
            if (this.readMp4Type(bytes, i) !== 'tenc') continue;

            const size = this.readMp4Uint32(bytes, i - 4);
            if (size < 32 || i - 4 + size > bytes.length) continue;

            const payloadOffset = i + 4;
            const kidOffset = payloadOffset + 8;
            return this.bytesToHex(bytes.slice(kidOffset, kidOffset + 16));
        }

        return null;
    }

    findMp4SidxInfo(buffer) {
        const bytes = new Uint8Array(buffer);

        for (let typeOffset = 4; typeOffset < bytes.length - 32; typeOffset++) {
            if (this.readMp4Type(bytes, typeOffset) !== 'sidx') continue;

            const boxStart = typeOffset - 4;
            let size = this.readMp4Uint32(bytes, boxStart);
            let payloadOffset = typeOffset + 4;
            if (size === 1) {
                size = this.readMp4Uint64(bytes, boxStart + 8);
                payloadOffset = boxStart + 16;
            }

            if (!Number.isFinite(size) || size < 32 || boxStart + size > bytes.length) continue;

            const version = bytes[payloadOffset];
            let cursor = payloadOffset + 4;
            cursor += 4;
            const timescale = this.readMp4Uint32(bytes, cursor);
            cursor += 4;
            if (!timescale) continue;

            let earliestPresentationTime;
            let firstOffset;
            if (version === 0) {
                earliestPresentationTime = this.readMp4Uint32(bytes, cursor);
                cursor += 4;
                firstOffset = this.readMp4Uint32(bytes, cursor);
                cursor += 4;
            } else if (version === 1) {
                earliestPresentationTime = this.readMp4Uint64(bytes, cursor);
                cursor += 8;
                firstOffset = this.readMp4Uint64(bytes, cursor);
                cursor += 8;
            } else {
                continue;
            }

            cursor += 2;
            if (cursor + 2 > boxStart + size) continue;
            const referenceCount = (bytes[cursor] << 8) | bytes[cursor + 1];
            cursor += 2;
            let durationUnits = 0;
            for (let i = 0; i < referenceCount; i++) {
                if (cursor + 12 > boxStart + size) {
                    throw new Error('Amazon Music MP4 has a truncated SIDX');
                }
                const chunk = this.readMp4Uint32(bytes, cursor);
                cursor += 4;
                const referenceType = (chunk & 0x80000000) >>> 31;
                const subsegmentDuration = this.readMp4Uint32(bytes, cursor);
                cursor += 4;
                cursor += 4;
                if (referenceType === 1 || subsegmentDuration == null) {
                    throw new Error('Amazon Music MP4 uses unsupported hierarchical SIDX');
                }
                durationUnits += subsegmentDuration;
            }

            return {
                start: boxStart,
                end: boxStart + size - 1,
                firstSegmentStart: boxStart + size + firstOffset,
                durationSeconds: durationUnits / timescale,
                earliestPresentationTime,
                timescale,
            };
        }

        return null;
    }

    async readInitialBytes(response, maxBytes) {
        if (!response.body) {
            const buffer = await response.arrayBuffer();
            return buffer.slice(0, maxBytes);
        }

        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;

        try {
            while (totalBytes < maxBytes) {
                const { done, value } = await reader.read();
                if (done || !value) break;

                chunks.push(value);
                totalBytes += value.byteLength;
            }
        } finally {
            await reader.cancel().catch(() => {});
        }

        const output = new Uint8Array(Math.min(totalBytes, maxBytes));
        let offset = 0;
        for (const chunk of chunks) {
            const slice = chunk.subarray(0, Math.min(chunk.byteLength, output.byteLength - offset));
            output.set(slice, offset);
            offset += slice.byteLength;
            if (offset >= output.byteLength) break;
        }

        return output.buffer;
    }

    getAmazonInitRangeEnd(buffer, sidxInfo) {
        const boxes = this.findTopLevelMp4Boxes(buffer);
        const firstSegmentStart = sidxInfo?.firstSegmentStart ?? null;
        const moov = boxes.find((box) => box.type === 'moov');

        if (moov && (firstSegmentStart == null || moov.end < firstSegmentStart)) {
            return moov.end;
        }

        if (sidxInfo?.start > 0) {
            return sidxInfo.start - 1;
        }

        if (firstSegmentStart && firstSegmentStart > 0) {
            return firstSegmentStart - 1;
        }

        return null;
    }

    async getAmazonCencMp4Info(streamUrl) {
        const maxInitBytes = 2 * 1024 * 1024;
        const response = await this.fetchWithTimeout(
            streamUrl,
            {
                headers: { Range: `bytes=0-${maxInitBytes - 1}` },
            },
            12000
        );

        if (!response.ok && response.status !== 206) {
            throw new Error(`Amazon init segment fetch failed: ${response.status}`);
        }

        const buffer = await this.readInitialBytes(response, maxInitBytes);
        const keyId = this.findCencDefaultKid(buffer);
        const sidx = this.findMp4SidxInfo(buffer);
        if (!sidx) {
            throw new Error('Could not find Amazon Music MP4 segment index');
        }

        return {
            keyId,
            sidx,
            initRangeEnd: this.getAmazonInitRangeEnd(buffer, sidx),
        };
    }

    createAmazonMusicDashManifest(streamUrl, trackInfo, qualityInfo, mp4Info) {
        const codec = this.getAmazonCodecString(qualityInfo?.codec);
        const bandwidth = Number(qualityInfo?.bandwidth) || 1000000;
        const sampleRate = Number(qualityInfo?.sampleRate) || 48000;
        const channels = Number(qualityInfo?.channels) || 2;
        const duration = this.formatDurationForMpd(mp4Info?.sidx?.durationSeconds);
        const initEnd = Number.isFinite(mp4Info?.initRangeEnd) ? mp4Info.initRangeEnd : mp4Info.sidx.start - 1;
        const segmentBaseAttrs =
            mp4Info?.sidx?.timescale && mp4Info?.sidx?.earliestPresentationTime != null
                ? ` timescale="${mp4Info.sidx.timescale}" presentationTimeOffset="${mp4Info.sidx.earliestPresentationTime}"`
                : '';
        const representationId = this.escapeXml(trackInfo?.asin || 'amazon-music');
        const escapedStreamUrl = this.escapeXml(streamUrl);

        let contentProtection = '';
        if (mp4Info?.keyId) {
            const keyId = this.formatKeyIdUuid(mp4Info.keyId);
            contentProtection = `
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="${keyId}"/>
      <ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e" cenc:default_KID="${keyId}"/>`;
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="${duration}" minBufferTime="PT1.5S">
  <Period id="0" start="PT0S" duration="${duration}">
    <AdaptationSet id="1" contentType="audio" mimeType="audio/mp4" codecs="${this.escapeXml(codec)}" audioSamplingRate="${sampleRate}" segmentAlignment="true" startWithSAP="1">${contentProtection}
      <Representation id="${representationId}" bandwidth="${bandwidth}" codecs="${this.escapeXml(codec)}">
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${channels}"/>
        <BaseURL>${escapedStreamUrl}</BaseURL>
        <SegmentBase indexRange="${mp4Info.sidx.start}-${mp4Info.sidx.end}"${segmentBaseAttrs}>
          <Initialization range="0-${initEnd}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
    }

    createAmazonMusicDashUrl(streamUrl, trackInfo, qualityInfo, mp4Info) {
        const manifest = this.createAmazonMusicDashManifest(streamUrl, trackInfo, qualityInfo, mp4Info);
        const blob = new Blob([manifest], { type: 'application/dash+xml' });
        return URL.createObjectURL(blob);
    }

    getAmazonTrackTitle(track) {
        const title = String(track?.title || track?.name || '').trim();
        const version = String(track?.version || '').trim();
        return title && version ? `${title} (${version})` : title;
    }

    getAmazonTrackArtist(track) {
        if (Array.isArray(track?.artists) && track.artists.length > 0) {
            const artists = track.artists
                .map((artist) => (typeof artist === 'string' ? artist : artist?.name || artist?.title))
                .map((name) => String(name || '').trim())
                .filter(Boolean);
            if (artists.length > 0) return artists.join(', ');
        }
        if (typeof track?.artist === 'string') return track.artist.trim();
        if (track?.artist?.name) return String(track.artist.name).trim();
        return '';
    }

    getAmazonTrackAlbum(track) {
        if (typeof track?.album === 'string') return track.album.trim();
        return String(track?.album?.title || track?.album?.name || '').trim();
    }

    getAmazonTrackDuration(track) {
        const duration = Number(track?.duration);
        if (!Number.isFinite(duration) || duration <= 0) return null;
        return duration > 10000 ? duration / 1000 : duration;
    }

    buildUnifiedPlaybackLookupParams(track, quality, options = {}) {
        const title = this.getAmazonTrackTitle(track);
        if (!title) {
            throw new Error('Unified Playback lookup requires a track title');
        }

        const params = new URLSearchParams({ track: title });
        const artist = this.getAmazonTrackArtist(track);
        const album = this.getAmazonTrackAlbum(track);
        const isrc = String(track?.isrc || '')
            .trim()
            .toUpperCase();
        const duration = this.getAmazonTrackDuration(track);
        const intent = options.intent || 'stream';

        if (artist) params.set('artist', artist);
        if (album) params.set('album', album);
        if (isrc) params.set('isrc', isrc);
        if (duration) params.set('duration', String(Math.round(duration)));
        if (intent) params.set('intent', intent);

        const canonicalQuality = normalizeQualityToken(quality) || quality;
        if (canonicalQuality && canonicalQuality !== 'auto' && canonicalQuality !== 'ADAPTIVE') {
            params.set('quality', canonicalQuality);
        } else {
            params.set('quality', 'HI_RES_LOSSLESS');
        }

        return params;
    }

    async fetchUnifiedPlaybackEnvelope(track, quality, options = {}) {
        if (!unifiedPlaybackSettings?.isEnabled() || this.isUnifiedPlaybackRateLimited()) {
            return null;
        }

        const apiBaseUrl = unifiedPlaybackSettings.getApiBaseUrl().replace(/\/+$/, '');
        const apiToken = unifiedPlaybackSettings.getApiToken().trim();
        if (!apiToken) return null;

        const isDefaultKey = unifiedPlaybackSettings?.isDefaultApiToken
            ? unifiedPlaybackSettings.isDefaultApiToken(apiToken)
            : apiToken === unifiedPlaybackSettings?.DEFAULT_API_TOKEN;

        const params = this.buildUnifiedPlaybackLookupParams(track, quality, options);
        const requestKey = `${apiBaseUrl}\n${apiToken}\n${params.toString()}`;
        const pendingRequest = this.unifiedPlaybackRequests.get(requestKey);
        if (pendingRequest) return pendingRequest;

        // Coalesce only overlapping identical lookups. The entry is removed as
        // soon as it settles because playback resources can contain one-use URLs.
        const request = (async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
                let turnstileJwt = null;
                if (isDefaultKey || attempt > 0) {
                    turnstileJwt = await this.getUnifiedTurnstileJwt({ forceRefresh: attempt > 0 }).catch(() => null);
                    if (!turnstileJwt) return null;
                } else {
                    turnstileJwt = this.getCachedUnifiedTurnstileJwt();
                }

                const headers = {
                    Accept: 'application/json',
                    Authorization: `Bearer ${apiToken}`,
                };
                if (turnstileJwt) {
                    headers['X-Turnstile-JWT'] = turnstileJwt;
                }

                const response = await this.fetchWithTimeout(
                    `${apiBaseUrl}/api/v2/track/?${params.toString()}`,
                    {
                        headers,
                        cache: 'no-store',
                    },
                    20000
                );

                let envelope = null;
                try {
                    envelope = await response.json();
                } catch {}

                const failureKey = String(track?.id || 'unknown');
                const rememberFailure = (reason) => {
                    this.unifiedPlaybackFailures.set(failureKey, {
                        reason,
                        status: response.status,
                        statusText: response.statusText,
                        response: envelope,
                    });
                    if (this.unifiedPlaybackFailures.size > 20) {
                        this.unifiedPlaybackFailures.delete(this.unifiedPlaybackFailures.keys().next().value);
                    }
                };

                if ((response.status === 401 || response.status === 428) && attempt === 0) {
                    this.clearUnifiedTurnstileJwt();
                    continue;
                }
                if (response.status === 429) {
                    rememberFailure('rate limited');
                    this.setUnifiedPlaybackRateLimited(response);
                    return null;
                }
                if (response.status === 404 || response.status === 502) {
                    rememberFailure('track could not be resolved');
                    console.warn('Unified Playback could not resolve the track:', envelope?.sources || envelope);
                    return null;
                }
                if (response.status === 401 || response.status === 403 || response.status === 428) {
                    rememberFailure('authorization failed');
                    throw new Error(`Unified Playback API authorization failed: ${response.status}`);
                }
                if (!response.ok) {
                    rememberFailure('request failed');
                    throw new Error(`Unified Playback API failed: ${response.status}`);
                }

                const schemaMajor = String(envelope?.schema_version || '').split('.')[0];
                if (schemaMajor !== '1' && schemaMajor !== '2') {
                    rememberFailure('unsupported schema version');
                    throw new Error(
                        `Unsupported Unified Playback schema version: ${envelope?.schema_version || 'missing'}`
                    );
                }
                if (!Array.isArray(envelope.playback) || envelope.playback.length === 0) {
                    rememberFailure('response contained no playable resources');
                    console.warn(
                        'Unified Playback response contained no playable resources:',
                        envelope?.sources || envelope
                    );
                    return null;
                }
                this.unifiedPlaybackFailures.delete(failureKey);
                return envelope;
            }
            return null;
        })();

        this.unifiedPlaybackRequests.set(requestKey, request);
        try {
            return await request;
        } finally {
            if (this.unifiedPlaybackRequests.get(requestKey) === request) {
                this.unifiedPlaybackRequests.delete(requestKey);
            }
        }
    }

    getUnifiedPlaybackResource(envelope) {
        if (!Array.isArray(envelope?.playback)) return null;
        return envelope.playback.find(
            (resource) =>
                resource &&
                typeof resource.url === 'string' &&
                resource.url &&
                (resource.kind === 'audio' || resource.kind === 'manifest') &&
                (resource.delivery === 'direct' || resource.delivery === 'dash' || resource.delivery === 'hls')
        );
    }

    getUnifiedPlaybackCodec(resource) {
        const source = String(resource?.source || '').toLowerCase();
        const quality = String(resource?.quality || '').toUpperCase();
        if (quality.startsWith('DOLBY_ATMOS_AC4_')) return 'ac4';
        if (quality.startsWith('DOLBY_ATMOS_EAC3_') || quality === 'DOLBY_ATMOS') return 'eac3-joc';
        if (source === 'amazon' && /^(UHD|HD|HI_RES_LOSSLESS|LOSSLESS)(_|$)/.test(quality)) return 'flac';
        if (source === 'amazon' && /^(SD|HIGH|LOW)(_|$)/.test(quality)) return 'opus';
        return resource?.codec?.toLowerCase() || null;
    }

    getUnifiedPlaybackQualityInfo(resource) {
        const sampleRate = Number(
            resource?.sample_rate_hz ?? resource?.sampleRateHz ?? resource?.sample_rate ?? resource?.sampleRate
        );
        const bitDepth = Number(resource?.bit_depth ?? resource?.bitDepth);
        const explicitBitrateKbps = Number(resource?.bitrate_kbps ?? resource?.bitrateKbps);
        const bandwidth = Number(resource?.bandwidth ?? resource?.bitrate);
        const channels = Number(resource?.channels);

        return {
            codec: this.getUnifiedPlaybackCodec(resource),
            bandwidth: bandwidth || (explicitBitrateKbps ? explicitBitrateKbps * 1000 : null),
            bitrateKbps: explicitBitrateKbps || (bandwidth ? Math.round(bandwidth / 1000) : null),
            sampleRate: sampleRate || null,
            bitDepth: bitDepth || null,
            channels: channels || null,
            channelLayout: resource?.channel_layout ?? resource?.channelLayout ?? null,
        };
    }

    getUnifiedPlaybackKeyId(resource) {
        return (
            resource?.encryption?.key_id ||
            resource?.encryption?.keyId ||
            resource?.encryption?.key?.id ||
            resource?.key_id ||
            resource?.keyId ||
            null
        );
    }

    getUnifiedPlaybackReplayGain(resource) {
        const rg = resource?.replay_gain || resource?.replayGain || null;
        const trackGain = rg?.track_gain_db ?? rg?.trackGainDb ?? resource?.track_gain_db ?? resource?.trackGainDb ?? 0;
        const trackPeak = rg?.track_peak ?? rg?.trackPeak ?? resource?.track_peak ?? resource?.trackPeak ?? 1;
        const albumGain = rg?.album_gain_db ?? rg?.albumGainDb ?? resource?.album_gain_db ?? resource?.albumGainDb ?? 0;
        const albumPeak = rg?.album_peak ?? rg?.albumPeak ?? resource?.album_peak ?? resource?.albumPeak ?? 1;
        const programLoudness = rg?.program_loudness_lufs ?? resource?.program_loudness_lufs ?? null;
        const anchorLoudness = rg?.anchor_loudness_lufs ?? resource?.anchor_loudness_lufs ?? null;
        const truePeak = rg?.true_peak_db ?? resource?.true_peak_db ?? null;

        return {
            trackReplayGain: typeof trackGain === 'number' ? trackGain : parseFloat(trackGain) || 0,
            trackPeakAmplitude: typeof trackPeak === 'number' ? trackPeak : parseFloat(trackPeak) || 1,
            albumReplayGain: typeof albumGain === 'number' ? albumGain : parseFloat(albumGain) || 0,
            albumPeakAmplitude: typeof albumPeak === 'number' ? albumPeak : parseFloat(albumPeak) || 1,
            programLoudnessLufs:
                typeof programLoudness === 'number' ? programLoudness : parseFloat(programLoudness) || null,
            anchorLoudnessLufs:
                typeof anchorLoudness === 'number' ? anchorLoudness : parseFloat(anchorLoudness) || null,
            truePeakDb: typeof truePeak === 'number' ? truePeak : parseFloat(truePeak) || null,
        };
    }

    async getUnifiedPlaybackStreamUrl(tidalTrackId, quality = 'LOSSLESS', options = {}) {
        let track = null;
        let envelope = null;
        try {
            track =
                options.track ||
                (tidalTrackId && !String(tidalTrackId).startsWith('apple:')
                    ? await this.getTrackMetadata(tidalTrackId).catch(() => null)
                    : null);
            if (!track) return null;

            const intent = options.intent || 'stream';
            const canonicalQuality = normalizeQualityToken(quality) || quality || 'HI_RES_LOSSLESS';
            envelope = await this.fetchUnifiedPlaybackEnvelope(track, canonicalQuality, { ...options, intent });
            if (!envelope) return null;

            const resource = this.getUnifiedPlaybackResource(envelope);
            if (!resource) {
                throw new Error('Unified Playback response contained no supported playback resource');
            }

            const selectedSource = String(resource.source || envelope.selected_source || '').toLowerCase();
            if (!['amazon', 'tidal', 'mono', 'monochrome'].includes(selectedSource)) {
                throw new Error(`Unified Playback selected an unsupported source: ${selectedSource || 'unknown'}`);
            }

            let provider = selectedSource;
            if (selectedSource === 'mono') provider = 'monochrome';
            else if (selectedSource === 'amazon') provider = 'amazon';
            else if (selectedSource === 'tidal') provider = 'tidal';

            const isManifest =
                resource.kind === 'manifest' ||
                resource.delivery === 'dash' ||
                resource.delivery === 'hls' ||
                (resource.mime_type &&
                    (resource.mime_type.includes('dash') || resource.mime_type.includes('mpegurl'))) ||
                (typeof resource.url === 'string' &&
                    (resource.url.includes('.mpd') ||
                        resource.url.includes('.m3u8') ||
                        resource.url.startsWith('data:application/dash+xml')));

            const sourceUrl = resource.url;
            const decryptionKey = this.getAmazonDecryptionKey(resource);
            const qualityInfo = this.getUnifiedPlaybackQualityInfo(resource);
            const deliveredQuality = resource.quality || envelope.quality_requested || canonicalQuality || quality;
            const normalizedQuality = normalizeQualityToken(deliveredQuality) || deliveredQuality;
            const baseResult = {
                sourceUrl,
                provider,
                quality: normalizedQuality,
                qualityRequested: envelope.quality_requested || canonicalQuality,
                qualityDisplay:
                    provider === 'amazon'
                        ? this.getAmazonQualityDisplay({ quality_selected: normalizedQuality }, qualityInfo)
                        : provider === 'monochrome'
                          ? normalizedQuality === 'LOSSLESS'
                              ? 'FLAC'
                              : normalizedQuality
                          : normalizedQuality,
                decryptionKey,
                keyId: this.getUnifiedPlaybackKeyId(resource),
                codec: qualityInfo.codec || resource.codec || null,
                bitDepth: qualityInfo.bitDepth,
                sampleRate: qualityInfo.sampleRate,
                sampleRateHz: qualityInfo.sampleRate,
                bitrateKbps: qualityInfo.bitrateKbps,
                bandwidth: qualityInfo.bandwidth,
                channels: qualityInfo.channels,
                channelLayout: qualityInfo.channelLayout,
                container: resource.container || null,
                lossless: resource.lossless ?? null,
                mediaMimeType: resource.mime_type || (provider === 'monochrome' ? 'audio/flac' : 'audio/mp4'),
                trackId: envelope.track?.id || null,
                recordingId: resource.id || null,
                requestId: envelope.request_id || null,
                intent: envelope.intent || intent,
                rgInfo: this.getUnifiedPlaybackReplayGain(resource),
                waveform: envelope.waveform || resource.waveform || null,
            };

            if (selectedSource === 'mono' || selectedSource === 'monochrome') {
                return {
                    ...baseResult,
                    url: sourceUrl,
                    playbackType: isManifest ? 'dash' : 'direct',
                    mimeType: resource.mime_type || (isManifest ? 'application/dash+xml' : 'audio/flac'),
                };
            }

            if (selectedSource === 'amazon' && !isManifest && decryptionKey) {
                const mp4Info = await this.getAmazonCencMp4Info(sourceUrl).catch((error) => {
                    console.warn('Failed to inspect Unified Playback Amazon MP4:', error);
                    return null;
                });
                const keyId = baseResult.keyId || mp4Info?.keyId || null;
                if (decryptionKey && !keyId && !options.allowCencWithoutKeyId) {
                    throw new Error('Could not find Unified Playback Amazon CENC key ID');
                }

                const trackInfo = {
                    id: envelope.track?.id || null,
                    asin: envelope.track?.id || null,
                    duration: (envelope.track?.duration_ms || 0) / 1000 || this.getAmazonTrackDuration(track),
                    quality_selected: normalizedQuality,
                    quality_requested: envelope.quality_requested || canonicalQuality,
                };
                const manifestUrl = mp4Info
                    ? this.createAmazonMusicDashUrl(sourceUrl, trackInfo, qualityInfo, { ...mp4Info, keyId })
                    : sourceUrl;

                return {
                    ...baseResult,
                    url: manifestUrl,
                    asin: envelope.track?.id || null,
                    keyId,
                    playbackType: mp4Info ? (keyId ? 'dash-cenc' : 'dash') : 'direct',
                    mimeType: mp4Info
                        ? 'application/dash+xml'
                        : resource.mime_type || this.getAmazonMimeType(qualityInfo),
                };
            }

            if (isManifest) {
                const isHls =
                    resource.delivery === 'hls' ||
                    resource.kind === 'hls' ||
                    (resource.mime_type &&
                        (resource.mime_type.includes('mpegurl') || resource.mime_type.includes('m3u8'))) ||
                    (typeof sourceUrl === 'string' && sourceUrl.includes('.m3u8'));

                return {
                    ...baseResult,
                    url: sourceUrl,
                    playbackType: isHls ? 'hls' : decryptionKey ? 'dash-cenc' : 'dash',
                    mimeType: resource.mime_type || (isHls ? 'application/vnd.apple.mpegurl' : 'application/dash+xml'),
                };
            }

            return {
                ...baseResult,
                url: sourceUrl,
                playbackType: 'direct',
                mimeType: resource.mime_type || 'audio/mp4',
            };
        } catch (error) {
            const failureKey = String(track?.id || tidalTrackId || 'unknown');
            const previousFailure = this.unifiedPlaybackFailures.get(failureKey);
            this.unifiedPlaybackFailures.set(failureKey, {
                ...previousFailure,
                reason: error?.message || String(error),
                response: previousFailure?.response || envelope,
            });
            console.warn(`Unified Playback failed for track ${tidalTrackId}:`, error);
            return null;
        }
    }

    async getStreamUrl(id, quality = 'LOSSLESS', options = {}) {
        const cacheKey = `stream_info_${id}_${quality}`;

        if (this.streamCache.has(cacheKey)) {
            return this.streamCache.get(cacheKey);
        }

        if (devModeSettings.isEnabled()) {
            const lookup = await this.getTrackFromDevMode(id, quality);
            let streamUrl;
            if (lookup.originalTrackUrl) {
                streamUrl = lookup.originalTrackUrl;
            } else if (lookup.info?.manifest) {
                streamUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
            }
            if (!streamUrl) {
                throw new Error('Could not resolve stream URL from dev mode');
            }
            const result = {
                url: streamUrl,
                rgInfo: lookup.info
                    ? {
                          trackReplayGain: lookup.info.trackReplayGain || lookup.info.replayGain,
                          trackPeakAmplitude: lookup.info.trackPeakAmplitude || lookup.info.peakAmplitude,
                          albumReplayGain: lookup.info.albumReplayGain,
                          albumPeakAmplitude: lookup.info.albumPeakAmplitude,
                      }
                    : null,
            };
            this.streamCache.set(cacheKey, result);
            return result;
        }

        const inputTrack = options?.track || null;
        const isApple = inputTrack?.provider === 'apple' || String(id || '').startsWith('apple:');
        const track = inputTrack || (id && !isApple ? await this.getTrackMetadata(id).catch(() => null) : null);

        const canPlayAmazonCenc = canUseNativeAmazonCenc;
        const needsProxyDecryption = !canPlayAmazonCenc;

        let actualQuality = quality;

        const exactAtmosQuality = isAtmosQuality(quality) ? quality : null;
        const preferredAtmosQuality = preferDolbyAtmosSettings.isEnabled() ? 'DOLBY_ATMOS_EAC3_HIGH' : null;
        const atmosQuality = exactAtmosQuality || preferredAtmosQuality;

        let unifiedResult = null;

        if (atmosQuality) {
            try {
                unifiedResult = await this.getUnifiedPlaybackStreamUrl(id, atmosQuality, {
                    preferAdaptiveAuto: true,
                    track,
                    allowCencWithoutKeyId: needsProxyDecryption,
                    intent: 'stream',
                });
            } catch (err) {
                console.debug('Unified Playback Dolby Atmos lookup failed:', err);
            }
        }

        if (!unifiedResult?.url && exactAtmosQuality) {
            const error = new Error(
                `The requested ${exactAtmosQuality.replaceAll('_', ' ')} tier is unavailable. Atmos requests are strict, so no stereo fallback was used.`
            );
            error.code = STRICT_QUALITY_UNAVAILABLE_CODE;
            throw error;
        }

        if (!unifiedResult?.url) {
            unifiedResult = await this.getUnifiedPlaybackStreamUrl(id, quality, {
                preferAdaptiveAuto: true,
                track,
                allowCencWithoutKeyId: needsProxyDecryption,
                intent: 'stream',
            });
        }

        if (unifiedResult?.url) {
            if (
                unifiedResult.provider === 'amazon' &&
                needsProxyDecryption &&
                unifiedResult.decryptionKey &&
                (unifiedResult.sourceUrl || unifiedResult.url)
            ) {
                const sourceUrl = unifiedResult.sourceUrl || unifiedResult.url;
                const resourceCodec = String(unifiedResult.codec || '').toLowerCase();
                const targetCodec =
                    resourceCodec === 'opus'
                        ? 'opus'
                        : resourceCodec === 'ac4' || resourceCodec === 'ac-4'
                          ? 'ac4'
                          : resourceCodec === 'eac3' || resourceCodec === 'eac3-joc' || resourceCodec === 'ec-3'
                            ? 'eac3'
                            : resourceCodec === 'aac' || resourceCodec.startsWith('mp4a')
                              ? 'mp4a'
                              : getAmazonDecrypterCodec(quality);
                const origin =
                    typeof window !== 'undefined' && window.location
                        ? `${window.location.protocol}//${window.location.host}`
                        : '';
                return {
                    ...unifiedResult,
                    url: `${origin}/api/decrypt-stream?url=${encodeURIComponent(sourceUrl)}&key=${encodeURIComponent(unifiedResult.decryptionKey)}&codec=${encodeURIComponent(targetCodec)}`,
                    playbackType: 'direct',
                    mimeType:
                        targetCodec === 'flac-hls'
                            ? 'application/vnd.apple.mpegurl'
                            : unifiedResult.mediaMimeType || 'audio/mp4',
                };
            }

            // The unified endpoint is no-store and may return a single-use Mono URL.
            return unifiedResult;
        }

        const deezerResult = track?.isrc ? await this.getDeezerStreamUrl(track.isrc, quality) : null;

        if (deezerResult?.url) {
            const result = {
                url: deezerResult.url,
                rgInfo: {
                    trackReplayGain: 0,
                    trackPeakAmplitude: 1,
                    albumReplayGain: 0,
                    albumPeakAmplitude: 1,
                },
                provider: 'deezer',
                deezerFormat: deezerResult.format,
                deezerHiRes: deriveTrackQuality(track) === 'HI_RES_LOSSLESS',
            };
            this.streamCache.set(cacheKey, result);
            return result;
        }

        notifyAudioSourceMissing(
            createAudioSourceReportDetails(
                track,
                id,
                quality,
                'stream',
                this.unifiedPlaybackFailures.get(String(track?.id || id)) || null
            )
        );
        throw new Error(
            track?.isrc
                ? 'Could not resolve stream URL from Unified Playback or Deezer'
                : 'Could not resolve stream URL: Unified Playback failed and the track has no ISRC for Deezer lookup'
        );
    }

    async getVideoStreamUrl(id) {
        const cacheKey = `video_stream_${id}`;

        if (this.streamCache.has(cacheKey)) {
            return this.streamCache.get(cacheKey);
        }

        const lookup = await this.getVideo(id);

        let streamUrl;

        const findValue = (obj, key) => {
            if (!obj || typeof obj !== 'object') return null;
            if (obj[key]) return obj[key];
            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object') {
                    const f = findValue(v, key);
                    if (f) return f;
                }
            }
            return null;
        };

        const manifest = findValue(lookup, 'manifest') || findValue(lookup, 'Manifest');
        if (manifest) {
            streamUrl = this.extractStreamUrlFromManifest(manifest);
        }

        if (!streamUrl) {
            streamUrl =
                findValue(lookup, 'OriginalTrackUrl') ||
                findValue(lookup, 'originalTrackUrl') ||
                findValue(lookup, 'url') ||
                findValue(lookup, 'streamUrl') ||
                findValue(lookup, 'manifestUrl');
        }

        if (!streamUrl) {
            throw new Error(`Could not resolve video stream URL for ID: ${id}`);
        }

        if (!(lookup instanceof TidalResponse)) {
            this.streamCache.set(cacheKey, streamUrl);
        }
        return streamUrl;
    }

    async enrichTrack(input, { downloadQuality = 'HI_RES_LOSSLESS' }) {
        downloadQuality = normalizeQualityToken(downloadQuality) || downloadQuality;

        const id = input?.id || input;
        const inputTrack = typeof input === 'object' ? input : null;
        const isApple = inputTrack?.provider === 'apple' || String(id || '').startsWith('apple:');
        const metadataTrack = id && !isApple ? await this.getTrackMetadata(id).catch(() => null) : null;
        const track = metadataTrack
            ? this.prepareTrack({ ...(inputTrack || {}), ...metadataTrack })
            : inputTrack?.isrc || isApple
              ? inputTrack
              : await this.getTrackMetadata(id);
        const isVideo = track?.type?.toLowerCase().includes('video');
        const cleanQuality = isCustomFormat(downloadQuality) ? 'LOSSLESS' : downloadQuality;

        let lookup = null;
        let externalRgInfo = null;
        let externalStreamUrl = null;
        let externalStreamType = null;
        let externalProvider = null;
        let externalDecryptionKey = null;
        let externalKeyId = null;
        let externalMimeType = null;
        let externalMediaMimeType = null;
        let externalSourceUrl = null;

        if (isVideo) {
            lookup = await this.getVideo(id);
        } else if (devModeSettings.isEnabled()) {
            lookup = new PlaybackInfo(await this.getTrackFromDevMode(id, cleanQuality));
        } else {
            let unifiedResult = null;
            let deezerResult = null;

            const exactAtmosQuality = isAtmosQuality(cleanQuality) ? cleanQuality : null;
            const preferredAtmosQuality =
                !exactAtmosQuality && preferDolbyAtmosSettings.isEnabled() && track?.audioModes?.includes('DOLBY_ATMOS')
                    ? 'DOLBY_ATMOS_EAC3_HIGH'
                    : null;
            const atmosQuality = exactAtmosQuality || preferredAtmosQuality;

            if (atmosQuality) {
                try {
                    unifiedResult = await this.getUnifiedPlaybackStreamUrl(id, atmosQuality, {
                        track,
                        intent: 'download',
                    });
                } catch (error) {
                    console.debug('Unified Playback Atmos lookup failed during download enrichment:', error);
                }
            }

            if (!unifiedResult?.url && exactAtmosQuality) {
                const error = new Error(
                    `The requested ${exactAtmosQuality.replaceAll('_', ' ')} tier is unavailable. Atmos downloads are strict, so no stereo fallback was used.`
                );
                error.code = STRICT_QUALITY_UNAVAILABLE_CODE;
                throw error;
            }

            if (!unifiedResult?.url) {
                try {
                    unifiedResult = await this.getUnifiedPlaybackStreamUrl(id, cleanQuality, {
                        track,
                        intent: 'download',
                    });
                } catch (error) {
                    console.debug('Unified Playback lookup failed during download enrichment:', error);
                }
            }

            if (!unifiedResult?.url) {
                if (track?.isrc) {
                    deezerResult = await this.getDeezerStreamUrl(track.isrc, cleanQuality);
                }
            }

            const externalResult = unifiedResult?.url ? unifiedResult : deezerResult;
            if (externalResult?.url) {
                externalStreamUrl = externalResult.url;
                externalRgInfo = externalResult.rgInfo;
                externalStreamType = externalResult.playbackType || null;
                externalProvider = externalResult.provider || (unifiedResult?.url ? 'unified' : 'deezer');
                externalDecryptionKey = externalResult.decryptionKey || null;
                externalKeyId = externalResult.keyId || null;
                externalMimeType = externalResult.mimeType || null;
                externalMediaMimeType = externalResult.mediaMimeType || externalMimeType;
                externalSourceUrl = externalResult.sourceUrl || externalStreamUrl;
                lookup = {
                    info: {
                        audioQuality: cleanQuality,
                        trackReplayGain: externalRgInfo?.trackReplayGain ?? 0,
                        trackPeakAmplitude: externalRgInfo?.trackPeakAmplitude ?? 1,
                        albumReplayGain: externalRgInfo?.albumReplayGain ?? 0,
                        albumPeakAmplitude: externalRgInfo?.albumPeakAmplitude ?? 1,
                    },
                };
            } else {
                const requestedDeezerFormat = this.getDeezerStreamFormat(cleanQuality);
                const losslessDeezerFormat = this.getDeezerStreamFormat('LOSSLESS');
                deezerResult =
                    track?.isrc && requestedDeezerFormat !== losslessDeezerFormat
                        ? await this.getDeezerStreamUrl(track.isrc, 'LOSSLESS')
                        : null;
                if (deezerResult?.url) {
                    externalProvider = 'deezer';
                    externalStreamUrl = deezerResult.url;
                    externalSourceUrl = deezerResult.url;
                    lookup = {
                        info: {
                            audioQuality: cleanQuality,
                            trackReplayGain: 0,
                            trackPeakAmplitude: 1,
                            albumReplayGain: 0,
                            albumPeakAmplitude: 1,
                        },
                    };
                } else {
                    notifyAudioSourceMissing(
                        createAudioSourceReportDetails(
                            track,
                            id,
                            cleanQuality,
                            'download',
                            this.unifiedPlaybackFailures.get(String(track?.id || id)) || null
                        )
                    );
                    throw new Error(
                        track?.isrc
                            ? 'Could not resolve audio stream from Unified Playback or Deezer'
                            : 'Cannot resolve audio stream: Unified Playback failed and track has no ISRC for Deezer lookup'
                    );
                }
            }
        }

        const enrichedTrack = { ...this.prepareTrack(track) };
        if (externalRgInfo) {
            enrichedTrack.replayGain = new ReplayGain(externalRgInfo);
        } else if (lookup.info) {
            enrichedTrack.replayGain = new ReplayGain({
                trackReplayGain: lookup.info.trackReplayGain,
                trackPeakAmplitude: lookup.info.trackPeakAmplitude,
                albumReplayGain: lookup.info.albumReplayGain,
                albumPeakAmplitude: lookup.info.albumPeakAmplitude,
            });
        }

        if (
            track.album?.id &&
            (track.album?.totalDiscs == null || track.album?.numberOfTracksOnDisc == null || !track.album?.cover)
        ) {
            try {
                const albumData = await this.getAlbum(track.album.id);
                enrichedTrack.album = new EnrichedAlbum({
                    ...albumData.album,
                    ...enrichedTrack.album,
                    // Preserve the full album's cover when the track's album cover is null/undefined,
                    // since some API responses omit or null-out cover in the track's album sub-object.
                    cover: enrichedTrack.album?.cover || albumData.album?.cover,
                });

                if (albumData.tracks?.length > 0) {
                    const discTrackCounts = new Map();
                    let maxDiscNumber = 0;
                    for (const t of albumData.tracks) {
                        const dn = getTrackDiscNumber(t);
                        discTrackCounts.set(dn, (discTrackCounts.get(dn) || 0) + 1);
                        if (dn > maxDiscNumber) maxDiscNumber = dn;
                    }
                    const totalDiscs = maxDiscNumber || 1;
                    const discNumber = getTrackDiscNumber(track);
                    enrichedTrack.album = new EnrichedAlbum({
                        ...(enrichedTrack.album || {}),

                        totalDiscs: track.album?.totalDiscs ?? totalDiscs,
                        numberOfTracksOnDisc: track.album?.numberOfTracksOnDisc ?? discTrackCounts.get(discNumber),
                    });
                }
            } catch (e) {
                console.warn('Failed to fetch album for disc info:', e);
            }
        }

        if (!(enrichedTrack.album instanceof EnrichedAlbum)) {
            enrichedTrack.album = new TrackAlbum(enrichedTrack.album);
        }

        const finalEnriched = new EnrichedTrack(enrichedTrack);
        const result = { lookup, enrichedTrack: finalEnriched, isVideo, downloadQuality: cleanQuality };
        if (externalStreamUrl) {
            result.externalStreamUrl = externalStreamUrl;
            result.externalStreamType = externalStreamType;
            result.externalProvider = externalProvider;
            result.externalDecryptionKey = externalDecryptionKey;
            result.externalKeyId = externalKeyId;
            result.externalMimeType = externalMimeType;
            result.externalMediaMimeType = externalMediaMimeType;
            result.externalSourceUrl = externalSourceUrl;
        }
        if (externalProvider === 'amazon') {
            result.amazonMusicStreamUrl = externalSourceUrl || externalStreamUrl;
        }
        return result;
    }

    /**
     * Downloads a track or video from TIDAL in the specified quality.
     *
     * Handles multiple stream types (DASH, HLS, and direct HTTP), applies post-processing
     * for audio tracks, adds metadata, and optionally triggers a browser download.
     *
     * @async
     * @param {string} id - The TIDAL track or video ID
     * @param {string} [quality='HI_RES_LOSSLESS'] - The desired audio quality (e.g., 'HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'NORMAL').
     *                                               Custom FFMPEG formats are transcoded from LOSSLESS.
     * @param {string} filename - The filename to save the downloaded content as
     * @param {Object} [options={}] - Additional download options
     * @param {Function} [options.onProgress] - Callback function for progress updates with signature:
     *                                          `(progressEvent) => void`
     * @param {Object} [options.track] - Track metadata object to attach to the audio file
     * @param {Object} [options.enriched] - A result from enrichTrack for this download operation
     * @param {boolean} [options.calculateDashBytes=true] - Whether to calculate total bytes for DASH streams
     * @param {AbortSignal} [options.signal] - AbortSignal to cancel the download
     * @param {boolean} [options.triggerDownload=true] - Whether to trigger browser download after completion
     *
     * @returns {Promise<Blob>} The downloaded content as a Blob object
     *
     * @throws {Error} If stream URL cannot be resolved, manifest is missing, or download fails
     * @throws {AbortError} If the download is aborted via the signal
     * @throws {FfmpegError} If audio transcoding fails
     */
    async downloadTrack(id, quality = 'HI_RES_LOSSLESS', filename, options = {}) {
        // Load ffmpeg in the background.
        loadFfmpeg().catch(console.error);
        const metadataModule = await import('./metadata.js');
        const { prefetchMetadataObjects, addMetadataToAudio } = metadataModule;

        const { onProgress, track: inputTrack, calculateDashBytes = true } = options;

        let prefetchPromises = null;

        try {
            // Custom FFMPEG formats are not native TIDAL qualities; download LOSSLESS and transcode
            quality = normalizeQualityToken(quality) || quality;
            let downloadQuality = isCustomFormat(quality) ? 'LOSSLESS' : quality;

            const inputTrackObj = options.track || (typeof inputTrack === 'object' ? inputTrack : null);
            const legacyEnrichedInput = inputTrackObj?.enrichedTrack && inputTrackObj?.lookup ? inputTrackObj : null;
            const enriched =
                options.enriched ||
                legacyEnrichedInput ||
                (await this.enrichTrack(inputTrackObj || id, { downloadQuality }));
            const { lookup, enrichedTrack, isVideo } = enriched;

            let streamUrl = enriched.externalStreamUrl || null;
            let postProcessingQuality = lookup.info?.audioQuality ?? null;
            let blob;

            if (streamUrl) {
                const coverId = getTrackCoverId(enrichedTrack);
                prefetchPromises = {
                    coverFetch: coverId ? getCoverBlob(this, coverId).catch(() => null) : Promise.resolve(null),
                    lyricsFetch: Promise.resolve(null),
                };
            } else {
                prefetchPromises = prefetchMetadataObjects(enrichedTrack, this);
            }

            if (!streamUrl) {
                if (lookup.originalTrackUrl) {
                    streamUrl = lookup.originalTrackUrl;
                } else {
                    const findValue = (obj, key) => {
                        if (!obj || typeof obj !== 'object') return null;
                        if (obj[key]) return obj[key];
                        for (const v of Object.values(obj)) {
                            if (v && typeof v === 'object') {
                                const f = findValue(v, key);
                                if (f) return f;
                            }
                        }
                        return null;
                    };

                    const manifest = isVideo
                        ? findValue(lookup, 'manifest') || findValue(lookup, 'Manifest')
                        : lookup.info?.manifest;

                    if (!manifest) {
                        throw new Error('Could not resolve manifest');
                    }

                    if (preferDolbyAtmosSettings.isEnabled() && enrichedTrack.audioModes?.includes('DOLBY_ATMOS')) {
                        try {
                            const stream = await this.getStreamUrl(id, 'DOLBY_ATMOS_EAC3_HIGH');
                            const manifestRes = await fetch(stream.url, { signal: options.signal });
                            const manifestText = await manifestRes.text();
                            streamUrl = this.extractStreamUrlFromManifest(btoa(manifestText));

                            if (streamUrl) {
                                postProcessingQuality = 'DOLBY_ATMOS_EAC3_HIGH';
                            }
                        } catch (err) {
                            console.error('Failed to extract Dolby Atmos stream URL:', err);
                        }
                    }

                    if (!streamUrl) {
                        streamUrl = this.extractStreamUrlFromManifest(manifest);
                        if (!streamUrl) {
                            throw new Error('Could not resolve stream URL');
                        }
                    }
                }
            }

            if (enriched.externalProvider === 'amazon' && enriched.externalStreamType?.includes('cenc')) {
                const response = await fetch(enriched.externalSourceUrl || streamUrl, {
                    cache: 'no-store',
                    signal: options.signal,
                });

                if (!response.ok) {
                    throw new Error(`Fetch failed: ${response.status}`);
                }

                const encryptedBlob = await response.blob();
                const preserveAtmos = isAtmosQuality(downloadQuality) || isAtmosQuality(postProcessingQuality);
                const outputName = preserveAtmos ? 'output.m4a' : 'output.flac';
                const outputMime = preserveAtmos ? 'audio/mp4' : 'audio/flac';
                blob = await ffmpeg(encryptedBlob, {
                    rawArgs: [
                        '-decryption_key',
                        enriched.externalDecryptionKey,
                        '-i',
                        'input',
                        '-c:a',
                        preserveAtmos ? 'copy' : 'flac',
                        outputName,
                    ],
                    outputName,
                    outputMime,
                    onProgress,
                    signal: options.signal,
                });
            } else if (
                streamUrl.startsWith('blob:') ||
                streamUrl.startsWith('data:') ||
                enriched.externalStreamType?.includes('dash') ||
                streamUrl.includes('.mpd')
            ) {
                try {
                    const downloader = new DashDownloader();
                    blob = await downloader.downloadDashStream(getProxyUrl(streamUrl), {
                        signal: options.signal,
                        onProgress,
                        calculateDashBytes: calculateDashBytes ?? true,
                    });
                } catch (dashError) {
                    console.error('DASH download failed:', dashError);
                    if (isVideo) throw dashError;

                    // Fallback to LOSSLESS if DASH fails, but not if we're already downloading LOSSLESS
                    if (downloadQuality !== 'LOSSLESS' && !isAtmosQuality(downloadQuality)) {
                        console.warn('Falling back to LOSSLESS (16-bit) download.');
                        return this.downloadTrack(id, 'LOSSLESS', filename, {
                            ...options,
                            // The previous resolution belongs to a different strict
                            // quality and may contain a one-use playback URL.
                            track: options.track?.enrichedTrack || options.track,
                            enriched: undefined,
                        });
                    }
                    throw dashError;
                }
            } else if (streamUrl.includes('.m3u8') || streamUrl.includes('application/vnd.apple.mpegurl')) {
                try {
                    const downloader = new HlsDownloader();
                    blob = await downloader.downloadHlsStream(getProxyUrl(streamUrl), {
                        signal: options.signal,
                        onProgress,
                    });
                } catch (hlsError) {
                    console.error('HLS download failed:', hlsError);
                    throw hlsError;
                }
            } else {
                // Try HEAD first to get Content-Length when GET uses chunked encoding (fixes #278)
                let headContentLength = null;
                // Monochrome playback URLs may be single-use, so the download GET must be the first request.
                if (enriched.externalProvider !== 'monochrome') {
                    try {
                        const headResponse = await fetch(streamUrl, {
                            method: 'HEAD',
                            cache: 'no-store',
                            signal: options.signal,
                        });
                        if (headResponse.ok) {
                            const cl = headResponse.headers.get('Content-Length');
                            if (cl) headContentLength = parseInt(cl, 10);
                        }
                    } catch (_) {
                        /* ignore HEAD failure; proceed with GET */
                    }
                }

                const response = await fetch(getProxyUrl(streamUrl), {
                    cache: 'no-store',
                    signal: options.signal,
                });

                if (!response.ok) {
                    throw new Error(`Fetch failed: ${response.status}`);
                }

                const contentLengthHeader = response.headers.get('Content-Length');
                const totalBytes = resolveDownloadTotalBytes(contentLengthHeader, headContentLength);

                let receivedBytes = 0;

                if (response.body) {
                    const chunks = [];

                    for await (const chunk of readableStreamIterator(response.body)) {
                        chunks.push(chunk);
                        receivedBytes += chunk.byteLength;

                        onProgress?.(new DownloadProgress(receivedBytes, totalBytes || undefined));
                    }

                    const defaultMime = isVideo ? 'video/mp4' : 'audio/flac';
                    blob = new Blob(chunks, { type: response.headers.get('Content-Type') || defaultMime });
                } else {
                    onProgress?.(new DownloadProgress(0, undefined));
                    blob = await response.blob();
                    onProgress?.(new DownloadProgress(blob.size, blob.size));
                }
            }

            if (!isVideo) {
                blob = await applyAudioPostProcessing(blob, quality, onProgress, options.signal, postProcessingQuality);
            }

            // Add metadata if track information is provided
            if (enrichedTrack) {
                onProgress?.({
                    stage: 'processing',
                    message: 'Adding metadata...',
                });

                onProgress?.(new DownloadProgress('Adding metadata'));
                try {
                    if (isVideo) {
                        blob = new File(
                            [
                                await ffmpeg(blob, {
                                    args: ['-c', 'copy'],
                                    outputName: 'output.mp4',
                                    outputMime: 'video/mp4',
                                    onProgress,
                                    signal: options.signal,
                                }),
                            ],
                            'output.mp4',
                            { type: 'video/mp4' }
                        );
                    }
                    blob = await addMetadataToAudio(blob, enrichedTrack, this, quality, prefetchPromises);
                } catch (err) {
                    console.error(err);
                }
            }

            if (options.triggerDownload ?? true) {
                // Detect actual format and fix filename extension if needed
                const detectedExtension = await getExtensionFromBlob(blob);
                let finalFilename = filename;

                // Replace extension if it doesn't match detected format
                const currentExtension = filename.split('.').pop()?.toLowerCase();
                if (currentExtension && currentExtension !== detectedExtension) {
                    finalFilename = filename.replace(/\.[^.]+$/, `.${detectedExtension}`);
                }

                triggerDownload(blob, finalFilename);
            }

            return blob;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw error;
            }
            console.error('Download failed:', error);
            if (error instanceof FfmpegError || error.code === 'MP3_ENCODING_FAILED') {
                throw error;
            }
            if (error.code === STRICT_QUALITY_UNAVAILABLE_CODE) {
                throw error;
            }
            if (error.message === RATE_LIMIT_ERROR_MESSAGE) {
                throw error;
            }
            throw new Error('Download failed. The stream may require a proxy.');
        }
    }

    getCoverUrl(id, size = '320') {
        if (!id) {
            return `https://picsum.photos/seed/${Math.random()}/${size}`;
        }

        if (typeof id === 'string' && (id.startsWith('http') || id.startsWith('blob:') || id.startsWith('assets/'))) {
            return id;
        }

        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }

    getCoverSrcset(id) {
        if (
            !id ||
            (typeof id === 'string' && (id.startsWith('http') || id.startsWith('blob:') || id.startsWith('assets/')))
        ) {
            return '';
        }

        const formattedId = String(id).replace(/-/g, '/');
        const baseUrl = `https://resources.tidal.com/images/${formattedId}`;
        return `${baseUrl}/160x160.jpg 160w, ${baseUrl}/320x320.jpg 320w, ${baseUrl}/640x640.jpg 640w`;
    }

    getArtistPictureUrl(id, size = '320') {
        if (!id) {
            return `https://picsum.photos/seed/${Math.random()}/${size}`;
        }

        if (typeof id === 'string' && (id.startsWith('blob:') || id.startsWith('assets/'))) {
            return id;
        }

        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }

    getArtistPictureSrcset(id) {
        if (!id || (typeof id === 'string' && (id.startsWith('blob:') || id.startsWith('assets/')))) {
            return '';
        }

        const formattedId = String(id).replace(/-/g, '/');
        const baseUrl = `https://resources.tidal.com/images/${formattedId}`;
        return `${baseUrl}/160x160.jpg 160w, ${baseUrl}/320x320.jpg 320w, ${baseUrl}/640x640.jpg 640w`;
    }

    getVideoCoverUrl(imageId, size = '1280') {
        if (!imageId) {
            return null;
        }

        if (
            typeof imageId === 'string' &&
            (imageId.startsWith('http') || imageId.startsWith('blob:') || imageId.startsWith('assets/'))
        ) {
            return imageId;
        }

        const formattedId = String(imageId).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x720.jpg`;
    }

    async clearCache() {
        await this.cache.clear();
        this.streamCache.clear();
        this.unifiedPlaybackFailures.clear();
    }

    getCacheStats() {
        return {
            ...this.cache.getCacheStats(),
            streamUrls: this.streamCache.size,
        };
    }
}
