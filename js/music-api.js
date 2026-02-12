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

    async getPlaylist(id, provider = null) {
        // Playlists are always Tidal for now
        return this.tidalAPI.getPlaylist(id);
    }

    async getMix(id, provider = null) {
        // Mixes are always Tidal for now
        return this.tidalAPI.getMix(id);
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
        if (typeof id === 'string' && id.startsWith('q:')) {
            return this.qobuzAPI.getCoverUrl(id.slice(2), size);
        }
        return this.tidalAPI.getCoverUrl(id, size);
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

    async getRecommendedTracksForPlaylist(tracks, limit = 20) {
        // Use Tidal for recommendations
        return this.tidalAPI.getRecommendedTracksForPlaylist(tracks, limit);
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

    // Extract stream URL from manifest (Tidal only)
    extractStreamUrlFromManifest(manifest) {
        // This is only available for Tidal
        return this.tidalAPI.extractStreamUrlFromManifest(manifest);
    }
}
