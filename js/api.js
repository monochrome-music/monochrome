//js/api.js
import {
    RATE_LIMIT_ERROR_MESSAGE,
    deriveTrackQuality,
    delay,
    isTrackUnavailable,
    getExtensionFromBlob,
    getTrackTitle,
    getFullArtistString,
    getTrackDiscNumber,
    getMimeType,
} from './utils.js';
import { trackDateSettings } from './storage.js';
import { db } from './db.js';
import { APICache } from './cache.js';
import { DashDownloader } from './dash-downloader.ts';
import { HlsDownloader } from './hls-downloader.js';
import { MP3EncodingError } from './mp3-encoder.js';
import { loadFfmpeg, FfmpegError, ffmpeg } from './ffmpeg.js';
import { triggerDownload, applyAudioPostProcessing } from './download-utils.ts';
import { isCustomFormat } from './ffmpegFormats.ts';
import { DownloadProgress } from './progressEvents.js';
import { resolveDownloadTotalBytes } from './downloadProgressUtils.js';
import { readableStreamIterator } from './readableStreamIterator.js';
import { HiFiClient, TidalResponse } from './HiFi.ts';
import { isIos, isSafari } from './platform-detection.js';

export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';
export { resolveDownloadTotalBytes };
const TIDAL_V2_TOKEN = 'txNoH4kkV41MfH25';
const SMART_MIX_DEFINITIONS = [
    { id: 'smart-daily-mix-1', title: 'Daily Mix 1', mixType: 'DAILY_MIX' },
    { id: 'smart-daily-mix-2', title: 'Daily Mix 2', mixType: 'DAILY_MIX' },
    { id: 'smart-daily-mix-3', title: 'Daily Mix 3', mixType: 'DAILY_MIX' },
    { id: 'smart-daily-mix-4', title: 'Daily Mix 4', mixType: 'DAILY_MIX' },
    { id: 'smart-daily-mix-5', title: 'Daily Mix 5', mixType: 'DAILY_MIX' },
    { id: 'smart-daily-mix-6', title: 'Daily Mix 6', mixType: 'DAILY_MIX' },
    { id: 'smart-discover-weekly', title: 'Discover Weekly', mixType: 'DISCOVER_WEEKLY' },
    { id: 'smart-release-radar', title: 'Release Radar', mixType: 'RELEASE_RADAR' },
];

const QUALITY_ALIASES = {
    HI_RES: 'HI_RES_LOSSLESS',
    HI_RES_LOSSLESS: 'HI_RES_LOSSLESS',
    LOSSLESS: 'LOSSLESS',
    HIGH: 'HIGH',
    LOW: 'LOW',
};

export class LosslessAPI {
    constructor(settings) {
        this.settings = settings;
        this.cache = new APICache({
            maxSize: 200,
            ttl: 1000 * 60 * 30,
        });
        this.streamCache = new Map();
        this.smartMixCache = {
            key: null,
            mixes: [],
        };

        setInterval(
            () => {
                this.cache.clearExpired();
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
        const instanceRoutes = ['/track', '/album/similar', '/artist/similar', '/video', '/recommendations'];

        if (window.allTidal == true || !instanceRoutes.some((route) => relativePath.startsWith(route))) {
            try {
                if (import.meta.env.DEV) {
                    console.log(relativePath);
                }

                return await HiFiClient.instance.queryResponse(relativePath);
            } catch (err) {
                console.warn(
                    `Direct fetch failed for ${relativePath}. Falling back to configured API instances...`,
                    err
                );
            }
        }

        let instances = await this.settings.getInstances(type);
        if (instances.length === 0) {
            throw new Error(`No API instances configured for type: ${type}`);
        }

        if (options.minVersion) {
            instances = instances.filter((instance) => {
                if (!instance.version) return false;
                return parseFloat(instance.version) >= parseFloat(options.minVersion);
            });
            if (instances.length === 0) {
                throw new Error(`No API instances configured for type: ${type} with minVersion: ${options.minVersion}`);
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

        const maxTotalAttempts = instances.length * 2; // Allow some retries across instances
        let lastError = null;
        let instanceIndex = Math.floor(Math.random() * instances.length);

        for (let attempt = 1; attempt <= maxTotalAttempts; attempt++) {
            const instance = instances[instanceIndex % instances.length];
            const baseUrl = typeof instance === 'string' ? instance : instance.url;
            const url = baseUrl.endsWith('/') ? `${baseUrl}${relativePath.substring(1)}` : `${baseUrl}${relativePath}`;

            try {
                const response = await fetch(url, { signal: options.signal });

                if (response.status === 429) {
                    console.warn(`Rate limit hit on ${baseUrl}. Trying next instance...`);
                    instanceIndex++;
                    await delay(500); // Small delay before trying next instance
                    continue;
                }

                if (response.ok) {
                    return response;
                }

                if (response.status === 401) {
                    let errorData = await response.clone().json();
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
        let normalized = track;

        if (track.type && typeof track.type === 'string') {
            const lowType = track.type.toLowerCase();
            if (lowType === 'video' || lowType === 'track') {
                normalized = { ...track, type: lowType };
            }
        }

        if (!track.artist && Array.isArray(track.artists) && track.artists.length > 0) {
            normalized = { ...normalized, artist: track.artists[0] };
        }

        const derivedQuality = deriveTrackQuality(normalized);
        if (derivedQuality && normalized.audioQuality !== derivedQuality) {
            normalized = { ...normalized, audioQuality: derivedQuality };
        }

        normalized.isUnavailable = isTrackUnavailable(normalized);

        return normalized;
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

            // Check if backend returned an error or if this looks like individual fallback
            if (data.error || (!data.tracks && !data.artists && !data.albums && (!data.data || !data.data.tracks))) {
                throw new Error('Fallback to individual searches');
            }

            const extractSection = (key) => this.normalizeSearchResponse(data, key);

            const tracksData = extractSection('tracks');
            const artistsData = extractSection('artists');
            const albumsData = extractSection('albums');
            const playlistsData = extractSection('playlists');
            const videosData = extractSection('videos');

            const results = {
                tracks: {
                    ...tracksData,
                    items: tracksData.items.map((t) => this.prepareTrack(t)),
                },
                artists: {
                    ...artistsData,
                    items: artistsData.items.map((a) => this.prepareArtist(a)),
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
            // Fallback to individual searches if the backend proxy doesn't support ?q= or throws
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
            // Skip enrichment for search to be fast and lightweight
            // const enrichedTracks = await this.enrichTracksWithAlbumDates(preparedTracks);
            const result = {
                ...normalized,
                items: preparedTracks,
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
            const result = {
                ...normalized,
                items: normalized.items.map((a) => this.prepareArtist(a)),
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
            allowedDomains: ['api.monochrome.tf', 'arran.monochrome.tf'],
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

        const result = { playlist, tracks };

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('playlist', id, result);
        }
        return result;
    }

    async getMix(id) {
        if (this.isSmartMixId(id)) {
            const mixes = await this.generatePersonalizedMixes();
            const match = mixes.find((mix) => mix.id === id);
            if (!match) throw new Error('Mix not found');

            const mix = {
                id: match.id,
                title: match.title,
                subTitle: match.subTitle || '',
                description: match.description || '',
                mixType: match.mixType || 'DAILY_MIX',
                cover: match.cover || null,
            };
            return { mix, tracks: match.tracks };
        }

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

    isSmartMixId(id) {
        return typeof id === 'string' && id.startsWith('smart-');
    }

    async getPersonalizedMixes(forceRefresh = false) {
        const mixes = await this.generatePersonalizedMixes(forceRefresh);
        return mixes.map(({ tracks, ...mix }) => ({
            ...mix,
            numberOfTracks: tracks.length,
        }));
    }

    async generatePersonalizedMixes(forceRefresh = false) {
        const history = await db.getHistory();
        const likedTracks = await db.getFavorites('track');
        const playlists = await db.getPlaylists(true);

        const recentHistoryFingerprint = history
            .slice(0, 10)
            .map((track) => `${track.id}:${track.timestamp || 0}`)
            .join('|');
        const today = new Date().toISOString().slice(0, 10);
        const cacheKey = `${today}:${history.length}:${likedTracks.length}:${playlists.length}:${recentHistoryFingerprint}`;

        if (!forceRefresh && this.smartMixCache.key === cacheKey && this.smartMixCache.mixes.length > 0) {
            return this.smartMixCache.mixes;
        }

        const poolMap = new Map();
        const now = Date.now();
        // Signal extraction and weighting constants for smart mix generation.
        // Activity offsets are in milliseconds and keep deterministic recency ordering.
        const TOP_SIGNAL_LIMIT = 6;
        const HISTORY_WEIGHT_WINDOW = 30;
        const HISTORY_WEIGHT_DIVISOR = 6;
        const LIKED_TRACK_WEIGHT = 2.5;
        const PLAYLIST_TRACK_WEIGHT = 1.5;
        const LIKED_ACTIVITY_OFFSET = 120000;
        const PLAYLIST_ACTIVITY_OFFSET = 180000;
        const MIN_GENRE_TOKEN_LENGTH = 3;
        const MAX_GENRE_TOKEN_LENGTH = 30;
        const qualityTokens = new Set(['hi_res_lossless', 'lossless', 'high', 'dolby_atmos', 'atmos', 'mqa']);
        const moodKeywords = ['chill', 'happy', 'sad', 'focus', 'party', 'upbeat', 'calm', 'energetic', 'sleep'];
        const artistScores = new Map();
        const genreScores = new Map();
        const moodScores = new Map();

        const safeString = (value) => (typeof value === 'string' ? value.trim() : '');
        const parseReleaseDate = (track) => {
            const raw = track?.album?.releaseDate || track?.streamStartDate;
            if (!raw) return -Infinity;
            const timestamp = new Date(raw).getTime();
            return Number.isFinite(timestamp) ? timestamp : -Infinity;
        };
        const cleanTrack = (track) => {
            const cloned = { ...track };
            delete cloned._score;
            delete cloned._activityAt;
            return cloned;
        };
        const readTags = (track) => {
            const tags = [
                ...(Array.isArray(track?.mediaMetadata?.tags) ? track.mediaMetadata.tags : []),
                ...(Array.isArray(track?.album?.mediaMetadata?.tags) ? track.album.mediaMetadata.tags : []),
            ]
                .filter((tag) => typeof tag === 'string')
                .flatMap((tag) => tag.toLowerCase().split(/[|,/]/))
                .map((tag) => tag.trim())
                .filter(Boolean);

            return Array.from(new Set(tags));
        };
        const isValidGenreToken = (tag) =>
            tag.length >= MIN_GENRE_TOKEN_LENGTH && tag.length <= MAX_GENRE_TOKEN_LENGTH && /^[a-z\s-]+$/.test(tag);
        const registerScore = (map, key, amount = 1) => {
            if (!key) return;
            map.set(key, (map.get(key) || 0) + amount);
        };
        const getTopKeys = (map, limit) =>
            Array.from(map.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
                .map(([key]) => key);
        const pickSignal = (signals, index) => {
            if (!Array.isArray(signals) || signals.length === 0) return null;
            return signals[index % signals.length];
        };
        const upsertTrack = (track, scoreWeight, activityAt) => {
            if (!track?.id) return;

            const key = String(track.id);
            const existing = poolMap.get(key);
            if (!existing) {
                const entry = {
                    ...track,
                    _score: scoreWeight,
                    _activityAt: activityAt || 0,
                };
                poolMap.set(key, entry);
            } else {
                existing._score += scoreWeight;
                existing._activityAt = Math.max(existing._activityAt || 0, activityAt || 0);
            }

            const artists = track.artists?.length ? track.artists : track.artist ? [track.artist] : [];
            artists.forEach((artist) => registerScore(artistScores, safeString(artist?.id || artist?.name), scoreWeight));

            const tags = readTags(track);
            tags.forEach((tag) => {
                if (qualityTokens.has(tag)) return;
                if (moodKeywords.some((keyword) => tag.includes(keyword))) {
                    const mood = moodKeywords.find((keyword) => tag.includes(keyword));
                    registerScore(moodScores, mood, scoreWeight);
                    return;
                }
                if (isValidGenreToken(tag)) {
                    registerScore(genreScores, tag, scoreWeight);
                }
            });

            const lowerTitle = safeString(track.title).toLowerCase();
            moodKeywords.forEach((keyword) => {
                if (lowerTitle.includes(keyword)) {
                    registerScore(moodScores, keyword, scoreWeight / 2);
                }
            });
        };
        const selectTracks = ({ artistKey = null, genre = null, mood = null, limit = 30, preferRecent = false } = {}) => {
            let candidates = Array.from(poolMap.values());

            if (artistKey) {
                candidates = candidates.filter((track) => {
                    const artists = track.artists?.length ? track.artists : track.artist ? [track.artist] : [];
                    return artists.some((artist) => safeString(artist?.id || artist?.name) === artistKey);
                });
            }

            if (genre) {
                candidates = candidates.filter((track) => readTags(track).some((tag) => tag.includes(genre)));
            }

            if (mood) {
                candidates = candidates.filter((track) => {
                    const tags = readTags(track);
                    const title = safeString(track.title).toLowerCase();
                    return tags.some((tag) => tag.includes(mood)) || title.includes(mood);
                });
            }

            if (candidates.length < limit) {
                const candidateIds = new Set(candidates.map((track) => String(track.id)));
                const filler = Array.from(poolMap.values()).filter((track) => !candidateIds.has(String(track.id)));
                candidates = candidates.concat(filler);
            }

            candidates.sort((a, b) => {
                const scoreDiff = (b._score || 0) - (a._score || 0);
                if (scoreDiff !== 0) return scoreDiff;
                if (preferRecent) return (b._activityAt || 0) - (a._activityAt || 0);
                return (parseReleaseDate(b) || 0) - (parseReleaseDate(a) || 0);
            });

            const deduped = [];
            const seen = new Set();
            for (const track of candidates) {
                const key = String(track.id);
                if (seen.has(key)) continue;
                seen.add(key);
                deduped.push(cleanTrack(track));
                if (deduped.length >= limit) break;
            }
            return deduped;
        };

        history.slice(0, HISTORY_WEIGHT_WINDOW).forEach((track, index) => {
            // More recent history entries receive larger weights.
            const weight = Math.max(1, HISTORY_WEIGHT_WINDOW - index) / HISTORY_WEIGHT_DIVISOR;
            upsertTrack(track, weight, track.timestamp || now - index * 60000);
        });
        likedTracks.forEach((track, index) =>
            // For tracks without addedAt, generate deterministic synthetic recency ordering.
            upsertTrack(track, LIKED_TRACK_WEIGHT, track.addedAt || now - index * LIKED_ACTIVITY_OFFSET)
        );
        playlists.forEach((playlist, playlistIndex) => {
            (playlist.tracks || []).forEach((track, trackIndex) => {
                upsertTrack(
                    track,
                    PLAYLIST_TRACK_WEIGHT,
                    track.addedAt || now - (playlistIndex + trackIndex) * PLAYLIST_ACTIVITY_OFFSET
                );
            });
        });

        const topArtists = getTopKeys(artistScores, TOP_SIGNAL_LIMIT);
        const topGenres = getTopKeys(genreScores, TOP_SIGNAL_LIMIT);
        const topMoods = getTopKeys(moodScores, TOP_SIGNAL_LIMIT);
        const hasSignals = poolMap.size > 0;

        const mixes = [];
        for (let index = 0; index < SMART_MIX_DEFINITIONS.length; index++) {
            const definition = SMART_MIX_DEFINITIONS[index];
            let tracks = [];
            let description = '';
            let subTitle = '';

            if (!hasSignals) {
                description = 'Play more music to generate this mix automatically.';
            } else if (definition.id.startsWith('smart-daily-mix-')) {
                const artistKey = pickSignal(topArtists, index);
                const genre = pickSignal(topGenres, index);
                const mood = pickSignal(topMoods, index);
                tracks = selectTracks({ artistKey, genre, mood, limit: 30, preferRecent: true });
                description = `Auto-mix based on your listening history${genre ? `, genre: ${genre}` : ''}${mood ? `, mood: ${mood}` : ''}.`;
                subTitle = `${tracks.length} tracks`;
            } else if (definition.id === 'smart-discover-weekly') {
                const seedTracks = selectTracks({ limit: 20, preferRecent: true });
                const knownTrackIds = new Set(Array.from(poolMap.keys()));
                let recommended = [];
                try {
                    recommended = await this.getRecommendedTracksForPlaylist(seedTracks, 40, {
                        knownTrackIds,
                        refresh: forceRefresh,
                    });
                } catch (error) {
                    console.warn('Failed to build Discover Weekly recommendations:', error);
                }
                const combined = [...recommended, ...selectTracks({ limit: 30, preferRecent: false })];
                const seen = new Set();
                tracks = [];
                for (const track of combined) {
                    if (!track?.id) continue;
                    const key = String(track.id);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    tracks.push(cleanTrack(track));
                    if (tracks.length >= 30) break;
                }
                description = 'Fresh recommendations generated from your favorite artists and listening habits.';
                subTitle = `${tracks.length} discovery tracks`;
            } else if (definition.id === 'smart-release-radar') {
                tracks = selectTracks({ limit: 60, preferRecent: false })
                    .sort((a, b) => parseReleaseDate(b) - parseReleaseDate(a))
                    .slice(0, 30);
                description = 'Latest releases prioritized from artists you listen to the most.';
                subTitle = `${tracks.length} recent tracks`;
            }

            const cover = tracks.find((track) => track?.album?.cover)?.album?.cover || '/assets/appicon.png';
            mixes.push({
                id: definition.id,
                title: definition.title,
                mixType: definition.mixType,
                subTitle,
                description,
                cover,
                tracks,
            });
        }

        this.smartMixCache = { key: cacheKey, mixes };
        return mixes;
    }

    async getArtistSocials(artistName) {
        const cacheKey = `artist_socials_${artistName}`;
        const cached = await this.cache.get('artist', cacheKey);
        if (cached) return cached;

        try {
            const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`;
            const searchRes = await fetch(searchUrl, {
                headers: { 'User-Agent': 'Monochrome/2.0.0 ( https://github.com/DaffaAgradhyasto/monochrome )' },
            });
            const searchData = await searchRes.json();

            if (!searchData.artists || searchData.artists.length === 0) return [];

            const artist = searchData.artists[0];
            const mbid = artist.id;

            const detailsUrl = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`;
            const detailsRes = await fetch(detailsUrl, {
                headers: { 'User-Agent': 'Monochrome/2.0.0 ( https://github.com/DaffaAgradhyasto/monochrome )' },
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

        const [primaryResponse, contentResponse] = await Promise.all([
            this.fetchWithRetry(`/artist/?id=${artistId}`),
            this.fetchWithRetry(`/artist/?f=${artistId}&skip_tracks=true`),
        ]);

        const primaryJsonData = await primaryResponse.json();

        // Unwrap data property if it exists, then unwrap artist property if it exists
        let primaryData = primaryJsonData.data || primaryJsonData;
        const rawArtist = primaryData.artist || (Array.isArray(primaryData) ? primaryData[0] : primaryData);

        if (!rawArtist) throw new Error('Primary artist details not found.');

        const artist = {
            ...this.prepareArtist(rawArtist),
            picture: rawArtist.picture || primaryData.cover || null,
            name: rawArtist.name || 'Unknown Artist',
        };

        const contentJsonData = await contentResponse.json();
        // Unwrap data property if it exists
        const contentData = contentJsonData.data || contentJsonData;
        const entries = Array.isArray(contentData) ? contentData : [contentData];

        const albumMap = new Map();
        const trackMap = new Map();
        const videoMap = new Map();

        const isTrack = (v) => v?.id && v.duration;
        const isAlbum = (v) => v?.id && 'numberOfTracks' in v;
        const isVideo = (v) => v?.id && v.type === 'VIDEO';

        const scan = (value, visited) => {
            if (!value || typeof value !== 'object' || visited.has(value)) return;
            visited.add(value);

            if (Array.isArray(value)) {
                value.forEach((item) => scan(item, visited));
                return;
            }

            const item = value.item || value;
            if (isAlbum(item)) albumMap.set(item.id, this.prepareAlbum(item));
            if (isTrack(item) && !isAlbum(item) && !isVideo(item)) {
                trackMap.set(item.id, this.prepareTrack(item));
            }
            if (isVideo(item)) videoMap.set(item.id, this.prepareVideo(item));

            Object.values(value).forEach((nested) => scan(nested, visited));
        };

        const visited = new Set();
        entries.forEach((entry) => scan(entry, visited));
        scan(primaryData, visited);

        if (!options.lightweight) {
            try {
                const videoSearch = await this.searchVideos(artist.name);
                if (videoSearch && videoSearch.items) {
                    const numericArtistId = Number(artistId);
                    for (const item of videoSearch.items) {
                        const itemArtistId = item.artist?.id;
                        const matchesArtist =
                            itemArtistId === numericArtistId ||
                            (Array.isArray(item.artists) && item.artists.some((a) => a.id === numericArtistId));

                        if (matchesArtist && !videoMap.has(item.id)) {
                            videoMap.set(item.id, item);
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch additional videos via search:', e);
            }
        }

        const rawReleases = Array.from(albumMap.values());
        const allReleases = this.deduplicateAlbums(rawReleases).sort(
            (a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0)
        );

        const eps = allReleases.filter((a) => a.type === 'EP' || a.type === 'SINGLE');
        const albums = allReleases.filter((a) => !eps.includes(a));

        const topTracks = Array.from(trackMap.values())
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 15);

        const videos = Array.from(videoMap.values()).sort(
            (a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0)
        );

        // Enrich tracks with album release dates
        const tracks = options.lightweight ? topTracks : await this.enrichTracksWithAlbumDates(topTracks);

        const result = { ...artist, albums, eps, tracks, videos };

        if (!(primaryResponse instanceof TidalResponse) && !(contentResponse instanceof TidalResponse)) {
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
            const url = `https://api.tidal.com/v1/artists/${artistId}/bio?locale=en_US&countryCode=GB`;
            const response = await fetch(url, {
                headers: {
                    'X-Tidal-Token': TIDAL_V2_TOKEN,
                },
            });

            if (response.ok) {
                const data = await response.json();
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
            if (track.artist && track.artist.id) {
                artistMap.set(track.artist.id, track.artist);
            }
            if (track.artists && Array.isArray(track.artists)) {
                for (const artist of track.artists) {
                    if (artist.id) {
                        artistMap.set(artist.id, artist);
                    }
                }
            }
        }

        if (artistMap.size < 3) {
            console.log('Not enough artists from stored data, trying search approach...');

            for (const track of tracks.slice(0, 5)) {
                try {
                    // Search for the track to get full metadata
                    const searchQuery = `"${track.title}" ${track.artist?.name || ''}`.trim();
                    const searchResult = await this.searchTracks(searchQuery, { signal: AbortSignal.timeout(5000) });

                    if (searchResult.items && searchResult.items.length > 0) {
                        const foundTrack = searchResult.items[0];
                        if (foundTrack.artist && foundTrack.artist.id) {
                            artistMap.set(foundTrack.artist.id, foundTrack.artist);
                        }
                        if (foundTrack.artists && Array.isArray(foundTrack.artists)) {
                            for (const artist of foundTrack.artists) {
                                if (artist.id) {
                                    artistMap.set(artist.id, artist);
                                }
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
                    recommendedTracks.push(t);
                }
            }
        });

        const shuffled = recommendedTracks.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, limit);
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

    async getTrack(id, quality = 'HI_RES_LOSSLESS') {
        const normalizedQuality = QUALITY_ALIASES[quality] || 'HI_RES_LOSSLESS';
        const cacheKey = `${id}_${normalizedQuality}`;
        const cached = await this.cache.get('track', cacheKey);
        if (cached) return cached;

        const response = await this.fetchWithRetry(`/track/?id=${id}&quality=${normalizedQuality}`, { type: 'streaming' });
        const jsonResponse = await response.json();
        const result = this.parseTrackLookup(this.normalizeTrackResponse(jsonResponse));

        if (!(response instanceof TidalResponse)) {
            await this.cache.set('track', cacheKey, result);
        }
        return result;
    }

    async getStreamUrl(id, quality = 'HI_RES_LOSSLESS') {
        const normalizedQuality = QUALITY_ALIASES[quality] || 'HI_RES_LOSSLESS';
        const cacheKey = `stream_${id}_${normalizedQuality}`;

        if (this.streamCache.has(cacheKey)) {
            return this.streamCache.get(cacheKey);
        }

        const lookup = await this.getTrack(id, normalizedQuality);

        let streamUrl;
        let manifestRgInfo = null;
        let isUsingManifestEndpoint = false;

        try {
            const manifestType = isIos || isSafari ? 'HLS' : 'MPEG_DASH';

            let canPlayAtmos = false;
            try {
                if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
                    canPlayAtmos =
                        MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"') ||
                        MediaSource.isTypeSupported('audio/mp4; codecs="eac3"');
                }
                if (!canPlayAtmos && typeof document !== 'undefined') {
                    const a = document.createElement('audio');
                    canPlayAtmos = !!(
                        a.canPlayType('audio/mp4; codecs="ec-3"') || a.canPlayType('audio/mp4; codecs="eac3"')
                    );
                }
            } catch (e) {}

            const paramsArray = [];

            if (quality === 'LOW') {
                paramsArray.push(['formats', 'HEAACV1']);
            } else if (quality === 'HIGH') {
                paramsArray.push(['formats', 'AACLC']);
            } else if (quality === 'LOSSLESS') {
                // For Safari to not auto-downgrade to AAC, we only request FLAC
                paramsArray.push(['formats', 'FLAC']);
            } else if (quality === 'HI_RES_LOSSLESS') {
                // FLAC_HIRES might fallback to FLAC by Tidal if unavailable, but we specify only HIRES and standard FLAC to avoid AAC downgrading
                paramsArray.push(['formats', 'FLAC_HIRES']);
                paramsArray.push(['formats', 'FLAC']);
            } else if (quality === 'DOLBY_ATMOS' && canPlayAtmos) {
                paramsArray.push(['formats', 'EAC3_JOC']);
            } else {
                // Default fallback or "auto" behavior
                paramsArray.push(['formats', 'HEAACV1']);
                paramsArray.push(['formats', 'AACLC']);
                paramsArray.push(['formats', 'FLAC']);
                paramsArray.push(['formats', 'FLAC_HIRES']);
                if (canPlayAtmos) {
                    paramsArray.push(['formats', 'EAC3_JOC']);
                }
            }

            paramsArray.push(
                ['adaptive', 'true'],
                ['manifestType', manifestType],
                ['uriScheme', 'HTTPS'],
                ['usage', 'PLAYBACK']
            );

            const params = new URLSearchParams(paramsArray);

            const response = await this.fetchWithRetry(`/trackManifests/?id=${id}&${params.toString()}`, {
                type: 'streaming',
                minVersion: '2.7',
            });
            const jsonResponse = await response.json();
            const url = jsonResponse?.data?.data?.attributes?.uri;
            if (url) {
                streamUrl = url;
                manifestRgInfo = {
                    trackReplayGain: jsonResponse?.data?.data?.attributes?.trackAudioNormalizationData?.replayGain,
                    trackPeakAmplitude:
                        jsonResponse?.data?.data?.attributes?.trackAudioNormalizationData?.peakAmplitude,
                    albumReplayGain: jsonResponse?.data?.data?.attributes?.albumAudioNormalizationData?.replayGain,
                    albumPeakAmplitude:
                        jsonResponse?.data?.data?.attributes?.albumAudioNormalizationData?.peakAmplitude,
                };
                isUsingManifestEndpoint = true;
            } else {
                throw new Error('No URI in trackManifests response');
            }
        } catch (err) {
            // Fallback to /track endpoint
        }

        if (!isUsingManifestEndpoint) {
            const lookup = await this.getTrack(id, quality);

            if (lookup.originalTrackUrl) {
                streamUrl = lookup.originalTrackUrl;
            } else {
                streamUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
                if (!streamUrl) {
                    throw new Error('Could not resolve stream URL');
                }
            }
            if (lookup.info) {
                manifestRgInfo = {
                    trackReplayGain: lookup.info.trackReplayGain || lookup.info.replayGain,
                    trackPeakAmplitude: lookup.info.trackPeakAmplitude || lookup.info.peakAmplitude,
                    albumReplayGain: lookup.info.albumReplayGain,
                    albumPeakAmplitude: lookup.info.albumPeakAmplitude,
                };
            }
        }

        const result = { url: streamUrl, rgInfo: manifestRgInfo };
        this.streamCache.set(cacheKey, result);

        return result;
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
     * @throws {MP3EncodingError|FfmpegError} If audio transcoding fails
     */
    async downloadTrack(id, quality = 'HI_RES_LOSSLESS', filename, options = {}) {
        // Load ffmpeg in the background.
        loadFfmpeg().catch(console.error);
        const metadataModule = await import('./metadata.js');
        const { prefetchMetadataObjects, addMetadataToAudio } = metadataModule;

        const { onProgress, track, calculateDashBytes = true } = options;
        const prefetchPromises = prefetchMetadataObjects(track, this);
        const isVideo = track?.type === 'video';

        try {
            // Custom FFMPEG formats are not native TIDAL qualities; download LOSSLESS and transcode
            const downloadQuality = isCustomFormat(quality) ? 'LOSSLESS' : quality;

            let lookup;
            if (isVideo) {
                lookup = await this.getVideo(id);
            } else {
                lookup = await this.getTrack(id, downloadQuality);
            }

            let streamUrl;
            let blob;

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

                streamUrl = this.extractStreamUrlFromManifest(manifest);
                if (!streamUrl) {
                    throw new Error('Could not resolve stream URL');
                }
            }

            // Handle DASH streams (blob URLs)
            if (streamUrl.startsWith('blob:')) {
                try {
                    const downloader = new DashDownloader();
                    blob = await downloader.downloadDashStream(streamUrl, {
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
                    blob = await downloader.downloadHlsStream(streamUrl, {
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

                const response = await fetch(streamUrl, {
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
                blob = await applyAudioPostProcessing(
                    blob,
                    quality,
                    onProgress,
                    options.signal,
                    track?.audioQuality ?? null
                );
            }

            // Add metadata if track information is provided
            if (track) {
                onProgress?.({
                    stage: 'processing',
                    message: 'Adding metadata...',
                });

                const enrichedTrack = { ...track };
                if (lookup.info) {
                    enrichedTrack.replayGain = {
                        trackReplayGain: lookup.info.trackReplayGain,
                        trackPeakAmplitude: lookup.info.trackPeakAmplitude,
                        albumReplayGain: lookup.info.albumReplayGain,
                        albumPeakAmplitude: lookup.info.albumPeakAmplitude,
                    };
                }

                if (track.album?.id && (track.album?.totalDiscs == null || track.album?.numberOfTracksOnDisc == null)) {
                    try {
                        const albumData = await this.getAlbum(track.album.id);
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
                            enrichedTrack.album = {
                                ...(enrichedTrack.album || {}),
                                totalDiscs: track.album?.totalDiscs ?? totalDiscs,
                                numberOfTracksOnDisc:
                                    track.album?.numberOfTracksOnDisc ?? discTrackCounts.get(discNumber),
                            };
                        }
                    } catch (e) {
                        console.warn('Failed to fetch album for disc info:', e);
                    }
                }

                onProgress?.(new DownloadProgress('Adding metadata'));
                try {
                    if (isVideo) {
                        blob = new File(
                            [await ffmpeg(blob, ['-c', 'copy'], 'output.mp4', 'video/mp4', onProgress, options.signal)],
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
            if (
                error instanceof MP3EncodingError ||
                error instanceof FfmpegError ||
                error.code === 'MP3_ENCODING_FAILED'
            ) {
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
