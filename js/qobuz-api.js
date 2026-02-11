// js/qobuz-api.js
// Qobuz API integration for Monochrome Music

const QOBUZ_API_BASE = 'https://qobuz.squid.wtf/api';

export class QobuzAPI {
    constructor() {
        this.baseUrl = QOBUZ_API_BASE;
    }

    async fetchWithRetry(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, { signal: options.signal });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Qobuz API request failed:', error);
            throw error;
        }
    }

    // Search tracks
    async searchTracks(query, options = {}) {
        try {
            const data = await this.fetchWithRetry(`/get-music?q=${encodeURIComponent(query)}`);

            if (!data.success || !data.data) {
                return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
            }

            // Transform Qobuz tracks to match Tidal format
            const tracks = (data.data.tracks?.items || []).map((track) => this.transformTrack(track));

            return {
                items: tracks,
                limit: data.data.tracks?.limit || tracks.length,
                offset: data.data.tracks?.offset || 0,
                totalNumberOfItems: data.data.tracks?.total || tracks.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Qobuz track search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    // Search albums
    async searchAlbums(query, options = {}) {
        try {
            const data = await this.fetchWithRetry(`/get-music?q=${encodeURIComponent(query)}`);

            if (!data.success || !data.data) {
                return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
            }

            // Transform Qobuz albums to match Tidal format
            const albums = (data.data.albums?.items || []).map((album) => this.transformAlbum(album));

            return {
                items: albums,
                limit: data.data.albums?.limit || albums.length,
                offset: data.data.albums?.offset || 0,
                totalNumberOfItems: data.data.albums?.total || albums.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Qobuz album search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    // Search artists
    async searchArtists(query, options = {}) {
        try {
            const data = await this.fetchWithRetry(`/get-music?q=${encodeURIComponent(query)}`);

            if (!data.success || !data.data) {
                return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
            }

            // Transform Qobuz artists to match Tidal format
            const artists = (data.data.artists?.items || []).map((artist) => this.transformArtist(artist));

            return {
                items: artists,
                limit: data.data.artists?.limit || artists.length,
                offset: data.data.artists?.offset || 0,
                totalNumberOfItems: data.data.artists?.total || artists.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Qobuz artist search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    // Get track details
    async getTrack(id) {
        try {
            // For Qobuz, we'll need to search or get from album
            // Since the API might not have a direct track endpoint
            const data = await this.fetchWithRetry(`/get-music?q=${encodeURIComponent(id)}`);

            if (!data.success || !data.data) {
                throw new Error('Track not found');
            }

            const track = data.data.tracks?.items?.find((t) => t.id === id || t.isrc === id);
            if (!track) {
                throw new Error('Track not found');
            }

            return this.transformTrack(track);
        } catch (error) {
            console.error('Qobuz getTrack failed:', error);
            throw error;
        }
    }

    // Get album details
    async getAlbum(id) {
        try {
            const data = await this.fetchWithRetry(`/get-album?album_id=${encodeURIComponent(id)}`);

            if (!data.success || !data.data) {
                throw new Error('Album not found');
            }

            const album = this.transformAlbum(data.data);
            const tracks = (data.data.tracks || []).map((track) => this.transformTrack(track, data.data));

            return { album, tracks };
        } catch (error) {
            console.error('Qobuz getAlbum failed:', error);
            throw error;
        }
    }

    // Get artist details
    async getArtist(id) {
        try {
            const data = await this.fetchWithRetry(`/get-artist?artist_id=${encodeURIComponent(id)}`);

            if (!data.success || !data.data) {
                throw new Error('Artist not found');
            }

            const artist = this.transformArtist(data.data);
            const albums = (data.data.albums || []).map((album) => this.transformAlbum(album));

            return { ...artist, albums, eps: [], tracks: [] };
        } catch (error) {
            console.error('Qobuz getArtist failed:', error);
            throw error;
        }
    }

    // Transform Qobuz track to Tidal-like format
    transformTrack(track, albumData = null) {
        return {
            id: `q:${track.id}`,
            title: track.title,
            duration: track.duration,
            artist: track.artist ? this.transformArtist(track.artist) : null,
            artists: track.artists ? track.artists.map((a) => this.transformArtist(a)) : [],
            album: albumData ? this.transformAlbum(albumData) : track.album ? this.transformAlbum(track.album) : null,
            audioQuality: this.mapQuality(track.streaming_quality),
            explicit: track.parental_warning || false,
            trackNumber: track.track_number,
            volumeNumber: track.media_number || 1,
            isrc: track.isrc,
            provider: 'qobuz',
            originalId: track.id,
        };
    }

    // Transform Qobuz album to Tidal-like format
    transformAlbum(album) {
        return {
            id: `q:${album.id}`,
            title: album.title,
            artist: album.artist ? this.transformArtist(album.artist) : null,
            artists: album.artists ? album.artists.map((a) => this.transformArtist(a)) : [],
            numberOfTracks: album.tracks_count || 0,
            releaseDate: album.release_date_original || album.release_date,
            cover: album.image?.large || album.image?.medium || album.image?.small,
            explicit: album.parental_warning || false,
            type: album.album_type === 'ep' ? 'EP' : album.album_type === 'single' ? 'SINGLE' : 'ALBUM',
            provider: 'qobuz',
            originalId: album.id,
        };
    }

    // Transform Qobuz artist to Tidal-like format
    transformArtist(artist) {
        return {
            id: `q:${artist.id}`,
            name: artist.name,
            picture: artist.image?.large || artist.image?.medium || artist.image?.small,
            provider: 'qobuz',
            originalId: artist.id,
        };
    }

    // Map Qobuz quality to Tidal quality format
    mapQuality(qobuzQuality) {
        const qualityMap = {
            MP3: 'HIGH',
            FLAC: 'LOSSLESS',
            HiRes: 'HI_RES_LOSSLESS',
        };
        return qualityMap[qobuzQuality] || 'LOSSLESS';
    }

    // Get cover URL
    getCoverUrl(coverId, size = '320') {
        if (!coverId) {
            return `https://picsum.photos/seed/${Math.random()}/${size}`;
        }

        // Qobuz cover URLs are usually full URLs
        if (typeof coverId === 'string' && coverId.startsWith('http')) {
            return coverId;
        }

        return coverId;
    }

    // Get stream URL for a track
    async getStreamUrl(trackId) {
        try {
            const cleanId = trackId.replace(/^q:/, '');
            const data = await this.fetchWithRetry(`/download-music?track_id=${encodeURIComponent(cleanId)}`);

            if (!data.success || !data.data?.url) {
                throw new Error('Stream URL not available');
            }

            return data.data.url;
        } catch (error) {
            console.error('Qobuz getStreamUrl failed:', error);
            throw error;
        }
    }
}

export const qobuzAPI = new QobuzAPI();
