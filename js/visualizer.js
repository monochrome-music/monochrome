//js/visualizer.js
import { visualizerSettings } from './storage.js';

export class Visualizer {
    constructor(canvas, audio) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.audio = audio;
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.isActive = false;
        this.animationId = null;
        this.particles = [];

        this.kick = 0;
        this.lastIntensity = 0;
        this.lastBeatTime = 0;
        this.energyAverage = 0.3;
        this.upbeatSmoother = 0;
    }

    init() {
        if (this.audioContext) return;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.7;

            this.source = this.audioContext.createMediaElementSource(this.audio);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        } catch (e) {
            console.warn('Visualizer init failed (likely CORS or already connected):', e);
        }
    }

    start() {
        if (this.isActive) return;
        if (!this.audioContext) this.init();
        if (!this.analyser) return;

        this.isActive = true;
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.resize();
        window.addEventListener('resize', this.resizeBound);
        this.canvas.style.display = 'block';

        this.particles = [];
        this.energyAverage = 0.3;
        this.kick = 0;
        this.upbeatSmoother = 0;
        this.animate();
    }

    stop() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        window.removeEventListener('resize', this.resizeBound);

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.style.display = 'none';
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    resizeBound = () => this.resize();

    animate() {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(() => this.animate());

        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        let sensitivity = visualizerSettings.getSensitivity();
        const mode = visualizerSettings.getMode();
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        if (mode === 'blended') {
            ctx.clearRect(0, 0, w, h);
        } else {
            // Match background to theme if in solid mode
            if (isDark) {
                ctx.fillStyle = 'rgba(10, 10, 10, 0.3)';
            } else {
                ctx.fillStyle = 'rgba(240, 240, 240, 0.3)';
            }
            ctx.fillRect(0, 0, w, h);
        }

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        let bassSum = 0;
        for (let i = 0; i < 4; i++) bassSum += dataArray[i];
        const bass = bassSum / 4 / 255;
        const intensity = bass * bass;

        this.energyAverage = this.energyAverage * 0.99 + intensity * 0.01;
        this.upbeatSmoother = this.upbeatSmoother * 0.92 + intensity * 0.08;

        if (visualizerSettings.isSmartIntensityEnabled()) {
            let target = 0.1;
            if (this.energyAverage > 0.4) {
                target = 0.7;
            } else if (this.energyAverage > 0.2) {
                const t = (this.energyAverage - 0.2) / 0.2;
                target = 0.1 + t * 0.6;
            }
            sensitivity = target;
        }

        let threshold = 0.5;
        if (this.energyAverage < 0.3) {
            threshold = 0.5 + (0.3 - this.energyAverage) * 2;
        }

        const now = Date.now();
        if (intensity > threshold) {
            if (intensity > this.lastIntensity + 0.05 && now - this.lastBeatTime > 50) {
                this.kick = 1.0;
                this.lastBeatTime = now;
            } else {
                if (this.upbeatSmoother > 0.6 && this.energyAverage > 0.4) {
                    const upbeatLevel = (this.upbeatSmoother - 0.6) / 0.4;
                    if (this.kick < upbeatLevel) {
                        this.kick = upbeatLevel;
                    } else {
                        this.kick *= 0.95;
                    }
                } else {
                    this.kick *= 0.9;
                }
            }
        } else {
            this.kick *= 0.95;
        }
        this.lastIntensity = intensity;

        let shakeX = 0;
        let shakeY = 0;
        if (this.kick > 0.1) {
            const shakeAmt = this.kick * 8 * sensitivity;
            shakeX = (Math.random() - 0.5) * shakeAmt;
            shakeY = (Math.random() - 0.5) * shakeAmt;
        }

        const primaryColor =
            getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#ffffff';

        const particleCount = 180;
        if (this.particles.length !== particleCount) {
            this.particles = [];
            for (let i = 0; i < particleCount; i++) {
                this.particles.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    vx: (Math.random() - 0.5) * 2,
                    vy: (Math.random() - 0.5) * 2,
                    baseSize: Math.random() * 3 + 1,
                });
            }
        }

        ctx.save();
        ctx.translate(shakeX, shakeY);

        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = primaryColor;

        const maxDist = 150 + intensity * 50 + this.kick * 50 * sensitivity;
        const maxDistSq = maxDist * maxDist;

        for (let i = 0; i < this.particles.length; i++) {
            let p = this.particles[i];

            const speedMult = 1 + intensity * 2 + this.kick * 8 * sensitivity;
            p.x += p.vx * speedMult;
            p.y += p.vy * speedMult;

            if (this.kick > 0.3) {
                p.x += (Math.random() - 0.5) * this.kick * 2 * sensitivity;
                p.y += (Math.random() - 0.5) * this.kick * 2 * sensitivity;
            }

            if (p.x < 0) p.x = w;
            if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h;
            if (p.y > h) p.y = 0;

            const size = p.baseSize * (1 + intensity * 0.5 + this.kick * 0.8 * sensitivity);
            ctx.globalAlpha = 0.4 + intensity * 0.2 + this.kick * 0.15 * sensitivity;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fill();

            for (let j = i + 1; j < this.particles.length; j++) {
                const p2 = this.particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;

                // Optimization: Early exit for x distance
                if (Math.abs(dx) > maxDist) continue;

                const distSq = dx * dx + dy * dy;

                if (distSq < maxDistSq) {
                    const dist = Math.sqrt(distSq); // Still need dist for alpha/linewidth, but now we only sqrt when necessary
                    ctx.beginPath();
                    ctx.lineWidth = (1 - dist / maxDist) * (1 + this.kick * 1.5 * sensitivity);
                    ctx.globalAlpha = (1 - dist / maxDist) * (0.3 + intensity * 0.2 + this.kick * 0.3 * sensitivity);
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }
}
