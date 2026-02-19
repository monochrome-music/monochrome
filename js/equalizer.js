// js/equalizer.js
// Parametric Equalizer with Web Audio API - Supports 3-32 bands

import { equalizerSettings } from './storage.js';

// Standard 16-band ISO center frequencies (Hz) - kept for reference
const DEFAULT_EQ_FREQUENCIES = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000];

// Frequency labels for UI display
const DEFAULT_FREQUENCY_LABELS = [
    '25',
    '40',
    '63',
    '100',
    '160',
    '250',
    '400',
    '630',
    '1K',
    '1.6K',
    '2.5K',
    '4K',
    '6.3K',
    '10K',
    '16K',
    '20K',
];

// Generate frequency array for given number of bands using logarithmic spacing
function generateFrequencies(bandCount, minFreq = 20, maxFreq = 20000) {
    const frequencies = [];
    const safeMin = Math.max(10, minFreq);
    const safeMax = Math.min(96000, maxFreq);

    for (let i = 0; i < bandCount; i++) {
        // Logarithmic interpolation
        const t = i / (bandCount - 1);
        const freq = safeMin * Math.pow(safeMax / safeMin, t);
        frequencies.push(Math.round(freq));
    }

    return frequencies;
}

// Generate frequency labels for display
function generateFrequencyLabels(frequencies) {
    return frequencies.map((freq) => {
        if (freq < 1000) {
            return freq.toString();
        } else if (freq < 10000) {
            return (freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1) + 'K';
        } else {
            return (freq / 1000).toFixed(0) + 'K';
        }
    });
}

// EQ Presets (gain values in dB for each of the 16 bands)
const EQ_PRESETS_16BAND = {
    flat: {
        name: 'Flat',
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    bass_boost: {
        name: 'Bass Boost',
        gains: [6, 5, 4.5, 4, 3, 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    bass_reducer: {
        name: 'Bass Reducer',
        gains: [-6, -5, -4, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    treble_boost: {
        name: 'Treble Boost',
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 5.5, 6],
    },
    treble_reducer: {
        name: 'Treble Reducer',
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -2, -3, -4, -5, -5.5, -6],
    },
    vocal_boost: {
        name: 'Vocal Boost',
        gains: [-2, -1, 0, 0, 1, 2, 3, 4, 4, 3, 2, 1, 0, 0, -1, -2],
    },
    loudness: {
        name: 'Loudness',
        gains: [5, 4, 3, 1, 0, -1, -1, 0, 0, 1, 2, 3, 4, 4.5, 4, 3],
    },
    rock: {
        name: 'Rock',
        gains: [4, 3.5, 3, 2, -1, -2, -1, 1, 2, 3, 3.5, 4, 4, 3, 2, 1],
    },
    pop: {
        name: 'Pop',
        gains: [-1, 0, 1, 2, 3, 3, 2, 1, 0, 1, 2, 2, 2, 2, 1, 0],
    },
    classical: {
        name: 'Classical',
        gains: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2],
    },
    jazz: {
        name: 'Jazz',
        gains: [3, 2, 1, 1, -1, -1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2],
    },
    electronic: {
        name: 'Electronic',
        gains: [4, 3.5, 3, 1, 0, -1, 0, 1, 2, 3, 3, 2, 2, 3, 4, 3.5],
    },
    hip_hop: {
        name: 'Hip-Hop',
        gains: [5, 4.5, 4, 3, 1, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2],
    },
    r_and_b: {
        name: 'R&B',
        gains: [3, 5, 4, 2, 1, 0, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1],
    },
    acoustic: {
        name: 'Acoustic',
        gains: [3, 2, 1, 1, 2, 2, 1, 0, 0, 1, 1, 2, 3, 3, 2, 1],
    },
    podcast: {
        name: 'Podcast / Speech',
        gains: [-3, -2, -1, 0, 1, 2, 3, 4, 4, 3, 2, 1, 0, -1, -2, -3],
    },
};

// Interpolate 16-band preset to target band count
function interpolatePreset(preset16, targetBands) {
    if (targetBands === 16) return [...preset16];

    const result = [];
    for (let i = 0; i < targetBands; i++) {
        const sourceIndex = (i / (targetBands - 1)) * (preset16.length - 1);
        const indexLow = Math.floor(sourceIndex);
        const indexHigh = Math.min(Math.ceil(sourceIndex), preset16.length - 1);
        const fraction = sourceIndex - indexLow;

        const lowValue = preset16[indexLow] || 0;
        const highValue = preset16[indexHigh] || 0;
        const interpolated = lowValue + (highValue - lowValue) * fraction;
        result.push(Math.round(interpolated * 10) / 10);
    }
    return result;
}

// Get presets for given band count
function getPresetsForBandCount(bandCount) {
    const presets = {};
    for (const [key, preset] of Object.entries(EQ_PRESETS_16BAND)) {
        presets[key] = {
            name: preset.name,
            gains: interpolatePreset(preset.gains, bandCount),
        };
    }
    return presets;
}

export class Equalizer {
    constructor() {
        this.audioContext = null;
        this.source = null;
        this.filters = [];
        this.inputNode = null;
        this.outputNode = null;
        this.isEnabled = false;
        this.isInitialized = false;
        this.audio = null;

        // Band configuration
        this.bandCount = equalizerSettings.getBandCount();
        this.freqRange = equalizerSettings.getFreqRange();
        this.frequencies = generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        this.frequencyLabels = generateFrequencyLabels(this.frequencies);

        // Store current gains
        this.currentGains = new Array(this.bandCount).fill(0);

        // Store current preamp value
        this.preamp = 0;

        // Load saved settings
        this._loadSettings();
    }

    /**
     * Update band count and reinitialize
     */
    setBandCount(count) {
        const newCount = Math.max(
            equalizerSettings.MIN_BANDS,
            Math.min(equalizerSettings.MAX_BANDS, parseInt(count, 10) || 16)
        );

        if (newCount === this.bandCount) return;

        // Save new band count
        equalizerSettings.setBandCount(newCount);

        // Update configuration
        this.bandCount = newCount;
        this.frequencies = generateFrequencies(newCount, this.freqRange.min, this.freqRange.max);
        this.frequencyLabels = generateFrequencyLabels(this.frequencies);

        // Interpolate current gains to new band count
        const newGains = equalizerSettings._interpolateGains(this.currentGains, newCount);
        this.currentGains = newGains;
        equalizerSettings.setGains(newGains);

        // Reinitialize if already initialized
        if (this.isInitialized) {
            this.destroy();
            if (this.audioContext && this.source && this.audio) {
                this.init(this.audioContext, this.source, this.audio);
            }
        }

        // Dispatch event for UI update
        window.dispatchEvent(
            new CustomEvent('equalizer-band-count-changed', {
                detail: { bandCount: newCount, frequencies: this.frequencies, labels: this.frequencyLabels },
            })
        );
    }

    /**
     * Update frequency range and reinitialize
     */
    setFreqRange(minFreq, maxFreq) {
        const newMin = Math.max(10, Math.min(96000, parseInt(minFreq, 10) || 20));
        const newMax = Math.max(10, Math.min(96000, parseInt(maxFreq, 10) || 20000));

        if (newMin >= newMax) {
            console.warn('[Equalizer] Invalid frequency range: min must be less than max');
            return false;
        }

        if (newMin === this.freqRange.min && newMax === this.freqRange.max) return true;

        // Save new frequency range
        equalizerSettings.setFreqRange(newMin, newMax);

        // Update configuration
        this.freqRange = { min: newMin, max: newMax };
        this.frequencies = generateFrequencies(this.bandCount, newMin, newMax);
        this.frequencyLabels = generateFrequencyLabels(this.frequencies);

        // Reinitialize if already initialized
        if (this.isInitialized) {
            this.destroy();
            if (this.audioContext && this.source && this.audio) {
                this.init(this.audioContext, this.source, this.audio);
            }
        }

        // Dispatch event for UI update
        window.dispatchEvent(
            new CustomEvent('equalizer-freq-range-changed', {
                detail: { min: newMin, max: newMax, frequencies: this.frequencies, labels: this.frequencyLabels },
            })
        );

        return true;
    }

    /**
     * Initialize the equalizer with a shared AudioContext
     * This should be called after the visualizer creates the context
     * @param {AudioContext} audioContext - Shared audio context
     * @param {AudioNode} sourceNode - The MediaElementSource node
     * @param {HTMLAudioElement} audioElement - The audio element
     */
    init(audioContext, sourceNode, audioElement) {
        if (this.isInitialized) return;

        try {
            this.audioContext = audioContext;
            this.source = sourceNode;
            this.audio = audioElement;

            // Create biquad filters for each frequency band
            this.filters = this.frequencies.map((freq, index) => {
                const filter = this.audioContext.createBiquadFilter();

                // Use peaking filter for all bands (best for EQ)
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = this._calculateQ(index);
                filter.gain.value = this.currentGains[index] || 0;

                return filter;
            });

            // Create input/output gain nodes for bypass switching
            this.inputNode = this.audioContext.createGain();
            this.outputNode = this.audioContext.createGain();

            // Create preamp gain node
            this.preampNode = this.audioContext.createGain();
            this._updatePreampGain();

            // Connect the filter chain
            this._connectFilters();

            this.isInitialized = true;

            // Apply saved enabled state
            if (this.isEnabled) {
                this._enableFilters();
            }

            console.log(`[Equalizer] Initialized with ${this.bandCount} bands`);
        } catch (e) {
            console.warn('[Equalizer] Init failed:', e);
        }
    }

    /**
     * Calculate Q factor for each band
     * Using constant-Q design for consistent bandwidth
     */
    _calculateQ(_index) {
        // For 16-band 1/2 octave spacing, Q ≈ 2.87
        // Slightly lower Q for smoother response
        // Scale Q based on band count for consistent sound
        const baseQ = 2.5;
        const scalingFactor = Math.sqrt(16 / this.bandCount);
        return baseQ * scalingFactor;
    }

    /**
     * Connect all filters in series
     */
    _connectFilters() {
        if (!this.filters.length) return;

        // Connect preamp to first filter
        if (this.preampNode) {
            this.preampNode.connect(this.filters[0]);
        }

        // Chain filters together
        for (let i = 0; i < this.filters.length - 1; i++) {
            this.filters[i].connect(this.filters[i + 1]);
        }

        // Connect last filter to output
        this.filters[this.filters.length - 1].connect(this.outputNode);
    }

    /**
     * Enable the EQ processing
     */
    _enableFilters() {
        if (!this.isInitialized || !this.source) return;

        // Note: The actual connection handling is done by the visualizer
        // This just marks the EQ as enabled
        this.isEnabled = true;
    }

    /**
     * Disable the EQ (bypass)
     */
    _disableFilters() {
        this.isEnabled = false;
    }

    /**
     * Get the input node for external connection
     */
    getInputNode() {
        return this.preampNode || this.filters[0] || null;
    }

    /**
     * Get the output node
     */
    getOutputNode() {
        return this.outputNode;
    }

    /**
     * Check if EQ is active (enabled and initialized)
     */
    isActive() {
        return this.isInitialized && this.isEnabled;
    }

    /**
     * Toggle EQ on/off
     */
    toggle(enabled) {
        this.isEnabled = enabled;
        equalizerSettings.setEnabled(enabled);

        if (enabled) {
            this._enableFilters();
        } else {
            this._disableFilters();
        }

        // Dispatch event for visualizer to reconnect
        window.dispatchEvent(
            new CustomEvent('equalizer-toggle', {
                detail: { enabled },
            })
        );

        return this.isEnabled;
    }

    /**
     * Get current gain range from settings
     */
    getRange() {
        return equalizerSettings.getRange();
    }

    /**
     * Clamp gain to current range
     */
    _clampGain(gainDb) {
        const range = this.getRange();
        return Math.max(range.min, Math.min(range.max, gainDb));
    }

    /**
     * Set gain for a specific band
     * @param {number} bandIndex - Band index
     * @param {number} gainDb - Gain in dB
     */
    setBandGain(bandIndex, gainDb) {
        if (bandIndex < 0 || bandIndex >= this.bandCount) return;

        // Clamp gain to valid range
        const clampedGain = this._clampGain(gainDb);
        this.currentGains[bandIndex] = clampedGain;

        if (this.filters[bandIndex]) {
            // Smooth transition for clicks prevention
            const now = this.audioContext?.currentTime || 0;
            this.filters[bandIndex].gain.setTargetAtTime(clampedGain, now, 0.01);
        }

        // Save to storage
        equalizerSettings.setGains(this.currentGains);
    }

    /**
     * Set all band gains at once
     * @param {number[]} gains - Array of gain values in dB
     */
    setAllGains(gains) {
        if (!Array.isArray(gains)) return;

        // Ensure gains array matches current band count
        let adjustedGains = gains;
        if (gains.length !== this.bandCount) {
            adjustedGains = equalizerSettings._interpolateGains(gains, this.bandCount);
        }

        const now = this.audioContext?.currentTime || 0;

        adjustedGains.forEach((gain, index) => {
            const clampedGain = this._clampGain(gain);
            this.currentGains[index] = clampedGain;

            if (this.filters[index]) {
                this.filters[index].gain.setTargetAtTime(clampedGain, now, 0.01);
            }
        });

        equalizerSettings.setGains(this.currentGains);
    }

    /**
     * Apply a preset
     * @param {string} presetKey - Key from EQ_PRESETS
     */
    applyPreset(presetKey) {
        const presets = getPresetsForBandCount(this.bandCount);
        const preset = presets[presetKey];
        if (!preset) return;

        this.setAllGains(preset.gains);
        equalizerSettings.setPreset(presetKey);
    }

    /**
     * Reset all bands to flat (0 dB)
     */
    reset() {
        this.setAllGains(new Array(this.bandCount).fill(0));
        equalizerSettings.setPreset('flat');
    }

    /**
     * Get current gains
     * @returns {number[]} Array of gain values
     */
    getGains() {
        return [...this.currentGains];
    }

    /**
     * Get current band count
     * @returns {number} Number of bands
     */
    getBandCount() {
        return this.bandCount;
    }

    /**
     * Get frequency labels for UI
     * @returns {string[]} Array of frequency labels
     */
    getFrequencyLabels() {
        return this.frequencyLabels;
    }

    /**
     * Get frequencies
     * @returns {number[]} Array of frequency values
     */
    getFrequencies() {
        return this.frequencies;
    }

    /**
     * Get available presets (static method for default 16 bands)
     */
    static getPresets(bandCount = 16) {
        return getPresetsForBandCount(bandCount);
    }

    /**
     * Load settings from storage
     */
    _loadSettings() {
        this.isEnabled = equalizerSettings.isEnabled();
        this.bandCount = equalizerSettings.getBandCount();
        this.freqRange = equalizerSettings.getFreqRange();
        this.frequencies = generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        this.frequencyLabels = generateFrequencyLabels(this.frequencies);
        this.currentGains = equalizerSettings.getGains(this.bandCount);
        this.preamp = equalizerSettings.getPreamp();
    }

    /**
     * Update preamp gain value
     * @private
     */
    _updatePreampGain() {
        if (this.preampNode && this.audioContext) {
            const gainValue = Math.pow(10, this.preamp / 20);
            const now = this.audioContext.currentTime;
            this.preampNode.gain.setTargetAtTime(gainValue, now, 0.01);
        }
    }

    /**
     * Set preamp value in dB
     * @param {number} db - Preamp value in dB (-20 to +20)
     */
    setPreamp(db) {
        const clampedDb = Math.max(-20, Math.min(20, parseFloat(db) || 0));
        this.preamp = clampedDb;
        equalizerSettings.setPreamp(clampedDb);
        this._updatePreampGain();
    }

    /**
     * Get current preamp value
     * @returns {number} Current preamp value in dB
     */
    getPreamp() {
        return this.preamp;
    }

    /**
     * Destroy the equalizer
     */
    destroy() {
        this.filters.forEach((filter) => {
            try {
                filter.disconnect();
            } catch {
                /* ignore */
            }
        });

        try {
            this.inputNode?.disconnect();
        } catch {
            /* ignore */
        }
        try {
            this.outputNode?.disconnect();
        } catch {
            /* ignore */
        }
        try {
            this.preampNode?.disconnect();
        } catch {
            /* ignore */
        }

        this.filters = [];
        this.inputNode = null;
        this.outputNode = null;
        this.preampNode = null;
        this.isInitialized = false;
    }

    /**
     * Export equalizer settings to text format
     * @returns {string} Exported settings in text format
     */
    exportToText() {
        const lines = [];
        lines.push(`Preamp: ${this.preamp.toFixed(1)} dB`);

        this.frequencies.forEach((freq, index) => {
            const gain = this.currentGains[index] || 0;
            const filterNum = index + 1;
            lines.push(`Filter ${filterNum}: ON PK Fc ${freq} Hz Gain ${gain.toFixed(1)} dB Q 0.71`);
        });

        return lines.join('\n');
    }

    /**
     * Import equalizer settings from text format
     * @param {string} text - Text format settings
     * @returns {boolean} True if import was successful
     */
    importFromText(text) {
        try {
            const lines = text
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line);
            const filters = [];
            let preamp = 0;

            for (const line of lines) {
                // Parse preamp
                const preampMatch = line.match(/^Preamp:\s*([+-]?\d+\.?\d*)\s*dB$/i);
                if (preampMatch) {
                    preamp = parseFloat(preampMatch[1]);
                    continue;
                }

                // Parse filter lines (handle "Filter:" and "Filter X:" formats)
                const filterMatch = line.match(
                    /^Filter\s*\d*:\s*ON\s+(\w+)\s+Fc\s+(\d+)\s+Hz\s+Gain\s*([+-]?\d+\.?\d*)\s*dB\s+Q\s+(\d+\.?\d*)/i
                );
                if (filterMatch) {
                    const type = filterMatch[1].toUpperCase();
                    const freq = parseInt(filterMatch[2], 10);
                    const gain = parseFloat(filterMatch[3]);
                    const q = parseFloat(filterMatch[4]);
                    filters.push({ type, freq, gain, q });
                }
            }

            if (filters.length === 0) {
                console.warn('[Equalizer] No valid filters found in import text');
                return false;
            }

            // Apply preamp
            this.setPreamp(preamp);

            // If different number of bands, adjust
            if (filters.length !== this.bandCount) {
                const newCount = Math.max(
                    equalizerSettings.MIN_BANDS,
                    Math.min(equalizerSettings.MAX_BANDS, filters.length)
                );
                this.setBandCount(newCount);
            }

            // Extract gains from filters
            const gains = filters.slice(0, this.bandCount).map((f) => f.gain);
            this.setAllGains(gains);

            // Store filter frequencies if different
            const newFreqs = filters.slice(0, this.bandCount).map((f) => f.freq);
            if (JSON.stringify(newFreqs) !== JSON.stringify(this.frequencies)) {
                equalizerSettings.setFreqRange(newFreqs[0], newFreqs[newFreqs.length - 1]);
            }

            return true;
        } catch (e) {
            console.warn('[Equalizer] Failed to import settings:', e);
            return false;
        }
    }
}

// Export singleton instance
export const equalizer = new Equalizer();

// Export helper functions and constants
export {
    generateFrequencies,
    generateFrequencyLabels,
    getPresetsForBandCount,
    interpolatePreset,
    DEFAULT_EQ_FREQUENCIES,
    DEFAULT_FREQUENCY_LABELS,
    EQ_PRESETS_16BAND as EQ_PRESETS,
};
