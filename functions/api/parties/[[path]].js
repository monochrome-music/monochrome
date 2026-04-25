const memoryStore = new Map();
const PARTY_TTL_SECONDS = 12 * 60 * 60;

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json;charset=UTF-8',
            'cache-control': 'no-store',
        },
    });
}

function createId() {
    return crypto.randomUUID();
}

async function readBody(request) {
    if (request.method === 'GET' || request.method === 'DELETE') return {};
    try {
        return await request.json();
    } catch {
        return {};
    }
}

function publicState(state) {
    if (!state) return null;
    const { hostToken: _hostToken, ...party } = state.party;
    return {
        party,
        members: state.members,
        messages: state.messages,
        requests: state.requests,
        updatedAt: state.updatedAt,
    };
}

function isExpired(state) {
    return !state || Date.now() - state.updatedAt > PARTY_TTL_SECONDS * 1000;
}

async function getStorage(env) {
    return env.PARTIES_KV || null;
}

async function getParty(env, partyId) {
    const storage = await getStorage(env);
    if (storage) {
        const state = await storage.get(`party:${partyId}`, 'json');
        if (isExpired(state)) return null;
        return state;
    }

    const state = memoryStore.get(partyId);
    if (isExpired(state)) {
        memoryStore.delete(partyId);
        return null;
    }
    return state;
}

async function putParty(env, state) {
    state.updatedAt = Date.now();
    const storage = await getStorage(env);
    if (storage) {
        await storage.put(`party:${state.party.id}`, JSON.stringify(state), {
            expirationTtl: PARTY_TTL_SECONDS,
        });
        return;
    }

    memoryStore.set(state.party.id, state);
}

async function deleteParty(env, partyId) {
    const storage = await getStorage(env);
    if (storage) {
        await storage.delete(`party:${partyId}`);
        return;
    }

    memoryStore.delete(partyId);
}

function requireHost(request, state) {
    const token = request.headers.get('x-party-host-token');
    return token && token === state.party.hostToken;
}

function getPathParts(request) {
    const url = new URL(request.url);
    const prefix = '/api/parties';
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    return path.split('/').filter(Boolean);
}

export async function onRequest(context) {
    const { request, env } = context;
    const parts = getPathParts(request);
    const body = await readBody(request);

    if (request.method === 'POST' && parts.length === 0) {
        const partyId = createId();
        const hostToken = createId();
        const now = Date.now();
        const party = {
            id: partyId,
            name: String(body.name || 'Listening Party').slice(0, 120),
            hostClientId: request.headers.get('x-party-client-id') || 'guest',
            hostName: String(body.hostName || 'Guest host').slice(0, 80),
            hostAvatarUrl: String(body.hostAvatarUrl || ''),
            hostToken,
            current_track: body.current_track || null,
            is_playing: !!body.is_playing,
            playback_time: Number(body.playback_time) || 0,
            playback_timestamp: Number(body.playback_timestamp) || now,
            queue: Array.isArray(body.queue) ? body.queue.slice(0, 200) : [],
            createdAt: now,
        };

        const state = {
            party,
            members: [],
            messages: [],
            requests: [],
            updatedAt: now,
        };
        await putParty(env, state);
        return json({ party: publicState(state).party, hostToken });
    }

    const partyId = parts[0];
    if (!partyId) return json({ error: 'Not found' }, 404);

    const state = await getParty(env, partyId);
    if (!state) return json({ error: 'Party not found' }, 404);

    if (request.method === 'GET' && parts.length === 1) {
        return json(publicState(state));
    }

    if (request.method === 'PATCH' && parts.length === 1) {
        if (!requireHost(request, state)) return json({ error: 'Host token required' }, 403);
        Object.assign(state.party, {
            current_track: body.current_track || null,
            is_playing: !!body.is_playing,
            playback_time: Number(body.playback_time) || 0,
            playback_timestamp: Number(body.playback_timestamp) || Date.now(),
            queue: Array.isArray(body.queue) ? body.queue.slice(0, 200) : [],
        });
        await putParty(env, state);
        return json(publicState(state));
    }

    if (request.method === 'DELETE' && parts.length === 1) {
        if (!requireHost(request, state)) return json({ error: 'Host token required' }, 403);
        await deleteParty(env, partyId);
        return json({ ok: true });
    }

    if (parts[1] === 'members') {
        if (request.method === 'POST' && parts.length === 2) {
            const clientId = request.headers.get('x-party-client-id') || 'guest';
            const isHost = clientId === state.party.hostClientId;
            const existing = state.members.find((member) => member.clientId === clientId);
            const member = {
                id: existing?.id || createId(),
                clientId,
                name: String(body.name || 'Guest').slice(0, 80),
                avatar_url: String(body.avatar_url || ''),
                is_host: isHost,
                last_seen: Date.now(),
            };
            state.members = [member, ...state.members.filter((item) => item.id !== member.id)];
            await putParty(env, state);
            return json(member);
        }

        if (request.method === 'PATCH' && parts.length === 3) {
            const member = state.members.find((item) => item.id === parts[2]);
            if (member) member.last_seen = Date.now();
            await putParty(env, state);
            return json(member || { ok: true });
        }

        if (request.method === 'DELETE' && parts.length === 3) {
            state.members = state.members.filter((item) => item.id !== parts[2]);
            await putParty(env, state);
            return json({ ok: true });
        }
    }

    if (parts[1] === 'messages' && request.method === 'POST') {
        const message = {
            id: createId(),
            party: partyId,
            sender_name: String(body.sender_name || 'Guest').slice(0, 80),
            content: String(body.content || '').slice(0, 2000),
            created: new Date().toISOString(),
        };
        state.messages = [...state.messages.slice(-99), message];
        await putParty(env, state);
        return json(message);
    }

    if (parts[1] === 'requests') {
        if (request.method === 'POST') {
            const requestRecord = {
                id: createId(),
                party: partyId,
                track: body.track || null,
                requested_by: String(body.requested_by || 'Guest').slice(0, 80),
                created: new Date().toISOString(),
            };
            state.requests.push(requestRecord);
            await putParty(env, state);
            return json(requestRecord);
        }

        if (request.method === 'DELETE' && parts.length === 3) {
            if (!requireHost(request, state)) return json({ error: 'Host token required' }, 403);
            state.requests = state.requests.filter((item) => item.id !== parts[2]);
            await putParty(env, state);
            return json({ ok: true });
        }
    }

    return json({ error: 'Not found' }, 404);
}
