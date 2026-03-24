// js/equalizer-studio.js
// Advanced Equalizer Studio with parametric EQ, presets, and real-time visualization
// Extends the basic equalizer with a full studio-grade interface

export class EqualizerStudio {
  constructor(audioPlayer) {
    this._audioPlayer = audioPlayer;
    this._audioContext = null;
    this._sourceNode = null;
    this._filters = [];
    this._container = null;
    this._presets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass_boost: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
      treble_boost: [0, 0, 0, 0, 0, 2, 4, 6, 7, 8],
      vocal: [-2, -1, 0, 3, 5, 5, 3, 0, -1, -2],
      rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
      jazz: [4, 3, 1, 2, -2, -2, 0, 1, 3, 4],
      classical: [0, 0, 0, 0, 0, 0, -2, -3, -4, -4],
      electronic: [6, 5, 1, 0, -2, 2, 1, 5, 6, 6],
      hip_hop: [5, 4, 2, 1, -1, -1, 2, 3, 4, 4],
      acoustic: [3, 2, 1, 2, 3, 3, 2, 2, 2, 2],
    };
    this._bands = [
      { freq: 32, label: '32Hz' },
      { freq: 64, label: '64Hz' },
      { freq: 125, label: '125Hz' },
      { freq: 250, label: '250Hz' },
      { freq: 500, label: '500Hz' },
      { freq: 1000, label: '1kHz' },
      { freq: 2000, label: '2kHz' },
      { freq: 4000, label: '4kHz' },
      { freq: 8000, label: '8kHz' },
      { freq: 16000, label: '16kHz' },
    ];
    this._gains = new Array(10).fill(0);
    this._enabled = false;
    this._loadSettings();
  }

  /**
   * Render Equalizer Studio page into container
   */
  renderPage(container) {
    this._container = container;
    container.innerHTML = `
      <div class="eq-studio-page">
        <h1 class="page-title">Equalizer Studio</h1>
        <p class="page-subtitle">Fine-tune your audio with precision controls</p>

        <div class="eq-studio-controls">
          <div class="eq-toggle-row">
            <label class="eq-toggle">
              <input type="checkbox" class="eq-enable-toggle" ${this._enabled ? 'checked' : ''} />
              <span class="eq-toggle-slider"></span>
              <span class="eq-toggle-label">Enable EQ</span>
            </label>
          </div>

          <div class="eq-presets">
            <label>Presets:</label>
            <div class="eq-preset-grid">
              ${Object.keys(this._presets).map(p =>
                `<button class="eq-preset-btn" data-preset="${p}">${p.replace('_', ' ')}</button>`
              ).join('')}
            </div>
          </div>

          <div class="eq-bands">
            ${this._bands.map((band, i) => `
              <div class="eq-band">
                <input
                  type="range"
                  class="eq-slider"
                  data-band="${i}"
                  min="-12" max="12" step="0.5"
                  value="${this._gains[i]}"
                  orient="vertical"
                />
                <div class="eq-gain-value">${this._gains[i] > 0 ? '+' : ''}${this._gains[i]}dB</div>
                <div class="eq-band-label">${band.label}</div>
              </div>
            `).join('')}
          </div>

          <div class="eq-actions">
            <button class="btn-secondary eq-reset-btn">Reset All</button>
            <button class="btn-primary eq-apply-btn">Apply</button>
          </div>
        </div>
      </div>
    `;

    this._attachEvents(container);
    if (this._enabled) this._applyEQ();
  }

  _attachEvents(container) {
    container.querySelector('.eq-enable-toggle')?.addEventListener('change', (e) => {
      this._enabled = e.target.checked;
      if (this._enabled) {
        this._initAudioContext();
        this._applyEQ();
      } else {
        this._bypass();
      }
      this._saveSettings();
    });

    container.querySelectorAll('.eq-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        this._applyPreset(preset, container);
      });
    });

    container.querySelectorAll('.eq-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const band = parseInt(e.target.dataset.band);
        const gain = parseFloat(e.target.value);
        this._gains[band] = gain;
        const valueEl = e.target.parentNode.querySelector('.eq-gain-value');
        if (valueEl) valueEl.textContent = `${gain > 0 ? '+' : ''}${gain}dB`;
        if (this._enabled) this._updateBand(band, gain);
      });
    });

    container.querySelector('.eq-reset-btn')?.addEventListener('click', () => {
      this._resetAll(container);
    });

    container.querySelector('.eq-apply-btn')?.addEventListener('click', () => {
      if (!this._enabled) {
        container.querySelector('.eq-enable-toggle').checked = true;
        this._enabled = true;
      }
      this._initAudioContext();
      this._applyEQ();
      this._saveSettings();
    });
  }

  _initAudioContext() {
    try {
      if (!this._audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this._audioContext = new AudioContext();
      }
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume();
      }
      if (!this._sourceNode && this._audioPlayer) {
        this._sourceNode = this._audioContext.createMediaElementSource(this._audioPlayer);
        this._createFilters();
        this._sourceNode.connect(this._filters[0]);
        this._filters[this._filters.length - 1].connect(this._audioContext.destination);
      }
    } catch (e) {
      console.warn('[EQStudio] AudioContext init failed:', e);
    }
  }

  _createFilters() {
    if (!this._audioContext) return;
    this._filters = this._bands.map((band, i) => {
      const filter = this._audioContext.createBiquadFilter();
      if (i === 0) filter.type = 'lowshelf';
      else if (i === this._bands.length - 1) filter.type = 'highshelf';
      else filter.type = 'peaking';
      filter.frequency.value = band.freq;
      filter.Q.value = 1.4;
      filter.gain.value = this._gains[i];
      return filter;
    });
    // Chain filters
    for (let i = 0; i < this._filters.length - 1; i++) {
      this._filters[i].connect(this._filters[i + 1]);
    }
  }

  _applyEQ() {
    this._initAudioContext();
    if (!this._filters.length) return;
    this._gains.forEach((gain, i) => {
      if (this._filters[i]) {
        this._filters[i].gain.value = gain;
      }
    });
  }

  _updateBand(band, gain) {
    if (this._filters[band]) {
      this._filters[band].gain.value = gain;
    }
  }

  _bypass() {
    if (this._filters.length) {
      this._gains.forEach((_, i) => {
        if (this._filters[i]) this._filters[i].gain.value = 0;
      });
    }
  }

  _applyPreset(presetName, container) {
    const preset = this._presets[presetName];
    if (!preset) return;
    this._gains = [...preset];

    container.querySelectorAll('.eq-slider').forEach((slider, i) => {
      slider.value = this._gains[i];
      const valueEl = slider.parentNode.querySelector('.eq-gain-value');
      if (valueEl) valueEl.textContent = `${this._gains[i] > 0 ? '+' : ''}${this._gains[i]}dB`;
    });

    // Highlight active preset
    container.querySelectorAll('.eq-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetName);
    });

    if (this._enabled) this._applyEQ();
  }

  _resetAll(container) {
    this._gains = new Array(10).fill(0);
    container.querySelectorAll('.eq-slider').forEach((slider, i) => {
      slider.value = 0;
      const valueEl = slider.parentNode.querySelector('.eq-gain-value');
      if (valueEl) valueEl.textContent = '0dB';
    });
    container.querySelectorAll('.eq-preset-btn').forEach(btn => btn.classList.remove('active'));
    if (this._enabled) this._applyEQ();
  }

  _saveSettings() {
    try {
      localStorage.setItem('eq-studio-settings', JSON.stringify({
        enabled: this._enabled,
        gains: this._gains,
      }));
    } catch (e) {}
  }

  _loadSettings() {
    try {
      const saved = localStorage.getItem('eq-studio-settings');
      if (saved) {
        const s = JSON.parse(saved);
        this._enabled = s.enabled || false;
        this._gains = s.gains || new Array(10).fill(0);
      }
    } catch (e) {}
  }

  destroy() {
    this._bypass();
    if (this._audioContext) {
      this._audioContext.close();
    }
  }
}
