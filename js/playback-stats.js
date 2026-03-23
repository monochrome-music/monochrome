// js/playback-stats.js
// Detailed playback statistics tracker with persistent storage

export class PlaybackStats {
  constructor() {
    this._dbName = 'monochrome-stats';
    this._storeName = 'plays';
    this._db = null;
    this._currentSession = { startTime: Date.now(), tracksPlayed: 0, totalListenTime: 0 };
    this._init();
  }

  async _init() {
    try {
      this._db = await this._openDB();
    } catch (e) {
      console.warn('[PlaybackStats] IndexedDB not available, using localStorage fallback');
    }
  }

  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          const store = db.createObjectStore(this._storeName, { keyPath: 'id', autoIncrement: true });
          store.createIndex('trackId', 'trackId', { unique: false });
          store.createIndex('artistName', 'artistName', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async recordPlay(track, listenDuration) {
    if (!track) return;
    this._currentSession.tracksPlayed++;
    this._currentSession.totalListenTime += listenDuration;

    const entry = {
      trackId: track.id,
      trackTitle: track.title,
      artistName: track.artist?.name || 'Unknown',
      albumTitle: track.album?.title || 'Unknown',
      duration: track.duration || 0,
      listenDuration,
      timestamp: Date.now(),
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      hour: new Date().getHours(),
    };

    if (this._db) {
      try {
        const tx = this._db.transaction(this._storeName, 'readwrite');
        tx.objectStore(this._storeName).add(entry);
      } catch (e) {
        console.warn('[PlaybackStats] Failed to record:', e);
      }
    }
  }

  async getStats(days = 30) {
    const entries = await this._getEntries(days);
    if (entries.length === 0) {
      return { totalPlays: 0, totalTime: 0, uniqueTracks: 0, uniqueArtists: 0, topTracks: [], topArtists: [], hourlyDistribution: new Array(24).fill(0), dailyPlays: {} };
    }

    const trackCounts = {};
    const artistCounts = {};
    const hourly = new Array(24).fill(0);
    const daily = {};
    let totalTime = 0;

    entries.forEach(e => {
      // Track counts
      const key = `${e.trackTitle}|||${e.artistName}`;
      trackCounts[key] = (trackCounts[key] || 0) + 1;

      // Artist counts
      artistCounts[e.artistName] = (artistCounts[e.artistName] || 0) + 1;

      // Hourly
      hourly[e.hour] = (hourly[e.hour] || 0) + 1;

      // Daily
      daily[e.date] = (daily[e.date] || 0) + 1;

      // Total time
      totalTime += e.listenDuration || 0;
    });

    const topTracks = Object.entries(trackCounts)
      .map(([key, count]) => {
        const [title, artist] = key.split('|||');
        return { title, artist, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topArtists = Object.entries(artistCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalPlays: entries.length,
      totalTime,
      uniqueTracks: Object.keys(trackCounts).length,
      uniqueArtists: Object.keys(artistCounts).length,
      topTracks,
      topArtists,
      hourlyDistribution: hourly,
      dailyPlays: daily,
    };
  }

  async _getEntries(days) {
    if (!this._db) return [];
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    return new Promise((resolve) => {
      try {
        const tx = this._db.transaction(this._storeName, 'readonly');
        const store = tx.objectStore(this._storeName);
        const index = store.index('timestamp');
        const range = IDBKeyRange.lowerBound(cutoff);
        const results = [];

        const cursor = index.openCursor(range);
        cursor.onsuccess = (e) => {
          const c = e.target.result;
          if (c) {
            results.push(c.value);
            c.continue();
          } else {
            resolve(results);
          }
        };
        cursor.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  getSessionStats() {
    const duration = Date.now() - this._currentSession.startTime;
    return {
      ...this._currentSession,
      sessionDuration: duration,
    };
  }

  formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
}
