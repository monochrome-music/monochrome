# Monochrome Music

A minimalist music streaming application designed for high-fidelity audio playback.

## Development
This project uses [Vite](https://vitejs.dev/) for local development and optimized builds.

### Prerequisites
- [Node.js](https://nodejs.org/) (Version 20+ or 22+ recommended)

### Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:5173/`.

### Why Vite?
- **Instant Updates**: Support for Hot Module Replacement (HMR) means changes to JS/CSS are reflected instantly in the browser.
- **Dependency Management**: No more manual path tracking or broken internal imports.
- **Automated PWA**: Service Worker generation and asset hashing are handled automatically.

## Project Structure
- `/js`: Application source code.
- `/public`: Static assets (images, manifest, instances.json) that are copied directly to the build folder.
- `index.html`: The entry point of the application.
- `vite.config.js`: Build and PWA configuration.

## Deployment
Deployment is automated via **GitHub Actions**.

> [!NOTE]
> The project uses a relative base path (`./`) in `vite.config.js`. This allows the exact same build artifact to work on both **Cloudflare Pages** (served from root) and **GitHub Pages** (served from `/monochrome/`), provided that Hash Routing is used.

1. Simply push your changes to the `main` branch.
2. The [Deploy to GitHub Pages](.github/workflows/deploy.yml) workflow will trigger automatically.
3. It builds the project (`npm run build`) and publishes the `dist/` folder to the `deployed-ver` branch.
