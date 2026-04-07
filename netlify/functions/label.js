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


async function findQobuzLabel(name, token) {
    // Qobuz has no label search endpoint — search albums and extract label from results
    const url = new URL(`${QOBUZ_BASE}/catalog/search`);
    url.searchParams.set('query', name);
    url.searchParams.set('type', 'albums');
    url.searchParams.set('limit', '20');
    url.searchParams.set('app_id', process.env.QOBUZ_APP_ID);
    const res = await fetch(url, { headers: { 'X-User-Auth-Token': token } });
    if (!res.ok) throw new Error(`Qobuz search failed: ${res.status}`);
    const data = await res.json();
    const items = data.albums?.items || [];
    // Collect unique labels from results and find best name match
    const seen = new Map();
    for (const album of items) {
        if (album.label?.id && !seen.has(album.label.id)) {
            seen.set(album.label.id, { ...album.label, score: similarity(album.label.name, name) });
        }
    }
    if (!seen.size) return null;
    const scored = [...seen.values()].sort((a, b) => b.score - a.score);
    return scored[0].score >= 0.7 ? scored[0] : null;
}

async function getQobuzLabelAlbums(labelId, labelName, offset, limit, token) {
    const url = new URL(`${QOBUZ_BASE}/catalog/search`);
    url.searchParams.set('type', 'albums');
    url.searchParams.set('query', labelName);
    url.searchParams.set('label_id', String(labelId));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('app_id', process.env.QOBUZ_APP_ID);
    const res = await fetch(url, { headers: { 'X-User-Auth-Token': token } });
    if (!res.ok) throw new Error(`Qobuz label albums failed: ${res.status}`);
    const data = await res.json();
    return { albums: data.albums?.items || [], total: data.albums?.total || 0 };
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
    if (bestScore < 0.75) return null;
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
    const limit = Math.min(parseInt(params.limit || '24', 10), 50);

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

    let qobuzResult;
    try {
        qobuzResult = await getQobuzLabelAlbums(label.id, label.name, offset, limit, token);
    } catch {
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch label albums' }) };
    }

    const matched = (await Promise.all(qobuzResult.albums.map(qa => matchOnTidal(qa).catch(() => null)))).filter(Boolean);
    const hasMore = offset + limit < qobuzResult.total;

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=86400' },
        body: JSON.stringify({
            label: { id: label.id, name: label.name },
            albums: matched,
            total: qobuzResult.total,
            matched: matched.length,
            offset, limit, hasMore,
        }),
    };
};
