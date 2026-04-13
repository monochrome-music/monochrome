// js/hrtf-generator.js
// Procedural HRTF impulse response generation for binaural rendering.
// Synthesizes per-angle stereo IRs modeling ITD, ILD, and head shadow.

const HEAD_RADIUS = 0.0875; // meters (average human head radius)
const SPEED_OF_SOUND = 343; // m/s
const IR_LENGTH = 256; // samples

/**
 * Calculate the interaural time difference (ITD) for a given azimuth.
 * Uses Woodworth's spherical head model.
 * @param {number} azimuthRad - Azimuth in radians (0 = front, positive = right)
 * @returns {number} ITD in seconds (positive = right ear leads)
 */
function calculateITD(azimuthRad) {
    const absAz = Math.abs(azimuthRad);
    if (absAz <= Math.PI / 2) {
        return (HEAD_RADIUS / SPEED_OF_SOUND) * (absAz + Math.sin(absAz));
    }
    // Behind the head
    return (HEAD_RADIUS / SPEED_OF_SOUND) * (Math.PI - absAz + Math.sin(absAz));
}

/**
 * Calculate frequency-dependent ILD (head shadow attenuation) for the far ear.
 * Higher frequencies are attenuated more by the head.
 * @param {number} frequency - Frequency in Hz
 * @param {number} azimuthRad - Absolute azimuth in radians
 * @returns {number} Attenuation factor (0-1) for the shadowed ear
 */
function calculateHeadShadow(frequency, azimuthRad) {
    const absAz = Math.abs(azimuthRad);
    if (absAz < 0.01) return 1.0; // Source in front, no shadow

    // Head shadow increases with frequency and angle
    // Based on simplified spherical head diffraction model
    const ka = (2 * Math.PI * frequency * HEAD_RADIUS) / SPEED_OF_SOUND;
    const shadowFactor = 1.0 / (1.0 + 0.5 * ka * Math.sin(absAz));
    return Math.max(0.05, shadowFactor);
}

/**
 * Generate a single HRTF impulse response for a given azimuth angle.
 * Returns a stereo AudioBuffer: channel 0 = left ear, channel 1 = right ear.
 *
 * @param {AudioContext} audioContext
 * @param {number} azimuthDeg - Azimuth in degrees (-180 to 180, 0 = front, positive = right)
 * @param {number} [elevationDeg=0] - Elevation in degrees (currently simplified)
 * @returns {AudioBuffer} Stereo AudioBuffer with HRTF IR
 */
export function generateHRTF(audioContext, azimuthDeg, elevationDeg = 0) {
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(2, IR_LENGTH, sampleRate);

    const leftData = buffer.getChannelData(0);
    const rightData = buffer.getChannelData(1);

    const azimuthRad = (azimuthDeg * Math.PI) / 180;
    const itd = calculateITD(azimuthRad);
    const itdSamples = Math.round(itd * sampleRate);

    // Determine which ear is ipsilateral (closer to source) and contralateral (farther)
    const sourceOnRight = azimuthDeg > 0;
    const ipsiData = sourceOnRight ? rightData : leftData;
    const contraData = sourceOnRight ? leftData : rightData;

    // Generate ipsilateral (near ear) IR - mostly a delayed impulse with slight coloring
    // Ipsilateral ear (near source) receives sound first; contralateral ear is delayed by ITD
    const ipsiDelay = 0;
    const contraDelay = Math.abs(itdSamples);

    // Create frequency-domain representation for head shadow
    const fftSize = IR_LENGTH;
    const halfFFT = fftSize / 2;

    // Ipsilateral ear: near-flat response with slight high-frequency boost at extreme angles
    for (let i = 0; i < fftSize; i++) {
        const t = i / sampleRate;
        let sum = 0;
        for (let k = 1; k <= halfFFT; k++) {
            const freq = (k * sampleRate) / fftSize;
            const absAz = Math.abs(azimuthRad);

            // Ipsilateral ear gets a slight boost at high frequencies for angles > 30°
            let ipsiGain = 1.0;
            if (absAz > 0.5 && freq > 2000) {
                ipsiGain = 1.0 + 0.15 * Math.min(1, (freq - 2000) / 8000) * Math.sin(absAz);
            }

            // Pinna notch around 8-10kHz (elevation dependent)
            const elevRad = (elevationDeg * Math.PI) / 180;
            const notchFreq = 8000 + elevationDeg * 50; // Shifts with elevation
            const notchWidth = 2000;
            const notchDepth = 0.15 * Math.abs(Math.sin(elevRad + 0.3));
            const notchFactor = 1.0 - notchDepth * Math.exp(-Math.pow((freq - notchFreq) / notchWidth, 2));

            const phase = 2 * Math.PI * freq * (t - ipsiDelay / sampleRate);
            sum += ((ipsiGain * notchFactor) / halfFFT) * Math.cos(phase);
        }
        ipsiData[i] = sum;
    }

    // Contralateral ear: apply head shadow (frequency-dependent attenuation)
    for (let i = 0; i < fftSize; i++) {
        const t = i / sampleRate;
        let sum = 0;
        for (let k = 1; k <= halfFFT; k++) {
            const freq = (k * sampleRate) / fftSize;
            const shadowGain = calculateHeadShadow(freq, azimuthRad);

            const phase = 2 * Math.PI * freq * (t - contraDelay / sampleRate);
            sum += (shadowGain / halfFFT) * Math.cos(phase);
        }
        contraData[i] = sum;
    }

    // Normalize to prevent clipping
    let maxVal = 0;
    for (let i = 0; i < IR_LENGTH; i++) {
        maxVal = Math.max(maxVal, Math.abs(leftData[i]), Math.abs(rightData[i]));
    }
    if (maxVal > 0) {
        const normFactor = 0.9 / maxVal;
        for (let i = 0; i < IR_LENGTH; i++) {
            leftData[i] *= normFactor;
            rightData[i] *= normFactor;
        }
    }

    return buffer;
}

/**
 * HRTF angle presets for virtual speaker configurations.
 */
export const HRTF_PRESETS = {
    intimate: { label: 'Intimate', angleScale: 0.73 }, // ±22° front
    studio: { label: 'Studio', angleScale: 1.0 }, // ±30° front (standard)
    wide: { label: 'Wide', angleScale: 1.5 }, // ±45° front
};

/**
 * Standard 5.1 channel angles (ITU-R BS.775)
 */
export const CHANNEL_ANGLES_51 = [
    { index: 0, name: 'FL', azimuth: -30 },
    { index: 1, name: 'FR', azimuth: 30 },
    { index: 2, name: 'C', azimuth: 0 },
    { index: 3, name: 'LFE', azimuth: 0, isLFE: true },
    { index: 4, name: 'SL', azimuth: -110 },
    { index: 5, name: 'SR', azimuth: 110 },
];

/**
 * Generate a complete set of HRTF impulse responses for 5.1 surround.
 * Each entry contains separate left-ear and right-ear mono AudioBuffers
 * suitable for use with ConvolverNode.
 *
 * @param {AudioContext} audioContext
 * @param {string} [preset='studio'] - HRTF preset name
 * @returns {Promise<Map<number, {left: AudioBuffer, right: AudioBuffer, stereo: AudioBuffer}>>}
 */
export async function generateHRTFSet(audioContext, preset = 'studio') {
    const presetConfig = HRTF_PRESETS[preset] || HRTF_PRESETS.studio;
    const angleScale = presetConfig.angleScale;
    const results = new Map();

    for (const ch of CHANNEL_ANGLES_51) {
        if (ch.isLFE) {
            // LFE: no HRTF, just pass through equally to both ears
            const lfeBuffer = audioContext.createBuffer(2, IR_LENGTH, audioContext.sampleRate);
            const lfeL = lfeBuffer.getChannelData(0);
            const lfeR = lfeBuffer.getChannelData(1);
            // Simple impulse at sample 0
            lfeL[0] = 0.5;
            lfeR[0] = 0.5;
            results.set(ch.index, {
                stereo: lfeBuffer,
                left: extractChannel(audioContext, lfeBuffer, 0),
                right: extractChannel(audioContext, lfeBuffer, 1),
            });
            continue;
        }

        // Scale angle by preset
        const scaledAzimuth = ch.azimuth * angleScale;
        const stereoBuffer = await generateHRTF(audioContext, scaledAzimuth);

        results.set(ch.index, {
            stereo: stereoBuffer,
            left: extractChannel(audioContext, stereoBuffer, 0),
            right: extractChannel(audioContext, stereoBuffer, 1),
        });
    }

    return results;
}

/**
 * Extract a single channel from a stereo buffer into a mono AudioBuffer.
 * ConvolverNode requires the IR buffer channel count to match input or be mono.
 */
function extractChannel(audioContext, stereoBuffer, channelIndex) {
    const mono = audioContext.createBuffer(1, stereoBuffer.length, audioContext.sampleRate);
    mono.copyToChannel(stereoBuffer.getChannelData(channelIndex), 0);
    return mono;
}
