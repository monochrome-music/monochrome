// js/bulk-editor.js
import { db } from './db.js';

/**
 * BulkTrackEditor - Batch editing for track metadata
 */
export class BulkTrackEditor {
  constructor() {
    this.selectedTrackIds = new Set();
  }

  toggleSelection(trackId) {
    if (this.selectedTrackIds.has(trackId)) {
      this.selectedTrackIds.delete(trackId);
    } else {
      this.selectedTrackIds.add(trackId);
    }
  }

  selectAll(trackIds) {
    trackIds.forEach(id => this.selectedTrackIds.add(id));
  }

  clearSelection() {
    this.selectedTrackIds.clear();
  }

  /**
   * Updates multiple tracks at once
   */
  async updateSelectedTracks(metadata) {
    const ids = Array.from(this.selectedTrackIds);
    if (ids.length === 0) return;

    const updates = ids.map(id => {
      return db.tracks.update(id, metadata);
    });

    await Promise.all(updates);
    console.log(`Updated ${ids.length} tracks with:`, metadata);
    this.clearSelection();
  }

  /**
   * Renders the bulk edit toolbar
   */
  renderToolbar() {
    return `
      <div id="bulk-edit-toolbar" style="display: none; position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: var(--primary); padding: 0.75rem 1.5rem; border-radius: 50px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 1000; gap: 1rem; align-items: center;">
        <span style="color: white; font-weight: bold;"><span id="bulk-select-count">0</span> selected</span>
        <button id="bulk-edit-btn" style="background: white; color: var(--primary); border: none; padding: 0.4rem 1rem; border-radius: 20px; cursor: pointer; font-weight: bold;">Edit</button>
        <button id="bulk-cancel-btn" style="background: transparent; color: white; border: 1px solid white; padding: 0.4rem 1rem; border-radius: 20px; cursor: pointer;">Cancel</button>
      </div>
    `;
  }
}
