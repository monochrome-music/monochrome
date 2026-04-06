// functions/label/index.js

// In-memory token cache (lives for function instance lifetime)
let qobuzToken = null;
let qobuzTokenExpiry = 0;

const QOBUZ_BASE = 'https://www.qobuz.com/api.json/0.2';

// --- Levenshtein similarity (0 = totally different, 1 = identical) ---
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
