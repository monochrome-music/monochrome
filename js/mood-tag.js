// js/mood-tag.js
// Mood tagging system for tracks
// Users can tag tracks with moods and filter/browse by mood

export class MoodTag {
  constructor(player) {
    this.player = player;
    this.moods = [
      { id: 'happy', emoji: '😊', label: 'Happy', color: '#FFD700' },
      { id: 'sad', emoji: '😢', label: 'Sad', color: '#4A90D9' },
      { id: 'energetic', emoji: '⚡', label: 'Energetic', color: '#FF6B35' },
      { id: 'chill', emoji: '🌊', label: 'Chill', color: '#00BCD4' },
      { id: 'romantic', emoji: '💕', label: 'Romantic', color: '#E91E63' },
      { id: 'dark', emoji: '🌑', label: 'Dark', color: '#424242' },
      { id: 'focus', emoji: '🎯', label: 'Focus', color: '#8BC34A' },
      { id: 'party', emoji: '🎉', label: 'Party', color: '#FF9800' },
      { id: 'nostalgic', emoji: '📼', label: 'Nostalgic', color: '#9C27B0' },
      { id: 'angry', emoji: '🔥', label: 'Angry', color: '#F44336' },
    ];
    this.trackMoods = {}; // { trackId: ['happy', 'chill'] }
    this.ui = {};

    this._loadData();
    this._createUI();
  }

  _loadData() {
    try {
      const stored = localStorage.getItem('monochrome_mood_tags');
      if (stored) this.trackMoods = JSON.parse(stored);
    } catch {}
  }

  _saveData() {
    try {
      localStorage.setItem('monochrome_mood_tags', JSON.stringify(this.trackMoods));
    } catch {}
  }

  _createUI() {
    // Mood tag button in now-playing bar
    const btn = document.createElement('button');
    btn.className = 'mood-tag-btn';
    btn.title = 'Tag Mood';
    btn.innerHTML = '🎭';
    Object.assign(btn.style, {
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: '18px', padding: '8px', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    btn.addEventListener('click', () => this._togglePicker());

    const controls = document.querySelector('.now-playing-bar .extra-controls')
      || document.querySelector('.now-playing-bar .controls');
    if (controls) controls.appendChild(btn);
    this.ui.btn = btn;

    // Mood picker dropdown
    const picker = document.createElement('div');
    picker.className = 'mood-picker';
    picker.style.cssText = `
      position: fixed; z-index: 99998; display: none;
      background: #1a1a1a; border: 1px solid #333; border-radius: 12px;
      padding: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      width: 280px;
    `;

    const title = document.createElement('div');
    title.textContent = 'Tag this track\'s mood';
    title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;color:#fff;opacity:0.8';
    picker.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';

    this.moods.forEach(mood => {
      const chip = document.createElement('button');
      chip.className = `mood-chip mood-chip-${mood.id}`;
      chip.dataset.moodId = mood.id;
      chip.innerHTML = `${mood.emoji} ${mood.label}`;
      Object.assign(chip.style, {
        background: '#2a2a2a', border: '1px solid #444',
        borderRadius: '16px', padding: '4px 12px', fontSize: '12px',
        cursor: 'pointer', color: '#ccc', transition: 'all 0.2s',
      });
      chip.addEventListener('click', () => this._toggleMood(mood.id, chip));
      grid.appendChild(chip);
    });

    picker.appendChild(grid);

    // Current moods display
    const currentDisplay = document.createElement('div');
    currentDisplay.className = 'mood-current';
    currentDisplay.style.cssText = 'margin-top:10px;font-size:11px;color:#888';
    picker.appendChild(currentDisplay);
    this.ui.currentDisplay = currentDisplay;

    document.body.appendChild(picker);
    this.ui.picker = picker;
    this.ui.chips = grid.querySelectorAll('.mood-chip');

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.style.display = 'none';
      }
    });

    // Style for mood tags in track list
    const style = document.createElement('style');
    style.textContent = `
      .mood-chip.active {
        background: var(--mood-color) !important;
        border-color: var(--mood-color) !important;
        color: #fff !important;
      }
      .track-mood-badges { display: flex; gap: 4px; margin-top: 2px; }
      .track-mood-badge {
        font-size: 10px; padding: 1px 6px; border-radius: 8px;
        background: #2a2a2a; color: #aaa;
      }
    `;
    document.head.appendChild(style);
  }

  _togglePicker() {
    const picker = this.ui.picker;
    if (picker.style.display === 'block') {
      picker.style.display = 'none';
      return;
    }

    // Position near button
    const btnRect = this.ui.btn.getBoundingClientRect();
    picker.style.left = Math.max(10, btnRect.left - 120) + 'px';
    picker.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
    picker.style.display = 'block';

    this._updateChipStates();
  }

  _updateChipStates() {
    const trackId = this._getCurrentTrackId();
    const currentMoods = this.trackMoods[trackId] || [];

    this.ui.chips.forEach(chip => {
      const moodId = chip.dataset.moodId;
      const mood = this.moods.find(m => m.id === moodId);
      const isActive = currentMoods.includes(moodId);
      chip.classList.toggle('active', isActive);
      chip.style.setProperty('--mood-color', mood.color);
      if (isActive) {
        chip.style.background = mood.color;
        chip.style.borderColor = mood.color;
        chip.style.color = '#fff';
      } else {
        chip.style.background = '#2a2a2a';
        chip.style.borderColor = '#444';
        chip.style.color = '#ccc';
      }
    });

    const labels = currentMoods.map(id => {
      const m = this.moods.find(x => x.id === id);
      return m ? `${m.emoji} ${m.label}` : id;
    });
    this.ui.currentDisplay.textContent = labels.length
      ? `Current: ${labels.join(', ')}`
      : 'No moods tagged yet';
  }

  _toggleMood(moodId, chip) {
    const trackId = this._getCurrentTrackId();
    if (!trackId) return;

    if (!this.trackMoods[trackId]) this.trackMoods[trackId] = [];
    const idx = this.trackMoods[trackId].indexOf(moodId);
    if (idx >= 0) {
      this.trackMoods[trackId].splice(idx, 1);
    } else {
      this.trackMoods[trackId].push(moodId);
    }

    this._saveData();
    this._updateChipStates();
  }

  _getCurrentTrackId() {
    const track = this.player.currentTrack;
    return track ? (track.id || track.src || null) : null;
  }

  getMoodsForTrack(trackId) {
    return this.trackMoods[trackId] || [];
  }

  getTracksByMood(moodId) {
    return Object.entries(this.trackMoods)
      .filter(([, moods]) => moods.includes(moodId))
      .map(([trackId]) => trackId);
  }

  getAllMoodStats() {
    const stats = {};
    this.moods.forEach(m => { stats[m.id] = 0; });
    Object.values(this.trackMoods).forEach(moods => {
      moods.forEach(m => { if (stats[m] !== undefined) stats[m]++; });
    });
    return stats;
  }
}
