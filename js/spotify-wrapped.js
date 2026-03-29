// js/spotify-wrapped.js
// Spotify Wrapped - Yearly Music Review Feature

export class SpotifyWrapped {
    constructor() {
        this.currentSlide = 0;
        this.slides = [];
        this.data = null;
    }

    async _collectData() {
        // Read directly from localStorage and IndexedDB
        // 1. Play history from localStorage
        const playHistory = JSON.parse(localStorage.getItem('play-history-data') || '[]');

        // 2. Heatmap data from localStorage
        const heatmapData = JSON.parse(localStorage.getItem('aether-listening-heatmap') || '{}');

        // 3. IndexedDB stats
        const dbStats = await this._getIndexedDBStats();

        // Filter to current year
        const year = new Date().getFullYear();
        const yearStart = new Date(year, 0, 1).getTime();
        const yearEnd = new Date(year, 11, 31, 23, 59, 59).getTime();

        const yearPlays = playHistory.filter((p) => p.timestamp >= yearStart && p.timestamp <= yearEnd);
        const yearDbPlays = dbStats.filter((p) => {
            const playDate = new Date(p.date).getTime();
            return playDate >= yearStart && playDate <= yearEnd;
        });

        // Calculate stats
        const totalMinutes = Math.round(yearPlays.reduce((sum, p) => sum + (p.duration || 0), 0) / 60);
        const totalHours = Math.floor(totalMinutes / 60);
        const remainingMins = totalMinutes % 60;

        // Top tracks from play history
        const trackCounts = {};
        yearPlays.forEach((p) => {
            const key = p.id || p.title;
            if (!trackCounts[key]) trackCounts[key] = { title: p.title, artist: p.artist, count: 0, cover: p.cover };
            trackCounts[key].count++;
        });
        const topTracks = Object.values(trackCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Top artists from play history
        const artistCounts = {};
        yearPlays.forEach((p) => {
            const artistName = p.artist || 'Unknown';
            if (!artistCounts[artistName]) artistCounts[artistName] = { name: artistName, count: 0 };
            artistCounts[artistName].count++;
        });
        const topArtists = Object.values(artistCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Hour and day distribution from IndexedDB
        const hourCounts = new Array(24).fill(0);
        const dayCounts = new Array(7).fill(0);
        yearDbPlays.forEach((p) => {
            hourCounts[p.hour]++;
            dayCounts[p.dayOfWeek]++;
        });

        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const peakDay = dayNames[dayCounts.indexOf(Math.max(...dayCounts))];

        // Listening personality
        const personality = this._getPersonality(hourCounts, topArtists, yearPlays.length);

        // Heatmap stats for current year
        let activeDays = 0;
        Object.entries(heatmapData).forEach(([date, data]) => {
            if (date.startsWith(String(year)) && data.minutes > 0) activeDays++;
        });

        this.data = {
            year,
            totalMinutes,
            totalHours,
            remainingMins,
            totalPlays: yearPlays.length,
            uniqueTracks: Object.keys(trackCounts).length,
            uniqueArtists: Object.keys(artistCounts).length,
            topTracks,
            topArtists,
            peakHour,
            peakDay,
            personality,
            activeDays,
        };

        return this.data;
    }

    async _getIndexedDBStats() {
        return new Promise((resolve) => {
            try {
                const req = indexedDB.open('monochrome-stats', 2);
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('plays')) {
                        resolve([]);
                        return;
                    }
                    const tx = db.transaction('plays', 'readonly');
                    const storeReq = tx.objectStore('plays').getAll();
                    storeReq.onsuccess = () => resolve(storeReq.result || []);
                    storeReq.onerror = () => resolve([]);
                };
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    }

    _getPersonality(hourCounts, topArtists, totalPlays) {
        if (totalPlays === 0)
            return {
                badge: 'Newcomer',
                icon: '\u{1F331}',
                desc: 'Mulai dengarkan musik untuk melihat Wrapped-mu!',
                color: '#666',
            };

        const nightPlays =
            hourCounts.slice(22).reduce((a, b) => a + b, 0) + hourCounts.slice(0, 5).reduce((a, b) => a + b, 0);
        const morningPlays = hourCounts.slice(5, 12).reduce((a, b) => a + b, 0);
        const total = hourCounts.reduce((a, b) => a + b, 0);

        if (total > 0 && nightPlays / total > 0.4)
            return {
                badge: 'Night Owl',
                icon: '\u{1F989}',
                desc: 'Kamu suka mendengarkan musik di malam hari',
                color: '#7c3aed',
            };
        if (total > 0 && morningPlays / total > 0.4)
            return { badge: 'Early Bird', icon: '\u{1F426}', desc: 'Musik adalah ritual pagimu', color: '#f59e0b' };
        if (topArtists.length > 0 && topArtists[0].count > total * 0.3)
            return {
                badge: 'Superfan',
                icon: '\u2B50',
                desc: `Kamu sangat menggemari ${topArtists[0].name}`,
                color: '#ef4444',
            };
        return { badge: 'Explorer', icon: '\u{1F30D}', desc: 'Kamu suka menemukan musik baru', color: '#10b981' };
    }

    _buildSlides() {
        if (!this.data) return [];
        const d = this.data;

        return [
            // Slide 1: Intro
            {
                bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
                content: `
                    <div class="wrapped-slide wrapped-intro">
                        <div class="wrapped-year">${d.year}</div>
                        <div class="wrapped-title">Your<br>Wrapped</div>
                        <div class="wrapped-subtitle">Aether Music</div>
                        <div class="wrapped-decoration">
                            <div class="wrapped-circle c1"></div>
                            <div class="wrapped-circle c2"></div>
                            <div class="wrapped-circle c3"></div>
                        </div>
                    </div>
                `,
            },
            // Slide 2: Total Minutes
            {
                bg: 'linear-gradient(135deg, #e94560 0%, #533483 100%)',
                content: `
                    <div class="wrapped-slide wrapped-minutes">
                        <div class="wrapped-label">Kamu mendengarkan</div>
                        <div class="wrapped-big-number">${d.totalMinutes.toLocaleString()}</div>
                        <div class="wrapped-unit">menit musik di ${d.year}</div>
                        <div class="wrapped-detail">${d.totalPlays} lagu diputar \u00B7 ${d.uniqueTracks} lagu unik</div>
                    </div>
                `,
            },
            // Slide 3: Top Artists
            {
                bg: 'linear-gradient(135deg, #0f3460 0%, #533483 100%)',
                content: `
                    <div class="wrapped-slide wrapped-artists">
                        <div class="wrapped-label">Artis Teratas</div>
                        <div class="wrapped-list">
                            ${d.topArtists
                                .map(
                                    (a, i) => `
                                <div class="wrapped-list-item" style="animation-delay: ${i * 0.1}s">
                                    <span class="wrapped-rank">${i + 1}</span>
                                    <div class="wrapped-info">
                                        <span class="wrapped-name">${a.name}</span>
                                        <span class="wrapped-meta">${a.count} pemutaran</span>
                                    </div>
                                </div>
                            `
                                )
                                .join('')}
                        </div>
                    </div>
                `,
            },
            // Slide 4: Top Tracks
            {
                bg: 'linear-gradient(135deg, #16213e 0%, #e94560 100%)',
                content: `
                    <div class="wrapped-slide wrapped-tracks">
                        <div class="wrapped-label">Lagu Teratas</div>
                        <div class="wrapped-list">
                            ${d.topTracks
                                .map(
                                    (t, i) => `
                                <div class="wrapped-list-item" style="animation-delay: ${i * 0.1}s">
                                    <span class="wrapped-rank">${i + 1}</span>
                                    <div class="wrapped-info">
                                        <span class="wrapped-name">${t.title}</span>
                                        <span class="wrapped-meta">${t.artist} \u00B7 ${t.count}x</span>
                                    </div>
                                    ${t.cover ? `<img class="wrapped-cover" src="${t.cover}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                                </div>
                            `
                                )
                                .join('')}
                        </div>
                    </div>
                `,
            },
            // Slide 5: Personality
            {
                bg: `linear-gradient(135deg, ${d.personality.color}22 0%, ${d.personality.color}66 100%)`,
                content: `
                    <div class="wrapped-slide wrapped-personality">
                        <div class="wrapped-label">Kepribadian Mendengarkanmu</div>
                        <div class="wrapped-personality-icon">${d.personality.icon}</div>
                        <div class="wrapped-personality-badge">${d.personality.badge}</div>
                        <div class="wrapped-personality-desc">${d.personality.desc}</div>
                    </div>
                `,
            },
            // Slide 6: Peak Hours
            {
                bg: 'linear-gradient(135deg, #0f3460 0%, #1a1a2e 100%)',
                content: `
                    <div class="wrapped-slide wrapped-peak">
                        <div class="wrapped-label">Waktu Favoritmu</div>
                        <div class="wrapped-peak-hour">
                            <div class="wrapped-big-number">${d.peakHour}:00</div>
                            <div class="wrapped-unit">jam paling aktif</div>
                        </div>
                        <div class="wrapped-peak-day">
                            <div class="wrapped-medium-number">${d.peakDay}</div>
                            <div class="wrapped-unit">hari paling aktif</div>
                        </div>
                        <div class="wrapped-detail">${d.activeDays} hari aktif mendengarkan</div>
                    </div>
                `,
            },
            // Slide 7: Summary
            {
                bg: 'linear-gradient(135deg, #e94560 0%, #0f3460 50%, #533483 100%)',
                content: `
                    <div class="wrapped-slide wrapped-summary">
                        <div class="wrapped-year">${d.year}</div>
                        <div class="wrapped-label">Ringkasan Wrapped-mu</div>
                        <div class="wrapped-summary-grid">
                            <div class="wrapped-summary-item">
                                <span class="wrapped-summary-value">${d.totalMinutes.toLocaleString()}</span>
                                <span class="wrapped-summary-label">Menit</span>
                            </div>
                            <div class="wrapped-summary-item">
                                <span class="wrapped-summary-value">${d.totalPlays}</span>
                                <span class="wrapped-summary-label">Pemutaran</span>
                            </div>
                            <div class="wrapped-summary-item">
                                <span class="wrapped-summary-value">${d.uniqueArtists}</span>
                                <span class="wrapped-summary-label">Artis</span>
                            </div>
                            <div class="wrapped-summary-item">
                                <span class="wrapped-summary-value">${d.uniqueTracks}</span>
                                <span class="wrapped-summary-label">Lagu</span>
                            </div>
                        </div>
                        <div class="wrapped-top-summary">
                            <div>Artis #1: <strong>${d.topArtists[0]?.name || '-'}</strong></div>
                            <div>Lagu #1: <strong>${d.topTracks[0]?.title || '-'}</strong></div>
                        </div>
                        <button class="wrapped-share-btn" id="wrapped-share-btn">
                            \u{1F4CE} Bagikan Wrapped
                        </button>
                    </div>
                `,
            },
        ];
    }

    _renderSlide(index) {
        const container = document.querySelector('.wrapped-slides-container');
        if (!container || !this.slides[index]) return;

        container.innerHTML = this.slides[index].content;
        container.style.background = this.slides[index].bg;

        // Update dots
        document.querySelectorAll('.wrapped-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
        });

        // Update nav buttons
        const prevBtn = document.querySelector('.wrapped-nav-prev');
        const nextBtn = document.querySelector('.wrapped-nav-next');
        if (prevBtn) prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
        if (nextBtn) nextBtn.textContent = index === this.slides.length - 1 ? '\u2715' : '\u276F';

        // Animate items
        container.querySelectorAll('.wrapped-list-item').forEach((item, i) => {
            item.style.animation = `wrappedSlideIn 0.4s ease ${i * 0.1}s both`;
        });
    }

    async renderWrapped(container) {
        if (!container) return;

        await this._collectData();
        this.slides = this._buildSlides();
        this.currentSlide = 0;

        container.innerHTML = `
            <div class="wrapped-container">
                <div class="wrapped-header">
                    <h2 class="wrapped-page-title">Wrapped ${this.data.year}</h2>
                    <p class="wrapped-page-desc">Tinjauan musik tahunanmu</p>
                </div>
                <div class="wrapped-card">
                    <div class="wrapped-slides-container"></div>
                    <div class="wrapped-nav">
                        <button class="wrapped-nav-prev" style="visibility:hidden">\u276E</button>
                        <div class="wrapped-dots">
                            ${this.slides.map((_, i) => `<div class="wrapped-dot ${i === 0 ? 'active' : ''}" data-slide="${i}"></div>`).join('')}
                        </div>
                        <button class="wrapped-nav-next">\u276F</button>
                    </div>
                </div>
            </div>
        `;

        // Event listeners
        container.querySelector('.wrapped-nav-prev').addEventListener('click', () => {
            if (this.currentSlide > 0) {
                this.currentSlide--;
                this._renderSlide(this.currentSlide);
            }
        });

        container.querySelector('.wrapped-nav-next').addEventListener('click', () => {
            if (this.currentSlide < this.slides.length - 1) {
                this.currentSlide++;
                this._renderSlide(this.currentSlide);
            }
        });

        container.querySelectorAll('.wrapped-dot').forEach((dot) => {
            dot.addEventListener('click', () => {
                this.currentSlide = parseInt(dot.dataset.slide);
                this._renderSlide(this.currentSlide);
            });
        });

        // Keyboard navigation
        const keyHandler = (e) => {
            if (e.key === 'ArrowRight' && this.currentSlide < this.slides.length - 1) {
                this.currentSlide++;
                this._renderSlide(this.currentSlide);
            } else if (e.key === 'ArrowLeft' && this.currentSlide > 0) {
                this.currentSlide--;
                this._renderSlide(this.currentSlide);
            }
        };
        document.addEventListener('keydown', keyHandler);
        container._wrappedKeyHandler = keyHandler;

        // Share button (delegated)
        container.addEventListener('click', (e) => {
            if (e.target.closest('#wrapped-share-btn')) {
                this._shareWrapped();
            }
        });

        // Render first slide
        this._renderSlide(0);
    }

    async openWrappedModal() {
        await this._collectData();
        this.slides = this._buildSlides();
        this.currentSlide = 0;

        // Remove existing modal if any
        document.getElementById('wrapped-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'wrapped-modal';
        modal.className = 'wrapped-modal-overlay';
        modal.innerHTML = `
            <div class="wrapped-modal-card">
                <button class="wrapped-modal-close" id="wrapped-modal-close">&times;</button>
                <div class="wrapped-slides-container"></div>
                <div class="wrapped-nav">
                    <button class="wrapped-nav-prev" style="visibility:hidden">\u276E</button>
                    <div class="wrapped-dots">
                        ${this.slides.map((_, i) => `<div class="wrapped-dot ${i === 0 ? 'active' : ''}" data-slide="${i}"></div>`).join('')}
                    </div>
                    <button class="wrapped-nav-next">\u276F</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Events
        modal.querySelector('#wrapped-modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('.wrapped-nav-prev').addEventListener('click', () => {
            if (this.currentSlide > 0) {
                this.currentSlide--;
                this._renderSlide(this.currentSlide);
            }
        });

        modal.querySelector('.wrapped-nav-next').addEventListener('click', () => {
            if (this.currentSlide < this.slides.length - 1) {
                this.currentSlide++;
                this._renderSlide(this.currentSlide);
            } else {
                modal.remove();
            }
        });

        modal.querySelectorAll('.wrapped-dot').forEach((dot) => {
            dot.addEventListener('click', () => {
                this.currentSlide = parseInt(dot.dataset.slide);
                this._renderSlide(this.currentSlide);
            });
        });

        // Keyboard navigation
        const keyHandler = (e) => {
            if (e.key === 'Escape') modal.remove();
            if (e.key === 'ArrowRight' && this.currentSlide < this.slides.length - 1) {
                this.currentSlide++;
                this._renderSlide(this.currentSlide);
            } else if (e.key === 'ArrowLeft' && this.currentSlide > 0) {
                this.currentSlide--;
                this._renderSlide(this.currentSlide);
            }
        };
        document.addEventListener('keydown', keyHandler);
        modal.addEventListener('remove', () => document.removeEventListener('keydown', keyHandler));

        // Share button
        modal.addEventListener('click', (e) => {
            if (e.target.closest('#wrapped-share-btn')) {
                this._shareWrapped();
            }
        });

        // Render first slide
        this._renderSlide(0);
    }

    _shareWrapped() {
        const d = this.data;
        if (!d) return;

        const text =
            `\u{1F3B5} My ${d.year} Aether Music Wrapped\n\n` +
            `\u23F0 ${d.totalMinutes.toLocaleString()} minutes listened\n` +
            `\u{1F3B6} ${d.totalPlays} tracks played\n` +
            `\u{1F3B8} ${d.uniqueArtists} unique artists\n\n` +
            `Top Artist: ${d.topArtists[0]?.name || '-'}\n` +
            `Top Track: ${d.topTracks[0]?.title || '-'}\n\n` +
            `Listening Type: ${d.personality.icon} ${d.personality.badge}\n\n` +
            `#AetherMusic #Wrapped${d.year}`;

        if (navigator.share) {
            navigator.share({ title: `My ${d.year} Wrapped`, text }).catch(() => {
                this._copyToClipboard(text);
            });
        } else {
            this._copyToClipboard(text);
        }
    }

    _copyToClipboard(text) {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                const btn = document.getElementById('wrapped-share-btn');
                if (btn) {
                    const original = btn.innerHTML;
                    btn.innerHTML = '\u2713 Tersalin!';
                    setTimeout(() => {
                        btn.innerHTML = original;
                    }, 2000);
                }
            })
            .catch(() => {
                alert('Gagal menyalin ke clipboard');
            });
    }
}
