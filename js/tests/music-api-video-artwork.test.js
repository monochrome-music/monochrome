import { describe, expect, test, vi } from 'vitest';
import { MusicAPI } from '../music-api.js';

describe('MusicAPI video artwork caching', () => {
    test('retries a previous miss and only caches a successful cover', async () => {
        const api = new MusicAPI({});
        api.appleMusicSearchAPI.videoCover = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ hlsUrl: 'https://example.com/cover.m3u8' });

        await expect(api.getVideoArtwork('Song', 'Artist')).resolves.toBeNull();
        await expect(api.getVideoArtwork('Song', 'Artist')).resolves.toMatchObject({
            videoUrl: null,
            hlsUrl: 'https://example.com/cover.m3u8',
        });
        await expect(api.getVideoArtwork('Song', 'Artist')).resolves.toMatchObject({
            videoUrl: null,
            hlsUrl: 'https://example.com/cover.m3u8',
        });

        expect(api.appleMusicSearchAPI.videoCover).toHaveBeenCalledTimes(2);
    });
});
