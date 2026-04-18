import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import { Player } from '../player.js';
import { REPEAT_MODE } from '../utils.js';
import { audioEffectsSettings } from '../storage.js';

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
        getNetworkingEngine() {
            return { registerRequestFilter() {} };
        }
        load() {
            return Promise.resolve();
        }
        unload() {
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
        expect(audioEffectsSettings.setSpeed).toHaveBeenCalledWith(2.0);

        player.setPlaybackSpeed(0);
        expect(audioEffectsSettings.setSpeed).toHaveBeenCalledWith(0.01);
    });

    describe('_resolveAudioSrc', () => {
        beforeEach(() => {
            player = new Player(audioElement, api);
        });

        test('returns blob URL for tidal.com subdomain', async () => {
            const fakeBlob = new Blob(['audio'], { type: 'audio/flac' });
            const mockResponse = { ok: true, blob: vi.fn(() => Promise.resolve(fakeBlob)) };
            vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse)));
            vi.stubGlobal('URL', {
                ...URL,
                createObjectURL: vi.fn(() => 'blob:http://localhost/fake-uuid'),
            });

            const result = await player._resolveAudioSrc('https://lgf.audio.tidal.com/track.flac?token=x');
            expect(fetch).toHaveBeenCalledWith('https://lgf.audio.tidal.com/track.flac?token=x');
            expect(result).toBe('blob:http://localhost/fake-uuid');
        });

        test('returns blob URL for tidal.com apex', async () => {
            const fakeBlob = new Blob(['audio'], { type: 'audio/flac' });
            const mockResponse = { ok: true, blob: vi.fn(() => Promise.resolve(fakeBlob)) };
            vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse)));
            vi.stubGlobal('URL', {
                ...URL,
                createObjectURL: vi.fn(() => 'blob:http://localhost/fake-uuid-2'),
            });

            const result = await player._resolveAudioSrc('https://tidal.com/some/audio');
            expect(result).toBe('blob:http://localhost/fake-uuid-2');
        });

        test('returns url unchanged for non-TIDAL host', async () => {
            const result = await player._resolveAudioSrc('https://example.com/audio.mp4');
            expect(result).toBe('https://example.com/audio.mp4');
        });

        test('returns url unchanged for lookalike domain', async () => {
            const result = await player._resolveAudioSrc('https://evil-tidal.com/audio.flac');
            expect(result).toBe('https://evil-tidal.com/audio.flac');
        });

        test('throws when fetch response not ok', async () => {
            const mockResponse = { ok: false, status: 403 };
            vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse)));

            await expect(player._resolveAudioSrc('https://lgf.audio.tidal.com/track.flac')).rejects.toThrow(
                'Audio fetch failed: 403',
            );
        });
    });
});
