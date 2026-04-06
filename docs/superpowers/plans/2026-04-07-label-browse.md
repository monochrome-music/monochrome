# Label Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a clickable record label link on album pages that opens a browsable label catalog page populated by Qobuz and matched against TIDAL.

**Architecture:** A Netlify edge function (`/functions/label/index.js`) receives a label name, queries Qobuz's private API for that label's album catalog, fuzzy-matches each against TIDAL search, and returns matched TIDAL album objects. The frontend adds a label link to the album page's copyright line and renders a new `/label/:name` route as a card grid using the existing album card component.

**Tech Stack:** Cloudflare Workers-compatible JS (existing pattern), Qobuz private REST API, TIDAL search via existing `ServerAPI` proxy pattern, `cache.js` `APICache` for frontend caching.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `js/label-utils.js` | **Create** | Copyright string → label name extractor |
| `functions/label/index.js` | **Create** | Netlify function: Qobuz lookup + TIDAL fuzzy match |
| `js/ui.js` | **Modify** | Album page label link + `renderLabelPage` method |
| `js/router.js` | **Modify** | Add `/label/:name` route |
| `index.html` | **Modify** | Add `#page-label` section |
| `netlify.toml` | **Modify** | Register `/api/label` function route |

---

## Task 1: Copyright parser (`js/label-utils.js`)

**Files:**
- Create: `js/label-utils.js`

- [ ] **Step 1: Create the file with the extractor function**

```js
// js/label-utils.js

/**
 * Extracts a record label name from a TIDAL freeform copyright string.
 * Returns null if no label can be confidently identified.
 *
 * Examples:
 *   "℗ 1977 Barry Gibb under exclusive license to Capitol Music Group" → "Capitol Music Group"
 *   "℗ 2019 Interscope Records" → "Interscope Records"
 *   "Columbia Records, a division of Sony Music" → "Columbia Records"
 */
export function extractLabelName(copyright) {
    if (!copyright || typeof copyright !== 'string') return null;

    // Rule 1: "under [exclusive] license to/from Label Name"
    const licenseMatch = copyright.match(/under\s+(?:exclusive\s+)?license\s+(?:to|from)\s+([^,.\n℗©]+)/i);
    if (licenseMatch) return licenseMatch[1].trim();

    // Rule 2: "℗ YYYY Label Name" — label directly after phonogram symbol + year
    const phonogramMatch = copyright.match(/[℗©]\s*\d{4}\s+(.+?)(?:\s*,|\s*\.|$)/);
    if (phonogramMatch) {
        const candidate = phonogramMatch[1].trim();
        // Skip if it looks like a person's name followed by more text (e.g. "Barry Gibb and...")
        if (!candidate.includes(' and ') && !candidate.includes(' & ') && candidate.length < 60) {
            return candidate;
        }
    }

    // Rule 3: "Label Name, a division of ..." — take the part before the comma
    const divisionMatch = copyright.match(/^([^,℗©\d]+?),\s*a\s+(?:division|subsidiary|label)\s+of/i);
    if (divisionMatch) return divisionMatch[1].trim();

    return null;
}
```

- [ ] **Step 2: Verify the file is parseable**

```bash
node --input-type=module <<'EOF'
import { extractLabelName } from './js/label-utils.js';
console.assert(extractLabelName('℗ 1977 Barry Gibb under exclusive license to Capitol Music Group') === 'Capitol Music Group', 'rule 1');
console.assert(extractLabelName('℗ 2019 Interscope Records') === 'Interscope Records', 'rule 2');
console.assert(extractLabelName('Columbia Records, a division of Sony Music') === 'Columbia Records', 'rule 3');
console.assert(extractLabelName(null) === null, 'null input');
console.log('All assertions passed');
EOF
```

Expected output: `All assertions passed`

- [ ] **Step 3: Commit**

```bash
git add js/label-utils.js
git commit -m "feat(labels): add copyright string label name extractor"
```

---

## Task 2: Netlify function — Qobuz + TIDAL matching (`functions/label/index.js`)

**Files:**
- Create: `functions/label/index.js`

**Prerequisites:** You need four Netlify environment variables set before this function will work:
- `QOBUZ_APP_ID` — 7-digit number from Qobuz bundle.js (open play.qobuz.com in DevTools → Network → search bundle.js → Ctrl+F `app_id`)
- `QOBUZ_APP_SECRET` — base64-encoded string near `app_id` in same file, decode it
- `QOBUZ_USER_EMAIL` — any Qobuz account (free/expired is fine)
- `QOBUZ_USER_PASSWORD` — password for that account

Set these in Netlify dashboard → Site settings → Environment variables, then also in a local `.env` file for testing:
```
QOBUZ_APP_ID=1234567
QOBUZ_APP_SECRET=abc123...
QOBUZ_USER_EMAIL=you@example.com
QOBUZ_USER_PASSWORD=yourpassword
```

- [ ] **Step 1: Create the function file**

```js
// functions/label/index.js

// In-memory token cache (lives for function instance lifetime)
let qobuzToken = null;
let qobuzTokenExpiry = 0;

const QOBUZ_BASE = 'https://www.qobuz.com/api.json/0.2';

// --- Levenshtein similarity (0 = totally different, 1 = identical) ---
function similarity(a, b) {
    a = a.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    b = b.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return 1 - dp[m][n] / Math.max(m, n);
}

// --- Qobuz auth ---
async function getQobuzToken(env) {
    if (qobuzToken && Date.now() < qobuzTokenExpiry) return qobuzToken;

    const res = await fetch(`${QOBUZ_BASE}/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            app_id: env.QOBUZ_APP_ID,
            username: env.QOBUZ_USER_EMAIL,
            password: env.QOBUZ_USER_PASSWORD,
            email: env.QOBUZ_USER_EMAIL,
        }),
    });

    if (!res.ok) throw new Error(`Qobuz auth failed: ${res.status}`);
    const data = await res.json();
    qobuzToken = data.user_auth_token;
    // Tokens typically last 24h; refresh after 23h
    qobuzTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return qobuzToken;
}

// --- Qobuz label search by name → label_id ---
async function findQobuzLabel(name, env, token) {
    const url = new URL(`${QOBUZ_BASE}/label/search`);
    url.searchParams.set('query', name);
    url.searchParams.set('limit', '10');
    url.searchParams.set('app_id', env.QOBUZ_APP_ID);

    const res = await fetch(url, { headers: { 'X-User-Auth-Token': token } });
    if (!res.ok) throw new Error(`Qobuz label search failed: ${res.status}`);
    const data = await res.json();

    const labels = data.labels?.items || data.items || [];
    if (!labels.length) return null;

    // Pick best name match
    const scored = labels.map(l => ({ ...l, score: similarity(l.name, name) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].score >= 0.8 ? scored[0] : null;
}

// --- Qobuz label albums ---
async function getQobuzLabelAlbums(labelId, offset, limit, env, token) {
    const url = new URL(`${QOBUZ_BASE}/label/get`);
    url.searchParams.set('label_id', labelId);
    url.searchParams.set('extras', 'albums');
    url.searchParams.set('albums_limit', String(limit));
    url.searchParams.set('albums_offset', String(offset));
    url.searchParams.set('app_id', env.QOBUZ_APP_ID);

    const res = await fetch(url, { headers: { 'X-User-Auth-Token': token } });
    if (!res.ok) throw new Error(`Qobuz label/get failed: ${res.status}`);
    const data = await res.json();
    return {
        albums: data.albums?.items || [],
        total: data.albums?.total || 0,
    };
}

// --- TIDAL search via proxy instances ---
const TIDAL_INSTANCES = [
    'https://eu-central.monochrome.tf',
    'https://us-west.monochrome.tf',
    'https://arran.monochrome.tf',
    'https://triton.squid.wtf',
    'https://api.monochrome.tf',
];

async function searchTidalAlbums(query) {
    const instances = [...TIDAL_INSTANCES].sort(() => Math.random() - 0.5);
    for (const base of instances) {
        try {
            const url = `${base}/search/?al=${encodeURIComponent(query)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) continue;
            const data = await res.json();
            // Normalise: handle both {albums:{items:[]}} and {items:[]} shapes
            const items = data.albums?.items ?? data.items ?? [];
            return items;
        } catch {
            continue;
        }
    }
    return [];
}

// --- Fuzzy match Qobuz album → best TIDAL album ---
async function matchOnTidal(qAlbum) {
    const artistName = qAlbum.artist?.name || '';
    const query = `${artistName} ${qAlbum.title}`.trim();

    let tidalAlbums;
    try {
        tidalAlbums = await searchTidalAlbums(query);
    } catch {
        return null;
    }

    if (!tidalAlbums.length) return null;

    let best = null;
    let bestScore = 0;

    for (const ta of tidalAlbums) {
        const tArtist = ta.artist?.name || (Array.isArray(ta.artists) ? ta.artists[0]?.name : '') || '';
        const titleScore = similarity(qAlbum.title, ta.title || '');
        const artistScore = similarity(artistName, tArtist);
        const score = titleScore * 0.6 + artistScore * 0.4;
        if (score > bestScore) {
            bestScore = score;
            best = ta;
        }
    }

    if (bestScore < 0.75) return null;

    // Normalise cover field
    const cover = best.cover ?? best.album?.cover ?? best.image ?? null;
    return {
        id: String(best.id),
        title: best.title,
        artist: {
            id: String(best.artist?.id ?? best.artists?.[0]?.id ?? ''),
            name: best.artist?.name ?? best.artists?.[0]?.name ?? artistName,
        },
        cover,
        releaseDate: best.releaseDate ?? best.streamStartDate ?? null,
        type: best.type ?? null,
    };
}

// --- Main handler ---
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const name = url.searchParams.get('name')?.trim();
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '24', 10), 50);

    if (!name) {
        return new Response(JSON.stringify({ error: 'Missing name parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    let token;
    try {
        token = await getQobuzToken(env);
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Qobuz authentication failed', detail: err.message }), {
            status: 503,
            headers: corsHeaders,
        });
    }

    // Re-auth on stale token
    const withReauth = async (fn) => {
        try {
            return await fn(token);
        } catch (err) {
            if (err.message.includes('401')) {
                qobuzToken = null;
                token = await getQobuzToken(env);
                return fn(token);
            }
            throw err;
        }
    };

    let label;
    try {
        label = await withReauth(t => findQobuzLabel(name, env, t));
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Qobuz label search failed', detail: err.message }), {
            status: 502,
            headers: corsHeaders,
        });
    }

    if (!label) {
        return new Response(JSON.stringify({ error: 'Label not found on Qobuz', label: null, albums: [], total: 0 }), {
            status: 404,
            headers: corsHeaders,
        });
    }

    let qobuzResult;
    try {
        qobuzResult = await withReauth(t => getQobuzLabelAlbums(label.id, offset, limit, env, t));
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to fetch label albums', detail: err.message }), {
            status: 502,
            headers: corsHeaders,
        });
    }

    // Fuzzy-match all Qobuz albums against TIDAL concurrently
    const matched = (
        await Promise.all(qobuzResult.albums.map(qa => matchOnTidal(qa).catch(() => null)))
    ).filter(Boolean);

    const hasMore = offset + limit < qobuzResult.total;

    return new Response(
        JSON.stringify({
            label: { id: label.id, name: label.name },
            albums: matched,
            total: qobuzResult.total,
            matched: matched.length,
            offset,
            limit,
            hasMore,
        }),
        {
            status: 200,
            headers: {
                ...corsHeaders,
                'Cache-Control': 'public, max-age=86400',
            },
        }
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/label/index.js
git commit -m "feat(labels): add Netlify label proxy function (Qobuz + TIDAL fuzzy match)"
```

---

## Task 3: Register the function route in `netlify.toml`

**Files:**
- Modify: `netlify.toml`

- [ ] **Step 1: Add the redirect rule**

Open `netlify.toml` and add this block **before** the existing catch-all `/*` redirect:

```toml
[[redirects]]
  from = "/api/label"
  to = "/.netlify/functions/label"
  status = 200
```

The file should now look like:

```toml
[build]
  command = "npm run build:netlify"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/api/label"
  to = "/.netlify/functions/label"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- [ ] **Step 2: Commit**

```bash
git add netlify.toml
git commit -m "feat(labels): register /api/label Netlify function route"
```

---

## Task 4: Add label page HTML to `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the page section**

Find the line containing `<div id="page-artist" class="page">` in `index.html`. Insert the following block **immediately before** it:

```html
<div id="page-label" class="page">
    <header class="detail-header" style="align-items: flex-start; padding-bottom: 1.5rem;">
        <div class="detail-header-info" style="width: 100%;">
            <h1 class="title" id="label-detail-name"></h1>
            <div class="meta" id="label-detail-meta"></div>
        </div>
    </header>
    <section class="content-section">
        <div class="card-grid" id="label-detail-albums"></div>
        <div style="text-align: center; margin-top: 1.5rem;">
            <button id="label-load-more" class="btn-secondary" style="display: none;">Load more</button>
        </div>
    </section>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(labels): add label page HTML section"
```

---

## Task 5: Add `/label/:name` route to the router

**Files:**
- Modify: `js/router.js`

- [ ] **Step 1: Add the route case**

In `js/router.js`, find the `switch (page)` block. Add this case after the `'artist'` case:

```js
case 'label':
    await ui.renderLabelPage(decodeURIComponent(param));
    break;
```

- [ ] **Step 2: Commit**

```bash
git add js/router.js
git commit -m "feat(labels): add /label/:name route"
```

---

## Task 6: Album page — show clickable label link

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Import `extractLabelName` at top of `ui.js`**

Find the existing import block at the top of `js/ui.js`. Add this import alongside the others:

```js
import { extractLabelName } from './label-utils.js';
```

- [ ] **Step 2: Update `prodEl.innerHTML` in `renderAlbumPage`**

Find this block (around line 3302):

```js
            prodEl.innerHTML =
                `By <a href="/artist/${album.artist.id}">${album.artist.name}</a>` +
                (firstCopyright ? ` • ${firstCopyright}` : '');
```

Replace it with:

```js
            const labelName = extractLabelName(firstCopyright);
            const labelHtml = labelName
                ? ` • <a href="/label/${encodeURIComponent(labelName)}" class="label-link" title="${escapeHtml(firstCopyright || '')}">${escapeHtml(labelName)}</a>`
                : (firstCopyright ? ` • ${escapeHtml(firstCopyright)}` : '');
            prodEl.innerHTML =
                `By <a href="/artist/${album.artist.id}">${escapeHtml(album.artist.name)}</a>` +
                labelHtml;
```

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(labels): show clickable label link on album page"
```

---

## Task 7: Add `renderLabelPage` method to `ui.js`

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add the method**

Find the `renderArtistPage` method in `js/ui.js` (around line 4092). Add the following method **immediately before** it:

```js
    async renderLabelPage(labelName) {
        this.showPage('label');

        const nameEl = document.getElementById('label-detail-name');
        const metaEl = document.getElementById('label-detail-meta');
        const albumsContainer = document.getElementById('label-detail-albums');
        const loadMoreBtn = document.getElementById('label-load-more');

        nameEl.innerHTML = `<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>`;
        metaEl.textContent = '';
        albumsContainer.innerHTML = `<div class="card-grid">${this.createSkeletonCards(12)}</div>`;
        loadMoreBtn.style.display = 'none';

        let offset = 0;
        const limit = 24;
        let totalQobuz = 0;
        let totalMatched = 0;

        const cacheKey = `label_albums_${labelName}`;

        const fetchPage = async (pageOffset) => {
            const pageCacheKey = `${cacheKey}_${pageOffset}`;
            const cached = await this.api.cache.get('label', pageCacheKey);
            if (cached) return cached;

            const url = `/api/label?name=${encodeURIComponent(labelName)}&offset=${pageOffset}&limit=${limit}`;
            const res = await fetch(url);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            await this.api.cache.set('label', pageCacheKey, data);
            return data;
        };

        const renderAlbums = (albums, append = false) => {
            const html = albums.map((a) => this.createAlbumCardHTML(a)).join('');
            if (append) {
                albumsContainer.insertAdjacentHTML('beforeend', html);
            } else {
                albumsContainer.innerHTML = html;
            }
        };

        try {
            const data = await fetchPage(0);
            totalQobuz = data.total;
            totalMatched += data.matched;

            nameEl.textContent = data.label?.name || labelName;
            document.title = `${data.label?.name || labelName} — Monochrome`;

            if (!data.albums.length) {
                albumsContainer.innerHTML = `<p style="opacity: 0.6; padding: 1rem 0;">No albums from this label found on TIDAL.</p>`;
                metaEl.textContent = 'No matches found';
                return;
            }

            renderAlbums(data.albums);
            metaEl.textContent = `${totalMatched} of ${totalQobuz} releases found on TIDAL`;

            if (data.hasMore) {
                loadMoreBtn.style.display = '';
                loadMoreBtn.onclick = async () => {
                    offset += limit;
                    loadMoreBtn.disabled = true;
                    loadMoreBtn.textContent = 'Loading…';
                    try {
                        const more = await fetchPage(offset);
                        totalMatched += more.matched;
                        renderAlbums(more.albums, true);
                        metaEl.textContent = `${totalMatched} of ${totalQobuz} releases found on TIDAL`;
                        if (!more.hasMore) {
                            loadMoreBtn.style.display = 'none';
                        } else {
                            loadMoreBtn.disabled = false;
                            loadMoreBtn.textContent = 'Load more';
                        }
                    } catch (err) {
                        loadMoreBtn.disabled = false;
                        loadMoreBtn.textContent = 'Load more';
                        console.error('Failed to load more label albums:', err);
                    }
                };
            }
        } catch (err) {
            if (err.message.includes('not found') || err.message.includes('404')) {
                nameEl.textContent = labelName;
                albumsContainer.innerHTML = `<p style="opacity: 0.6; padding: 1rem 0;">Label not found on Qobuz.</p>`;
                metaEl.textContent = '';
            } else {
                nameEl.textContent = labelName;
                albumsContainer.innerHTML = `
                    <div style="opacity: 0.6; padding: 1rem 0;">
                        <p>Failed to load label catalog.</p>
                        <button class="btn-secondary" id="label-retry-btn" style="margin-top: 0.5rem;">Retry</button>
                    </div>`;
                document.getElementById('label-retry-btn')?.addEventListener('click', () => this.renderLabelPage(labelName));
                metaEl.textContent = '';
            }
            console.error('renderLabelPage error:', err);
        }
    }

```

- [ ] **Step 2: Commit**

```bash
git add js/ui.js
git commit -m "feat(labels): add renderLabelPage method"
```

---

## Task 8: Manual smoke test

Before deploying, verify locally with `netlify dev` (requires Netlify CLI and env vars set in `.env`).

- [ ] **Step 1: Install Netlify CLI if needed**

```bash
npm install -g netlify-cli
```

- [ ] **Step 2: Run dev server**

```bash
netlify dev
```

- [ ] **Step 3: Test the function directly**

Open in browser or curl:
```
http://localhost:8888/api/label?name=Blue%20Note%20Records&limit=24
```

Expected: JSON with `label.name`, `albums` array (each with `id`, `title`, `artist`, `cover`), `total`, `matched`, `hasMore`.

If `albums` is empty but no error — the fuzzy threshold may be too strict. Lower it from `0.75` to `0.65` in `functions/label/index.js` line with `if (bestScore < 0.75)`.

- [ ] **Step 4: Test the UI**

Navigate to an album page (e.g. `http://localhost:8888/album/some-tidal-album-id`). The copyright line should now show a label link. Click it — should navigate to `/label/Label%20Name` and show an album grid.

- [ ] **Step 5: Commit any threshold adjustments**

```bash
git add functions/label/index.js
git commit -m "fix(labels): adjust fuzzy match threshold based on smoke test"
```

---

## Task 9: Set Netlify environment variables (one-time)

- [ ] **Step 1: Extract Qobuz credentials**

1. Open [https://play.qobuz.com](https://play.qobuz.com) in Chrome
2. Open DevTools → Network tab → reload the page
3. Find the request for `bundle.js` (large JS file)
4. In the response, Ctrl+F for `app_id` — you'll see something like `app_id:"1234567"`
5. Nearby, find the encoded app_secret — it appears as a base64 string, often assigned to a variable. Decode it with `atob('...')` in the DevTools console.

- [ ] **Step 2: Set variables in Netlify dashboard**

Go to your Netlify site → Site configuration → Environment variables → Add:
- `QOBUZ_APP_ID`
- `QOBUZ_APP_SECRET`  
- `QOBUZ_USER_EMAIL`
- `QOBUZ_USER_PASSWORD`

- [ ] **Step 3: Redeploy**

```bash
git push origin main
```

Netlify will pick up the env vars and redeploy automatically.

---

## Self-Review Checklist

- [x] Copyright parser covers 3 patterns, returns null on failure (no regression on album page)
- [x] Qobuz token cached in memory, re-auth on 401
- [x] TIDAL instances list matches the one in `functions/artist/[id].js`
- [x] Fuzzy match uses weighted title (0.6) + artist (0.4) scoring
- [x] Response shape matches what `renderLabelPage` consumes (`id`, `title`, `artist.id`, `artist.name`, `cover`, `releaseDate`, `type`)
- [x] `createAlbumCardHTML` expects `album.cover` (not `album.image`) — normalised in function
- [x] Cache key pattern `label_albums_${name}_${offset}` uses existing `this.api.cache.get/set('label', key)`
- [x] Load more button appended, not replaced
- [x] Error states: 404 (not found), 503 (auth fail), generic retry button
- [x] `escapeHtml` used on all user-facing strings in `ui.js`
- [x] `netlify.toml` redirect added before catch-all `/*`
- [x] Router case added for `'label'`
- [x] `index.html` page section uses existing `.page`, `.detail-header`, `.card-grid`, `.btn-secondary` classes
