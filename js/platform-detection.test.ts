import { describe, expect, test } from 'vitest';
import { canBrowserStreamAtmosQuality } from './platform-detection.js';

describe('canBrowserStreamAtmosQuality', () => {
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
