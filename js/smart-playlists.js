// js/smart-playlists.js
// Smart Playlists - Auto-generated playlists based on listening history and favorites

import { db } from './db.js';

/**
 * SmartPlaylistManager - Mengelola playlist cerdas otomatis
 * 
 * Playlist yang tersedia:
 * - Most Played: Lagu yang paling sering didengar
 * - Recently Added: Lagu favorit yang baru ditambahkan
 * - Hidden Gems: Lagu favorit yang belum pernah diputar
 * - Top This Week: Lagu yang banyak diputar minggu ini
 * - Forgotten Favorites: Lagu favorit yang lama tidak diputar
 */
export class SmartPlaylistManager {
  constructor() {
    this.CACHE_KEY = 'smart-playlists-cache';
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Get all smart playlists
   */
  async getAll() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTime) < this.CACHE_TTL) {
      return this._cache;
    }

    try {
      const [history, favoriteTracks] = await Promise.all([
        db.getHistory(),
        db.getFavorites('track'),
      ]);

      const playlists = [
        this._buildMostPlayed(history),
        this._buildTopThisWeek(history),
        this._buildRecentlyAdded(favoriteTracks),
        this._buildHiddenGems(history, favoriteTracks),
        this._buildForgottenFavorites(history, favoriteTracks),
      ];

      this._cache = playlists;
      this._cacheTime = now;
      return playlists;
    } catch (err) {
      console.error('[SmartPlaylists] Error generating playlists:', err);
      return [];
    }
  }

  /**
   * Get a specific smart playlist by ID
   */
  async getById(id) {
    const all = await this.getAll();
    return all.find(p => p.id === id) || null;
  }

  /**
   * Invalidate cache so playlists are regenerated
   */
  invalidateCache() {
    this._cache = null;
    this._cacheTime = 0;
  }

  // ==========================================
  // PLAYLIST BUILDERS
  // ==========================================

  /**
   * Most Played: Top 50 most frequently played tracks
   */
  _buildMostPlayed(history) {
    const counts = {};
    const trackData = {};

    for (const entry of history) {
      const id = entry.id;
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
      if (!trackData[id]) trackData[id] = entry;
    }

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([id]) => trackData[id])
      .filter(Boolean);

    return {
      id: 'smart-most-played',
      name: 'Most Played',
      description: `Your ${sorted.length} most frequently played tracks`,
      icon: '🔥',
      type: 'smart',
      tracks: sorted,
      numberOfTracks: sorted.length,
      cover: sorted[0]?.album?.cover || null,
      images: sorted.slice(0, 4).map(t => t.album?.cover).filter(Boolean),
      isSmartPlaylist: true,
    };
  }

  /**
   * Top This Week: Most played tracks in the last 7 days
   */
  _buildTopThisWeek(history) {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentHistory = history.filter(e => e.timestamp > oneWeekAgo);

    const counts = {};
    const trackData = {};

    for (const entry of recentHistory) {
      const id = entry.id;
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
      if (!trackData[id]) trackData[id] = entry;
    }

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([id]) => trackData[id])
      .filter(Boolean);

    return {
      id: 'smart-top-this-week',
      name: 'Top This Week',
      description: `Your ${sorted.length} most played tracks this week`,
      icon: '📈',
      type: 'smart',
      tracks: sorted,
      numberOfTracks: sorted.length,
      cover: sorted[0]?.album?.cover || null,
      images: sorted.slice(0, 4).map(t => t.album?.cover).filter(Boolean),
      isSmartPlaylist: true,
    };
  }

  /**
   * Recently Added: Tracks added to favorites in the last 30 days
   */
  _buildRecentlyAdded(favoriteTracks) {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = favoriteTracks
      .filter(t => (t.addedAt || 0) > thirtyDaysAgo)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .slice(0, 50);

    return {
      id: 'smart-recently-added',
      name: 'Recently Added',
      description: `${recent.length} tracks added to your library in the last 30 days`,
      icon: '✨',
      type: 'smart',
      tracks: recent,
      numberOfTracks: recent.length,
      cover: recent[0]?.album?.cover || null,
      images: recent.slice(0, 4).map(t => t.album?.cover).filter(Boolean),
      isSmartPlaylist: true,
    };
  }

  /**
   * Hidden Gems: Liked tracks that have never been played
   */
  _buildHiddenGems(history, favoriteTracks) {
    const playedIds = new Set(history.map(e => e.id).filter(Boolean));
    const unplayed = favoriteTracks
      .filter(t => t.id && !playedIds.has(t.id))
      .slice(0, 50);

    return {
      id: 'smart-hidden-gems',
      name: 'Hidden Gems',
      description: `${unplayed.length} liked tracks you haven't played yet`,
      icon: '💎',
      type: 'smart',
      tracks: unplayed,
      numberOfTracks: unplayed.length,
      cover: unplayed[0]?.album?.cover || null,
      images: unplayed.slice(0, 4).map(t => t.album?.cover).filter(Boolean),
      isSmartPlaylist: true,
    };
  }

  /**
   * Forgotten Favorites: Liked tracks not played in the last 90 days
   */
  _buildForgottenFavorites(history, favoriteTracks) {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    // Build map of last played time per track
    const lastPlayed = {};
    for (const entry of history) {
      const id = entry.id;
      if (!id) continue;
      if (!lastPlayed[id] || entry.timestamp > lastPlayed[id]) {
        lastPlayed[id] = entry.timestamp;
      }
    }

    const forgotten = favoriteTracks
      .filter(t => {
        if (!t.id) return false;
        const lp = lastPlayed[t.id];
        // Include if never played OR not played in 90 days
        return !lp || lp < ninetyDaysAgo;
      })
      .slice(0, 50);

    return {
      id: 'smart-forgotten-favorites',
      name: 'Forgotten Favorites',
      description: `${forgotten.length} liked tracks you haven't listened to in a while`,
      icon: '💫',
      type: 'smart',
      tracks: forgotten,
      numberOfTracks: forgotten.length,
      cover: forgotten[0]?.album?.cover || null,
      images: forgotten.slice(0, 4).map(t => t.album?.cover).filter(Boolean),
      isSmartPlaylist: true,
    };
  }
}

export const smartPlaylistManager = new SmartPlaylistManager();

/**
 * Render smart playlists section in the library page
 * Call this after the regular playlists have been rendered
 */
export async function renderSmartPlaylists(container, onPlaylistClick) {
  if (!container) return;

  try {
    const playlists = await smartPlaylistManager.getAll();

    // Filter out empty playlists
    const nonEmpty = playlists.filter(p => p.numberOfTracks > 0);
    if (nonEmpty.length === 0) return;

    // Create section heading
    const section = document.createElement('div');
    section.className = 'smart-playlists-section';
    section.innerHTML = `
      <h2 class="section-title" style="margin-top: 2rem; margin-bottom: 1rem;">Smart Playlists</h2>
      <p style="color: var(--muted); font-size: 0.85rem; margin-bottom: 1rem;">Auto-generated playlists based on your listening habits</p>
      <div class="smart-playlists-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem;">
      </div>
    `;

    const grid = section.querySelector('.smart-playlists-grid');

    for (const playlist of nonEmpty) {
      const card = _createSmartPlaylistCard(playlist);
      card.addEventListener('click', () => {
        if (onPlaylistClick) onPlaylistClick(playlist);
      });
      grid.appendChild(card);
    }

    container.appendChild(section);
  } catch (err) {
    console.error('[SmartPlaylists] Error rendering:', err);
  }
}

/**
 * Create a card element for a smart playlist
 */
function _createSmartPlaylistCard(playlist) {
  const card = document.createElement('div');
  card.className = 'album-card smart-playlist-card';
  card.style.cursor = 'pointer';
  card.dataset.smartPlaylistId = playlist.id;

  const coverHtml = _buildCoverHtml(playlist);

  card.innerHTML = `
    <div class="album-cover-container" style="position: relative; border-radius: 8px; overflow: hidden;">
      ${coverHtml}
      <div class="smart-playlist-badge" style="
        position: absolute; top: 8px; right: 8px;
        background: rgba(0,0,0,0.7);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 0.7rem;
        color: white;
      ">AUTO</div>
    </div>
    <div class="album-info" style="margin-top: 0.5rem;">
      <div class="album-title" style="font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${playlist.icon} ${playlist.name}
      </div>
      <div class="album-artist" style="color: var(--muted); font-size: 0.8rem;">${playlist.numberOfTracks} tracks</div>
    </div>
  `;

  return card;
}

/**
 * Build cover HTML for a smart playlist - uses collage if multiple images
 */
function _buildCoverHtml(playlist) {
  const images = playlist.images?.filter(Boolean) || [];

  if (images.length >= 4) {
    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; width: 100%; aspect-ratio: 1;">
        ${images.slice(0, 4).map(img => `<img src="${img}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="this.style.background='var(--card)';this.removeAttribute('src')">`).join('')}
      </div>
    `;
  }

  if (images.length > 0) {
    return `<img src="${images[0]}" style="width: 100%; aspect-ratio: 1; object-fit: cover;" loading="lazy" onerror="this.style.background='var(--card)'; this.removeAttribute('src')">`;
  }

  return `
    <div style="
      width: 100%; aspect-ratio: 1;
      background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 3rem;
    ">${playlist.icon}</div>
  `;
}
