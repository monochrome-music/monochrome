
// placeholders - for now anyway - when real data loads, these going to disappear
// Monthly donors appear first; within each group sorted by recency

const PLACEHOLDERS_DONORS = [
    /* so many to test if:
    - It works
    - How it behaves if there are 5< users
    - If code breaks when it runs out of space (this is unlikely since there is so many lines) [auto suggested by VsCode auto completion yay]
    - if monthly users are correctly placed before one-time donors
    - to write useless memes
    */
    { name: 'Samidy', type: 'monthly', timestamp: '2026-04-29T10:00:00Z' },
    { name: 'Binimum', type: 'monthly', timestamp: '2026-04-20T09:00:00Z' },
    { name: 'John Monochrome', type: 'once', timestamp: '2026-04-27T15:00:00Z' },
    { name: 'Chroma', type: 'monthly', timestamp: '2026-04-25T12:00:00Z' },
    { name: 'Israel', type: 'once', timestamp: '2026-04-18T08:00:00Z' },
    { name: 'Tidal', type: 'once', timestamp: '2026-04-18T08:00:00Z' },
    { name: 'Kasane Teto (i think thats how you write her name)', type: 'monthly', timestamp: '2026-04-18T08:00:00Z' },
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
    const { env } = context;

    let donors = PLACEHOLDERS_DONORS;

    if (env.DONORS_KV) {
        const stored = await env.DONORS_KV.get('donors').catch(() => null);
        if (stored) donors = JSON.parse(stored);
    }

    donors.sort((a, b) => {
        if (a.type === 'monthly' && b.type !== 'monthly') return -1;
        if (a.type !== 'monthly' && b.type === 'monthly') return 1;
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    return new Response(JSON.stringify(donors), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' },
    });
}
