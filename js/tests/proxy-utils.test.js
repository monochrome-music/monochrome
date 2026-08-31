import { describe, expect, test } from 'vitest';
import { getProxyUrl, isTidalAudioUrl, wrapTidalUrl } from '../proxy-utils.js';

describe('proxy-utils', () => {
    test('returns original TIDAL audio segment URLs directly without audio proxying', () => {
        const url = 'https://sp-pr-fa.audio.tidal.com/mediatracks/abc/1.mp4?token=a/b+c==';

        expect(isTidalAudioUrl(url)).toBe(false);
        expect(getProxyUrl(url)).toBe(url);
    });

    test('does not proxy non-audio TIDAL endpoints or non-TIDAL audio URLs', () => {
        expect(getProxyUrl('https://api.tidal.com/v1/tracks/1')).toBe('https://api.tidal.com/v1/tracks/1');
        expect(getProxyUrl('https://resources.tidal.com/images/cover.jpg')).toBe(
            'https://resources.tidal.com/images/cover.jpg'
        );
        expect(getProxyUrl('https://cdn.example.com/audio/1.mp4')).toBe('https://cdn.example.com/audio/1.mp4');
    });

    test('routes TIDAL API and web requests through the Samidy worker', () => {
        expect(wrapTidalUrl('https://openapi.tidal.com/v2/albums/1')).toBe(
            'https://lol.samidy.workers.dev/openapi/v2/albums/1'
        );
        expect(wrapTidalUrl('https://api.tidal.com/v1/tracks/1')).toBe(
            'https://lol.samidy.workers.dev/api/v1/tracks/1'
        );
        expect(wrapTidalUrl('https://tidal.com/browse/mix/1')).toBe(
            'https://lol.samidy.workers.dev/tidal/browse/mix/1'
        );
    });
});
