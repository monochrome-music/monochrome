import { expect, test, describe, beforeEach, vi } from 'vitest';
import {
    recentActivityManager,
    themeManager,
    lastFMStorage,
    nowPlayingSettings,
    gaplessPlaybackSettings,
    exponentialVolumeSettings,
    audioEffectsSettings,
} from '../storage.js';

describe('storage.js', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    describe('recentActivityManager', () => {
        test('initializes with empty arrays', () => {
            const recents = recentActivityManager.getRecents();
            expect(recents.artists).toEqual([]);
            expect(recents.albums).toEqual([]);
        });

        test('adds artist and maintains limit', () => {
            for (let i = 0; i < 15; i++) {
                recentActivityManager.addArtist({ id: i, name: `Artist ${i}` });
            }
            const recents = recentActivityManager.getRecents();
            expect(recents.artists.length).toBe(10);
            expect(recents.artists[0].id).toBe(14);
        });

        test('clears recents', () => {
            recentActivityManager.addArtist({ id: 1, name: 'Artist' });
            recentActivityManager.clear();
            const recents = recentActivityManager.getRecents();
            expect(recents.artists).toEqual([]);
        });
    });

    describe('themeManager', () => {
        test('gets and sets theme', () => {
            themeManager.setTheme('dark');
            expect(themeManager.getTheme()).toBe('dark');
            expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        });

        test('handles custom theme', () => {
            const colors = { primary: '#ff0000', background: '#000000' };
            themeManager.setCustomTheme(colors);
            expect(themeManager.getTheme()).toBe('custom');
            expect(themeManager.getCustomTheme()).toEqual(colors);
            expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#ff0000');
        });
    });

    describe('lastFMStorage', () => {
        test('handles enabled state', () => {
            lastFMStorage.setEnabled(true);
            expect(lastFMStorage.isEnabled()).toBe(true);
            lastFMStorage.setEnabled(false);
            expect(lastFMStorage.isEnabled()).toBe(false);
        });

        test('obfuscates sensitive data', () => {
            const key = 'test-api-key';
            lastFMStorage.setCustomApiKey(key);
            expect(localStorage.getItem(lastFMStorage.CUSTOM_API_KEY)).not.toBe(key);
            expect(lastFMStorage.getCustomApiKey()).toBe(key);
        });
    });

    describe('nowPlayingSettings', () => {
        test('gets and sets mode', () => {
            expect(nowPlayingSettings.getMode()).toBe('cover');
            nowPlayingSettings.setMode('visualizer');
            expect(nowPlayingSettings.getMode()).toBe('visualizer');
        });
    });

    describe('gaplessPlaybackSettings', () => {
        test('defaults to true', () => {
            expect(gaplessPlaybackSettings.isEnabled()).toBe(true);
        });

        test('sets enabled state', () => {
            gaplessPlaybackSettings.setEnabled(false);
            expect(gaplessPlaybackSettings.isEnabled()).toBe(false);
        });
    });

    describe('exponentialVolumeSettings', () => {
        test('applies curve when enabled', () => {
            exponentialVolumeSettings.setEnabled(true);
            expect(exponentialVolumeSettings.applyCurve(0.5)).toBeCloseTo(0.125);
            expect(exponentialVolumeSettings.inverseCurve(0.125)).toBeCloseTo(0.5);
        });

        test('does not apply curve when disabled', () => {
            exponentialVolumeSettings.setEnabled(false);
            expect(exponentialVolumeSettings.applyCurve(0.5)).toBe(0.5);
            expect(exponentialVolumeSettings.inverseCurve(0.5)).toBe(0.5);
        });
    });

    describe('audioEffectsSettings', () => {
        test('gets and sets speed within bounds', () => {
            audioEffectsSettings.setSpeed(2.0);
            expect(audioEffectsSettings.getSpeed()).toBe(2.0);

            audioEffectsSettings.setSpeed(200);
            expect(audioEffectsSettings.getSpeed()).toBe(100);

            audioEffectsSettings.setSpeed(0);
            expect(audioEffectsSettings.getSpeed()).toBe(0.01);
        });

        test('resets speed', () => {
            audioEffectsSettings.setSpeed(2.0);
            audioEffectsSettings.resetSpeed();
            expect(audioEffectsSettings.getSpeed()).toBe(1.0);
        });
    });
});
