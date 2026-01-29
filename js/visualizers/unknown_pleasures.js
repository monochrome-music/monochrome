export class UnknownPleasuresPreset {
    constructor() {
        this.name = 'Unknown Pleasures';
        this.historySize = 30;
        this.dataPoints = 96;

        this.history = [];
        this.writeIndex = 0;

        this.pLookup = new Float32Array(this.dataPoints);
        this.xLookup = new Float32Array(this.dataPoints);

        // palette cache
        this._palette = null;
        this._paletteColor = '';

        this.reset();
        this._precompute();
    }

    reset() {
        this.history.length = 0;
        for (let i = 0; i < this.historySize; i++) {
            this.history.push(new Float32Array(this.dataPoints));
        }
        this.writeIndex = 0;
    }

    resize() {}
    destroy() {
        this.history.length = 0;
    }

    _precompute() {
        const pts = this.dataPoints;
        const inv = 1 / (pts - 1);
        for (let i = 0; i < pts; i++) {
            const p = Math.abs(i * inv - 0.5) * 2;
            this.pLookup[i] = 1 - p * p * p;
            this.xLookup[i] = i * inv;
        }
    }

    _buildPalette(color) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        // perceptual grayscale (same weights browsers use)
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        this._palette = new Array(this.historySize);

        for (let i = 0; i < this.historySize; i++) {
            const p = i / (this.historySize - 1);

            // === Saturation gradient (HSL-like) ===
            const sat = 3.0 - 2 * p;
            const rr = (gray + (r - gray) * sat) | 0;
            const gg = (gray + (g - gray) * sat) | 0;
            const bb = (gray + (b - gray) * sat) | 0;

            this._palette[i] = `rgba(${rr},${gg},${bb}, 1.0)`;
        }

        this._paletteColor = color;
    }

    draw(ctx, canvas, analyser, dataArray, params) {
        // Init if empty (e.g. after destroy/switch)
        if (this.history.length === 0) {
            this.reset();
        }

        const pts = this.dataPoints;
        const len = dataArray.length | 0;

        const line = this.history[this.writeIndex];
        if (line) {
            for (let i = 0; i < pts; i++) {
                line[i] = (dataArray[(this.xLookup[i] * len) | 0] / 255) * this.pLookup[i];
            }
        }
        this.writeIndex = (this.writeIndex + 1) % this.historySize;

        if (this._paletteColor !== params.primaryColor) {
            this._buildPalette(params.primaryColor);
        }

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        const size = Math.hypot(width, height) * 1.42;

        ctx.save();
        ctx.translate((width + size) / 2, height / 2);
        ctx.rotate(Math.PI / 6);
        ctx.translate(-(width + size) / 2, -height / 2);

        // SINGLE shadow pass (cheap)
        ctx.shadowColor = params.primaryColor;
        ctx.shadowBlur = 32 * (1 + params.kick * 2);
        ctx.lineJoin = 'round';
        ctx.shadowOffsetX = params.kick * 10;
        ctx.shadowOffsetY = params.kick * 10;
        const horizonY = size * 0.1;
        const frontY = size * 0.8;
        const depth = 2.0;

        const totalH = frontY - horizonY;
        const B = totalH / (1 - 1 / (1 + depth));
        const A = frontY - B;

        for (let i = this.historySize - 1; i >= 0; i--) {
            const idx = (this.writeIndex + i) % this.historySize;
            const data = this.history[idx];

            const p = 1 - i / (this.historySize - 1);
            const z = 1 + p * depth;
            const scale = 1 / z;
            const y = A + B / z;

            ctx.strokeStyle = this._palette[i];
            ctx.lineWidth = Math.max(1, 8 * scale + params.kick * 6);

            const lw = size * scale * 1.5;
            const margin = (size - lw) * 0.5;
            const amp = 200 * scale + params.kick * 100;

            ctx.beginPath();
            ctx.moveTo(margin, y);

            for (let j = 0; j < pts; j++) {
                ctx.lineTo(margin + this.xLookup[j] * lw, y - data[j] * amp);
            }
            ctx.stroke();
        }

        ctx.restore();
    }
}
