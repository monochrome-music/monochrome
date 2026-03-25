// js/mood-playlist-ui.js
// Interactive Mood Playlist Generator UI
// Integrates with mood-queue.js for backend mood logic
import { MoodQueue } from './mood-queue.js';
export class MoodPlaylistUI {
 constructor(player, musicAPI) {
 this._player = player;
 this._musicAPI = musicAPI;
 this._moodQueue = new MoodQueue(player, musicAPI);
 this._currentMood = null;
 this._isGenerating = false;
 this._generatedTracks = [];
 }
 renderPage(container) {
 container.innerHTML = `
 <div class="mood-playlist-page">
 <h1 class="page-title">Mood Playlist Generator</h1>
 <p class="page-subtitle">Pilih mood kamu dan kami akan membuat playlist yang sempurna</p>
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
 <div class="mood-loading" style="display:none">
 <div class="mood-loading-spinner"></div>
 <p class="mood-loading-text">Mencari lagu yang cocok...</p>
 </div>
 <div class="mood-result" style="display:none">
 <div class="mood-result-header">
 <div>
 <h2 class="mood-result-title"></h2>
 <p class="mood-result-meta"></p>
 </div>
 <div class="mood-result-actions">
 <button class="btn-primary mood-play-all-btn">▶ Play All</button>
 <button class="btn-secondary mood-save-btn">❤ Save Playlist</button>
 <button class="btn-secondary mood-regenerate-btn">↻ Regenerate</button>
 </div>
 </div>
 <div class="mood-result-tracks"></div>
 </div>
 </div>
 `;
 this._attachEvents(container);
 }
 _renderMoodOptions() {
 const moods = [
 { id: 'happy', emoji: '\u{1F60A}', label: 'Happy', color: '#FFD700' },
 { id: 'sad', emoji: '\u{1F622}', label: 'Sad', color: '#4A90D9' },
 { id: 'energetic', emoji: '\u26A1', label: 'Energetic', color: '#FF4500' },
 { id: 'chill', emoji: '\u{1F30A}', label: 'Chill', color: '#48D1CC' },
 { id: 'focus', emoji: '\u{1F3AF}', label: 'Focus', color: '#8A2BE2' },
 { id: 'romantic', emoji: '\u{1F495}', label: 'Romantic', color: '#FF69B4' },
 { id: 'angry', emoji: '\u{1F525}', label: 'Angry', color: '#DC143C' },
 { id: 'nostalgic', emoji: '\u{1F4FC}', label: 'Nostalgic', color: '#DDA0DD' },
 { id: 'workout', emoji: '\u{1F4AA}', label: 'Workout', color: '#FF8C00' },
 { id: 'sleep', emoji: '\u{1F31C}', label: 'Sleep', color: '#191970' },
 ];
 return moods.map(m => `
 <button class="mood-option" data-mood="${m.id}" style="--mood-color:${m.color}" title="${m.label}">
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
 try {
 const { db } = await import('./db.js');
 const moodLabel = this._currentMood.charAt(0).toUpperCase() + this._currentMood.slice(1);
 const name = `${moodLabel} Vibes`;
 await db.createPlaylist(name, this._generatedTracks);
 const { showNotification } = await import('./downloads.js');
 showNotification(`Playlist "${name}" berhasil disimpan!`);
 } catch(e) {
 console.error('[MoodPlaylistUI] Save failed:', e);
 }
 }
 });
 container.querySelector('.mood-regenerate-btn')?.addEventListener('click', () => this._generate(container));
 }
 async _generate(container) {
 if (this._isGenerating || !this._currentMood) return;
 this._isGenerating = true;
 const generateBtn = container.querySelector('.mood-generate-btn');
 const loadingEl = container.querySelector('.mood-loading');
 const resultEl = container.querySelector('.mood-result');
 const loadingText = container.querySelector('.mood-loading-text');
 generateBtn.disabled = true;
 generateBtn.innerHTML = '<span>Generating...</span>';
 loadingEl.style.display = 'flex';
 resultEl.style.display = 'none';
 const loadingMessages = [
 'Mencari lagu trending...',
 'Menganalisis mood kamu...',
 'Memilih hits terbaik...',
 'Hampir selesai...'
 ];
 let msgIdx = 0;
 const msgInterval = setInterval(() => {
 msgIdx = (msgIdx + 1) % loadingMessages.length;
 if (loadingText) loadingText.textContent = loadingMessages[msgIdx];
 }, 1500);
 try {
 const energySlider = container.querySelector('#mood-energy');
 const energyLevel = energySlider ? parseInt(energySlider.value) : 50;
 const tracks = await this._moodQueue.generateQueue(this._currentMood, 1000, energyLevel);
 this._generatedTracks = tracks;
 this._showResults(container, tracks);
 } catch (e) {
 console.error('[MoodPlaylistUI] Generation failed:', e);
 try {
 const { showNotification } = await import('./downloads.js');
 showNotification('Gagal generate playlist. Coba lagi.');
 } catch(_) {}
 } finally {
 clearInterval(msgInterval);
 this._isGenerating = false;
 generateBtn.innerHTML = '<span>Generate Playlist</span>';
 generateBtn.disabled = false;
 loadingEl.style.display = 'none';
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
 if (!result) return;
 const moodLabel = this._currentMood
 ? this._currentMood.charAt(0).toUpperCase() + this._currentMood.slice(1)
 : 'Mood';
 result.style.display = 'block';
 result.querySelector('.mood-result-title').textContent = `${moodLabel} Playlist`;
 result.querySelector('.mood-result-meta').textContent =
 tracks.length > 0
 ? `${tracks.length} lagu ditemukan`
 : 'Tidak ada lagu ditemukan. Coba mood lain.';
 const tracksContainer = result.querySelector('.mood-result-tracks');
 if (tracks.length === 0) {
 tracksContainer.innerHTML = `
 <div style="text-align:center; padding: 2rem; color: var(--muted-foreground)">
 <p>Tidak ada lagu yang ditemukan untuk mood ini.</p>
 <p style="font-size:0.875rem; margin-top:0.5rem">Coba pilih mood lain atau klik Regenerate.</p>
 </div>
 `;
 return;
 }
 tracksContainer.innerHTML = tracks.slice(0, 1000).map((t, i) => {
 const title = t.title || t.name || 'Unknown';
 const artist = t.artist?.name || (t.artists && t.artists[0]?.name) || t.artistName || 'Unknown';
 const duration = this._formatDuration(t.duration || t.durationSeconds);
 const cover = t.album?.cover || t.cover || t.image || null;
 const coverUrl = cover ? this._getCoverUrl(cover) : null;
 return `
 <div class="mood-track-item" data-index="${i}">
 <span class="mood-track-num">${i + 1}</span>
 ${coverUrl ? `<img class="mood-track-cover" src="${coverUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="mood-track-cover-placeholder"></div>'}
 <div class="mood-track-info">
 <span class="mood-track-title">${this._escapeHtml(title)}</span>
 <span class="mood-track-artist">${this._escapeHtml(artist)}</span>
 </div>
 <span class="mood-track-duration">${duration}</span>
 </div>
 `;
 }).join('');
 tracksContainer.querySelectorAll('.mood-track-item').forEach(item => {
 item.addEventListener('click', () => {
 const idx = parseInt(item.dataset.index);
 this._player.setQueue(tracks, idx);
 this._player.playTrackFromQueue();
 });
 });
 }
 _getCoverUrl(cover) {
 if (!cover) return null;
 if (typeof cover === 'string' && !cover.startsWith('http') && !cover.startsWith('blob')) {
 const id = cover.replace(/-/g, '/');
 return `https://resources.tidal.com/images/${id}/80x80.jpg`;
 }
 return cover;
 }
 _escapeHtml(str) {
 const div = document.createElement('div');
 div.textContent = str;
 return div.innerHTML;
 }
 _formatDuration(sec) {
 if (!sec) return '--:--';
 const m = Math.floor(sec / 60);
 const s = Math.floor(sec % 60);
 return `${m}:${s.toString().padStart(2, '0')}`;
 }
}
