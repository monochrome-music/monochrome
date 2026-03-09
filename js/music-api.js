// js/music-api.js
// Unified API wrapper that supports both Tidal and Qobuz

import { LosslessAPI } from './api.js';
import { QobuzAPI } from './qobuz-api.js';
import { musicProviderSettings } from './storage.js';

export class MusicAPI {
    constructor(settings) {
        this.tidalAPI = new LosslessAPI(settings);
        this.qobuzAPI = new QobuzAPI();
        this._settings = settings;
        this.videoArtworkCache = new Map();
    }

    getCurrentProvider() {
        return musicProviderSettings.getProvider();
    }

    // Get the appropriate API based on provider
    getAPI(provider = null) {
        const p = provider || this.getCurrentProvider();
        return p === 'qobuz' ? this.qobuzAPI : this.tidalAPI;
    }

    // Search methods
    async searchTracks(query, options = {}) {
        const provider = options.provider || this.getCurrentProvider();
        return this.getAPI(provider).searchTracks(query, options);
    }

    async searchArtists(query, options = {}) {
        const provider = options.provider || this.getCurrentProvider();
        return this.getAPI(provider).searchArtists(query, options);
    }

    async searchAlbums(query, options = {}) {
        const provider = options.provider || this.getCurrentProvider();
        return this.getAPI(provider).searchAlbums(query, options);
    }

    async searchPlaylists(query, options = {}) {
        const provider = options.provider || this.getCurrentProvider();
        if (provider === 'qobuz') {
            // Qobuz doesn't support playlist search, return empty
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
        return this.tidalAPI.searchPlaylists(query, options);
    }

    async searchVideos(query, options = {}) {
        const provider = options.provider || this.getCurrentProvider();
        return this.tidalAPI.searchVideos(query, options);
    }

    // Get methods
    async getTrack(id, quality, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        return api.getTrack(cleanId, quality);
    }

    async getTrackMetadata(id, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        return api.getTrackMetadata(cleanId);
    }

    async getAlbum(id, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        return api.getAlbum(cleanId);
    }

    async getArtist(id, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        return api.getArtist(cleanId);
    }

    async getArtistBiography(id, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        if (p !== 'tidal') return null; // Biography only supported for Tidal

        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        if (typeof api.getArtistBiography === 'function') {
            return api.getArtistBiography(cleanId);
        }
        return null;
    }

    async getVideo(id, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        return api.getVideo(cleanId);
    }

    async getVideoStreamUrl(id, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        if (typeof api.getVideoStreamUrl === 'function') {
            return api.getVideoStreamUrl(cleanId);
        }
    }

    async getArtistSocials(artistName) {
        return this.tidalAPI.getArtistSocials(artistName);
    }

    async getPlaylist(id, _provider = null) {
        // Playlists are always Tidal for now
        return this.tidalAPI.getPlaylist(id);
    }

    async getMix(id, _provider = null) {
        // Mixes are always Tidal for now
        return this.tidalAPI.getMix(id);
    }

    async getTrackRecommendations(id) {
        const p = this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        if (typeof api.getTrackRecommendations === 'function') {
            return api.getTrackRecommendations(cleanId);
        }
        return [];
    }

    // Stream methods
    async getStreamUrl(id, quality, provider = null) {
        const p = provider || this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(p);
        const cleanId = this.stripProviderPrefix(id);
        return api.getStreamUrl(cleanId, quality);
    }

    // Cover/artwork methods
    getCoverUrl(id, size = '320') {
        if (typeof id === 'string' && id.startsWith('blob:')) {
            return id;
        }
        if (typeof id === 'string' && id.startsWith('q:')) {
            return this.qobuzAPI.getCoverUrl(id.slice(2), size);
        }
        return this.tidalAPI.getCoverUrl(id, size);
    }

    async getVideoArtwork(title, artist) {
        const cacheKey = `${title}-${artist}`.toLowerCase();
        if (this.videoArtworkCache.has(cacheKey)) {
            return this.videoArtworkCache.get(cacheKey);
        }

        try {
            const url = `https://artwork.boidu.dev/?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            const result = {
                videoUrl: data.videoUrl || null,
                hlsUrl: data.animated || null,
            };
            this.videoArtworkCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.warn('Failed to fetch video artwork:', error);
            return null;
        }
    }

    getArtistPictureUrl(id, size = '320') {
        if (typeof id === 'string' && id.startsWith('q:')) {
            return this.qobuzAPI.getArtistPictureUrl(id.slice(2), size);
        }
        return this.tidalAPI.getArtistPictureUrl(id, size);
    }

    extractStreamUrlFromManifest(manifest) {
        return this.tidalAPI.extractStreamUrlFromManifest(manifest);
    }

    // Helper methods
    getProviderFromId(id) {
        if (typeof id === 'string') {
            if (id.startsWith('q:')) return 'qobuz';
            if (id.startsWith('t:')) return 'tidal';
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

    // Download methods
    async downloadTrack(id, quality, filename, options = {}) {
        const provider = this.getProviderFromId(id) || this.getCurrentProvider();
        const api = this.getAPI(provider);
        const cleanId = this.stripProviderPrefix(id);
        return api.downloadTrack(cleanId, quality, filename, options);
    }

    // Similar/recommendation methods
    async getSimilarArtists(artistId) {
        const provider = this.getProviderFromId(artistId) || this.getCurrentProvider();
        const api = this.getAPI(provider);
        const cleanId = this.stripProviderPrefix(artistId);
        return api.getSimilarArtists(cleanId);
    }

    async getSimilarAlbums(albumId) {
        const provider = this.getProviderFromId(albumId) || this.getCurrentProvider();
        const api = this.getAPI(provider);
        const cleanId = this.stripProviderPrefix(albumId);
        return api.getSimilarAlbums(cleanId);
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 20, options = {}) {
        // Use Tidal for recommendations
        return this.tidalAPI.getRecommendedTracksForPlaylist(tracks, limit, options);
    }

    // Cache methods
    async clearCache() {
        await this.tidalAPI.clearCache();
        // Qobuz doesn't have cache yet
    }

    getCacheStats() {
        return this.tidalAPI.getCacheStats();
    }

    // Settings accessor for compatibility
    get settings() {
        return this._settings;
    }
}
