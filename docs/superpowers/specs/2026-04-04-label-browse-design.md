# Label Browse Feature — Design Spec
**Date:** 2026-04-04  
**Status:** Draft

---

## Goal

Allow users to discover and browse record label catalogs within Monochrome, similar to Qobuz's label browsing experience. Clicking a label name on an album page opens a label page showing all albums from that label that are available and playable on TIDAL.

---

## Architecture Overview

Three components, each with a single responsibility:

1. **Copyright parser** — extracts a label name from TIDAL's freeform copyright string
2. **Netlify function** (`/functions/label/`) — server-side proxy that queries Qobuz for a label's catalog and fuzzy-matches each album against TIDAL search
3. **Frontend** — label link on album pages + new `/label/:name` route + label page UI

Data flow:
```
Album page
  → parse copyright string → extract label name
  → render clickable label link → /label/Capitol%20Records

Label page
  → call /api/label?name=Capitol%20Records (Netlify function)
      → Qobuz: label/search?query=Capitol Records → get label_id
      → Qobuz: label/get?label_id=X&extras=albums → get album list
      → For each album: TIDAL search by "artist title"
      → Fuzzy match (score ≥ 0.75) → keep matched TIDAL album objects
      → Cache result 24h
  → render album grid using existing createAlbumCardHTML
  → paginate with "Load more" button
```

---

## 1. Copyright Parser (`js/label-utils.js`)

Extracts a label name from TIDAL's freeform copyright string. Examples:
- `"℗ 1977 Barry Gibb... under exclusive license to Capitol Music Group"` → `"Capitol Music Group"`
- `"℗ 2019 Interscope Records"` → `"Interscope Records"`
- `"Columbia Records, a division of Sony Music"` → `"Columbia Records"`

### Extraction rules (in priority order):
1. Match `under (?:exclusive )?license (?:to|from) ([^,.\n]+)` — most explicit
2. Match `℗\s*\d{4}\s+(.+?)(?:,|\.|$)` — label directly after phonogram symbol + year
3. Strip leading `℗`, `©`, years, and trim — last resort

### Export:
```js
export function extractLabelName(copyrightString) { ... }
// Returns: string | null
```

---

## 2. Netlify Function (`functions/label/index.js`)

**Route:** `GET /api/label?name=Capitol%20Records&offset=0&limit=24`

**Environment variables required:**
- `QOBUZ_APP_ID` — extracted once from Qobuz web player bundle, stored in Netlify env
- `QOBUZ_APP_SECRET` — same
- `QOBUZ_USER_EMAIL` — free/expired Qobuz account email
- `QOBUZ_USER_PASSWORD` — same

### Steps:

**1. Qobuz auth**  
POST to Qobuz login endpoint with app_id + user credentials → get user_auth_token.  
Token cached in memory for function lifetime (reused across requests).

**2. Label search**  
```
GET https://www.qobuz.com/api.json/0.2/label/search
  ?query={name}&limit=5&app_id={QOBUZ_APP_ID}
  Headers: X-User-Auth-Token: {token}
```
Take first result with name similarity ≥ 0.8 to the query.

**3. Label albums**  
```
GET https://www.qobuz.com/api.json/0.2/label/get
  ?label_id={id}&extras=albums&limit=50&offset={offset}&app_id={QOBUZ_APP_ID}
  Headers: X-User-Auth-Token: {token}
```

**4. TIDAL fuzzy matching**  
For each Qobuz album:
- Build query: `"${album.artist.name} ${album.title}"`
- Call TIDAL search (reuse the existing ServerAPI pattern from other functions)
- Score each TIDAL result: `similarity(qobuz_title, tidal_title) * 0.6 + similarity(qobuz_artist, tidal_artist) * 0.4`
- Similarity = normalized Levenshtein distance (implement inline, ~15 lines)
- Keep TIDAL album if best score ≥ 0.75

**5. Response shape:**
```json
{
  "label": { "id": 123, "name": "Capitol Records" },
  "albums": [
    { "id": "12345", "title": "...", "artist": { "id": "...", "name": "..." }, "cover": "...", "releaseDate": "..." }
  ],
  "total": 120,
  "offset": 0,
  "limit": 24,
  "hasMore": true
}
```

**6. Caching:**  
Set `Cache-Control: public, max-age=86400` on response (24h). Netlify edge caches automatically.  
Frontend also caches in existing `cache.js` with key `label_albums_${name}_${offset}`.

**Error handling:**
- Qobuz auth fails → 503 with message, frontend shows error state
- Label not found on Qobuz → 404, frontend shows "Label not found"
- TIDAL search fails for individual album → skip silently, log to console

---

## 3. Frontend Changes

### 3a. Album page (`js/ui.js` — `renderAlbumPage`)

Currently at line ~3302, `prodEl.innerHTML` renders the raw copyright string. Change to:

1. Import `extractLabelName` from `./label-utils.js`
2. Extract label name from `firstCopyright`
3. If label name found, replace copyright display with:
   ```html
   By <a href="/artist/123">Artist</a> • <a href="/label/Capitol%20Records" class="label-link">Capitol Records</a>
   ```
4. Keep full copyright string as `title` attribute on the label link (tooltip)
5. If no label extracted, fall back to current behavior (raw copyright string)

### 3b. Router (`js/router.js`)

Add case to the switch:
```js
case 'label':
    await ui.renderLabelPage(decodeURIComponent(param));
    break;
```

### 3c. Label page (`js/ui.js` — new method `renderLabelPage`)

**HTML page:** reuse existing `showPage('label')` pattern — add a `label` page section to `index.html` with:
- `#label-detail-name` — heading
- `#label-detail-albums` — card grid container
- `#label-load-more` — load more button
- `#label-detail-meta` — subtitle (e.g. "120 releases on TIDAL")

**Method flow:**
1. `showPage('label')`, set heading to skeleton
2. Check `cache.js` for `label_albums_${name}_0` — if hit, render immediately
3. Otherwise fetch `/api/label?name=${encodeURIComponent(name)}&offset=0&limit=24`
4. Show loading spinner in grid while fetching
5. On response: set heading to label name, render album grid via `createAlbumCardHTML`
6. Show "X releases on TIDAL" in meta
7. If `hasMore`, show "Load more" button — on click, fetch next page, append to grid, cache page
8. On error: show inline error message with retry button

### 3d. Styles (`styles.css`)

- `.label-link` — same style as artist links (already styled), no new styles needed
- Label page layout — reuse existing `.artist-page` / `.card-grid` classes, no new layout needed

---

## 4. One-time Setup: Qobuz Credentials

Before deployment, extract Qobuz app_id and app_secret by:
1. Opening Qobuz web player in browser devtools
2. Finding the bundle.js network request
3. Searching for `app_id` — value is a 7-digit number
4. App secret is base64-encoded nearby; decode it
5. Store all four values as Netlify environment variables

This is a one-time manual step, documented in `CONTRIBUTING.md`.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `js/label-utils.js` | Create | Copyright string parser |
| `functions/label/index.js` | Create | Netlify proxy function |
| `js/ui.js` | Modify | Album page label link + `renderLabelPage` method |
| `js/router.js` | Modify | Add `/label/:name` route |
| `index.html` | Modify | Add label page section |
| `netlify.toml` | Modify | Add function route for `/api/label` |
| `styles.css` | Modify | Minimal label page styles if needed |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Qobuz changes private API | Endpoints have been stable for years; minim relies on them too |
| Low TIDAL match rate for some labels | Show match count ("48 of 120 releases found on TIDAL"); user expectation set |
| Copyright string doesn't contain label | Falls back to showing raw copyright — no regression |
| Qobuz auth token expires | Re-auth on 401 response from Qobuz |
| Large labels (500+ releases) are slow | Paginate 24 at a time; each page fetches+matches independently |

---

## Out of Scope

- Label search UI (searching for labels by name from within Monochrome) — label links are the only entry point
- Storing/indexing label data — all fetched live from Qobuz
- Label pages for labels with no TIDAL presence — show empty state gracefully
