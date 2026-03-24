// js/social-profile.js
// Social Music Profile - shareable profile with listening stats, top tracks/artists
// Public profile page accessible at /user/@username

export class SocialProfile {
  constructor(syncManager) {
    this._syncManager = syncManager;
    this._container = null;
    this._profileData = null;
  }

  /**
   * Render the social profile page into container
   * @param {HTMLElement} container
   * @param {object} profileData - user profile data from Appwrite
   */
  renderPage(container, profileData) {
    this._container = container;
    this._profileData = profileData;

    if (!profileData) {
      container.innerHTML = `
        <div class="social-profile-page">
          <div class="profile-not-found">
            <h2>Profile not found</h2>
            <p>This user doesn't have a public profile yet.</p>
          </div>
        </div>
      `;
      return;
    }

    const stats = profileData.stats || {};
    const topTracks = profileData.topTracks || [];
    const topArtists = profileData.topArtists || [];
    const recentTracks = profileData.recentTracks || [];
    const badges = this._computeBadges(stats);

    container.innerHTML = `
      <div class="social-profile-page">
        <div class="profile-header">
          <div class="profile-avatar">
            ${profileData.avatarUrl
              ? `<img src="${profileData.avatarUrl}" alt="${profileData.displayName}" class="profile-avatar-img" />`
              : `<div class="profile-avatar-placeholder">${(profileData.displayName || 'U')[0].toUpperCase()}</div>`
            }
          </div>
          <div class="profile-info">
            <h1 class="profile-display-name">${profileData.displayName || 'Unknown User'}</h1>
            <p class="profile-username">@${profileData.username || 'unknown'}</p>
            ${profileData.bio ? `<p class="profile-bio">${profileData.bio}</p>` : ''}
            <div class="profile-meta">
              <span class="profile-joined">Joined ${this._formatDate(profileData.joinedAt)}</span>
            </div>
          </div>
          <div class="profile-share">
            <button class="btn-secondary profile-share-btn" title="Share Profile">
              Share Profile
            </button>
          </div>
        </div>

        <div class="profile-stats-row">
          <div class="profile-stat">
            <div class="profile-stat-value">${stats.totalPlays || 0}</div>
            <div class="profile-stat-label">Total Plays</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${stats.uniqueArtists || 0}</div>
            <div class="profile-stat-label">Artists</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${stats.listeningHours || 0}h</div>
            <div class="profile-stat-label">Listening Time</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${stats.streak || 0}</div>
            <div class="profile-stat-label">Day Streak</div>
          </div>
        </div>

        ${badges.length > 0 ? `
          <div class="profile-badges-section">
            <h3>Badges</h3>
            <div class="profile-badges">
              ${badges.map(b => `
                <div class="profile-badge" title="${b.description}">
                  <span class="profile-badge-icon">${b.icon}</span>
                  <span class="profile-badge-name">${b.name}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="profile-content-grid">
          ${topTracks.length > 0 ? `
            <div class="profile-section">
              <h3>Top Tracks</h3>
              <div class="profile-track-list">
                ${topTracks.slice(0, 5).map((t, i) => `
                  <div class="profile-track-item">
                    <span class="profile-track-rank">${i + 1}</span>
                    <div class="profile-track-info">
                      <div class="profile-track-title">${t.title || 'Unknown'}</div>
                      <div class="profile-track-artist">${t.artist || 'Unknown'}</div>
                    </div>
                    <span class="profile-track-plays">${t.plays || 0} plays</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${topArtists.length > 0 ? `
            <div class="profile-section">
              <h3>Top Artists</h3>
              <div class="profile-artist-list">
                ${topArtists.slice(0, 5).map((a, i) => `
                  <div class="profile-artist-item">
                    <span class="profile-artist-rank">${i + 1}</span>
                    <div class="profile-artist-info">
                      <div class="profile-artist-name">${a.name || 'Unknown'}</div>
                    </div>
                    <span class="profile-artist-plays">${a.plays || 0} plays</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        ${recentTracks.length > 0 ? `
          <div class="profile-section profile-recent">
            <h3>Recently Played</h3>
            <div class="profile-recent-list">
              ${recentTracks.slice(0, 10).map(t => `
                <div class="profile-recent-item">
                  <div class="profile-recent-info">
                    <div class="profile-recent-title">${t.title || 'Unknown'}</div>
                    <div class="profile-recent-artist">${t.artist || 'Unknown'}</div>
                  </div>
                  <span class="profile-recent-time">${this._formatRelativeTime(t.playedAt)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    this._attachEvents(container, profileData);
  }

  _attachEvents(container, profileData) {
    container.querySelector('.profile-share-btn')?.addEventListener('click', () => {
      const url = `${window.location.origin}/user/@${profileData.username}`;
      if (navigator.share) {
        navigator.share({
          title: `${profileData.displayName}'s Music Profile`,
          url,
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(url).then(() => {
          const btn = container.querySelector('.profile-share-btn');
          if (btn) {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share Profile'; }, 2000);
          }
        });
      }
    });
  }

  _computeBadges(stats) {
    const badges = [];
    if ((stats.totalPlays || 0) >= 1000) badges.push({ icon: '🏆', name: 'Music Addict', description: '1000+ plays' });
    if ((stats.streak || 0) >= 7) badges.push({ icon: '🔥', name: '7-Day Streak', description: 'Listened 7 days in a row' });
    if ((stats.uniqueArtists || 0) >= 50) badges.push({ icon: '🌍', name: 'Explorer', description: 'Listened to 50+ artists' });
    if ((stats.listeningHours || 0) >= 100) badges.push({ icon: '⏱️', name: 'Century', description: '100+ hours of listening' });
    if ((stats.streak || 0) >= 30) badges.push({ icon: '⭐', name: 'Dedicated', description: '30-day listening streak' });
    return badges;
  }

  _formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    } catch (e) {
      return dateStr;
    }
  }

  _formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch (e) {
      return '';
    }
  }

  /**
   * Build profile data from local listening stats for sharing
   */
  async buildProfileData(username, displayName, bio, avatarUrl) {
    let stats = { totalPlays: 0, uniqueArtists: 0, listeningHours: 0, streak: 0 };
    let topTracks = [];
    let topArtists = [];
    let recentTracks = [];

    try {
      // Try to get stats from PlaybackStats if available
      if (window.monochromePlaybackStats) {
        const ps = window.monochromePlaybackStats;
        stats = await ps.getStats?.() || stats;
        topTracks = await ps.getTopTracks?.(5) || [];
        topArtists = await ps.getTopArtists?.(5) || [];
        recentTracks = await ps.getRecentTracks?.(10) || [];
      }
    } catch (e) {
      console.warn('[SocialProfile] Could not load stats:', e);
    }

    return {
      username,
      displayName,
      bio,
      avatarUrl,
      joinedAt: new Date().toISOString(),
      stats,
      topTracks,
      topArtists,
      recentTracks,
    };
  }
}
