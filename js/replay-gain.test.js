import { describe, expect, test } from 'bun:test';
import { getReplayGainScale } from './replay-gain.js';

describe('getReplayGainScale', () => {
    test('adds numeric-string gain and preamp values arithmetically', () => {
        const scale = getReplayGainScale(
            { trackReplayGain: '-10', trackPeakAmplitude: '1' },
            { mode: 'track', preampDb: '3' }
        );

        expect(scale).toBeCloseTo(Math.pow(10, -7 / 20), 6);
        expect(scale).toBeGreaterThan(0.4);
    });

    test('retains peak protection after normalizing string metadata', () => {
        const scale = getReplayGainScale(
            { trackReplayGain: '6 dB', trackPeakAmplitude: '0.8' },
            { mode: 'track', preampDb: 0 }
        );

        expect(scale).toBe(1.25);
    });

    test('does not apply ReplayGain or preamp in off mode', () => {
        expect(getReplayGainScale({ trackReplayGain: '-20' }, { mode: 'off', preampDb: 6 })).toBe(1);
    });
});
