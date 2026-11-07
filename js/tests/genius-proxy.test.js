import { afterEach, expect, test, vi } from 'vitest';
import { onRequestGet } from '../../functions/api/genius.js';

const fakeCredential = 'test-only-placeholder';
const invoke = (query, env = { GENIUS_ACCESS_TOKEN: fakeCredential }) =>
    onRequestGet({ request: new Request('https://instance.example/api/genius?' + query), env });
afterEach(() => vi.restoreAllMocks());

test('unconfigured instances make no upstream request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const response = await invoke('type=search&q=Song', {});
    expect(response.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
});

test.each([
    'type=other',
    'type=search&q=',
    'type=referents&song_id=../secret',
    'type=referents&song_id=1%26access_token%3Dx',
])('rejects invalid requests without contacting an arbitrary upstream: %s', async (query) => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect((await invoke(query)).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
});

test.each([
    ['type=search&q=Song%20Artist', '/search', 'q', 'Song Artist'],
    ['type=referents&song_id=123', '/referents', 'song_id', '123'],
])('uses a server-only credential on the fixed Genius endpoint: %s', async (query, path, key, value) => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ response: { result: 'public data' } }));
    const response = await invoke(query);
    expect(response.status).toBe(200);
    const [url, options] = spy.mock.calls[0];
    expect(url.origin).toBe('https://api.genius.com');
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get(key)).toBe(value);
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(options.headers.Authorization).toBe('Bearer ' + fakeCredential);
    expect(options.redirect).toBe('error');
    expect(await response.text()).not.toContain(fakeCredential);
});

test.each(['http', 'network'])(
    'upstream failures do not disclose credentials or upstream error bodies: %s',
    async (kind) => {
        const spy = vi.spyOn(globalThis, 'fetch');
        if (kind === 'http') spy.mockResolvedValue(new Response(fakeCredential, { status: 401 }));
        else spy.mockRejectedValue(new Error(fakeCredential));
        const response = await invoke('type=search&q=Song');
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(fakeCredential);
    }
);
