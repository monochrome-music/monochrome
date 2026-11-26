import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('../utils.js', () => ({
    RATE_LIMIT_ERROR_MESSAGE: 'rate limited',
    deriveTrackQuality: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
    isTrackUnavailable: vi.fn(() => false),
    getExtensionFromBlob: vi.fn(),
    getTrackDiscNumber: vi.fn(),
    normalizeQualityToken: vi.fn((quality) => quality),
    isAtmosQuality: vi.fn((quality) => String(quality || '').startsWith('DOLBY_ATMOS_')),
    isAc4AtmosQuality: vi.fn((quality) => String(quality || '').startsWith('DOLBY_ATMOS_AC4_')),
    getTrackCoverId: vi.fn(),
    getCoverBlob: vi.fn(),
}));

vi.mock('../storage.js', () => ({
    preferDolbyAtmosSettings: { isEnabled: vi.fn(() => false) },
    trackDateSettings: { useAlbumYear: vi.fn(() => false) },
    devModeSettings: { isEnabled: vi.fn(() => false), getUrl: vi.fn(() => '') },
    unifiedPlaybackSettings: {
        isEnabled: vi.fn(() => false),
        getApiBaseUrl: vi.fn(() => 'https://unified.example'),
        getApiToken: vi.fn(() => ''),
    },
    deezerFallbackSettings: { isEnabled: vi.fn(() => false), getApiBaseUrl: vi.fn(() => '') },
}));

vi.mock('../cache.js', () => ({
    APICache: class {
        async get() {
            return null;
        }
        async set() {}
        async clearExpired() {}
    },
}));

vi.mock('../dash-downloader.ts', () => ({ DashDownloader: class {} }));
vi.mock('../hls-downloader.js', () => ({ HlsDownloader: class {} }));
vi.mock('../proxy-utils.js', () => ({ getProxyUrl: vi.fn((url) => url), wrapTidalUrl: vi.fn((url) => url) }));
vi.mock('../ffmpeg.js', () => ({ loadFfmpeg: vi.fn(), FfmpegError: class extends Error {}, ffmpeg: vi.fn() }));
vi.mock('../download-utils.ts', () => ({ triggerDownload: vi.fn(), applyAudioPostProcessing: vi.fn() }));
vi.mock('../ffmpegFormats.ts', () => ({ isCustomFormat: vi.fn(() => false) }));
vi.mock('../progressEvents.js', () => ({ DownloadProgress: class {} }));
vi.mock('../readableStreamIterator.js', () => ({ readableStreamIterator: vi.fn() }));
vi.mock('../HiFi.ts', () => ({
    HiFiClient: { instance: { query: vi.fn() } },
    TidalResponse: class {},
}));
vi.mock('../platform-detection.js', () => ({
    isIos: false,
    isSafari: false,
    isChrome: true,
    canBrowserStreamAtmosQuality: vi.fn(() => true),
}));
vi.mock('../container-classes.js', () => ({
    TrackAlbum: class {},
    EnrichedAlbum: class {},
    EnrichedTrack: class {},
    ReplayGain: class {},
    PlaybackInfo: class {
        constructor(value) {
            Object.assign(this, value);
        }
    },
    Track: class {},
    Album: class {},
    PreparedVideo: class {},
    PreparedTrack: class {},
}));

const { LosslessAPI } = await import('../api.js');

describe('LosslessAPI HiFi streaming fallback', () => {
    let settings;
    let api;

    beforeEach(() => {
        settings = {
            getInstances: vi.fn(async (type) => (type === 'streaming' ? [{ url: 'https://hifi.example' }] : [])),
        };
        api = new LosslessAPI(settings);
        vi.spyOn(api, 'getTrackMetadata').mockResolvedValue({ id: '123', isrc: 'TESTISRC123' });
        vi.spyOn(api, 'getUnifiedPlaybackStreamUrl').mockResolvedValue(null);
        vi.spyOn(api, 'getDeezerStreamUrl').mockResolvedValue(null);
        vi.spyOn(api, 'getTrack').mockResolvedValue({
            track: { id: 123, duration: 180 },
            info: {
                audioQuality: 'LOSSLESS',
                manifest: btoa(JSON.stringify({ urls: ['https://audio.example/fallback.flac'] })),
                trackReplayGain: -4,
                trackPeakAmplitude: 0.9,
                albumReplayGain: -5,
                albumPeakAmplitude: 0.95,
            },
        });
    });

    test('reports failure when Unified Playback and ISRC fallbacks cannot resolve', async () => {
        await expect(api.getStreamUrl('123', 'LOSSLESS')).rejects.toThrow(
            'Could not resolve stream URL from Unified Playback or Deezer'
        );
        expect(api.getTrack).not.toHaveBeenCalled();
    });

    test('uses Unified Playback before Deezer when it resolves a stream URL', async () => {
        api.getUnifiedPlaybackStreamUrl.mockResolvedValue({
            url: 'blob:https://app.example/protected',
            provider: 'legacy',
            singleUse: true,
            playbackType: 'direct',
            quality: 'HD_44',
            rgInfo: {
                trackReplayGain: 0,
                trackPeakAmplitude: 1,
                albumReplayGain: 0,
                albumPeakAmplitude: 1,
            },
        });

        const result = await api.getStreamUrl('123', 'LOSSLESS');

        expect(result).toEqual({
            url: 'blob:https://app.example/protected',
            provider: 'legacy',
            singleUse: true,
            playbackType: 'direct',
            quality: 'HD_44',
            rgInfo: {
                trackReplayGain: 0,
                trackPeakAmplitude: 1,
                albumReplayGain: 0,
                albumPeakAmplitude: 1,
            },
        });
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
        expect(api.getTrack).not.toHaveBeenCalled();
    });

    test('requests a fresh Unified Playback descriptor for forced fallback without caching it', async () => {
        api.getUnifiedPlaybackStreamUrl
            .mockResolvedValueOnce({
                url: 'https://playback.example/first',
                provider: 'legacy',
                singleUse: true,
            })
            .mockResolvedValueOnce({
                url: 'https://playback.example/fresh-fallback',
                provider: 'legacy',
                singleUse: true,
            });

        const first = await api.getStreamUrl('123', 'LOSSLESS');
        const fallback = await api.getStreamUrl('123', 'LOSSLESS', { forceFallback: true });

        expect(first.url).toBe('https://playback.example/first');
        expect(fallback.url).toBe('https://playback.example/fresh-fallback');
        expect(api.getUnifiedPlaybackStreamUrl).toHaveBeenCalledTimes(2);
        expect(api.getUnifiedPlaybackStreamUrl).toHaveBeenNthCalledWith(
            2,
            '123',
            'LOSSLESS',
            expect.objectContaining({ forceFallback: true })
        );
        expect(api.streamCache.size).toBe(0);
    });

    test('skips the rejected Mono source while retaining another Unified Playback source', async () => {
        api.getUnifiedPlaybackStreamUrl.mockRestore();
        vi.spyOn(api, 'fetchUnifiedPlaybackEnvelope').mockResolvedValue({
            quality_requested: 'LOSSLESS',
            playback: [
                {
                    source: 'mono',
                    kind: 'audio',
                    delivery: 'direct',
                    url: 'https://tracks.example/rejected',
                    mime_type: 'audio/flac',
                },
                {
                    source: 'legacy',
                    kind: 'audio',
                    delivery: 'direct',
                    url: 'https://legacy.example/fallback',
                    quality: 'LOSSLESS',
                },
            ],
        });
        const options = { track: { id: '123' } };

        const ordinary = await api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', options);
        const forced = await api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', {
            ...options,
            forceFallback: true,
        });

        expect(ordinary).toMatchObject({
            url: 'https://tracks.example/rejected',
            provider: 'monochrome',
            singleUse: true,
        });
        expect(forced).toMatchObject({
            url: 'https://legacy.example/fallback',
            provider: 'legacy',
            singleUse: true,
        });
    });

    test('uses Deezer when forced fallback leaves only the rejected Mono source', async () => {
        api.getUnifiedPlaybackStreamUrl.mockRestore();
        vi.spyOn(api, 'fetchUnifiedPlaybackEnvelope').mockResolvedValue({
            quality_requested: 'LOSSLESS',
            playback: [
                {
                    source: 'mono',
                    kind: 'audio',
                    delivery: 'direct',
                    url: 'https://tracks.example/rejected',
                    mime_type: 'audio/flac',
                },
            ],
        });
        api.getDeezerStreamUrl.mockResolvedValue({
            url: 'https://audio.example/deezer-fallback.flac',
            format: 'FLAC',
            provider: 'deezer',
            rgInfo: null,
        });

        const result = await api.getStreamUrl('123', 'LOSSLESS', { forceFallback: true });

        expect(result).toMatchObject({
            url: 'https://audio.example/deezer-fallback.flac',
            provider: 'deezer',
        });
        expect(api.getDeezerStreamUrl).toHaveBeenCalledWith('TESTISRC123', 'LOSSLESS');
    });

    test('uses Deezer when it resolves a fallback stream URL', async () => {
        api.getDeezerStreamUrl.mockResolvedValue({
            url: 'https://audio.example/deezer.flac',
            format: 'FLAC',
            provider: 'deezer',
            rgInfo: {
                trackReplayGain: -2,
                trackPeakAmplitude: 0.8,
                albumReplayGain: -3,
                albumPeakAmplitude: 0.85,
            },
        });

        const result = await api.getStreamUrl('123', 'LOSSLESS');

        expect(result.url).toBe('https://audio.example/deezer.flac');
        expect(api.getUnifiedPlaybackStreamUrl).toHaveBeenCalledWith(
            '123',
            'LOSSLESS',
            expect.objectContaining({ track: expect.objectContaining({ id: '123' }) })
        );
        expect(api.getTrack).not.toHaveBeenCalled();
    });

    test('does not call HiFi streaming APIs when no streaming instances are available', async () => {
        settings.getInstances.mockResolvedValue([]);

        await expect(api.getStreamUrl('123', 'LOSSLESS')).rejects.toThrow(
            'Could not resolve stream URL from Unified Playback or Deezer'
        );
        expect(api.getTrack).not.toHaveBeenCalled();
    });
});
