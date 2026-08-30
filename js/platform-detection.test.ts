import { describe, expect, test } from 'vitest';
import { canBrowserStreamAtmosQuality, getAmazonDecrypterCodec } from './platform-detection.js';

describe('getAmazonDecrypterCodec', () => {
    test('uses seekable segmented HLS for lossless Firefox playback', () => {
        expect(getAmazonDecrypterCodec('LOSSLESS', { isFirefox: true, isSafari: false })).toBe('flac-hls');
        expect(getAmazonDecrypterCodec('HI_RES_LOSSLESS', { isFirefox: true, isSafari: false })).toBe('flac-hls');
    });

    test('keeps the existing Safari HLS and default fragmented MP4 paths', () => {
        expect(getAmazonDecrypterCodec('LOSSLESS', { isFirefox: false, isSafari: true })).toBe('flac-hls');
        expect(getAmazonDecrypterCodec('LOSSLESS', { isFirefox: false, isSafari: false })).toBe('flac');
    });

    test('keeps Opus qualities in their MP4 container on every browser', () => {
        expect(getAmazonDecrypterCodec('HIGH', { isFirefox: true, isSafari: false })).toBe('opus');
        expect(getAmazonDecrypterCodec('SD_HIGH', { isFirefox: false, isSafari: true })).toBe('opus');
        expect(getAmazonDecrypterCodec('SD_LOW', { isFirefox: false, isSafari: false })).toBe('opus');
    });

    test('preserves the requested immersive codec in decrypted MP4', () => {
        expect(getAmazonDecrypterCodec('DOLBY_ATMOS_EAC3_HIGH')).toBe('eac3');
        expect(getAmazonDecrypterCodec('DOLBY_ATMOS_EAC3_LOW')).toBe('eac3');
        expect(getAmazonDecrypterCodec('DOLBY_ATMOS_AC4_HIGH')).toBe('ac4');
        expect(getAmazonDecrypterCodec('DOLBY_ATMOS_AC4_LOW')).toBe('ac4');
    });

    test('uses the browser codec probe for immersive streaming support', () => {
        const unsupported = { canPlayType: () => '' } as HTMLMediaElement;
        const supported = {
            canPlayType: (mime: string) => (mime.includes('ac-4') || mime.includes('ec-3') ? 'probably' : ''),
        } as HTMLMediaElement;

        expect(canBrowserStreamAtmosQuality('DOLBY_ATMOS_AC4_HIGH', unsupported)).toBe(false);
        expect(canBrowserStreamAtmosQuality('DOLBY_ATMOS_AC4_LOW', supported)).toBe(true);
        expect(canBrowserStreamAtmosQuality('DOLBY_ATMOS_EAC3_HIGH', unsupported)).toBe(false);
        expect(canBrowserStreamAtmosQuality('DOLBY_ATMOS_EAC3_LOW', supported)).toBe(true);
        expect(canBrowserStreamAtmosQuality('LOSSLESS', unsupported)).toBe(true);
    });
});
