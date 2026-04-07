// js/audio-context.js
// Shared Audio Context Manager - handles EQ and provides context for visualizer
// Supports 3-32 parametric EQ bands

import { isIos } from './platform-detection.js';
import { equalizerSettings, monoAudioSettings } from './storage.js';

/**
 * Compute RBJ cookbook IIR coefficients for shelf filters with Q support.
 * Web Audio API's BiquadFilterNode ignores Q for lowshelf/highshelf,
 * so we use IIRFilterNode with these coefficients instead.
 */
function computeShelfCoefficients(type, freq, gainDb, q, sampleRate) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosW0 = Math.cos(w0);
    const sqA = 2 * Math.sqrt(A) * alpha;
    let b0, b1, b2, a0, a1, a2;

    if (type === 'lowshelf') {
        b0 = A * (A + 1 - (A - 1) * cosW0 + sqA);
        b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
        b2 = A * (A + 1 - (A - 1) * cosW0 - sqA);
        a0 = A + 1 + (A - 1) * cosW0 + sqA;
        a1 = -2 * (A - 1 + (A + 1) * cosW0);
        a2 = A + 1 + (A - 1) * cosW0 - sqA;
    } else {
        b0 = A * (A + 1 + (A - 1) * cosW0 + sqA);
        b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
        b2 = A * (A + 1 + (A - 1) * cosW0 - sqA);
        a0 = A + 1 - (A - 1) * cosW0 + sqA;
        a1 = 2 * (A - 1 - (A + 1) * cosW0);
        a2 = A + 1 - (A - 1) * cosW0 - sqA;
    }

    return {
        feedforward: [b0 / a0, b1 / a0, b2 / a0],
        feedback: [1, a1 / a0, a2 / a0],
    };
}

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

        // Callbacks for audio graph changes (for visualizers like Butterchurn)
        this._graphChangeCallbacks = [];

        // --- Graphic EQ (configurable bands, separate chain) ---
        this.geqFilters = [];
        this.geqPreampNode = null;
        this.geqOutputNode = null;
        this.isGraphicEQEnabled = equalizerSettings.isGraphicEqEnabled();
        this.geqBandCount = equalizerSettings.getGraphicEqBandCount();
        this.geqFreqRange = equalizerSettings.getGraphicEqFreqRange();
        this.geqFrequencies = generateFrequencies(this.geqBandCount, this.geqFreqRange.min, this.geqFreqRange.max);
        this.geqGains = equalizerSettings.getGraphicEqGains(this.geqBandCount);
        this.geqPreamp = equalizerSettings.getGraphicEqPreamp();

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

        // Create filters for each frequency band
        this.filters = this.frequencies.map((freq, index) => {
            const type = (this.currentTypes && this.currentTypes[index]) || 'peaking';
            const q = this.currentQs && this.currentQs[index] > 0 ? this.currentQs[index] : this._calculateQ(index);
            const gain = this.currentGains[index] || 0;

            if (type === 'lowshelf' || type === 'highshelf') {
                const coeffs = computeShelfCoefficients(type, freq, gain, q, this.audioContext.sampleRate);
                const iir = this.audioContext.createIIRFilter(coeffs.feedforward, coeffs.feedback);
                iir._shelfType = type;
                return iir;
            }

            const filter = this.audioContext.createBiquadFilter();
            filter.type = type;
            filter.frequency.value = freq;
            filter.Q.value = q;
            filter.gain.value = gain;
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

            try {
                this.audioContext = new AudioContext({ latencyHint: 'playback' });
                console.log(`[AudioContext] Created: ${this.audioContext.sampleRate}Hz`);
            } catch {
                this.audioContext = new AudioContext();
            }

            if (!this.sources.has(audioElement)) {
                this.sources.set(audioElement, this.audioContext.createMediaElementSource(audioElement));
            }
            this.source = this.sources.get(audioElement);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0.7;

            this._createEQ();
            this._createGraphicEQ();

            this.outputNode = this.audioContext.createGain();
            this.outputNode.gain.value = 1;

            this.volumeNode = this.audioContext.createGain();
            this.volumeNode.gain.value = this.currentVolume;

            this.monoMergerNode = this.audioContext.createChannelMerger(2);

            this._connectGraph();

            // Auto-recover from unexpected suspensions (e.g. background throttling)
            this.audioContext.addEventListener('statechange', () => {
                if (this.audioContext.state === 'interrupted' || this.audioContext.state === 'suspended') {
                    console.log(`[AudioContext] State changed to ${this.audioContext.state}, attempting resume`);
                    // Use a short delay to let the system settle before resuming
                    setTimeout(() => {
                        if (this.audioContext && this.audioContext.state !== 'running' && this.source) {
                            this.audioContext.resume().catch((e) => {
                                console.warn('[AudioContext] Auto-resume failed:', e);
                            });
                        }
                    }, 100);
                }
            });

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
                } catch {
                    // node may already be disconnected
                }
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
     * Connect the audio graph based on EQ and mono audio state.
     * Uses connect-before-disconnect ordering to avoid audio dropouts:
     * the new chain is wired up first, then the old connections are torn down.
     */
    _connectGraph() {
        if (!this.isInitialized || !this.source || !this.audioContext) return;

        // Ensure graphic EQ nodes exist
        if (this.geqFilters.length === 0 && this.isGraphicEQEnabled) {
            this._createGraphicEQ();
        }

        // Helper: connect a chain segment from lastNode through graphic EQ (if enabled) to analyser -> volume -> dest
        const connectTail = (lastNode) => {
            if (this.isGraphicEQEnabled && this.geqFilters.length > 0) {
                lastNode.connect(this.geqPreampNode);
                this.geqPreampNode.connect(this.geqFilters[0]);
                for (let i = 0; i < this.geqFilters.length - 1; i++) {
                    this.geqFilters[i].connect(this.geqFilters[i + 1]);
                }
                this.geqFilters[this.geqFilters.length - 1].connect(this.geqOutputNode);
                this.geqOutputNode.connect(this.analyser);
            } else {
                lastNode.connect(this.analyser);
            }
            this.analyser.connect(this.volumeNode);
            this.volumeNode.connect(this.audioContext.destination);
        };

        try {
            // Ensure mono gain node exists if needed
            if (this.isMonoAudioEnabled && this.monoMergerNode && !this.monoGainNode) {
                this.monoGainNode = this.audioContext.createGain();
                this.monoGainNode.gain.value = 0.5;
            }

            // --- 1. Disconnect all existing connections ---
            const safeDisconnect = (node) => {
                try {
                    node?.disconnect();
                } catch {
                    /* */
                }
            };
            safeDisconnect(this.source);
            safeDisconnect(this.monoGainNode);
            safeDisconnect(this.monoMergerNode);
            safeDisconnect(this.preampNode);
            this.filters.forEach(safeDisconnect);
            safeDisconnect(this.outputNode);
            safeDisconnect(this.geqPreampNode);
            this.geqFilters.forEach(safeDisconnect);
            safeDisconnect(this.geqOutputNode);
            safeDisconnect(this.analyser);
            safeDisconnect(this.volumeNode);

            // --- 2. Reconnect the graph ---
            let lastNode = this.source;

            if (this.isMonoAudioEnabled && this.monoMergerNode) {
                this.source.connect(this.monoGainNode);
                this.monoGainNode.connect(this.monoMergerNode, 0, 0);
                this.monoGainNode.connect(this.monoMergerNode, 0, 1);
                lastNode = this.monoMergerNode;
            }

            if (this.isEQEnabled && this.filters.length > 0) {
                for (let i = 0; i < this.filters.length - 1; i++) {
                    this.filters[i].connect(this.filters[i + 1]);
                }
                if (this.preampNode) {
                    lastNode.connect(this.preampNode);
                    this.preampNode.connect(this.filters[0]);
                } else {
                    lastNode.connect(this.filters[0]);
                }
                this.filters[this.filters.length - 1].connect(this.outputNode);
                connectTail(this.outputNode);
            } else {
                connectTail(lastNode);
            }

            // Notify visualizers that graph has been reconnected
            this._notifyGraphChange();
        } catch (e) {
            console.warn('[AudioContext] Failed to connect graph:', e);
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
     * Calculate biquad filter magnitude response in dB at a given frequency
     */
    _biquadResponseDb(f, band, sr) {
        if (!band.enabled || !band.type) return 0;
        const w = (2 * Math.PI * band.freq) / sr;
        const p = (2 * Math.PI * f) / sr;
        const s = Math.sin(w) / (2 * band.q);
        const A = Math.pow(10, band.gain / 40);
        const c = Math.cos(w);
        let b0, b1, b2, a0, a1, a2;
        const t = band.type[0];
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
     * Clamp gain to valid range
     */
    _clampGain(gainDb) {
        const range = this.getRange();
        return Math.max(range.min, Math.min(range.max, gainDb));
    }

    /**
     * Set gain for a specific band
     */
    /**
     * Replace an IIR shelf filter node with updated coefficients and reconnect the chain.
     */
    _replaceShelfFilter(index) {
        const filter = this.filters[index];
        if (!filter?._shelfType || !this.audioContext) return;
        const type = this.currentTypes?.[index] || filter._shelfType;
        const freq = this.frequencies[index];
        const gain = this.currentGains[index] || 0;
        const q = this.currentQs?.[index] > 0 ? this.currentQs[index] : this._calculateQ(index);
        const coeffs = computeShelfCoefficients(type, freq, gain, q, this.audioContext.sampleRate);
        const iir = this.audioContext.createIIRFilter(coeffs.feedforward, coeffs.feedback);
        iir._shelfType = type;
        try { filter.disconnect(); } catch { /* ignore */ }
        this.filters[index] = iir;
    }

    setBandGain(bandIndex, gainDb) {
        if (bandIndex < 0 || bandIndex >= this.bandCount) return;

        const clampedGain = this._clampGain(gainDb);
        this.currentGains[bandIndex] = clampedGain;

        if (this.filters[bandIndex] && this.audioContext) {
            if (this.filters[bandIndex]._shelfType) {
                this._replaceShelfFilter(bandIndex);
                this._connectGraph();
            } else {
                const now = this.audioContext.currentTime;
                this.filters[bandIndex].gain.setTargetAtTime(clampedGain, now, 0.01);
            }
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
        let needsReconnect = false;

        adjustedGains.forEach((gain, index) => {
            const clampedGain = this._clampGain(gain);
            this.currentGains[index] = clampedGain;

            if (this.filters[index]) {
                if (this.filters[index]._shelfType) {
                    this._replaceShelfFilter(index);
                    needsReconnect = true;
                } else {
                    this.filters[index].gain.setTargetAtTime(clampedGain, now, 0.01);
                }
            }
        });

        if (needsReconnect) {
            this._connectGraph();
        }

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
        const customFreqs = equalizerSettings.getCustomFrequencies(this.bandCount);
        this.frequencies = customFreqs || generateFrequencies(this.bandCount, this.freqRange.min, this.freqRange.max);
        this.currentGains = equalizerSettings.getGains(this.bandCount);
        this.currentTypes = equalizerSettings.getBandTypes(this.bandCount);
        this.currentQs = equalizerSettings.getBandQs(this.bandCount);
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
     * Apply AutoEQ-generated bands to the equalizer
     * Unlike regular presets, AutoEQ bands have specific frequencies, gains, and Q values
     * @param {Array<{id: number, type: string, freq: number, gain: number, q: number, enabled: boolean}>} bands
     * @returns {string} Exported text representation of the applied EQ
     */
    applyAutoEQBands(bands, skipPreamp = false) {
        if (!bands || bands.length === 0) return '';

        const enabledBands = bands.filter((b) => b.enabled);
        const count = Math.max(equalizerSettings.MIN_BANDS, Math.min(equalizerSettings.MAX_BANDS, enabledBands.length));

        // Calculate preamp: negative of cumulative peak gain across all bands to prevent clipping
        let cumulativePeak = 0;
        if (!skipPreamp) {
            const sr = this.audioContext?.sampleRate ?? 48000;
            // Sweep log-spaced frequencies (24 points/octave from 20-20kHz) to catch narrow peaks
            for (let f = 20; f <= 20000; f *= Math.pow(2, 1 / 24)) {
                let sum = 0;
                for (const b of enabledBands) {
                    sum += this._biquadResponseDb(f, b, sr);
                }
                if (sum > cumulativePeak) cumulativePeak = sum;
            }
        }
        const preamp = skipPreamp
            ? equalizerSettings.getPreamp()
            : cumulativePeak > 0
              ? -Math.round(cumulativePeak * 10) / 10
              : 0;

        // Sort bands by frequency so index order is deterministic
        const sortedBands = [...enabledBands].sort((a, b) => a.freq - b.freq);

        // Build normalized band descriptor arrays
        const newFrequencies = sortedBands
            .slice(0, count)
            .map((b) => Math.round(Math.min(b.freq, (this.audioContext?.sampleRate ?? 48000) / 2 - 1)));
        const newTypes = sortedBands.slice(0, count).map((b) => b.type || 'peaking');
        const newQs = sortedBands.slice(0, count).map((b) => b.q);
        const newGains = sortedBands.slice(0, count).map((b) => this._clampGain(b.gain));

        // Update band count via class setter to trigger equalizer-band-count-changed event
        if (count !== this.bandCount) {
            this.setBandCount(count);
        }

        // Override frequencies, types, and Qs with band-specific values
        this.frequencies = newFrequencies;
        this.currentTypes = newTypes;
        this.currentQs = newQs;
        this.currentGains = newGains;

        if (this.isInitialized && this.audioContext) {
            // If filter count matches, update params in-place (no graph rebuild)
            if (this.filters.length === count) {
                const now = this.audioContext.currentTime;
                let needsReconnect = false;
                this.filters.forEach((filter, i) => {
                    const type = newTypes[i] || 'peaking';
                    const q = newQs[i] > 0 ? newQs[i] : this._calculateQ(i);
                    const isShelf = type === 'lowshelf' || type === 'highshelf';
                    const wasShelf = !!filter._shelfType;

                    if (isShelf) {
                        // IIR filters can't update params — must replace the node
                        const coeffs = computeShelfCoefficients(type, newFrequencies[i], newGains[i], q, this.audioContext.sampleRate);
                        const iir = this.audioContext.createIIRFilter(coeffs.feedforward, coeffs.feedback);
                        iir._shelfType = type;
                        try { filter.disconnect(); } catch { /* ignore */ }
                        this.filters[i] = iir;
                        needsReconnect = true;
                    } else if (wasShelf) {
                        // Was shelf IIR, now peaking — create new BiquadFilterNode
                        const biquad = this.audioContext.createBiquadFilter();
                        biquad.type = type;
                        biquad.frequency.value = newFrequencies[i];
                        biquad.gain.value = newGains[i];
                        biquad.Q.value = q;
                        try { filter.disconnect(); } catch { /* ignore */ }
                        this.filters[i] = biquad;
                        needsReconnect = true;
                    } else {
                        filter.type = type;
                        filter.frequency.setTargetAtTime(newFrequencies[i], now, 0.005);
                        filter.gain.setTargetAtTime(newGains[i], now, 0.005);
                        filter.Q.setTargetAtTime(q, now, 0.005);
                    }
                });
                if (needsReconnect) {
                    this._connectGraph();
                }
            } else {
                // Band count changed — must rebuild
                this._destroyEQ();
                this._createEQ();
                this._connectGraph();
            }
        }

        // Apply preamp (skip if caller manages preamp externally)
        if (!skipPreamp) {
            this.setPreamp(preamp);
        }

        // Persist normalized band descriptors to settings store
        equalizerSettings.setCustomFrequencies(this.frequencies);
        equalizerSettings.setGains(this.currentGains);
        equalizerSettings.setBandTypes(this.currentTypes);
        equalizerSettings.setBandQs(this.currentQs);

        // Generate export text using the actual applied preamp value
        const lines = [`Preamp: ${this.preamp.toFixed(1)} dB`];
        sortedBands.forEach((band, index) => {
            if (index >= count) return;
            const filterType = band.type === 'lowshelf' ? 'LSC' : band.type === 'highshelf' ? 'HSC' : 'PK';
            lines.push(
                `Filter ${index + 1}: ON ${filterType} Fc ${newFrequencies[index]} Hz Gain ${newGains[index].toFixed(1)} dB Q ${newQs[index].toFixed(2)}`
            );
        });

        return lines.join('\n');
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
            const type = (this.currentTypes && this.currentTypes[index]) || 'peaking';
            const filterType = type === 'lowshelf' ? 'LSC' : type === 'highshelf' ? 'HSC' : 'PK';
            const q = this.currentQs && this.currentQs[index] > 0 ? this.currentQs[index] : this._calculateQ(index);
            const filterNum = index + 1;
            lines.push(
                `Filter ${filterNum}: ON ${filterType} Fc ${freq} Hz Gain ${gain.toFixed(1)} dB Q ${q.toFixed(2)}`
            );
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
                    /^Filter\s*\d*:\s*ON\s+(\w+)\s+Fc\s+(\d+)\s+Hz\s+Gain\s*([+-]?\d+\.?\d*)\s*dB(?:\s+Q\s+(\d+\.?\d*))?/i
                );
                if (filterMatch) {
                    const type = filterMatch[1].toUpperCase();
                    const freq = parseInt(filterMatch[2], 10);
                    const gain = parseFloat(filterMatch[3]);
                    const q = filterMatch[4] ? parseFloat(filterMatch[4]) : Math.SQRT1_2;
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
            const newCount = Math.max(
                equalizerSettings.MIN_BANDS,
                Math.min(equalizerSettings.MAX_BANDS, filters.length)
            );
            if (newCount !== this.bandCount) {
                this.setBandCount(newCount);
            }

            // Apply per-band frequencies, types, Qs, and gains from import
            const sliced = filters.slice(0, this.bandCount);
            const typeMap = {
                PK: 'peaking',
                LS: 'lowshelf',
                LSC: 'lowshelf',
                LSF: 'lowshelf',
                HS: 'highshelf',
                HSC: 'highshelf',
                HSF: 'highshelf',
            };
            this.frequencies = sliced.map((f) => f.freq);
            this.currentTypes = sliced.map((f) => typeMap[f.type] || 'peaking');
            this.currentQs = sliced.map((f) => f.q);
            this.currentGains = sliced.map((f) => this._clampGain(f.gain));

            // Rebuild EQ chain to apply new frequencies, types, and Qs
            if (this.isInitialized && this.audioContext) {
                this._destroyEQ();
                this._createEQ();
                this._connectGraph();
            }

            // Persist all band settings including custom frequencies
            equalizerSettings.setCustomFrequencies(this.frequencies);
            equalizerSettings.setGains(this.currentGains);
            equalizerSettings.setBandTypes(this.currentTypes);
            equalizerSettings.setBandQs(this.currentQs);

            return true;
        } catch (e) {
            console.warn('[AudioContext] Failed to import EQ settings:', e);
            return false;
        }
    }

    // ========================================
    // Graphic EQ (16-band, independent chain)
    // ========================================

    _createGraphicEQ() {
        if (!this.audioContext) return;
        this.geqPreampNode = this.audioContext.createGain();
        const gainValue = Math.pow(10, (this.geqPreamp || 0) / 20);
        this.geqPreampNode.gain.value = gainValue;

        this.geqOutputNode = this.audioContext.createGain();
        this.geqOutputNode.gain.value = 1;

        const geqQ = 2.5 * Math.sqrt(16 / this.geqBandCount);
        this.geqFilters = this.geqFrequencies.map((freq, i) => {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = geqQ;
            filter.gain.value = this.geqGains[i] || 0;
            return filter;
        });
    }

    _destroyGraphicEQ() {
        this.geqFilters.forEach((f) => {
            try {
                f.disconnect();
            } catch {
                /* */
            }
        });
        this.geqFilters = [];
        if (this.geqPreampNode) {
            try {
                this.geqPreampNode.disconnect();
            } catch {
                /* */
            }
            this.geqPreampNode = null;
        }
        if (this.geqOutputNode) {
            try {
                this.geqOutputNode.disconnect();
            } catch {
                /* */
            }
            this.geqOutputNode = null;
        }
    }

    toggleGraphicEQ(enabled) {
        this.isGraphicEQEnabled = enabled;
        equalizerSettings.setGraphicEqEnabled(enabled);
        if (this.isInitialized) {
            this._connectGraph();
        }
    }

    setGraphicEqBandGain(bandIndex, gainDb) {
        if (bandIndex < 0 || bandIndex >= this.geqBandCount) return;
        this.geqGains[bandIndex] = Math.max(-30, Math.min(30, gainDb));
        if (this.geqFilters[bandIndex] && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.geqFilters[bandIndex].gain.setTargetAtTime(this.geqGains[bandIndex], now, 0.01);
        }
        equalizerSettings.setGraphicEqGains([...this.geqGains]);
    }

    setGraphicEqAllGains(gains) {
        if (!Array.isArray(gains)) return;
        const now = this.audioContext?.currentTime || 0;
        gains.forEach((g, i) => {
            if (i >= this.geqBandCount) return;
            this.geqGains[i] = Math.max(-30, Math.min(30, g));
            if (this.geqFilters[i]) {
                this.geqFilters[i].gain.setTargetAtTime(this.geqGains[i], now, 0.01);
            }
        });
        equalizerSettings.setGraphicEqGains([...this.geqGains]);
    }

    setGraphicEqBandCount(count) {
        const newCount = Math.max(3, Math.min(32, parseInt(count, 10) || 16));
        if (newCount === this.geqBandCount) return;

        const oldGains = this.geqGains;
        this.geqBandCount = newCount;
        this.geqFrequencies = generateFrequencies(newCount, this.geqFreqRange.min, this.geqFreqRange.max);
        this.geqGains = equalizerSettings._interpolateGains(oldGains, newCount);

        equalizerSettings.setGraphicEqBandCount(newCount);
        equalizerSettings.setGraphicEqGains(this.geqGains);

        if (this.isInitialized && this.audioContext) {
            this._destroyGraphicEQ();
            this._createGraphicEQ();
            this._connectGraph();
        }
    }

    setGraphicEqFreqRange(minFreq, maxFreq) {
        const newMin = Math.max(10, Math.min(96000, parseInt(minFreq, 10) || 25));
        const newMax = Math.max(10, Math.min(96000, parseInt(maxFreq, 10) || 20000));
        if (newMin >= newMax) return;
        if (newMin === this.geqFreqRange.min && newMax === this.geqFreqRange.max) return;

        this.geqFreqRange = { min: newMin, max: newMax };
        this.geqFrequencies = generateFrequencies(this.geqBandCount, newMin, newMax);

        equalizerSettings.setGraphicEqFreqRange(newMin, newMax);

        if (this.isInitialized && this.audioContext) {
            this._destroyGraphicEQ();
            this._createGraphicEQ();
            this._connectGraph();
        }
    }

    getGraphicEqFrequencies() {
        return this.geqFrequencies;
    }

    getGraphicEqBandCount() {
        return this.geqBandCount;
    }

    setGraphicEqPreamp(db) {
        this.geqPreamp = Math.max(-20, Math.min(20, parseFloat(db) || 0));
        if (this.geqPreampNode && this.audioContext) {
            const gainValue = Math.pow(10, this.geqPreamp / 20);
            const now = this.audioContext.currentTime;
            this.geqPreampNode.gain.setTargetAtTime(gainValue, now, 0.01);
        }
        equalizerSettings.setGraphicEqPreamp(this.geqPreamp);
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
