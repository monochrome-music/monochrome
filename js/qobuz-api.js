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
            const offset = options.offset || 0;
            const limit = options.limit || 10;
            const data = await this.fetchWithRetry(
                `/get-music?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
            );

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
            const offset = options.offset || 0;
            const limit = options.limit || 10;
            const data = await this.fetchWithRetry(
                `/get-music?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
            );

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
            const offset = options.offset || 0;
            const limit = options.limit || 10;
            const data = await this.fetchWithRetry(
                `/get-music?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
            );

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
    async getTrack(_id) {
        // Qobuz doesn't have a direct track endpoint
        // Track metadata comes from search/album endpoints
        // For playback, use getStreamUrl directly
        throw new Error('Qobuz getTrack not implemented - use getStreamUrl for playback');
    }

    // Get album details
    async getAlbum(id) {
        try {
            const data = await this.fetchWithRetry(`/get-album?album_id=${encodeURIComponent(id)}`);

            if (!data.success || !data.data) {
                throw new Error('Album not found');
            }

            const album = this.transformAlbum(data.data);
            const tracks = (data.data.tracks?.items || []).map((track) => this.transformTrack(track, data.data));

            return { album, tracks };
        } catch (error) {
            console.error('Qobuz getAlbum failed:', error);
            throw error;
        }
    }

    // Get artist details
    async getArtist(id) {
        try {
            const artistData = await this.fetchWithRetry(`/get-artist?artist_id=${encodeURIComponent(id)}`);

            if (!artistData.success || !artistData.data) {
                throw new Error('Artist not found');
            }

            // Qobuz get-artist returns { artist: {...} } nested structure
            const artistInfo = artistData.data.artist || artistData.data;
            if (!artistInfo) {
                throw new Error('Artist info not found in response');
            }
            const artist = this.transformArtist(artistInfo);

            // Get albums from the releases section
            let albums = [];
            let eps = [];
            if (Array.isArray(artistData.data.releases)) {
                // Find album releases
                const albumReleases = artistData.data.releases.find((r) => r.type === 'album');
                if (albumReleases?.items) {
                    albums = albumReleases.items.map((album) => this.transformAlbum(album));
                }
                // Find EP/single releases
                const epReleases = artistData.data.releases.find((r) => r.type === 'epSingle');
                if (epReleases?.items) {
                    eps = epReleases.items.map((album) => this.transformAlbum(album));
                }
            }

            // Get top tracks
            let tracks = [];
            if (Array.isArray(artistData.data.top_tracks)) {
                tracks = artistData.data.top_tracks.map((track) => this.transformTrack(track));
            }

            return { ...artist, albums, eps, tracks };
        } catch (error) {
            console.error('Qobuz getArtist failed:', error);
            throw error;
        }
    }

    // Transform Qobuz track to Tidal-like format
    transformTrack(track, albumData = null) {
        // Qobuz uses 'performer' for the main artist, not 'artist'
        const mainArtist = track.performer || track.artist;
        const artistsList = track.artists || (mainArtist ? [mainArtist] : []);

        return {
            id: `q:${track.id}`,
            title: track.title,
            duration: track.duration,
            artist: mainArtist ? this.transformArtist(mainArtist) : null,
            artists: artistsList.map((a) => this.transformArtist(a)),
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
        // Qobuz albums have artist (single) or artists (array)
        const mainArtist = album.artist || album.artists?.[0];
        return {
            id: `q:${album.id}`,
            title: album.title,
            artist: mainArtist ? this.transformArtist(mainArtist) : null,
            artists: album.artists
                ? album.artists.map((a) => this.transformArtist(a))
                : mainArtist
                  ? [this.transformArtist(mainArtist)]
                  : [],
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
        if (!artist) {
            return {
                id: 'q:unknown',
                name: 'Unknown Artist',
                picture: null,
                provider: 'qobuz',
                originalId: null,
            };
        }
        // Handle different name structures: string or { display: string }
        const name = typeof artist.name === 'string' ? artist.name : artist.name?.display || 'Unknown Artist';
        // Handle different image structures: image object or picture string or images.portrait
        const picture =
            artist.image?.large ||
            artist.image?.medium ||
            artist.image?.small ||
            artist.picture ||
            (artist.images?.portrait
                ? `https://static.qobuz.com/images/artists/covers/large/${artist.images.portrait.hash}.${artist.images.portrait.format}`
                : null);
        return {
            id: `q:${artist.id}`,
            name: name,
            picture: picture,
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

    // Get artist picture URL
    getArtistPictureUrl(pictureUrl, size = '320') {
        if (!pictureUrl) {
            return `https://picsum.photos/seed/${Math.random()}/${size}`;
        }

        // Qobuz picture URLs are usually full URLs
        if (typeof pictureUrl === 'string' && pictureUrl.startsWith('http')) {
            return pictureUrl;
        }

        return pictureUrl;
    }

    // Get stream URL for a track
    async getStreamUrl(trackId, quality = '27') {
        try {
            const cleanId = trackId.replace(/^q:/, '');
            // Map Tidal quality format to Qobuz quality values
            // Qobuz: 27=MP3 320kbps, 7=FLAC lossless, 6=HiRes 96/24, 5=HiRes 192/24
            const qualityMap = {
                LOW: '27',
                HIGH: '27',
                LOSSLESS: '7',
                HI_RES: '6',
                HI_RES_LOSSLESS: '5',
            };
            const qobuzQuality = qualityMap[quality] || quality || '27';
            const data = await this.fetchWithRetry(
                `/download-music?track_id=${encodeURIComponent(cleanId)}&quality=${qobuzQuality}`
            );

            if (!data.success || !data.data?.url) {
                throw new Error('Stream URL not available');
            }

            return data.data.url;
        } catch (error) {
            console.error('Qobuz getStreamUrl failed:', error);
            throw error;
        }
    }

    // Unified search - search all types at once
    async search(query, options = {}) {
        const offset = options.offset || 0;
        const limit = options.limit || 10;

        try {
            const data = await this.fetchWithRetry(
                `/get-music?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
            );

            if (!data.success || !data.data) {
                return {
                    tracks: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
                    albums: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
                    artists: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
                };
            }

            const tracks = (data.data.tracks?.items || []).map((track) => this.transformTrack(track));
            const albums = (data.data.albums?.items || []).map((album) => this.transformAlbum(album));
            const artists = (data.data.artists?.items || []).map((artist) => this.transformArtist(artist));

            return {
                tracks: {
                    items: tracks,
                    limit: data.data.tracks?.limit || tracks.length,
                    offset: data.data.tracks?.offset || 0,
                    totalNumberOfItems: data.data.tracks?.total || tracks.length,
                },
                albums: {
                    items: albums,
                    limit: data.data.albums?.limit || albums.length,
                    offset: data.data.albums?.offset || 0,
                    totalNumberOfItems: data.data.albums?.total || albums.length,
                },
                artists: {
                    items: artists,
                    limit: data.data.artists?.limit || artists.length,
                    offset: data.data.artists?.offset || 0,
                    totalNumberOfItems: data.data.artists?.total || artists.length,
                },
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Qobuz search failed:', error);
            return {
                tracks: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
                albums: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
                artists: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
            };
        }
    }

    // Get next page helper
    getNextPage(currentOffset, limit, total) {
        const nextOffset = currentOffset + limit;
        return nextOffset < total ? nextOffset : null;
    }

    // Get previous page helper
    getPreviousPage(currentOffset, limit) {
        const prevOffset = currentOffset - limit;
        return prevOffset >= 0 ? prevOffset : null;
    }
}

export const qobuzAPI = new QobuzAPI();
