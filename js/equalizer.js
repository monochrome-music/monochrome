// js/equalizer.js
// 16-Band Parametric Equalizer with Web Audio API

import { equalizerSettings } from './storage.js';

// Standard 16-band ISO center frequencies (Hz)
const EQ_FREQUENCIES = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000];

// Frequency labels for UI display
const FREQUENCY_LABELS = [
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

// EQ Presets (gain values in dB for each of the 16 bands)
const EQ_PRESETS = {
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

        // Store current gains
        this.currentGains = new Array(16).fill(0);

        // Load saved settings
        this._loadSettings();
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

            // Create 16 biquad filters for each frequency band
            this.filters = EQ_FREQUENCIES.map((freq, index) => {
                const filter = this.audioContext.createBiquadFilter();

                // Use peaking filter for all bands (best for EQ)
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = this._calculateQ(index);
                filter.gain.value = this.currentGains[index];

                return filter;
            });

            // Create input/output gain nodes for bypass switching
            this.inputNode = this.audioContext.createGain();
            this.outputNode = this.audioContext.createGain();

            // Connect the filter chain
            this._connectFilters();

            this.isInitialized = true;

            // Apply saved enabled state
            if (this.isEnabled) {
                this._enableFilters();
            }

            console.log('[Equalizer] Initialized with 16 bands');
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
        return 2.5;
    }

    /**
     * Connect all filters in series
     */
    _connectFilters() {
        if (!this.filters.length) return;

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
        return this.filters[0] || null;
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
     * Set gain for a specific band
     * @param {number} bandIndex - Band index (0-15)
     * @param {number} gainDb - Gain in dB (-12 to +12)
     */
    setBandGain(bandIndex, gainDb) {
        if (bandIndex < 0 || bandIndex >= 16) return;

        // Clamp gain to valid range
        const clampedGain = Math.max(-30, Math.min(30, gainDb));
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
     * @param {number[]} gains - Array of 16 gain values in dB
     */
    setAllGains(gains) {
        if (!Array.isArray(gains) || gains.length !== 16) return;

        const now = this.audioContext?.currentTime || 0;

        gains.forEach((gain, index) => {
            const clampedGain = Math.max(-30, Math.min(30, gain));
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
        const preset = EQ_PRESETS[presetKey];
        if (!preset) return;

        this.setAllGains(preset.gains);
        equalizerSettings.setPreset(presetKey);
    }

    /**
     * Reset all bands to flat (0 dB)
     */
    reset() {
        this.setAllGains(new Array(16).fill(0));
        equalizerSettings.setPreset('flat');
    }

    /**
     * Get current gains
     * @returns {number[]} Array of 16 gain values
     */
    getGains() {
        return [...this.currentGains];
    }

    /**
     * Get frequency labels
     */
    static getFrequencyLabels() {
        return FREQUENCY_LABELS;
    }

    /**
     * Get frequencies
     */
    static getFrequencies() {
        return EQ_FREQUENCIES;
    }

    /**
     * Get available presets
     */
    static getPresets() {
        return EQ_PRESETS;
    }

    /**
     * Load settings from storage
     */
    _loadSettings() {
        this.isEnabled = equalizerSettings.isEnabled();
        this.currentGains = equalizerSettings.getGains();
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

        this.filters = [];
        this.inputNode = null;
        this.outputNode = null;
        this.isInitialized = false;
    }
}

// Export singleton instance
export const equalizer = new Equalizer();

// Export constants
export { EQ_FREQUENCIES, FREQUENCY_LABELS, EQ_PRESETS };
