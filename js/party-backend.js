const PARTY_CLIENT_ID_KEY = 'party_client_id';
const PARTY_HOST_TOKENS_KEY = 'party_host_tokens';
const DEFAULT_PARTY_BACKEND_URL = 'https://fucktidal3.valerie.sh';

function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

class PartyBackend {
    constructor() {
        this.basePath = '/api/parties';
    }

    getBaseUrl() {
        const configured =
            window.__PARTY_BACKEND_URL__ ||
            localStorage.getItem('monochrome-party-backend-url') ||
            DEFAULT_PARTY_BACKEND_URL;
        const trimmed = String(configured).trim().replace(/\/+$/, '');
        return trimmed ? `${trimmed}${this.basePath}` : this.basePath;
    }

    getWebSocketUrl(partyId) {
        const baseUrl = this.getBaseUrl();
        const path = `/${partyId}/ws`;
        if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
            const url = new URL(`${baseUrl}${path}`);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            return url.toString();
        }

        const url = new URL(`${baseUrl}${path}`, window.location.origin);
        url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.toString();
    }

    getClientId() {
        let clientId = localStorage.getItem(PARTY_CLIENT_ID_KEY);
        if (!clientId) {
            clientId = createId();
            localStorage.setItem(PARTY_CLIENT_ID_KEY, clientId);
        }
        return clientId;
    }

    getHostTokens() {
        return readJson(PARTY_HOST_TOKENS_KEY, {});
    }

    getHostToken(partyId) {
        return this.getHostTokens()[partyId] || null;
    }

    setHostToken(partyId, token) {
        const tokens = this.getHostTokens();
        tokens[partyId] = token;
        writeJson(PARTY_HOST_TOKENS_KEY, tokens);
    }

    clearHostToken(partyId) {
        const tokens = this.getHostTokens();
        delete tokens[partyId];
        writeJson(PARTY_HOST_TOKENS_KEY, tokens);
    }

    async request(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'X-Party-Client-Id': this.getClientId(),
            ...(options.hostToken ? { 'X-Party-Host-Token': options.hostToken } : {}),
            ...(options.headers || {}),
        };

        const response = await fetch(`${this.getBaseUrl()}${path}`, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const data = await response
            .clone()
            .json()
            .catch(() => null);

        if (!response.ok) {
            throw new Error(data?.error || `Party backend failed with ${response.status}`);
        }

        return data;
    }

    async createParty(data) {
        const result = await this.request('', {
            method: 'POST',
            body: data,
        });
        if (result.hostToken && result.party?.id) {
            this.setHostToken(result.party.id, result.hostToken);
        }
        return result.party;
    }

    getParty(partyId) {
        return this.request(`/${partyId}`);
    }

    updateParty(partyId, data) {
        return this.request(`/${partyId}`, {
            method: 'PATCH',
            hostToken: this.getHostToken(partyId),
            body: data,
        });
    }

    async deleteParty(partyId) {
        const result = await this.request(`/${partyId}`, {
            method: 'DELETE',
            hostToken: this.getHostToken(partyId),
        });
        this.clearHostToken(partyId);
        return result;
    }

    addMember(partyId, data) {
        return this.request(`/${partyId}/members`, {
            method: 'POST',
            body: data,
        });
    }

    updateMember(partyId, memberId, data) {
        return this.request(`/${partyId}/members/${memberId}`, {
            method: 'PATCH',
            body: data,
        });
    }

    deleteMember(partyId, memberId) {
        return this.request(`/${partyId}/members/${memberId}`, {
            method: 'DELETE',
        });
    }

    addMessage(partyId, data) {
        return this.request(`/${partyId}/messages`, {
            method: 'POST',
            body: data,
        });
    }

    addRequest(partyId, data) {
        return this.request(`/${partyId}/requests`, {
            method: 'POST',
            body: data,
        });
    }

    deleteRequest(partyId, requestId) {
        return this.request(`/${partyId}/requests/${requestId}`, {
            method: 'DELETE',
            hostToken: this.getHostToken(partyId),
        });
    }

    subscribeParty(partyId, handlers = {}) {
        let closed = false;
        let reconnectTimer = null;
        let socket = null;

        const connect = () => {
            if (closed) return;
            socket = new WebSocket(this.getWebSocketUrl(partyId));

            socket.onopen = () => {
                handlers.onOpen?.();
            };

            socket.onmessage = (event) => {
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (data.type === 'state') {
                    handlers.onState?.(data.state);
                } else if (data.type === 'deleted') {
                    handlers.onDeleted?.();
                }
            };

            socket.onclose = () => {
                handlers.onClose?.();
                if (!closed) {
                    reconnectTimer = setTimeout(connect, 1500);
                }
            };

            socket.onerror = () => {
                socket?.close();
            };
        };

        connect();

        return () => {
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            socket?.close();
        };
    }
}

export const partyBackend = new PartyBackend();
