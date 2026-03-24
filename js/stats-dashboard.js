// js/stats-dashboard.js
// Advanced Listening Statistics Dashboard with charts and insights

export class StatsDashboard {
  constructor() {
    this._dbName = 'monochrome-stats';
    this._db = null;
    this._init();
  }

  async _init() {
    try {
      this._db = await this._openDB();
    } catch (e) {
      console.warn('[StatsDashboard] DB init failed:', e);
    }
  }

  _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('plays')) {
          const store = db.createObjectStore('plays', { keyPath: 'id', autoIncrement: true });
          store.createIndex('trackId', 'trackId', { unique: false });
          store.createIndex('artistName', 'artistName', { unique: false });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('hour', 'hour', { unique: false });
        }
        if (!db.objectStoreNames.contains('streaks')) {
          db.createObjectStore('streaks', { keyPath: 'date' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async recordPlay(track, duration) {
    if (!track || !this._db) return;
    const now = new Date();
    const entry = {
      trackId: track.id,
      title: track.title,
      artistName: track.artist?.name || track.artists?.[0]?.name || 'Unknown',
      albumTitle: track.album?.title || '',
      duration: duration || 0,
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
    };
    const tx = this._db.transaction('plays', 'readwrite');
    tx.objectStore('plays').add(entry);
    // Record streak
    const streakTx = this._db.transaction('streaks', 'readwrite');
    streakTx.objectStore('streaks').put({ date: entry.date, count: 1 });
  }

  async getStats(days = 30) {
    if (!this._db) return this._emptyStats();
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const plays = await this._getAllPlays();
    const filtered = plays.filter(p => p.timestamp >= cutoff);

    // Top tracks
    const trackCounts = {};
    const artistCounts = {};
    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    const dateCounts = {};
    let totalDuration = 0;

    for (const p of filtered) {
      trackCounts[p.trackId] = trackCounts[p.trackId] || { title: p.title, artist: p.artistName, count: 0 };
      trackCounts[p.trackId].count++;
      artistCounts[p.artistName] = (artistCounts[p.artistName] || 0) + 1;
      hourCounts[p.hour]++;
      dayCounts[p.dayOfWeek]++;
      dateCounts[p.date] = (dateCounts[p.date] || 0) + 1;
      totalDuration += (p.duration || 0);
    }

    const topTracks = Object.values(trackCounts).sort((a, b) => b.count - a.count).slice(0, 10);
    const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
    const streak = await this._calculateStreak();
    const uniqueTracks = new Set(filtered.map(p => p.trackId)).size;

    return {
      totalPlays: filtered.length,
      uniqueTracks,
      totalDuration,
      topTracks,
      topArtists,
      hourCounts,
      dayCounts,
      dateCounts,
      streak,
      personality: this._getPersonality(hourCounts, topArtists),
    };
  }

  _getPersonality(hourCounts, topArtists) {
    const nightPlays = hourCounts.slice(22).reduce((a, b) => a + b, 0) + hourCounts.slice(0, 5).reduce((a, b) => a + b, 0);
    const morningPlays = hourCounts.slice(5, 12).reduce((a, b) => a + b, 0);
    const total = hourCounts.reduce((a, b) => a + b, 0);
    if (total === 0) return { badge: 'Newcomer', icon: '\u{1F331}', desc: 'Just getting started!' };
    if (nightPlays / total > 0.4) return { badge: 'Night Owl', icon: '\u{1F989}', desc: 'You love late-night listening sessions' };
    if (morningPlays / total > 0.4) return { badge: 'Early Bird', icon: '\u{1F426}', desc: 'Music is your morning ritual' };
    if (topArtists.length > 0 && topArtists[0].count > total * 0.3) return { badge: 'Superfan', icon: '\u{2B50}', desc: `Obsessed with ${topArtists[0].name}` };
    return { badge: 'Explorer', icon: '\u{1F30D}', desc: 'You love discovering new music' };
  }

  async _calculateStreak() {
    if (!this._db) return 0;
    const tx = this._db.transaction('streaks', 'readonly');
    const store = tx.objectStore('streaks');
    const all = await new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
    const dates = new Set(all.map(s => s.date));
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (dates.has(d.toISOString().split('T')[0])) streak++;
      else break;
    }
    return streak;
  }

  _getAllPlays() {
    return new Promise((resolve) => {
      const tx = this._db.transaction('plays', 'readonly');
      const req = tx.objectStore('plays').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  _emptyStats() {
    return { totalPlays: 0, uniqueTracks: 0, totalDuration: 0, topTracks: [], topArtists: [], hourCounts: new Array(24).fill(0), dayCounts: new Array(7).fill(0), dateCounts: {}, streak: 0, personality: { badge: 'Newcomer', icon: '\u{1F331}', desc: 'Start listening!' } };
  }

  async renderDashboard(container) {
    if (!container) return;
    const stats = await this.getStats(30);
    const hrs = Math.floor(stats.totalDuration / 3600);
    const mins = Math.floor((stats.totalDuration % 3600) / 60);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const maxHour = Math.max(...stats.hourCounts, 1);
    const maxDay = Math.max(...stats.dayCounts, 1);

    container.innerHTML = `
      <div class="stats-dashboard">
        <div class="stats-header">
          <h2>Your Music Stats</h2>
          <div class="stats-period-tabs">
            <button class="stats-tab active" data-days="7">7 Days</button>
            <button class="stats-tab" data-days="30">30 Days</button>
            <button class="stats-tab" data-days="90">90 Days</button>
            <button class="stats-tab" data-days="365">1 Year</button>
          </div>
        </div>

        <div class="stats-personality">
          <span class="personality-icon">${stats.personality.icon}</span>
          <div>
            <h3>${stats.personality.badge}</h3>
            <p>${stats.personality.desc}</p>
          </div>
        </div>

        <div class="stats-overview">
          <div class="stat-card"><span class="stat-value">${stats.totalPlays}</span><span class="stat-label">Total Plays</span></div>
          <div class="stat-card"><span class="stat-value">${stats.uniqueTracks}</span><span class="stat-label">Unique Tracks</span></div>
          <div class="stat-card"><span class="stat-value">${hrs}h ${mins}m</span><span class="stat-label">Listen Time</span></div>
          <div class="stat-card streak"><span class="stat-value">${stats.streak}</span><span class="stat-label">Day Streak \u{1F525}</span></div>
        </div>

        <div class="stats-section">
          <h3>Top Tracks</h3>
          <div class="top-list">
            ${stats.topTracks.map((t, i) => `
              <div class="top-item">
                <span class="top-rank">${i + 1}</span>
                <div class="top-info"><span class="top-title">${t.title}</span><span class="top-artist">${t.artist}</span></div>
                <span class="top-count">${t.count} plays</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="stats-section">
          <h3>Top Artists</h3>
          <div class="top-list">
            ${stats.topArtists.map((a, i) => `
              <div class="top-item">
                <span class="top-rank">${i + 1}</span>
                <div class="top-info"><span class="top-title">${a.name}</span></div>
                <span class="top-count">${a.count} plays</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="stats-section">
          <h3>Listening Activity by Hour</h3>
          <div class="hour-chart">
            ${stats.hourCounts.map((c, i) => `
              <div class="hour-bar" style="height:${(c / maxHour) * 100}%" title="${i}:00 - ${c} plays"></div>
            `).join('')}
          </div>
          <div class="hour-labels">${Array.from({ length: 24 }, (_, i) => `<span>${i}</span>`).join('')}</div>
        </div>

        <div class="stats-section">
          <h3>Listening Activity by Day</h3>
          <div class="day-chart">
            ${stats.dayCounts.map((c, i) => `
              <div class="day-bar-wrapper">
                <div class="day-bar" style="width:${(c / maxDay) * 100}%"></div>
                <span class="day-label">${dayNames[i]}</span>
                <span class="day-count">${c}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Period tab switching
    container.querySelectorAll('.stats-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        container.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        await this.renderDashboard(container);
      });
    });
  }
}
