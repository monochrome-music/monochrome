// js/audio-normalization.js
// Loudness normalization across tracks using Web Audio API
// Analyzes perceived loudness (LUFS-inspired) and adjusts gain

export class AudioNormalization {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.enabled = localStorage.getItem('monochrome_normalization') === 'true';
    this.targetLoudness = -14; // Target LUFS (Spotify-like)
    this.trackGains = new Map();
    this.gainNode = null;
    this.analyserNode = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.isConnected = false;
    this.currentGain = 1.0;
    this.ui = null;

    this._init();
  }

  _init() {
    this._createUI();
    if (this.enabled) {
      this._connectAudioGraph();
    }
    this._loadStoredGains();

    this.audioPlayer.addEventListener('play', () => {
      if (this.enabled && !this.isConnected) {
        this._connectAudioGraph();
      }
    });

    this.audioPlayer.addEventListener('loadedmetadata', () => {
      if (this.enabled) {
        this._analyzeAndNormalize();
      }
    });
  }

  _connectAudioGraph() {
    try {
      if (this.isConnected) return;
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.sourceNode = this.audioContext.createMediaElementSource(this.audioPlayer);
      this.gainNode = this.audioContext.createGain();
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;

      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.isConnected = true;
    } catch (e) {
      console.warn('[AudioNormalization] Failed to connect audio graph:', e);
    }
  }

  async _analyzeAndNormalize() {
    const trackId = this._getCurrentTrackId();
    if (!trackId) return;

    // Check cached gain
    if (this.trackGains.has(trackId)) {
      this._applyGain(this.trackGains.get(trackId));
      return;
    }

    // Measure loudness over first 5 seconds
    const loudness = await this._measureLoudness();
    const gainDB = this.targetLoudness - loudness;
    const gainLinear = Math.pow(10, gainDB / 20);
    const clampedGain = Math.max(0.1, Math.min(3.0, gainLinear));

    this.trackGains.set(trackId, clampedGain);
    this._applyGain(clampedGain);
    this._saveStoredGains();
  }

  _measureLoudness() {
    return new Promise((resolve) => {
      if (!this.analyserNode) {
        resolve(-14);
        return;
      }

      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      let sumSquares = 0;
      let samples = 0;
      const measureInterval = setInterval(() => {
        this.analyserNode.getFloatTimeDomainData(dataArray);
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
          samples++;
        }
      }, 100);

      setTimeout(() => {
        clearInterval(measureInterval);
        if (samples === 0) {
          resolve(-14);
          return;
        }
        const rms = Math.sqrt(sumSquares / samples);
        const loudnessDB = 20 * Math.log10(Math.max(rms, 1e-10));
        resolve(loudnessDB);
      }, 3000);
    });
  }

  _applyGain(gain) {
    if (!this.gainNode) return;
    this.currentGain = gain;
    this.gainNode.gain.setTargetAtTime(gain, this.audioContext.currentTime, 0.1);
    this._updateUI();
  }

  _getCurrentTrackId() {
    try {
      return this.audioPlayer.src || this.audioPlayer.currentSrc || null;
    } catch {
      return null;
    }
  }

  _loadStoredGains() {
    try {
      const stored = localStorage.getItem('monochrome_track_gains');
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.entries(parsed).forEach(([k, v]) => this.trackGains.set(k, v));
      }
    } catch {}
  }

  _saveStoredGains() {
    try {
      const obj = Object.fromEntries(this.trackGains);
      // Keep only last 200 tracks
      const keys = Object.keys(obj);
      if (keys.length > 200) {
        keys.slice(0, keys.length - 200).forEach(k => delete obj[k]);
      }
      localStorage.setItem('monochrome_track_gains', JSON.stringify(obj));
    } catch {}
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('monochrome_normalization', this.enabled);
    if (this.enabled) {
      this._connectAudioGraph();
      this._analyzeAndNormalize();
    } else {
      this._applyGain(1.0);
    }
    this._updateUI();
  }

  setTargetLoudness(lufs) {
    this.targetLoudness = Math.max(-30, Math.min(-5, lufs));
    if (this.enabled) {
      this.trackGains.clear();
      this._analyzeAndNormalize();
    }
  }

  _createUI() {
    const btn = document.createElement('button');
    btn.className = 'normalization-toggle';
    btn.title = 'Volume Normalization';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 12h4l3-9 6 18 3-9h4"/>
      </svg>
    `;
    btn.addEventListener('click', () => this.toggle());

    Object.assign(btn.style, {
      background: 'none',
      border: 'none',
      color: this.enabled ? '#1db954' : '#b3b3b3',
      cursor: 'pointer',
      padding: '8px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'color 0.2s',
    });

    this.ui = btn;

    const controls = document.querySelector('.now-playing-bar .extra-controls')
      || document.querySelector('.now-playing-bar .controls');
    if (controls) {
      controls.appendChild(btn);
    }
  }

  _updateUI() {
    if (!this.ui) return;
    this.ui.style.color = this.enabled ? '#1db954' : '#b3b3b3';
    this.ui.title = this.enabled
      ? `Normalization ON (gain: ${this.currentGain.toFixed(2)}x)`
      : 'Volume Normalization (OFF)';
  }
}
