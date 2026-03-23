// js/spectrum-analyzer.js
// Mini Spectrum Analyzer for the player bar
// Renders a small real-time frequency visualization next to the player controls

export class SpectrumAnalyzer {
  constructor(options = {}) {
    this.canvas = null;
    this.ctx = null;
    this.analyser = null;
    this.audioContext = null;
    this.source = null;
    this.animationId = null;
    this.isRunning = false;
    this.barCount = options.barCount || 32;
    this.barWidth = options.barWidth || 2;
    this.barGap = options.barGap || 1;
    this.height = options.height || 30;
    this.width = options.width || 120;
    this.colorStart = options.colorStart || '#00f0ff';
    this.colorEnd = options.colorEnd || '#ff00ff';
    this.smoothing = options.smoothing || 0.8;
    this.minDecibels = options.minDecibels || -90;
    this.maxDecibels = options.maxDecibels || -10;
  }

  createCanvas(container) {
    if (this.canvas) this.canvas.remove();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.className = 'spectrum-analyzer-mini';
    this.canvas.style.cssText = `
      width: ${this.width}px;
      height: ${this.height}px;
      border-radius: 4px;
      opacity: 0.85;
      cursor: pointer;
      flex-shrink: 0;
    `;
    this.ctx = this.canvas.getContext('2d');
    if (container) container.appendChild(this.canvas);
    this.canvas.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('spectrum-analyzer-click'));
    });
    return this.canvas;
  }

  connect(audioContext, sourceNode) {
    this.audioContext = audioContext;
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = this.smoothing;
    this.analyser.minDecibels = this.minDecibels;
    this.analyser.maxDecibels = this.maxDecibels;
    try {
      sourceNode.connect(this.analyser);
    } catch (e) {
      console.warn('[SpectrumAnalyzer] Could not connect source:', e);
    }
    this.source = sourceNode;
  }

  start() {
    if (this.isRunning || !this.analyser || !this.ctx) return;
    this.isRunning = true;
    this._draw();
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  _draw() {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(() => this._draw());
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    this.ctx.clearRect(0, 0, this.width, this.height);
    const step = Math.floor(bufferLength / this.barCount);
    const totalBarWidth = this.barWidth + this.barGap;
    for (let i = 0; i < this.barCount; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += dataArray[i * step + j] || 0;
      }
      const avg = sum / step;
      const barHeight = (avg / 255) * this.height;
      const x = i * totalBarWidth;
      const ratio = i / this.barCount;
      const color = this._interpolateColor(this.colorStart, this.colorEnd, ratio);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x, this.height - barHeight, this.barWidth, barHeight);
    }
  }

  _interpolateColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1, 3), 16);
    const g1 = parseInt(c1.slice(3, 5), 16);
    const b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16);
    const g2 = parseInt(c2.slice(3, 5), 16);
    const b2 = parseInt(c2.slice(5, 7), 16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }

  setColors(start, end) {
    this.colorStart = start;
    this.colorEnd = end;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
    }
  }

  destroy() {
    this.stop();
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.analyser = null;
    this.source = null;
    this.ctx = null;
  }
}
