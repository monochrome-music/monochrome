// js/audio-context.js
// Shared Audio Context Manager - handles EQ and provides context for visualizer

import { equalizerSettings } from './storage.js';

// Standard 16-band ISO center frequencies (Hz)
const EQ_FREQUENCIES = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000];

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

class AudioContextManager {
    constructor() {
        this.audioContext = null;
        this.source = null;
        this.analyser = null;
        this.filters = [];
        this.outputNode = null;
        this.isInitialized = false;
        this.isEQEnabled = false;
        this.currentGains = new Array(16).fill(0);
        this.audio = null;

        // Load saved settings
        this._loadSettings();
    }

    /**
     * Initialize the audio context and connect to the audio element
     * This should be called when audio starts playing
     */
    init(audioElement) {
        if (this.isInitialized) return;
        if (!audioElement) return;

        // Detect iOS - skip Web Audio initialization on iOS to avoid lock screen audio issues
        // iOS suspends AudioContext when screen locks, and MediaSession controls don't count
        // as user gestures to resume it, causing audio to play silently
        const ua = navigator.userAgent.toLowerCase();
        const isIOS = /iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && navigator.maxTouchPoints > 1);
        if (isIOS) {
            console.log('[AudioContext] Skipping Web Audio initialization on iOS for lock screen compatibility');
            this.isInitialized = true; // Mark as initialized to prevent repeated attempts
            return;
        }

        try {
            this.audio = audioElement;

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create the media element source
            this.source = this.audioContext.createMediaElementSource(audioElement);

            // Create analyser for visualizer
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.7;

            // Create 16 biquad filters for EQ
            this.filters = EQ_FREQUENCIES.map((freq, index) => {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 2.5; // Constant-Q design
                filter.gain.value = this.currentGains[index];
                return filter;
            });

            // Create output gain node
            this.outputNode = this.audioContext.createGain();
            this.outputNode.gain.value = 1;

            // Connect filter chain: filter[0] -> filter[1] -> ... -> filter[15] -> outputNode
            for (let i = 0; i < this.filters.length - 1; i++) {
                this.filters[i].connect(this.filters[i + 1]);
            }
            this.filters[this.filters.length - 1].connect(this.outputNode);

            // Connect the audio graph based on EQ state
            this._connectGraph();

            this.isInitialized = true;
            console.log('[AudioContext] Initialized with 16-band EQ');
        } catch (e) {
            console.warn('[AudioContext] Init failed:', e);
        }
    }

    /**
     * Connect the audio graph based on EQ enabled state
     */
    _connectGraph() {
        if (!this.source || !this.audioContext) return;

        try {
            // Disconnect everything first
            this.source.disconnect();
            this.outputNode.disconnect();
            this.analyser.disconnect();

            if (this.isEQEnabled && this.filters.length > 0) {
                // EQ enabled: source -> EQ filters -> output -> analyser -> destination
                this.source.connect(this.filters[0]);
                this.outputNode.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
                console.log('[AudioContext] EQ connected');
            } else {
                // EQ disabled: source -> analyser -> destination
                this.source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
                console.log('[AudioContext] EQ bypassed');
            }
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
     * Check if initialized
     */
    isReady() {
        return this.isInitialized;
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
     * Set gain for a specific band
     */
    setBandGain(bandIndex, gainDb) {
        if (bandIndex < 0 || bandIndex >= 16) return;

        const clampedGain = Math.max(-30, Math.min(30, gainDb));
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
     */
    applyPreset(presetKey) {
        const preset = EQ_PRESETS[presetKey];
        if (!preset) return;

        this.setAllGains(preset.gains);
        equalizerSettings.setPreset(presetKey);
    }

    /**
     * Reset all bands to flat
     */
    reset() {
        this.setAllGains(new Array(16).fill(0));
        equalizerSettings.setPreset('flat');
    }

    /**
     * Get current gains
     */
    getGains() {
        return [...this.currentGains];
    }

    /**
     * Load settings from storage
     */
    _loadSettings() {
        this.isEQEnabled = equalizerSettings.isEnabled();
        this.currentGains = equalizerSettings.getGains();
    }
}

// Export singleton instance
export const audioContextManager = new AudioContextManager();

// Export presets for settings UI
export { EQ_PRESETS };
