# Monochrome Party Server

Anonymous listening-party backend for Monochrome forks. It has no account system and stores party state in SQLite.

## Run

```sh
cd party-server
bun run start
```

Defaults:

- `PARTY_SERVER_HOST=0.0.0.0`
- `PARTY_SERVER_PORT=8787`
- `PARTY_DB_PATH=./parties.sqlite`
- `PARTY_TTL_SECONDS=43200`
- `PARTY_CORS_ORIGIN=*`

Point Monochrome at it from Settings > Instances > Party Backend URL:

```text
http://localhost:8787
```

The server exposes the same routes used by the web client:

- `POST /api/parties`
- `GET /api/parties/:id`
- `PATCH /api/parties/:id`
- `DELETE /api/parties/:id`
- `POST /api/parties/:id/members`
- `PATCH /api/parties/:id/members/:memberId`
- `DELETE /api/parties/:id/members/:memberId`
- `POST /api/parties/:id/messages`
- `POST /api/parties/:id/requests`
- `DELETE /api/parties/:id/requests/:requestId`
- `WS /api/parties/:id/ws`
- `GET /proxy-audio?url=https%3A%2F%2F...`
- `HEAD /proxy-audio?url=https%3A%2F%2F...`

Party state changes are pushed over WebSocket. REST endpoints are used for commands such as creating parties, sending chat messages, requests, and host playback updates.

## Tidal Proxy

If users do not have the Monochrome extension installed, the main party server now also exposes `/proxy-audio` on the same port. Monochrome derives the proxy host from `PARTY_BACKEND_URL`, so a normal setup like:

```text
PARTY_BACKEND_URL=https://fucktidal3.valerie.sh
```

automatically makes the frontend use:

```text
https://fucktidal3.valerie.sh/proxy-audio?url=...
```

The proxy forwards Tidal media requests with the same `Origin` and `Referer` headers the extension injects.

Optional: if you want to split it into a separate process, you can still run a dedicated proxy binary.

Run it with:

```sh
cd party-server
bun run start:proxy
```

Defaults:

- `TIDAL_PROXY_HOST=0.0.0.0`
- `TIDAL_PROXY_PORT=8788`
- `TIDAL_PROXY_CORS_ORIGIN=*`
- `TIDAL_PROXY_TARGET_ORIGIN=https://listen.tidal.com`

Routes:

- `GET /proxy-audio?url=https%3A%2F%2F...`
- `HEAD /proxy-audio?url=https%3A%2F%2F...`
- `GET /health`

Frontend behavior:

- If the browser extension is present, Monochrome skips the proxy.
- Otherwise, Monochrome will use `window.__TIDAL_PROXY_URL__` if set.
- If no explicit proxy URL is configured, it derives the proxy host from the configured `PARTY_BACKEND_URL` and calls `/proxy-audio` on that origin.
