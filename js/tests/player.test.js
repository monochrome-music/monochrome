import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import { Player } from '../player.js';
import { REPEAT_MODE } from '../utils.js';
import { audioEffectsSettings, crossfadeSettings, replayGainSettings } from '../storage.js';
import { audioContextManager } from '../audio-context.js';

vi.mock('../audio-context.js', () => ({
    audioContextManager: {
        init: vi.fn(),
        resume: vi.fn(() => Promise.resolve()),
        isReady: vi.fn(() => false),
        setVolume: vi.fn(),
        changeSource: vi.fn(),
    },
}));

vi.mock('../storage.js', () => ({
    queueManager: {
        getQueue: vi.fn(() => null),
        saveQueue: vi.fn(),
    },
    replayGainSettings: { getMode: vi.fn(() => 'off'), getPreamp: vi.fn(() => 0) },
    trackDateSettings: { useAlbumYear: vi.fn(() => true) },
    exponentialVolumeSettings: { applyCurve: vi.fn((v) => v) },
    audioEffectsSettings: {
        getSpeed: vi.fn(() => 1.0),
        setSpeed: vi.fn(),
        isPreservePitchEnabled: vi.fn(() => true),
        setPreservePitch: vi.fn(),
    },
    radioSettings: { isEnabled: vi.fn(() => false) },
    crossfadeSettings: { isEnabled: vi.fn(() => true) },
    contentBlockingSettings: {
        shouldHideTrack: vi.fn(() => false),
        shouldHideAlbum: vi.fn(() => false),
        shouldHideArtist: vi.fn(() => false),
    },
    qualityBadgeSettings: { isEnabled: vi.fn(() => true) },
    coverArtSizeSettings: { getSize: vi.fn(() => '1280') },
    apiSettings: {
        loadInstancesFromGitHub: vi.fn(() => Promise.resolve([])),
        getInstances: vi.fn(() => Promise.resolve([])),
    },
    recentActivityManager: { addArtist: vi.fn(), addAlbum: vi.fn() },
    themeManager: { getTheme: vi.fn(() => 'dark'), setTheme: vi.fn() },
    lastFMStorage: { isEnabled: vi.fn(() => false) },
    nowPlayingSettings: { getMode: vi.fn(() => 'cover') },
    gaplessPlaybackSettings: { isEnabled: vi.fn(() => true) },
}));

vi.mock('../db.js', () => ({
    db: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../ui.js', () => ({
    UIRenderer: {
        renderQueue: vi.fn(),
    },
}));

vi.mock('../platform-detection.js', () => ({
    isIos: false,
    isSafari: false,
    canUseNativeAmazonCenc: true,
    getAmazonDecrypterCodec: vi.fn(() => 'flac'),
}));

vi.mock('shaka-player', () => ({
    default: {
        polyfill: { installAll: vi.fn() },
        Player: {
            isBrowserSupported: vi.fn(() => true),
            prototype: {
                configure: vi.fn(),
                addEventListener: vi.fn(),
                load: vi.fn(),
                unload: vi.fn(),
            },
        },
    },
    polyfill: { installAll: vi.fn() },
    Player: class {
        static isBrowserSupported() {
            return true;
        }
        configure() {}
        addEventListener() {}
        load() {
            return Promise.resolve();
        }
        unload() {
            return Promise.resolve();
        }
        detach() {
            return Promise.resolve();
        }
        destroy() {
            return Promise.resolve();
        }
    },
}));

describe('Player', () => {
    let audioElement;
    let api;
    let player;

    beforeEach(async () => {
        document.body.innerHTML = `
            <audio id="audio-player"></audio>
            <video id="video-player"></video>
            <div class="now-playing-bar">
                <img class="cover" src="">
                <div class="title"></div>
                <div class="artist"></div>
                <div class="album"></div>
            </div>
            <div id="total-duration"></div>
        `;

        audioElement = document.getElementById('audio-player');
        api = {
            getCoverUrl: vi.fn((id) => `url-${id}`),
            getCoverSrcset: vi.fn(),
            getStreamUrl: vi.fn(),
        };
        crossfadeSettings.isEnabled.mockReturnValue(true);
        replayGainSettings.getMode.mockReturnValue('off');
        replayGainSettings.getPreamp.mockReturnValue(0);
        audioContextManager.isReady.mockReturnValue(false);

        Player._instance = null;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test('initialization sets up initial state', async () => {
        player = new Player(audioElement, api);
        expect(player.audio).toBe(audioElement);
        expect(player.api).toBe(api);
        expect(player.queue).toEqual([]);
        expect(player.shuffleActive).toBe(false);
    });

    test('setVolume updates userVolume and localStorage', () => {
        player = new Player(audioElement, api);
        player.setVolume(0.5);
        expect(player.userVolume).toBe(0.5);
        expect(localStorage.getItem('volume')).toBe('0.5');
    });

    test('uses native media volume for Safari while keeping Web Audio at unity', () => {
        player = new Player(audioElement, api);
        player.userVolume = 0.35;
        player.shouldUseNativeVolumeControl = vi.fn(() => true);
        audioContextManager.isReady.mockReturnValue(true);

        player.applyReplayGain();

        expect(audioElement.volume).toBeCloseTo(0.35, 6);
        expect(audioContextManager.setVolume.mock.calls.at(-1)?.[0]).toBe(1);
    });

    test('uses Web Audio volume outside Safari when the graph is ready', () => {
        player = new Player(audioElement, api);
        player.userVolume = 0.35;
        player.shouldUseNativeVolumeControl = vi.fn(() => false);
        audioContextManager.isReady.mockReturnValue(true);

        player.applyReplayGain();

        expect(audioElement.volume).toBe(1);
        expect(audioContextManager.setVolume.mock.calls.at(-1)?.[0]).toBe(0.35);
    });

    test('adds the ReplayGain preamp numerically when metadata contains strings', () => {
        player = new Player(audioElement, api);
        player.userVolume = 0.7;
        replayGainSettings.getMode.mockReturnValue('track');
        replayGainSettings.getPreamp.mockReturnValue(3);

        const effectiveVolume = player.getEffectiveVolume({
            trackReplayGain: '-10',
            trackPeakAmplitude: '1',
        });

        expect(effectiveVolume).toBeCloseTo(0.7 * Math.pow(10, -7 / 20), 6);
        expect(effectiveVolume).toBeGreaterThan(0.3);
    });

    test('restores duration UI from an already-loaded crossfade element', () => {
        player = new Player(audioElement, api);
        document.body.insertAdjacentHTML('beforeend', '<div id="fs-total-duration"></div>');
        Object.defineProperty(audioElement, 'duration', { configurable: true, value: 235.52 });

        expect(player.syncDurationUI(audioElement)).toBe(true);
        expect(document.getElementById('total-duration').textContent).toBe('3:55');
        expect(document.getElementById('fs-total-duration').textContent).toBe('3:55');
    });

    test('uses millisecond waveform duration when media metadata is unavailable', () => {
        player = new Player(audioElement, api);
        Object.defineProperty(audioElement, 'duration', { configurable: true, value: Number.NaN });

        expect(player.syncDurationUI(audioElement, 235520)).toBe(true);
        expect(document.getElementById('total-duration').textContent).toBe('3:55');
    });

    test('shuffle toggles correctly', () => {
        player = new Player(audioElement, api);
        player.queue = [{ id: 1 }, { id: 2 }, { id: 3 }];

        player.toggleShuffle();
        expect(player.shuffleActive).toBe(true);
        expect(player.shuffledQueue.length).toBe(3);

        player.toggleShuffle();
        expect(player.shuffleActive).toBe(false);
    });

    test('repeat mode cycles correctly', () => {
        player = new Player(audioElement, api);
        expect(player.repeatMode).toBe(REPEAT_MODE.OFF);

        player.toggleRepeat();
        expect(player.repeatMode).toBe(REPEAT_MODE.ALL);

        player.toggleRepeat();
        expect(player.repeatMode).toBe(REPEAT_MODE.ONE);

        player.toggleRepeat();
        expect(player.repeatMode).toBe(REPEAT_MODE.OFF);
    });

    test('addToQueue adds tracks to the end', async () => {
        player = new Player(audioElement, api);
        player.queue = [{ id: 1 }];

        await player.addToQueue([{ id: 2 }, { id: 3 }]);
        expect(player.queue.length).toBe(3);
        expect(player.queue[2].id).toBe(3);
    });

    test('clearQueue resets queue state', async () => {
        player = new Player(audioElement, api);
        player.queue = [{ id: 1 }];
        player.currentQueueIndex = 0;

        await player.clearQueue();
        expect(player.queue).toEqual([]);
        expect(player.currentQueueIndex).toBe(-1);
    });

    test('setPlaybackSpeed clamps values', () => {
        player = new Player(audioElement, api);

        player.setPlaybackSpeed(2.0);
        expect(audioEffectsSettings.setSpeed.mock.calls.at(-1)?.[0]).toBe(2.0);

        player.setPlaybackSpeed(0);
        expect(audioEffectsSettings.setSpeed.mock.calls.at(-1)?.[0]).toBe(0.0625);

        player.setPlaybackSpeed(100);
        expect(audioEffectsSettings.setSpeed.mock.calls.at(-1)?.[0]).toBe(16);
    });

    test('compensates when Safari lands a direct FLAC seek before the requested time', async () => {
        player = new Player(audioElement, api);
        player.currentTrack = { id: '123' };
        player.currentStreamProvider = 'monochrome';
        player.shouldCorrectSafariSeek = vi.fn(() => true);
        player.updateMediaSessionPositionState = vi.fn();

        let landedTime = 0;
        Object.defineProperty(audioElement, 'duration', { configurable: true, value: 180 });
        Object.defineProperty(audioElement, 'currentTime', {
            configurable: true,
            get: () => landedTime,
            set: (requestedTime) => {
                landedTime = Math.max(0, requestedTime - 1);
                queueMicrotask(() => audioElement.dispatchEvent(new Event('seeked')));
            },
        });

        await player.seekTo(60);

        expect(landedTime).toBeCloseTo(60, 5);
        expect(player.safariSeekCorrectionSeconds).toBeCloseTo(1, 5);
        expect(player.updateMediaSessionPositionState).toHaveBeenCalledOnce();
    });

    test('fully detaches Shaka before loading a single-use native fallback', async () => {
        player = new Player(audioElement, api);
        const calls = [];
        player.shakaInitialized = true;
        player.shakaPlayer = {
            unload: vi.fn(async () => calls.push('unload')),
            detach: vi.fn(async () => calls.push('detach')),
        };
        audioElement.pause = vi.fn(() => calls.push('pause'));
        audioElement.load = vi.fn(() => calls.push('load'));

        await player.prepareNativePlayback(audioElement, 'https://tracks.example/fallback.flac?token=one-use', {
            singleUse: true,
        });

        expect(calls).toEqual(['unload', 'detach', 'pause', 'load', 'load']);
        expect(player.shakaInitialized).toBe(false);
        expect(audioElement.preload).toBe('none');
        expect(audioElement.src).toBe('https://tracks.example/fallback.flac?token=one-use');
    });

    test('prepares the next track leading-silence boundary from its waveform', async () => {
        player = new Player(audioElement, api);
        const streamInfo = {
            waveform: {
                duration_ms: 100000,
                samples: [0, 0, 20, 30, 40, 20, 0, 0],
            },
        };

        const boundaries = await player.prepareCrossfadeWaveform({ id: 'next-crossfade', duration: 100 }, streamInfo);

        expect(boundaries.leadingSilenceSeconds).toBe(25);
        expect(streamInfo.crossfadeSilenceBoundaries).toBe(boundaries);
    });

    test('keeps encrypted Amazon crossfade playback on the dual-Shaka path', () => {
        player = new Player(audioElement, api);
        player.hasControllingServiceWorker = vi.fn(() => true);
        const originalStreamInfo = {
            provider: 'amazon',
            url: 'data:application/dash+xml;base64,manifest',
            sourceUrl: 'https://media.example/track.mp4?token=signed',
            decryptionKey: '00112233445566778899aabbccddeeff',
            keyId: '11223344556677889900aabbccddeeff',
            codec: 'flac',
            playbackType: 'dash-cenc',
        };
        const streamInfo = player.getCrossfadeStreamInfo(originalStreamInfo);

        expect(streamInfo).toBe(originalStreamInfo);
        expect(player.isCrossfadeShakaStream(streamInfo)).toBe(true);
        expect(player.canCrossfadeStream({ id: 'next' }, streamInfo)).toBe(true);
    });

    test('preloads service-worker HLS through Shaka even without an m3u8 suffix', async () => {
        player = new Player(audioElement, api);
        const streamUrl =
            `${window.location.origin}/api/decrypt-stream?` +
            new URLSearchParams({
                url: 'https://media.example/track.mp4?token=signed',
                key: '00112233445566778899aabbccddeeff',
                codec: 'flac-hls',
            }).toString();
        api.getStreamUrl.mockResolvedValue({
            provider: 'amazon',
            url: streamUrl,
            sourceUrl: 'https://media.example/track.mp4?token=signed',
            decryptionKey: '00112233445566778899aabbccddeeff',
            playbackType: 'direct',
            mimeType: 'application/vnd.apple.mpegurl',
        });
        crossfadeSettings.isEnabled.mockReturnValue(false);
        const preloadManager = { destroy: vi.fn() };
        player.shakaInitialized = true;
        player.shakaPlayer = {
            preload: vi.fn(async () => preloadManager),
        };
        player.queue = [{ id: 'current' }, { id: 'next' }];
        player.currentQueueIndex = 0;

        await player._executePreloadNextTracks();

        expect(player.shakaPlayer.preload).toHaveBeenCalledWith(
            streamUrl,
            null,
            'application/vnd.apple.mpegurl',
            undefined
        );
        expect(player.preloadCache.get('next').preloadManager).toBe(preloadManager);
        expect(player.audioElements[1].getAttribute('src')).toBeNull();
    });

    test('evicts a failed immediate preload before retrying the track', async () => {
        player = new Player(audioElement, api);
        const streamInfo = {
            url:
                `${window.location.origin}/api/decrypt-stream?` +
                new URLSearchParams({
                    url: 'https://media.example/track.mp4?token=stale',
                    key: '00112233445566778899aabbccddeeff',
                    codec: 'flac-hls',
                }).toString(),
            playbackType: 'direct',
        };
        player.preloadCache.set('next', streamInfo);
        player.currentTrack = { id: 'next' };
        player.playbackSequence = 4;
        player.shakaPlayer = {
            getMediaElement: vi.fn(() => audioElement),
            configure: vi.fn(),
            load: vi.fn(async () => {
                throw new Error('stale preload');
            }),
        };
        player.playTrackFromQueue = vi.fn(async () => {});

        expect(
            player.tryStartPreloadedTrackImmediately({
                track: player.currentTrack,
                activeElement: audioElement,
                previousActiveElement: audioElement,
                currentSequence: 4,
            })
        ).toBe(true);

        await vi.waitFor(() => expect(player.playTrackFromQueue).toHaveBeenCalledWith(0, 0, false));
        expect(player.preloadCache.has('next')).toBe(false);
    });
});
