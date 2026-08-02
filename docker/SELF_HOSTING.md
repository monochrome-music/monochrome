# Self-hosting Monochrome with accounts + playlist sync

This runs two containers behind **your own reverse proxy**:

| Container | Purpose | Loopback port |
| --- | --- | --- |
| `monochrome` | Static frontend (nginx) | `127.0.0.1:4472` |
| `monochrome-auth` | Accounts + sync API (better-auth + SQLite) | `127.0.0.1:4480` |

Both bind to `127.0.0.1` only, so nothing is exposed to the mesh/LAN except
through the reverse proxy you already run.

## 1. Configure

```bash
cd docker
cp .env.example .env
# edit .env: set AUTH_URL, FRONTEND_ORIGIN, and AUTH_SECRET
openssl rand -hex 32   # paste into AUTH_SECRET
```

`AUTH_URL` and `FRONTEND_ORIGIN` are the **https** URLs as reached through your
proxy (e.g. Tailscale MagicDNS names). HTTPS is required: the auth cookie is set
on `auth.<domain>` and sent from `music.<domain>` — that's cross-site, so the
browser only keeps it with `SameSite=None; Secure`, which needs TLS.

## 2. Build & run

```bash
cd docker
docker compose up -d --build
```

> The frontend bakes `AUTH_URL` into the bundle at **build** time, so re-run with
> `--build` whenever you change `AUTH_URL` / provider flags in `.env`.

## 3. Point your reverse proxy at it

Two hostnames, both over HTTPS. Examples:

**Caddy**

```
music.<your-domain> {
    reverse_proxy 127.0.0.1:4472
}
auth.<your-domain> {
    reverse_proxy 127.0.0.1:4480
}
```

**Traefik / nginx-proxy-manager**: create two proxy hosts →
`http://127.0.0.1:4472` and `http://127.0.0.1:4480`, TLS enabled.

The auth server sets `trust proxy`, so it honors `X-Forwarded-Proto` from your
proxy — make sure the proxy forwards it (Caddy/Traefik/NPM do by default).

## 4. Verify

```bash
curl -s https://auth.<your-domain>/health          # -> OK
# open https://music.<your-domain>, Accounts panel -> sign up -> sign in
```

Sign in on a second device with the same account; your library, history,
playlists and folders sync via `PATCH /api/sync`.

## What works / what doesn't

- ✅ Email/password accounts, sessions, and full library/playlist/history sync across devices.
- ⚠️ Google/GitHub/Discord buttons render but do nothing (no providers configured). `AUTH_GOOGLE_ENABLED=false` hides Google.
- ❌ Public playlist sharing & community theme store — not backed by this minimal server (client handles the 404s gracefully).
- ❌ No email verification / password reset (no SMTP wired up) — fine for a personal instance.

## Data & backups

Accounts and synced libraries live in the `auth_data` Docker volume
(`/data/auth.db`, SQLite in WAL mode). Back it up with:

```bash
docker run --rm -v monochrome_auth_data:/data -v "$PWD":/backup alpine \
    sh -c 'cp /data/auth.db* /backup/'
```
