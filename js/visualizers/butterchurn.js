/**
 * Butterchurn (Milkdrop) Visualizer Preset
 * WebGL-based audio visualization using the Butterchurn library
 */
import butterchurn from 'butterchurn';
import { visualizerSettings } from '../storage.js';

export class ButterchurnPreset {
    constructor() {
        this.name = 'Butterchurn';
        this.contextType = 'webgl';

        this.visualizer = null;
        this.canvas = null;
        this.audioContext = null;
        this.currentPresetIndex = 0;
        this.lastPresetChange = 0;
        this.isInitialized = false;

        this.presets = {};
        this.presetKeys = [];
        this.isLoadingPresets = false;

        // Transition settings
        this.blendProgress = 0;
        this.blendDuration = 2.7; // seconds for preset transitions

        // Load presets asynchronously
        this.loadPresets();
    }

    /**
     * Load presets dynamically to avoid blocking main bundle
     */
    async loadPresets() {
        if (this.isLoadingPresets) return;
        this.isLoadingPresets = true;

        try {
            const module = await import('butterchurn-presets');
            const presets = module.default.getPresets();

            this.presets = presets;
            this.presetKeys = Object.keys(this.presets);

            // Filter to get a good selection of presets
            this.presetKeys = this.presetKeys.filter(key => {
                const skipPatterns = ['flexi', 'empty', 'test', '_'];
                return !skipPatterns.some(pattern => key.toLowerCase().includes(pattern));
            });

            if (this.presetKeys.length === 0) {
                this.presetKeys = Object.keys(this.presets);
            }

            // Shuffle presets for variety
            this.shufflePresets();

            console.log('[Butterchurn] Presets loaded:', this.presetKeys.length);

            // Notify system that presets are ready
            window.dispatchEvent(new CustomEvent('butterchurn-presets-loaded'));

            // If initialized (visualizer ready), load a preset immediately
            if (this.isInitialized && this.visualizer) {
                this.loadNextPreset();
            }
        } catch (e) {
            console.error('[Butterchurn] Failed to load presets:', e);
            this.presets = {};
            this.presetKeys = [];
        } finally {
            this.isLoadingPresets = false;
        }
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
            this.loadNextPreset();

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
     * Load next preset based on settings (sequential or random)
     */
    loadNextPreset() {
        if (!this.visualizer || this.presetKeys.length === 0) return;

        // If cycle enabled is false, don't change preset automatically unless forced (e.g. init or manual next)
        // But here we are just loading 'a' preset.
        // The cycling logic is in draw().

        // Wait, loadNextPreset is general.
        // Let's check settings inside loadNextPreset?
        // No, loadNextPreset is an action. It should just do it.
        // The caller decides when.

        const randomize = visualizerSettings.isButterchurnRandomizeEnabled();

        if (randomize) {
            this.currentPresetIndex = Math.floor(Math.random() * this.presetKeys.length);
        } else {
            this.currentPresetIndex = (this.currentPresetIndex + 1) % this.presetKeys.length;
        }

        const presetKey = this.presetKeys[this.currentPresetIndex];
        const preset = this.presets[presetKey];

        if (preset) {
            try {
                this.visualizer.loadPreset(preset, this.blendDuration);
                // console.log('[Butterchurn] Loaded preset:', presetKey);
            } catch (error) {
                console.warn('[Butterchurn] Failed to load preset:', presetKey, error);
                // Try next preset
                if (this.presetKeys.length > 1) {
                    this.loadNextPreset();
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

            // Update current index if found
            const index = this.presetKeys.indexOf(presetName);
            if (index !== -1) {
                this.currentPresetIndex = index;
            }
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
     * Skip to next preset (manually triggered)
     */
    nextPreset() {
        this.loadNextPreset();
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

        // Auto-cycle presets
        const isCycleEnabled = visualizerSettings.isButterchurnCycleEnabled();
        if (isCycleEnabled) {
            const cycleDuration = this.getPresetDuration();
            if (cycleDuration > 0 && now - this.lastPresetChange > cycleDuration) {
                this.loadNextPreset();
                this.lastPresetChange = now;
            }
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
