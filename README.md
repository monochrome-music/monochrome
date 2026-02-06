<p align="center">
  <a href="https://monochrome.tf">
    <img src="https://github.com/SamidyFR/monochrome/blob/main/public/assets/512.png?raw=true" alt="Monochrome Logo" width="150px">
  </a>
</p>

<h1 align="center">Monochrome</h1>

<p align="center">
  <strong>An open-source, privacy-respecting, ad-free music app.</strong>
</p>

<p align="center">
  <a href="https://monochrome.tf">Website</a> •
  <a href="https://pally.gg/p/monochrome">Donate</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="CONTRIBUTE.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/SamidyFR/monochrome/stargazers">
    <img src="https://img.shields.io/github/stars/SamidyFR/monochrome?style=for-the-badge&color=ffffff&labelColor=000000" alt="GitHub stars">
  </a>
  <a href="https://github.com/SamidyFR/monochrome/forks">
    <img src="https://img.shields.io/github/forks/SamidyFR/monochrome?style=for-the-badge&color=ffffff&labelColor=000000" alt="GitHub forks">
  </a>
  <a href="https://github.com/SamidyFR/monochrome/issues">
    <img src="https://img.shields.io/github/issues/SamidyFR/monochrome?style=for-the-badge&color=ffffff&labelColor=000000" alt="GitHub issues">
  </a>
</p>

---

## What is Monochrome?

**Monochrome** is an open-source, privacy-respecting, ad-free [TIDAL](https://tidal.com) web UI, built on top of [Hi-Fi](https://github.com/binimum/hifi-api). It provides a beautiful, minimalist interface for streaming high-quality music without the clutter of traditional streaming platforms.

<p align="center">
  <a href="https://monochrome.tf/#album/413189044">
    <img src="https://files.catbox.moe/tpgxii.png" alt="Monochrome UI" width="800">
  </a>
</p>

---

## Features

### Audio Quality

- High-quality Hi-Res/lossless audio streaming
- Support for local music files
- Intelligent API caching for improved performance

### Interface

- Dark, minimalist interface optimized for focus
- Customizable themes
- Accurate and unique audio visualizer
- Offline-capable Progressive Web App (PWA)
- Media Session API integration for system controls

### Library & Organization

- Recently Played tracking for easy history access
- Comprehensive Personal Library for favorites
- Queue management with shuffle and repeat modes
- Playlist import from other platforms
- Public playlists for social sharing
- Smart recommendations for new songs, albums & artists

### Lyrics & Metadata

- Lyrics support with karaoke mode
- Genius integration for lyrics
- Track downloads with automatic metadata embedding

### Integrations

- Account system for cross-device syncing
- Last.fm and ListenBrainz integration for scrobbling
- Unreleased music from [ArtistGrid](https://artistgrid.cx)
- Dynamic Discord Embeds
- Multiple API instance support with failover

### Power User Features

- Keyboard shortcuts for power users

---

## Quick Start

### Live Instance

Our Recommended way to use monochrome is through our official instance:

**[monochrome.tf](https://monochrome.tf)**

For alternative instances, check [INSTANCES.md](INSTANCES.md).

---

## Self-Hosting

NOTE: Accounts wont work on self-hosted instances.

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/monochrome-music/monochrome.git
cd monochrome
docker compose up -d
```

Visit `http://localhost:3000`

For PocketBase, development mode, and advanced setups, see [DOCKER.md](DOCKER.md).

### Option 2: Manual Installation

#### Prerequisites

- [Node.js](https://nodejs.org/) (Version 20+ or 22+ recommended)
- [Bun](https://bun.sh/) or [npm](https://www.npmjs.com/)

#### Local Development

1. **Clone the repository:**

    ```bash
    git clone https://github.com/SamidyFR/monochrome.git
    cd monochrome
    ```

2. **Install dependencies:**

    ```bash
    bun install
    # or
    npm install
    ```

3. **Start the development server:**

    ```bash
    bun run dev
    # or
    npm run dev
    ```

4. **Open your browser:**
   Navigate to `http://localhost:5173/`

#### Building for Production

```bash
bun run build
# or
npm run build
```

---

## Usage

### Basic Usage

1. Visit the [Website](https://monochrome.tf) or your local development server
2. Search for your favorite artists, albums, or tracks
3. Click play to start streaming
4. Use the media controls to manage playback, queue, and volume

### Keyboard Shortcuts

| Shortcut | Action         |
| -------- | -------------- |
| `Space`  | Play/Pause     |
| `→`      | Next track     |
| `←`      | Previous track |
| `↑`      | Volume up      |
| `↓`      | Volume down    |
| `M`      | Mute/Unmute    |
| `L`      | Toggle lyrics  |
| `F`      | Fullscreen     |
| `/`      | Focus search   |

### Account Features

To sync your library, history, and playlists across devices:

1. Click the "Accounts" Section
2. Sign in with Google or Email
3. Your data will automatically sync across all devices

---

## Contributing

We welcome contributions from the community! Please see our [Contributing Guide](CONTRIBUTE.md) for:

- Setting up your development environment
- Code style and linting
- Project structure
- Commit message conventions
- Deployment information

---

<p align="center">
  <a href="https://fmhy.net/audio#streaming-sites">
    <img src="https://raw.githubusercontent.com/monochrome-music/monochrome/refs/heads/main/public/assets/asseenonfmhy880x310.png" alt="As seen on FMHY" height="50">
  </a>
</p>

<p align="center">
  Made with ❤️ by the Monochrome team
</p>
