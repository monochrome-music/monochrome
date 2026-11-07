// Keep optional Genius credentials on the server, outside downloaded client code.
export async function onRequestGet({ request, env }) {
    const params = new URL(request.url).searchParams;
    const type = params.get('type');
    const upstream = new URL('https://api.genius.com/');
    if (type === 'search') {
        const query = params.get('q')?.trim();
        if (!query || query.length > 200) return Response.json({ error: 'Invalid query' }, { status: 400 });
        upstream.pathname = '/search';
        upstream.searchParams.set('q', query);
    } else if (type === 'referents') {
        const id = params.get('song_id');
        if (!id || !/^\d{1,20}$/.test(id)) return Response.json({ error: 'Invalid song ID' }, { status: 400 });
        upstream.pathname = '/referents';
        upstream.searchParams.set('song_id', id);
        upstream.searchParams.set('text_format', 'plain');
        upstream.searchParams.set('per_page', '50');
    } else {
        return Response.json({ error: 'Invalid request type' }, { status: 400 });
    }

    if (!env?.GENIUS_ACCESS_TOKEN) {
        return Response.json({ error: 'Genius annotations are unavailable on this instance.' }, { status: 503 });
    }
    try {
        const response = await fetch(upstream, {
            headers: { Authorization: `Bearer ${env.GENIUS_ACCESS_TOKEN}` },
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
        });
        if (!response.ok) return Response.json({ error: 'Genius request failed' }, { status: 502 });
        return Response.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
    } catch {
        return Response.json({ error: 'Genius request failed' }, { status: 502 });
    }
}
