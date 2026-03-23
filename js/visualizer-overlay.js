// js/visualizer-overlay.js
// Mini audio visualizer overlay for the now-playing bar

export class VisualizerOverlay {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.canvas = null;
    this.ctx = null;
    this.analyser = null;
    this.audioContext = null;
    this.source = null;
    this.animId = null;
    this.isRunning = false;
    this.barCount = 24;
    this.enabled = localStorage.getItem('visualizer-overlay-enabled') !== 'false';
    this.style = localStorage.getItem('visualizer-overlay-style') || 'bars';
    this._connected = false;
    this._initUI();
  }

  _initUI() {
    const tryCreate = () => {
      const progressBar = document.querySelector('.now-playing-bar .progress-container') ||
                          document.querySelector('.now-playing-bar .progress-bar-container') ||
                          document.querySelector('#progress-bar');
      if (progressBar && progressBar.parentNode) {
        this._createCanvas(progressBar);
      } else {
        setTimeout(tryCreate, 500);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryCreate);
    } else {
      tryCreate();
    }
  }

  _createCanvas(progressBar) {
    if (this.canvas) return;
    const container = document.createElement('div');
    container.className = 'visualizer-overlay-container';
    container.style.cssText = `
      position:absolute;bottom:100%;left:0;right:0;height:40px;
      pointer-events:none;opacity:${this.enabled ? '0.6' : '0'};
      transition:opacity 0.3s ease;z-index:1;
    `;
    const canvas = document.createElement('canvas');
    canvas.className = 'visualizer-overlay-canvas';
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    container.appendChild(canvas);

    const parent = progressBar.parentNode;
    parent.style.position = 'relative';
    parent.insertBefore(container, progressBar);

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.container = container;
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Auto-connect when audio plays
    this.audioPlayer.addEventListener('play', () => {
      if (this.enabled) this.start();
    });
    this.audioPlayer.addEventListener('pause', () => this.stop());
    this.audioPlayer.addEventListener('ended', () => this.stop());

    // Toggle button
    this._createToggle();
  }

  _createToggle() {
    const likeBtn = document.querySelector('#now-playing-like-btn');
    if (!likeBtn) return;
    const btn = document.createElement('button');
    btn.className = 'visualizer-overlay-toggle';
    btn.title = 'Toggle Visualizer';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="4" height="12" rx="1"/><rect x="7" y="3" width="4" height="18" rx="1"/><rect x="13" y="8" width="4" height="8" rx="1"/><rect x="19" y="5" width="4" height="14" rx="1"/></svg>';
    btn.style.cssText = `background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;color:${this.enabled ? 'var(--accent,#00d4ff)' : 'var(--text-secondary,#8b8fa3)'};opacity:${this.enabled ? '1' : '0.7'};`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
      btn.style.color = this.enabled ? 'var(--accent,#00d4ff)' : 'var(--text-secondary,#8b8fa3)';
      btn.style.opacity = this.enabled ? '1' : '0.7';
    });
    // Insert after the sleep timer button or before like btn
    const sleepBtn = document.querySelector('.sleep-timer-feature-btn');
    if (sleepBtn) {
      sleepBtn.parentNode.insertBefore(btn, sleepBtn);
    } else {
      likeBtn.parentNode.insertBefore(btn, likeBtn);
    }
    this._toggleBtn = btn;
  }

  _resize() {
    if (!this.canvas) return;
    this.canvas.width = this.canvas.offsetWidth * (window.devicePixelRatio || 1);
    this.canvas.height = this.canvas.offsetHeight * (window.devicePixelRatio || 1);
  }

  _connect() {
    if (this._connected) return;
    try {
      this.audioContext = this.audioPlayer._audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (!this.audioPlayer._visualizerSource) {
        this.source = this.audioContext.createMediaElementSource(this.audioPlayer);
        this.source.connect(this.audioContext.destination);
        this.audioPlayer._visualizerSource = this.source;
      } else {
        this.source = this.audioPlayer._visualizerSource;
      }
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      this.source.connect(this.analyser);
      this._connected = true;
    } catch (e) {
      console.warn('[VisualizerOverlay] Failed to connect:', e);
    }
  }

  start() {
    if (this.isRunning || !this.enabled) return;
    this._connect();
    if (!this.analyser) return;
    this.isRunning = true;
    if (this.container) this.container.style.opacity = '0.6';
    this._draw();
  }

  stop() {
    this.isRunning = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = null;
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('visualizer-overlay-enabled', this.enabled);
    if (this.enabled && !this.audioPlayer.paused) {
      this.start();
    } else {
      this.stop();
      if (this.container) this.container.style.opacity = '0';
    }
  }

  _draw() {
    if (!this.isRunning) return;
    this.animId = requestAnimationFrame(() => this._draw());
    if (!this.analyser || !this.ctx) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    if (this.style === 'bars') {
      this._drawBars(dataArray, bufferLength, w, h);
    } else if (this.style === 'wave') {
      this._drawWave(dataArray, bufferLength, w, h);
    } else {
      this._drawMirror(dataArray, bufferLength, w, h);
    }
  }

  _drawBars(data, len, w, h) {
    const barW = w / this.barCount;
    const step = Math.floor(len / this.barCount);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00d4ff';
    for (let i = 0; i < this.barCount; i++) {
      const val = data[i * step] / 255;
      const barH = val * h * 0.9;
      const x = i * barW;
      const gradient = this.ctx.createLinearGradient(0, h, 0, h - barH);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, accent + '33');
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(x + 1, h - barH, barW - 2, barH);
    }
  }

  _drawWave(data, len, w, h) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00d4ff';
    this.ctx.beginPath();
    this.ctx.moveTo(0, h);
    const step = w / len;
    for (let i = 0; i < len; i++) {
      const val = data[i] / 255;
      const y = h - val * h * 0.9;
      this.ctx.lineTo(i * step, y);
    }
    this.ctx.lineTo(w, h);
    this.ctx.closePath();
    const gradient = this.ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, accent + '66');
    gradient.addColorStop(1, accent + '11');
    this.ctx.fillStyle = gradient;
    this.ctx.fill();
    this.ctx.strokeStyle = accent;
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
  }

  _drawMirror(data, len, w, h) {
    const barW = w / this.barCount;
    const step = Math.floor(len / this.barCount);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00d4ff';
    const mid = h / 2;
    for (let i = 0; i < this.barCount; i++) {
      const val = data[i * step] / 255;
      const barH = val * mid * 0.85;
      const x = i * barW;
      this.ctx.fillStyle = accent + '88';
      this.ctx.fillRect(x + 1, mid - barH, barW - 2, barH);
      this.ctx.fillStyle = accent + '44';
      this.ctx.fillRect(x + 1, mid, barW - 2, barH);
    }
  }

  setStyle(style) {
    this.style = style;
    localStorage.setItem('visualizer-overlay-style', style);
  }
}
