// js/visualizers/kawarp.js

const KAWARP_DEFAULTS = {
    warpIntensity: 1,
    blurPasses: 8,
    animationSpeed: 1,
    transitionDuration: 1000,
    saturation: 1.5,
    dithering: 0.008,
    scale: 1.25,
};

const BEAT_THRESHOLD = 0.75;
const SPEED_MULTIPLIER = 4;
const SCALE_BOOST_PCT = 2;
const BOOSTED_SCALE = KAWARP_DEFAULTS.scale + SCALE_BOOST_PCT / 100;
const SCALE_LERP_UP = 0.5;
const SCALE_LERP_DOWN = 0.12;
const SCALE_THRESHOLD = 0.001;
const ANALYSIS_INTERVAL = 100;
const CACHE_BUST_PARAM = 'not-from-cache-please';

export class KawarpPreset {
    constructor() {
        this.name = 'Kawarp';
        this.contextType = 'webgl';
        this.managesOwnContext = true;

        this.kawarp = null;
        this.canvas = null;
        this.audioElement = null;
        this.isInitialized = false;
        this._lastCoverUrl = null;
        this._currentScale = KAWARP_DEFAULTS.scale;
        this._targetScale = KAWARP_DEFAULTS.scale;
        this._lastAnalysisTime = 0;
        this._coverObserver = null;

        this._onPlay = () => {
            if (this.kawarp) this.kawarp.start();
        };
        this._onPause = () => {
            if (this.kawarp) this.kawarp.stop();
        };
    }

    async lazyInit(canvas, _audioContext, _sourceNode) {
        if (this.isInitialized) {
            if (canvas !== this.canvas) {
                this._destroyKawarp();
            } else {
                this._ensureStarted();
                return;
            }
        }

        try {
            const { Kawarp } = await import('@kawarp/core');

            this.canvas = canvas;
            this.kawarp = new Kawarp(canvas, { ...KAWARP_DEFAULTS });

            this.audioElement = document.getElementById('audio-player');
            if (this.audioElement) {
                this.audioElement.addEventListener('play', this._onPlay);
                this.audioElement.addEventListener('pause', this._onPause);
            }

            this._observeCoverArt();

            const coverEl = document.querySelector('.now-playing-bar .cover');
            if (coverEl?.tagName === 'IMG' && coverEl.src) {
                this._lastCoverUrl = coverEl.src;
                this._loadCover(coverEl.src);
            }

            this.kawarp.start();
            this.isInitialized = true;
        } catch (error) {
            console.error('[Kawarp] Init failed:', error);
        }
    }

    connectAudio() {}

    _ensureStarted() {
        if (!this.kawarp) return;
        if (this.kawarp.isPlaying) return;
        if (this.audioElement?.paused) return;
        this.kawarp.start();
    }

    _observeCoverArt() {
        const container = document.querySelector('.now-playing-bar');
        if (!container) return;

        this._coverObserver = new MutationObserver(() => {
            const el = document.querySelector('.now-playing-bar .cover');
            const src = el?.tagName === 'IMG' ? el.src : null;
            if (!src || src === this._lastCoverUrl) return;
            this._lastCoverUrl = src;
            if (this.kawarp && this.isInitialized) {
                this._loadCover(src);
            }
        });

        this._coverObserver.observe(container, {
            attributes: true,
            attributeFilter: ['src'],
            subtree: true,
            childList: true,
        });
    }

    _loadCover(url) {
        // Cache buster forces a fresh CORS request, bypassing the browser's
        // cached non-CORS response from the <img> tag (same pattern as ui.js)
        const sep = url.includes('?') ? '&' : '?';
        this.kawarp
            .loadImage(`${url}${sep}${CACHE_BUST_PARAM}`)
            .catch((err) => console.warn('[Kawarp] Failed to load cover:', err));
    }

    resize(_w, _h) {
        if (this.kawarp) this.kawarp.resize();
    }

    draw(ctx, canvas, analyser, dataArray, stats) {
        if (!this.kawarp || !this.isInitialized) return;

        this._ensureStarted();

        // Beat detection, throttled to every 100ms
        const now = performance.now();
        if (analyser && now - this._lastAnalysisTime >= ANALYSIS_INTERVAL) {
            const buf = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteTimeDomainData(buf);

            let peak = 0;
            for (let i = 0; i < buf.length; i++) {
                const a = Math.abs(buf[i] - 128) / 128;
                if (a > peak) {
                    peak = a;
                    if (peak > BEAT_THRESHOLD) break;
                }
            }

            const isBeat = peak > BEAT_THRESHOLD;

            this.kawarp.animationSpeed = isBeat
                ? KAWARP_DEFAULTS.animationSpeed * SPEED_MULTIPLIER
                : KAWARP_DEFAULTS.animationSpeed;

            this._targetScale = isBeat ? BOOSTED_SCALE : KAWARP_DEFAULTS.scale;

            this._lastAnalysisTime = now;
        }

        // Scale lerp
        const diff = this._targetScale - this._currentScale;
        if (Math.abs(diff) > SCALE_THRESHOLD) {
            const lerp = diff > 0 ? SCALE_LERP_UP : SCALE_LERP_DOWN;
            this._currentScale += diff * lerp;
            this.kawarp.scale = this._currentScale;
        }

        // Blended mode support
        if (stats.mode === 'blended') {
            canvas.style.opacity = '0.85';
            canvas.style.mixBlendMode = 'screen';
        } else {
            canvas.style.opacity = '1';
            canvas.style.mixBlendMode = 'normal';
        }
    }

    _destroyKawarp() {
        if (this.kawarp) {
            this.kawarp.stop();
            this.kawarp.dispose();
            this.kawarp = null;
        }
        this.canvas = null;
        this.isInitialized = false;
    }

    destroy() {
        if (this._coverObserver) {
            this._coverObserver.disconnect();
            this._coverObserver = null;
        }
        if (this.audioElement) {
            this.audioElement.removeEventListener('play', this._onPlay);
            this.audioElement.removeEventListener('pause', this._onPause);
            this.audioElement = null;
        }
        this._destroyKawarp();
        this._lastCoverUrl = null;
        this._currentScale = KAWARP_DEFAULTS.scale;
        this._targetScale = KAWARP_DEFAULTS.scale;
    }
}
