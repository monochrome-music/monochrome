// js/performance-mode.js
// Performance Mode Manager for Monochrome music player
// Controls animations, visual effects, and audio processing based on user preferences

import { audioContextManager } from './audio-context.js';

class PerformanceModeManager {
    constructor() {
        this.mode = 'beast'; // 'beast', 'quality', 'balanced', 'performance', 'extreme'
        this.settings = {
            beast: {
                // Maximum quality and animations - the ultimate experience
                animations: true,
                animationIntensity: 'enhanced',
                backgroundBlur: true,
                blurIntensity: 'high',
                visualizer: true,
                visualizerQuality: 'ultra',
                dynamicColors: true,
                colorExtraction: 'full',
                preampCache: true,
                aggressivePreload: true,
                audioWorklet: true,
                lowLatency: false, // Prioritize quality over latency
                imageQuality: 'highest',
                imageUpscaling: true,
                cardPreload: 8,
                eqBands: 32,
                particleEffects: true,
                smoothTransitions: true,
                carouselAnimations: true,
                loadAnimations: true,
                gpuAcceleration: true,
            },
            quality: {
                animations: true,
                animationIntensity: 'normal',
                backgroundBlur: true,
                blurIntensity: 'medium',
                visualizer: true,
                visualizerQuality: 'high',
                dynamicColors: true,
                colorExtraction: 'standard',
                preampCache: true,
                aggressivePreload: true,
                audioWorklet: false,
                lowLatency: false,
                imageQuality: 'high',
                imageUpscaling: false,
                cardPreload: 6,
                eqBands: 24,
                particleEffects: true,
                smoothTransitions: true,
                carouselAnimations: true,
                loadAnimations: true,
                gpuAcceleration: true,
            },
            balanced: {
                animations: true,
                animationIntensity: 'normal',
                backgroundBlur: true,
                blurIntensity: 'low',
                visualizer: true,
                visualizerQuality: 'medium',
                dynamicColors: true,
                colorExtraction: 'standard',
                preampCache: true,
                aggressivePreload: false,
                audioWorklet: false,
                lowLatency: false,
                imageQuality: 'medium',
                imageUpscaling: false,
                cardPreload: 4,
                eqBands: 16,
                particleEffects: false,
                smoothTransitions: true,
                carouselAnimations: true,
                loadAnimations: true,
                gpuAcceleration: true,
            },
            performance: {
                animations: true,
                animationIntensity: 'reduced',
                backgroundBlur: false,
                blurIntensity: 'none',
                visualizer: false,
                visualizerQuality: 'low',
                dynamicColors: false,
                colorExtraction: 'disabled',
                preampCache: true,
                aggressivePreload: false,
                audioWorklet: true,
                lowLatency: true,
                imageQuality: 'medium',
                imageUpscaling: false,
                cardPreload: 2,
                eqBands: 10,
                particleEffects: false,
                smoothTransitions: false,
                carouselAnimations: false,
                loadAnimations: false,
                gpuAcceleration: true,
            },
            extreme: {
                // Maximum performance for low-end devices
                animations: false,
                animationIntensity: 'none',
                backgroundBlur: false,
                blurIntensity: 'none',
                visualizer: false,
                visualizerQuality: 'disabled',
                dynamicColors: false,
                colorExtraction: 'disabled',
                preampCache: true,
                aggressivePreload: false,
                audioWorklet: true,
                lowLatency: true,
                imageQuality: 'low',
                imageUpscaling: false,
                cardPreload: 0,
                eqBands: 8,
                particleEffects: false,
                smoothTransitions: false,
                carouselAnimations: false,
                loadAnimations: false,
                gpuAcceleration: false,
            },
        };

        // Load saved mode on init
        this.loadSavedMode();
    }

    /**
     * Set the performance mode
     * @param {string} mode - One of: 'extreme', 'performance', 'balanced', 'quality'
     */
    setMode(mode) {
        if (!this.settings[mode]) {
            console.warn(`[PerformanceMode] Invalid mode: ${mode}`);
            return;
        }
        this.mode = mode;
        this.applySettings(this.settings[mode]);
        this.saveMode(mode);
    }

    /**
     * Get the current performance mode
     * @returns {string} Current mode
     */
    getMode() {
        return this.mode;
    }

    /**
     * Get the settings for the current mode
     * @returns {Object} Current settings
     */
    getSettings() {
        return { ...this.settings[this.mode] };
    }

    /**
     * Get a specific setting value
     * @param {string} key - Setting key
     * @returns {*} Setting value
     */
    getSetting(key) {
        return this.settings[this.mode]?.[key];
    }

    /**
     * Save mode to localStorage
     * @param {string} mode - Mode to save
     */
    saveMode(mode) {
        try {
            localStorage.setItem('performance-mode', mode);
        } catch (e) {
            console.warn('[PerformanceMode] Failed to save mode:', e);
        }
    }

    /**
     * Load saved mode from localStorage
     */
    loadSavedMode() {
        try {
            const saved = localStorage.getItem('performance-mode');
            if (saved && this.settings[saved]) {
                this.mode = saved;
            } else {
                // Auto-detect optimal mode
                this.mode = this.autoDetect();
            }
            // Apply settings on load
            this.applySettings(this.settings[this.mode]);
        } catch (e) {
            console.warn('[PerformanceMode] Failed to load saved mode:', e);
            this.mode = 'balanced';
        }
    }

    /**
     * Apply settings to the application
     * @param {Object} settings - Settings to apply
     */
    applySettings(settings) {
        const root = document.documentElement;

        // Apply animation settings
        if (!settings.animations) {
            root.classList.add('animations-none');
            root.classList.remove('animations-reduced', 'animations-enhanced');
        } else {
            root.classList.remove('animations-none');
        }

        // Apply background blur
        root.style.setProperty('--background-blur', settings.backgroundBlur ? '20px' : '0px');

        // Apply visualizer setting via custom property
        root.style.setProperty('--visualizer-enabled', settings.visualizer ? '1' : '0');

        // Apply dynamic colors setting
        root.style.setProperty('--dynamic-colors-enabled', settings.dynamicColors ? '1' : '0');

        // Apply image quality
        root.style.setProperty('--image-quality', settings.imageQuality);

        // Apply low latency mode to audio context
        if (audioContextManager && typeof audioContextManager.setLowLatencyMode === 'function') {
            audioContextManager.setLowLatencyMode(settings.lowLatency);
        }

        // Dispatch event for other components to react
        window.dispatchEvent(
            new CustomEvent('performance-mode-changed', {
                detail: { mode: this.mode, settings },
            })
        );

        console.log(`[PerformanceMode] Applied ${this.mode} mode:`, settings);
    }

    /**
     * Auto-detect optimal mode based on device capabilities
     * @returns {string} Detected optimal mode
     */
    autoDetect() {
        // Check available memory (in GB)
        const memory = navigator.deviceMemory || 4;

        // Check CPU cores
        const cores = navigator.hardwareConcurrency || 2;

        // Check if mobile device
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // Check connection speed
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const slowConnection =
            connection &&
            (connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g' || connection.saveData);

        // Check for reduced motion preference
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Determine optimal mode
        if (slowConnection || memory < 2 || cores < 2 || prefersReducedMotion) {
            return 'extreme';
        } else if (isMobile || memory < 4 || cores < 4) {
            return 'performance';
        } else if (memory >= 8 && cores >= 8) {
            return 'quality';
        }

        return 'balanced';
    }

    /**
     * Check if animations are enabled
     * @returns {boolean}
     */
    isAnimationsEnabled() {
        return this.settings[this.mode]?.animations ?? true;
    }

    /**
     * Check if background blur is enabled
     * @returns {boolean}
     */
    isBackgroundBlurEnabled() {
        return this.settings[this.mode]?.backgroundBlur ?? true;
    }

    /**
     * Check if visualizer is enabled
     * @returns {boolean}
     */
    isVisualizerEnabled() {
        return this.settings[this.mode]?.visualizer ?? true;
    }

    /**
     * Check if dynamic colors are enabled
     * @returns {boolean}
     */
    isDynamicColorsEnabled() {
        return this.settings[this.mode]?.dynamicColors ?? true;
    }

    /**
     * Get the number of EQ bands for current mode
     * @returns {number}
     */
    getEQBands() {
        return this.settings[this.mode]?.eqBands ?? 16;
    }

    /**
     * Get the card preload count for current mode
     * @returns {number}
     */
    getCardPreload() {
        return this.settings[this.mode]?.cardPreload ?? 4;
    }

    /**
     * Get the image quality for current mode
     * @returns {string}
     */
    getImageQuality() {
        return this.settings[this.mode]?.imageQuality ?? 'high';
    }

    /**
     * Toggle between modes (cycles through: extreme -> performance -> balanced -> quality)
     * @returns {string} New mode
     */
    toggle() {
        const modes = ['extreme', 'performance', 'balanced', 'quality'];
        const currentIndex = modes.indexOf(this.mode);
        const nextIndex = (currentIndex + 1) % modes.length;
        const newMode = modes[nextIndex];
        this.setMode(newMode);
        return newMode;
    }

    /**
     * Get a description of the current mode
     * @returns {string} Human-readable description
     */
    getDescription() {
        const descriptions = {
            extreme: 'Lowest resource usage. Disables animations, blur, and visual effects.',
            performance: 'Optimized for speed. Minimal visual effects.',
            balanced: 'Default experience. Good balance of visuals and performance.',
            quality: 'Best visual experience. All effects enabled.',
        };
        return descriptions[this.mode] || descriptions.balanced;
    }

    /**
     * Get all available modes with their settings
     * @returns {Object} All modes and settings
     */
    getAllModes() {
        return Object.entries(this.settings).map(([key, value]) => ({
            key,
            ...value,
        }));
    }
}

// Create singleton instance
export const performanceMode = new PerformanceModeManager();
