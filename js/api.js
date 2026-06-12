//js/api.js
import {
    RATE_LIMIT_ERROR_MESSAGE,
    deriveTrackQuality,
    delay,
    isTrackUnavailable,
    getExtensionFromBlob,
    getTrackDiscNumber,
    normalizeQualityToken,
    getTrackCoverId,
    getCoverBlob,
} from './utils.js';
import { preferDolbyAtmosSettings, trackDateSettings, devModeSettings, amazonMusicSettings } from './storage.js';
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
import { isIos, isSafari, isChrome } from './platform-detection.js';
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
export { resolveDownloadTotalBytes };
let lastAudioSourceMissingNotifyAt = 0;
const AMAZON_RATE_LIMITED_UNTIL_KEY = 'amazon-music-rate-limited-until';
const AMAZON_RATE_LIMIT_DURATION_MS = 30 * 60 * 1000;
function notifyAudioSourceMissing() {
    const now = Date.now();
    if (now - lastAudioSourceMissingNotifyAt < 3000) return;
    lastAudioSourceMissingNotifyAt = now;
    import('./downloads.js').then((m) => m.showNotification('Could not find Audio Source')).catch(() => {});
}

export class LosslessAPI {
    constructor(settings) {
        this.settings = settings;
        this.cache = new APICache({
            maxSize: 200,
            ttl: 1000 * 60 * 30,
        });
        this.streamCache = new Map();
        this.amazonAsinCache = new Map();
        this.turnstileLoadPromise = null;

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

        return await tryInstances(await getInstances(true));
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
                        const aLow = a.toLowerCase();
                        const bLow = b.toLowerCase();
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
                        const aLow = a.toLowerCase();
                        const bLow = b.toLowerCase();
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
                this.enrichArtistsWithPicture(preparedArtists),
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
            if (import.meta.env.DEV) {
                console.warn('[search] combined search failed, using HiFi scoped fallback', error);
            }

            // Final fallback: hifi-api-compatible scoped searches (?s, ?a, ?al, ?v, ?p)
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
    }

    async searchTracks(query, options = {}) {
        const cached = await this.cache.get('search_tracks', query);
        if (cached) return cached;

        try {
            const response = await this.fetchWithRetry(`/search/?s=${encodeURIComponent(query)}`, options);
            const data = await response.json();
            const normalized = this.normalizeSearchResponse(data, 'tracks');
            const preparedTracks = normalized.items.map((t) => this.prepareTrack(t));
            const dateEnriched = await this.enrichTracksWithAlbumDates(preparedTracks);
            const enrichedTracks = await this.enrichTracksWithAlbumCover(dateEnriched);
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
        const artistMap = new Map();

        // Check if tracks already have artist info (some might)
        for (const track of tracks) {
            const artists = track.artists || (track.artist ? [track.artist] : []);
            for (const artist of artists) {
                if (artist.id) {
                    artistMap.set(artist.id, artist);
                }
            }
        }

        if (artistMap.size < 3) {
            console.log('Not enough artists from stored data, trying search approach...');

            for (const track of tracks.slice(0, 5)) {
                try {
                    // Search for the track to get full metadata
                    const searchQuery =
                        `"${track.title}" ${track.artist?.name || track.artists?.[0]?.name || ''}`.trim();
                    const searchResult = await this.searchTracks(searchQuery, { signal: AbortSignal.timeout(5000) });

                    if (searchResult.items && searchResult.items.length > 0) {
                        const foundTrack = searchResult.items[0];
                        const foundArtists = foundTrack.artists || (foundTrack.artist ? [foundTrack.artist] : []);
                        for (const artist of foundArtists) {
                            if (artist.id) {
                                artistMap.set(artist.id, artist);
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`Search failed for track "${track.title}":`, e);
                }
            }
        }

        const artists = Array.from(artistMap.values());
        console.log(`Found ${artists.length} unique artists from ${tracks.length} tracks`);

        if (artists.length === 0) {
            console.log('No artists found, cannot generate recommendations');
            return [];
        }

        const recommendedTracks = [];
        const seenTrackIds = new Set(tracks.map((t) => t.id));

        const shuffledArtists = [...artists].sort(() => Math.random() - 0.5);
        const artistsToProcess = shuffledArtists.slice(0, Math.min(15, shuffledArtists.length));

        const artistPromises = artistsToProcess.map(async (artist) => {
            try {
                const artistData = await this.getArtist(artist.id, { lightweight: true, skipCache: options.refresh });
                if (artistData && artistData.tracks && artistData.tracks.length > 0) {
                    const availableTracks = artistData.tracks.filter((track) => !seenTrackIds.has(track.id));

                    const newTracks = options.knownTrackIds
                        ? availableTracks.filter((t) => !options.knownTrackIds.has(t.id))
                        : availableTracks;
                    const knownTracks = options.knownTrackIds
                        ? availableTracks.filter((t) => options.knownTrackIds.has(t.id))
                        : [];

                    const shuffledNew = [...newTracks].sort(() => Math.random() - 0.5);
                    const shuffledKnown = [...knownTracks].sort(() => Math.random() - 0.5);

                    const combined = [...shuffledNew, ...shuffledKnown];
                    return combined.slice(0, 2);
                } else {
                    console.warn(`No tracks found for artist ${artist.name}`);
                    return [];
                }
            } catch (e) {
                console.warn(`Failed to get tracks for artist ${artist.name}:`, e);
                return [];
            }
        });

        const results = await Promise.all(artistPromises);
        results.forEach((tracks) => {
            for (const t of tracks) {
                if (!seenTrackIds.has(t.id)) {
                    seenTrackIds.add(t.id);
                    recommendedTracks.push(this.prepareTrack(t));
                }
            }
        });

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
            case 'DOLBY_ATMOS':
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
        if (formats.includes('EAC3_JOC')) return 'DOLBY_ATMOS';
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
            const response = await this.fetchWithRetry(`/recommendations/?id=${id}`, {
                type: 'api',
                minVersion: '2.4',
            });
            const json = await response.json();
            const data = json.data || json;

            const items = data.items || [];
            const tracks = items.map((item) => this.prepareTrack(item.track || item));

            if (!(response instanceof TidalResponse)) {
                await this.cache.set('recommendations', id, tracks);
            }
            return tracks;
        } catch (error) {
            console.error('Failed to fetch recommendations:', error);
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

    async getQobuzStreamUrl(isrc, quality = 'LOSSLESS') {
        let qobuzInstances = [];
        try {
            qobuzInstances = await this.settings.getInstances('qobuz');
        } catch {
            // ignore
        }

        if (!qobuzInstances || qobuzInstances.length === 0) {
            return null;
        }

        for (const instance of qobuzInstances) {
            const rawUrl = typeof instance === 'string' ? instance : instance?.url;
            if (!rawUrl || typeof rawUrl !== 'string') continue;
            const baseUrl = rawUrl.replace(/\/+$/, '');
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const trackRes = await fetch(`${baseUrl}/api/get-music?q=${encodeURIComponent(isrc)}&offset=0`, {
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!trackRes.ok) continue;
                const trackJson = await trackRes.json();

                const tracks = trackJson.data?.tracks?.items || [];
                const match = tracks.find((t) => t.isrc?.toLowerCase() === isrc.toLowerCase()) || tracks[0];

                if (match && match.id) {
                    const qobuzTrackId = match.id;
                    const qobuzQualityMap = {
                        HI_RES_LOSSLESS: '27',
                        LOSSLESS: '6',
                        HIGH: '5',
                        LOW: '5',
                    };
                    const qobuzQuality = qobuzQualityMap[quality] || '6';

                    const streamController = new AbortController();
                    const streamTimeoutId = setTimeout(() => streamController.abort(), 8000);

                    const streamRes = await fetch(
                        `${baseUrl}/api/download-music?track_id=${qobuzTrackId}&quality=${qobuzQuality}`,
                        { signal: streamController.signal }
                    );
                    clearTimeout(streamTimeoutId);
                    if (!streamRes.ok) continue;
                    const streamJson = await streamRes.json();

                    if (streamJson.success && streamJson.data && streamJson.data.url) {
                        let rgInfo = null;
                        if (match.audio_info) {
                            rgInfo = {
                                trackReplayGain: match.audio_info.replaygain_track_gain,
                                trackPeakAmplitude: match.audio_info.replaygain_track_peak,
                                albumReplayGain: match.audio_info.replaygain_album_gain,
                                albumPeakAmplitude: match.audio_info.replaygain_album_peak,
                            };
                        }
                        return { url: streamJson.data.url, rgInfo };
                    }
                }
            } catch (e) {
                console.warn(`Qobuz instance ${baseUrl} failed for ISRC ${isrc}:`, e);
                continue;
            }
        }
        return null;
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
            return 'UHD';
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
            DOLBY_ATMOS: 'UHD',
        };
        return qualityMap[quality] || qualityMap[normalizeQualityToken(quality)] || 'HD';
    }

    getAmazonRateLimitedUntil() {
        try {
            return Number(localStorage.getItem(AMAZON_RATE_LIMITED_UNTIL_KEY) || 0);
        } catch {
            return this.amazonRateLimitedUntil || 0;
        }
    }

    isAmazonRateLimited() {
        return Date.now() < this.getAmazonRateLimitedUntil();
    }

    setAmazonRateLimited() {
        const until = Date.now() + AMAZON_RATE_LIMIT_DURATION_MS;
        this.amazonRateLimitedUntil = until;
        try {
            localStorage.setItem(AMAZON_RATE_LIMITED_UNTIL_KEY, String(until));
        } catch {}

        for (const [key, value] of this.streamCache.entries()) {
            if (value?.provider === 'amazon') {
                this.streamCache.delete(key);
            }
        }

        console.warn('Amazon Music API returned 403; falling back to Qobuz for 30 minutes');
    }

    clearAmazonTurnstileJwt() {
        this._turnstileCachedJwt = null;
        this._turnstileCachedExpiry = 0;
    }

    handleAmazonApiStatus(status, endpointName = 'Amazon Music API') {
        if (status === 403) {
            this.setAmazonRateLimited();
            throw new Error(`${endpointName} rate limited the client`);
        }
    }

    getAmazonSelectedQualityInfo(trackInfo) {
        if (!Array.isArray(trackInfo?.available_qualities)) return null;
        return trackInfo.available_qualities.find((item) => item.quality === trackInfo.quality_selected) || null;
    }

    getAmazonCodecString(codec) {
        const normalized = String(codec || '').toLowerCase();
        if (normalized === 'flac') return 'flac';
        if (normalized === 'opus') return 'opus';
        return normalized;
    }

    getAmazonMimeType(qualityInfo = null) {
        const codec = this.getAmazonCodecString(qualityInfo?.codec);
        return codec ? `audio/mp4; codecs="${codec}"` : 'audio/mp4';
    }

    getAmazonQualityDisplay(trackInfo, qualityInfo = null) {
        const quality = String(trackInfo?.quality_selected || trackInfo?.quality_requested || '').trim();
        if (qualityInfo?.bitDepth && qualityInfo?.sampleRate) {
            const sampleRate =
                qualityInfo.sampleRate === 44100 ? '44.1' : String(Math.round(qualityInfo.sampleRate / 1000));
            if (quality.startsWith('UHD_')) {
                return `HD ${qualityInfo.bitDepth}/${sampleRate}`;
            }
            if (quality.startsWith('HD_')) {
                return `FLAC ${qualityInfo.bitDepth}/${sampleRate}`;
            }
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
            const existing = document.querySelector('script[data-monochrome-turnstile]');
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
            script.dataset.monochromeTurnstile = 'true';
            script.onload = () => resolve(window.turnstile);
            script.onerror = () => reject(new Error('Failed to load Turnstile'));
            document.head.appendChild(script);
        }).finally(() => {
            this.turnstileLoadPromise = null;
        });

        return this.turnstileLoadPromise;
    }

    getTurnstileContainer() {
        let panel = document.getElementById('amazon-music-turnstile-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'amazon-music-turnstile-panel';
            panel.style.position = 'fixed';
            panel.style.right = '16px';
            panel.style.bottom = '84px';
            panel.style.zIndex = '9999';
            panel.style.width = '320px';
            panel.style.padding = '12px';
            panel.style.border = '1px solid var(--border)';
            panel.style.borderRadius = 'var(--radius-md)';
            panel.style.background = 'var(--card)';
            panel.style.color = 'var(--foreground)';
            panel.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.28)';
            panel.style.fontSize = '0.8rem';
            panel.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 0.25rem;">Cloudflare verification</div>
                <div style="color: var(--muted-foreground); margin-bottom: 0.75rem; line-height: 1.35;">
                    Amazon Music playback needs a quick browser check.
                </div>
                <div id="amazon-music-turnstile-container"></div>
            `;
            document.body.appendChild(panel);
        }
        return panel.querySelector('#amazon-music-turnstile-container');
    }

    async getTurnstileResponse() {
        const siteKey = amazonMusicSettings.getTurnstileSiteKey().trim();
        if (!siteKey) {
            return null;
        }

        const container = this.getTurnstileContainer();
        container.innerHTML = '';
        const turnstile = await this.loadTurnstile();

        return await new Promise((resolve, reject) => {
            let timeoutId;
            let widgetId;
            const cleanup = () => {
                clearTimeout(timeoutId);
                if (widgetId && turnstile.remove) {
                    try {
                        turnstile.remove(widgetId);
                    } catch {}
                }
                document.getElementById('amazon-music-turnstile-panel')?.remove();
            };

            timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Turnstile timed out'));
            }, 30000);

            widgetId = turnstile.render(container, {
                sitekey: siteKey,
                size: 'normal',
                execution: 'execute',
                appearance: 'interaction-only',
                theme: 'auto',
                callback: (token) => {
                    cleanup();
                    resolve(token);
                },
                'error-callback': () => {
                    cleanup();
                    reject(new Error('Turnstile failed'));
                },
                'expired-callback': () => {
                    cleanup();
                    reject(new Error('Turnstile expired'));
                },
            });

            turnstile.execute(widgetId);
        });
    }

    async getTurnstileJwt({ forceRefresh = false } = {}) {
        if (!forceRefresh && this._turnstileCachedJwt && Date.now() < this._turnstileCachedExpiry) {
            return this._turnstileCachedJwt;
        }
        if (forceRefresh) {
            this.clearAmazonTurnstileJwt();
        }

        const apiBaseUrl = amazonMusicSettings.getApiBaseUrl().replace(/\/+$/, '');
        let response = null;

        for (let attempt = 0; attempt < 2; attempt++) {
            const turnstileResponse = await this.getTurnstileResponse();
            if (!turnstileResponse) return null;

            response = await fetch(`${apiBaseUrl}/api/auth/turnstile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ cf_turnstile_response: turnstileResponse }),
            });

            this.handleAmazonApiStatus(response.status, 'Amazon Music Turnstile auth');
            if ((response.status === 401 || response.status === 428) && attempt === 0) {
                this.clearAmazonTurnstileJwt();
                continue;
            }
            break;
        }

        if (!response.ok) {
            throw new Error(`Failed to exchange Turnstile token: ${response.status}`);
        }

        const data = await response.json();
        this._turnstileCachedJwt = data.access_token;
        this._turnstileCachedExpiry = Date.now() + (data.expires_in - 60) * 1000;

        return data.access_token;
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
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
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
        return String(track?.title || track?.name || '').trim();
    }

    getAmazonTrackArtist(track) {
        if (track?.artist?.name) return String(track.artist.name).trim();
        if (Array.isArray(track?.artists) && track.artists.length > 0) {
            return track.artists
                .map((artist) => (typeof artist === 'string' ? artist : artist?.name))
                .filter(Boolean)
                .join(' ')
                .trim();
        }
        return '';
    }

    getAmazonTrackAlbum(track) {
        return String(track?.album?.title || track?.album?.name || '').trim();
    }

    normalizeAmazonSearchText(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\b(explicit|clean|remaster(?:ed)?|deluxe|bonus track|radio edit)\b/g, ' ')
            .replace(/[()[\]{}]/g, ' ')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    scoreAmazonTextMatch(expected, actual, weight) {
        const left = this.normalizeAmazonSearchText(expected);
        const right = this.normalizeAmazonSearchText(actual);
        if (!left || !right) return 0;
        if (left === right) return weight;
        if (right.includes(left) || left.includes(right)) return weight * 0.78;

        const leftTokens = new Set(left.split(' ').filter(Boolean));
        const rightTokens = new Set(right.split(' ').filter(Boolean));
        if (!leftTokens.size || !rightTokens.size) return 0;

        let overlap = 0;
        for (const token of leftTokens) {
            if (rightTokens.has(token)) overlap++;
        }
        return weight * (overlap / Math.max(leftTokens.size, rightTokens.size));
    }

    scoreAmazonDurationMatch(expectedDuration, actualDuration) {
        const expected = Number(expectedDuration);
        const actual = Number(actualDuration);
        if (!Number.isFinite(expected) || !Number.isFinite(actual) || expected <= 0 || actual <= 0) {
            return 0;
        }

        const diff = Math.abs(expected - actual);
        if (diff <= 2) return 15;
        if (diff <= 5) return 12;
        if (diff <= 10) return 8;
        if (diff <= 20) return 4;
        return 0;
    }

    scoreAmazonSearchResult(track, candidate) {
        const titleScore = this.scoreAmazonTextMatch(this.getAmazonTrackTitle(track), candidate?.title, 45);
        const artistScore = this.scoreAmazonTextMatch(this.getAmazonTrackArtist(track), candidate?.artist?.name, 25);
        const albumScore = this.scoreAmazonTextMatch(this.getAmazonTrackAlbum(track), candidate?.album?.name, 15);
        const durationScore = this.scoreAmazonDurationMatch(track?.duration, candidate?.duration);
        const score = titleScore + artistScore + albumScore + durationScore;

        return {
            candidate,
            score,
            titleScore,
            artistScore,
            albumScore,
            durationScore,
        };
    }

    getBestAmazonSearchResult(track, results) {
        if (!Array.isArray(results) || results.length === 0) return null;

        const ranked = results
            .filter((candidate) => candidate?.id)
            .map((candidate) => this.scoreAmazonSearchResult(track, candidate))
            .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (!best) return null;

        const strongTitle = best.titleScore >= 35;
        const strongArtist = best.artistScore >= 19;
        const closeDuration = !track?.duration || !best.candidate?.duration || best.durationScore >= 8;
        if (best.score < 62 || !strongTitle || !strongArtist || !closeDuration) {
            console.warn('Amazon Music search had no confident match:', {
                track: {
                    title: this.getAmazonTrackTitle(track),
                    artist: this.getAmazonTrackArtist(track),
                    album: this.getAmazonTrackAlbum(track),
                    duration: track?.duration,
                },
                best,
            });
            return null;
        }

        return best.candidate;
    }

    async getAmazonAsin(tidalTrackId, track = null) {
        const title = this.getAmazonTrackTitle(track);
        const artist = this.getAmazonTrackArtist(track);
        const album = this.getAmazonTrackAlbum(track);
        const cacheKey =
            title || artist
                ? `search:${this.normalizeAmazonSearchText(`${title} ${artist} ${album}`)}:${track?.duration || 0}`
                : `id:${tidalTrackId}`;
        if (this.amazonAsinCache.has(cacheKey)) {
            return this.amazonAsinCache.get(cacheKey);
        }

        if (!title || !artist) {
            throw new Error('Amazon Music search requires a track title and artist');
        }

        const converterBaseUrl = amazonMusicSettings.getConverterBaseUrl().replace(/\/+$/, '');
        const params = new URLSearchParams({ query: `${title} ${artist}`.trim() });
        const response = await this.fetchWithTimeout(
            `${converterBaseUrl}/api/search/songs?${params.toString()}`,
            {},
            8000
        );
        this.handleAmazonApiStatus(response.status, 'Amazon Music search');
        if (!response.ok) {
            throw new Error(`Amazon Music search failed: ${response.status}`);
        }

        const data = await response.json();
        if (data?.success === false) {
            throw new Error('Amazon Music search returned unsuccessful response');
        }

        const match = this.getBestAmazonSearchResult(track, data?.data);
        const asin = match?.id;
        if (!asin) {
            throw new Error('Amazon Music search returned no confident ASIN match');
        }

        this.amazonAsinCache.set(cacheKey, asin);
        return asin;
    }

    async fetchAmazonTrackApi(apiBaseUrl, asin, amazonQuality, { forceTurnstile = false } = {}) {
        const params = new URLSearchParams({ quality: amazonQuality });
        const headers = {};
        const bypassToken = amazonMusicSettings.getTurnstileBypassToken().trim();

        if (bypassToken && !forceTurnstile) {
            params.set('bypass_token', bypassToken);
        } else {
            const turnstileJwt = await this.getTurnstileJwt({ forceRefresh: forceTurnstile });
            if (!turnstileJwt) {
                return null;
            }
            headers['X-Turnstile-JWT'] = turnstileJwt;
        }

        const response = await this.fetchWithTimeout(
            `${apiBaseUrl}/api/track/${asin}?${params.toString()}`,
            {
                headers,
            },
            15000
        );
        this.handleAmazonApiStatus(response.status, 'Amazon Music API');
        return response;
    }

    async getAmazonMusicStreamUrl(tidalTrackId, quality = 'LOSSLESS', options = {}) {
        try {
            if (!amazonMusicSettings?.isEnabled()) {
                return null;
            }
            if (this.isAmazonRateLimited()) {
                return null;
            }

            const track =
                options.track || (tidalTrackId ? await this.getTrackMetadata(tidalTrackId).catch(() => null) : null);
            const asin = await this.getAmazonAsin(tidalTrackId, track);
            const amazonQuality = this.getAmazonMusicQuality(quality, options);
            const apiBaseUrl = amazonMusicSettings.getApiBaseUrl().replace(/\/+$/, '');

            let response = await this.fetchAmazonTrackApi(apiBaseUrl, asin, amazonQuality);
            if (response && (response.status === 401 || response.status === 428)) {
                this.clearAmazonTurnstileJwt();
                response = await this.fetchAmazonTrackApi(apiBaseUrl, asin, amazonQuality, { forceTurnstile: true });
            }
            if (!response) return null;

            if (!response.ok) {
                throw new Error(`Amazon Music API failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data?.stream_url) {
                throw new Error('Amazon Music API returned no stream URL');
            }

            const selectedQualityInfo = this.getAmazonSelectedQualityInfo(data);
            const mp4Info = await this.getAmazonCencMp4Info(data.stream_url).catch((e) => {
                console.warn('Failed to get Amazon MP4 info:', e);
                return null;
            });
            if (data.decryption_key && !mp4Info?.keyId) {
                throw new Error('Could not find Amazon Music CENC key ID');
            }
            const manifestUrl = mp4Info
                ? this.createAmazonMusicDashUrl(data.stream_url, data, selectedQualityInfo, mp4Info)
                : data.stream_url;

            return {
                url: manifestUrl,
                sourceUrl: data.stream_url,
                asin,
                provider: 'amazon',
                playbackType: mp4Info ? (mp4Info.keyId ? 'dash-cenc' : 'dash') : 'direct',
                quality: data.quality_selected || amazonQuality,
                qualityDisplay: this.getAmazonQualityDisplay(data, selectedQualityInfo),
                decryptionKey: data.decryption_key || null,
                keyId: mp4Info?.keyId || null,
                mimeType: mp4Info ? 'application/dash+xml' : this.getAmazonMimeType(selectedQualityInfo),
                mediaMimeType: this.getAmazonMimeType(selectedQualityInfo),
                rgInfo: {
                    trackReplayGain:
                        data.replay_gain?.program_loudness_lufs != null
                            ? -14.0 - data.replay_gain.program_loudness_lufs
                            : 0,
                    trackPeakAmplitude: 1,
                    albumReplayGain:
                        data.replay_gain?.program_loudness_lufs != null
                            ? -14.0 - data.replay_gain.program_loudness_lufs
                            : 0,
                    albumPeakAmplitude: 1,
                },
            };
        } catch (error) {
            console.warn(`Amazon Music stream failed for Tidal track ${tidalTrackId}:`, error);
            return null;
        }
    }

    async getStreamUrl(id, quality = 'LOSSLESS') {
        const cacheKey = `stream_info_${id}_${quality}`;

        if (this.streamCache.has(cacheKey)) {
            const cached = this.streamCache.get(cacheKey);
            if (cached?.provider === 'amazon' && this.isAmazonRateLimited()) {
                this.streamCache.delete(cacheKey);
            } else {
                return cached;
            }
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

        const track = await this.getTrackMetadata(id);
        const preferAmazon = Math.random() > 0.5;

        let amazonResult = null;
        let qobuzResult = null;

        if (preferAmazon) {
            amazonResult = await this.getAmazonMusicStreamUrl(id, quality, {
                preferAdaptiveAuto: true,
                track,
            });
            if (!amazonResult?.url && track?.isrc) {
                qobuzResult = await this.getQobuzStreamUrl(track.isrc, quality);
            }
        } else {
            if (track?.isrc) {
                qobuzResult = await this.getQobuzStreamUrl(track.isrc, quality);
            }
            if (!qobuzResult?.url) {
                amazonResult = await this.getAmazonMusicStreamUrl(id, quality, {
                    preferAdaptiveAuto: true,
                    track,
                });
            }
        }

        if (amazonResult?.url) {
            const result = {
                url: amazonResult.url,
                sourceUrl: amazonResult.sourceUrl || amazonResult.url,
                rgInfo: amazonResult.rgInfo,
                provider: amazonResult.provider,
                playbackType: amazonResult.playbackType,
                quality: amazonResult.quality,
                qualityDisplay: amazonResult.qualityDisplay,
                decryptionKey: amazonResult.decryptionKey,
                keyId: amazonResult.keyId,
                mimeType: amazonResult.mimeType,
                mediaMimeType: amazonResult.mediaMimeType,
            };
            this.streamCache.set(cacheKey, result);
            return result;
        }

        if (qobuzResult?.url) {
            const result = {
                url: qobuzResult.url,
                rgInfo: qobuzResult.rgInfo || {
                    trackReplayGain: 0,
                    trackPeakAmplitude: 1,
                    albumReplayGain: 0,
                    albumPeakAmplitude: 1,
                },
                provider: 'qobuz',
            };
            this.streamCache.set(cacheKey, result);
            return result;
        }

        notifyAudioSourceMissing();
        throw new Error(
            track?.isrc
                ? 'Could not resolve stream URL from Amazon Music or Qobuz'
                : 'Could not resolve stream URL: Amazon Music failed and track has no ISRC for Qobuz lookup'
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
        if (downloadQuality == 'DOLBY_ATMOS' && !input?.audioModes?.includes('DOLBY_ATMOS')) {
            downloadQuality = 'LOSSLESS';
        }

        const id = input?.id || input;
        const track = typeof input === 'object' && input.isrc ? input : await this.getTrackMetadata(id);
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
            const preferAmazon = Math.random() > 0.5;
            let amazonResult = null;
            let qobuzResult = null;

            if (preferAmazon) {
                amazonResult = await this.getAmazonMusicStreamUrl(id, cleanQuality, { track });
                if (!amazonResult?.url && track?.isrc) {
                    qobuzResult = await this.getQobuzStreamUrl(track.isrc, cleanQuality);
                }
            } else {
                if (track?.isrc) {
                    qobuzResult = await this.getQobuzStreamUrl(track.isrc, cleanQuality);
                }
                if (!qobuzResult?.url) {
                    amazonResult = await this.getAmazonMusicStreamUrl(id, cleanQuality, { track });
                }
            }

            const externalResult = amazonResult?.url ? amazonResult : qobuzResult;
            if (externalResult?.url) {
                externalStreamUrl = externalResult.url;
                externalRgInfo = externalResult.rgInfo;
                externalStreamType = externalResult.playbackType || null;
                externalProvider = externalResult.provider || (amazonResult?.url ? 'amazon' : 'qobuz');
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
                notifyAudioSourceMissing();
                throw new Error(
                    track?.isrc
                        ? 'Could not resolve audio stream from Amazon Music or Qobuz'
                        : 'Cannot resolve audio stream: Amazon Music failed and track has no ISRC for Qobuz lookup'
                );
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
        const result = { lookup, enrichedTrack: finalEnriched, isVideo };
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
        if (externalProvider === 'qobuz') {
            result.qobuzStreamUrl = externalStreamUrl;
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
            let downloadQuality = isCustomFormat(quality) ? 'LOSSLESS' : quality;

            const enriched = await this.enrichTrack(inputTrack || id, { downloadQuality });
            const { lookup, enrichedTrack, isVideo } = enriched;

            let streamUrl = enriched.externalStreamUrl || enriched.qobuzStreamUrl || null;
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
                            const stream = await this.getStreamUrl(id, 'DOLBY_ATMOS', true);
                            const manifestRes = await fetch(stream.url, { signal: options.signal });
                            const manifestText = await manifestRes.text();
                            streamUrl = this.extractStreamUrlFromManifest(btoa(manifestText));

                            if (streamUrl) {
                                postProcessingQuality = 'DOLBY_ATMOS';
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
                blob = await ffmpeg(encryptedBlob, {
                    rawArgs: [
                        '-decryption_key',
                        enriched.externalDecryptionKey,
                        '-i',
                        'input',
                        '-c:a',
                        'flac',
                        'output.flac',
                    ],
                    outputName: 'output.flac',
                    outputMime: 'audio/flac',
                    onProgress,
                    signal: options.signal,
                });
            } else if (streamUrl.startsWith('blob:')) {
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
                    if (downloadQuality !== 'LOSSLESS') {
                        console.warn('Falling back to LOSSLESS (16-bit) download.');
                        return this.downloadTrack(id, 'LOSSLESS', filename, options);
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
    }

    getCacheStats() {
        return {
            ...this.cache.getCacheStats(),
            streamUrls: this.streamCache.size,
        };
    }
}
