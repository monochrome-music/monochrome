// js/music-api.js

import { LosslessAPI } from './api.js';
import { PodcastsAPI } from './podcasts-api.js';
import { musicProviderSettings } from './storage.js';
import {
    AppleMusicSearchAPI,
    clearStoredVideoCovers,
    normalizeAppleArtist,
    normalizeAppleSearchResults,
} from './apple-music-api.js';
import { getCommunityPlaylist } from './community-playlists.js';

/**
 * MusicAPI - Singleton class that provides a unified interface for accessing music streaming services.
 *
 * Supports multiple providers (primarily Tidal) and includes functionality for searching,
 * retrieving metadata, streaming, and managing playlists, artists, albums, tracks, and podcasts.
 *
 * @class MusicAPI
 * @classdesc Manages API interactions with music providers and provides caching mechanisms
 * for cover artwork and video metadata.
 *
 * @example
 * // Initialize the MusicAPI
 * await MusicAPI.initialize(settings);
 *
 * // Get the singleton instance
 * const api = MusicAPI.instance;
 *
 * // Search for tracks
 * const results = await api.search('query');
 *
 * // Get a specific track
 * const track = await api.getTrack('track-id');
 *
 * // Get stream URL
 * const streamUrl = await api.getStreamUrl('track-id', 'HIGH');
 *
 * @property {LosslessAPI} tidalAPI - The Tidal API instance
 * @property {PodcastsAPI} podcastsAPI - The Podcasts API instance
 * @property {Object} _settings - Configuration settings
 * @property {Map} videoArtworkCache - Cache for video artwork data
 *
 * @throws {Error} Throws if instance is accessed before initialization
 * @throws {Error} Throws if initialize is called more than once
 */
export class MusicAPI {
    static #instance = null;
    /**
     * @type {MusicAPI}
     */
    static get instance() {
        if (!MusicAPI.#instance) {
            throw new Error('MusicAPI not initialized. Call MusicAPI.initialize(settings) first.');
        }
        return MusicAPI.#instance;
    }

    /** @private */
    constructor(settings) {
        this.tidalAPI = new LosslessAPI(settings);
        this.appleMusicSearchAPI = new AppleMusicSearchAPI();
        this.podcastsAPI = new PodcastsAPI();
        this._settings = settings;
        this.videoArtworkCache = new Map();
        this.videoArtworkRequests = new Map();
        this.appleTrackCache = new Map();
        this.appleArtistCache = new Map();
        this.appleAlbumCache = new Map();
        this.applePlaylistCache = new Map();
        this.appleEntityRequests = new Map();
        this.appleArtistIds = new Set();
        this.appleAlbumIds = new Set();
        this.applePlaylistIds = new Set();
    }

    static async initialize(settings) {
        if (MusicAPI.#instance) {
            throw new Error('MusicAPI is already initialized');
        }

        const api = new MusicAPI(settings);
        return (MusicAPI.#instance = api);
    }

    getCurrentProvider() {
        return musicProviderSettings.getProvider();
    }

    // Get the appropriate API based on provider
    getAPI() {
        return this.tidalAPI;
    }

    // Search methods
    async search(query, options = {}) {
        const api = this.getAPI();
        let appleResults;
        try {
            appleResults = await this.appleMusicSearchAPI.search(query, options);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            if (import.meta.env.DEV) console.warn('[search] Apple Music unavailable, using current search', error);
            if (typeof api.search === 'function') return api.search(query, options);
            return this.searchWithCurrentProvider(query, options);
        }
        return this.cacheAppleResults(normalizeAppleSearchResults(appleResults));
    }

    async searchWithCurrentProvider(query, options = {}) {
        const api = this.getAPI();
        const [tracksResult, videosResult, artistsResult, albumsResult, playlistsResult] = await Promise.all([
            api.searchTracks(query, options),
            api.searchVideos ? api.searchVideos(query, options) : Promise.resolve({ items: [] }),
            api.searchArtists(query, options),
            api.searchAlbums(query, options),
            api.searchPlaylists ? api.searchPlaylists(query, options) : Promise.resolve({ items: [] }),
        ]);

        return {
            tracks: tracksResult,
            videos: videosResult,
            artists: artistsResult,
            albums: albumsResult,
            playlists: playlistsResult,
        };
    }

    async searchTracks(query, options = {}) {
        return this.searchSection('tracks', 'songs', query, options, () => this.getAPI().searchTracks(query, options));
    }

    async searchArtists(query, options = {}) {
        return this.searchSection('artists', 'artists', query, options, () =>
            this.getAPI().searchArtists(query, options)
        );
    }

    async searchAlbums(query, options = {}) {
        return this.searchSection('albums', 'albums', query, options, () => this.getAPI().searchAlbums(query, options));
    }

    async searchPlaylists(query, options = {}) {
        return this.searchSection('playlists', 'playlists', query, options, () =>
            this.tidalAPI.searchPlaylists(query, options)
        );
    }

    async searchVideos(query, options = {}) {
        return this.searchSection('videos', 'music-videos', query, options, () =>
            this.tidalAPI.searchVideos(query, options)
        );
    }

    async searchSuggestions(query, options = {}) {
        try {
            return await this.appleMusicSearchAPI.suggestions(query, options);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            if (import.meta.env.DEV) console.warn('[search] Apple Music suggestions unavailable', error);
            return [];
        }
    }

    async searchSection(section, appleType, query, options, currentSearch) {
        let appleResults;
        try {
            appleResults = await this.appleMusicSearchAPI.search(query, { ...options, types: [appleType] });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            if (import.meta.env.DEV) console.warn(`[search] Apple Music ${section} search unavailable`, error);
            return currentSearch();
        }

        const results = this.cacheAppleResults(normalizeAppleSearchResults(appleResults));
        return results[section];
    }

    async searchPodcasts(query, options = {}) {
        return this.podcastsAPI.searchPodcasts(query, options);
    }

    async getPodcast(id, options = {}) {
        return this.podcastsAPI.getPodcastById(id, options);
    }

    async getPodcastEpisodes(id, options = {}) {
        return this.podcastsAPI.getPodcastEpisodes(id, options);
    }

    async getTrendingPodcasts(options = {}) {
        return this.podcastsAPI.getTrendingPodcasts(options);
    }

    // Get methods
    async getTrack(id, quality) {
        if (this.isAppleId(id, 'track') || this.isAppleId(id, 'video') || this.isAppleId(id)) {
            const track = await this.getTrackMetadata(id);
            return { track, info: track, originalTrackUrl: null };
        }
        const appleTrack = this.getCachedAppleTrack(id);
        if (appleTrack) return { track: appleTrack, info: appleTrack, originalTrackUrl: null };
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        return api.getTrack(cleanId, quality);
    }

    async getTrackMetadata(id) {
        if (this.isAppleId(id, 'track') || this.isAppleId(id, 'video') || this.isAppleId(id)) {
            const cached = this.getCachedAppleTrack(id);
            if (cached) return cached;
            const appleTrack = await this.appleMusicSearchAPI.track(id);
            this.cacheAppleTracks([appleTrack]);
            return appleTrack;
        }
        const appleTrack = this.getCachedAppleTrack(id);
        if (appleTrack) return appleTrack;
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        return api.getTrackMetadata(cleanId);
    }

    async getAlbum(id, provider = null) {
        if (this.isAppleId(id, 'album', provider) || this.appleAlbumIds.has(String(id))) {
            const appleId = this.getAppleId(id, 'album');
            if (this.appleAlbumCache.has(String(appleId))) return this.appleAlbumCache.get(String(appleId));
            const requestKey = `album:${appleId}`;
            if (this.appleEntityRequests.has(requestKey)) return this.appleEntityRequests.get(requestKey);
            const request = this.appleMusicSearchAPI
                .album(appleId)
                .then((result) => {
                    this.appleAlbumIds.add(String(appleId));
                    this.appleAlbumCache.set(String(appleId), result);
                    this.cacheAppleTracks(result.tracks);
                    return result;
                })
                .finally(() => this.appleEntityRequests.delete(requestKey));
            this.appleEntityRequests.set(requestKey, request);
            return request;
        }
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        return api.getAlbum(cleanId);
    }

    async getArtist(id, provider = null) {
        if (this.isAppleId(id, 'artist', provider) || this.appleArtistIds.has(String(id))) {
            const appleId = this.getAppleId(id, 'artist');
            const cached = this.appleArtistCache.get(String(appleId));
            if (cached) return cached;
            const requestKey = `artist:${appleId}`;
            if (this.appleEntityRequests.has(requestKey)) return this.appleEntityRequests.get(requestKey);
            const request = this.appleMusicSearchAPI
                .artist(appleId)
                .then((artist) => {
                    this.appleArtistIds.add(String(appleId));
                    this.appleArtistCache.set(String(appleId), artist);
                    this.cacheAppleTracks([...artist.tracks, ...artist.videos]);
                    for (const album of [...artist.albums, ...artist.eps]) {
                        this.appleAlbumIds.add(String(album.appleMusicId));
                    }
                    return artist;
                })
                .finally(() => this.appleEntityRequests.delete(requestKey));
            this.appleEntityRequests.set(requestKey, request);
            return request;
        }
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        return api.getArtist(cleanId);
    }

    async getArtistBiography(id) {
        if (this.isAppleId(id, 'artist') || this.appleArtistIds.has(String(id))) {
            const artist = this.appleArtistCache.get(String(this.getAppleId(id, 'artist')));
            return artist?.biography || null;
        }
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        if (typeof api.getArtistBiography === 'function') {
            return api.getArtistBiography(cleanId);
        }
        return null;
    }

    async getVideo(id) {
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        return api.getVideo(cleanId);
    }

    async getVideoStreamUrl(id) {
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        if (typeof api.getVideoStreamUrl === 'function') {
            return api.getVideoStreamUrl(cleanId);
        }
    }

    async getArtistSocials(artistName) {
        return this.tidalAPI.getArtistSocials(artistName);
    }

    async getPlaylist(id, provider = null) {
        if (id?.startsWith('VL')) {
            return getCommunityPlaylist(id);
        }

        if (this.isAppleId(id, 'playlist', provider) || this.applePlaylistIds.has(String(id))) {
            const appleId = this.getAppleId(id, 'playlist');
            if (this.applePlaylistCache.has(String(appleId))) return this.applePlaylistCache.get(String(appleId));
            const requestKey = `playlist:${appleId}`;
            if (this.appleEntityRequests.has(requestKey)) return this.appleEntityRequests.get(requestKey);
            const request = this.appleMusicSearchAPI
                .playlist(appleId)
                .then((result) => {
                    this.applePlaylistIds.add(String(appleId));
                    this.applePlaylistCache.set(String(appleId), result);
                    this.cacheAppleTracks(result.tracks);
                    return result;
                })
                .finally(() => this.appleEntityRequests.delete(requestKey));
            this.appleEntityRequests.set(requestKey, request);
            return request;
        }

        return this.tidalAPI.getPlaylist(id);
    }

    async getMix(id) {
        // Mixes are always Tidal for now
        return this.tidalAPI.getMix(id);
    }

    async getTrackRecommendations(id) {
        if (this.getCachedAppleTrack(id)) return [];
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(id);
        if (typeof api.getTrackRecommendations === 'function') {
            return api.getTrackRecommendations(cleanId);
        }
        return [];
    }

    // Stream methods
    async getStreamUrl(id, quality, options = {}) {
        const api = this.getAPI();
        let appleTrack = options?.track || this.getCachedAppleTrack(id);
        if (!appleTrack && (this.isAppleId(id, 'track') || this.isAppleId(id, 'video') || this.isAppleId(id))) {
            appleTrack = await this.getTrackMetadata(id).catch(() => null);
        }
        if (appleTrack) return api.getStreamUrl(id, quality, { ...options, track: appleTrack });
        const cleanId = this.stripProviderPrefix(id);
        return api.getStreamUrl(cleanId, quality, options);
    }

    usesSingleUsePlaybackUrls() {
        return this.getAPI().usesSingleUsePlaybackUrls?.() === true;
    }

    clearMonochromePlaybackSession() {
        this.getAPI().clearMonochromePlaybackSession?.();
    }

    // Cover/artwork methods
    getCoverUrl(id, size = '320') {
        if (typeof id === 'string' && /^(?:https?:|blob:|data:)/.test(id)) {
            return id;
        }
        return this.tidalAPI.getCoverUrl(this.stripProviderPrefix(id), size);
    }

    getCoverSrcset(id) {
        if (typeof id === 'string' && id.startsWith('blob:')) {
            return '';
        }
        return this.tidalAPI.getCoverSrcset(this.stripProviderPrefix(id));
    }

    getVideoCoverUrl(imageId, size = '1280') {
        if (!imageId) {
            return null;
        }
        if (typeof imageId === 'string' && imageId.startsWith('blob:')) {
            return imageId;
        }
        return this.tidalAPI.getVideoCoverUrl(this.stripProviderPrefix(imageId), size);
    }

    async getVideoArtwork(title, artist) {
        const cacheKey = `${title}-${artist}`.toLowerCase();
        if (this.videoArtworkCache.has(cacheKey)) {
            const cached = this.videoArtworkCache.get(cacheKey);
            if (cached) return cached;
            this.videoArtworkCache.delete(cacheKey);
        }
        if (this.videoArtworkRequests.has(cacheKey)) return this.videoArtworkRequests.get(cacheKey);

        const request = (async () => {
            try {
                const cover = await this.appleMusicSearchAPI.videoCover(title, artist);
                const result = cover
                    ? { videoUrl: null, hlsUrl: cover.hlsUrl, previewFrameUrl: cover.previewFrameUrl }
                    : null;
                if (result) this.videoArtworkCache.set(cacheKey, result);
                return result;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                if (import.meta.env.DEV) console.warn('Failed to fetch Apple Music video artwork:', error);
                return null;
            } finally {
                this.videoArtworkRequests.delete(cacheKey);
            }
        })();
        this.videoArtworkRequests.set(cacheKey, request);
        return request;
    }

    getArtistPictureUrl(id, size = '320') {
        if (typeof id === 'string' && /^(?:https?:|blob:|data:)/.test(id)) return id;
        return this.tidalAPI.getArtistPictureUrl(this.stripProviderPrefix(id), size);
    }

    getArtistPictureSrcset(id) {
        return this.tidalAPI.getArtistPictureSrcset(this.stripProviderPrefix(id));
    }

    async getArtistBanner(artistName) {
        const cacheKey = `banner-${artistName}`.toLowerCase();
        if (this.videoArtworkCache.has(cacheKey)) {
            return this.videoArtworkCache.get(cacheKey);
        }

        try {
            const url = `https://artwork-boidu-dev.samidy.workers.dev/artist?a=${encodeURIComponent(artistName)}`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();

            let hlsUrl = null;
            if (data.animated) {
                if (typeof data.animated === 'string') {
                    hlsUrl = data.animated;
                } else if (typeof data.animated === 'object') {
                    hlsUrl = data.animated.hls || data.animated.url || data.animated.hlsUrl || data.animated.videoUrl;

                    if (!hlsUrl) {
                        for (const key in data.animated) {
                            if (typeof data.animated[key] === 'string' && data.animated[key].includes('.m3u8')) {
                                hlsUrl = data.animated[key];
                                break;
                            }
                        }
                    }
                }
            }

            const result = {
                hlsUrl: hlsUrl,
            };
            this.videoArtworkCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.warn('Failed to fetch artist banner:', error);
            return null;
        }
    }

    extractStreamUrlFromManifest(manifest) {
        return this.tidalAPI.extractStreamUrlFromManifest(manifest);
    }

    // Helper methods
    getProviderFromId(id) {
        if (typeof id === 'string') {
            if (id.startsWith('t:')) return 'tidal';
            if (id.startsWith('apple:')) return 'apple';
        }
        return null;
    }

    stripProviderPrefix(id) {
        if (typeof id === 'string') {
            if (id.startsWith('q:') || id.startsWith('t:')) {
                return id.slice(2);
            }
        }
        return id;
    }

    isAppleId(id, type = null, provider = null) {
        if (provider === 'apple') return true;
        return typeof id === 'string' && id.startsWith(type ? `apple:${type}:` : 'apple:');
    }

    getAppleId(id, type = null) {
        if (typeof id !== 'string') return id;
        const prefix = type ? `apple:${type}:` : 'apple:';
        return id.startsWith(prefix) ? id.slice(prefix.length) : id;
    }

    cacheAppleTracks(tracks = []) {
        for (const track of tracks) {
            if (track?.provider !== 'apple') continue;
            this.appleTrackCache.set(String(track.id), track);
            if (track.appleMusicId) this.appleTrackCache.set(String(track.appleMusicId), track);
            if (track.album?.appleMusicId) this.appleAlbumIds.add(String(track.album.appleMusicId));
            if (track.artist?.appleMusicId) this.appleArtistIds.add(String(track.artist.appleMusicId));
        }
        return tracks;
    }

    getCachedAppleTrack(id) {
        if (id == null) return null;
        return this.appleTrackCache.get(String(id)) || this.appleTrackCache.get(String(this.getAppleId(id, 'track')));
    }

    cacheAppleResults(results) {
        this.cacheAppleTracks([...(results.tracks?.items || []), ...(results.videos?.items || [])]);
        for (const album of results.albums?.items || []) this.appleAlbumIds.add(String(album.appleMusicId));
        for (const artist of results.artists?.items || []) this.appleArtistIds.add(String(artist.appleMusicId));
        for (const playlist of results.playlists?.items || []) this.applePlaylistIds.add(String(playlist.appleMusicId));
        return results;
    }

    // Download methods
    async downloadTrack(id, quality, filename, options = {}) {
        const api = this.getAPI();
        const appleTrack = this.getCachedAppleTrack(id);
        if (appleTrack) return api.downloadTrack(id, quality, filename, { ...options, track: appleTrack });
        const cleanId = this.stripProviderPrefix(id);
        return api.downloadTrack(cleanId, quality, filename, options);
    }

    // Similar/recommendation methods
    async getSimilarArtists(artistId) {
        if (this.isAppleId(artistId, 'artist') || this.appleArtistIds.has(String(artistId))) {
            const appleId = this.getAppleId(artistId, 'artist');
            const cached = this.appleArtistCache.get(String(appleId));
            if (cached) return cached.similar || [];
            return (await this.appleMusicSearchAPI.artistView(appleId, 'similar-artists')).map(normalizeAppleArtist);
        }
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(artistId);
        return api.getSimilarArtists(cleanId);
    }

    async getArtistTopTracks(artistId, options = {}) {
        if (this.isAppleId(artistId, 'artist') || this.appleArtistIds.has(String(artistId))) {
            const artist = await this.getArtist(this.getAppleId(artistId, 'artist'), 'apple');
            const offset = options.offset || 0;
            const limit = options.limit || 15;
            return {
                tracks: artist.tracks.slice(offset, offset + limit),
                offset,
                limit,
                hasMore: offset + limit < artist.tracks.length,
            };
        }
        return this.tidalAPI.getArtistTopTracks(artistId, options);
    }

    async getSimilarAlbums(albumId) {
        if (this.isAppleId(albumId, 'album') || this.appleAlbumIds.has(String(albumId))) {
            return this.appleMusicSearchAPI.relatedAlbums(this.getAppleId(albumId, 'album'));
        }
        const api = this.getAPI();
        const cleanId = this.stripProviderPrefix(albumId);
        return api.getSimilarAlbums(cleanId);
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, options = {}) {
        const appleSeeds = tracks.filter(
            (track) => track?.provider === 'apple' || this.isAppleId(track?.id) || this.getCachedAppleTrack(track?.id)
        );
        const tidalSeeds = tracks.filter((track) => !appleSeeds.includes(track));
        const canFallbackToTidal = tidalSeeds.length > 0;
        const [appleTracks, tidalTracks] = await Promise.all([
            appleSeeds.length
                ? this.appleMusicSearchAPI
                      .recommendedTracks(appleSeeds, limit, {
                          skipCache: options.skipCache || options.refresh,
                          retryOnRateLimit: !canFallbackToTidal,
                      })
                      .catch((error) => {
                          if (error.status === 429 && canFallbackToTidal) return [];
                          throw error;
                      })
                : [],
            tidalSeeds.length ? this.tidalAPI.getRecommendedTracksForPlaylist(tidalSeeds, limit, options) : [],
        ]);
        this.cacheAppleTracks(appleTracks);
        const excluded = new Set([
            ...tracks.map((track) => String(track.id)),
            ...Array.from(options.knownTrackIds || [], (id) => String(id)),
        ]);
        const combined = [];
        for (let index = 0; index < Math.max(appleTracks.length, tidalTracks.length); index += 1) {
            if (appleTracks[index]) combined.push(appleTracks[index]);
            if (tidalTracks[index]) combined.push(tidalTracks[index]);
        }
        const seen = new Set();
        return combined
            .filter((track) => {
                const id = String(track?.id || '');
                if (!id || excluded.has(id) || seen.has(id)) return false;
                seen.add(id);
                return true;
            })
            .slice(0, limit);
    }

    // Cache methods
    async clearCache() {
        await this.tidalAPI.clearCache();
        this.videoArtworkCache.clear();
        this.videoArtworkRequests.clear();
        clearStoredVideoCovers();
        this.appleTrackCache.clear();
        this.appleArtistCache.clear();
        this.appleAlbumCache.clear();
        this.applePlaylistCache.clear();
        this.appleEntityRequests.clear();
        this.appleMusicSearchAPI.suggestionCache.clear();
        this.appleMusicSearchAPI.viewCache.clear();
        this.appleMusicSearchAPI.viewRequests.clear();
    }

    getCacheStats() {
        return this.tidalAPI.getCacheStats();
    }

    // Settings accessor for compatibility
    get settings() {
        return this._settings;
    }
}

export const musicAPI = new MusicAPI();
