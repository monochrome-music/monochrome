// js/3d-visualizer.js
// 3D Audio Visualizer using Web Audio API + Canvas
// Renders reactive 3D-style visualization synced to audio

export class Visualizer3D {
  constructor(audioPlayer, options = {}) {
    this._audioPlayer = audioPlayer;
    this._options = {
      barCount: options.barCount || 64,
      colorScheme: options.colorScheme || 'spectrum',
      style: options.style || 'bars3d',
      sensitivity: options.sensitivity || 1.5,
      ...options,
    };
    this._canvas = null;
    this._ctx = null;
    this._analyser = null;
    this._dataArray = null;
    this._animationId = null;
    this._isRunning = false;
    this._rotation = 0;
    this._colorSchemes = {
      spectrum: (i, total) => `hsl(${(i / total) * 360}, 80%, 60%)`,
      fire: (i, total) => `hsl(${(i / total) * 60}, 100%, ${40 + (i / total) * 30}%)`,
      ocean: (i, total) => `hsl(${180 + (i / total) * 60}, 80%, ${40 + (i / total) * 20}%)`,
      purple: (i, total) => `hsl(${270 + (i / total) * 60}, 80%, ${40 + (i / total) * 20}%)`,
      monochrome: (i, total) => `hsl(0, 0%, ${30 + (i / total) * 60}%)`,
    };
  }

  createCanvas(container, width = 800, height = 300) {
    this._canvas = document.createElement('canvas');
    this._canvas.width = width;
    this._canvas.height = height;
    this._canvas.className = 'visualizer-3d-canvas';
    this._canvas.style.cssText = `
      width: 100%;
      height: ${height}px;
      border-radius: 12px;
      background: #0a0a0f;
      display: block;
    `;
    container.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
    return this._canvas;
  }

  connect(audioPlayer) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!this._audioContext) {
        this._audioContext = new AudioContext();
      }
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume();
      }
      this._analyser = this._audioContext.createAnalyser();
      this._analyser.fftSize = this._options.barCount * 4;
      this._analyser.smoothingTimeConstant = 0.8;
      this._dataArray = new Uint8Array(this._analyser.frequencyBinCount);
      if (!this._sourceNode) {
        this._sourceNode = this._audioContext.createMediaElementSource(audioPlayer);
        this._sourceNode.connect(this._analyser);
        this._analyser.connect(this._audioContext.destination);
      }
    } catch (e) {
      console.warn('[3D Visualizer] Audio connect failed:', e);
    }
  }

  start() {
    if (this._isRunning || !this._canvas) return;
    this._isRunning = true;
    this._render();
  }

  stop() {
    this._isRunning = false;
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
    this._clearCanvas();
  }

  setColorScheme(scheme) {
    if (this._colorSchemes[scheme]) {
      this._options.colorScheme = scheme;
    }
  }

  setStyle(style) {
    this._options.style = style;
  }

  _render() {
    if (!this._isRunning) return;
    this._animationId = requestAnimationFrame(() => this._render());

    const canvas = this._canvas;
    const ctx = this._ctx;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 10, 15, 0.85)';
    ctx.fillRect(0, 0, W, H);

    if (!this._analyser || !this._dataArray) {
      this._renderIdle(ctx, W, H);
      return;
    }

    this._analyser.getByteFrequencyData(this._dataArray);
    this._rotation += 0.005;

    switch (this._options.style) {
      case 'bars3d':
        this._renderBars3D(ctx, W, H);
        break;
      case 'circular':
        this._renderCircular(ctx, W, H);
        break;
      case 'wave':
        this._renderWave(ctx, W, H);
        break;
      default:
        this._renderBars3D(ctx, W, H);
    }
  }

  _renderBars3D(ctx, W, H) {
    const count = this._options.barCount;
    const barW = (W / count) * 0.8;
    const gap = (W / count) * 0.2;
    const colorFn = this._colorSchemes[this._options.colorScheme];
    const sensitivity = this._options.sensitivity;
    const perspective = 0.3;
    const depthOffset = 20;

    for (let i = 0; i < count; i++) {
      const dataIndex = Math.floor((i / count) * this._dataArray.length);
      const value = (this._dataArray[dataIndex] / 255) * sensitivity;
      const barH = value * (H * 0.8);
      const x = i * (barW + gap);
      const y = H - barH;
      const color = colorFn(i, count);

      // Shadow bar (3D depth effect)
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(x + barW, y);
      ctx.lineTo(x + barW + depthOffset * perspective, y - depthOffset * perspective);
      ctx.lineTo(x + barW + depthOffset * perspective, H - depthOffset * perspective);
      ctx.lineTo(x + barW, H);
      ctx.closePath();
      ctx.fill();

      // Top face (3D)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + barW, y);
      ctx.lineTo(x + barW + depthOffset * perspective, y - depthOffset * perspective);
      ctx.lineTo(x + depthOffset * perspective, y - depthOffset * perspective);
      ctx.closePath();
      ctx.fill();

      // Front face
      const gradient = ctx.createLinearGradient(x, y, x, H);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barW, barH);

      // Glow effect
      if (value > 0.6) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.fillRect(x, y, barW, 3);
        ctx.shadowBlur = 0;
      }
    }
  }

  _renderCircular(ctx, W, H) {
    const cx = W / 2;
    const cy = H / 2;
    const radius = Math.min(W, H) * 0.3;
    const count = this._options.barCount;
    const colorFn = this._colorSchemes[this._options.colorScheme];
    const sensitivity = this._options.sensitivity;

    // Draw base circle
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < count; i++) {
      const dataIndex = Math.floor((i / count) * this._dataArray.length);
      const value = (this._dataArray[dataIndex] / 255) * sensitivity;
      const angle = (i / count) * Math.PI * 2 + this._rotation;
      const barH = value * radius * 0.8;
      const color = colorFn(i, count);

      const x1 = cx + Math.cos(angle) * radius;
      const y1 = cy + Math.sin(angle) * radius;
      const x2 = cx + Math.cos(angle) * (radius + barH);
      const y2 = cy + Math.sin(angle) * (radius + barH);

      ctx.strokeStyle = color;
      ctx.lineWidth = (W / count) * 0.6;
      ctx.lineCap = 'round';

      if (value > 0.5) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Inner rotating ring
    ctx.strokeStyle = `hsla(${(this._rotation * 50) % 360}, 80%, 60%, 0.5)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  _renderWave(ctx, W, H) {
    const mid = H / 2;
    const colorFn = this._colorSchemes[this._options.colorScheme];
    const sensitivity = this._options.sensitivity;
    const len = this._dataArray.length;

    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = (i / len) * W;
      const value = ((this._dataArray[i] / 255) - 0.5) * sensitivity * H * 0.8;
      const color = colorFn(i, len);

      if (i === 0) {
        ctx.moveTo(x, mid + value);
      } else {
        ctx.lineTo(x, mid + value);
      }
    }
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 10; i++) {
      gradient.addColorStop(i / 10, colorFn(i, 10));
    }
    ctx.strokeStyle = gradient;
    ctx.shadowColor = colorFn(5, 10);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Mirror wave
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = (i / len) * W;
      const value = ((this._dataArray[i] / 255) - 0.5) * sensitivity * H * 0.4;
      if (i === 0) ctx.moveTo(x, mid - value);
      else ctx.lineTo(x, mid - value);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _renderIdle(ctx, W, H) {
    // Draw idle waveform
    const mid = H / 2;
    const time = Date.now() / 1000;
    ctx.strokeStyle = 'rgba(100, 100, 200, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const y = mid + Math.sin((x / W) * Math.PI * 4 + time) * 10;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Play music to activate visualizer', W / 2, H / 2 + 40);
  }

  _clearCanvas() {
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  destroy() {
    this.stop();
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
  }
}
