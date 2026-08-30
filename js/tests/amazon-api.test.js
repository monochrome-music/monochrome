import { expect, test, describe, vi } from 'vitest';
import { LosslessAPI } from '../api.js';
import { MusicAPI } from '../music-api.js';

describe('Amazon Music playback metadata', () => {
    const api = new LosslessAPI({});

    test('uses MP4 codec identifiers in generated DASH metadata', () => {
        expect(api.getAmazonCodecString('flac')).toBe('fLaC');
        expect(api.getAmazonCodecString('aac')).toBe('mp4a.40.2');
        expect(api.getAmazonCodecString('eac3')).toBe('ec-3');
    });

    test('uses the normalized codec in Amazon MIME types and manifests', () => {
        const qualityInfo = { codec: 'flac', bandwidth: 1200000, sampleRate: 96000 };
        expect(api.getAmazonMimeType(qualityInfo)).toBe('audio/mp4; codecs="fLaC"');

        const manifest = api.createAmazonMusicDashManifest(
            'https://amazon.example/audio.mp4',
            { asin: 'B000000000' },
            qualityInfo,
            {
                keyId: '00112233445566778899aabbccddeeff',
                initRangeEnd: 999,
                sidx: {
                    start: 1000,
                    end: 1099,
                    durationSeconds: 180,
                    timescale: 44100,
                    earliestPresentationTime: 0,
                },
            }
        );

        expect(manifest).toContain('codecs="fLaC"');
        expect(manifest).toContain('mimeType="audio/mp4"');
        expect(manifest).toContain('cenc:default_KID="00112233-4455-6677-8899-aabbccddeeff"');
    });
});

describe('MusicAPI Amazon playback capability delegation', () => {
    test('forwards Amazon playback capability checks to the active API', async () => {
        const musicApi = new MusicAPI({});
        musicApi.tidalAPI.canPlayAmazonMusicStream = vi.fn(() => Promise.resolve(false));

        await expect(musicApi.canPlayAmazonMusicStream({ provider: 'amazon' })).resolves.toBe(false);
        expect(musicApi.tidalAPI.canPlayAmazonMusicStream).toHaveBeenCalledWith({ provider: 'amazon' });
    });
});
