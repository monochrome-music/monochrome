// js/release-radar.js
// Release Radar - tracks followed artists and notifies about new releases
// Uses MusicBrainz API for release data

export class ReleaseRadar {
  constructor(musicAPI) {
    this._musicAPI = musicAPI;
    this._followedArtists = this._loadFollowedArtists();
    this._seenReleases = this._loadSeenReleases();
    this._container = null;
    this._releases = [];
  }

  /**
   * Render Release Radar page into container
   */
  async renderPage(container) {
    this._container = container;
    container.innerHTML = `
      <div class="release-radar-page">
        <h1 class="page-title">Release Radar</h1>
        <p class="page-subtitle">New music from artists you follow</p>

        <div class="radar-controls">
          <button class="btn-primary radar-refresh-btn">
            <span>Refresh</span>
          </button>
          <span class="radar-last-updated"></span>
        </div>

        <div class="radar-follow-section">
          <h3>Follow an Artist</h3>
          <div class="radar-follow-input-row">
            <input type="text" class="radar-artist-input" placeholder="Artist name..." />
            <button class="btn-secondary radar-follow-btn">Follow</button>
          </div>
        </div>

        <div class="radar-followed-section">
          <h3>Followed Artists (<span class="radar-followed-count">${this._followedArtists.length}</span>)</h3>
          <div class="radar-followed-list">
            ${this._renderFollowedArtists()}
          </div>
        </div>

        <div class="radar-releases-section">
          <h3>Recent Releases</h3>
          <div class="radar-loading" style="display:none">Checking for new releases...</div>
          <div class="radar-releases-list">
            <p class="radar-empty">Follow artists to see their latest releases here.</p>
          </div>
        </div>
      </div>
    `;

    this._attachEvents(container);
    if (this._followedArtists.length > 0) {
      await this._fetchReleases(container);
    }
  }

  _attachEvents(container) {
    container.querySelector('.radar-refresh-btn')?.addEventListener('click', async () => {
      await this._fetchReleases(container);
    });

    container.querySelector('.radar-follow-btn')?.addEventListener('click', () => {
      const input = container.querySelector('.radar-artist-input');
      const name = input?.value?.trim();
      if (name) {
        this._followArtist(name, container);
        input.value = '';
      }
    });

    container.querySelector('.radar-artist-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') container.querySelector('.radar-follow-btn')?.click();
    });
  }

  _renderFollowedArtists() {
    if (!this._followedArtists.length) {
      return '<p class="radar-empty">No followed artists yet.</p>';
    }
    return this._followedArtists.map(artist => `
      <div class="radar-artist-chip" data-artist="${artist}">
        <span>${artist}</span>
        <button class="radar-unfollow-btn" data-artist="${artist}" title="Unfollow">×</button>
      </div>
    `).join('');
  }

  _followArtist(name, container) {
    if (this._followedArtists.includes(name)) return;
    this._followedArtists.push(name);
    this._saveFollowedArtists();
    this._updateFollowedUI(container);
  }

  _unfollowArtist(name, container) {
    this._followedArtists = this._followedArtists.filter(a => a !== name);
    this._saveFollowedArtists();
    this._updateFollowedUI(container);
  }

  _updateFollowedUI(container) {
    const listEl = container.querySelector('.radar-followed-list');
    const countEl = container.querySelector('.radar-followed-count');
    if (listEl) {
      listEl.innerHTML = this._renderFollowedArtists();
      listEl.querySelectorAll('.radar-unfollow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._unfollowArtist(btn.dataset.artist, container);
        });
      });
    }
    if (countEl) countEl.textContent = this._followedArtists.length;
  }

  async _fetchReleases(container) {
    if (!this._followedArtists.length) return;
    const loadingEl = container.querySelector('.radar-loading');
    const listEl = container.querySelector('.radar-releases-list');
    const lastUpdatedEl = container.querySelector('.radar-last-updated');

    if (loadingEl) loadingEl.style.display = 'block';
    if (listEl) listEl.innerHTML = '';

    const allReleases = [];

    for (const artist of this._followedArtists) {
      try {
        const releases = await this._fetchArtistReleases(artist);
        allReleases.push(...releases);
      } catch (e) {
        console.warn('[ReleaseRadar] Failed to fetch releases for:', artist, e);
      }
    }

    // Sort by date (newest first)
    allReleases.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    this._releases = allReleases;

    if (loadingEl) loadingEl.style.display = 'none';
    this._renderReleases(container, allReleases);

    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    }
  }

  async _fetchArtistReleases(artistName) {
    try {
      // Use MusicBrainz API to find artist and their recent releases
      const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`;
      const artistRes = await fetch(searchUrl);
      if (!artistRes.ok) return [];
      const artistData = await artistRes.json();
      const artist = artistData.artists?.[0];
      if (!artist) return [];

      const releasesUrl = `https://musicbrainz.org/ws/2/release-group/?artist=${artist.id}&type=album|single|ep&fmt=json&limit=5`;
      const releasesRes = await fetch(releasesUrl);
      if (!releasesRes.ok) return [];
      const releasesData = await releasesRes.json();

      return (releasesData['release-groups'] || []).map(rg => ({
        id: rg.id,
        title: rg.title,
        artist: artistName,
        type: rg['primary-type'] || 'Release',
        date: rg['first-release-date'] || '',
        isNew: !this._seenReleases.has(rg.id),
      }));
    } catch (e) {
      return [];
    }
  }

  _renderReleases(container, releases) {
    const listEl = container.querySelector('.radar-releases-list');
    if (!listEl) return;

    if (!releases.length) {
      listEl.innerHTML = '<p class="radar-empty">No recent releases found.</p>';
      return;
    }

    listEl.innerHTML = releases.map(r => `
      <div class="radar-release-card ${r.isNew ? 'radar-new' : ''}">
        ${r.isNew ? '<span class="radar-new-badge">NEW</span>' : ''}
        <div class="radar-release-info">
          <div class="radar-release-title">${r.title}</div>
          <div class="radar-release-artist">${r.artist}</div>
          <div class="radar-release-meta">${r.type} · ${r.date || 'Unknown date'}</div>
        </div>
        <button class="radar-listen-btn" data-artist="${r.artist}" data-title="${r.title}">Listen</button>
      </div>
    `).join('');

    // Mark releases as seen
    releases.forEach(r => this._seenReleases.add(r.id));
    this._saveSeenReleases();

    listEl.querySelectorAll('.radar-listen-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (this._musicAPI) {
          try {
            const results = await this._musicAPI.search(`${btn.dataset.title} ${btn.dataset.artist}`);
            if (results?.tracks?.length) {
              console.log('[ReleaseRadar] Found tracks for release:', results.tracks[0]);
            }
          } catch (e) {
            console.warn('[ReleaseRadar] Search failed:', e);
          }
        }
      });
    });
  }

  _loadFollowedArtists() {
    try {
      return JSON.parse(localStorage.getItem('release-radar-artists') || '[]');
    } catch (e) {
      return [];
    }
  }

  _saveFollowedArtists() {
    try {
      localStorage.setItem('release-radar-artists', JSON.stringify(this._followedArtists));
    } catch (e) {}
  }

  _loadSeenReleases() {
    try {
      const data = JSON.parse(localStorage.getItem('release-radar-seen') || '[]');
      return new Set(data);
    } catch (e) {
      return new Set();
    }
  }

  _saveSeenReleases() {
    try {
      localStorage.setItem('release-radar-seen', JSON.stringify([...this._seenReleases]));
    } catch (e) {}
  }

  /**
   * Check for new releases and return count of new ones
   */
  async getNewReleasesCount() {
    let count = 0;
    for (const artist of this._followedArtists) {
      try {
        const releases = await this._fetchArtistReleases(artist);
        count += releases.filter(r => r.isNew).length;
      } catch (e) {}
    }
    return count;
  }
}
