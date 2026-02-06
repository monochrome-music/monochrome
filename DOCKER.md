# Docker Deployment Guide

## Quick Start

### Monochrome Only

```bash
docker compose up -d
```

Visit `http://localhost:3000`

### With PocketBase

```bash
cp .env.example .env
# Edit .env -- set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD
docker compose --profile pocketbase up -d
```

- Monochrome: `http://localhost:3000`
- PocketBase admin: `http://localhost:8090/_/`

Configure PocketBase collections per [self-hosted-database.md](self-hosted-database.md).

### Development

```bash
docker compose --profile dev up -d
```

Visit `http://localhost:5173` (hot-reload enabled)

---

## How It Works

### Profiles

Docker Compose [profiles](https://docs.docker.com/compose/how-tos/profiles/) control which services start. A service with no profile always runs. A service with a profile only runs when that profile is activated.

| Command                                                   | What starts                          |
| --------------------------------------------------------- | ------------------------------------ |
| `docker compose up -d`                                    | Monochrome                           |
| `docker compose --profile pocketbase up -d`               | Monochrome + PocketBase              |
| `docker compose --profile dev up -d`                      | Monochrome + Dev server              |
| `docker compose --profile dev --profile pocketbase up -d` | Monochrome + Dev server + PocketBase |

In `docker-compose.yml`, it looks like this:

```yaml
services:
    monochrome: # no profile -- always starts

    pocketbase:
        profiles: ['pocketbase'] # opt-in

    monochrome-dev:
        profiles: ['dev'] # opt-in
```

### Override File

Docker Compose automatically merges `docker-compose.override.yml` into `docker-compose.yml` if it exists in the same directory. No flags needed.

This is useful for forks that need to add custom services or configuration (Traefik labels, extra containers, custom networks) without modifying the base `docker-compose.yml`.

The override file does not exist in the upstream repo, don't search it!

**Example** -- adding Traefik labels to PocketBase in your fork:

```yaml
# docker-compose.override.yml
services:
    pocketbase:
        labels:
            - traefik.enable=true
            - traefik.http.routers.pocketbase.rule=Host(`pocketbase.example.com`)
            - traefik.http.routers.pocketbase.entrypoints=websecure
            - traefik.http.routers.pocketbase.tls.certresolver=letsencrypt
            - traefik.http.services.pocketbase.loadbalancer.server.port=8090
        networks:
            - proxy-network

networks:
    proxy-network:
        external: true
```

**Example** -- adding a custom service in your fork:

```yaml
# docker-compose.override.yml
services:
    my-custom-api:
        image: my-api:latest
        restart: unless-stopped
        ports:
            - '4000:4000'
        networks:
            - monochrome-network
```

Override files can extend existing services (add labels, env vars, networks) and define entirely new services. See the [Docker docs](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) for the full merge behavior.

---

## Portainer Deployment

Portainer can deploy directly from your GitHub fork with auto-updates on push.

### Setup

1. In Portainer, go to **Stacks > Add Stack > Repository**
2. Enter your fork URL and branch
3. Compose path: `docker-compose.yml`
4. If your fork has a `docker-compose.override.yml`, Portainer loads it automatically
5. Under **Environment variables**, add:
    - `COMPOSE_PROFILES=pocketbase` (to enable PocketBase -- omit if not needed)
    - `PB_ADMIN_EMAIL=your@email.com`
    - `PB_ADMIN_PASSWORD=your_secure_password`
    - Any other variables from `.env.example`
6. Enable **GitOps updates** to auto-redeploy on push

> **Tip:** `COMPOSE_PROFILES` is a built-in Docker Compose variable. Setting it to `pocketbase` is equivalent to passing `--profile pocketbase` on the command line.

> **Warning:** The `dev` profile is for **local development only**. It uses volume mounts to enable hot-reload, which requires the source code to be present on the host machine. Do **not** include `dev` in `COMPOSE_PROFILES` on Portainer deployments from GitHub — it will fail because there's no local source code to mount.

### Fork Workflow

To add custom services (Traefik, monitoring, etc.) to your fork:

1. Create `docker-compose.override.yml` in your fork
2. Remove the `docker-compose.override.yml` line from `.gitignore`
3. Commit both changes to your fork
4. Portainer will auto-load the override file alongside the base compose

When pulling updates from upstream (`git pull upstream main`), there are no conflicts -- the upstream repo does not have an override file.

---

## Common Operations

```bash
# View logs
docker compose logs -f
docker compose logs -f pocketbase

# Rebuild after code changes
docker compose up -d --build

# Stop everything (include all profiles you started)
docker compose --profile pocketbase down

# Stop and remove volumes (data loss!)
docker compose --profile pocketbase down -v

# Backup PocketBase data
docker compose exec pocketbase tar czf - /pb_data > backup.tar.gz

# Restore PocketBase data
docker compose exec pocketbase tar xzf - -C / < backup.tar.gz
```

---

## Architecture

### Production (Dockerfile)

Node.js Alpine image (multi-arch: amd64 + arm64). Installs dependencies, runs `vite build`, then serves the built files with `vite preview` on port 4173.

### Development (Dockerfile.dev)

Node.js Alpine image with source code mounted as a volume for hot-reload.

### Files

| File                          | Purpose                       | In upstream repo |
| ----------------------------- | ----------------------------- | :--------------: |
| `docker-compose.yml`          | All services with profiles    |       Yes        |
| `docker-compose.override.yml` | Fork-specific customizations  |        No        |
| `.env.example`                | Environment variable template |       Yes        |
| `.env`                        | Your local configuration      |        No        |
| `Dockerfile`                  | Production build              |       Yes        |
| `Dockerfile.dev`              | Development build             |       Yes        |
| `.dockerignore`               | Build context exclusions      |       Yes        |
