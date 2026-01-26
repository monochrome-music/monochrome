# Development

This project uses [Vite](https://vitejs.dev/) for local development and optimized builds.

### Prerequisites

- [Node.js](https://nodejs.org/) (Version 20+ or 22+ recommended)
- [Bun](https://bun.sh/) (or [npm](https://www.npmjs.com/))

### Getting Started

1. Install dependencies:
    ```bash
    bun install
    ```
2. Start the development server:
    ```bash
    bun run dev
    ```
    The app will be available at `http://localhost:5173/`.

### Why Vite?

- **Instant Updates**: Support for Hot Module Replacement (HMR) means changes to JS/CSS are reflected instantly in the browser.
- **Dependency Management**: No more manual path tracking or broken internal imports.
- **Automated PWA**: Service Worker generation and asset hashing are handled automatically.

## Code Quality & Linting

We use a standard stack to ensure code quality and consistency:

- **JS**: [ESLint](https://eslint.org/)
- **CSS**: [Stylelint](https://stylelint.io/)
- **HTML**: [HTMLHint](https://htmlhint.com/)
- **Formatting**: [Prettier](https://prettier.io/)

### Commands

- **Check everything:** `bun run lint`
- **Auto-format code:** `bun run format` (Runs Prettier)
- **Fix JS issues:** `bun run lint:js -- --fix`
- **Fix CSS issues:** `bun run lint:css -- --fix`

> [!IMPORTANT]
> A GitHub Action automatically runs these checks on every push and pull request. Please ensure `bun run lint` passes before committing.

## Project Structure

- `/js`: Application source code.
- `/public`: Static assets (images, manifest, instances.json) that are copied directly to the build folder.
- `index.html`: The entry point of the application.
- `vite.config.js`: Build and PWA configuration.

## Commit Messages

We use conventional Formatting for our commits, and we encourage you to do the same when contributing.

#### Examples

- "feat(playlists): shuffle playlist"
- "fix(metadata): Hi-res Corrupted Metadata"
- "refactor(downloading): refactor cancelling downloads"
- "docs(README): Capitalization Improvements"
- "chore(packages): bump up lyrics package version due to vulnerability"

A Cheatsheet For This Can Be Found [Here](https://gist.github.com/Zekfad/f51cb06ac76e2457f11c80ed705c95a3).

## Deployment

Deployment is automated via **Cloudflare Pages**.

> [!NOTE]
> The project uses a relative base path (`./`) in `vite.config.js`. This allows the exact same build artifact to work on both **Cloudflare Pages** (served from root) and **GitHub Pages** (served from `/monochrome/`), provided that Hash Routing is used.

Simply push your changes to the `main` branch.
