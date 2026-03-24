// js/mood-playlist-ui.js
// Interactive Mood Wheel UI for AI Mood-Based Playlist Generator
// Integrates with mood-queue.js for backend mood logic

import { MoodQueue } from './mood-queue.js';
import { navigate } from './router.js';

export class MoodPlaylistUI {
  constructor(player, musicAPI) {
    this._player = player;
    this._musicAPI = musicAPI;
    this._moodQueue = new MoodQueue(player, musicAPI);
    this._currentMood = null;
    this._isGenerating = false;
  }

  /**
   * Render the Mood Playlist page into given container
   */
  renderPage(container) {
    container.innerHTML = `
      <div class="mood-playlist-page">
        <h1 class="page-title">Mood Playlist Generator</h1>
        <p class="page-subtitle">Select your mood and we'll create the perfect playlist for you</p>
        
        <div class="mood-wheel-container">
          <div class="mood-wheel">
            ${this._renderMoodOptions()}
          </div>
        </div>

        <div class="mood-energy-slider" style="display:none">
          <label>Energy Level</label>
          <input type="range" id="mood-energy" min="0" max="100" value="50" />
          <div class="slider-labels"><span>Low</span><span>High</span></div>
        </div>

        <div class="mood-actions">
          <button class="btn-primary mood-generate-btn" disabled>
            <span>Generate Playlist</span>
          </button>
          <button class="btn-secondary mood-surprise-btn">
            <span>Surprise Me!</span>
          </button>
        </div>

        <div class="mood-result" style="display:none">
          <div class="mood-result-header">
            <h2 class="mood-result-title"></h2>
            <div class="mood-result-meta"></div>
          </div>
          <div class="mood-result-tracks"></div>
          <div class="mood-result-actions">
            <button class="btn-primary mood-play-all-btn">Play All</button>
            <button class="btn-secondary mood-save-btn">Save as Playlist</button>
            <button class="btn-secondary mood-regenerate-btn">Regenerate</button>
          </div>
        </div>
      </div>
    `;
    this._attachEvents(container);
  }

  _renderMoodOptions() {
    const moods = [
      { id: 'happy', emoji: '😊', label: 'Happy', color: '#FFD700' },
      { id: 'sad', emoji: '😢', label: 'Sad', color: '#4A90D9' },
      { id: 'energetic', emoji: '⚡', label: 'Energetic', color: '#FF4500' },
      { id: 'chill', emoji: '😌', label: 'Chill', color: '#48D1CC' },
      { id: 'focus', emoji: '🎯', label: 'Focus', color: '#8A2BE2' },
      { id: 'romantic', emoji: '💕', label: 'Romantic', color: '#FF69B4' },
      { id: 'angry', emoji: '🔥', label: 'Angry', color: '#DC143C' },
      { id: 'nostalgic', emoji: '🌅', label: 'Nostalgic', color: '#DDA0DD' },
      { id: 'workout', emoji: '💪', label: 'Workout', color: '#FF8C00' },
      { id: 'sleep', emoji: '🌙', label: 'Sleep', color: '#191970' },
    ];
    return moods.map(m => `
      <button class="mood-option" data-mood="${m.id}" style="--mood-color: ${m.color}">
        <span class="mood-emoji">${m.emoji}</span>
        <span class="mood-label">${m.label}</span>
      </button>
    `).join('');
  }

  _attachEvents(container) {
    const options = container.querySelectorAll('.mood-option');
    const generateBtn = container.querySelector('.mood-generate-btn');
    const surpriseBtn = container.querySelector('.mood-surprise-btn');
    const energySlider = container.querySelector('.mood-energy-slider');

    options.forEach(opt => {
      opt.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        this._currentMood = opt.dataset.mood;
        generateBtn.disabled = false;
        energySlider.style.display = 'block';
      });
    });

    generateBtn?.addEventListener('click', () => this._generate(container));
    surpriseBtn?.addEventListener('click', () => this._surprise(container));

    container.querySelector('.mood-play-all-btn')?.addEventListener('click', () => {
      if (this._generatedTracks?.length) {
        this._player.setQueue(this._generatedTracks, 0);
        this._player.playTrackFromQueue();
      }
    });

    container.querySelector('.mood-save-btn')?.addEventListener('click', async () => {
      if (this._generatedTracks?.length && this._currentMood) {
        const { db } = await import('./db.js');
        const name = `${this._currentMood.charAt(0).toUpperCase() + this._currentMood.slice(1)} Vibes`;
        await db.createPlaylist(name, this._generatedTracks);
        const { showNotification } = await import('./downloads.js');
        showNotification(`Playlist "${name}" saved!`);
      }
    });

    container.querySelector('.mood-regenerate-btn')?.addEventListener('click', () => this._generate(container));
  }

  async _generate(container) {
    if (this._isGenerating || !this._currentMood) return;
    this._isGenerating = true;
    const generateBtn = container.querySelector('.mood-generate-btn');
    generateBtn.innerHTML = '<span class="spinner"></span> Generating...';
    generateBtn.disabled = true;

    try {
      const tracks = await this._moodQueue.generateQueue(this._currentMood, 30);
      this._generatedTracks = tracks;
      this._showResults(container, tracks);
    } catch (e) {
      console.error('[MoodPlaylistUI] Generation failed:', e);
      const { showNotification } = await import('./downloads.js');
      showNotification('Failed to generate mood playlist. Try again.');
    } finally {
      this._isGenerating = false;
      generateBtn.innerHTML = '<span>Generate Playlist</span>';
      generateBtn.disabled = false;
    }
  }

  async _surprise(container) {
    const moods = ['happy', 'sad', 'energetic', 'chill', 'focus', 'romantic', 'nostalgic', 'workout'];
    const randomMood = moods[Math.floor(Math.random() * moods.length)];
    this._currentMood = randomMood;

    const options = container.querySelectorAll('.mood-option');
    options.forEach(o => {
      o.classList.toggle('selected', o.dataset.mood === randomMood);
    });

    container.querySelector('.mood-energy-slider').style.display = 'block';
    container.querySelector('.mood-generate-btn').disabled = false;
    await this._generate(container);
  }

  _showResults(container, tracks) {
    const result = container.querySelector('.mood-result');
    result.style.display = 'block';
    result.querySelector('.mood-result-title').textContent = 
      `${this._currentMood.charAt(0).toUpperCase() + this._currentMood.slice(1)} Playlist`;
    result.querySelector('.mood-result-meta').textContent = `${tracks.length} tracks generated`;

    const tracksContainer = result.querySelector('.mood-result-tracks');
    tracksContainer.innerHTML = tracks.slice(0, 20).map((t, i) => `
      <div class="mood-track-item" data-index="${i}">
        <img src="${t.album?.cover || t.cover || ''}" alt="" class="mood-track-cover" loading="lazy" />
        <div class="mood-track-info">
          <span class="mood-track-title">${t.title || 'Unknown'}</span>
          <span class="mood-track-artist">${t.artist?.name || t.artists?.[0]?.name || 'Unknown'}</span>
        </div>
        <span class="mood-track-duration">${this._formatDuration(t.duration)}</span>
      </div>
    `).join('');

    tracksContainer.querySelectorAll('.mood-track-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        this._player.setQueue(tracks, idx);
        this._player.playTrackFromQueue();
      });
    });
  }

  _formatDuration(sec) {
    if (!sec) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
