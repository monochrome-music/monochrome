import { describe, expect, test, vi } from 'vitest';
import {
    AppleMusicSearchAPI,
    appleFetchWithRateLimitRetry,
    clearStoredVideoCovers,
    decodeJwtExpiration,
    buildAppleRequestHeaders,
    extractSearchSuggestions,
    extractVideoCovers,
    normalizeAppleSearchResults,
    rankSearchResults,
    rankSearchSection,
    resolveStorefront,
    selectVideoCover,
} from './apple-music-api.js';

describe('Apple Music search ranking', () => {
    test('uses Apple Music song order while preserving playable result objects', () => {
        const first = { id: 1, title: 'First', isrc: 'AAA', artist: { name: 'Artist' } };
        const second = { id: 2, title: 'Second', isrc: 'BBB', artist: { name: 'Artist' } };
        const section = { items: [first, second], totalNumberOfItems: 2 };
        const appleSongs = [
            { attributes: { name: 'Second', artistName: 'Artist', isrc: 'BBB' } },
            { attributes: { name: 'First', artistName: 'Artist', isrc: 'AAA' } },
        ];

        const result = rankSearchSection('tracks', section, appleSongs);

        expect(result.items).toEqual([second, first]);
        expect(result.items[0]).toBe(second);
        expect(result.totalNumberOfItems).toBe(2);
    });

    test('ranks each unified result section and leaves unmatched items in current order', () => {
        const current = {
            tracks: { items: [] },
            albums: {
                items: [
                    { id: 10, title: 'Other', artist: { name: 'Someone' } },
                    { id: 11, title: 'Wanted', artist: { name: 'Singer' }, upc: '123' },
                ],
            },
            artists: {
                items: [
                    { id: 20, name: 'Beta' },
                    { id: 21, name: 'Alpha' },
                ],
            },
        };
        const apple = {
            results: {
                albums: { data: [{ attributes: { name: 'Wanted', artistName: 'Singer', upc: '123' } }] },
                artists: { data: [{ attributes: { name: 'Alpha' } }] },
            },
        };

        const result = rankSearchResults(current, apple);

        expect(result.albums.items.map((item) => item.id)).toEqual([11, 10]);
        expect(result.artists.items.map((item) => item.id)).toEqual([21, 20]);
    });

    test('extracts unique term suggestions for autocomplete', () => {
        const result = extractSearchSuggestions({
            results: {
                suggestions: [
                    { kind: 'terms', searchTerm: 'beach bunny', displayTerm: 'Beach Bunny' },
                    { kind: 'terms', searchTerm: 'beach bunny', displayTerm: 'Beach Bunny' },
                    { kind: 'topResults', searchTerm: 'ignored' },
                    { kind: 'terms', searchTerm: 'cloud 9 beach bunny' },
                ],
            },
        });

        expect(result).toEqual([
            { kind: 'term', searchTerm: 'beach bunny', displayTerm: 'Beach Bunny' },
            { kind: 'term', searchTerm: 'cloud 9 beach bunny', displayTerm: 'cloud 9 beach bunny' },
        ]);
    });

    test('hydrates song suggestions and carries Apple lyric snippets', () => {
        const result = extractSearchSuggestions({
            results: {
                suggestions: [
                    {
                        kind: 'topResults',
                        content: {
                            id: '1440841384',
                            type: 'songs',
                            meta: { snippets: [{ kind: 'lyric', text: '<mark>Baby, I like your style</mark>' }] },
                        },
                    },
                ],
            },
            resources: {
                songs: {
                    1440841384: {
                        id: '1440841384',
                        type: 'songs',
                        attributes: {
                            name: 'One Dance (feat. Wizkid & Kyla)',
                            artistName: 'Drake',
                            artwork: { url: 'https://example.com/{w}x{h}.{f}' },
                        },
                    },
                },
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            kind: 'song',
            displayTerm: 'One Dance (feat. Wizkid & Kyla)',
            subtitle: 'Drake',
            image: 'https://example.com/80x80.jpg',
            lyricSnippet: 'Baby, I like your style',
        });
        expect(result[0].track.id).toBe('apple:track:1440841384');
    });

    test('prefers a square editorial video cover', () => {
        const tall = { kind: 'motionDetailTall', aspectRatio: '3:4', hlsUrl: 'tall.m3u8' };
        const square = { kind: 'motionDetailSquare', aspectRatio: '1:1', hlsUrl: 'square.m3u8' };

        expect(selectVideoCover([tall, square])).toBe(square);
        expect(selectVideoCover([])).toBeNull();
    });

    test('extracts and deduplicates editorial video covers', () => {
        const covers = extractVideoCovers({
            attributes: {
                editorialVideo: {
                    motionDetailSquare: {
                        video: 'https://example.com/square.m3u8',
                        previewFrame: { width: 1000, height: 1000 },
                    },
                    duplicate: { video: 'https://example.com/square.m3u8' },
                    motionDetailTall: {
                        video: { url: 'https://example.com/tall.m3u8' },
                        previewFrame: { width: 900, height: 1200 },
                    },
                },
            },
        });

        expect(covers.map((cover) => [cover.kind, cover.aspectRatio])).toEqual([
            ['motionDetailSquare', '1:1'],
            ['motionDetailTall', '3:4'],
        ]);
    });

    test('reads the expiry from a JWT', () => {
        const payload = btoa(JSON.stringify({ exp: 1_900_000_000 }))
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');

        expect(decodeJwtExpiration(`header.${payload}.signature`)).toBe(1_900_000_000_000);
    });

    test('ignores numeric iTunes storefront identifiers in catalog URLs', () => {
        expect(resolveStorefront('gb', '143478-2,31')).toBe('gb');
        expect(resolveStorefront(null, '143478-2,31')).toMatch(/^[a-z]{2}$/);
    });

    test('normalizes successful Apple catalog results without replacing their order', () => {
        const result = normalizeAppleSearchResults({
            results: {
                songs: {
                    data: [
                        {
                            id: '1874125269',
                            attributes: {
                                name: 'Dracula (with JENNIE)',
                                artistName: 'Tame Impala',
                                albumName: 'Dracula (with JENNIE) - Single',
                                durationInMillis: 200500,
                                isrc: 'USQX92600464',
                                artwork: { url: 'https://example.com/{w}x{h}.jpg' },
                            },
                        },
                        {
                            id: '1836226730',
                            attributes: { name: 'Dracula', artistName: 'Tame Impala' },
                        },
                    ],
                },
                albums: {
                    data: [
                        {
                            id: '1842444456',
                            attributes: { name: 'Dracula - Single', artistName: 'Tame Impala', trackCount: 1 },
                        },
                    ],
                },
            },
        });

        expect(result.tracks.items.map((track) => track.title)).toEqual(['Dracula (with JENNIE)', 'Dracula']);
        expect(result.tracks.items[0]).toMatchObject({
            id: 'apple:track:1874125269',
            provider: 'apple',
            isrc: 'USQX92600464',
            duration: 201,
        });
        expect(result.tracks.items[0].cover).toBe('https://example.com/640x640.jpg');
        expect(result.albums.items[0]).toMatchObject({
            id: 'apple:album:1842444456',
            title: 'Dracula - Single',
            provider: 'apple',
        });
        expect(result.playlists.items).toEqual([]);
    });

    test('normalizes mapped AMP search resources and result lyric metadata', () => {
        const result = normalizeAppleSearchResults({
            results: {
                song: {
                    data: [
                        {
                            id: '1440841384',
                            type: 'songs',
                            meta: { snippets: [{ kind: 'lyric', text: '<mark>Baby, I like your style</mark>' }] },
                        },
                    ],
                },
            },
            resources: {
                songs: {
                    1440841384: {
                        id: '1440841384',
                        type: 'songs',
                        attributes: { name: 'One Dance', artistName: 'Drake' },
                    },
                },
            },
        });

        expect(result.tracks.items[0]).toMatchObject({
            id: 'apple:track:1440841384',
            title: 'One Dance',
            lyricSnippet: 'Baby, I like your style',
        });
    });

    test('adds the requesting origin to Apple Music requests', () => {
        expect(buildAppleRequestHeaders({ token: 'dev-token' }, { origin: 'https://monochrome.tf' })).toEqual({
            Authorization: 'Bearer dev-token',
            Origin: 'https://monochrome.tf',
        });
    });

    test('retries rate-limited Apple-only requests using Retry-After', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
            .mockResolvedValueOnce(Response.json({ data: [{ id: 'artist-id' }] }));
        globalThis.fetch = fetchMock;

        try {
            const response = await appleFetchWithRateLimitRetry(
                'https://api.music.apple.com/v1/catalog/us/artists/artist-id',
                { token: 'dev-token' }
            );
            expect(response.status).toBe(200);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('returns a 429 immediately when a caller has a Tidal fallback', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
        globalThis.fetch = fetchMock;

        try {
            const response = await appleFetchWithRateLimitRetry(
                'https://api.music.apple.com/v1/catalog/us/search',
                { token: 'dev-token' },
                { retryOnRateLimit: false }
            );
            expect(response.status).toBe(429);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('builds Apple recommendations from related album tracks in one view request', async () => {
        const api = new AppleMusicSearchAPI();
        api.albumView = async () => [
            {
                id: 'related-album',
                attributes: { name: 'Related Album', artistName: 'Related Artist' },
                relationships: {
                    tracks: {
                        data: [{ id: 'recommended-song', type: 'songs', attributes: { name: 'Recommended Song' } }],
                    },
                },
            },
        ];

        const result = await api.recommendedTracks(
            [{ id: 'apple:track:seed', album: { appleMusicId: 'seed-album' } }],
            10
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'apple:track:recommended-song',
            title: 'Recommended Song',
            album: { id: 'apple:album:related-album', title: 'Related Album' },
        });
    });

    test('loads an Apple artist and all recommendation views with one catalog request', async () => {
        const api = new AppleMusicSearchAPI();
        const catalogResource = vi.fn().mockResolvedValue({
            data: [
                {
                    id: 'artist-id',
                    attributes: { name: 'Artist' },
                    views: {
                        'top-songs': { data: [] },
                        'full-albums': { data: [] },
                        singles: { data: [] },
                        'similar-artists': { data: [] },
                        'top-music-videos': { data: [] },
                    },
                },
            ],
        });
        api.catalogResource = catalogResource;

        await api.artist('artist-id');

        expect(catalogResource).toHaveBeenCalledTimes(1);
        expect(catalogResource.mock.calls[0][3].views).toContain('similar-artists');
    });

    test('persists video covers without an expiry and reuses them without another request', async () => {
        const values = new Map();
        const originalLocalStorage = globalThis.localStorage;
        const originalFetch = globalThis.fetch;
        globalThis.localStorage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key),
        };
        clearStoredVideoCovers();

        const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ dev_token: `header.${payload}.signature`, storefront_id: 'us' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'Content-Type': 'application/json' }),
                json: async () => ({ cover: { hlsUrl: 'https://example.com/cover.m3u8' } }),
            });
        globalThis.fetch = fetchMock;

        try {
            const api = new AppleMusicSearchAPI();
            await expect(api.videoCover('Song', 'Artist')).resolves.toEqual({
                hlsUrl: 'https://example.com/cover.m3u8',
            });
            await expect(api.videoCover('Song', 'Artist')).resolves.toEqual({
                hlsUrl: 'https://example.com/cover.m3u8',
            });

            expect(fetchMock).toHaveBeenCalledTimes(2);
            const persisted = JSON.parse(values.get('apple-music-video-covers-v1'));
            expect(Object.values(persisted)).toEqual([{ hlsUrl: 'https://example.com/cover.m3u8' }]);
            expect(JSON.stringify(persisted)).not.toContain('expires');
        } finally {
            clearStoredVideoCovers();
            globalThis.fetch = originalFetch;
            if (originalLocalStorage === undefined) delete globalThis.localStorage;
            else globalThis.localStorage = originalLocalStorage;
        }
    });
});
