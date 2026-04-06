import { expect, test, describe, vi } from 'vitest';
import * as utils from '../utils.js';

vi.mock('../ModernSettings.js', () => ({
    modernSettings: {
        filenameTemplate: '{artist} - {album} - {trackNumber} - {title}',
    },
}));

vi.mock('../icons.js', () => ({
    SVG_ATMOS: () => '<svg>atmos</svg>',
}));

vi.mock('../storage.js', () => ({
    qualityBadgeSettings: { isEnabled: vi.fn(() => true) },
    coverArtSizeSettings: { getSize: vi.fn(() => '1280') },
    trackDateSettings: { useAlbumYear: vi.fn(() => false) },
}));

describe('utils.js', () => {
    describe('formatTime', () => {
        test('formats seconds into M:SS', () => {
            expect(utils.formatTime(0)).toBe('0:00');
            expect(utils.formatTime(5)).toBe('0:05');
            expect(utils.formatTime(60)).toBe('1:00');
            expect(utils.formatTime(65)).toBe('1:05');
        });

        test('formats seconds into H:MM:SS', () => {
            expect(utils.formatTime(3600)).toBe('1:00:00');
            expect(utils.formatTime(3665)).toBe('1:01:05');
        });

        test('handles NaN', () => {
            expect(utils.formatTime(NaN)).toBe('0:00');
        });
    });

    describe('sanitizeForFilename', () => {
        test('replaces invalid characters with underscores', () => {
            expect(utils.sanitizeForFilename('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
        });

        test('collapses multiple spaces and trims', () => {
            expect(utils.sanitizeForFilename('  hello   world  ')).toBe('hello world');
        });

        test('returns "Unknown" for empty input', () => {
            expect(utils.sanitizeForFilename('')).toBe('Unknown');
            expect(utils.sanitizeForFilename(null)).toBe('Unknown');
        });
    });

    describe('replaceTokens', () => {
        test('replaces tokens in template', () => {
            const template = '{artist} - {title}';
            const tokens = { artist: 'Artist', title: 'Title' };
            expect(utils.replaceTokens(template, tokens)).toBe('Artist - Title');
        });

        test('leaves unknown tokens as is', () => {
            const template = '{artist} - {unknown}';
            const tokens = { artist: 'Artist' };
            expect(utils.replaceTokens(template, tokens)).toBe('Artist - {unknown}');
        });
    });

    describe('formatPathTemplate', () => {
        test('formats path correctly', () => {
            const data = {
                artist: 'Artist',
                album: 'Album',
                trackNumber: 1,
                title: 'Title',
                discNumber: 1,
            };
            const template = '{artist}/{album}/{trackNumber} - {title}';
            expect(utils.formatPathTemplate(template, data)).toBe('Artist/Album/01 - Title');
        });

        test('strips . and .. segments', () => {
            const data = { artist: '..', title: '.' };
            const template = '{artist}/{title}/song';
            expect(utils.formatPathTemplate(template, data)).toBe('song');
        });
    });

    describe('detectAudioFormat', () => {
        test('detects flac', () => {
            const view = new DataView(new Uint8Array([0x66, 0x4c, 0x61, 0x43]).buffer);
            expect(utils.detectAudioFormat(view)).toBe('flac');
        });

        test('detects mp4', () => {
            const view = new DataView(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]).buffer);
            expect(utils.detectAudioFormat(view)).toBe('mp4');
        });

        test('detects mp3 (ID3)', () => {
            const view = new DataView(new Uint8Array([0x49, 0x44, 0x33]).buffer);
            expect(utils.detectAudioFormat(view)).toBe('mp3');
        });

        test('detects ogg', () => {
            const view = new DataView(new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer);
            expect(utils.detectAudioFormat(view)).toBe('ogg');
        });

        test('returns null for unknown format', () => {
            const view = new DataView(new Uint8Array([0, 0, 0, 0]).buffer);
            expect(utils.detectAudioFormat(view)).toBeNull();
        });
    });

    describe('normalizeQualityToken', () => {
        test('normalizes various quality strings', () => {
            expect(utils.normalizeQualityToken('HI_RES_LOSSLESS')).toBe('HI_RES_LOSSLESS');
            expect(utils.normalizeQualityToken('MASTER')).toBe('HI_RES_LOSSLESS');
            expect(utils.normalizeQualityToken('HIFI')).toBe('LOSSLESS');
            expect(utils.normalizeQualityToken('ATMOS')).toBe('DOLBY_ATMOS');
        });

        test('returns null for unknown quality', () => {
            expect(utils.normalizeQualityToken('UNKNOWN')).toBeNull();
        });
    });

    describe('pickBestQuality', () => {
        test('picks the highest quality from list', () => {
            expect(utils.pickBestQuality(['LOSSLESS', 'HI_RES_LOSSLESS', 'HIGH'])).toBe('HI_RES_LOSSLESS');
            expect(utils.pickBestQuality(['LOW', 'HIGH'])).toBe('HIGH');
            expect(utils.pickBestQuality(['DOLBY_ATMOS', 'HI_RES_LOSSLESS'])).toBe('DOLBY_ATMOS');
        });
    });

    describe('getTrackTitle', () => {
        test('returns title with version if present', () => {
            expect(utils.getTrackTitle({ title: 'Song', version: 'Remix' })).toBe('Song (Remix)');
        });

        test('returns just title if no version', () => {
            expect(utils.getTrackTitle({ title: 'Song' })).toBe('Song');
        });

        test('returns fallback if no title', () => {
            expect(utils.getTrackTitle({}, { fallback: 'No Title' })).toBe('No Title');
        });
    });

    describe('getTrackArtists', () => {
        test('joins multiple artists', () => {
            const track = { artists: [{ name: 'A' }, { name: 'B' }] };
            expect(utils.getTrackArtists(track)).toBe('A, B');
        });

        test('returns fallback if no artists', () => {
            expect(utils.getTrackArtists({})).toBe('Unknown Artist');
        });
    });

    describe('getTrackDiscNumber', () => {
        test('extracts disc number from various properties', () => {
            expect(utils.getTrackDiscNumber({ discNumber: 2 })).toBe(2);
            expect(utils.getTrackDiscNumber({ volumeNumber: 3 })).toBe(3);
            expect(utils.getTrackDiscNumber({ mediaNumber: 4 })).toBe(4);
        });

        test('returns null for invalid values', () => {
            expect(utils.getTrackDiscNumber({ discNumber: 0 })).toBeNull();
            expect(utils.getTrackDiscNumber({ discNumber: 'abc' })).toBeNull();
        });
    });

    describe('tryCatch', () => {
        test('executes sync function', () => {
            const fn = vi.fn(() => 'success');
            const onError = vi.fn();
            expect(utils.tryCatch(fn, onError)).toBe('success');
            expect(onError).not.toHaveBeenCalled();
        });

        test('handles sync error', () => {
            const error = new Error('fail');
            const fn = vi.fn(() => {
                throw error;
            });
            const onError = vi.fn((err) => err.message);
            expect(utils.tryCatch(fn, onError)).toBe('fail');
            expect(onError).toHaveBeenCalledWith(error);
        });

        test('executes async function', async () => {
            const fn = vi.fn(async () => 'success');
            const onError = vi.fn();
            const result = await utils.tryCatch(fn, onError);
            expect(result).toBe('success');
            expect(onError).not.toHaveBeenCalled();
        });

        test('handles async error', async () => {
            const error = new Error('fail');
            const fn = vi.fn(async () => {
                throw error;
            });
            const onError = vi.fn(async (err) => err.message);
            const result = await utils.tryCatch(fn, onError);
            expect(result).toBe('fail');
            expect(onError).toHaveBeenCalledWith(error);
        });
    });
});
