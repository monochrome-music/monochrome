import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('../utils.js', () => ({
    RATE_LIMIT_ERROR_MESSAGE: 'rate limited',
    deriveTrackQuality: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
    isTrackUnavailable: vi.fn(() => false),
    getExtensionFromBlob: vi.fn(),
    getTrackDiscNumber: vi.fn(),
    normalizeQualityToken: vi.fn((quality) => quality),
    getTrackCoverId: vi.fn(),
    getCoverBlob: vi.fn(),
}));

vi.mock('../storage.js', () => ({
    preferDolbyAtmosSettings: { isEnabled: vi.fn(() => false) },
    trackDateSettings: { useAlbumYear: vi.fn(() => false) },
    devModeSettings: { isEnabled: vi.fn(() => false), getUrl: vi.fn(() => '') },
    amazonMusicSettings: { isEnabled: vi.fn(() => false) },
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
vi.mock('../platform-detection.js', () => ({ isIos: false, isSafari: false, isChrome: true }));
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
        vi.spyOn(api, 'getAmazonMusicStreamUrl').mockResolvedValue(null);
        vi.spyOn(api, 'getQobuzStreamUrl').mockResolvedValue(null);
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

    test('falls back to HiFi streaming APIs when Qobuz returns no URL and streaming instances exist', async () => {
        const result = await api.getStreamUrl('123', 'LOSSLESS');

        expect(result).toEqual({
            url: 'https://audio.example/fallback.flac',
            rgInfo: {
                trackReplayGain: -4,
                trackPeakAmplitude: 0.9,
                albumReplayGain: -5,
                albumPeakAmplitude: 0.95,
            },
        });
        expect(api.getTrack).toHaveBeenCalledWith('123', 'LOSSLESS', { adaptive: false });
    });

    test('uses Amazon Music before Qobuz when it resolves a stream URL', async () => {
        api.getAmazonMusicStreamUrl.mockResolvedValue({
            url: 'blob:https://app.example/amazon',
            provider: 'amazon',
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
            url: 'blob:https://app.example/amazon',
            provider: 'amazon',
            playbackType: 'direct',
            quality: 'HD_44',
            rgInfo: {
                trackReplayGain: 0,
                trackPeakAmplitude: 1,
                albumReplayGain: 0,
                albumPeakAmplitude: 1,
            },
        });
        expect(api.getQobuzStreamUrl).not.toHaveBeenCalled();
        expect(api.getTrack).not.toHaveBeenCalled();
    });

    test('keeps using Qobuz when it resolves a stream URL', async () => {
        api.getQobuzStreamUrl.mockResolvedValue({
            url: 'https://audio.example/qobuz.flac',
            rgInfo: {
                trackReplayGain: -2,
                trackPeakAmplitude: 0.8,
                albumReplayGain: -3,
                albumPeakAmplitude: 0.85,
            },
        });

        const result = await api.getStreamUrl('123', 'LOSSLESS');

        expect(result.url).toBe('https://audio.example/qobuz.flac');
        expect(api.getAmazonMusicStreamUrl).toHaveBeenCalledWith('123', 'LOSSLESS');
        expect(api.getTrack).not.toHaveBeenCalled();
    });

    test('does not call HiFi streaming APIs when no streaming instances are available', async () => {
        settings.getInstances.mockResolvedValue([]);

        await expect(api.getStreamUrl('123', 'LOSSLESS')).rejects.toThrow(
            'Could not resolve stream URL from Amazon Music, Qobuz, or HiFi streaming APIs'
        );
        expect(api.getTrack).not.toHaveBeenCalled();
    });
});
