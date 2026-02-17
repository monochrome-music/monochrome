// js/audio-context.js
// Shared Audio Context Manager - handles EQ and provides context for visualizer
// Supports 3-32 parametric EQ bands

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

class AudioContextManager {
    constructor() {
        this.audioContext = null;
        this.source = null;
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
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = this._calculateQ(index);
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

        // Detect iOS - skip Web Audio initialization on iOS to avoid lock screen audio issues
        // iOS suspends AudioContext when screen locks, and MediaSession controls don't count
        // as user gestures to resume it, causing audio to play silently.
        // Use window.__IS_IOS__ (set before UA spoof in index.html) so detection works on real iOS.
        const isIOS = typeof window !== 'undefined' && window.__IS_IOS__ === true;
        if (isIOS) {
            console.log('[AudioContext] Skipping Web Audio initialization on iOS for lock screen compatibility');
            // Don't set isInitialized - let it remain false so isReady() returns false
            // This prevents other code from trying to use the non-existent audio context
            return;
        }

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create the media element source
            this.source = this.audioContext.createMediaElementSource(audioElement);

            // Create analyser for visualizer
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.7;

            // Create biquad filters for EQ with dynamic band count
            this._createEQ();

            // Create output gain node
            this.outputNode = this.audioContext.createGain();
            this.outputNode.gain.value = 1;

            // Create volume node
            this.volumeNode = this.audioContext.createGain();
            this.volumeNode.gain.value = this.currentVolume;

            // Create mono audio merger node
            this.monoMergerNode = this.audioContext.createChannelMerger(2);

            // Connect the audio graph based on EQ and mono state
            this._connectGraph();

            this.isInitialized = true;
            console.log(`[AudioContext] Initialized with ${this.bandCount}-band EQ`);
        } catch (e) {
            console.warn('[AudioContext] Init failed:', e);
        }
    }

    /**
     * Connect the audio graph based on EQ and mono audio state
     */
    _connectGraph() {
        if (!this.source || !this.audioContext) return;

        try {
            // Disconnect everything first
            this.source.disconnect();
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
                console.log('[AudioContext] EQ bypassed');
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
        const presets = getPresetsForBandCount(this.bandCount);
        const preset = presets[presetKey];
        if (!preset) return;

        this.setAllGains(preset.gains);
        equalizerSettings.setPreset(presetKey);
    }

    /**
     * Reset all bands to flat
     */
    reset() {
        this.setAllGains(new Array(this.bandCount).fill(0));
        equalizerSettings.setPreset('flat');
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
        const clampedDb = Math.max(-20, Math.min(20, parseFloat(db) || 0));
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
            lines.push(`Filter ${filterNum}: ON PK Fc ${freq} Hz Gain ${gain.toFixed(1)} dB Q 0.71`);
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
};
