// js/mood-queue.js
// AI Mood-Based Queue Generator - generates queues based on user mood/context

export class MoodQueue {
  constructor(player, musicAPI) {
    this._player = player;
    this._musicAPI = musicAPI;
    this._moods = {
      happy: { energy: 'high', valence: 'positive', tempo: 'fast', genres: ['pop', 'dance', 'funk'] },
      sad: { energy: 'low', valence: 'negative', tempo: 'slow', genres: ['ballad', 'indie', 'acoustic'] },
      energetic: { energy: 'very_high', valence: 'positive', tempo: 'very_fast', genres: ['edm', 'rock', 'hip-hop'] },
      chill: { energy: 'low', valence: 'neutral', tempo: 'slow', genres: ['lo-fi', 'ambient', 'jazz'] },
      focus: { energy: 'medium', valence: 'neutral', tempo: 'medium', genres: ['classical', 'ambient', 'electronic'] },
      romantic: { energy: 'low', valence: 'positive', tempo: 'slow', genres: ['r&b', 'soul', 'jazz'] },
      angry: { energy: 'very_high', valence: 'negative', tempo: 'fast', genres: ['metal', 'punk', 'hardcore'] },
      nostalgic: { energy: 'medium', valence: 'mixed', tempo: 'medium', genres: ['80s', '90s', 'classic-rock'] },
      workout: { energy: 'very_high', valence: 'positive', tempo: 'very_fast', genres: ['edm', 'hip-hop', 'rock'] },
      sleep: { energy: 'very_low', valence: 'neutral', tempo: 'very_slow', genres: ['ambient', 'classical', 'nature'] },
    };
    this._moodEmojis = {
      happy: '\u{1F60A}', sad: '\u{1F622}', energetic: '\u{26A1}', chill: '\u{1F30A}',
      focus: '\u{1F3AF}', romantic: '\u{2764}', angry: '\u{1F525}', nostalgic: '\u{1F4FC}',
      workout: '\u{1F4AA}', sleep: '\u{1F31C}',
    };
    this._timeBasedMoods = {
      morning: ['happy', 'energetic', 'focus'],
      afternoon: ['chill', 'happy', 'focus'],
      evening: ['chill', 'romantic', 'nostalgic'],
      night: ['sleep', 'chill', 'sad'],
    };
    this._currentMood = null;
    this._moodHistory = JSON.parse(localStorage.getItem('mood-queue-history') || '[]');
    this._createUI();
  }

  _getTimeOfDay() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
  }

  _getSuggestedMoods() {
    const timeOfDay = this._getTimeOfDay();
    return this._timeBasedMoods[timeOfDay] || ['chill', 'happy'];
  }

  async generateQueue(mood, count = 30) {
    this._currentMood = mood;
    const moodConfig = this._moods[mood];
    if (!moodConfig) return [];

    this._moodHistory.unshift({ mood, timestamp: Date.now() });
    this._moodHistory = this._moodHistory.slice(0, 50);
    localStorage.setItem('mood-queue-history', JSON.stringify(this._moodHistory));

    const searchQueries = moodConfig.genres.map(g => `${g} ${mood}`);
    const allTracks = [];
    const seen = new Set();

    for (const query of searchQueries) {
      try {
        const results = await this._musicAPI.search(query);
        if (results && results.tracks) {
          for (const track of results.tracks) {
            if (!seen.has(track.id)) {
              seen.add(track.id);
              allTracks.push(track);
            }
          }
        }
      } catch (e) {
        console.warn('[MoodQueue] Search failed for:', query, e);
      }
    }

    // Shuffle and limit
    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }

    const queue = allTracks.slice(0, count);
    if (queue.length > 0 && this._player) {
      this._player.setQueue(queue, 0);
      await this._player.playTrackFromQueue();
    }
    return queue;
  }

  _createUI() {
    // Create floating mood button
    const btn = document.createElement('button');
    btn.id = 'mood-queue-btn';
    btn.className = 'mood-queue-fab';
    btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    btn.title = 'Mood Queue';
    btn.addEventListener('click', () => this._showMoodPicker());
    document.body.appendChild(btn);

    // Create mood picker modal
    const modal = document.createElement('div');
    modal.id = 'mood-queue-modal';
    modal.className = 'mood-queue-modal';
    modal.innerHTML = `
      <div class="mood-queue-content">
        <div class="mood-queue-header">
          <h2>How are you feeling?</h2>
          <p class="mood-suggestion">Suggested for ${this._getTimeOfDay()}</p>
          <button class="mood-queue-close">&times;</button>
        </div>
        <div class="mood-grid">
          ${Object.entries(this._moods).map(([key]) => `
            <button class="mood-card ${this._getSuggestedMoods().includes(key) ? 'suggested' : ''}" data-mood="${key}">
              <span class="mood-emoji">${this._moodEmojis[key]}</span>
              <span class="mood-label">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
            </button>
          `).join('')}
        </div>
        <div class="mood-custom">
          <input type="text" id="mood-custom-input" placeholder="Or describe your mood..." />
          <button id="mood-custom-btn" class="btn-primary">Generate</button>
        </div>
        <div id="mood-loading" class="mood-loading" style="display:none">
          <div class="mood-spinner"></div>
          <p>Building your perfect queue...</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.mood-queue-close').addEventListener('click', () => this._hideMoodPicker());
    modal.addEventListener('click', (e) => { if (e.target === modal) this._hideMoodPicker(); });

    modal.querySelectorAll('.mood-card').forEach(card => {
      card.addEventListener('click', async () => {
        const mood = card.dataset.mood;
        this._showLoading();
        await this.generateQueue(mood);
        this._hideMoodPicker();
        this._hideLoading();
      });
    });

    const customBtn = modal.querySelector('#mood-custom-btn');
    const customInput = modal.querySelector('#mood-custom-input');
    customBtn.addEventListener('click', async () => {
      const text = customInput.value.trim().toLowerCase();
      if (!text) return;
      const matchedMood = this._matchMoodFromText(text);
      this._showLoading();
      await this.generateQueue(matchedMood);
      this._hideMoodPicker();
      this._hideLoading();
    });
    customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') customBtn.click(); });
  }

  _matchMoodFromText(text) {
    const keywords = {
      happy: ['happy', 'joy', 'cheerful', 'senang', 'bahagia', 'gembira'],
      sad: ['sad', 'crying', 'depressed', 'sedih', 'galau', 'patah hati'],
      energetic: ['energy', 'pump', 'hype', 'semangat', 'excited'],
      chill: ['chill', 'relax', 'calm', 'santai', 'tenang'],
      focus: ['focus', 'study', 'work', 'concentrate', 'belajar', 'kerja'],
      romantic: ['love', 'romantic', 'date', 'cinta', 'romantis'],
      angry: ['angry', 'mad', 'furious', 'marah', 'kesal'],
      nostalgic: ['nostalgic', 'memories', 'old', 'rindu', 'kenangan'],
      workout: ['workout', 'gym', 'exercise', 'run', 'olahraga'],
      sleep: ['sleep', 'tired', 'night', 'tidur', 'ngantuk'],
    };
    for (const [mood, words] of Object.entries(keywords)) {
      if (words.some(w => text.includes(w))) return mood;
    }
    return 'chill'; // default
  }

  _showMoodPicker() {
    const modal = document.getElementById('mood-queue-modal');
    if (modal) modal.classList.add('active');
  }

  _hideMoodPicker() {
    const modal = document.getElementById('mood-queue-modal');
    if (modal) modal.classList.remove('active');
  }

  _showLoading() {
    const el = document.getElementById('mood-loading');
    if (el) el.style.display = 'flex';
  }

  _hideLoading() {
    const el = document.getElementById('mood-loading');
    if (el) el.style.display = 'none';
  }
}
