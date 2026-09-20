import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => {
    return {
        LosslessAPI: class {
            searchTracks = vi.fn().mockResolvedValue({ items: [] });
            searchVideos = vi.fn().mockResolvedValue({ items: [] });
            searchArtists = vi.fn().mockResolvedValue({ items: [] });
            searchAlbums = vi.fn().mockResolvedValue({ items: [] });
            searchPlaylists = vi.fn().mockResolvedValue({ items: [] });
            getStreamUrl = vi.fn().mockResolvedValue({ url: 'https://tidal.com/stream' });
            getAlbum = vi.fn().mockResolvedValue({ album: {}, tracks: [] });
            getArtist = vi.fn().mockResolvedValue({ name: 'Artist' });
            clearCache = vi.fn().mockResolvedValue();
        },
    };
});

// Provide localStorage polyfill for node test environment
if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    };
}

import { MusicAPI } from '../music-api.js';

describe('MusicAPI primary search and streaming integration', () => {
    let api;

    beforeEach(() => {
        // Create fresh instance with mock settings
        api = new MusicAPI({
            apiBaseUrl: 'https://api.tidal.com',
            apiToken: 'mock-token',
        });
    });

    it('uses tracksStreamerAPI as primary search', async () => {
        const mockTracksResult = {
            tracks: {
                items: [
                    {
                        id: 'tracks:track:101',
                        trackId: '101',
                        tracksTrackId: '101',
                        title: 'Song From Tracks Streamer',
                        artist: { name: 'Artist A' },
                        album: { releaseId: '201' },
                    },
                ],
                totalNumberOfItems: 1,
            },
            albums: { items: [], totalNumberOfItems: 0 },
            artists: { items: [], totalNumberOfItems: 0 },
            playlists: { items: [], totalNumberOfItems: 0 },
            videos: { items: [], totalNumberOfItems: 0 },
        };

        const searchSpy = vi.spyOn(api.tracksStreamerAPI, 'search').mockResolvedValueOnce(mockTracksResult);
        const appleSearchSpy = vi.spyOn(api.appleMusicSearchAPI, 'search');

        const results = await api.search('Song From Tracks Streamer');

        expect(searchSpy).toHaveBeenCalledWith('Song From Tracks Streamer', {});
        expect(appleSearchSpy).not.toHaveBeenCalled();
        expect(results.tracks.items[0].title).toBe('Song From Tracks Streamer');
    });

    it('falls back to Apple Music when tracksStreamerAPI search fails', async () => {
        vi.spyOn(api.tracksStreamerAPI, 'search').mockRejectedValueOnce(new Error('Network error'));
        const appleSearchSpy = vi.spyOn(api.appleMusicSearchAPI, 'search').mockResolvedValueOnce({
            results: {
                songs: {
                    data: [
                        {
                            id: '999',
                            type: 'songs',
                            attributes: { name: 'Apple Song', artistName: 'Apple Artist' },
                        },
                    ],
                },
            },
        });

        const results = await api.search('Apple Song');

        expect(appleSearchSpy).toHaveBeenCalled();
        expect(results.tracks.items.length).toBe(1);
        expect(results.tracks.items[0].title).toBe('Apple Song');
    });

    it('uses tracksStreamerAPI as primary streaming for any track', async () => {
        const resolveSpy = vi.spyOn(api.tracksStreamerAPI, 'resolveTrackStream').mockResolvedValueOnce({
            url: 'https://tracks.monochrome.st/track/101',
            sourceUrl: 'https://tracks.monochrome.st/track/101',
            provider: 'monochrome',
            quality: 'LOSSLESS',
            qualityDisplay: 'FLAC',
            playbackType: 'direct',
            mediaMimeType: 'audio/flac',
            lossless: true,
        });

        const tidalStreamSpy = vi.spyOn(api.tidalAPI, 'getStreamUrl');

        const streamInfo = await api.getStreamUrl('101', 'LOSSLESS', {
            track: { title: 'Some Song', artist: { name: 'Some Artist' } },
        });

        expect(resolveSpy).toHaveBeenCalled();
        expect(tidalStreamSpy).not.toHaveBeenCalled();
        expect(streamInfo.url).toBe('https://tracks.monochrome.st/track/101');
        expect(streamInfo.provider).toBe('monochrome');
    });

    it('fetches albums via tracksStreamerAPI when id has tracks prefix or provider', async () => {
        const mockAlbum = {
            album: {
                id: 'tracks:album:155142458219433984',
                releaseId: '155142458219433984',
                title: 'RAM',
            },
            tracks: [],
        };

        const getAlbumSpy = vi.spyOn(api.tracksStreamerAPI, 'getAlbum').mockResolvedValueOnce(mockAlbum);
        const result = await api.getAlbum('155142458219433984', 'tracks');

        expect(getAlbumSpy).toHaveBeenCalledWith('155142458219433984');
        expect(result.album.title).toBe('RAM');
    });

    it('fetches artists via tracksStreamerAPI when id has tracks provider', async () => {
        const mockArtist = {
            id: 'tracks:artist:153542153123926016',
            artistId: '153542153123926016',
            name: 'Daft Punk',
            tracks: [{ id: '1', title: 'One More Time' }],
        };

        const getArtistSpy = vi.spyOn(api.tracksStreamerAPI, 'getArtist').mockResolvedValueOnce(mockArtist);
        const result = await api.getArtist('153542153123926016', 'tracks');

        expect(getArtistSpy).toHaveBeenCalledWith('153542153123926016');
        expect(result.name).toBe('Daft Punk');
    });
});
