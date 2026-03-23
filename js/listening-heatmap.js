// js/listening-heatmap.js
// GitHub-style contribution heatmap for listening activity
// Tracks daily listening minutes and renders a calendar heatmap

const STORAGE_KEY = 'aether-listening-heatmap';

export class ListeningHeatmap {
  constructor() {
    this.data = {}; // { 'YYYY-MM-DD': { minutes: number, tracks: number } }
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.data = raw ? JSON.parse(raw) : {};
    } catch {
      this.data = {};
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('[Heatmap] Save failed:', e);
    }
  }

  _today() {
    return new Date().toISOString().split('T')[0];
  }

  recordListening(durationSeconds) {
    const day = this._today();
    if (!this.data[day]) {
      this.data[day] = { minutes: 0, tracks: 0 };
    }
    this.data[day].minutes += durationSeconds / 60;
    this.data[day].tracks += 1;
    this._save();
    this._dispatchEvent();
  }

  getDay(date) {
    const key = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    return this.data[key] || { minutes: 0, tracks: 0 };
  }

  getRange(startDate, endDate) {
    const result = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
      const key = current.toISOString().split('T')[0];
      result.push({
        date: key,
        ...this.getDay(key),
      });
      current.setDate(current.getDate() + 1);
    }
    return result;
  }

  getLast365Days() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 364);
    return this.getRange(start, end);
  }

  getIntensity(minutes) {
    if (minutes <= 0) return 0;
    if (minutes < 15) return 1;
    if (minutes < 60) return 2;
    if (minutes < 120) return 3;
    return 4;
  }

  getStats() {
    const days = Object.keys(this.data);
    let totalMinutes = 0;
    let totalTracks = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;

    for (const d of days) {
      totalMinutes += this.data[d].minutes;
      totalTracks += this.data[d].tracks;
    }

    // Calculate streak
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      if (this.data[key] && this.data[key].minutes > 0) {
        streak++;
        if (i === 0 || streak > 0) currentStreak = streak;
        longestStreak = Math.max(longestStreak, streak);
      } else {
        if (i === 0) currentStreak = 0;
        streak = 0;
      }
    }

    return {
      totalMinutes: Math.round(totalMinutes),
      totalHours: Math.round(totalMinutes / 60),
      totalTracks,
      activeDays: days.filter(d => this.data[d].minutes > 0).length,
      currentStreak,
      longestStreak,
    };
  }

  renderHTML(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const days = this.getLast365Days();
    const colors = ['var(--heatmap-0, #1a1a2e)', 'var(--heatmap-1, #16213e)', 'var(--heatmap-2, #0f3460)', 'var(--heatmap-3, #533483)', 'var(--heatmap-4, #e94560)'];
    const stats = this.getStats();

    let html = '<div class="heatmap-container">';
    html += '<div class="heatmap-stats">';
    html += `<span>${stats.totalHours}h listened</span>`;
    html += `<span>${stats.totalTracks} tracks</span>`;
    html += `<span>${stats.currentStreak} day streak</span>`;
    html += '</div>';
    html += '<div class="heatmap-grid">';

    for (const day of days) {
      const intensity = this.getIntensity(day.minutes);
      const color = colors[intensity];
      html += `<div class="heatmap-cell" style="background:${color}" `;
      html += `title="${day.date}: ${Math.round(day.minutes)}min, ${day.tracks} tracks" `;
      html += `data-date="${day.date}"></div>`;
    }

    html += '</div>';
    html += '<div class="heatmap-legend">';
    html += '<span>Less</span>';
    for (const c of colors) {
      html += `<div class="heatmap-cell" style="background:${c}"></div>`;
    }
    html += '<span>More</span>';
    html += '</div></div>';

    container.innerHTML = html;
  }

  clearData() {
    this.data = {};
    this._save();
    this._dispatchEvent();
  }

  exportData() {
    return JSON.stringify(this.data, null, 2);
  }

  importData(json) {
    try {
      const parsed = JSON.parse(json);
      this.data = { ...this.data, ...parsed };
      this._save();
      this._dispatchEvent();
    } catch (e) {
      console.error('[Heatmap] Import failed:', e);
    }
  }

  _dispatchEvent() {
    window.dispatchEvent(new CustomEvent('listening-heatmap-update', {
      detail: this.getStats()
    }));
  }
}
