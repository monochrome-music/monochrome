// js/daylist.js
// Daylist - Time-of-day based playlist generator (like Spotify's Daylist)

const STORAGE_KEY = 'aether-daylist-cache';

export class Daylist {
    constructor(player, musicAPI) {
        this.player = player;
        this.musicAPI = musicAPI;
        this._generatedTracks = [];
    }

    _getTimeSlot() {
        const hour = new Date().getHours();
        const day = new Date().getDay();
        const isWeekend = day === 0 || day === 6;

        if (hour >= 5 && hour < 8)
            return { id: 'early-morning', label: 'Subuh', emoji: '\u{1F305}', period: 'pagi-pagi buta' };
        if (hour >= 8 && hour < 11)
            return {
                id: 'morning',
                label: 'Pagi',
                emoji: '\u2600\uFE0F',
                period: isWeekend ? 'santai pagi' : 'pagi produktif',
            };
        if (hour >= 11 && hour < 14)
            return { id: 'late-morning', label: 'Siang Awal', emoji: '\u{1F324}\uFE0F', period: 'menjelang siang' };
        if (hour >= 14 && hour < 17) return { id: 'afternoon', label: 'Sore', emoji: '\u{1F307}', period: 'sore hari' };
        if (hour >= 17 && hour < 19)
            return { id: 'evening', label: 'Petang', emoji: '\u{1F306}', period: 'matahari terbenam' };
        if (hour >= 19 && hour < 22)
            return {
                id: 'night',
                label: 'Malam',
                emoji: '\u{1F319}',
                period: isWeekend ? 'malam akhir pekan' : 'malam hari',
            };
        return { id: 'late-night', label: 'Malam Larut', emoji: '\u{1F303}', period: 'dini hari' };
    }

    _getMoodConfig(timeSlot) {
        const configs = {
            'early-morning': {
                queries: [
                    'morning acoustic playlist',
                    'gentle wake up songs',
                    'soft indie morning',
                    'peaceful piano morning',
                    'chill morning vibes',
                    'coffee shop playlist',
                    'indie folk morning',
                    'calm morning music',
                    'lofi morning beats',
                    'easy listening morning',
                ],
                subtitle: 'Lembut untuk memulai harimu',
            },
            morning: {
                queries: [
                    'upbeat morning playlist',
                    'feel good morning hits',
                    'positive vibes songs',
                    'morning motivation music',
                    'happy pop morning',
                    'energizing morning playlist',
                    'indie pop morning',
                    'acoustic happy songs',
                    'summer morning vibes',
                    'good mood playlist',
                ],
                subtitle: 'Energi positif untuk pagimu',
            },
            'late-morning': {
                queries: [
                    'focus work playlist',
                    'productivity music',
                    'study beats',
                    'concentration ambient',
                    'lofi work from home',
                    'instrumental focus',
                    'deep focus music',
                    'coding playlist',
                    'minimal electronic focus',
                    'classical for work',
                ],
                subtitle: 'Fokus dan produktif',
            },
            afternoon: {
                queries: [
                    'afternoon chill playlist',
                    'feel good afternoon',
                    'relaxing pop songs',
                    'afternoon coffee music',
                    'chill pop hits',
                    'indie afternoon vibes',
                    'acoustic afternoon',
                    'mellow afternoon playlist',
                    'sunny day songs',
                    'easy going playlist',
                ],
                subtitle: 'Santai di sore hari',
            },
            evening: {
                queries: [
                    'sunset playlist',
                    'golden hour music',
                    'evening chill vibes',
                    'dusk acoustic songs',
                    'warm evening playlist',
                    'twilight indie',
                    'driving at sunset',
                    'beautiful evening music',
                    'ambient sunset',
                    'chill evening beats',
                ],
                subtitle: 'Musik untuk matahari terbenam',
            },
            night: {
                queries: [
                    'night vibes playlist',
                    'late night pop r&b',
                    'moody night songs',
                    'night drive music',
                    'dark pop playlist',
                    'evening r&b soul',
                    'chill night beats',
                    'neon lights playlist',
                    'night mood indie',
                    'smooth night music',
                ],
                subtitle: 'Suasana malam yang sempurna',
            },
            'late-night': {
                queries: [
                    'late night lofi',
                    'sleepy time music',
                    'midnight acoustic',
                    'dreamy ambient playlist',
                    'quiet night songs',
                    '2am playlist',
                    'stargazing music',
                    'night sky ambient',
                    'peaceful night sleep',
                    'calm late night vibes',
                ],
                subtitle: 'Tenang untuk larut malam',
            },
        };
        return configs[timeSlot.id] || configs['morning'];
    }

    _getDayName() {
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        return days[new Date().getDay()];
    }

    async generateDaylist(count = 50) {
        const timeSlot = this._getTimeSlot();
        const config = this._getMoodConfig(timeSlot);
        const allTracks = [];
        const seen = new Set();

        for (const query of config.queries) {
            if (allTracks.length >= count * 1.5) break;
            try {
                const results = await this.musicAPI.searchTracks(query, { limit: 20 });
                if (results?.length) {
                    for (const track of results) {
                        const key = track.id || track.trackId || track.title;
                        if (!seen.has(key)) {
                            seen.add(key);
                            allTracks.push(track);
                        }
                    }
                }
            } catch (e) {
                console.warn('[Daylist] Search failed for query:', query, e);
            }
        }

        // Shuffle (Fisher-Yates)
        for (let i = allTracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
        }

        this._generatedTracks = allTracks.slice(0, count);

        // Cache result
        try {
            const cache = {
                timeSlotId: timeSlot.id,
                timestamp: Date.now(),
                tracks: this._generatedTracks,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        } catch {
            /* ignore */
        }

        return this._generatedTracks;
    }

    _getCachedDaylist() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const cache = JSON.parse(raw);
            const currentSlot = this._getTimeSlot();
            // Cache valid for 3 hours
            if (cache.timeSlotId === currentSlot.id && Date.now() - cache.timestamp < 3 * 60 * 60 * 1000) {
                return cache.tracks;
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    getDaylistInfo() {
        const slot = this._getTimeSlot();
        const config = this._getMoodConfig(slot);
        return {
            timeSlot: slot,
            subtitle: config.subtitle,
            dayName: this._getDayName(),
            title: `Daylist ${slot.emoji} ${slot.label}`,
        };
    }

    playDaylist() {
        if (this._generatedTracks.length > 0) {
            this.player.setQueue(this._generatedTracks, 0);
            this.player.playTrackFromQueue();
        }
    }

    async renderDaylistCard(container) {
        if (!container) return;

        const info = this.getDaylistInfo();
        const cached = this._getCachedDaylist();

        // Show skeleton first
        container.innerHTML = `
            <div class="daylist-card" id="daylist-main-card">
                <div class="daylist-gradient"></div>
                <div class="daylist-content">
                    <div class="daylist-emoji">${info.timeSlot.emoji}</div>
                    <div class="daylist-title">${info.dayName} ${info.timeSlot.label.toLowerCase()}</div>
                    <div class="daylist-subtitle">${info.subtitle}</div>
                    <div class="daylist-count">Tekan untuk dengarkan</div>
                    <button class="daylist-play-btn" id="daylist-play-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
            </div>
        `;

        // Load tracks
        if (cached) {
            this._generatedTracks = cached;
        } else {
            await this.generateDaylist();
        }

        // Update count
        const countEl = container.querySelector('.daylist-count');
        if (countEl) {
            countEl.textContent = `${this._generatedTracks.length} lagu`;
        }

        // Play button
        container.querySelector('#daylist-play-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.playDaylist();
        });

        // Card click -> show tracks
        container.querySelector('#daylist-main-card')?.addEventListener('click', () => {
            this._showDaylistTracks();
        });
    }

    _showDaylistTracks() {
        const info = this.getDaylistInfo();
        document.getElementById('daylist-tracks-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'daylist-tracks-modal';
        modal.className = 'daylist-tracks-overlay';
        modal.innerHTML = `
            <div class="daylist-tracks-panel">
                <div class="daylist-tracks-header">
                    <div>
                        <h3 style="margin:0;font-size:1.2rem;color:var(--text-primary)">${info.title}</h3>
                        <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-secondary)">${info.subtitle} \u00B7 ${this._generatedTracks.length} lagu</p>
                    </div>
                    <button class="daylist-tracks-close" id="daylist-tracks-close">&times;</button>
                </div>
                <button class="daylist-play-all-btn" id="daylist-play-all">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <span>Putar Semua</span>
                </button>
                <div class="daylist-tracks-list">
                    ${this._generatedTracks
                        .map(
                            (t, i) => `
                        <div class="daylist-track-item" data-index="${i}">
                            <span class="daylist-track-num">${i + 1}</span>
                            <div class="daylist-track-info">
                                <span class="daylist-track-title">${t.title || 'Unknown'}</span>
                                <span class="daylist-track-artist">${t.artist?.name || t.artists?.map((a) => a.name).join(', ') || 'Unknown'}</span>
                            </div>
                            ${t.album?.cover ? `<img class="daylist-track-cover" src="${t.album.cover}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#daylist-tracks-close')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#daylist-play-all')?.addEventListener('click', () => {
            this.playDaylist();
            modal.remove();
        });

        modal.querySelectorAll('.daylist-track-item').forEach((item) => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.player.setQueue(this._generatedTracks, index);
                this.player.playTrackFromQueue();
                modal.remove();
            });
        });
    }
}
