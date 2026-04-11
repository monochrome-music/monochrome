import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const TRACK_MANIFEST_RESPONSE = {
    data: {
        data: {
            attributes: {
                uri: 'https://example.test/stream.mpd',
                trackAudioNormalizationData: {},
                albumAudioNormalizationData: {},
            },
        },
    },
};

function setWindowProp(name, value) {
    Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value,
    });
}

async function requestManifestType({ mediaSource, managedMediaSource }) {
    vi.resetModules();
    vi.doMock('../platform-detection.js', () => ({
        isIos: true,
        isSafari: true,
    }));

    const { LosslessAPI } = await import('../api.js');
    const api = new LosslessAPI({
        getInstances: vi.fn(async () => [{ url: 'https://example.test', version: '3.0' }]),
    });

    setWindowProp('MediaSource', mediaSource);
    setWindowProp('ManagedMediaSource', managedMediaSource);

    const fetchWithRetry = vi.spyOn(api, 'fetchWithRetry').mockResolvedValue({
        json: async () => TRACK_MANIFEST_RESPONSE,
    });

    await api.getStreamUrl('123');

    const requestPath = fetchWithRetry.mock.calls[0][0];
    const params = new URLSearchParams(requestPath.split('?')[1]);
    return params.get('manifestType');
}

describe('LosslessAPI manifestType selection on Apple platforms', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    test('uses MPEG_DASH when MediaSource is available', async () => {
        const manifestType = await requestManifestType({
            mediaSource: class MediaSourceStub {},
            managedMediaSource: undefined,
        });

        expect(manifestType).toBe('MPEG_DASH');
    });

    test('uses MPEG_DASH when ManagedMediaSource is available', async () => {
        const manifestType = await requestManifestType({
            mediaSource: undefined,
            managedMediaSource: class ManagedMediaSourceStub {},
        });

        expect(manifestType).toBe('MPEG_DASH');
    });

    test('uses HLS when neither MediaSource nor ManagedMediaSource is available', async () => {
        const manifestType = await requestManifestType({
            mediaSource: undefined,
            managedMediaSource: undefined,
        });

        expect(manifestType).toBe('HLS');
    });
});
