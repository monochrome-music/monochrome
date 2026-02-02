// js/visualizer.js
import { visualizerSettings } from './storage.js';
import { LCDPreset } from './visualizers/lcd.js';
import { ParticlesPreset } from './visualizers/particles.js';
import { UnknownPleasuresWebGL } from './visualizers/unknown_pleasures_webgl.js';
import { audioContextManager } from './audio-context.js';

export class Visualizer {
    constructor(canvas, audio) {
        this.canvas = canvas;
        this.ctx = null;
        this.audio = audio;

        this.audioContext = null;
        this.analyser = null;

        this.isActive = false;
        this.animationId = null;

        this.presets = {
            lcd: new LCDPreset(),
            particles: new ParticlesPreset(),
            'unknown-pleasures': new UnknownPleasuresWebGL(),
        };

        this.activePresetKey = visualizerSettings.getPreset();

        // ---- AUDIO BUFFERS (REUSED) ----
        this.bufferLength = 0;
        this.dataArray = null;

        // ---- STATS (REUSED OBJECT) ----
        this.stats = {
            kick: 0,
            intensity: 0,
            energyAverage: 0.3,
            lastBeatTime: 0,
            lastIntensity: 0,
            upbeatSmoother: 0,
            sensitivity: 0.5,
            primaryColor: '#ffffff',
            mode: '',
        };

        // ---- CACHED STATE ----
        this._lastPrimaryColor = '';
        this._resizeBound = () => this.resize();
    }

    get activePreset() {
        return this.presets[this.activePresetKey] || this.presets['lcd'];
    }

    init() {
        // Ensure shared audio context is initialized
        if (!audioContextManager.isReady()) {
            audioContextManager.init(this.audio);
        }

        this.audioContext = audioContextManager.getAudioContext();
        this.analyser = audioContextManager.getAnalyser();

        if (this.analyser) {
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
        }
    }

    /**
     * Get the shared AudioContext for external use
     */
    getAudioContext() {
        return this.audioContext;
    }

    /**
     * Get the source node
     */
    getSourceNode() {
        return audioContextManager.source;
    }

    initContext() {
        const preset = this.activePreset;
        const type = preset.contextType || '2d';
        const currentType = this._currentContextType;

        // If context type changed, we need to recreate the canvas
        // (you can't get a different context type from the same canvas)
        if (this.ctx && currentType !== type) {
            // Clone and replace canvas to get fresh context
            const parent = this.canvas.parentElement;
            const newCanvas = this.canvas.cloneNode(true);
            parent.replaceChild(newCanvas, this.canvas);
            this.canvas = newCanvas;
            this.ctx = null;
        }

        if (this.ctx) return;

        if (type === 'webgl') {
            this.ctx =
                this.canvas.getContext('webgl2', {
                    alpha: true,
                    antialias: true,
                    preserveDrawingBuffer: true,
                    premultipliedAlpha: false,
                }) ||
                this.canvas.getContext('webgl', {
                    alpha: true,
                    antialias: true,
                    preserveDrawingBuffer: true,
                    premultipliedAlpha: false,
                });
        } else {
            this.ctx = this.canvas.getContext('2d');
        }

        this._currentContextType = type;
    }

    start() {
        if (this.isActive) return;

        if (!this.ctx) {
            this.initContext();
        }
        if (!this.audioContext) {
            this.init();
        }

        if (!this.analyser) {
            return;
        }

        this.isActive = true;

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.resize();
        window.addEventListener('resize', this._resizeBound);
        this.canvas.style.display = 'block';

        this.animate();
    }

    stop() {
        this.isActive = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        window.removeEventListener('resize', this._resizeBound);

        if (this.ctx && this.ctx.clearRect) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.canvas.style.display = 'none';
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (this.canvas.width !== w) this.canvas.width = w;
        if (this.canvas.height !== h) this.canvas.height = h;

        if (this.activePreset?.resize) {
            this.activePreset.resize(w, h);
        }
    }

    animate = () => {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(this.animate);

        // ===== AUDIO ANALYSIS =====
        this.analyser.getByteFrequencyData(this.dataArray);

        // Bass (first bins only — cheap)
        const volume = 10 * Math.max(this.audio.volume, 0.1);
        let bass =
            ((this.dataArray[0] + this.dataArray[1] + this.dataArray[2] + this.dataArray[3]) * 0.000980392) / volume;

        const intensity = bass * bass * 10;
        const stats = this.stats;

        stats.energyAverage = stats.energyAverage * 0.99 + intensity * 0.01;
        stats.upbeatSmoother = stats.upbeatSmoother * 0.92 + intensity * 0.08;

        // ===== SENSITIVITY =====
        let sensitivity = visualizerSettings.getSensitivity();
        if (visualizerSettings.isSmartIntensityEnabled()) {
            if (stats.energyAverage > 0.4) {
                sensitivity = 0.7;
            } else if (stats.energyAverage > 0.2) {
                sensitivity = 0.1 + ((stats.energyAverage - 0.2) / 0.2) * 0.6;
            } else {
                sensitivity = 0.1;
            }
        }

        // ===== KICK DETECTION =====
        const now = performance.now();
        let threshold = stats.energyAverage < 0.3 ? 0.5 + (0.3 - stats.energyAverage) * 2 : 0.5;

        // Lower threshold for more responsive kick
        if (intensity > threshold * 0.7) {
            if (intensity > stats.lastIntensity + 0.03 && now - stats.lastBeatTime > 50) {
                stats.kick = 1.0;
                stats.lastBeatTime = now;
            } else {
                if (stats.upbeatSmoother > 0.6 && stats.energyAverage > 0.4) {
                    const upbeatLevel = (stats.upbeatSmoother - 0.6) / 0.4;
                    if (stats.kick < upbeatLevel) {
                        stats.kick = upbeatLevel;
                    } else {
                        stats.kick *= 0.95;
                    }
                } else {
                    stats.kick *= 0.9;
                }
            }
        } else {
            stats.kick *= 0.95;
        }

        stats.lastIntensity = intensity;
        stats.intensity = intensity;
        stats.sensitivity = sensitivity;

        // ===== COLORS (CACHED) =====
        const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#ffffff';

        if (color !== this._lastPrimaryColor) {
            stats.primaryColor = color;
            this._lastPrimaryColor = color;
        }

        stats.mode = visualizerSettings.getMode();

        // ===== DRAW =====
        this.activePreset.draw(this.ctx, this.canvas, this.analyser, this.dataArray, stats);
    };

    setPreset(key) {
        if (!this.presets[key]) return;

        if (this.activePreset?.destroy) {
            this.activePreset.destroy();
        }

        this.activePresetKey = key;
        this.initContext();
        this.resize();
    }
}
