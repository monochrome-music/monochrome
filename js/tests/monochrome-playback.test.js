import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const unifiedSettings = {
    enabled: true,
    baseUrl: 'https://unified.example',
    token: 'amp_live_test',
};

vi.mock('../utils.js', () => ({
    RATE_LIMIT_ERROR_MESSAGE: 'rate limited',
    deriveTrackQuality: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
    isTrackUnavailable: vi.fn(() => false),
    getExtensionFromBlob: vi.fn(),
    getTrackDiscNumber: vi.fn(() => 1),
    normalizeQualityToken: vi.fn((quality) =>
        ['DOLBY_ATMOS', 'ATMOS', 'EAC3_JOC'].includes(quality) ? 'DOLBY_ATMOS_EAC3_HIGH' : quality
    ),
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
        isEnabled: vi.fn(() => unifiedSettings.enabled),
        getApiBaseUrl: vi.fn(() => unifiedSettings.baseUrl),
        getApiToken: vi.fn(() => unifiedSettings.token),
        isDefaultApiToken: vi.fn((token) =>
            unifiedSettings.isDefaultApiToken ? unifiedSettings.isDefaultApiToken(token) : token === 'amp_live_test'
        ),
        DEFAULT_API_TOKEN: 'amp_live_test',
    },
    deezerFallbackSettings: { isEnabled: vi.fn(() => false) },
}));

vi.mock('../dash-downloader.ts', () => ({ DashDownloader: class {} }));
vi.mock('../hls-downloader.js', () => ({ HlsDownloader: class {} }));
vi.mock('../proxy-utils.js', () => ({ getProxyUrl: vi.fn((url) => url), wrapTidalUrl: vi.fn((url) => url) }));
vi.mock('../ffmpeg.js', () => ({
    loadFfmpeg: vi.fn(() => Promise.resolve()),
    FfmpegError: class extends Error {},
    ffmpeg: vi.fn(),
}));
vi.mock('../download-utils.ts', () => ({
    triggerDownload: vi.fn(),
    applyAudioPostProcessing: vi.fn((blob) => Promise.resolve(blob)),
}));
vi.mock('../metadata.js', () => ({
    prefetchMetadataObjects: vi.fn(() => ({ coverFetch: Promise.resolve(null), lyricsFetch: Promise.resolve(null) })),
    addMetadataToAudio: vi.fn((blob) => Promise.resolve(blob)),
}));
vi.mock('../ffmpegFormats.ts', () => ({ isCustomFormat: vi.fn(() => false) }));
vi.mock('../progressEvents.js', () => ({ DownloadProgress: class {} }));
vi.mock('../readableStreamIterator.js', () => ({ readableStreamIterator: vi.fn() }));
vi.mock('../HiFi.ts', () => ({ HiFiClient: { instance: { query: vi.fn() } }, TidalResponse: class {} }));
vi.mock('../platform-detection.js', () => ({
    canUseNativeAmazonCenc: true,
    getAmazonDecrypterCodec: vi.fn(() => 'flac'),
    canBrowserStreamAtmosQuality: vi.fn(() => true),
}));
vi.mock('../container-classes.js', () => ({
    TrackAlbum: class {},
    EnrichedAlbum: class {},
    EnrichedTrack: class {
        constructor(value) {
            Object.assign(this, value);
        }
    },
    ReplayGain: class {},
    PlaybackInfo: class {},
    Track: class {},
    Album: class {},
    PreparedVideo: class {},
    PreparedTrack: class {},
}));

const { LosslessAPI } = await import('../api.js');

const createStorage = () => {
    const values = new Map();
    return {
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, String(value)),
    };
};

const jsonResponse = (data, status = 200, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] || null },
    json: vi.fn(() => Promise.resolve(data)),
});

const track = {
    id: '123',
    title: 'Happier',
    version: 'Live',
    artists: [{ name: 'Marshmello' }, { name: 'Bastille' }],
    album: { title: 'Album Title' },
    isrc: 'USUG11801651',
    duration: 214.2,
};

const envelope = (source, resource, extra = {}) => ({
    schema_version: '2.0',
    request_id: 'request-1',
    selected_source: source,
    track: {
        id: source === 'amazon' ? 'B000000000' : 'mono-track',
        title: track.title,
        artists: ['Marshmello', 'Bastille'],
        album: 'Album Title',
        isrc: track.isrc,
        duration_ms: 214200,
    },
    playback: [resource],
    sources: [],
    ...extra,
});

describe('Unified Playback API', () => {
    let api;

    beforeEach(() => {
        vi.stubGlobal('localStorage', createStorage());
        api = new LosslessAPI({});
        unifiedSettings.enabled = true;
        unifiedSettings.baseUrl = 'https://unified.example';
        unifiedSettings.token = 'amp_live_test';
        unifiedSettings.isDefaultApiToken = vi.fn((t) => t === 'amp_live_test');
        api.getUnifiedTurnstileJwt = vi.fn(() => Promise.resolve('turnstile-session-jwt'));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test('maps API codec labels to valid MP4 codec strings', () => {
        expect(api.getAmazonCodecString('aac')).toBe('mp4a.40.2');
        expect(api.getAmazonCodecString('eac3')).toBe('ec-3');
        expect(api.getAmazonCodecString('eac3-joc')).toBe('ec-3');
        expect(api.getAmazonCodecString('ac4')).toBe('ac-4');
        expect(api.getUnifiedPlaybackCodec({ source: 'amazon', quality: 'UHD_44', codec: 'aac' })).toBe('flac');
        expect(api.getUnifiedPlaybackCodec({ source: 'amazon', quality: 'SD_HIGH', codec: 'flac' })).toBe('opus');
        expect(api.getUnifiedPlaybackCodec({ source: 'amazon', quality: 'DOLBY_ATMOS_EAC3_LOW', codec: 'flac' })).toBe(
            'eac3-joc'
        );
        expect(api.getUnifiedPlaybackCodec({ source: 'amazon', quality: 'DOLBY_ATMOS_AC4_HIGH', codec: 'flac' })).toBe(
            'ac4'
        );
    });

    test('sends track metadata and bearer authorization to the no-store endpoint', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                jsonResponse(
                    envelope('mono', {
                        id: 'mono:recording',
                        source: 'mono',
                        kind: 'audio',
                        delivery: 'direct',
                        url: 'https://audio.example/recording.flac',
                        mime_type: 'audio/flac',
                        container: 'flac',
                        codec: 'flac',
                        quality: 'Original',
                        lossless: true,
                        encryption: null,
                    })
                )
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track })).resolves.toMatchObject({
            provider: 'monochrome',
            url: 'https://audio.example/recording.flac',
            playbackType: 'direct',
            requestId: 'request-1',
        });

        const [request, options] = fetchMock.mock.calls[0];
        const requestUrl = new URL(request);
        expect(requestUrl.pathname).toBe('/api/v2/track/');
        expect(requestUrl.searchParams.get('track')).toBe('Happier (Live)');
        expect(requestUrl.searchParams.get('artist')).toBe('Marshmello, Bastille');
        expect(requestUrl.searchParams.get('album')).toBe('Album Title');
        expect(requestUrl.searchParams.get('isrc')).toBe('USUG11801651');
        expect(requestUrl.searchParams.get('duration')).toBe('214');
        expect(requestUrl.searchParams.get('intent')).toBe('stream');
        expect(requestUrl.searchParams.get('quality')).toBe('LOSSLESS');
        expect(options.headers.Authorization).toBe('Bearer amp_live_test');
        expect(options.headers['X-Turnstile-JWT']).toBe('turnstile-session-jwt');
        expect(options.cache).toBe('no-store');
    });

    test('coalesces concurrent identical unified lookups without caching later operations', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                jsonResponse(
                    envelope('mono', {
                        id: 'mono:recording',
                        source: 'mono',
                        kind: 'audio',
                        delivery: 'direct',
                        url: 'https://audio.example/recording.flac',
                        mime_type: 'audio/flac',
                    })
                )
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        await Promise.all([
            api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track }),
            api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track }),
        ]);
        expect(fetchMock).toHaveBeenCalledOnce();

        await api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('preserves top-level waveform URLs from the V2 playback envelope', async () => {
        const waveform = {
            source: 'soundcloud',
            json_url: 'https://wave.sndcdn.com/TrEJZ4ti5WFd_m.json',
            png_url: 'https://w1.sndcdn.com/TrEJZ4ti5WFd_m.png',
        };
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    jsonResponse(
                        envelope(
                            'mono',
                            {
                                id: 'mono:recording',
                                source: 'mono',
                                kind: 'audio',
                                delivery: 'direct',
                                url: 'https://audio.example/recording.flac',
                                mime_type: 'audio/flac',
                            },
                            { waveform }
                        )
                    )
                )
            )
        );

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track })).resolves.toMatchObject({
            waveform,
        });
    });

    test('extracts ReplayGain values from replay_gain object on V2 playback resources', () => {
        const resource = {
            replay_gain: {
                track_gain_db: -9.25,
                track_peak: 0.94,
                album_gain_db: -10.75,
                album_peak: 0.96,
                program_loudness_lufs: -14.2,
            },
        };
        expect(api.getUnifiedPlaybackReplayGain(resource)).toEqual({
            trackReplayGain: -9.25,
            trackPeakAmplitude: 0.94,
            albumReplayGain: -10.75,
            albumPeakAmplitude: 0.96,
            programLoudnessLufs: -14.2,
            anchorLoudnessLufs: null,
            truePeakDb: null,
        });
    });

    test('succeeds without Turnstile JWT for custom API keys that do not require Turnstile', async () => {
        unifiedSettings.token = 'custom_partner_token';
        unifiedSettings.isDefaultApiToken = vi.fn(() => false);
        delete api.getUnifiedTurnstileJwt;
        api.getCachedUnifiedTurnstileJwt = vi.fn(() => null);

        const fetchMock = vi.fn(() =>
            Promise.resolve(
                jsonResponse(
                    envelope('mono', {
                        id: 'mono:recording',
                        source: 'mono',
                        kind: 'audio',
                        delivery: 'direct',
                        url: 'https://audio.example/recording.flac',
                        mime_type: 'audio/flac',
                    })
                )
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track })).resolves.toMatchObject({
            provider: 'monochrome',
            url: 'https://audio.example/recording.flac',
        });

        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers.Authorization).toBe('Bearer custom_partner_token');
        expect(options.headers['X-Turnstile-JWT']).toBeUndefined();
    });

    test('exchanges a page-load Turnstile token using the app API key', async () => {
        delete api.getUnifiedTurnstileJwt;
        const expiry = Math.floor(Date.now() / 1000) + 3600;
        const payload = btoa(JSON.stringify({ exp: expiry }))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const jwt = `header.${payload}.signature`;
        api.getUnifiedTurnstileResponse = vi.fn(() => Promise.resolve('single-use-turnstile-token'));
        const fetchMock = vi.fn((url, options) => {
            expect(url).toBe('https://unified.example/api/auth/turnstile');
            expect(options.method).toBe('POST');
            expect(options.headers.Authorization).toBe('Bearer amp_live_test');
            expect(JSON.parse(options.body)).toEqual({ turnstile_token: 'single-use-turnstile-token' });
            return Promise.resolve(jsonResponse({ access_token: jwt }));
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.getUnifiedTurnstileJwt()).resolves.toBe(jwt);

        expect(localStorage.getItem('unified-playback-turnstile-jwt')).toBe(jwt);
        expect(localStorage.getItem('unified-playback-turnstile-expiry')).toBe(String(expiry));
    });

    test('normalizes an incorrectly labelled Amazon UHD resource as FLAC', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    jsonResponse(
                        envelope('amazon', {
                            id: 'amazon:B000000000:UHD',
                            source: 'amazon',
                            kind: 'audio',
                            delivery: 'direct',
                            url: 'https://amazon.example/audio.mp4',
                            mime_type: 'audio/mp4',
                            container: 'mp4',
                            codec: 'aac',
                            quality: 'HI_RES_LOSSLESS',
                            lossless: true,
                            bit_depth: 24,
                            sample_rate_hz: 96000,
                            bitrate_kbps: 3524,
                            encryption: {
                                scheme: 'cenc-aes-ctr',
                                key: { encoding: 'hex', value: '001122' },
                            },
                        })
                    )
                )
            )
        );
        api.getAmazonCencMp4Info = vi.fn(() =>
            Promise.resolve({
                keyId: '00112233445566778899aabbccddeeff',
                initRangeEnd: 999,
                sidx: { start: 1000, end: 1099, durationSeconds: 214, timescale: 44100 },
            })
        );
        api.createAmazonMusicDashUrl = vi.fn(() => 'blob:https://app.example/manifest');

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'HI_RES_LOSSLESS', { track })).resolves.toMatchObject({
            provider: 'amazon',
            url: 'blob:https://app.example/manifest',
            sourceUrl: 'https://amazon.example/audio.mp4',
            playbackType: 'dash-cenc',
            decryptionKey: '001122',
            keyId: '00112233445566778899aabbccddeeff',
            codec: 'flac',
            bitDepth: 24,
            sampleRate: 96000,
            sampleRateHz: 96000,
            bitrateKbps: 3524,
            bandwidth: 3524000,
            qualityDisplay: 'HD 24/96',
            mediaMimeType: 'audio/mp4',
        });
        expect(api.createAmazonMusicDashUrl).toHaveBeenCalledWith(
            'https://amazon.example/audio.mp4',
            expect.any(Object),
            expect.objectContaining({ codec: 'flac' }),
            expect.any(Object)
        );
    });

    test('supports Tidal as selected source returning a DASH MPD resource', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    jsonResponse(
                        envelope('tidal', {
                            id: 'tidal:track-1',
                            source: 'tidal',
                            kind: 'manifest',
                            delivery: 'dash',
                            url: 'https://tidal.example/manifest.mpd',
                            mime_type: 'application/dash+xml',
                            container: 'mp4',
                            codec: 'flac',
                            quality: 'HI_RES_LOSSLESS',
                            lossless: true,
                            encryption: null,
                        })
                    )
                )
            )
        );

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'HI_RES_LOSSLESS', { track })).resolves.toMatchObject({
            provider: 'tidal',
            url: 'https://tidal.example/manifest.mpd',
            playbackType: 'dash',
            mimeType: 'application/dash+xml',
        });
    });

    test('rejects playback resources from unsupported unified sources', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    jsonResponse(
                        envelope('legacy', {
                            id: 'legacy:track-1',
                            source: 'legacy',
                            kind: 'audio',
                            delivery: 'direct',
                            url: 'https://legacy.example/audio.flac',
                            mime_type: 'audio/flac',
                            container: 'flac',
                            codec: 'flac',
                            quality: 'LOSSLESS',
                            lossless: true,
                            encryption: null,
                        })
                    )
                )
            )
        );

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track })).resolves.toBeNull();
    });

    test('uses the shared E-AC-3 High request for Amazon and Tidal Atmos', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                jsonResponse(
                    envelope('tidal', {
                        id: 'tidal:atmos-1',
                        source: 'tidal',
                        kind: 'manifest',
                        delivery: 'dash',
                        url: 'https://tidal.example/atmos.mpd',
                        mime_type: 'application/dash+xml',
                        container: 'mp4',
                        codec: 'eac3-joc',
                        quality: 'DOLBY_ATMOS_EAC3_HIGH',
                        lossless: false,
                        sample_rate_hz: 48000,
                        bitrate_kbps: 770,
                        channels: 6,
                        channel_layout: '5.1',
                        encryption: null,
                    })
                )
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await api.getUnifiedPlaybackStreamUrl('123', 'DOLBY_ATMOS_EAC3_HIGH', { track });
        expect(result).toMatchObject({
            provider: 'tidal',
            url: 'https://tidal.example/atmos.mpd',
            codec: 'eac3-joc',
            quality: 'DOLBY_ATMOS_EAC3_HIGH',
            lossless: false,
            sampleRateHz: 48000,
            bitrateKbps: 770,
            channels: 6,
            channelLayout: '5.1',
        });

        const [request] = fetchMock.mock.calls[0];
        const requestUrl = new URL(request);
        expect(requestUrl.searchParams.get('quality')).toBe('DOLBY_ATMOS_EAC3_HIGH');
    });

    test('never emits the legacy generic Atmos request', () => {
        const params = api.buildUnifiedPlaybackLookupParams(track, 'DOLBY_ATMOS');
        expect(params.get('quality')).toBe('DOLBY_ATMOS_EAC3_HIGH');
    });

    test('does not use stereo fallbacks for an exact Atmos request', async () => {
        api.getTrackMetadata = vi.fn(() => Promise.resolve(track));
        api.getUnifiedPlaybackStreamUrl = vi.fn(() => Promise.resolve(null));
        api.getDeezerStreamUrl = vi.fn();

        await expect(api.getStreamUrl('123', 'DOLBY_ATMOS_EAC3_LOW')).rejects.toMatchObject({
            code: 'STRICT_QUALITY_UNAVAILABLE',
        });
        expect(api.getUnifiedPlaybackStreamUrl).toHaveBeenCalledOnce();
        expect(api.getDeezerStreamUrl).not.toHaveBeenCalled();
    });

    test('uses playback rather than diagnostic source resources', async () => {
        const data = envelope('mono', {
            source: 'mono',
            kind: 'audio',
            delivery: 'direct',
            url: 'https://audio.example/correct.flac',
            mime_type: 'audio/flac',
            quality: 'Original',
        });
        data.sources = [
            {
                source: 'amazon',
                status: 'error',
                resources: [{ url: 'https://audio.example/wrong.mp4' }],
            },
        ];
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(jsonResponse(data)))
        );

        const result = await api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track });

        expect(result.url).toBe('https://audio.example/correct.flac');
        expect(result.url).not.toContain('wrong');
    });

    test('accepts future DASH resources without changing the envelope adapter', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    jsonResponse(
                        envelope('amazon', {
                            source: 'amazon',
                            kind: 'manifest',
                            delivery: 'dash',
                            url: 'https://amazon.example/manifest.mpd',
                            mime_type: 'application/dash+xml',
                            quality: 'UHD',
                            encryption: null,
                        })
                    )
                )
            )
        );

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track })).resolves.toMatchObject({
            provider: 'amazon',
            url: 'https://amazon.example/manifest.mpd',
            playbackType: 'dash',
            mimeType: 'application/dash+xml',
        });
    });

    test('does not cache Mono URLs returned by the unified endpoint', async () => {
        api.getTrackMetadata = vi.fn(() => Promise.resolve(track));
        api.getUnifiedPlaybackStreamUrl = vi
            .fn()
            .mockResolvedValueOnce({ url: 'https://audio.example/first.flac', provider: 'monochrome' })
            .mockResolvedValueOnce({ url: 'https://audio.example/second.flac', provider: 'monochrome' });
        api.getDeezerStreamUrl = vi.fn();

        await expect(api.getStreamUrl('123', 'LOSSLESS')).resolves.toMatchObject({
            url: 'https://audio.example/first.flac',
        });
        await expect(api.getStreamUrl('123', 'LOSSLESS')).resolves.toMatchObject({
            url: 'https://audio.example/second.flac',
        });

        expect(api.getUnifiedPlaybackStreamUrl).toHaveBeenCalledTimes(2);
    });

    test('uses the unified result with intent=download when enriching a download', async () => {
        api.getTrackMetadata = vi.fn(() => Promise.resolve(track));
        api.prepareTrack = vi.fn((value) => value);
        api.getUnifiedPlaybackStreamUrl = vi.fn(() =>
            Promise.resolve({
                url: 'https://audio.example/download.flac',
                sourceUrl: 'https://audio.example/download.flac',
                provider: 'monochrome',
                playbackType: 'direct',
                mimeType: 'audio/flac',
                mediaMimeType: 'audio/flac',
            })
        );
        api.getDeezerStreamUrl = vi.fn();

        await expect(api.enrichTrack(track, { downloadQuality: 'LOSSLESS' })).resolves.toMatchObject({
            externalProvider: 'monochrome',
            externalStreamType: 'direct',
            externalStreamUrl: 'https://audio.example/download.flac',
        });
        expect(api.getUnifiedPlaybackStreamUrl).toHaveBeenCalledWith('123', 'LOSSLESS', { track, intent: 'download' });
    });

    test('reuses the download enrichment result instead of resolving playback twice', async () => {
        const enrichment = {
            lookup: { info: { audioQuality: 'LOSSLESS' } },
            enrichedTrack: track,
            isVideo: false,
            downloadQuality: 'LOSSLESS',
            externalProvider: 'monochrome',
            externalStreamType: 'direct',
            externalStreamUrl: 'https://audio.example/download.flac',
            externalSourceUrl: 'https://audio.example/download.flac',
        };
        api.enrichTrack = vi.fn(() => Promise.resolve(enrichment));
        const mediaBlob = new Blob([new Uint8Array([0x66, 0x4c, 0x61, 0x43])], { type: 'audio/flac' });
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    body: null,
                    headers: { get: (name) => (name === 'Content-Type' ? 'audio/flac' : null) },
                    blob: vi.fn(() => Promise.resolve(mediaBlob)),
                })
            )
        );

        const resolved = await api.enrichTrack(track, { downloadQuality: 'LOSSLESS' });
        await expect(
            api.downloadTrack('123', 'LOSSLESS', 'Happier.flac', {
                track: resolved.enrichedTrack,
                enriched: resolved,
                triggerDownload: false,
            })
        ).resolves.toBe(mediaBlob);

        expect(api.enrichTrack).toHaveBeenCalledOnce();
    });

    test.each([404, 502])('returns null for a documented failure envelope with status %s', async (status) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    jsonResponse(
                        {
                            schema_version: '2.0',
                            request_id: 'failed',
                            selected_source: null,
                            track: null,
                            playback: [],
                            sources: [],
                        },
                        status
                    )
                )
            )
        );

        await expect(api.getUnifiedPlaybackStreamUrl('123', 'LOSSLESS', { track })).resolves.toBeNull();
    });
});
