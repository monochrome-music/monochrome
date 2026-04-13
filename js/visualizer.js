// js/visualizer.js
import { visualizerSettings } from './storage.js';
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
        this._backgroundPaused = false;

        // Pause animation loop when the app is backgrounded so the analyser's
        // FFT reads don't compete with the EQ biquad filter chain for audio
        // thread time - the main cause of audio skipping with AutoEQ in background.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.isActive) {
                this._backgroundPaused = true;
                if (this.animationId) {
                    cancelAnimationFrame(this.animationId);
                    this.animationId = null;
                }
            } else if (document.visibilityState === 'visible' && this._backgroundPaused) {
                this._backgroundPaused = false;
                if (this.isActive && !this.animationId) {
                    this.animate();
                }
            }
        });
    }

    /**
     * Must be called after class is constructed!
     */
    async initPresets() {
        this.presets = {
            lcd: new (await import('./visualizers/lcd.js')).LCDPreset(),
            particles: new (await import('./visualizers/particles.js')).ParticlesPreset(),
            'unknown-pleasures': new (await import('./visualizers/unknown_pleasures_webgl.js')).UnknownPleasuresWebGL(),
            butterchurn: new (await import('./visualizers/butterchurn.js')).ButterchurnPreset(),
            kawarp: new (await import('./visualizers/kawarp.js')).KawarpPreset(),
        };
    }

    updateDimming() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const dimAmount = visualizerSettings.getDimAmount();
        this.canvas.parentElement.style.opacity = dimAmount.toString();
    }

    get activePreset() {
        return this.presets[this.activePresetKey] || this.presets['lcd'];
    }

    async init() {
        // Ensure shared audio context is initialized
        if (!audioContextManager.isReady()) {
            audioContextManager.init(this.audio);
        }

        this.audioContext = audioContextManager.getAudioContext();
        this.analyser = audioContextManager.getAnalyser();

        this.bufferLength = this.analyser?.frequencyBinCount || 512;
        if (!this.dataArray || this.dataArray.length !== this.bufferLength) {
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
        return audioContextManager.getSourceNode();
    }

    initContext() {
        const preset = this.activePreset;
        const type = preset.contextType || '2d';
        const currentType = this._currentContextType;

        // Clone the canvas to get a fresh context when switching context types,
        // or when the previous preset grabbed its own context (managesOwnContext)
        const needsClone = (this.ctx && currentType !== type) || (!this.ctx && currentType && currentType !== type);

        if (needsClone) {
            const parent = this.canvas.parentElement;
            const newCanvas = this.canvas.cloneNode(true);
            parent.replaceChild(newCanvas, this.canvas);
            this.canvas = newCanvas;
            this.ctx = null;
        }

        // Kawarp grabs its own WebGL context, so we skip this
        if (preset.managesOwnContext) {
            this._currentContextType = type;
            return;
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

    async start() {
        if (this.isActive) return true;

        if (!this.ctx) {
            this.initContext();
        }
        if (!this.audioContext && !this.analyser) {
            await this.init();
        }

        const canRunWithoutAnalyser = !!this.activePreset?.managesOwnContext;
        if (!this.analyser && !canRunWithoutAnalyser) {
            return false;
        }

        this.isActive = true;

        if (this.audioContext?.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.updateDimming();

        // Set canvas dimensions before preset init so WebGL framebuffers are created at correct size
        this.resize();
        window.addEventListener('resize', this._resizeBound);
        this.canvas.style.display = 'block';

        // Initialize presets that need lazy init (Butterchurn, Kawarp)
        if (this.activePreset.lazyInit) {
            const sourceNode = audioContextManager.getSourceNode();
            await this.activePreset.lazyInit(this.canvas, this.audioContext, sourceNode);
            this.resize();
        }

        if (this.activePreset.managesOwnContext && this.activePreset.isInitialized === false) {
            this.isActive = false;
            this.canvas.style.display = 'none';
            window.removeEventListener('resize', this._resizeBound);
            return false;
        }

        this.animate();
        return true;
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

        const stats = this.stats;

        if (this.analyser && this.dataArray && this.audioContext) {
            this.analyser.getByteFrequencyData(this.dataArray);

            const volume = 10 * Math.max(this.audio.volume, 0.1);
            const binSize = this.audioContext.sampleRate / this.analyser.fftSize;
            const startBin = 1;
            let numBins = Math.floor(250 / binSize);
            if (numBins < 1) numBins = 1;

            let maxVal = 0;
            for (let i = 0; i < numBins && startBin + i < this.dataArray.length; i++) {
                const val = this.dataArray[startBin + i];
                if (val > maxVal) maxVal = val;
            }

            const bass = maxVal / 255 / volume;
            const intensity = bass * bass * 10;

            stats.energyAverage = stats.energyAverage * 0.99 + intensity * 0.01;
            stats.upbeatSmoother = stats.upbeatSmoother * 0.92 + intensity * 0.08;

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

            const now = performance.now();
            const threshold = stats.energyAverage < 0.3 ? 0.5 + (0.3 - stats.energyAverage) * 2 : 0.5;

            if (intensity > threshold * 0.7) {
                if (intensity > stats.lastIntensity + 0.03 && now - stats.lastBeatTime > 50) {
                    stats.kick = 1.0;
                    stats.lastBeatTime = now;
                } else if (stats.upbeatSmoother > 0.6 && stats.energyAverage > 0.4) {
                    const upbeatLevel = (stats.upbeatSmoother - 0.6) / 0.4;
                    if (stats.kick < upbeatLevel) {
                        stats.kick = upbeatLevel;
                    } else {
                        stats.kick *= 0.95;
                    }
                } else {
                    stats.kick *= 0.9;
                }
            } else {
                stats.kick *= 0.95;
            }

            stats.lastIntensity = intensity;
            stats.intensity = intensity;
            stats.sensitivity = sensitivity;
        } else {
            stats.kick *= 0.92;
            stats.intensity *= 0.92;
            stats.energyAverage *= 0.98;
            stats.upbeatSmoother *= 0.95;
            stats.sensitivity = visualizerSettings.getSensitivity();
            this.dataArray?.fill(0);
        }

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

        const webglPresets = ['butterchurn', 'kawarp'];
        const fromPreset = this.activePresetKey;
        const toPreset = key;

        if (webglPresets.includes(fromPreset) && webglPresets.includes(toPreset) && fromPreset !== toPreset) {
            visualizerSettings.setPreset(key);
            window.location.reload();
            return;
        }

        if (this.activePreset?.destroy) {
            this.activePreset.destroy();
        }

        this._currentContextType = undefined;
        this.ctx = null;

        this.activePresetKey = key;
        this.initContext();
        this.resize();

        if (this.presets[key].lazyInit && this.audioContext) {
            const sourceNode = audioContextManager.getSourceNode();
            this.presets[key].lazyInit(this.canvas, this.audioContext, sourceNode).then(() => {
                this.resize();
            });
        }
    }

    applyPresetOverride(key) {
        if (!this.presets?.[key] || this.activePresetKey === key) return;

        if (this.activePreset?.destroy) {
            this.activePreset.destroy();
        }

        this._currentContextType = undefined;
        this.ctx = null;
        this.activePresetKey = key;
    }
}
