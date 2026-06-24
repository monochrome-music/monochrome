import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
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

describe('Amazon Music source selection', () => {
    let api;

    beforeEach(() => {
        api = new LosslessAPI({});
        api.getTrackMetadata = vi.fn(() =>
            Promise.resolve({
                id: '71513806',
                title: 'Song',
                artist: { name: 'Artist' },
                album: { title: 'Album' },
                isrc: 'USABC1234567',
            })
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('tries Amazon first when the 50/50 playback roll prefers Amazon', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.75);
        const calls = [];
        api.getAmazonMusicStreamUrl = vi.fn(() => {
            calls.push('amazon');
            return Promise.resolve({
                url: 'https://amazon.example/audio.mp4',
                sourceUrl: 'https://amazon.example/audio.mp4',
                provider: 'amazon',
                playbackType: 'direct',
                quality: 'HD',
                qualityDisplay: 'FLAC',
            });
        });
        api.getQobuzStreamUrl = vi.fn(() => {
            calls.push('qobuz');
            return Promise.resolve({ url: 'https://qobuz.example/audio.flac' });
        });

        const result = await api.getStreamUrl('71513806', 'LOSSLESS');

        expect(result.provider).toBe('amazon');
        expect(calls).toEqual(['amazon']);
    });

    test('tries Qobuz first when the 50/50 playback roll prefers Qobuz', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.25);
        const calls = [];
        api.getAmazonMusicStreamUrl = vi.fn(() => {
            calls.push('amazon');
            return Promise.resolve({
                url: 'https://amazon.example/audio.mp4',
                sourceUrl: 'https://amazon.example/audio.mp4',
                provider: 'amazon',
            });
        });
        api.getQobuzStreamUrl = vi.fn(() => {
            calls.push('qobuz');
            return Promise.resolve({ url: 'https://qobuz.example/audio.flac', rgInfo: null });
        });

        const result = await api.getStreamUrl('71513806', 'LOSSLESS');

        expect(result.provider).toBe('qobuz');
        expect(calls).toEqual(['qobuz']);
    });

    test('falls back to Qobuz when Amazon is preferred but cannot resolve a stream', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.75);
        const calls = [];
        api.getAmazonMusicStreamUrl = vi.fn(() => {
            calls.push('amazon');
            return Promise.resolve(null);
        });
        api.getQobuzStreamUrl = vi.fn(() => {
            calls.push('qobuz');
            return Promise.resolve({ url: 'https://qobuz.example/audio.flac', rgInfo: null });
        });

        const result = await api.getStreamUrl('71513806', 'LOSSLESS');

        expect(result.provider).toBe('qobuz');
        expect(calls).toEqual(['amazon', 'qobuz']);
    });

    test('falls back to Amazon when Qobuz is preferred but cannot resolve a stream', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.25);
        const calls = [];
        api.getAmazonMusicStreamUrl = vi.fn(() => {
            calls.push('amazon');
            return Promise.resolve({
                url: 'https://amazon.example/audio.mp4',
                sourceUrl: 'https://amazon.example/audio.mp4',
                provider: 'amazon',
            });
        });
        api.getQobuzStreamUrl = vi.fn(() => {
            calls.push('qobuz');
            return Promise.resolve(null);
        });

        const result = await api.getStreamUrl('71513806', 'LOSSLESS');

        expect(result.provider).toBe('amazon');
        expect(calls).toEqual(['qobuz', 'amazon']);
    });
});

describe('Amazon Music Turnstile auth', () => {
    let api;

    beforeEach(() => {
        api = new LosslessAPI({});
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    test('retries with a visible widget when the first Turnstile attempt fails', async () => {
        const renderConfigs = [];
        const turnstile = {
            render: vi.fn((_container, config) => {
                renderConfigs.push(config);
                const id = `widget-${renderConfigs.length}`;
                if (renderConfigs.length === 2) {
                    queueMicrotask(() => config.callback('visible-token'));
                }
                return id;
            }),
            execute: vi.fn(() => {
                renderConfigs[0]['error-callback']('110500');
            }),
            remove: vi.fn(),
        };
        api.loadTurnstile = vi.fn(() => Promise.resolve(turnstile));

        await expect(api.getTurnstileResponse()).resolves.toBe('visible-token');

        expect(turnstile.render).toHaveBeenCalledTimes(2);
        expect(renderConfigs[0]).toMatchObject({
            execution: 'execute',
            appearance: 'interaction-only',
        });
        expect(renderConfigs[1]).toMatchObject({
            execution: 'render',
            appearance: 'always',
        });
        expect(turnstile.execute).toHaveBeenCalledWith('widget-1');
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
