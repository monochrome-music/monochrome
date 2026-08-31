import { afterEach, describe, expect, test, vi } from 'vitest';
import { onRequest } from '../../functions/api/apple-video-cover.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('Apple video cover Pages Function', () => {
    test('finds an album through AMP and returns its square editorial video', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({
                    results: {
                        songs: {
                            data: [
                                {
                                    attributes: { name: 'One Dance', artistName: 'Drake' },
                                    relationships: { albums: { data: [{ id: '123' }] } },
                                },
                            ],
                        },
                    },
                })
            )
            .mockResolvedValueOnce(
                Response.json({
                    data: [
                        {
                            attributes: {
                                editorialVideo: {
                                    motionDetailTall: {
                                        video: 'https://video.example/tall.m3u8',
                                        previewFrame: { width: 900, height: 1200 },
                                    },
                                    motionDetailSquare: {
                                        video: 'https://video.example/square.m3u8',
                                        previewFrame: {
                                            width: 1000,
                                            height: 1000,
                                            url: 'https://video.example/frame.jpg',
                                        },
                                    },
                                },
                            },
                        },
                    ],
                })
            );
        globalThis.fetch = fetchMock;

        const request = new Request(
            'https://monochrome.tf/api/apple-video-cover?title=One%20Dance&artist=Drake&storefront=us',
            { headers: { Authorization: 'Bearer test-token' } }
        );
        const response = await onRequest({ request });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            cover: {
                kind: 'motionDetailSquare',
                aspectRatio: '1:1',
                hlsUrl: 'https://video.example/square.m3u8',
                previewFrameUrl: 'https://video.example/frame.jpg',
            },
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0].hostname).toBe('amp-api.music.apple.com');
        expect(fetchMock.mock.calls[0][1].headers.Origin).toBe('https://monochrome.tf');
    });

    test('looks up a known album with only one AMP request', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ attributes: {} }] }));
        globalThis.fetch = fetchMock;

        const request = new Request('https://monochrome.tf/api/apple-video-cover?albumId=123&storefront=us', {
            headers: { Authorization: 'Bearer test-token' },
        });
        const response = await onRequest({ request });

        expect(await response.json()).toEqual({ cover: null });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0].pathname).toBe('/v1/catalog/us/albums/123');
    });

    test('passes Apple rate limits through so the browser can honor Retry-After', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(null, {
                status: 429,
                headers: { 'Retry-After': '3' },
            })
        );

        const request = new Request('https://monochrome.tf/api/apple-video-cover?albumId=123&storefront=us', {
            headers: { Authorization: 'Bearer test-token' },
        });
        const response = await onRequest({ request });

        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBe('3');
    });
});
