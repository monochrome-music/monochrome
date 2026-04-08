// netlify/functions/label.js

const QOBUZ_BASE = 'https://www.qobuz.com/api.json/0.2';

function getQobuzToken() {
    const token = process.env.QOBUZ_USER_AUTH_TOKEN;
    if (!token) throw new Error('QOBUZ_USER_AUTH_TOKEN not set');
    return token;
}

function similarity(a, b) {
    a = a.toLowerCase().replace(/[^a-z0-9 '\-]/g, '').trim();
    b = b.toLowerCase().replace(/[^a-z0-9 '\-]/g, '').trim();
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


// Strip common label suffixes to improve fuzzy matching
// e.g. "Freude am Tanzen Recordings" → "Freude am Tanzen"
function normalizeLabelName(name) {
    return name
        .replace(/\s+(recordings?|records?|music|entertainment|label|group|inc\.?|ltd\.?|llc\.?|gmbh|b\.v\.?)$/i, '')
        .trim();
}

async function findQobuzLabel(name, token) {
    // Search with both original and normalized name to maximise hit rate
    const queries = [name];
    const normalized = normalizeLabelName(name);
    if (normalized !== name) queries.push(normalized);

    const seen = new Map();
    for (const query of queries) {
        const url = new URL(`${QOBUZ_BASE}/catalog/search`);
        url.searchParams.set('query', query);
        url.searchParams.set('type', 'albums');
        url.searchParams.set('limit', '20');
        url.searchParams.set('app_id', process.env.QOBUZ_APP_ID);
        const res = await fetch(url, { headers: { 'X-User-Auth-Token': token } });
        if (!res.ok) continue;
        const data = await res.json();
        for (const album of data.albums?.items || []) {
            if (album.label?.id && !seen.has(album.label.id)) {
                // Score against both original and normalized name, take best
                const s1 = similarity(album.label.name, name);
                const s2 = similarity(normalizeLabelName(album.label.name), normalized);
                seen.set(album.label.id, { ...album.label, score: Math.max(s1, s2) });
            }
        }
    }
    if (!seen.size) return null;
    const scored = [...seen.values()].sort((a, b) => b.score - a.score);
    // Short label names need higher threshold to avoid false matches (e.g. "SARAW" → "Sarah Records")
    const minScore = name.length <= 6 ? 0.85 : 0.6;
    return scored[0].score >= minScore ? scored[0] : null;
}

async function getQobuzLabelAlbums(labelId, labelName, offset, limit, token) {
    // Use label/get with extra=albums for strict label-only results
    const url = new URL(`${QOBUZ_BASE}/label/get`);
    url.searchParams.set('label_id', String(labelId));
    url.searchParams.set('extra', 'albums');
    url.searchParams.set('albums_limit', String(limit));
    url.searchParams.set('albums_offset', String(offset));
    url.searchParams.set('app_id', process.env.QOBUZ_APP_ID);
    const res = await fetch(url, { headers: { 'X-User-Auth-Token': token } });
    if (!res.ok) throw new Error(`Qobuz label/get failed: ${res.status}`);
    const data = await res.json();

    // label/get returns albums under data.albums.items
    if (data.albums?.items?.length) {
        return { albums: data.albums.items, total: data.albums.total || 0 };
    }

    // Fallback: catalog/search with label_id (less strict but works)
    const fallback = new URL(`${QOBUZ_BASE}/catalog/search`);
    fallback.searchParams.set('type', 'albums');
    fallback.searchParams.set('query', labelName);
    fallback.searchParams.set('label_id', String(labelId));
    fallback.searchParams.set('limit', String(limit));
    fallback.searchParams.set('offset', String(offset));
    fallback.searchParams.set('app_id', process.env.QOBUZ_APP_ID);
    const res2 = await fetch(fallback, { headers: { 'X-User-Auth-Token': token } });
    if (!res2.ok) throw new Error(`Qobuz catalog/search failed: ${res2.status}`);
    const data2 = await res2.json();
    return { albums: data2.albums?.items || [], total: data2.albums?.total || 0 };
}

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
            const res = await fetch(`${base}/search/?al=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) continue;
            const data = await res.json();
            return data.data?.albums?.items ?? data.albums?.items ?? data.items ?? [];
        } catch { continue; }
    }
    return [];
}

async function matchOnTidal(qAlbum) {
    const artistName = qAlbum.artist?.name || '';
    const query = `${artistName} ${qAlbum.title}`.trim();
    const tidalAlbums = await searchTidalAlbums(query).catch(() => []);
    if (!tidalAlbums.length) return null;
    let best = null, bestScore = 0;
    for (const ta of tidalAlbums) {
        const tArtist = ta.artist?.name || (Array.isArray(ta.artists) ? ta.artists[0]?.name : '') || '';
        const score = similarity(qAlbum.title, ta.title || '') * 0.6 + similarity(artistName, tArtist) * 0.4;
        if (score > bestScore) { bestScore = score; best = ta; }
    }
    if (bestScore < 0.6) return null;
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

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    const params = event.queryStringParameters || {};
    const name = params.name?.trim();
    const offset = parseInt(params.offset || '0', 10);
    const limit = Math.min(parseInt(params.limit || '24', 10), 200);

    if (!name) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing name parameter' }) };
    }

    let token;
    try {
        token = getQobuzToken();
    } catch {
        return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Qobuz token not configured' }) };
    }

    let label;
    try {
        label = await findQobuzLabel(name, token);
    } catch {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Qobuz label search failed' }) };
    }

    if (!label) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Label not found on Qobuz', label: null, albums: [], total: 0 }) };
    }

    // Scan Qobuz pages until we collect `limit` matched TIDAL albums.
    // This avoids returning sparse pages when most Qobuz albums don't match.
    const matched = [];
    let qobuzOffset = offset;
    let qobuzTotal = null;
    const SCAN_BATCH = 50; // fetch 50 from Qobuz at a time
    const MAX_SCANNED = 300; // never scan more than 300 Qobuz albums per request

    try {
        while (matched.length < limit && qobuzOffset - offset < MAX_SCANNED) {
            const batch = await getQobuzLabelAlbums(label.id, label.name, qobuzOffset, SCAN_BATCH, token);
            if (qobuzTotal === null) qobuzTotal = batch.total;
            if (!batch.albums.length) break;

            const batchMatched = (await Promise.all(
                batch.albums.map(qa => matchOnTidal(qa).catch(() => null))
            )).filter(Boolean);

            matched.push(...batchMatched);
            qobuzOffset += SCAN_BATCH;

            if (qobuzOffset >= batch.total) break;
        }
    } catch {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch label albums' }) };
    }

    const hasMore = qobuzTotal !== null && qobuzOffset < qobuzTotal;

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400' },
        body: JSON.stringify({
            label: { id: label.id, name: label.name },
            albums: matched.slice(0, limit),
            total: qobuzTotal ?? 0,
            matched: matched.slice(0, limit).length,
            nextOffset: qobuzOffset,
            offset, limit, hasMore,
        }),
    };
};
