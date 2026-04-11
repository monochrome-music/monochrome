import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Player } from '../player.js';
import { audioContextManager } from '../audio-context.js';

vi.mock('../audio-context.js', () => ({
    audioContextManager: {
        init: vi.fn(),
        resume: vi.fn(() => Promise.resolve()),
        isReady: vi.fn(() => true),
        isElementRoutedToAudioContext: vi.fn(() => false),
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
    binauralDspSettings: { isEnabled: vi.fn(() => false) },
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

describe('Player replay gain volume routing', () => {
    let audioElement;
    let player;

    beforeEach(() => {
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
        Player._instance = null;
        player = new Player(audioElement, {
            getCoverUrl: vi.fn(),
            getCoverSrcset: vi.fn(),
            getStreamUrl: vi.fn(),
        });

        audioContextManager.setVolume.mockClear();
        audioContextManager.isElementRoutedToAudioContext.mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test('routes through Web Audio gain when the active element is routed to audio context', () => {
        player.userVolume = 0.55;
        audioContextManager.isElementRoutedToAudioContext.mockReturnValue(true);

        player.applyReplayGain();

        expect(audioElement.volume).toBe(1);
        expect(audioContextManager.setVolume).toHaveBeenCalledWith(0.55);
    });

    test('keeps native media element volume when active element is not routed to audio context', () => {
        player.userVolume = 0.35;
        audioContextManager.isElementRoutedToAudioContext.mockReturnValue(false);

        player.applyReplayGain();

        expect(audioElement.volume).toBe(0.35);
        expect(audioContextManager.setVolume).not.toHaveBeenCalled();
    });
});
