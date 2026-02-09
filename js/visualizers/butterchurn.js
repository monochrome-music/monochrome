/**
 * Butterchurn (Milkdrop) Visualizer Preset
 * WebGL-based audio visualization using the Butterchurn library
 */
import butterchurn from 'butterchurn';
import butterchurnPresets from 'butterchurn-presets';
import { visualizerSettings } from '../storage.js';

export class ButterchurnPreset {
    constructor() {
        this.name = 'Butterchurn';
        this.contextType = 'webgl';

        this.visualizer = null;
        this.canvas = null;
        this.audioContext = null;
        this.presets = null;
        this.presetKeys = [];
        this.currentPresetIndex = 0;
        this.lastPresetChange = 0;
        this.isInitialized = false;

        // Transition settings
        this.blendProgress = 0;
        this.blendDuration = 2.7; // seconds for preset transitions
    }

    /**
     * Get the preset cycle duration from settings (in milliseconds)
     */
    getPresetDuration() {
        const seconds = visualizerSettings.getButterchurnCycleDuration();
        return seconds * 1000; // Convert to milliseconds
    }

    /**
     * Initialize Butterchurn with the given WebGL context
     */
    init(canvas, gl, audioContext, sourceNode) {
        if (this.isInitialized) return;

        try {
            this.canvas = canvas;
            this.audioContext = audioContext;

            // Load presets
            this.presets = butterchurnPresets.getPresets();
            this.presetKeys = Object.keys(this.presets);

            // Filter to get a good selection of presets (some are better than others)
            this.presetKeys = this.presetKeys.filter(key => {
                // Skip some problematic or less visually appealing presets
                const skipPatterns = ['flexi', 'empty', 'test', '_'];
                return !skipPatterns.some(pattern => key.toLowerCase().includes(pattern));
            });

            if (this.presetKeys.length === 0) {
                this.presetKeys = Object.keys(this.presets);
            }

            // Shuffle presets for variety
            this.shufflePresets();

            // Create Butterchurn visualizer
            this.visualizer = butterchurn.createVisualizer(audioContext, canvas, {
                width: canvas.width,
                height: canvas.height,
                pixelRatio: window.devicePixelRatio || 1,
                textureRatio: 1,
            });

            // Connect audio source
            if (sourceNode) {
                this.visualizer.connectAudio(sourceNode);
            }

            // Load initial preset
            this.loadRandomPreset();

            this.lastPresetChange = performance.now();
            this.isInitialized = true;

            console.log('[Butterchurn] Initialized with', this.presetKeys.length, 'presets');
        } catch (error) {
            console.error('[Butterchurn] Initialization failed:', error);
        }
    }

    /**
     * Shuffle the preset keys for random variety
     */
    shufflePresets() {
        for (let i = this.presetKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.presetKeys[i], this.presetKeys[j]] = [this.presetKeys[j], this.presetKeys[i]];
        }
    }

    /**
     * Load a random preset with smooth transition
     */
    loadRandomPreset() {
        if (!this.visualizer || this.presetKeys.length === 0) return;

        this.currentPresetIndex = (this.currentPresetIndex + 1) % this.presetKeys.length;
        const presetKey = this.presetKeys[this.currentPresetIndex];
        const preset = this.presets[presetKey];

        if (preset) {
            try {
                this.visualizer.loadPreset(preset, this.blendDuration);
                console.log('[Butterchurn] Loaded preset:', presetKey);
            } catch (error) {
                console.warn('[Butterchurn] Failed to load preset:', presetKey, error);
                // Try next preset
                if (this.presetKeys.length > 1) {
                    this.presetKeys.splice(this.currentPresetIndex, 1);
                    this.loadRandomPreset();
                }
            }
        }
    }

    /**
     * Load a specific preset by name
     */
    loadPreset(presetName) {
        if (!this.visualizer || !this.presets) return;

        const preset = this.presets[presetName];
        if (preset) {
            this.visualizer.loadPreset(preset, this.blendDuration);
            console.log('[Butterchurn] Loaded preset:', presetName);
        }
    }

    /**
     * Get list of available preset names
     */
    getPresetNames() {
        return this.presetKeys;
    }

    /**
     * Get current preset name
     */
    getCurrentPresetName() {
        return this.presetKeys[this.currentPresetIndex] || 'Unknown';
    }

    /**
     * Skip to next preset
     */
    nextPreset() {
        this.loadRandomPreset();
        this.lastPresetChange = performance.now();
    }

    /**
     * Resize handler
     */
    resize(width, height) {
        if (this.visualizer) {
            this.visualizer.setRendererSize(width, height);
        }
    }

    /**
     * Main draw function called each animation frame
     */
    draw(ctx, canvas, analyser, dataArray, params) {
        if (!this.isInitialized) {
            // Lazy initialization - need audio context and source node
            // This will be handled by the visualizer.js main class
            return;
        }

        if (!this.visualizer) return;

        const { mode } = params;
        const now = performance.now();

        // Auto-cycle presets (if cycle duration > 0)
        const cycleDuration = this.getPresetDuration();
        if (cycleDuration > 0 && now - this.lastPresetChange > cycleDuration) {
            this.loadRandomPreset();
            this.lastPresetChange = now;
        }

        // Render the visualization
        try {
            this.visualizer.render();
        } catch (error) {
            console.warn('[Butterchurn] Render error:', error);
        }

        // Handle blended mode - we need to composite with cover art
        // Butterchurn renders directly to the canvas, so for blended mode
        // we need to adjust the canvas opacity/blend
        if (mode === 'blended') {
            // The canvas will be composited by CSS in the parent
            canvas.style.opacity = '0.85';
            canvas.style.mixBlendMode = 'screen';
        } else {
            canvas.style.opacity = '1';
            canvas.style.mixBlendMode = 'normal';
        }
    }

    /**
     * Connect audio source to the visualizer
     */
    connectAudio(sourceNode) {
        if (this.visualizer && sourceNode) {
            try {
                this.visualizer.connectAudio(sourceNode);
                console.log('[Butterchurn] Audio connected');
            } catch (error) {
                console.warn('[Butterchurn] Failed to connect audio:', error);
            }
        }
    }

    /**
     * Lazy initialization helper for when audio context becomes available
     */
    lazyInit(canvas, audioContext, sourceNode) {
        if (!this.isInitialized && canvas && audioContext) {
            const gl = canvas.getContext('webgl2', {
                alpha: true,
                antialias: true,
                preserveDrawingBuffer: true,
            }) || canvas.getContext('webgl', {
                alpha: true,
                antialias: true,
                preserveDrawingBuffer: true,
            });

            if (gl) {
                this.init(canvas, gl, audioContext, sourceNode);
            }
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.visualizer) {
            // Butterchurn doesn't have an explicit cleanup method
            // but we can null our references
            this.visualizer = null;
        }
        this.isInitialized = false;
        this.canvas = null;
        this.audioContext = null;
        console.log('[Butterchurn] Destroyed');
    }
}
