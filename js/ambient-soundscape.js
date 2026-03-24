// js/ambient-soundscape.js
// Ambient Sound Mixer - Layer ambient sounds over music
// Settings persisted to Appwrite (DB_users user_settings field)

import { authManager } from './accounts/auth.js';
import { syncManager } from './accounts/appwrite-sync.js';

export class AmbientSoundscape {
  constructor(audioContext) {
    this.audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    this.sounds = {};
    this.gainNodes = {};
    this.enabled = false;
    this.volumes = {};

    this.presets = {
      rain:      { name: 'Rain', icon: '🌧️' },
      cafe:      { name: 'Café', icon: '☕' },
      waves:     { name: 'Ocean Waves', icon: '🌊' },
      fireplace: { name: 'Fireplace', icon: '🔥' },
      forest:    { name: 'Forest', icon: '🌲' },
      wind:      { name: 'Wind', icon: '💨' },
      thunder:   { name: 'Thunder', icon: '⛈️' },
      city:      { name: 'City', icon: '🏙️' },
    };

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.audioContext.destination);

    this.init();
  }

  async init() {
    this.createUI();
    await this.loadSettings();
  }

  // ─── Appwrite helpers ──────────────────────────────────────────────────────

  async _readSettings() {
    try {
      const user = authManager.user;
      if (!user) return null;
      const data = await syncManager.getUserData();
      const raw = data?.profile?.user_settings || null;
      if (!raw) return null;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed?.ambientSoundscape ?? null;
    } catch { return null; }
  }

  async _writeSettings(payload) {
    try {
      const user = authManager.user;
      if (!user) return;
      const data = await syncManager.getUserData();
      const existing = data?.profile?.user_settings || {};
      const merged = typeof existing === 'string' ? JSON.parse(existing) : { ...existing };
      merged.ambientSoundscape = payload;
      await syncManager.syncSettings(merged);
    } catch (e) {
      console.warn('[AmbientSoundscape] Failed to save settings:', e);
    }
  }

  // ─── UI ────────────────────────────────────────────────────────────────────

  createUI() {
    if (document.getElementById('ambient-soundscape-panel')) return;

    // Panel
    const panel = document.createElement('div');
    panel.id = 'ambient-soundscape-panel';
    panel.className = 'ambient-panel';
    panel.innerHTML = `
      <div class="ambient-header">
        <span class="ambient-title">🎵 Ambient Soundscape</span>
        <div class="ambient-header-controls">
          <input type="range" id="ambient-master-vol" min="0" max="100" value="50" title="Master volume" />
          <button id="ambient-toggle" class="ambient-toggle-btn">OFF</button>
          <button id="ambient-close" class="ambient-close-btn">✕</button>
        </div>
      </div>
      <div class="ambient-mixer" id="ambient-mixer"></div>
    `;
    document.body.appendChild(panel);

    // Sliders per sound
    const mixer = panel.querySelector('#ambient-mixer');
    for (const [key, preset] of Object.entries(this.presets)) {
      const item = document.createElement('div');
      item.className = 'ambient-item';
      item.innerHTML = `
        <span class="ambient-icon">${preset.icon}</span>
        <span class="ambient-name">${preset.name}</span>
        <input type="range" id="ambient-vol-${key}" class="ambient-vol-slider" min="0" max="100" value="0" />
        <span class="ambient-vol-label" id="ambient-label-${key}">0%</span>
      `;
      mixer.appendChild(item);

      item.querySelector('input').addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        document.getElementById(`ambient-label-${key}`).textContent = `${v}%`;
        this.setVolume(key, v / 100);
      });
    }

    // Master volume
    panel.querySelector('#ambient-master-vol').addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10) / 100;
      this.masterGain.gain.setValueAtTime(v, this.audioContext.currentTime);
      this.saveSettings();
    });

    panel.querySelector('#ambient-toggle').addEventListener('click', () => this.toggle());
    panel.querySelector('#ambient-close').addEventListener('click', () => panel.classList.remove('visible'));

    // Player-bar button
    const bar = document.querySelector('.now-playing-bar');
    if (bar && !document.getElementById('ambient-open-btn')) {
      const btn = document.createElement('button');
      btn.id = 'ambient-open-btn';
      btn.className = 'now-playing-btn ambient-player-btn';
      btn.innerHTML = '🌊';
      btn.title = 'Ambient Soundscape';
      btn.addEventListener('click', () => panel.classList.toggle('visible'));
      bar.appendChild(btn);
    }
  }

  // ─── Audio ─────────────────────────────────────────────────────────────────

  _generateBuffer(type) {
    const rate = this.audioContext.sampleRate;
    const buf  = this.audioContext.createBuffer(2, rate * 4, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      switch (type) {
        case 'rain':
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
          break;
        case 'waves': {
          for (let i = 0; i < d.length; i++) {
            const t = i / rate;
            d[i] = Math.sin(2 * Math.PI * 0.08 * t) * (Math.random() * 0.5);
          }
          break;
        }
        case 'fireplace':
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3 * (0.5 + 0.5 * Math.sin(i / 200));
          break;
        case 'wind':
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5 * (0.5 + 0.5 * Math.sin(i / 5000));
          break;
        case 'thunder': {
          for (let i = 0; i < d.length; i++) {
            const rumble = Math.sin(2 * Math.PI * 40 * (i / rate));
            d[i] = rumble * Math.random() * 0.4 * (i < rate * 0.5 ? i / (rate * 0.5) : 1);
          }
          break;
        }
        case 'city':
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.2 + Math.sin(2 * Math.PI * 80 * (i / rate)) * 0.1;
          break;
        case 'forest':
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.15 + Math.sin(2 * Math.PI * 300 * (i / rate)) * 0.05;
          break;
        default:
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
    }
    return buf;
  }

  _startSound(key) {
    const src = this.audioContext.createBufferSource();
    src.buffer = this._generateBuffer(key);
    src.loop = true;
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.masterGain);
    src.start(0);
    this.sounds[key]     = src;
    this.gainNodes[key]  = gain;
  }

  setVolume(key, volume) {
    this.volumes[key] = volume;
    if (volume > 0 && !this.sounds[key]) this._startSound(key);
    if (this.gainNodes[key]) {
      this.gainNodes[key].gain.setValueAtTime(volume, this.audioContext.currentTime);
    }
    if (!this.enabled && volume > 0) {
      this.enabled = true;
      this._updateToggleBtn();
    }
    this.saveSettings();
  }

  toggle() {
    this.enabled = !this.enabled;
    const v = this.enabled ? (parseFloat(document.getElementById('ambient-master-vol')?.value || 50) / 100) : 0;
    this.masterGain.gain.setValueAtTime(v, this.audioContext.currentTime);
    this._updateToggleBtn();
    this.saveSettings();
  }

  _updateToggleBtn() {
    const btn = document.getElementById('ambient-toggle');
    if (!btn) return;
    btn.textContent = this.enabled ? 'ON' : 'OFF';
    btn.classList.toggle('active', this.enabled);
    const playerBtn = document.getElementById('ambient-open-btn');
    if (playerBtn) playerBtn.classList.toggle('active', this.enabled);
  }

  // ─── Persistence (Appwrite) ────────────────────────────────────────────────

  async saveSettings() {
    const volMap = {};
    for (const key of Object.keys(this.presets)) {
      volMap[key] = Math.round((this.volumes[key] ?? 0) * 100);
    }
    const masterEl = document.getElementById('ambient-master-vol');
    const payload = {
      enabled: this.enabled,
      master:  masterEl ? parseInt(masterEl.value, 10) : 50,
      volumes: volMap,
    };
    await this._writeSettings(payload);
  }

  async loadSettings() {
    const s = await this._readSettings();
    if (!s) return;

    this.enabled = s.enabled ?? false;

    const masterEl = document.getElementById('ambient-master-vol');
    if (masterEl && s.master != null) {
      masterEl.value = s.master;
      this.masterGain.gain.value = s.master / 100;
    }

    if (s.volumes) {
      for (const [key, val] of Object.entries(s.volumes)) {
        const slider = document.getElementById(`ambient-vol-${key}`);
        const label  = document.getElementById(`ambient-label-${key}`);
        if (slider) {
          slider.value = val;
          if (label) label.textContent = `${val}%`;
          this.setVolume(key, val / 100);
        }
      }
    }
    this._updateToggleBtn();
  }
}
