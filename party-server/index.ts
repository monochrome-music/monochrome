/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string */
import { Database } from 'bun:sqlite';
import type { ServerWebSocket } from 'bun';

const HOST = process.env.PARTY_SERVER_HOST || '0.0.0.0';
const PORT = Number(process.env.PARTY_SERVER_PORT || 8787);
const DB_PATH = process.env.PARTY_DB_PATH || './parties.sqlite';
const TTL_SECONDS = Number(process.env.PARTY_TTL_SECONDS || 12 * 60 * 60);
const CORS_ORIGIN = process.env.PARTY_CORS_ORIGIN || '*';
const TIDAL_PROXY_TARGET_ORIGIN = process.env.TIDAL_PROXY_TARGET_ORIGIN || 'https://listen.tidal.com';

type PartyState = {
    party: Record<string, any>;
    members: Array<Record<string, any>>;
    messages: Array<Record<string, any>>;
    requests: Array<Record<string, any>>;
    updatedAt: number;
};

type SocketData = {
    partyId: string;
};

type PartySocket = ServerWebSocket<SocketData>;

const db = new Database(DB_PATH);
db.exec(`
    CREATE TABLE IF NOT EXISTS parties (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_parties_updated_at ON parties(updated_at);
`);

const getPartyStmt = db.query('SELECT state FROM parties WHERE id = ?');
const upsertPartyStmt = db.query(`
    INSERT INTO parties (id, state, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
`);
const deletePartyStmt = db.query('DELETE FROM parties WHERE id = ?');
const pruneStmt = db.query('DELETE FROM parties WHERE updated_at < ?');
const socketsByParty = new Map<string, Set<PartySocket>>();

function now() {
    return Date.now();
}

function createId() {
    return crypto.randomUUID();
}

function corsHeaders(extra: HeadersInit = {}) {
    return {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers':
            'Content-Type,X-Party-Client-Id,X-Party-Host-Token,Range,Accept,Authorization',
        'Access-Control-Expose-Headers':
            'Accept-Ranges,Content-Length,Content-Range,Content-Type,Cache-Control,ETag,Last-Modified',
        'Access-Control-Max-Age': '86400',
        ...extra,
    };
}

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders({
            'content-type': 'application/json;charset=UTF-8',
            'cache-control': 'no-store',
        }),
    });
}

async function readBody(request: Request) {
    if (request.method === 'GET' || request.method === 'DELETE') return {};
    try {
        return await request.json();
    } catch {
        return {};
    }
}

function publicState(state: PartyState) {
    const { hostToken: _hostToken, ...party } = state.party;
    return {
        party,
        members: state.members,
        messages: state.messages,
        requests: state.requests,
        updatedAt: state.updatedAt,
    };
}

function pruneExpired() {
    pruneStmt.run(now() - TTL_SECONDS * 1000);
}

function getParty(partyId: string): PartyState | null {
    const row = getPartyStmt.get(partyId) as { state: string } | null;
    if (!row) return null;

    const state = JSON.parse(row.state) as PartyState;
    if (now() - state.updatedAt > TTL_SECONDS * 1000) {
        deletePartyStmt.run(partyId);
        return null;
    }

    return state;
}

function putParty(state: PartyState) {
    state.updatedAt = now();
    upsertPartyStmt.run(state.party.id, JSON.stringify(state), state.updatedAt);
    broadcastParty(state);
}

function deleteParty(partyId: string) {
    deletePartyStmt.run(partyId);
    broadcastPartyDeleted(partyId);
}

function requireHost(request: Request, state: PartyState) {
    const token = request.headers.get('x-party-host-token');
    return !!token && token === state.party.hostToken;
}

function getPathParts(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/parties\/?/, '');
    return path.split('/').filter(Boolean);
}

function truncate(value: unknown, fallback: string, maxLength: number) {
    return String(value || fallback).slice(0, maxLength);
}

function isAllowedProxyTarget(targetUrl: string) {
    try {
        const parsed = new URL(targetUrl);
        return parsed.protocol === 'https:' && parsed.hostname.endsWith('.tidal.com');
    } catch {
        return false;
    }
}

function buildProxyRequestHeaders(request: Request) {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
        const normalized = key.toLowerCase();
        if (['host', 'origin', 'referer', 'connection'].includes(normalized)) continue;
        headers.set(key, value);
    }
    headers.set('Origin', TIDAL_PROXY_TARGET_ORIGIN);
    headers.set('Referer', `${TIDAL_PROXY_TARGET_ORIGIN}/`);
    return headers;
}

function buildProxyResponseHeaders(upstream: Response) {
    const headers = new Headers();
    for (const [key, value] of upstream.headers.entries()) {
        const normalized = key.toLowerCase();
        if (['connection', 'transfer-encoding'].includes(normalized)) continue;
        headers.set(key, value);
    }

    const cors = corsHeaders();
    for (const [key, value] of Object.entries(cors)) {
        headers.set(key, String(value));
    }

    return headers;
}

function broadcastParty(state: PartyState) {
    const sockets = socketsByParty.get(state.party.id);
    if (!sockets || sockets.size === 0) return;

    const payload = JSON.stringify({
        type: 'state',
        state: publicState(state),
    });
    for (const socket of sockets) {
        socket.send(payload);
    }
}

function broadcastPartyDeleted(partyId: string) {
    const sockets = socketsByParty.get(partyId);
    if (!sockets || sockets.size === 0) return;

    const payload = JSON.stringify({ type: 'deleted' });
    for (const socket of sockets) {
        socket.send(payload);
        socket.close();
    }
    socketsByParty.delete(partyId);
}

Bun.serve({
    hostname: HOST,
    port: PORT,
    async fetch(request, server) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);
        if (url.pathname === '/health') {
            return json({ ok: true });
        }

        if (url.pathname === '/proxy-audio') {
            if (!['GET', 'HEAD'].includes(request.method)) {
                return json({ error: 'Method not allowed' }, 405);
            }

            const targetUrl = url.searchParams.get('url');
            if (!targetUrl) {
                return json({ error: 'Missing url parameter' }, 400);
            }

            if (!isAllowedProxyTarget(targetUrl)) {
                return json({ error: 'Target must be an https://*.tidal.com URL' }, 400);
            }

            let upstream: Response;
            try {
                upstream = await fetch(targetUrl, {
                    method: request.method,
                    headers: buildProxyRequestHeaders(request),
                    redirect: 'follow',
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown upstream error';
                return json({ error: `Upstream request failed: ${message}` }, 502);
            }

            return new Response(request.method === 'HEAD' ? null : upstream.body, {
                status: upstream.status,
                headers: buildProxyResponseHeaders(upstream),
            });
        }

        if (!url.pathname.startsWith('/api/parties')) {
            return json({ error: 'Not found' }, 404);
        }

        if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            const parts = getPathParts(request);
            const partyId = parts[0];
            if (!partyId || parts[1] !== 'ws') return json({ error: 'Not found' }, 404);

            const state = getParty(partyId);
            if (!state) return json({ error: 'Party not found' }, 404);

            const upgraded = server.upgrade<SocketData>(request, {
                data: { partyId },
            });
            return upgraded ? undefined : json({ error: 'WebSocket upgrade failed' }, 400);
        }

        pruneExpired();

        const parts = getPathParts(request);
        const body = (await readBody(request)) as Record<string, any>;

        if (request.method === 'POST' && parts.length === 0) {
            const partyId = createId();
            const hostToken = createId();
            const createdAt = now();
            const party = {
                id: partyId,
                name: truncate(body.name, 'Listening Party', 120),
                hostClientId: request.headers.get('x-party-client-id') || 'guest',
                hostName: truncate(body.hostName, 'Guest host', 80),
                hostAvatarUrl: truncate(body.hostAvatarUrl, '', 400),
                hostToken,
                current_track: body.current_track || null,
                is_playing: !!body.is_playing,
                playback_time: Number(body.playback_time) || 0,
                playback_timestamp: Number(body.playback_timestamp) || createdAt,
                queue: Array.isArray(body.queue) ? body.queue.slice(0, 200) : [],
                createdAt,
            };

            const state: PartyState = {
                party,
                members: [],
                messages: [],
                requests: [],
                updatedAt: createdAt,
            };
            putParty(state);
            return json({ party: publicState(state).party, hostToken });
        }

        const partyId = parts[0];
        if (!partyId) return json({ error: 'Not found' }, 404);

        const state = getParty(partyId);
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
                playback_timestamp: Number(body.playback_timestamp) || now(),
                queue: Array.isArray(body.queue) ? body.queue.slice(0, 200) : [],
            });
            putParty(state);
            return json(publicState(state));
        }

        if (request.method === 'DELETE' && parts.length === 1) {
            if (!requireHost(request, state)) return json({ error: 'Host token required' }, 403);
            deleteParty(partyId);
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
                    name: truncate(body.name, 'Guest', 80),
                    avatar_url: truncate(body.avatar_url, '', 400),
                    is_host: isHost,
                    last_seen: now(),
                };
                state.members = [member, ...state.members.filter((item) => item.id !== member.id)];
                putParty(state);
                return json(member);
            }

            if (request.method === 'PATCH' && parts.length === 3) {
                const member = state.members.find((item) => item.id === parts[2]);
                if (member) member.last_seen = now();
                putParty(state);
                return json(member || { ok: true });
            }

            if (request.method === 'DELETE' && parts.length === 3) {
                state.members = state.members.filter((item) => item.id !== parts[2]);
                putParty(state);
                return json({ ok: true });
            }
        }

        if (parts[1] === 'messages' && request.method === 'POST') {
            const message = {
                id: createId(),
                party: partyId,
                sender_name: truncate(body.sender_name, 'Guest', 80),
                content: truncate(body.content, '', 2000),
                created: new Date().toISOString(),
            };
            state.messages = [...state.messages.slice(-99), message];
            putParty(state);
            return json(message);
        }

        if (parts[1] === 'requests') {
            if (request.method === 'POST') {
                const requestRecord = {
                    id: createId(),
                    party: partyId,
                    track: body.track || null,
                    requested_by: truncate(body.requested_by, 'Guest', 80),
                    created: new Date().toISOString(),
                };
                state.requests.push(requestRecord);
                putParty(state);
                return json(requestRecord);
            }

            if (request.method === 'DELETE' && parts.length === 3) {
                if (!requireHost(request, state)) return json({ error: 'Host token required' }, 403);
                state.requests = state.requests.filter((item) => item.id !== parts[2]);
                putParty(state);
                return json({ ok: true });
            }
        }

        return json({ error: 'Not found' }, 404);
    },
    websocket: {
        open(socket) {
            const { partyId } = socket.data;
            if (!socketsByParty.has(partyId)) socketsByParty.set(partyId, new Set());
            socketsByParty.get(partyId)?.add(socket);

            const state = getParty(partyId);
            if (state) {
                socket.send(JSON.stringify({ type: 'state', state: publicState(state) }));
            } else {
                socket.send(JSON.stringify({ type: 'deleted' }));
                socket.close();
            }
        },
        close(socket) {
            const { partyId } = socket.data;
            const sockets = socketsByParty.get(partyId);
            if (!sockets) return;

            sockets.delete(socket);
            if (sockets.size === 0) socketsByParty.delete(partyId);
        },
        message() {},
    },
});

console.log(`Monochrome party server listening on http://${HOST}:${PORT}`);
console.log(`SQLite database: ${DB_PATH}`);
