// js/ambient-soundscape.js
// Ambient Sound Mixer - Layer ambient sounds over music

export class AmbientSoundscape {
  constructor(audioContext) {
    this.audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    this.sounds = {};
    this.gainNodes = {};
    this.enabled = false;
    
    // Preset ambient sounds (can be URLs to audio files or generated)
    this.presets = {
      rain: { name: 'Rain', url: null, type: 'noise' },
      cafe: { name: 'Café', url: null, type: 'noise' },
      waves: { name: 'Ocean Waves', url: null, type: 'noise' },
      fireplace: { name: 'Fireplace', url: null, type: 'noise' },
      forest: { name: 'Forest', url: null, type: 'noise' },
      wind: { name: 'Wind', url: null, type: 'noise' },
      thunder: { name: 'Thunder', url: null, type: 'noise' },
      city: { name: 'City Traffic', url: null, type: 'noise' }
    };

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.audioContext.destination);

    this.init();
  }

  init() {
    this.createUI();
    this.loadSettings();
  }

  createUI() {
    const existing = document.getElementById('ambient-soundscape-panel');
    if (existing) return;

    const panel = document.createElement('div');
    panel.id = 'ambient-soundscape-panel';
    panel.className = 'ambient-panel';
    panel.innerHTML = `
      <div class="ambient-header">
        <h3>🌊 Ambient Soundscape</h3>
        <button id="ambient-toggle" class="btn-toggle">OFF</button>
      </div>
      <div class="ambient-mixer" id="ambient-mixer"></div>
    `;

    document.body.appendChild(panel);

    // Create sliders for each preset
    const mixer = document.getElementById('ambient-mixer');
    Object.keys(this.presets).forEach(key => {
      const preset = this.presets[key];
      const item = document.createElement('div');
      item.className = 'ambient-item';
      item.innerHTML = `
        <label>${preset.name}</label>
        <input type="range" id="ambient-${key}" min="0" max="100" value="0" />
        <span class="volume-label">0%</span>
      `;
      mixer.appendChild(item);

      const slider = item.querySelector('input');
      const label = item.querySelector('.volume-label');
      slider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        label.textContent = `${e.target.value}%`;
        this.setVolume(key, volume);
      });
    });

    // Toggle button
    document.getElementById('ambient-toggle').addEventListener('click', () => {
      this.toggle();
    });

    // Add toggle button to player bar
    const playerBar = document.querySelector('.now-playing-bar .controls');
    if (playerBar) {
      const btn = document.createElement('button');
      btn.id = 'ambient-toggle-btn';
      btn.className = 'control-btn';
      btn.innerHTML = '🌊';
      btn.title = 'Ambient Soundscape';
      btn.addEventListener('click', () => {
        panel.classList.toggle('visible');
      });
      playerBar.appendChild(btn);
    }
  }

  generateNoise(type) {
    // Generate procedural ambient noise
    const bufferSize = this.audioContext.sampleRate * 5; // 5 seconds
    const buffer = this.audioContext.createBuffer(2, bufferSize, this.audioContext.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      
      if (type === 'rain') {
        // White noise with filtering for rain effect
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
      } else if (type === 'waves') {
        // Low-frequency oscillation for waves
        for (let i = 0; i < bufferSize; i++) {
          const t = i / this.audioContext.sampleRate;
          data[i] = Math.sin(2 * Math.PI * 0.1 * t) * Math.random() * 0.5;
        }
      } else if (type === 'wind') {
        // Filtered pink noise for wind
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.7;
        }
      } else {
        // Default: white noise
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
      }
    }

    return buffer;
  }

  setVolume(soundKey, volume) {
    if (!this.enabled) {
      this.enabled = true;
      this.updateToggleButton();
    }

    if (!this.sounds[soundKey] && volume > 0) {
      this.startSound(soundKey);
    }

    if (this.gainNodes[soundKey]) {
      this.gainNodes[soundKey].gain.setValueAtTime(volume, this.audioContext.currentTime);
    }

    this.saveSettings();
  }

  startSound(soundKey) {
    const buffer = this.generateNoise(soundKey);
    
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0;

    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start(0);

    this.sounds[soundKey] = source;
    this.gainNodes[soundKey] = gainNode;
  }

  stopSound(soundKey) {
    if (this.sounds[soundKey]) {
      this.sounds[soundKey].stop();
      delete this.sounds[soundKey];
      delete this.gainNodes[soundKey];
    }
  }

  stopAll() {
    Object.keys(this.sounds).forEach(key => this.stopSound(key));
  }

  toggle() {
    this.enabled = !this.enabled;
    this.masterGain.gain.setValueAtTime(
      this.enabled ? 0.3 : 0,
      this.audioContext.currentTime
    );
    this.updateToggleButton();
    this.saveSettings();
  }

  updateToggleButton() {
    const btn = document.getElementById('ambient-toggle');
    if (btn) {
      btn.textContent = this.enabled ? 'ON' : 'OFF';
      btn.classList.toggle('active', this.enabled);
    }
  }

  saveSettings() {
    const settings = {
      enabled: this.enabled,
      volumes: {}
    };

    Object.keys(this.presets).forEach(key => {
      const slider = document.getElementById(`ambient-${key}`);
      if (slider) {
        settings.volumes[key] = slider.value;
      }
    });

    localStorage.setItem('ambient-soundscape-settings', JSON.stringify(settings));
  }

  loadSettings() {
    const saved = localStorage.getItem('ambient-soundscape-settings');
    if (!saved) return;

    try {
      const settings = JSON.parse(saved);
      this.enabled = settings.enabled || false;
      this.updateToggleButton();

      if (settings.volumes) {
        Object.keys(settings.volumes).forEach(key => {
          const slider = document.getElementById(`ambient-${key}`);
          if (slider) {
            slider.value = settings.volumes[key];
            slider.dispatchEvent(new Event('input'));
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load ambient soundscape settings:', e);
    }
  }
}
