import { expect, test, suite } from 'vitest';
import { LosslessAPI } from './api.js';

suite('manifest formats', () => {
    const api = Object.create(LosslessAPI.prototype) as LosslessAPI;

    test('requests both FLAC variants for lossless playback', () => {
        expect(api.getTrackManifestFormats('LOSSLESS')).toEqual(['FLAC', 'FLAC_HIRES']);
    });

    test('requests both FLAC variants for hi-res playback', () => {
        expect(api.getTrackManifestFormats('HI_RES_LOSSLESS')).toEqual(['FLAC_HIRES', 'FLAC']);
    });
});
