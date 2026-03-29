// js/audio-context.js
// Shared Audio Context Manager - handles EQ and provides context for visualizer
// Supports 3-32 parametric EQ bands

import { isIos } from './platform-detection.js';
import { equalizerSettings, monoAudioSettings } from './storage.js';

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

// EQ Presets (16-band default)
const EQ_PRESETS_16 = {
    flat: { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    bass_boost: { name: 'Bass Boost', gains: [6, 5, 4.5, 4, 3, 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0] },
    bass_reducer: { name: 'Bass Reducer', gains: [-6, -5, -4, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    treble_boost: { name: 'Treble Boost', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 5.5, 6] },
    treble_reducer: { name: 'Treble Reducer', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -2, -3, -4, -5, -5.5, -6] },
    vocal_boost: { name: 'Vocal Boost', gains: [-2, -1, 0, 0, 1, 2, 3, 4, 4, 3, 2, 1, 0, 0, -1, -2] },
    loudness: { name: 'Loudness', gains: [5, 4, 3, 1, 0, -1, -1, 0, 0, 1, 2, 3, 4, 4.5, 4, 3] },
    rock: { name: 'Rock', gains: [4, 3.5, 3, 2, -1, -2, -1, 1, 2, 3, 3.5, 4, 4, 3, 2, 1] },
    pop: { name: 'Pop', gains: [-1, 0, 1, 2, 3, 3, 2, 1, 0, 1, 2, 2, 2, 2, 1, 0] },
    classical: { name: 'Classical', gains: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2] },
    jazz: { name: 'Jazz', gains: [3, 2, 1, 1, -1, -1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2] },
    electronic: { name: 'Electronic', gains: [4, 3.5, 3, 1, 0, -1, 0, 1, 2, 3, 3, 2, 2, 3, 4, 3.5] },
    hip_hop: { name: 'Hip-Hop', gains: [5, 4.5, 4, 3, 1, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2] },
    r_and_b: { name: 'R&B', gains: [3, 5, 4, 2, 1, 0, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1] },
    acoustic: { name: 'Acoustic', gains: [3, 2, 1, 1, 2, 2, 1, 0, 0, 1, 1, 2, 3, 3, 2, 1] },
    podcast: { name: 'Podcast / Speech', gains: [-3, -2, -1, 0, 1, 2, 3, 4, 4, 3, 2, 1, 0, -1, -2, -3] },
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
    for (const [key, preset] of Object.entries(EQ_PRESETS_16)) {
        presets[key] = {
            name: preset.name,
            gains: interpolatePreset(preset.gains, bandCount),
        };
    }
    return presets;
}

// Default export for backwards compatibility (16 bands)
const EQ_PRESETS = EQ_PRESETS_16;

// Standard 16-band ISO-like log-spaced frequencies (20Hz – 20kHz)
const STANDARD_16_FREQS = generateFrequencies(16, 20, 20000);

// Factory profiles: full profile objects for each built-in preset
const EQ_BUILT_IN_PROFILES = Object.fromEntries(
    Object.entries(EQ_PRESETS_16).map(([key, preset]) => [
        key,
        {
            name: preset.name,
            bandCount: 16,
            frequencies: [...STANDARD_16_FREQS],
            gains: [...preset.gains],
            qValues: null,
            filterTypes: null,
            preamp: 0,
        },
    ])
);

class AudioContextManager {
    constructor() {
        this.audioContext = null;
        this.source = null;
        this.sources = new Map();
        this.analyser = null;
        this.filters = [];
        this.outputNode = null;
        this.volumeNode = null;
        this.isInitialized = false;
        this.isEQEnabled = false;
        this.isMonoAudioEnabled = false;
        this.monoMergerNode = null;
        this.audio = null;
        this.currentVolume = 1.0;

        // Band configuration
        this.bandCount = equalizerSettings.getBandCount();
        this.freqRange = equalizerSettings.getFreqRange();
        this.frequencies = generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        this.currentGains = new Array(this.bandCount).fill(0);

        // Custom per-band Q and filter types (null = use uniform defaults)
        this.bandQValues = null;
        this.bandFilterTypes = null;

        // Callbacks for audio graph changes (for visualizers like Butterchurn)
        this._graphChangeCallbacks = [];

        // Load saved settings
        this._loadSettings();
    }

    /**
     * Update band count and reinitialize EQ
     */
    setBandCount(count) {
        const newCount = Math.max(
            equalizerSettings.MIN_BANDS,
            Math.min(equalizerSettings.MAX_BANDS, parseInt(count, 10) || 16)
        );

        if (newCount === this.bandCount) return;

        // Save new band count
        equalizerSettings.setBandCount(newCount);

        // Clear custom per-band data — back to uniform log-spaced EQ
        this.bandQValues = null;
        this.bandFilterTypes = null;

        // Update configuration
        this.bandCount = newCount;
        this.frequencies = generateFrequencies(newCount, this.freqRange.min, this.freqRange.max);

        // Interpolate current gains to new band count
        const newGains = equalizerSettings._interpolateGains(this.currentGains, newCount);
        this.currentGains = newGains;
        equalizerSettings.setGains(newGains);

        // Reinitialize EQ if already initialized
        if (this.isInitialized && this.audioContext) {
            this._destroyEQ();
            this._createEQ();
            // Reconnect the audio graph without interrupting playback
            this._connectGraph();
        }

        // Dispatch event for UI update
        window.dispatchEvent(
            new CustomEvent('equalizer-band-count-changed', {
                detail: { bandCount: newCount, frequencies: this.frequencies },
            })
        );
    }

    /**
     * Update frequency range and reinitialize EQ
     */
    setFreqRange(minFreq, maxFreq) {
        const newMin = Math.max(10, Math.min(96000, parseInt(minFreq, 10) || 20));
        const newMax = Math.max(10, Math.min(96000, parseInt(maxFreq, 10) || 20000));

        if (newMin >= newMax) {
            console.warn('[AudioContext] Invalid frequency range: min must be less than max');
            return false;
        }

        if (newMin === this.freqRange.min && newMax === this.freqRange.max) return true;

        // Save new frequency range
        equalizerSettings.setFreqRange(newMin, newMax);

        // Clear custom per-band data — back to uniform log-spaced EQ
        this.bandQValues = null;
        this.bandFilterTypes = null;

        // Update configuration
        this.freqRange = { min: newMin, max: newMax };
        this.frequencies = generateFrequencies(this.bandCount, newMin, newMax);

        // Reinitialize EQ if already initialized
        if (this.isInitialized && this.audioContext) {
            this._destroyEQ();
            this._createEQ();
            // Reconnect the audio graph without interrupting playback
            this._connectGraph();
        }

        // Dispatch event for UI update
        window.dispatchEvent(
            new CustomEvent('equalizer-freq-range-changed', {
                detail: { min: newMin, max: newMax, frequencies: this.frequencies },
            })
        );

        return true;
    }

    /**
     * Destroy EQ filters
     */
    _destroyEQ() {
        if (this.filters) {
            this.filters.forEach((filter) => {
                try {
                    filter.disconnect();
                } catch {
                    /* ignore */
                }
            });
        }
        this.filters = [];

        // Destroy preamp node
        if (this.preampNode) {
            try {
                this.preampNode.disconnect();
            } catch {
                /* ignore */
            }
            this.preampNode = null;
        }
    }

    /**
     * Create EQ filters
     */
    _createEQ() {
        if (!this.audioContext) return;

        // Create preamp node
        if (!this.preampNode) {
            this.preampNode = this.audioContext.createGain();
        }
        // Set preamp gain
        const preampValue = this.preamp || 0;
        const gainValue = Math.pow(10, preampValue / 20);
        this.preampNode.gain.value = gainValue;

        // Create biquad filters for each frequency band
        this.filters = this.frequencies.map((freq, index) => {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = (this.bandFilterTypes && this.bandFilterTypes[index]) || 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = (this.bandQValues && this.bandQValues[index] != null)
                ? this.bandQValues[index]
                : this._calculateQ(index);
            filter.gain.value = this.currentGains[index] || 0;
            return filter;
        });

        // Create volume node if not exists
        if (!this.volumeNode) {
            this.volumeNode = this.audioContext.createGain();
        }
    }

    /**
     * Calculate Q factor for each band
     */
    _calculateQ(_index) {
        // Scale Q based on band count for consistent sound
        const baseQ = 2.5;
        const scalingFactor = Math.sqrt(16 / this.bandCount);
        return baseQ * scalingFactor;
    }

    /**
     * Register a callback to be called when audio graph is reconnected
     * @param {Function} callback - Function to call when graph changes
     * @returns {Function} - Unregister function
     */
    onGraphChange(callback) {
        this._graphChangeCallbacks.push(callback);
        return () => {
            const index = this._graphChangeCallbacks.indexOf(callback);
            if (index > -1) {
                this._graphChangeCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Notify all registered callbacks that graph has changed
     */
    _notifyGraphChange() {
        this._graphChangeCallbacks.forEach((callback) => {
            try {
                callback(this.source);
            } catch (e) {
                console.warn('[AudioContext] Graph change callback failed:', e);
            }
        });
    }

    /**
     * Initialize the audio context and connect to the audio element
     * This should be called when audio starts playing
     */
    init(audioElement) {
        if (this.isInitialized) return;
        if (!audioElement) return;

        this.audio = audioElement;

        if (isIos) {
            console.log('[AudioContext] Skipping Web Audio initialization on iOS for lock screen compatibility');
            return;
        }

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const highResOptions = { sampleRate: 192000, latencyHint: 'playback' };

            try {
                this.audioContext = new AudioContext(highResOptions);
                console.log(`[AudioContext] Created with high-res settings: ${this.audioContext.sampleRate}Hz`);
            } catch (e) {
                try {
                    this.audioContext = new AudioContext({ latencyHint: 'playback' });
                } catch (e2) {
                    this.audioContext = new AudioContext();
                }
            }

            if (!this.sources.has(audioElement)) {
                this.sources.set(audioElement, this.audioContext.createMediaElementSource(audioElement));
            }
            this.source = this.sources.get(audioElement);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0.7;

            this._createEQ();

            this.outputNode = this.audioContext.createGain();
            this.outputNode.gain.value = 1;

            this.volumeNode = this.audioContext.createGain();
            this.volumeNode.gain.value = this.currentVolume;

            this.monoMergerNode = this.audioContext.createChannelMerger(2);

            this._connectGraph();

            this.isInitialized = true;
        } catch (e) {
            console.warn('[AudioContext] Init failed:', e);
        }
    }

    changeSource(audioElement) {
        if (!this.audioContext) {
            this.init(audioElement);
            return;
        }
        if (this.audio === audioElement) return;

        try {
            if (this.source) {
                try {
                    this.source.disconnect();
                } catch (e) {}
            }

            this.audio = audioElement;

            if (!this.sources.has(audioElement)) {
                this.sources.set(audioElement, this.audioContext.createMediaElementSource(audioElement));
            }
            this.source = this.sources.get(audioElement);

            if (this.isInitialized) {
                this._connectGraph();
            }
        } catch (e) {
            console.warn('changeSource failed:', e);
        }
    }

    /**
     * Connect the audio graph based on EQ and mono audio state
     */
    _connectGraph() {
        if (!this.isInitialized || !this.source || !this.audioContext) return;

        try {
            // Disconnect everything first
            try {
                this.source.disconnect();
            } catch (e) {}
            this.outputNode.disconnect();
            if (this.volumeNode) {
                this.volumeNode.disconnect();
            }
            this.analyser.disconnect();

            if (this.monoMergerNode) {
                try {
                    this.monoMergerNode.disconnect();
                } catch {
                    // Ignore if not connected
                }
            }

            let lastNode = this.source;

            // Apply mono audio if enabled
            if (this.isMonoAudioEnabled && this.monoMergerNode) {
                // Create a gain node to mix channels before the merger
                const monoGain = this.audioContext.createGain();
                monoGain.gain.value = 0.5; // Reduce volume to prevent clipping when mixing

                // Connect source to mono gain
                this.source.connect(monoGain);

                // Connect mono gain to both inputs of the merger
                monoGain.connect(this.monoMergerNode, 0, 0);
                monoGain.connect(this.monoMergerNode, 0, 1);

                lastNode = this.monoMergerNode;
                console.log('[AudioContext] Mono audio enabled');
            }

            if (this.isEQEnabled && this.filters.length > 0) {
                // EQ enabled: lastNode -> preamp -> EQ filters -> output -> analyser -> volume -> destination
                // Connect filter chain
                for (let i = 0; i < this.filters.length - 1; i++) {
                    this.filters[i].connect(this.filters[i + 1]);
                }
                // Connect preamp to first filter
                if (this.preampNode) {
                    lastNode.connect(this.preampNode);
                    this.preampNode.connect(this.filters[0]);
                } else {
                    lastNode.connect(this.filters[0]);
                }
                this.filters[this.filters.length - 1].connect(this.outputNode);
                this.outputNode.connect(this.analyser);
                this.analyser.connect(this.volumeNode);
                this.volumeNode.connect(this.audioContext.destination);
                console.log('[AudioContext] EQ connected');
            } else {
                // EQ disabled: lastNode -> analyser -> volume -> destination
                lastNode.connect(this.analyser);
                this.analyser.connect(this.volumeNode);
                this.volumeNode.connect(this.audioContext.destination);
            }

            // Notify visualizers that graph has been reconnected
            this._notifyGraphChange();
        } catch (e) {
            console.warn('[AudioContext] Failed to connect graph:', e);
            // Fallback: direct connection
            try {
                this.source.connect(this.audioContext.destination);
            } catch {
                /* ignore */
            }
        }
    }

    /**
     * Resume audio context (required after user interaction)
     * @returns {Promise<boolean>} - Returns true if context is running
     */
    async resume() {
        if (!this.audioContext) return false;

        console.log('[AudioContext] Current state:', this.audioContext.state);

        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('[AudioContext] Resumed successfully, state:', this.audioContext.state);
            } catch (e) {
                console.warn('[AudioContext] Failed to resume:', e);
            }
        }

        // Ensure graph is connected after resuming (iOS may disconnect when suspended)
        if (this.isInitialized && this.audioContext.state === 'running') {
            this._connectGraph();
        }

        return this.audioContext.state === 'running';
    }

    /**
     * Get the analyser node for the visualizer
     */
    getAnalyser() {
        return this.analyser;
    }

    /**
     * Get the audio context
     */
    getAudioContext() {
        return this.audioContext;
    }

    /**
     * Get the source node for visualizers
     */
    getSourceNode() {
        return this.source;
    }

    /**
     * Check if initialized and active
     */
    isReady() {
        return this.isInitialized && this.audioContext !== null;
    }

    /**
     * Set the volume level (0.0 to 1.0)
     * @param {number} value - Volume level
     */
    setVolume(value) {
        this.currentVolume = Math.max(0, Math.min(1, value));
        if (this.volumeNode && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.volumeNode.gain.setTargetAtTime(this.currentVolume, now, 0.01);
        }
    }

    /**
     * Toggle EQ on/off
     */
    toggleEQ(enabled) {
        this.isEQEnabled = enabled;
        equalizerSettings.setEnabled(enabled);

        if (this.isInitialized) {
            this._connectGraph();
        }

        return this.isEQEnabled;
    }

    /**
     * Check if EQ is active
     */
    isEQActive() {
        return this.isInitialized && this.isEQEnabled;
    }

    /**
     * Toggle mono audio on/off
     */
    toggleMonoAudio(enabled) {
        this.isMonoAudioEnabled = enabled;
        monoAudioSettings.setEnabled(enabled);

        if (this.isInitialized) {
            this._connectGraph();
        }

        return this.isMonoAudioEnabled;
    }

    /**
     * Check if mono audio is active
     */
    isMonoAudioActive() {
        return this.isInitialized && this.isMonoAudioEnabled;
    }

    /**
     * Get current gain range
     */
    getRange() {
        return equalizerSettings.getRange();
    }

    /**
     * Clamp gain to valid range
     */
    _clampGain(gainDb) {
        const range = this.getRange();
        return Math.max(range.min, Math.min(range.max, gainDb));
    }

    /**
     * Set gain for a specific band
     */
    setBandGain(bandIndex, gainDb) {
        if (bandIndex < 0 || bandIndex >= this.bandCount) return;

        const clampedGain = this._clampGain(gainDb);
        this.currentGains[bandIndex] = clampedGain;

        if (this.filters[bandIndex] && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.filters[bandIndex].gain.setTargetAtTime(clampedGain, now, 0.01);
        }

        equalizerSettings.setGains(this.currentGains);
    }

    /**
     * Set all band gains at once
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
     */
    applyPreset(presetKey) {
        const preset = EQ_PRESETS_16[presetKey];
        if (!preset) return;

        // Always apply as a full profile with log-spaced frequencies so any
        // stale AutoEQ per-band state (Q values, filter types, custom frequencies)
        // is cleared, and preamp is reset to 0.
        const freqs = generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        const gains = interpolatePreset(preset.gains, this.bandCount);
        this.applyProfile({
            bandCount: this.bandCount,
            frequencies: freqs,
            gains,
            qValues: null,
            filterTypes: null,
            preamp: 0,
        });
        equalizerSettings.setPreset(presetKey);
    }

    /**
     * Reset all bands to flat and clear any custom AutoEQ / profile state
     */
    reset() {
        // Clear custom band data — return to uniform log-spaced EQ
        this.bandQValues = null;
        this.bandFilterTypes = null;
        this.frequencies = generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        this.setAllGains(new Array(this.bandCount).fill(0));
        this.setPreamp(0);
        equalizerSettings.setPreset('flat');

        // Rebuild filters so Q values are reset to uniform
        if (this.isInitialized && this.audioContext) {
            this._destroyEQ();
            this._createEQ();
            this._connectGraph();
        }
    }

    /**
     * Get current gains
     */
    getGains() {
        return [...this.currentGains];
    }

    /**
     * Get current band count
     */
    getBandCount() {
        return this.bandCount;
    }

    /**
     * Load settings from storage
     */
    _loadSettings() {
        this.isEQEnabled = equalizerSettings.isEnabled();
        this.bandCount = equalizerSettings.getBandCount();
        this.freqRange = equalizerSettings.getFreqRange();
        this.frequencies = generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        this.currentGains = equalizerSettings.getGains(this.bandCount);
        this.isMonoAudioEnabled = monoAudioSettings.isEnabled();
        this.preamp = equalizerSettings.getPreamp();
    }

    /**
     * Set preamp value in dB
     * @param {number} db - Preamp value in dB (-20 to +20)
     */
    setPreamp(db) {
        const clampedDb = Math.max(-30, Math.min(30, parseFloat(db) || 0));
        this.preamp = clampedDb;
        equalizerSettings.setPreamp(clampedDb);

        // Update preamp node if it exists
        if (this.preampNode && this.audioContext) {
            const gainValue = Math.pow(10, clampedDb / 20);
            const now = this.audioContext.currentTime;
            this.preampNode.gain.setTargetAtTime(gainValue, now, 0.01);
        }
    }

    /**
     * Get current preamp value
     * @returns {number} Current preamp value in dB
     */
    getPreamp() {
        return this.preamp || 0;
    }

    /**
     * Apply AutoEQ-generated bands to the equalizer
     * @param {Array<{id, type, freq, gain, q, enabled}>} bands
     * @returns {string} Exported text for use with import or copy
     */
    applyAutoEQBands(bands) {
        if (!bands || bands.length === 0) return '';

        const sortedBands = [...bands.filter(b => b.enabled)].sort((a, b) => a.freq - b.freq);
        if (sortedBands.length === 0) return '';

        // Calculate preamp: headroom against the highest positive gain
        const maxGain = Math.max(0, ...sortedBands.map(b => b.gain));
        const preamp = maxGain > 0 ? -(Math.round(maxGain * 10) / 10) : 0;

        this.applyProfile({
            bandCount: sortedBands.length,
            frequencies: sortedBands.map(b => Math.round(b.freq)),
            gains: sortedBands.map(b => b.gain),
            qValues: sortedBands.map(b => b.q),
            filterTypes: sortedBands.map(b => b.type || 'peaking'),
            preamp,
        });

        // Return text representation
        const lines = [`Preamp: ${preamp.toFixed(1)} dB`];
        sortedBands.forEach((band, i) => {
            const ft = band.type === 'lowshelf' ? 'LS' : band.type === 'highshelf' ? 'HS' : 'PK';
            lines.push(`Filter ${i + 1}: ON ${ft} Fc ${Math.round(band.freq)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q.toFixed(2)}`);
        });
        return lines.join('\n');
    }

    /**
     * Apply a full EQ profile: frequencies, gains, Q values, filter types, and preamp.
     * Used by AutoEQ, profile import, and custom preset restore.
     * @param {{bandCount, frequencies, gains, qValues, filterTypes, preamp}} profile
     */
    applyProfile({ bandCount, frequencies, gains, qValues, filterTypes, preamp = 0 }) {
        const count = Math.max(
            equalizerSettings.MIN_BANDS,
            Math.min(equalizerSettings.MAX_BANDS, bandCount)
        );

        // Store custom band data
        this.bandCount = count;
        this.frequencies = frequencies.slice(0, count);
        this.currentGains = gains.slice(0, count).map(g => this._clampGain(g));
        this.bandQValues = qValues ? qValues.slice(0, count) : null;
        this.bandFilterTypes = filterTypes ? filterTypes.slice(0, count) : null;

        // Persist to storage
        equalizerSettings.setBandCount(count);
        equalizerSettings.setGains(this.currentGains);

        // Set preamp
        this.preamp = preamp;
        equalizerSettings.setPreamp(preamp);

        if (this.isInitialized && this.audioContext) {
            // Destroy old filters and build new ones directly from profile
            this._destroyEQ();

            if (!this.preampNode) {
                this.preampNode = this.audioContext.createGain();
            }
            this.preampNode.gain.value = Math.pow(10, preamp / 20);

            const maxSafeFreq = this.audioContext.sampleRate / 2 - 1;
            this.filters = this.frequencies.map((freq, i) => {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = (this.bandFilterTypes && this.bandFilterTypes[i]) || 'peaking';
                filter.frequency.value = Math.min(freq, maxSafeFreq);
                filter.Q.value = (this.bandQValues && this.bandQValues[i] != null)
                    ? this.bandQValues[i]
                    : this._calculateQ(i);
                filter.gain.value = this.currentGains[i] || 0;
                return filter;
            });

            if (!this.volumeNode) {
                this.volumeNode = this.audioContext.createGain();
                this.volumeNode.gain.value = this.currentVolume;
            }

            this._connectGraph();
        } else if (this.preampNode) {
            // Audio not yet initialized — preamp node may exist if it was previously set
            this.preampNode.gain.value = Math.pow(10, preamp / 20);
        }

        // Notify UI of band count / frequency change
        window.dispatchEvent(new CustomEvent('equalizer-band-count-changed', {
            detail: { bandCount: count, frequencies: this.frequencies },
        }));
    }

    /**
     * Get the full current filter state for saving as a profile
     * @returns {{frequencies, gains, qValues, filterTypes, preamp, bandCount}}
     */
    getProfileState() {
        return {
            bandCount: this.bandCount,
            frequencies: [...this.frequencies],
            gains: [...this.currentGains],
            qValues: this.bandQValues ? [...this.bandQValues] : null,
            filterTypes: this.bandFilterTypes ? [...this.bandFilterTypes] : null,
            preamp: this.preamp || 0,
        };
    }

    /**
     * Export equalizer settings to text format
     * @returns {string} Exported settings in text format
     */
    exportEQToText() {
        const lines = [];
        const preampValue = this.getPreamp();
        lines.push(`Preamp: ${preampValue.toFixed(1)} dB`);

        this.frequencies.forEach((freq, index) => {
            const gain = this.currentGains[index] || 0;
            const filterNum = index + 1;
            const q = (this.bandQValues && this.bandQValues[index] != null)
                ? this.bandQValues[index].toFixed(2)
                : this._calculateQ(index).toFixed(2);
            const filterType = (this.bandFilterTypes && this.bandFilterTypes[index])
                ? (this.bandFilterTypes[index] === 'lowshelf' ? 'LS' : this.bandFilterTypes[index] === 'highshelf' ? 'HS' : 'PK')
                : 'PK';
            lines.push(`Filter ${filterNum}: ON ${filterType} Fc ${freq} Hz Gain ${gain.toFixed(1)} dB Q ${q}`);
        });

        return lines.join('\n');
    }

    /**
     * Import equalizer settings from text format
     * @param {string} text - Text format settings
     * @returns {boolean} True if import was successful
     */
    importEQFromText(text) {
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
                console.warn('[AudioContext] No valid filters found in import text');
                return false;
            }

            // Convert type codes to Web Audio types
            const typeMap = { PK: 'peaking', LS: 'lowshelf', HS: 'highshelf' };
            const count = Math.max(
                equalizerSettings.MIN_BANDS,
                Math.min(equalizerSettings.MAX_BANDS, filters.length)
            );
            const importedBands = filters.slice(0, count).map(f => ({
                freq: f.freq,
                gain: f.gain,
                q: f.q,
                type: typeMap[f.type] || 'peaking',
                enabled: true,
            }));

            // Use applyProfile to apply all fields including Q and filter types
            this.applyProfile({
                bandCount: count,
                frequencies: importedBands.map(b => b.freq),
                gains: importedBands.map(b => b.gain),
                qValues: importedBands.map(b => b.q),
                filterTypes: importedBands.map(b => b.type),
                preamp,
            });

            return true;
        } catch (e) {
            console.warn('[AudioContext] Failed to import EQ settings:', e);
            return false;
        }
    }
}

// Export singleton instance
export const audioContextManager = new AudioContextManager();

// Export presets and helper functions for settings UI
export {
    EQ_PRESETS,
    generateFrequencies,
    generateFrequencyLabels,
    getPresetsForBandCount,
    interpolatePreset,
    EQ_PRESETS_16,
    EQ_BUILT_IN_PROFILES,
    STANDARD_16_FREQS,
};
