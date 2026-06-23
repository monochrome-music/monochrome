import { describe, expect, test } from 'vitest';
import { getProxyUrl, isTidalAudioUrl } from '../proxy-utils.js';

describe('proxy-utils', () => {
    test('routes TIDAL audio segment URLs through the audio proxy without URL encoding', () => {
        const url = 'https://sp-pr-fa.audio.tidal.com/mediatracks/abc/1.mp4?token=a/b+c==';

        expect(isTidalAudioUrl(url)).toBe(true);
        expect(getProxyUrl(url)).toBe(`https://audio-proxy.binimum.org/proxy-audio/${url}`);
    });

    test('does not proxy non-audio TIDAL endpoints or non-TIDAL audio URLs', () => {
        expect(getProxyUrl('https://api.tidal.com/v1/tracks/1')).toBe('https://api.tidal.com/v1/tracks/1');
        expect(getProxyUrl('https://resources.tidal.com/images/cover.jpg')).toBe(
            'https://resources.tidal.com/images/cover.jpg'
        );
        expect(getProxyUrl('https://cdn.example.com/audio/1.mp4')).toBe('https://cdn.example.com/audio/1.mp4');
    });

    test('does not double proxy already proxied URLs', () => {
        const proxied = 'https://audio-proxy.binimum.org/proxy-audio/https://audio.tidal.com/foo/1.mp4';

        expect(getProxyUrl(proxied)).toBe(proxied);
    });
});
