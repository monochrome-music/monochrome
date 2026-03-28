// js/duplicate-detector.js
import { db } from './db.js';

/**
 * DuplicateTrackDetector - Identifies and manages duplicate tracks
 */
export class DuplicateTrackDetector {
  /**
   * Finds duplicates based on title and artist
   */
  async findDuplicates() {
    const allTracks = await db.tracks.toArray();
    const map = new Map();
    const duplicates = [];

    allTracks.forEach(track => {
      const key = \`\${track.title?.toLowerCase()}|\${track.artist?.toLowerCase()}\`;
      if (map.has(key)) {
        duplicates.push({
          original: map.get(key),
          duplicate: track
        });
      } else {
        map.set(key, track);
      }
    });

    return duplicates;
  }

  /**
   * Removes selected duplicates
   */
  async removeDuplicates(trackIds) {
    if (!trackIds || trackIds.length === 0) return;
    await db.tracks.bulkDelete(trackIds);
    console.log(\`Removed \${trackIds.length} duplicate tracks\`);
  }

  /**
   * UI for duplicate management
   */
  renderDuplicateUI(duplicates) {
    if (duplicates.length === 0) return '<p>No duplicates found!</p>';

    return \`
      <div class="duplicate-list" style="padding: 1rem; background: var(--bg-secondary); border-radius: 8px;">
        <h3>Duplicate Tracks Found (\${duplicates.length})</h3>
        <ul style="list-style: none; padding: 0;">
          \${duplicates.map(d => \\\`
            <li style="display: flex; justify-content: space-between; padding: 0.5rem; border-bottom: 1px solid var(--border);">
              <span>\\\${d.duplicate.title} - \\\${d.duplicate.artist}</span>
              <button onclick="window.removeTrack(\\\${d.duplicate.id})" style="color: var(--error); background: none; border: none; cursor: pointer;">Remove</button>
            </li>
          \\\`).join('')}
        </ul>
      </div>
    \`;
  }
}
