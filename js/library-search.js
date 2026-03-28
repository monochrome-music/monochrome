// js/library-search.js
import { db } from './db.js';

/**
 * LibrarySearchManager - Advanced search and filtering for the music library
 */
export class LibrarySearchManager {
  constructor() {
    this.searchQuery = '';
    this.filters = {
      genre: null,
      year: null,
      mood: null,
      bitrate: null
    };
    this.sortConfig = {
      key: 'title',
      order: 'asc'
    };
  }

  /**
   * Performs an advanced search across tracks
   */
  async search(query, options = {}) {
    this.searchQuery = query.toLowerCase();
    const allTracks = await db.tracks.toArray();
    
    return allTracks.filter(track => {
      const matchesQuery = !query || 
        track.title?.toLowerCase().includes(this.searchQuery) ||
        track.artist?.toLowerCase().includes(this.searchQuery) ||
        track.album?.toLowerCase().includes(this.searchQuery);

      if (!matchesQuery) return false;

      // Apply filters
      if (options.genre && track.genre !== options.genre) return false;
      if (options.year && track.year !== options.year) return false;
      if (options.minBitrate && (track.bitrate || 0) < options.minBitrate) return false;

      return true;
    }).sort((a, b) => {
      const valA = (a[this.sortConfig.key] || '').toString().toLowerCase();
      const valB = (b[this.sortConfig.key] || '').toString().toLowerCase();
      
      if (this.sortConfig.order === 'asc') {
        return valA.localeCompare(valB);
      } else {
        return valB.localeCompare(valA);
      }
    });
  }

  /**
   * UI components for search and filter
   */
  renderSearchUI() {
    return `
      <div class="advanced-search-container" style="padding: 1rem; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 1rem;">
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
          <input type="text" id="lib-search-input" placeholder="Search title, artist, album..." 
            style="flex: 1; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text);">
          <button id="lib-search-btn" style="padding: 0.5rem 1rem; background: var(--primary); border: none; border-radius: 4px; color: white; cursor: pointer;">Search</button>
        </div>
        <div class="filters-row" style="display: flex; gap: 1rem; font-size: 0.85rem; color: var(--text-muted);">
          <select id="filter-genre"><option value="">All Genres</option></select>
          <select id="filter-year"><option value="">All Years</option></select>
          <select id="sort-by">
            <option value="title">Sort by Title</option>
            <option value="artist">Sort by Artist</option>
            <option value="dateAdded">Sort by Date Added</option>
          </select>
        </div>
      </div>
    `;
  }
}
