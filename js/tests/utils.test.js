import { expect, test, describe, vi } from 'vitest';
import * as utils from '../utils.js';
import { waveformGenerator } from '../waveform.js';

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

    describe('formatQualityBadgeText', () => {
        test('formats FLAC 16/44.1 and FLAC 24/192 with exact bit depth and sample rate', () => {
            expect(
                utils.formatQualityBadgeText({ bitDepth: 16, sampleRateHz: 44100, codec: 'flac', quality: 'LOSSLESS' })
            ).toBe('FLAC 16/44.1');
            expect(
                utils.formatQualityBadgeText({
                    bitDepth: 24,
                    sampleRateHz: 192000,
                    codec: 'flac',
                    quality: 'HI_RES_LOSSLESS',
                })
            ).toBe('HD 24/192');
            expect(
                utils.formatQualityBadgeText({
                    bitDepth: 24,
                    sampleRateHz: 96000,
                    codec: 'flac',
                    quality: 'HI_RES_LOSSLESS',
                })
            ).toBe('HD 24/96');
            expect(
                utils.formatQualityBadgeText({
                    bitDepth: 24,
                    sampleRateHz: 48000,
                    codec: 'flac',
                    quality: 'HI_RES_LOSSLESS',
                })
            ).toBe('HD 24/48');
            expect(
                utils.formatQualityBadgeText({
                    bit_depth: 24,
                    sample_rate_hz: 96000,
                    codec: 'flac',
                    quality: 'HI_RES_LOSSLESS',
                })
            ).toBe('HD 24/96');
            expect(
                utils.formatQualityBadgeText({
                    bitDepth: 16,
                    sampleRateHz: 44100,
                    codec: 'flac',
                    quality: 'HI_RES_LOSSLESS',
                })
            ).toBe('FLAC 16/44.1');
        });

        test('falls back to HD FLAC for Hi-Res and FLAC for Lossless when bit depth/sample rate are missing', () => {
            expect(utils.formatQualityBadgeText({ quality: 'HI_RES_LOSSLESS', codec: 'flac' })).toBe('HD FLAC');
            expect(utils.formatQualityBadgeText({ quality: 'LOSSLESS', codec: 'flac' })).toBe('FLAC');
            expect(utils.formatQualityBadgeText(null, null, 'HI_RES_LOSSLESS')).toBe('HD FLAC');
            expect(utils.formatQualityBadgeText(null, null, 'LOSSLESS')).toBe('FLAC');
        });

        test('formats lossy formats with bitrate', () => {
            expect(utils.formatQualityBadgeText({ codec: 'mp3', bitrateKbps: 320 })).toBe('MP3 320k');
            expect(utils.formatQualityBadgeText({ codec: 'aac', bitrateKbps: 96 })).toBe('AAC 96k');
            expect(utils.formatQualityBadgeText({ codec: 'opus', bitrateKbps: 132 })).toBe('Opus 132k');
            expect(utils.formatQualityBadgeText({ codec: 'opus', bitrateKbps: 138 })).toBe('Opus 138k');
        });
    });

    describe('createQualityBadgeHTML', () => {
        test('uses detailed live playback quality when it is available on the track', () => {
            const badge = utils.createQualityBadgeHTML({
                audioQuality: 'HI_RES_LOSSLESS',
                playbackQualityInfo: {
                    codec: 'flac',
                    quality: 'HI_RES_LOSSLESS',
                    lossless: true,
                    bitDepth: 24,
                    sampleRateHz: 96000,
                },
            });

            expect(badge).toContain('HD 24/96');
            expect(badge).not.toContain('HD FLAC');
        });
    });

    describe('WaveformGenerator.getSilenceBoundaries', () => {
        test('correctly identifies trailing and leading silence when samples drop below threshold 5', () => {
            const samples = [0, 0, 25, 34, 74, 90, 80, 4, 2, 0, 0];
            const duration = 110;
            const bounds = waveformGenerator.getSilenceBoundaries(samples, duration, 5);
            expect(bounds.leadingSilenceSeconds).toBe(20);
            expect(bounds.trailingSilenceStartTime).toBe(70);
            expect(bounds.crossfadeStartTime).toBe(67);
            expect(bounds.crossfadeDurationSeconds).toBe(3);
            expect(bounds.hasTrailingSilence).toBe(true);
        });

        test('retains SoundCloud duration metadata for preloading the next track', async () => {
            const waveData = await waveformGenerator.loadWaveformData(
                {
                    duration_ms: 235520,
                    samples: [0, 0, 25, 34],
                },
                'next-waveform-duration-test'
            );

            expect(waveData.durationSeconds).toBe(235.52);
        });

        test('schedules a normal end-of-track crossfade even without trailing silence', () => {
            const bounds = waveformGenerator.getSilenceBoundaries([20, 30, 40, 30, 20], 100, 5);

            expect(bounds.hasTrailingSilence).toBe(false);
            expect(bounds.crossfadeStartTime).toBe(97);
            expect(bounds.crossfadeDurationSeconds).toBe(3);
        });
    });

    describe('WaveformGenerator.createMaskImageUrl', () => {
        test('keeps a non-empty PNG data URL for Safari CSS masks', () => {
            const dataUrl = `data:image/png;base64,${'a'.repeat(128)}`;
            const canvas = { toDataURL: vi.fn(() => dataUrl) };

            expect(waveformGenerator.createMaskImageUrl(canvas)).toBe(dataUrl);
            expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
        });

        test('rejects an empty canvas export', () => {
            const canvas = { toDataURL: vi.fn(() => 'data:,') };

            expect(waveformGenerator.createMaskImageUrl(canvas)).toBeNull();
        });
    });

    describe('WaveformGenerator.invertWaveformMaskAlpha', () => {
        test('turns SoundCloud transparent waveform pixels opaque and its background transparent', () => {
            const pixels = new Uint8ClampedArray([0, 0, 0, 0, 239, 239, 239, 255]);

            expect(Array.from(waveformGenerator.invertWaveformMaskAlpha(pixels))).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
        });
    });
});
