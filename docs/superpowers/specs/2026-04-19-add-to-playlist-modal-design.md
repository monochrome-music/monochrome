# Add to Playlist Modal — Enhanced Design

**Date:** 2026-04-19  
**Status:** Approved

## Summary

Replace the current plain text list in the "Add to Playlist" modal with a searchable, sortable 4-column grid with cover art. The popup size stays compact but fits more playlists visually and adds real-time filtering and sort controls.

---

## Context

The current modal (`#playlist-select-modal`) renders playlists as a plain scrollable text list with no search or sort. Users with 30–40+ playlists have no way to quickly find a specific one. The modal is implemented in:

- HTML: `index.html` lines 1011–1022
- Logic: `js/events.js` `showAddToPlaylistModal()` (lines 996–1115) and `handleTrackAction()` (lines 1494–1614)
- Multi-track variant: `js/events.js` `showMultiSelectPlaylistModal()` (lines 179–251)
- Album variant: `js/app.js` lines 2214–2289
- Styles: `styles.css` lines 6117–6387

---

## Design

### Modal Container

- Use existing `.modal-content.medium` (max-width 500px) instead of default 400px
- Keep existing backdrop/overlay behaviour unchanged
- Modal inner structure replaces only the `.modal-list` content area

### Header

- Title: "Add to playlist" (left-aligned, small, font-weight 600)
- Close button (×) top-right
- Search input below title row:
  - Placeholder: "Search playlists…"
  - Filters playlist grid in real-time on `input` event (case-insensitive match on playlist name)
  - Magnifier icon on left of input
- Sort dropdown to the right of search input:
  - Options: A–Z (default), Z–A, Date created, Recently used
  - "Recently used" sorts by `playlist.updatedAt` descending
  - "Date created" sorts by `playlist.createdAt` descending

### Create New Row

- Pinned below the header, above the grid, always visible (never filtered out)
- Small dashed-border icon (28×28px) + "Create new playlist" label
- Click triggers existing create-playlist flow unchanged

### Playlist Grid

- 4-column CSS grid, `gap: 0.4rem`
- Scrollable container, `max-height: 260px`, thin custom scrollbar
- Each card:
  - Cover image (playlist `cover` or auto-collage via `images`) at 1:1 aspect ratio
  - Fallback placeholder (gradient + music note icon) if no cover
  - Playlist name (truncated with ellipsis, font-size 0.68rem, font-weight 600)
  - Track count below name (font-size 0.62rem, muted color)
  - Border-radius 8px, hover: border brightens + slight background lift
- Playlists already containing the track (`alreadyContains` check):
  - Opacity 0.45, `cursor: default`, hover has no effect
  - Small "✓" badge top-right corner
  - Clicking does nothing (guard in click handler)
  - Still rendered in grid so user can see them

### Remove from Playlist

- For already-added playlists: clicking the ✓ badge directly removes the track (no confirm, matches current trash icon behaviour)
- Implementation: keep existing `removeTrackFromPlaylist` call, trigger on badge click

### Footer

- Single line: "X playlists · Type to filter" (updates as search filters)
- Muted color, font-size 0.7rem, centered, border-top

---

## Behaviour

### Search / Filter

- `input` event listener on search field
- Filter function: `playlists.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))`
- Re-renders grid on each keystroke
- "Create new playlist" row is always shown regardless of filter
- Footer count updates to reflect filtered count

### Sort

- `change` event on sort select
- Sort is applied before filter on render (sort once, filter the sorted array)
- Sort functions:
  - A–Z: `(a, b) => a.name.localeCompare(b.name)`
  - Z–A: `(a, b) => b.name.localeCompare(a.name)`
  - Date created: `(a, b) => b.createdAt - a.createdAt`
  - Recently used: `(a, b) => b.updatedAt - a.updatedAt`
- Selected sort persists for the duration the modal is open; resets to A–Z on next open

### Add Track

- Click a non-dimmed card → `db.addTrackToPlaylist(playlistId, track)` (unchanged)
- Modal closes, notification shown (unchanged)
- Card immediately dims with ✓ if modal stays open (not applicable — modal closes on add)

---

## Scope

### In scope

- `showAddToPlaylistModal()` in `js/events.js` — primary target
- `handleTrackAction('add-to-playlist')` in `js/events.js` — uses same modal
- HTML structure update in `index.html` for `#playlist-select-modal`
- CSS additions in `styles.css` for grid, search, sort, cards
- `showMultiSelectPlaylistModal()` — apply same grid treatment for consistency

### Out of scope

- Album add-to-playlist (`js/app.js`) — separate flow, leave unchanged for now
- DB layer — no changes needed
- Sync / event dispatch — unchanged
- Mobile-specific layout changes — responsive grid handles small screens naturally

---

## CSS additions (new classes)

All new, no existing classes modified:

| Class | Purpose |
| --- | --- |
| `.playlist-select-header` | Header wrapper with search + sort |
| `.playlist-select-search` | Search input |
| `.playlist-select-sort` | Sort dropdown |
| `.playlist-select-create` | Create new row |
| `.playlist-select-grid` | 4-col grid container |
| `.playlist-select-scroll` | Scrollable wrapper around grid |
| `.playlist-select-card` | Individual playlist card |
| `.playlist-select-card.already-in` | Dimmed state |
| `.playlist-select-card-cover` | Cover image / placeholder |
| `.playlist-select-card-info` | Name + count wrapper |
| `.playlist-select-badge` | ✓ badge for already-added |
| `.playlist-select-footer` | Count footer |

---

## Files to change

1. `index.html` — update `#playlist-select-modal` inner HTML structure
2. `js/events.js` — rewrite `showAddToPlaylistModal()` and update `handleTrackAction` section; update `showMultiSelectPlaylistModal()`
3. `styles.css` — add new CSS classes listed above
