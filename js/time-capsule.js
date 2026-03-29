// js/time-capsule.js
// Time Capsule - Throwback playlist based on listening history from 1-3 years ago

const STORAGE_KEY = 'aether-time-capsule-cache';

export class TimeCapsule {
    constructor(player, musicAPI) {
        this.player = player;
        this.musicAPI = musicAPI;
        this._generatedTracks = [];
    }

    _getHistory() {
        try {
            return JSON.parse(localStorage.getItem('play-history-data') || '[]');
        } catch {
            return [];
        }
    }

    _getThrowbackPeriod() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentDay = now.getDate();

        // Look at tracks from 1-3 years ago during the same period (±2 months)
        const periods = [];
        for (let yearsBack = 1; yearsBack <= 3; yearsBack++) {
            const targetYear = now.getFullYear() - yearsBack;
            const start = new Date(targetYear, Math.max(0, currentMonth - 2), 1);
            const end = new Date(targetYear, Math.min(11, currentMonth + 2) + 1, 0, 23, 59, 59);
            periods.push({ start: start.getTime(), end: end.getTime(), year: targetYear });
        }
        return periods;
    }

    _getThrowbackTracks() {
        const history = this._getHistory();
        const periods = this._getThrowbackPeriod();

        // Collect tracks from all throwback periods
        const throwbackEntries = [];
        for (const period of periods) {
            const entries = history.filter((e) => e.timestamp >= period.start && e.timestamp <= period.end);
            throwbackEntries.push(...entries.map((e) => ({ ...e, throwbackYear: period.year })));
        }

        // Count track frequency
        const trackCounts = {};
        throwbackEntries.forEach((entry) => {
            const key = entry.id || entry.title;
            if (!trackCounts[key]) {
                trackCounts[key] = {
                    id: entry.id,
                    title: entry.title,
                    artist: entry.artist,
                    album: entry.album,
                    cover: entry.cover,
                    count: 0,
                    throwbackYear: entry.throwbackYear,
                    totalDuration: 0,
                };
            }
            trackCounts[key].count++;
            trackCounts[key].totalDuration += entry.duration || 0;
        });

        // Sort by frequency (most played first)
        return Object.values(trackCounts).sort((a, b) => b.count - a.count);
    }

    async _searchTrackOnAPI(trackInfo) {
        try {
            const query = `${trackInfo.title} ${trackInfo.artist || ''}`;
            const results = await this.musicAPI.searchTracks(query, { limit: 3 });
            if (results?.length > 0) {
                return results[0];
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    async generateTimeCapsule(count = 30) {
        const throwbackTracks = this._getThrowbackTracks();

        if (throwbackTracks.length === 0) {
            this._generatedTracks = [];
            return this._generatedTracks;
        }

        // Take top tracks
        const topThrowback = throwbackTracks.slice(0, count);

        // Try to resolve each track via API for playable versions
        const resolvedTracks = [];
        const seen = new Set();

        for (const track of topThrowback) {
            if (resolvedTracks.length >= count) break;

            // If we already have an ID, try to use it directly
            if (track.id && !seen.has(track.id)) {
                seen.add(track.id);
                resolvedTracks.push({
                    id: track.id,
                    title: track.title,
                    artist: { name: track.artist },
                    album: { title: track.album || '', cover: track.cover || '' },
                    throwbackYear: track.throwbackYear,
                    playCount: track.count,
                });
            }
        }

        // Shuffle lightly (keep mostly sorted by frequency)
        for (let i = resolvedTracks.length - 1; i > Math.max(0, resolvedTracks.length - 8); i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [resolvedTracks[i], resolvedTracks[j]] = [resolvedTracks[j], resolvedTracks[i]];
        }

        this._generatedTracks = resolvedTracks;

        // Cache
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    timestamp: Date.now(),
                    tracks: this._generatedTracks,
                })
            );
        } catch {
            /* ignore */
        }

        return this._generatedTracks;
    }

    _getCached() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const cache = JSON.parse(raw);
            // Cache valid for 24 hours
            if (Date.now() - cache.timestamp < 24 * 60 * 60 * 1000) {
                return cache.tracks;
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    _getThrowbackYears() {
        const now = new Date();
        return [now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];
    }

    playTimeCapsule() {
        if (this._generatedTracks.length > 0) {
            this.player.setQueue(this._generatedTracks, 0);
            this.player.playTrackFromQueue();
        }
    }

    async renderTimeCapsuleCard(container) {
        if (!container) return;

        const years = this._getThrowbackYears();
        const yearRange = `${years[2]} - ${years[0]}`;

        // Show card
        container.innerHTML = `
            <div class="time-capsule-card" id="time-capsule-main-card">
                <div class="time-capsule-bg">
                    <div class="time-capsule-year-bubble y1">${years[2]}</div>
                    <div class="time-capsule-year-bubble y2">${years[1]}</div>
                    <div class="time-capsule-year-bubble y3">${years[0]}</div>
                </div>
                <div class="time-capsule-content">
                    <div class="time-capsule-icon">\u{1F4E6}</div>
                    <div class="time-capsule-title">Time Capsule</div>
                    <div class="time-capsule-subtitle">Lagu-lagu dari ${yearRange}</div>
                    <div class="time-capsule-count" id="time-capsule-count">Memuat...</div>
                    <button class="time-capsule-play-btn" id="time-capsule-play-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
            </div>
        `;

        // Load tracks
        const cached = this._getCached();
        if (cached) {
            this._generatedTracks = cached;
        } else {
            await this.generateTimeCapsule();
        }

        // Update count
        const countEl = container.querySelector('#time-capsule-count');
        if (countEl) {
            countEl.textContent =
                this._generatedTracks.length > 0
                    ? `${this._generatedTracks.length} lagu nostalgia`
                    : 'Belum ada data cukup';
        }

        // Play button
        container.querySelector('#time-capsule-play-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._generatedTracks.length > 0) this.playTimeCapsule();
        });

        // Card click -> show tracks
        container.querySelector('#time-capsule-main-card')?.addEventListener('click', () => {
            if (this._generatedTracks.length > 0) this._showTracks();
        });
    }

    _showTracks() {
        document.getElementById('time-capsule-tracks-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'time-capsule-tracks-modal';
        modal.className = 'time-capsule-tracks-overlay';
        modal.innerHTML = `
            <div class="time-capsule-tracks-panel">
                <div class="time-capsule-tracks-header">
                    <div>
                        <h3 style="margin:0;font-size:1.2rem;color:var(--text-primary)">\u{1F4E6} Time Capsule</h3>
                        <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-secondary)">${this._generatedTracks.length} lagu nostalgia</p>
                    </div>
                    <button class="time-capsule-tracks-close" id="tc-tracks-close">&times;</button>
                </div>
                <button class="time-capsule-play-all-btn" id="tc-play-all">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <span>Putar Semua</span>
                </button>
                <div class="time-capsule-tracks-list">
                    ${this._generatedTracks
                        .map(
                            (t, i) => `
                        <div class="time-capsule-track-item" data-index="${i}">
                            <span class="time-capsule-track-num">${i + 1}</span>
                            <div class="time-capsule-track-info">
                                <span class="time-capsule-track-title">${t.title || 'Unknown'}</span>
                                <span class="time-capsule-track-artist">${t.artist?.name || 'Unknown'} ${t.throwbackYear ? `\u00B7 ${t.throwbackYear}` : ''}</span>
                            </div>
                            ${t.album?.cover ? `<img class="time-capsule-track-cover" src="${t.album.cover}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#tc-tracks-close')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        modal.querySelector('#tc-play-all')?.addEventListener('click', () => {
            this.playTimeCapsule();
            modal.remove();
        });

        modal.querySelectorAll('.time-capsule-track-item').forEach((item) => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.player.setQueue(this._generatedTracks, index);
                this.player.playTrackFromQueue();
                modal.remove();
            });
        });
    }
}
