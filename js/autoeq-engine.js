// js/autoeq-engine.js
// AutoEQ Algorithm - Ported from Seap Engine AutoEqEngine.ts
// Iterative peak-flattening parametric EQ optimization

// Constants
const MAX_BOOST = 30.0;
const MAX_CUT = 30.0;
const MIN_Q = 0.6;
const DEFAULT_SR = 48000;
const PI = Math.PI;
const DB_BASE = 10;
const DB_DIVISOR = 40;

/**
 * Calculate biquad filter magnitude response at a given frequency
 * @param {number} f - Frequency to evaluate (Hz)
 * @param {object} band - EQ band {type, freq, gain, q, enabled}
 * @param {number} sr - Sample rate
 * @returns {number} Magnitude in dB
 */
function calculateBiquadResponse(f, band, sr = DEFAULT_SR) {
    if (!band.enabled) return 0;
    if (!band.type || band.type.length === 0) return 0;
    const w = (2 * PI * band.freq) / sr;
    const p = (2 * PI * f) / sr;
    const t = band.type[0];
    const effectiveQ = band.q;
    const s = Math.sin(w) / (2 * effectiveQ);
    const A = Math.pow(DB_BASE, band.gain / DB_DIVISOR);
    const c = Math.cos(w);
    let b0 = 0,
        b1 = 0,
        b2 = 0,
        a0 = 0,
        a1 = 0,
        a2 = 0;

    if (t === 'p') {
        b0 = 1 + s * A;
        b1 = -2 * c;
        b2 = 1 - s * A;
        a0 = 1 + s / A;
        a1 = -2 * c;
        a2 = 1 - s / A;
    } else if (t === 'l') {
        const sq = 2 * Math.sqrt(A) * s;
        b0 = A * (A + 1 - (A - 1) * c + sq);
        b1 = 2 * A * (A - 1 - (A + 1) * c);
        b2 = A * (A + 1 - (A - 1) * c - sq);
        a0 = A + 1 + (A - 1) * c + sq;
        a1 = -2 * (A - 1 + (A + 1) * c);
        a2 = A + 1 + (A - 1) * c - sq;
    } else if (t === 'h') {
        const sq = 2 * Math.sqrt(A) * s;
        b0 = A * (A + 1 + (A - 1) * c + sq);
        b1 = -2 * A * (A - 1 + (A + 1) * c);
        b2 = A * (A + 1 + (A - 1) * c - sq);
        a0 = A + 1 - (A - 1) * c + sq;
        a1 = 2 * (A - 1 - (A + 1) * c);
        a2 = A + 1 - (A - 1) * c - sq;
    } else {
        return 0;
    }

    const _a0 = 1 / a0;
    const b0n = b0 * _a0,
        b1n = b1 * _a0,
        b2n = b2 * _a0;
    const a1n = a1 * _a0,
        a2n = a2 * _a0;
    const cp = Math.cos(p),
        c2p = Math.cos(2 * p);
    const n = b0n * b0n + b1n * b1n + b2n * b2n + 2 * (b0n * b1n + b1n * b2n) * cp + 2 * b0n * b2n * c2p;
    const d = 1 + a1n * a1n + a2n * a2n + 2 * (a1n + a1n * a2n) * cp + 2 * a2n * c2p;
    return 10 * Math.log10(n / d);
}

/**
 * Linear interpolation on frequency response data
 * @param {number} freq - Frequency to interpolate at
 * @param {Array<{freq: number, gain: number}>} data - Frequency response data
 * @returns {number} Interpolated gain value
 */
function interpolate(freq, data) {
    if (data.length === 0) return 0;
    if (freq <= data[0].freq) return data[0].gain;
    if (freq >= data[data.length - 1].freq) return data[data.length - 1].gain;
    for (let i = 0; i < data.length - 1; i++) {
        if (freq >= data[i].freq && freq <= data[i + 1].freq) {
            return (
                data[i].gain +
                ((freq - data[i].freq) / (data[i + 1].freq - data[i].freq)) * (data[i + 1].gain - data[i].gain)
            );
        }
    }
    return 0;
}

/**
 * Calculate normalization offset based on midrange average (250-2500 Hz)
 * With one argument: returns the midrange average of that curve (for graph centering).
 * With two arguments: evaluates both curves on the measurement frequency grid
 * to avoid sampling-density bias, returning (avgTarget - avgMeasurement).
 * @param {Array<{freq: number, gain: number}>} measurement - Measurement/data curve
 * @param {Array<{freq: number, gain: number}>} [target] - Optional target curve
 * @returns {number} Midrange average, or alignment offset when target is provided
 */
function getNormalizationOffset(measurement, target) {
    if (!target) {
        let sum = 0,
            count = 0;
        for (const p of measurement) {
            if (p.freq >= 250 && p.freq <= 2500) {
                sum += p.gain;
                count++;
            }
        }
        return count > 0 ? sum / count : interpolate(1000, measurement);
    }
    let sumTarget = 0,
        sumMeasurement = 0,
        count = 0;
    for (const p of measurement) {
        if (p.freq >= 250 && p.freq <= 2500) {
            sumTarget += interpolate(p.freq, target);
            sumMeasurement += p.gain;
            count++;
        }
    }
    if (count > 0) return sumTarget / count - sumMeasurement / count;
    return interpolate(1000, target) - interpolate(1000, measurement);
}

/**
 * Run the AutoEQ algorithm to generate parametric EQ bands
 * Iterative peak-flattening: finds largest error, places a corrective filter, repeats
 *
 * @param {Array<{freq: number, gain: number}>} measurement - Headphone frequency response
 * @param {Array<{freq: number, gain: number}>} target - Target frequency response curve
 * @param {number} bandCount - Number of EQ bands to generate
 * @param {number} maxFreq - Maximum frequency limit (Hz)
 * @param {number} minFreq - Minimum frequency limit (Hz)
 * @param {number} maxQ - Maximum Q factor
 * @returns {Array<{id: number, type: string, freq: number, gain: number, q: number, enabled: boolean}>}
 */
function runAutoEqAlgorithm(
    measurement,
    target,
    bandCount,
    maxFreq = 16000,
    minFreq = 20,
    maxQ = 5.0,
    sampleRate = DEFAULT_SR
) {
    if (minFreq > maxFreq) return [];
    const off = getNormalizationOffset(measurement, target);
    let err = measurement.map((p) => ({ freq: p.freq, gain: p.gain + off - interpolate(p.freq, target) }));

    const hasInRangePoints = err.some((p) => p.freq >= minFreq && p.freq <= maxFreq);
    if (!hasInRangePoints) return [];

    const out = [];

    for (let i = 0; i < bandCount; i++) {
        let maxDev = 0,
            maxWeightedDev = 0,
            peakFreq = 1000,
            peakIdx = 0;

        // Scan for maximum weighted error
        for (let j = 0; j < err.length; j++) {
            const p = err[j];
            if (p.freq < minFreq || p.freq > maxFreq) continue;

            // 3-point smoothing
            let v = p.gain;
            if (j > 0 && j < err.length - 1) {
                v = (err[j - 1].gain + v + err[j + 1].gain) / 3;
            }

            // Frequency-dependent weighting
            let w = 1.0;
            if (p.freq < 300) w = 1.5;
            else if (p.freq < 4000) w = 1.0;
            else if (p.freq < 8000) w = 0.5;
            else w = 0.25;

            if (Math.abs(v * w) > Math.abs(maxWeightedDev)) {
                maxWeightedDev = Math.abs(v * w);
                maxDev = v;
                peakFreq = p.freq;
                peakIdx = j;
            }
        }

        let gain = -maxDev;

        // Safety clamps - reduce max boost at higher frequencies
        let safeBoost = MAX_BOOST;
        if (peakFreq > 3000) safeBoost = 6.0;
        if (peakFreq > 6000) safeBoost = 3.0;
        if (gain > safeBoost) gain = safeBoost;
        if (gain < -MAX_CUT) gain = -MAX_CUT;
        if (Math.abs(gain) < 0.2) break;

        // Q factor calculation from error bandwidth (half-gain points)
        let upperFreq = peakFreq,
            lowerFreq = peakFreq;
        let foundLower = false,
            foundUpper = false;
        const thresholdError = maxDev / 2;
        for (let k = peakIdx; k >= 0; k--) {
            if (Math.abs(err[k].gain) < Math.abs(thresholdError)) {
                lowerFreq = err[k].freq;
                foundLower = true;
                break;
            }
        }
        for (let k = peakIdx; k < err.length; k++) {
            if (Math.abs(err[k].gain) < Math.abs(thresholdError)) {
                upperFreq = err[k].freq;
                foundUpper = true;
                break;
            }
        }

        // If half-gain boundary not found on one side, mirror the other side
        // to avoid degenerate bandwidth = 0 producing extremely narrow filters
        if (!foundLower && foundUpper) {
            lowerFreq = (peakFreq * peakFreq) / upperFreq;
        } else if (!foundUpper && foundLower) {
            upperFreq = (peakFreq * peakFreq) / lowerFreq;
        } else if (!foundLower && !foundUpper) {
            // Neither boundary found - use 1 octave default
            lowerFreq = peakFreq / Math.SQRT2;
            upperFreq = peakFreq * Math.SQRT2;
        }

        let bandwidth = Math.log2(upperFreq / Math.max(1, lowerFreq));
        if (bandwidth < 0.1) bandwidth = 0.1;
        let q = Math.sqrt(Math.pow(2, bandwidth)) / (Math.pow(2, bandwidth) - 1);
        q = Math.max(MIN_Q, Math.min(maxQ, q));
        if (peakFreq > 5000 && q > 3.0) q = 3.0;
        if (gain > 0 && q > 2.0) q = 2.0;

        const newBand = { id: i, type: 'peaking', freq: peakFreq, gain, q, enabled: true, channel: 'stereo' };

        // Check cumulative gain at the peak frequency across all existing bands + this one
        let cumulativeGain = gain;
        for (const existing of out) {
            cumulativeGain += calculateBiquadResponse(peakFreq, existing, sampleRate);
        }
        // If cumulative boost exceeds safe limits, reduce this band's gain
        const cumulativeLimit = MAX_BOOST;
        if (cumulativeGain > cumulativeLimit) {
            newBand.gain = gain - (cumulativeGain - cumulativeLimit);
            if (newBand.gain < 0.2) continue;
        }

        out.push(newBand);

        // Update error curve by applying the new band's response
        err = err.map((p) => ({ ...p, gain: p.gain + calculateBiquadResponse(p.freq, newBand, sampleRate) }));
    }

    return out.sort((a, b) => a.freq - b.freq).map((b, i) => ({ ...b, id: i }));
}

export { calculateBiquadResponse, interpolate, getNormalizationOffset, runAutoEqAlgorithm };
