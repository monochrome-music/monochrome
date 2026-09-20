// js/tracks-api.js

/**
 * API client and normalizers for Music API Proxy & Track Streamer (Rust port).
 * Public Host: https://tracks.monochrome.st
 */

export const TRACKS_API_BASE_URL = 'https://tracks.monochrome.st';

/**
 * Cleans and normalizes string for fuzzy title/artist matching.
 * @param {string} str
 * @returns {string}
 */
export function cleanString(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(feat|featuring|ft)\.?\s+.*$/i, '')
        .replace(/[\(\[\{].*?[\)\]\}]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/**
 * Normalizes a raw track from tracks.monochrome.st.
 * @param {Object} item
 * @returns {Object} Normalized track
 */
export function normalizeTracksTrack(item) {
    if (!item) return null;
    const trackId = String(item.trackId || item.id || '');
    const id = trackId;

    const artistId = item.artistIds?.[0] || item.artists?.[0]?.artistId || item.artists?.[0]?.id || '';
    const artistName =
        item.artistNames?.[0] || item.artists?.[0]?.name || item.artists?.[0]?.displayName || 'Unknown Artist';

    const primaryArtist = {
        id: artistId ? String(artistId) : '',
        artistId: artistId ? String(artistId) : '',
        tracksArtistId: artistId ? String(artistId) : '',
        name: artistName,
        avatar: item.artists?.[0]?.avatar || null,
        picture: item.artists?.[0]?.avatar || null,
        provider: 'tracks',
        _href: artistId ? `/artist/${artistId}` : '',
    };

    let artists = [];
    if (Array.isArray(item.artists) && item.artists.length > 0) {
        artists = item.artists.map((a) => {
            const aid = String(a.artistId || a.id || '');
            return {
                id: aid ? String(aid) : '',
                artistId: aid,
                tracksArtistId: aid,
                name: a.name || a.displayName || 'Unknown Artist',
                avatar: a.avatar || null,
                picture: a.avatar || null,
                provider: 'tracks',
                _href: aid ? `/artist/${aid}` : '',
            };
        });
    } else if (Array.isArray(item.artistIds) && item.artistIds.length > 0) {
        artists = item.artistIds.map((aid, idx) => ({
            id: String(aid),
            artistId: String(aid),
            tracksArtistId: String(aid),
            name: item.artistNames?.[idx] || 'Unknown Artist',
            provider: 'tracks',
            _href: `/artist/${aid}`,
        }));
    }
    if (artists.length === 0) {
        artists = [primaryArtist];
    }

    const releaseId = item.releaseId ? String(item.releaseId) : '';
    const artwork = item.artwork || item.cover || '';
    const albumTitle = item.albumTitle || item.releaseTitle || (item.release && item.release.title) || '';

    const album = {
        id: releaseId,
        releaseId,
        tracksReleaseId: releaseId,
        title: albumTitle,
        cover: artwork,
        releaseDate: item.releaseDate || '',
        _href: releaseId ? `/album/${releaseId}` : '',
    };

    const durationSeconds =
        item.duration != null
            ? item.duration > 1000
                ? Math.round(item.duration / 1000)
                : Math.round(item.duration)
            : 0;

    return {
        id,
        trackId,
        tracksTrackId: trackId,
        recordingId: item.recordingId ? String(item.recordingId) : null,
        provider: 'tracks',
        type: 'track',
        title: item.title || 'Unknown Title',
        duration: durationSeconds,
        explicit: Boolean(item.explicit),
        isrc: item.isrc || '',
        artist: primaryArtist,
        artists,
        album,
        cover: artwork,
        image: artwork,
        imageId: artwork,
        releaseDate: item.releaseDate || '',
        trackNumber: item.trackNumber || 1,
        volumeNumber: item.discNumber || 1,
        discNumber: item.discNumber || 1,
        isUnavailable: item.playable === false,
        audioModes: ['LOSSLESS', 'STEREO'],
        audioQuality: 'LOSSLESS',
        url: `${TRACKS_API_BASE_URL}/track/${trackId}`,
        _href: `/track/${trackId}`,
    };
}

/**
 * Normalizes a release/album from tracks.monochrome.st.
 * @param {Object} item
 * @returns {Object} Normalized album
 */
export function normalizeTracksRelease(item) {
    if (!item) return null;
    const releaseId = String(item.releaseId || item.id || '');
    const id = releaseId;

    const artistId = item.artistIds?.[0] || item.artists?.[0]?.artistId || item.artists?.[0]?.id || '';
    const artistName =
        item.artistNames?.[0] || item.artists?.[0]?.name || item.artists?.[0]?.displayName || 'Unknown Artist';

    const primaryArtist = {
        id: artistId ? String(artistId) : '',
        artistId: artistId ? String(artistId) : '',
        tracksArtistId: artistId ? String(artistId) : '',
        name: artistName,
        avatar: item.artists?.[0]?.avatar || null,
        provider: 'tracks',
        _href: artistId ? `/artist/${artistId}` : '',
    };

    const artists =
        Array.isArray(item.artists) && item.artists.length > 0
            ? item.artists.map((a) => {
                  const aid = String(a.artistId || a.id || '');
                  return {
                      id: aid ? String(aid) : '',
                      artistId: aid,
                      tracksArtistId: aid,
                      name: a.name || a.displayName || 'Unknown Artist',
                      avatar: a.avatar || null,
                      provider: 'tracks',
                      _href: aid ? `/artist/${aid}` : '',
                  };
              })
            : [primaryArtist];

    const artwork = item.artwork || item.cover || '';
    const trackCount = item.trackCount || (Array.isArray(item.tracks) ? item.tracks.length : 0);

    return {
        id,
        releaseId,
        tracksReleaseId: releaseId,
        provider: 'tracks',
        title: item.title || 'Unknown Album',
        artist: primaryArtist,
        artists,
        cover: artwork,
        image: artwork,
        imageId: artwork,
        explicit: Boolean(item.explicit),
        releaseDate: item.releaseDate || '',
        numberOfTracks: trackCount,
        trackCount,
        type: item.releaseType || 'ALBUM',
        label: item.label || '',
        copyright: item.copyrights?.[0]?.text || '',
        _href: `/album/${releaseId}`,
    };
}

/**
 * Normalizes an artist from tracks.monochrome.st.
 * @param {Object} item
 * @returns {Object} Normalized artist
 */
export function normalizeTracksArtist(item) {
    if (!item) return null;
    const artistId = String(item.artistId || item.id || '');
    const id = artistId;
    const picture = item.avatar || item.picture || null;
    const name = item.displayName || item.name || 'Unknown Artist';

    return {
        id,
        artistId,
        tracksArtistId: artistId,
        provider: 'tracks',
        name,
        displayName: name,
        username: item.username || '',
        picture,
        avatar: picture,
        banner: item.banner || null,
        biography: item.bio || item.biography || '',
        popularity: 0,
        artistRoles: [],
        _href: `/artist/${artistId}`,
    };
}

/**
 * Normalizes a playlist from tracks.monochrome.st.
 * @param {Object} item
 * @returns {Object} Normalized playlist
 */
export function normalizeTracksPlaylist(item) {
    if (!item) return null;
    const playlistId = String(item.playlistId || item.id || '');
    const id = playlistId;
    const image = typeof item.thumbnail === 'string' && item.thumbnail.startsWith('http') ? item.thumbnail : '';

    return {
        id,
        playlistId,
        tracksPlaylistId: playlistId,
        uuid: id,
        provider: 'tracks',
        title: item.title || 'Unknown Playlist',
        description: item.description || '',
        image,
        numberOfTracks: item.trackCount || 0,
        ownerName: item.ownerId || 'curator',
        _href: `/playlist/${playlistId}`,
    };
}

/**
 * Normalizes unified search results from tracks.monochrome.st.
 * @param {Object} response
 * @returns {Object} Standardized search results for UI consumption
 */
export function normalizeTracksSearchResults(response = {}) {
    const rawTracks = response.tracks || [];
    const rawReleases = response.releases || [];
    const rawArtists = response.artists || [];
    const rawPlaylists = response.playlists || [];

    return {
        tracks: {
            items: rawTracks.map(normalizeTracksTrack).filter(Boolean),
            limit: rawTracks.length,
            offset: 0,
            totalNumberOfItems: rawTracks.length,
        },
        albums: {
            items: rawReleases.map(normalizeTracksRelease).filter(Boolean),
            limit: rawReleases.length,
            offset: 0,
            totalNumberOfItems: rawReleases.length,
        },
        artists: {
            items: rawArtists.map(normalizeTracksArtist).filter(Boolean),
            limit: rawArtists.length,
            offset: 0,
            totalNumberOfItems: rawArtists.length,
        },
        playlists: {
            items: rawPlaylists.map(normalizeTracksPlaylist).filter(Boolean),
            limit: rawPlaylists.length,
            offset: 0,
            totalNumberOfItems: rawPlaylists.length,
        },
        videos: {
            items: [],
            limit: 0,
            offset: 0,
            totalNumberOfItems: 0,
        },
    };
}

/**
 * Extracts search suggestions from tracks search results.
 * @param {Object|Array} results
 * @param {string} query
 * @returns {Array} List of suggestion objects
 */
export function extractTracksSuggestions(results, query) {
    const suggestions = [];
    const seen = new Set();

    const normalizedQuery = (query || '').trim().toLowerCase();
    if (normalizedQuery) {
        suggestions.push({
            kind: 'term',
            searchTerm: query.trim(),
            displayTerm: query.trim(),
        });
        seen.add(normalizedQuery);
    }

    const rawTracks = Array.isArray(results) ? results : results?.tracks?.items || results?.tracks || [];

    for (const raw of rawTracks) {
        if (!raw) continue;
        const track = raw.tracksTrackId ? raw : normalizeTracksTrack(raw);
        if (!track || !track.title) continue;

        const key = `track:${track.tracksTrackId || track.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        suggestions.push({
            kind: 'song',
            searchTerm: track.title,
            displayTerm: track.title,
            subtitle: track.artist?.name || '',
            image: track.cover || '',
            track,
        });

        if (suggestions.length >= 8) break;
    }

    return suggestions;
}

/**
 * Scores a candidate track against a target track for playback streaming resolution.
 * @param {Object} candidate
 * @param {Object} target
 * @returns {number} Score (higher is better, 100+ is a strong match)
 */
export function scoreTrackCandidate(candidate, target) {
    if (!candidate || !target) return 0;

    // 1. Exact ISRC match is definitive
    const targetIsrc = (target.isrc || '').trim().toLowerCase();
    const candidateIsrc = (candidate.isrc || '').trim().toLowerCase();
    if (targetIsrc && candidateIsrc && targetIsrc === candidateIsrc) {
        return 200;
    }

    let score = 0;
    const targetTitleClean = cleanString(target.title);
    const candidateTitleClean = cleanString(candidate.title);

    if (targetTitleClean && candidateTitleClean) {
        if (targetTitleClean === candidateTitleClean) {
            score += 100;
        } else if (targetTitleClean.includes(candidateTitleClean) || candidateTitleClean.includes(targetTitleClean)) {
            score += 65;
        }
    }

    const targetArtistName = cleanString(target.artist?.name || target.artists?.[0]?.name || target.artist || '');
    const candidateArtistNames = (candidate.artistNames || [candidate.artist?.name || '']).map(cleanString);

    if (targetArtistName) {
        const hasArtistMatch = candidateArtistNames.some(
            (cName) =>
                cName === targetArtistName || cName.includes(targetArtistName) || targetArtistName.includes(cName)
        );
        if (hasArtistMatch) {
            score += 50;
        }
    }

    // Check duration similarity (within 6 seconds)
    const targetDur = target.duration > 1000 ? Math.round(target.duration / 1000) : Math.round(target.duration || 0);
    const candDur =
        candidate.duration > 1000 ? Math.round(candidate.duration / 1000) : Math.round(candidate.duration || 0);

    if (targetDur > 0 && candDur > 0) {
        const diff = Math.abs(targetDur - candDur);
        if (diff <= 3) score += 25;
        else if (diff <= 7) score += 10;
    }

    return score;
}

/**
 * TracksStreamerAPI - Client for the Rust Music API Proxy & Track Streamer.
 */
export class TracksStreamerAPI {
    constructor(baseUrl = TRACKS_API_BASE_URL) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.searchCache = new Map();
        this.trackCache = new Map();
        this.releaseCache = new Map();
        this.artistCache = new Map();
        this.resolutionCache = new Map();
        this.pendingRequests = new Map();
    }

    /**
     * Internal fetch with retries on transient errors (502, 503, 504).
     */
    async fetchWithRetry(url, options = {}, retries = 2) {
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        Accept: 'application/json',
                        ...(options.headers || {}),
                    },
                });

                if (
                    (response.status === 502 || response.status === 503 || response.status === 504) &&
                    attempt < retries
                ) {
                    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                    continue;
                }

                return response;
            } catch (err) {
                lastError = err;
                if (err.name === 'AbortError') throw err;
                if (attempt < retries) {
                    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
                    continue;
                }
            }
        }
        throw lastError || new Error(`Failed to fetch ${url}`);
    }

    /**
     * Unified search across tracks, releases, artists, and playlists.
     * Upstream: GET /search?q=:query
     */
    async search(query, options = {}) {
        const cleanQuery = (query || '').trim();
        if (!cleanQuery) {
            return normalizeTracksSearchResults({});
        }

        const cacheKey = `search:${cleanQuery.toLowerCase()}`;
        if (!options.skipCache && this.searchCache.has(cacheKey)) {
            return this.searchCache.get(cacheKey);
        }

        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey);
        }

        const request = (async () => {
            const url = `${this.baseUrl}/search?q=${encodeURIComponent(cleanQuery)}`;
            const response = await this.fetchWithRetry(url, { signal: options.signal });
            if (!response.ok) {
                throw new Error(`Search request failed with status: ${response.status}`);
            }

            const data = await response.json();
            const normalized = normalizeTracksSearchResults(data);

            // Index tracks, releases, and artists in local caches
            for (const track of normalized.tracks.items) {
                this.trackCache.set(String(track.tracksTrackId), track);
                this.trackCache.set(String(track.id), track);
            }
            for (const release of normalized.albums.items) {
                this.releaseCache.set(String(release.tracksReleaseId), release);
            }
            for (const artist of normalized.artists.items) {
                this.artistCache.set(String(artist.tracksArtistId), artist);
            }

            this.searchCache.set(cacheKey, normalized);
            if (this.searchCache.size > 100) {
                this.searchCache.delete(this.searchCache.keys().next().value);
            }
            return normalized;
        })();

        this.pendingRequests.set(cacheKey, request);
        try {
            return await request;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    /**
     * Track-specific search with optional limit.
     * Upstream: GET /search/tracks?q=:query&limit=:limit
     */
    async searchTracks(query, options = {}) {
        const cleanQuery = (query || '').trim();
        if (!cleanQuery) return { items: [] };

        const limit = options.limit || 20;
        const cacheKey = `tracks:${cleanQuery.toLowerCase()}:${limit}`;
        if (!options.skipCache && this.searchCache.has(cacheKey)) {
            return this.searchCache.get(cacheKey);
        }

        const url = `${this.baseUrl}/search/tracks?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`;
        const response = await this.fetchWithRetry(url, { signal: options.signal });
        if (!response.ok) {
            throw new Error(`Track search failed with status: ${response.status}`);
        }

        const data = await response.json();
        const rawTracks = data.tracks || [];
        const items = rawTracks.map(normalizeTracksTrack).filter(Boolean);

        for (const track of items) {
            this.trackCache.set(String(track.tracksTrackId), track);
            this.trackCache.set(String(track.id), track);
        }

        const result = {
            items,
            limit: items.length,
            offset: 0,
            totalNumberOfItems: items.length,
        };

        this.searchCache.set(cacheKey, result);
        return result;
    }

    /**
     * Release-specific search with optional limit.
     * Upstream: GET /search/releases?q=:query&limit=:limit
     */
    async searchAlbums(query, options = {}) {
        const cleanQuery = (query || '').trim();
        if (!cleanQuery) return { items: [] };

        const limit = options.limit || 20;
        const cacheKey = `releases:${cleanQuery.toLowerCase()}:${limit}`;
        if (!options.skipCache && this.searchCache.has(cacheKey)) {
            return this.searchCache.get(cacheKey);
        }

        const url = `${this.baseUrl}/search/releases?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`;
        const response = await this.fetchWithRetry(url, { signal: options.signal });
        if (!response.ok) {
            throw new Error(`Release search failed with status: ${response.status}`);
        }

        const data = await response.json();
        const rawReleases = data.releases || [];
        const items = rawReleases.map(normalizeTracksRelease).filter(Boolean);

        for (const release of items) {
            this.releaseCache.set(String(release.tracksReleaseId), release);
        }

        const result = {
            items,
            limit: items.length,
            offset: 0,
            totalNumberOfItems: items.length,
        };

        this.searchCache.set(cacheKey, result);
        return result;
    }

    /**
     * Artist-specific search with optional limit.
     * Upstream: GET /search/artists?q=:query&limit=:limit
     */
    async searchArtists(query, options = {}) {
        const cleanQuery = (query || '').trim();
        if (!cleanQuery) return { items: [] };

        const limit = options.limit || 20;
        const cacheKey = `artists:${cleanQuery.toLowerCase()}:${limit}`;
        if (!options.skipCache && this.searchCache.has(cacheKey)) {
            return this.searchCache.get(cacheKey);
        }

        const url = `${this.baseUrl}/search/artists?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`;
        const response = await this.fetchWithRetry(url, { signal: options.signal });
        if (!response.ok) {
            throw new Error(`Artist search failed with status: ${response.status}`);
        }

        const data = await response.json();
        const rawArtists = data.artists || [];
        const items = rawArtists.map(normalizeTracksArtist).filter(Boolean);

        for (const artist of items) {
            this.artistCache.set(String(artist.tracksArtistId), artist);
        }

        const result = {
            items,
            limit: items.length,
            offset: 0,
            totalNumberOfItems: items.length,
        };

        this.searchCache.set(cacheKey, result);
        return result;
    }

    /**
     * Search suggestions for search autocomplete dropdown.
     */
    async suggestions(query, options = {}) {
        const cleanQuery = (query || '').trim();
        if (!cleanQuery) return [];

        try {
            const results = await this.searchTracks(cleanQuery, {
                limit: options.limit || 8,
                signal: options.signal,
            });
            return extractTracksSuggestions(results.items, cleanQuery);
        } catch {
            return [
                {
                    kind: 'term',
                    searchTerm: cleanQuery,
                    displayTerm: cleanQuery,
                },
            ];
        }
    }

    /**
     * Fetches album/release information by ID.
     * Upstream: GET /releases/:id
     */
    async getAlbum(releaseId, options = {}) {
        const id = String(releaseId).replace(/^tracks:(?:album:)?/, '');
        if (this.releaseCache.has(id)) {
            const cached = this.releaseCache.get(id);
            if (cached.tracks && cached.album) return cached;
        }

        const requestKey = `release:${id}`;
        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }

        const request = (async () => {
            const url = `${this.baseUrl}/releases/${id}`;
            const response = await this.fetchWithRetry(url, { signal: options.signal });
            if (!response.ok) {
                throw new Error(`Album fetch failed with status: ${response.status}`);
            }

            const data = await response.json();
            const album = normalizeTracksRelease(data);

            const tracks = (data.tracks || []).map((t) => {
                return normalizeTracksTrack({
                    ...t,
                    releaseId: data.releaseId || id,
                    albumTitle: data.title,
                    releaseDate: data.releaseDate,
                    artwork: t.artwork || data.artwork,
                });
            });

            for (const track of tracks) {
                this.trackCache.set(String(track.tracksTrackId), track);
                this.trackCache.set(String(track.id), track);
            }

            const result = { album, tracks };
            this.releaseCache.set(id, result);
            return result;
        })();

        this.pendingRequests.set(requestKey, request);
        try {
            return await request;
        } finally {
            this.pendingRequests.delete(requestKey);
        }
    }

    /**
     * Fetches artist profile, discography, and biography.
     * Upstream: GET /artists/:id
     */
    async getArtist(artistId, options = {}) {
        const id = String(artistId).replace(/^tracks:(?:artist:)?/, '');
        if (this.artistCache.has(id)) {
            const cached = this.artistCache.get(id);
            if (cached.albums || cached.tracks) return cached;
        }

        const requestKey = `artist:${id}`;
        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }

        const request = (async () => {
            const url = `${this.baseUrl}/artists/${id}`;
            const response = await this.fetchWithRetry(url, { signal: options.signal });
            if (!response.ok) {
                throw new Error(`Artist fetch failed with status: ${response.status}`);
            }

            const data = await response.json();
            const artist = normalizeTracksArtist(data);

            const albums = (data.albums || []).map(normalizeTracksRelease).filter(Boolean);
            const eps = (data.singles || []).map(normalizeTracksRelease).filter(Boolean);
            const compilations = (data.compilations || []).map(normalizeTracksRelease).filter(Boolean);

            const rawTopTracks = data.topTracks || [];
            let topTracks = rawTopTracks.map(normalizeTracksTrack).filter(Boolean);

            // If topTracks was empty, extract up to 10 sample tracks from albums/singles
            if (topTracks.length === 0) {
                const sampleTracks = [];
                for (const rel of [...(data.albums || []), ...(data.singles || [])]) {
                    if (Array.isArray(rel.tracks)) {
                        for (const trk of rel.tracks) {
                            sampleTracks.push(
                                normalizeTracksTrack({
                                    ...trk,
                                    releaseId: rel.releaseId,
                                    albumTitle: rel.title,
                                    artwork: trk.artwork || rel.artwork,
                                })
                            );
                            if (sampleTracks.length >= 10) break;
                        }
                    }
                    if (sampleTracks.length >= 10) break;
                }
                topTracks = sampleTracks;
            }

            for (const track of topTracks) {
                this.trackCache.set(String(track.tracksTrackId), track);
                this.trackCache.set(String(track.id), track);
            }

            const fullArtist = {
                ...artist,
                tracks: topTracks,
                albums,
                eps,
                singles: eps,
                compilations,
                similar: [],
            };

            this.artistCache.set(id, fullArtist);
            return fullArtist;
        })();

        this.pendingRequests.set(requestKey, request);
        try {
            return await request;
        } finally {
            this.pendingRequests.delete(requestKey);
        }
    }

    /**
     * Returns direct streaming information for a track on tracks.monochrome.st.
     * @param {string} trackIdOrRecordingId
     * @param {string} quality
     * @param {Object} options
     * @returns {Object} Stream info object
     */
    getStreamUrl(trackIdOrRecordingId, quality = 'LOSSLESS', options = {}) {
        const rawId = String(trackIdOrRecordingId || '').replace(/^tracks:(?:track:)?/, '');
        const streamUrl = `${this.baseUrl}/track/${rawId}`;

        return {
            url: streamUrl,
            sourceUrl: streamUrl,
            provider: 'monochrome',
            quality: 'LOSSLESS',
            qualityRequested: quality,
            qualityDisplay: 'FLAC',
            codec: 'flac',
            mediaMimeType: 'audio/flac',
            playbackType: 'direct',
            lossless: true,
            rgInfo: options?.track?.rgInfo || null,
            waveform: null,
        };
    }

    /**
     * Resolves a track stream from tracks.monochrome.st.
     * If the track is native to tracks.monochrome.st, returns immediate stream URL.
     * If external, searches by title+artist/ISRC on tracks.monochrome.st and resolves the highest quality FLAC stream.
     *
     * @param {string|Object} idOrTrack
     * @param {string} quality
     * @param {Object} options
     * @returns {Promise<Object|null>} Stream info or null if unresolved
     */
    async resolveTrackStream(idOrTrack, quality = 'LOSSLESS', options = {}) {
        const inputTrack = options.track || (typeof idOrTrack === 'object' ? idOrTrack : null);
        const id = typeof idOrTrack === 'string' ? idOrTrack : String(inputTrack?.id || '');

        // 1. Direct match: Already a tracks.monochrome.st track
        if (inputTrack?.tracksTrackId || inputTrack?.recordingId) {
            const trackId = inputTrack.tracksTrackId || inputTrack.recordingId;
            return this.getStreamUrl(trackId, quality, { track: inputTrack });
        }

        if (id.startsWith('tracks:') || id.startsWith('mono:')) {
            const cleanId = id.replace(/^(?:tracks|mono):(?:track:)?/, '');
            return this.getStreamUrl(cleanId, quality, { track: inputTrack });
        }

        // Check if id is a 17-20 digit numeric snowflake (Rythm/Coda ID)
        if (/^\d{17,20}$/.test(id)) {
            return this.getStreamUrl(id, quality, { track: inputTrack });
        }

        // 2. Check resolution cache
        const resKey = `${inputTrack?.artist?.name || ''}::${inputTrack?.title || ''}::${inputTrack?.isrc || ''}::${id}`;
        if (this.resolutionCache.has(resKey)) {
            const cachedTrackId = this.resolutionCache.get(resKey);
            if (cachedTrackId) {
                return this.getStreamUrl(cachedTrackId, quality, { track: inputTrack });
            }
        }

        // 3. Resolve external track by metadata
        const title = inputTrack?.title;
        const artist =
            inputTrack?.artist?.name ||
            inputTrack?.artists?.[0]?.name ||
            (typeof inputTrack?.artist === 'string' ? inputTrack.artist : '');

        if (!title) return null;

        const searchQuery = `${artist} ${title}`.trim();
        if (!searchQuery) return null;

        try {
            const searchResult = await this.searchTracks(searchQuery, { limit: 6 });
            const candidates = searchResult.items || [];
            if (candidates.length === 0) {
                this.resolutionCache.set(resKey, null);
                return null;
            }

            let bestCandidate = null;
            let bestScore = 0;

            for (const candidate of candidates) {
                const score = scoreTrackCandidate(candidate, inputTrack);
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = candidate;
                }
            }

            // Require minimum match threshold (85) or exact ISRC (200)
            if (bestCandidate && bestScore >= 85) {
                const resolvedTrackId = bestCandidate.tracksTrackId || bestCandidate.trackId;
                this.resolutionCache.set(resKey, resolvedTrackId);
                if (inputTrack) {
                    inputTrack.tracksTrackId = resolvedTrackId;
                }
                return this.getStreamUrl(resolvedTrackId, quality, { track: inputTrack || bestCandidate });
            }

            this.resolutionCache.set(resKey, null);
            return null;
        } catch (error) {
            console.warn('[TracksStreamerAPI] Failed to resolve track stream:', error);
            return null;
        }
    }

    /**
     * Clears in-memory caches.
     */
    clearCache() {
        this.searchCache.clear();
        this.trackCache.clear();
        this.releaseCache.clear();
        this.artistCache.clear();
        this.resolutionCache.clear();
        this.pendingRequests.clear();
    }
}

export const tracksStreamerAPI = new TracksStreamerAPI();
