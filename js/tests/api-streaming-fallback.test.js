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
    deezerFallbackSettings: { isEnabled: vi.fn(() => false) },
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
vi.mock('../platform-detection.js', () => ({ isIos: false, isSafari: false, isChrome: true, canUseNativeAmazonCenc: false }));
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
    let mathRandomSpy;

    beforeEach(() => {
        mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9); // Default to Amazon-first
        settings = {
            getInstances: vi.fn(async (type) => (type === 'streaming' ? [{ url: 'https://hifi.example' }] : [])),
        };
        api = new LosslessAPI(settings);
        vi.spyOn(api, 'getTrackMetadata').mockResolvedValue({ id: '123', isrc: 'TESTISRC123' });
        vi.spyOn(api, 'getAmazonMusicStreamUrl').mockResolvedValue(null);
        vi.spyOn(api, 'getQobuzStreamUrl').mockResolvedValue(null);
        vi.spyOn(api, 'getDeezerStreamUrl').mockResolvedValue({
            url: 'https://audio.example/fallback.flac',
            format: 'FLAC',
        });
    });

    test('falls back to Deezer when Amazon Music and Qobuz return no URL', async () => {
        const result = await api.getStreamUrl('123', 'LOSSLESS');

        expect(result).toMatchObject({
            url: 'https://audio.example/fallback.flac',
            provider: 'deezer',
            deezerFormat: 'FLAC',
            rgInfo: {
                trackReplayGain: 0,
                trackPeakAmplitude: 1,
                albumReplayGain: 0,
                albumPeakAmplitude: 1,
            },
        });
        expect(api.getDeezerStreamUrl).toHaveBeenCalledWith('TESTISRC123', 'LOSSLESS');
    });

    test('Amazon-first: uses Amazon Music before Qobuz when it resolves a stream URL', async () => {
        mathRandomSpy.mockReturnValue(0.9);
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

        expect(result).toMatchObject({
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
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
    });

    test('Amazon-first: falls back to Qobuz when Amazon Music fails', async () => {
        mathRandomSpy.mockReturnValue(0.9);
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
        expect(api.getAmazonMusicStreamUrl).toHaveBeenCalledWith('123', 'LOSSLESS', expect.anything());
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
    });

    test('Qobuz-first: uses Qobuz before Amazon Music when it resolves a stream URL', async () => {
        mathRandomSpy.mockReturnValue(0.1);
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
        expect(api.getAmazonMusicStreamUrl).not.toHaveBeenCalled();
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
    });

    test('Qobuz-first: falls back to Amazon Music when Qobuz fails', async () => {
        mathRandomSpy.mockReturnValue(0.1);
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

        expect(result).toMatchObject({
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
        expect(api.getQobuzStreamUrl).toHaveBeenCalledWith('TESTISRC123', 'LOSSLESS');
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
    });

    test('does not call Deezer when no ISRC is available', async () => {
        vi.spyOn(api, 'getTrackMetadata').mockResolvedValue({ id: '123' }); // No ISRC

        await expect(api.getStreamUrl('123', 'LOSSLESS')).rejects.toThrow(
            'Could not resolve stream URL: Amazon Music failed and track has no ISRC for Qobuz/Deezer lookup'
        );
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
    });
});
