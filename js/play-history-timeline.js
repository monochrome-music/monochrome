// js/play-history-timeline.js
// Visual play history timeline with daily/weekly stats and activity graph

export class PlayHistoryTimeline {
  constructor(player, audioPlayer) {
    this.player = player;
    this.audioPlayer = audioPlayer;
    this.history = JSON.parse(localStorage.getItem('play-history-data') || '[]');
    this.maxEntries = 5000;
    this._trackPlaying = false;
    this._currentEntry = null;
    this._initTracking();
  }

  _initTracking() {
    this.audioPlayer.addEventListener('play', () => {
      if (this.player.currentTrack && !this._trackPlaying) {
        this._trackPlaying = true;
        this._currentEntry = {
          id: this.player.currentTrack.id,
          title: this.player.currentTrack.title || 'Unknown',
          artist: this.player.currentTrack.artists?.map(a => a.name).join(', ') || 'Unknown',
          album: this.player.currentTrack.album?.title || '',
          cover: this.player.currentTrack.album?.cover || '',
          timestamp: Date.now(),
          duration: 0
        };
      }
    });
    this.audioPlayer.addEventListener('pause', () => this._saveEntry());
    this.audioPlayer.addEventListener('ended', () => this._saveEntry());

    // Track changes
    window.addEventListener('track-changed', () => {
      this._saveEntry();
      this._trackPlaying = false;
    });
  }

  _saveEntry() {
    if (!this._currentEntry) return;
    this._currentEntry.duration = Math.round(this.audioPlayer.currentTime);
    if (this._currentEntry.duration > 5) {
      this.history.unshift(this._currentEntry);
      if (this.history.length > this.maxEntries) this.history.pop();
      localStorage.setItem('play-history-data', JSON.stringify(this.history));
    }
    this._currentEntry = null;
    this._trackPlaying = false;
  }

  getHistory(limit = 50) {
    return this.history.slice(0, limit);
  }

  getToday() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return this.history.filter(e => e.timestamp >= start.getTime());
  }

  getWeek() {
    const start = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.history.filter(e => e.timestamp >= start);
  }

  getDailyStats(days = 7) {
    const stats = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDay = new Date(date); nextDay.setDate(nextDay.getDate() + 1);
      const dayEntries = this.history.filter(e => e.timestamp >= date.getTime() && e.timestamp < nextDay.getTime());
      const totalMin = dayEntries.reduce((s, e) => s + (e.duration || 0), 0) / 60;
      stats.push({
        date: date.toLocaleDateString('id-ID', { weekday: 'short', month: 'short', day: 'numeric' }),
        tracks: dayEntries.length,
        minutes: Math.round(totalMin),
        entries: dayEntries
      });
    }
    return stats;
  }

  getHourlyActivity() {
    const hours = new Array(24).fill(0);
    this.getWeek().forEach(e => {
      const h = new Date(e.timestamp).getHours();
      hours[h]++;
    });
    return hours;
  }

  getTopTracks(limit = 10) {
    const counts = {};
    this.history.forEach(e => {
      const key = e.id || e.title;
      if (!counts[key]) counts[key] = { ...e, count: 0, totalDuration: 0 };
      counts[key].count++;
      counts[key].totalDuration += e.duration || 0;
    });
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, limit);
  }

  getTopArtists(limit = 10) {
    const counts = {};
    this.history.forEach(e => {
      const artist = e.artist || 'Unknown';
      if (!counts[artist]) counts[artist] = { name: artist, count: 0, totalMin: 0 };
      counts[artist].count++;
      counts[artist].totalMin += (e.duration || 0) / 60;
    });
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, limit);
  }

  showTimeline() {
    document.getElementById('play-history-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'play-history-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);';

    const stats = this.getDailyStats(7);
    const topTracks = this.getTopTracks(5);
    const topArtists = this.getTopArtists(5);
    const hourly = this.getHourlyActivity();
    const maxHourly = Math.max(...hourly, 1);
    const todayStats = this.getToday();
    const todayMin = Math.round(todayStats.reduce((s, e) => s + (e.duration || 0), 0) / 60);
    const maxDayMin = Math.max(...stats.map(s => s.minutes), 1);

    modal.innerHTML = `
      <div style="background:var(--bg-secondary,#1a1a2e);border-radius:16px;padding:24px;width:90%;max-width:600px;max-height:80vh;overflow-y:auto;color:var(--text-primary,#fff);box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 style="margin:0;font-size:20px;">Play History</h3>
          <button id="ph-close" style="background:none;border:none;color:var(--text-secondary,#8b8fa3);cursor:pointer;font-size:22px;">&times;</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
          <div style="background:var(--bg-tertiary,#252540);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:bold;color:var(--accent,#00d4ff);">${todayStats.length}</div>
            <div style="font-size:12px;color:var(--text-secondary,#8b8fa3);margin-top:4px;">Tracks Today</div>
          </div>
          <div style="background:var(--bg-tertiary,#252540);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:bold;color:var(--accent,#00d4ff);">${todayMin}</div>
            <div style="font-size:12px;color:var(--text-secondary,#8b8fa3);margin-top:4px;">Minutes Today</div>
          </div>
          <div style="background:var(--bg-tertiary,#252540);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:bold;color:var(--accent,#00d4ff);">${this.history.length}</div>
            <div style="font-size:12px;color:var(--text-secondary,#8b8fa3);margin-top:4px;">All Time</div>
          </div>
        </div>

        <div style="margin-bottom:20px;">
          <h4 style="margin:0 0 12px;font-size:14px;color:var(--text-secondary,#8b8fa3);">Weekly Activity</h4>
          <div style="display:flex;gap:4px;align-items:end;height:60px;">
            ${stats.reverse().map(s => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;"><div style="width:100%;background:var(--accent,#00d4ff);border-radius:4px 4px 0 0;height:${Math.max(4, (s.minutes / maxDayMin) * 50)}px;opacity:0.8;"></div><span style="font-size:9px;color:var(--text-secondary,#8b8fa3);">${s.date.split(',')[0]}</span></div>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:20px;">
          <h4 style="margin:0 0 12px;font-size:14px;color:var(--text-secondary,#8b8fa3);">Hourly Activity (This Week)</h4>
          <div style="display:flex;gap:1px;align-items:end;height:40px;">
            ${hourly.map((h, i) => `<div title="${i}:00 - ${h} tracks" style="flex:1;background:var(--accent,#00d4ff);border-radius:2px 2px 0 0;height:${Math.max(2, (h / maxHourly) * 36)}px;opacity:${h > 0 ? 0.4 + (h / maxHourly) * 0.6 : 0.15};"></div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;"><span style="font-size:9px;color:var(--text-secondary);">0:00</span><span style="font-size:9px;color:var(--text-secondary);">12:00</span><span style="font-size:9px;color:var(--text-secondary);">23:00</span></div>
        </div>

        ${topTracks.length ? `<div style="margin-bottom:20px;"><h4 style="margin:0 0 12px;font-size:14px;color:var(--text-secondary,#8b8fa3);">Most Played Tracks</h4>${topTracks.map((t, i) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border,#333)22;"><span style="font-size:12px;color:var(--text-secondary);width:20px;">${i + 1}</span><div style="flex:1;min-width:0;"><div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title}</div><div style="font-size:11px;color:var(--text-secondary);">${t.artist}</div></div><span style="font-size:12px;color:var(--accent,#00d4ff);">${t.count}x</span></div>`).join('')}</div>` : ''}

        ${topArtists.length ? `<div><h4 style="margin:0 0 12px;font-size:14px;color:var(--text-secondary,#8b8fa3);">Top Artists</h4>${topArtists.map((a, i) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;"><span style="font-size:12px;color:var(--text-secondary);width:20px;">${i + 1}</span><div style="flex:1;">${a.name}</div><span style="font-size:12px;color:var(--accent,#00d4ff);">${Math.round(a.totalMin)} min</span></div>`).join('')}</div>` : ''}

        <button id="ph-clear" style="margin-top:16px;padding:8px 16px;border-radius:8px;border:1px solid #ff4444;background:none;color:#ff4444;cursor:pointer;font-size:12px;">Clear History</button>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#ph-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#ph-clear').addEventListener('click', () => {
      if (confirm('Clear all play history?')) {
        this.history = [];
        localStorage.removeItem('play-history-data');
        modal.remove();
      }
    });
  }

  clearHistory() {
    this.history = [];
    localStorage.removeItem('play-history-data');
  }
}
