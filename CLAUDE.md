# CLAUDE.md

This file provides guidance for AI assistants working with the Monochrome codebase.

## Project Overview

Monochrome is an open-source, privacy-respecting music streaming web application that serves as an alternative UI for TIDAL, powered by the Hi-Fi API. It is a Progressive Web App (PWA) built with vanilla JavaScript (ES6+ modules) and Vite.

- **Repository**: https://github.com/monochrome-music/monochrome
- **Live instance**: https://monochrome.tf
- **License**: ISC

## Quick Reference

```bash
bun install            # Install dependencies (npm install also works)
bun run dev            # Start dev server at http://localhost:5173
bun run build          # Production build to dist/
bun run preview        # Preview production build at http://localhost:4173
bun run lint           # Run all linters (JS + CSS + HTML)
bun run lint:js        # ESLint only
bun run lint:css       # Stylelint only
bun run lint:html      # HTMLHint only
bun run format         # Auto-format with Prettier
```

There is no test suite. Quality is enforced through linting and manual testing.

## Architecture

### Tech Stack

- **Language**: Vanilla JavaScript (ES6+ modules, no framework)
- **Build tool**: Vite 7.x with PWA plugin (vite-plugin-pwa)
- **Package manager**: Bun (preferred) or npm
- **Styling**: Vanilla CSS (single `styles.css` file)
- **HTML**: Single `index.html` entry point
- **Deployment**: Cloudflare Pages (automatic), Docker (self-hosted)
- **Runtime dependencies**: `dashjs` (DASH streaming), `pocketbase` (self-hosted sync)

### Source Layout

```
js/                          # All application JavaScript
  app.js                     # Entry point - imports and initializes all modules
  api.js                     # LosslessAPI class - TIDAL API client with multi-instance failover
  player.js                  # Player class - audio playback, queue, shuffle/repeat
  ui.js                      # UIRenderer class - all DOM rendering (largest file)
  events.js                  # Event handlers and bindings
  storage.js                 # localStorage/settings management, API instance config
  db.js                      # IndexedDB wrapper (favorites, history, playlists)
  router.js                  # Client-side path routing (pushState)
  downloads.js               # Track/album download functionality
  lyrics.js                  # Lyrics display and parsing
  metadata.js                # Track metadata and embedding
  settings.js                # Settings UI and initialization
  tracker.js                 # Unreleased music tracker (ArtistGrid)
  ui-interactions.js         # Interactive UI components
  utils.js                   # Shared utilities, constants, SVG icons
  cache.js                   # API response caching
  equalizer.js               # Audio equalizer (Web Audio API)
  audio-context.js           # Web Audio API context management
  visualizer.js              # Visualizer control
  waveform.js                # Waveform generation
  side-panel.js              # Side panel management
  dash-downloader.js         # DASH media segment downloader
  playlist-generator.js      # Smart playlist generation
  vibrant-color.js           # Color extraction from album art
  smooth-scrolling.js        # Scroll behavior
  lastfm.js                  # Last.fm scrobbling
  listenbrainz.js            # ListenBrainz scrobbling
  maloja.js                  # Maloja scrobbling
  librefm.js                 # LibreFM scrobbling
  multi-scrobbler.js         # Orchestrates all scrobbler integrations
  accounts/
    auth.js                  # Firebase authentication (Google OAuth, email/password)
    config.js                # Firebase configuration
    pocketbase.js            # PocketBase database sync
  visualizers/
    lcd.js                   # LCD-style visualizer
    particles.js             # Particle effect visualizer
    unknown_pleasures_webgl.js  # WebGL visualizer
functions/                   # Cloudflare Functions (server-side metadata/OG tags)
  album/[id].js
  artist/[id].js
  track/[id].js
  playlist/[id].js
  userplaylist/[id].js
public/                      # Static assets
  assets/                    # Images and icons
  manifest.json              # PWA manifest
  instances.json             # API instance list
index.html                   # Single HTML entry point (~225KB)
styles.css                   # All styles (~113KB, monolithic)
vite.config.js               # Vite + PWA configuration
```

### Key Patterns

**Module initialization**: `app.js` is the entry point. It imports all core modules and initializes them in order: storage -> database -> API -> player -> UI -> events -> service worker. Heavy modules (settings, downloads, tracker, metadata) are lazy-loaded:

```javascript
let settingsModule = null;
async function loadSettingsModule() {
    if (!settingsModule) {
        settingsModule = await import('./settings.js');
    }
    return settingsModule;
}
```

**Core classes**:
- `LosslessAPI` (api.js) - API client with multi-instance failover and rate-limit handling
- `Player` (player.js) - Audio playback with HTML5 Audio, dash.js, Web Audio API
- `UIRenderer` (ui.js) - All DOM manipulation, one method per page type (renderAlbumPage, renderArtistPage, etc.)
- `MusicDatabase` (db.js) - IndexedDB wrapper for persistent data

**Storage layers**:
- `localStorage` - User preferences, volume, quality settings, API instances
- `IndexedDB` - Large data: favorites, history, playlists, folders
- `sessionStorage` - Temporary queue state
- `WeakMap` (trackDataStore) - Garbage-collectable track metadata

**Routing**: Client-side path routing via `pushState`. The router in `router.js` dispatches to `ui.renderXxxPage()` methods. URL structure: `/album/123`, `/artist/456`, `/search/query`, etc. Hash routing is supported as a fallback for compatibility.

**Constants and enums**: Defined as plain objects in `utils.js`:
```javascript
export const REPEAT_MODE = { OFF: 0, ALL: 1, ONE: 2 };
export const AUDIO_QUALITIES = { HI_RES_LOSSLESS: '...', LOSSLESS: '...', HIGH: '...', LOW: '...' };
export const QUALITY_PRIORITY = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];
```

**SVG icons**: Defined as exported string constants in `utils.js` (SVG_PLAY, SVG_PAUSE, SVG_VOLUME, etc.).

**Cloudflare Functions**: The `functions/` directory contains server-side handlers for generating OpenGraph metadata for social embeds (Discord, Twitter, etc.). Each function follows the same pattern: detect bot user-agent, fetch track/album metadata from the API, return HTML with OG tags.

## Code Style

### Formatting (Prettier)

- 4-space indentation
- Semicolons required
- Single quotes
- Trailing commas (ES5 style)
- 120-character line width
- Auto end-of-line

### Linting Rules

**ESLint** (eslint.config.js):
- ES2022 with browser + node globals
- Unused variables are warnings (prefix unused args with `_`)
- `console.log`, `console.warn`, `console.error` are allowed
- Prettier integration via eslint-config-prettier
- Ignored: `dist/`, `node_modules/`, `legacy/`, `sw.js`

**Stylelint** (.stylelintrc.json):
- Extends `stylelint-config-standard`
- Relaxed rules: no-empty-source, selector-class-pattern, media-feature-range-notation, declaration-block-no-redundant-longhand-properties, color-function-notation, alpha-value-notation are all disabled
- Ignored: `dist/**/*.css`, `node_modules/**/*.css`, `legacy/**/*.css`

**HTMLHint** (.htmlhintrc):
- Standard rules: tag-pair, tagname-lowercase, attr-lowercase, attr-value-double-quotes, doctype-first, id-unique, src-not-empty, alt-require, spec-char-escape
- `head-script-disabled` is turned off (scripts in head are allowed)

### Naming Conventions

- `camelCase` for variables and functions
- `PascalCase` for classes
- `UPPER_SNAKE_CASE` for constants and enum-like objects
- Prefix unused function parameters with `_`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

**Common scopes**: `player`, `ui`, `api`, `library`, `playlists`, `lyrics`, `downloads`, `auth`, `pwa`, `settings`, `theme`

Rules: present tense, imperative mood, no capitalization, no period, under 72 characters.

### Branch Naming

- Features: `feature/feature-name`
- Bug fixes: `fix/description-of-fix`

## CI/CD

GitHub Actions (`.github/workflows/lint.yml`) runs on every push to `main` and on pull requests:

1. Installs dependencies with `bun install --frozen-lockfile`
2. Runs `bun run lint:js -- --fix` (auto-fixes, continues on error)
3. Runs `bun run lint:css -- --fix` (auto-fixes, continues on error)
4. Runs `bun run format` (auto-formats, continues on error)
5. Auto-commits any fixes via `stefanzweifel/git-auto-commit-action`
6. Runs `bun run lint:html` (validation, fails on error)

Production deployment is automatic via Cloudflare Pages when `main` is updated.

## Docker

Three Docker Compose profiles are available:

```bash
docker compose up -d                           # Production (port 3000 -> 4173)
docker compose --profile dev up -d             # Development with hot-reload (port 5173)
docker compose --profile pocketbase up -d      # With PocketBase backend (port 8090)
```

Environment variables are configured via `.env` (copy from `.env.example`).

## Important Notes for AI Assistants

- **No test framework exists.** Validate changes by running `bun run lint` and `bun run build`.
- **Single HTML file.** The `index.html` is very large (~225KB). All UI markup lives there.
- **Monolithic CSS.** All styles are in `styles.css` (~113KB). No CSS modules or preprocessors.
- **No TypeScript.** The entire codebase is vanilla JavaScript with ES modules.
- **Security**: Use `escapeHtml()` from `utils.js` when rendering user-provided content. The codebase uses string interpolation for HTML generation, so XSS prevention is manual.
- **API instances**: The app uses multiple API instances with automatic failover. Instance URLs are loaded from `public/instances.json` with hardcoded fallbacks in `storage.js`.
- **Versioned storage keys**: localStorage keys include version numbers (e.g., `monochrome-api-instances-v6`). Increment when making breaking changes to stored data formats.
- **Relative base path**: Vite is configured with `base: './'` so builds work on both Cloudflare Pages (root) and GitHub Pages (subpath).
