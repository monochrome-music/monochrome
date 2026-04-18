# Add to Playlist Modal Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain text playlist list in the "Add to Playlist" modal with a searchable, sortable 4-column grid with cover art.

**Architecture:** The modal HTML shell in `index.html` gets a new inner structure (header with search+sort, create-new row, grid container, footer). The rendering logic in `js/events.js` is rewritten to build grid cards, wire up real-time search filtering, and sort. A shared helper function `buildPlaylistSelectGrid` avoids duplicating logic between `showAddToPlaylistModal` and `showMultiSelectPlaylistModal`. New CSS classes are appended to `styles.css`.

**Tech Stack:** Vanilla JS (ES modules), Vite, IndexedDB via `db.js`, Lucide SVG icons via `js/icons.ts`, existing CSS custom properties (`--card`, `--border`, `--primary`, etc.)

---

## File Map

| File | Change |
| --- | --- |
| `index.html` | Replace inner HTML of `#playlist-select-modal` (lines 1013–1021) |
| `js/events.js` | Rewrite `showAddToPlaylistModal()` (lines 996–1115); rewrite `add-to-playlist` branch of `handleTrackAction` (lines 1494–1617); rewrite `showMultiSelectPlaylistModal()` (lines 179–251) |
| `styles.css` | Append new CSS classes after line 6398 |

---

## Task 1: Update the modal HTML shell in `index.html`

**Files:**
- Modify: `index.html:1011-1022`

The current `#playlist-select-modal` inner content is a plain `<h3>`, a `#playlist-select-list` div, and a Cancel button. Replace it with a richer structure: a header div (with title, close button, search input, sort select), a create-new row, a grid scroll container, and a footer. The Cancel button is removed — close is handled by the × button and overlay click (same as before).

- [ ] **Step 1: Replace the modal inner HTML**

In `index.html`, find this block (around line 1011):

```html
        <div id="playlist-select-modal" class="modal">
            <div class="modal-overlay"></div>
            <div class="modal-content">
                <h3>Add to Playlist</h3>
                <div id="playlist-select-list" class="modal-list">
                    <!-- Options will be injected here -->
                </div>
                <div class="modal-actions">
                    <button id="playlist-select-cancel" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
```

Replace with:

```html
        <div id="playlist-select-modal" class="modal">
            <div class="modal-overlay"></div>
            <div class="modal-content medium">
                <div class="playlist-select-header">
                    <div class="playlist-select-title-row">
                        <span class="playlist-select-title">Add to playlist</span>
                        <button id="playlist-select-close" class="playlist-select-close">&times;</button>
                    </div>
                    <div class="playlist-select-controls">
                        <div class="playlist-select-search-wrap">
                            <span class="playlist-select-search-icon"></span>
                            <input id="playlist-select-search" class="playlist-select-search" placeholder="Search playlists…" autocomplete="off" />
                        </div>
                        <select id="playlist-select-sort" class="playlist-select-sort">
                            <option value="az">A–Z</option>
                            <option value="za">Z–A</option>
                            <option value="date">Date created</option>
                            <option value="recent">Recently used</option>
                        </select>
                    </div>
                </div>
                <div id="playlist-select-create" class="playlist-select-create">
                    <div class="playlist-select-create-icon">+</div>
                    <span class="playlist-select-create-label">Create new playlist</span>
                </div>
                <div class="playlist-select-scroll">
                    <div id="playlist-select-grid" class="playlist-select-grid">
                        <!-- Cards injected by JS -->
                    </div>
                </div>
                <div id="playlist-select-footer" class="playlist-select-footer"></div>
            </div>
        </div>
```

- [ ] **Step 2: Verify the page still loads without console errors**

Open the app in a browser (run `npm run dev` or the existing dev server). Open DevTools Console. Confirm no errors about missing elements (`playlist-select-cancel` references etc.).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: update add-to-playlist modal HTML structure for grid layout"
```

---

## Task 2: Add CSS for the new modal classes in `styles.css`

**Files:**
- Modify: `styles.css` (append after line 6398, after `.timer-options`)

All class names are new — nothing existing is modified.

- [ ] **Step 1: Append the new CSS block**

Open `styles.css` and after the `.timer-options` block (around line 6398), append:

```css
/* ── Add-to-playlist grid modal ─────────────────────────────── */

.playlist-select-header {
    padding: 0.9rem 0.9rem 0.7rem;
    border-bottom: 1px solid var(--border);
}

.playlist-select-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
}

.playlist-select-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--primary);
}

.playlist-select-close {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--secondary);
    border: none;
    color: var(--secondary-foreground);
    font-size: 1.1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0;
}

.playlist-select-controls {
    display: flex;
    gap: 0.4rem;
    align-items: center;
}

.playlist-select-search-wrap {
    flex: 1;
    position: relative;
}

.playlist-select-search-icon {
    position: absolute;
    left: 0.55rem;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    opacity: 0.4;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-size: contain;
}

.playlist-select-search {
    width: 100%;
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.38rem 0.5rem 0.38rem 1.8rem;
    color: var(--primary);
    font-size: 0.78rem;
    outline: none;
}

.playlist-select-search::placeholder {
    color: var(--muted-foreground, #555);
}

.playlist-select-search:focus {
    border-color: var(--highlight, #444);
}

.playlist-select-sort {
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.38rem 0.55rem;
    color: var(--secondary-foreground);
    font-size: 0.72rem;
    cursor: pointer;
    outline: none;
    white-space: nowrap;
}

.playlist-select-create {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.9rem;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background var(--transition-fast, 0.15s);
}

.playlist-select-create:hover {
    background: var(--secondary);
}

.playlist-select-create-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: var(--secondary);
    border: 1px dashed var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: var(--primary);
    flex-shrink: 0;
}

.playlist-select-create-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--primary);
}

.playlist-select-scroll {
    max-height: 260px;
    overflow-y: auto;
    padding: 0.6rem;
}

.playlist-select-scroll::-webkit-scrollbar {
    width: 3px;
}

.playlist-select-scroll::-webkit-scrollbar-track {
    background: transparent;
}

.playlist-select-scroll::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
}

.playlist-select-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
}

.playlist-select-card {
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    cursor: pointer;
    transition: border-color var(--transition-fast, 0.15s), background var(--transition-fast, 0.15s);
    position: relative;
}

.playlist-select-card:hover {
    border-color: var(--secondary-foreground);
    background: var(--card-hover, #222);
}

.playlist-select-card.already-in {
    opacity: 0.45;
    cursor: default;
}

.playlist-select-card.already-in:hover {
    border-color: var(--border);
    background: var(--secondary);
}

.playlist-select-card-cover {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    display: block;
}

.playlist-select-card-placeholder {
    width: 100%;
    aspect-ratio: 1;
    background: linear-gradient(135deg, var(--secondary), var(--card));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--border);
}

.playlist-select-card-placeholder svg {
    width: 24px;
    height: 24px;
    opacity: 0.4;
}

.playlist-select-card-info {
    padding: 0.3rem 0.35rem 0.35rem;
}

.playlist-select-card-name {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.playlist-select-card-count {
    font-size: 0.62rem;
    color: var(--muted-foreground, #666);
    margin-top: 1px;
}

.playlist-select-badge {
    position: absolute;
    top: 3px;
    right: 3px;
    background: rgba(0, 0, 0, 0.75);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 0.6rem;
    color: var(--secondary-foreground);
    font-weight: 600;
    cursor: pointer;
    line-height: 1.4;
}

.playlist-select-footer {
    padding: 0.5rem 0.9rem;
    border-top: 1px solid var(--border);
    font-size: 0.7rem;
    color: var(--muted-foreground, #555);
    text-align: center;
}
```

- [ ] **Step 2: Verify visually**

Open the app and trigger the "Add to Playlist" modal. The modal should now show with the new header structure and empty grid area (no playlists yet — JS hasn't been updated). It should not look broken.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: add CSS classes for enhanced playlist select grid modal"
```

---

## Task 3: Rewrite `showAddToPlaylistModal()` in `js/events.js`

**Files:**
- Modify: `js/events.js:996-1115`

This is the exported function used by the now-playing bar buttons. Replace the full function body. The new version:
1. Reads playlists once on open
2. Builds a `renderGrid(query, sortKey)` inner function that filters+sorts+renders cards
3. Attaches `input` listener on search and `change` listener on sort select that both call `renderGrid`
4. Delegates click handling to the grid container (event delegation)
5. Badge click on an already-in card removes the track (calls `db.removeTrackFromPlaylist`)
6. Regular card click adds the track and closes modal

Also add `SVG_MUSIC` to the import at the top of the file (line 26).

- [ ] **Step 1: Add `SVG_MUSIC` to the import**

Find line 26 in `js/events.js`:

```js
import { SVG_BIN, SVG_MUTE, SVG_PAUSE, SVG_PLAY, SVG_VOLUME, SVG_CHECKBOX, SVG_CHECKBOX_CHECKED } from './icons.js';
```

Replace with:

```js
import { SVG_BIN, SVG_MUSIC, SVG_MUTE, SVG_PAUSE, SVG_PLAY, SVG_VOLUME, SVG_CHECKBOX, SVG_CHECKBOX_CHECKED } from './icons.js';
```

- [ ] **Step 2: Replace `showAddToPlaylistModal()`**

Find the entire function from line 996 to 1115 (from `export async function showAddToPlaylistModal(track) {` to the closing `}`). Replace with:

```js
export async function showAddToPlaylistModal(track) {
    const modal = document.getElementById('playlist-select-modal');
    const grid = document.getElementById('playlist-select-grid');
    const footer = document.getElementById('playlist-select-footer');
    const closeBtn = document.getElementById('playlist-select-close');
    const searchInput = document.getElementById('playlist-select-search');
    const sortSelect = document.getElementById('playlist-select-sort');
    const createRow = document.getElementById('playlist-select-create');
    const overlay = modal.querySelector('.modal-overlay');

    const playlists = await db.getPlaylists(true);

    const trackId = track.id;
    const playlistsWithTrack = new Set(
        playlists.filter(p => p.tracks && p.tracks.some(t => t.id == trackId)).map(p => p.id)
    );

    const sortFns = {
        az: (a, b) => a.name.localeCompare(b.name),
        za: (a, b) => b.name.localeCompare(a.name),
        date: (a, b) => b.createdAt - a.createdAt,
        recent: (a, b) => b.updatedAt - a.updatedAt,
    };

    const renderGrid = (query = '', sortKey = 'az') => {
        const sorted = [...playlists].sort(sortFns[sortKey] || sortFns.az);
        const filtered = query
            ? sorted.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
            : sorted;

        grid.innerHTML = filtered.map(p => {
            const alreadyIn = playlistsWithTrack.has(p.id);
            const coverSrc = p.cover || (p.images && p.images[0]);
            const coverHtml = coverSrc
                ? `<img class="playlist-select-card-cover" src="${coverSrc}" alt="" loading="lazy">`
                : `<div class="playlist-select-card-placeholder">${SVG_MUSIC(24)}</div>`;
            return `
                <div class="playlist-select-card${alreadyIn ? ' already-in' : ''}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
                    ${coverHtml}
                    <div class="playlist-select-card-info">
                        <div class="playlist-select-card-name">${escapeHtml(p.name)}</div>
                        <div class="playlist-select-card-count">${p.numberOfTracks ?? p.tracks?.length ?? 0} tracks</div>
                    </div>
                    ${alreadyIn ? `<span class="playlist-select-badge" data-remove="${p.id}">✓</span>` : ''}
                </div>
            `;
        }).join('');

        footer.textContent = `${filtered.length} playlist${filtered.length !== 1 ? 's' : ''}${query ? ' · Type to filter' : ' · Type to filter'}`;
    };

    // Reset state on open
    searchInput.value = '';
    sortSelect.value = 'az';
    renderGrid();

    const closeModal = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const handleGridClick = async (e) => {
        const badge = e.target.closest('.playlist-select-badge');
        const card = e.target.closest('.playlist-select-card');

        if (badge) {
            e.stopPropagation();
            const playlistId = badge.dataset.remove;
            const playlist = playlists.find(p => p.id === playlistId);
            await db.removeTrackFromPlaylist(playlistId, track.id);
            const updated = await db.getPlaylist(playlistId);
            await syncManager.syncUserPlaylist(updated, 'update');
            playlistsWithTrack.delete(playlistId);
            renderGrid(searchInput.value, sortSelect.value);
            showNotification(`Removed from playlist: ${playlist?.name ?? ''}`);
            return;
        }

        if (!card || card.classList.contains('already-in')) return;

        const playlistId = card.dataset.id;
        const playlistName = card.dataset.name;
        await db.addTrackToPlaylist(playlistId, track);
        const updated = await db.getPlaylist(playlistId);
        await syncManager.syncUserPlaylist(updated, 'update');
        showNotification(`Added to playlist: ${playlistName}`);
        closeModal();
    };

    const handleSearch = () => renderGrid(searchInput.value, sortSelect.value);
    const handleSort = () => renderGrid(searchInput.value, sortSelect.value);

    const handleCreateClick = () => {
        closeModal();
        const createModal = document.getElementById('playlist-modal');
        document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
        document.getElementById('playlist-name-input').value = '';
        document.getElementById('playlist-cover-input').value = '';
        document.getElementById('playlist-cover-file-input').value = '';
        document.getElementById('playlist-description-input').value = '';
        createModal.dataset.editingId = '';
        document.getElementById('import-section').style.display = 'none';

        const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
        const coverUrlInput = document.getElementById('playlist-cover-input');
        const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
        if (coverUploadBtn) { coverUploadBtn.style.flex = '1'; coverUploadBtn.style.display = 'flex'; }
        if (coverUrlInput) coverUrlInput.style.display = 'none';
        if (coverToggleUrlBtn) { coverToggleUrlBtn.textContent = 'or URL'; coverToggleUrlBtn.title = 'Switch to URL input'; }

        createModal._pendingTracks = [track];
        createModal.classList.add('active');
        document.getElementById('playlist-name-input').focus();
    };

    const cleanup = () => {
        closeBtn.removeEventListener('click', closeModal);
        overlay.removeEventListener('click', closeModal);
        grid.removeEventListener('click', handleGridClick);
        searchInput.removeEventListener('input', handleSearch);
        sortSelect.removeEventListener('change', handleSort);
        createRow.removeEventListener('click', handleCreateClick);
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    grid.addEventListener('click', handleGridClick);
    searchInput.addEventListener('input', handleSearch);
    sortSelect.addEventListener('change', handleSort);
    createRow.addEventListener('click', handleCreateClick);

    modal.classList.add('active');
    searchInput.focus();
}
```

- [ ] **Step 3: Verify the modal works end-to-end**

Open the app. Play a track. Click "Add to Playlist" (now-playing bar). Confirm:
- Grid renders with 4-column layout
- Typing in search filters playlists in real-time
- Changing sort reorders playlists
- Clicking a card adds the track and closes the modal with a notification
- Clicking ✓ badge removes the track and updates the grid without closing
- Clicking + Create new playlist opens the create playlist modal

- [ ] **Step 4: Commit**

```bash
git add js/events.js
git commit -m "feat: rewrite showAddToPlaylistModal with grid, search, and sort"
```

---

## Task 4: Update the `add-to-playlist` branch of `handleTrackAction` in `js/events.js`

**Files:**
- Modify: `js/events.js:1494-1617`

`handleTrackAction` has its own inline copy of the same modal logic. Now that `showAddToPlaylistModal` is rewritten to work with the new HTML structure, this branch can simply delegate to it.

- [ ] **Step 1: Replace the inline `add-to-playlist` branch**

Find this block starting at line ~1494:

```js
    } else if (action === 'add-to-playlist') {
        const modal = document.getElementById('playlist-select-modal');
        const list = document.getElementById('playlist-select-list');
        const cancelBtn = document.getElementById('playlist-select-cancel');
        const overlay = modal.querySelector('.modal-overlay');
        // ... (the entire block through to line ~1617)
        modal.classList.add('active');
    } else if (action === 'go-to-artist') {
```

Replace just the `add-to-playlist` branch (from `} else if (action === 'add-to-playlist') {` up to but not including `} else if (action === 'go-to-artist') {`) with:

```js
    } else if (action === 'add-to-playlist') {
        await showAddToPlaylistModal(item);
```

- [ ] **Step 2: Verify via the track context menu / track action path**

In the app, right-click a track (or use the track's three-dot menu) and select "Add to playlist". Confirm the same new grid modal opens and works identically to Task 3's verification.

- [ ] **Step 3: Commit**

```bash
git add js/events.js
git commit -m "refactor: delegate handleTrackAction add-to-playlist to showAddToPlaylistModal"
```

---

## Task 5: Update `showMultiSelectPlaylistModal()` in `js/events.js`

**Files:**
- Modify: `js/events.js:179-251`

The multi-select variant (used for bulk-adding tracks) currently creates its own dynamic overlay element with inline styles. Update it to reuse the same `#playlist-select-modal` HTML and the same grid rendering approach. The difference: clicking a card adds all `tracks` (array), not just one, and there is no "already contains" check (it's a bulk operation).

- [ ] **Step 1: Replace `showMultiSelectPlaylistModal()`**

Find the full function from line 179 to 251. Replace with:

```js
async function showMultiSelectPlaylistModal(tracks) {
    const modal = document.getElementById('playlist-select-modal');
    const grid = document.getElementById('playlist-select-grid');
    const footer = document.getElementById('playlist-select-footer');
    const closeBtn = document.getElementById('playlist-select-close');
    const searchInput = document.getElementById('playlist-select-search');
    const sortSelect = document.getElementById('playlist-select-sort');
    const createRow = document.getElementById('playlist-select-create');
    const overlay = modal.querySelector('.modal-overlay');

    const playlists = await db.getPlaylists(true);

    const sortFns = {
        az: (a, b) => a.name.localeCompare(b.name),
        za: (a, b) => b.name.localeCompare(a.name),
        date: (a, b) => b.createdAt - a.createdAt,
        recent: (a, b) => b.updatedAt - a.updatedAt,
    };

    const renderGrid = (query = '', sortKey = 'az') => {
        const sorted = [...playlists].sort(sortFns[sortKey] || sortFns.az);
        const filtered = query
            ? sorted.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
            : sorted;

        grid.innerHTML = filtered.map(p => {
            const coverSrc = p.cover || (p.images && p.images[0]);
            const coverHtml = coverSrc
                ? `<img class="playlist-select-card-cover" src="${coverSrc}" alt="" loading="lazy">`
                : `<div class="playlist-select-card-placeholder">${SVG_MUSIC(24)}</div>`;
            return `
                <div class="playlist-select-card" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
                    ${coverHtml}
                    <div class="playlist-select-card-info">
                        <div class="playlist-select-card-name">${escapeHtml(p.name)}</div>
                        <div class="playlist-select-card-count">${p.numberOfTracks ?? p.tracks?.length ?? 0} tracks</div>
                    </div>
                </div>
            `;
        }).join('');

        footer.textContent = `${filtered.length} playlist${filtered.length !== 1 ? 's' : ''} · Type to filter`;
    };

    searchInput.value = '';
    sortSelect.value = 'az';
    renderGrid();

    const closeModal = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const handleGridClick = async (e) => {
        const card = e.target.closest('.playlist-select-card');
        if (!card) return;

        const playlistId = card.dataset.id;
        const playlistName = card.dataset.name;
        for (const track of tracks) {
            await db.addTrackToPlaylist(playlistId, track);
        }
        await syncManager.syncUserPlaylist(await db.getPlaylist(playlistId), 'update');
        showNotification(`Added ${tracks.length} tracks to playlist: ${playlistName}`);
        closeModal();
    };

    const handleSearch = () => renderGrid(searchInput.value, sortSelect.value);
    const handleSort = () => renderGrid(searchInput.value, sortSelect.value);

    const handleCreateClick = () => {
        const name = prompt('Playlist name:');
        if (name) {
            db.createPlaylist(name, tracks).then(playlist => {
                showNotification(`Created playlist "${name}" with ${tracks.length} tracks`);
                closeModal();
            });
        }
    };

    const cleanup = () => {
        closeBtn.removeEventListener('click', closeModal);
        overlay.removeEventListener('click', closeModal);
        grid.removeEventListener('click', handleGridClick);
        searchInput.removeEventListener('input', handleSearch);
        sortSelect.removeEventListener('change', handleSort);
        createRow.removeEventListener('click', handleCreateClick);
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    grid.addEventListener('click', handleGridClick);
    searchInput.addEventListener('input', handleSearch);
    sortSelect.addEventListener('change', handleSort);
    createRow.addEventListener('click', handleCreateClick);

    modal.classList.add('active');
    searchInput.focus();
}
```

- [ ] **Step 2: Verify multi-select path**

In the app, select multiple tracks (if the UI has a multi-select mode — checkbox select or shift-click) and trigger "Add to playlist". Confirm the grid modal opens, search/sort work, and clicking a playlist adds all selected tracks with the correct notification.

- [ ] **Step 3: Commit**

```bash
git add js/events.js
git commit -m "feat: update showMultiSelectPlaylistModal to use shared grid modal"
```

---

## Self-Review Notes

- **Spec coverage:** All sections covered — grid (Task 1+2+3), search (Task 3), sort (Task 3), create-new (Task 3), already-in dimming + badge (Task 3), badge click removes (Task 3), footer (Task 3), multi-select update (Task 5), handleTrackAction delegation (Task 4).
- **`playlist-select-cancel` removed** — the old Cancel button is gone from HTML. Task 1 removes it. Tasks 3+4+5 no longer reference it. No dangling references remain (confirmed: the old code only referenced it inside the functions being replaced).
- **`escapeHtml`** — used in Tasks 3 and 5. It is already used throughout `events.js` (e.g. line 221 in the old `showMultiSelectPlaylistModal`), so it is already in scope.
- **`SVG_MUSIC`** — imported in Task 3 Step 1 before it is used in Tasks 3 and 5.
- **`p.images[0]`** — safe because guarded with `p.images &&`.
- **Sort resets to A–Z on each open** — ensured by `sortSelect.value = 'az'` at start of each open in Tasks 3 and 5.
