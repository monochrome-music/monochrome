import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const deezerSettings = {
    enabled: true,
    baseUrl: 'https://deezer.example',
};

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
    deezerFallbackSettings: {
        isEnabled: vi.fn(() => deezerSettings.enabled),
        getApiBaseUrl: vi.fn(() => deezerSettings.baseUrl),
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
vi.mock('../HiFi.ts', () => ({ HiFiClient: { instance: { query: vi.fn() } }, TidalResponse: class {} }));
vi.mock('../platform-detection.js', () => ({
    isIos: false,
    isSafari: false,
    isChrome: true,
    canUseNativeAmazonCenc: true,
    getAmazonDecrypterCodec: vi.fn(() => 'flac'),
    canBrowserStreamAtmosQuality: vi.fn(() => true),
}));
vi.mock('../container-classes.js', () => ({
    TrackAlbum: class {},
    EnrichedAlbum: class {},
    EnrichedTrack: class {},
    ReplayGain: class {},
    PlaybackInfo: class {},
    Track: class {},
    Album: class {},
    PreparedVideo: class {},
    PreparedTrack: class {},
}));

const { LosslessAPI } = await import('../api.js');

describe('Deezer playback fallback', () => {
    let api;

    beforeEach(() => {
        vi.unstubAllGlobals();
        api = new LosslessAPI({});
        deezerSettings.enabled = true;
        deezerSettings.baseUrl = 'https://deezer.example';
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test.each([
        ['HI_RES_LOSSLESS', 'FLAC'],
        ['LOSSLESS', 'FLAC'],
        ['HIGH', 'MP3_320'],
        ['LOW', 'MP3_128'],
    ])('maps %s requests to %s', (quality, format) => {
        expect(api.getDeezerStreamFormat(quality)).toBe(format);
    });

    test('returns a direct Deezer URL after a successful probe', async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await api.getDeezerStreamUrl('GBDUW0000053', 'LOSSLESS');

        expect(result).toEqual({
            url: 'https://deezer.example/stream/?isrc=GBDUW0000053&format=FLAC',
            format: 'FLAC',
            provider: 'deezer',
            rgInfo: null,
        });
        expect(fetchMock).toHaveBeenCalledWith(result.url, expect.objectContaining({ method: 'HEAD' }));
    });

    test('accepts endpoints that reject HEAD with method-not-allowed', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({ ok: false, status: 405 }))
        );

        await expect(api.getDeezerStreamUrl('GBDUW0000053', 'HIGH')).resolves.toMatchObject({
            format: 'MP3_320',
            provider: 'deezer',
        });
    });

    test('returns null for a missing stream or disabled fallback', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({ ok: false, status: 404 }))
        );
        await expect(api.getDeezerStreamUrl('GBDUW0000053', 'LOSSLESS')).resolves.toBeNull();

        deezerSettings.enabled = false;
        await expect(api.getDeezerStreamUrl('GBDUW0000053', 'LOSSLESS')).resolves.toBeNull();
    });
});
