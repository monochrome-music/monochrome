# Contributing to Monochrome

Thank you for your interest in contributing to Monochrome! This guide will help you get started with development, understand our codebase, and follow our contribution workflow.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Code Quality](#code-quality)
- [Project Structure](#project-structure)
- [Contributing Workflow](#contributing-workflow)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Deployment](#deployment)
- [Questions?](#questions)

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (Version 20+ or 22+ recommended)
- [Bun](https://bun.sh/) (preferred) or [npm](https://www.npmjs.com/)

### Quick Start

1. **Fork and clone the repository:**

    ```bash
    git clone https://github.com/YOUR_USERNAME/monochrome.git
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

---

## Code Quality

We maintain high code quality standards. All code must pass our linting checks before being merged.

### Our Tool Stack

| Tool                               | Purpose            | Files    |
| ---------------------------------- | ------------------ | -------- |
| [ESLint](https://eslint.org/)      | JavaScript linting | `*.js`   |
| [Stylelint](https://stylelint.io/) | CSS linting        | `*.css`  |
| [HTMLHint](https://htmlhint.com/)  | HTML validation    | `*.html` |
| [Prettier](https://prettier.io/)   | Code formatting    | All      |

### Available Commands

```bash
# Check everything (runs all linters)
bun run lint

# Auto-format all code
bun run format

# Fix JavaScript issues automatically
bun run lint:js -- --fix

# Fix CSS issues automatically
bun run lint:css -- --fix

# Check HTML
bun run lint:html

# Check specific file types
bun run lint:js
bun run lint:css
```

> ⚠️ **Important:** A GitHub Action automatically runs `bun run lint` on every push and pull request. Please ensure all checks pass before committing.

---

## Project Structure

```
monochrome/
├── 📁 js/                    # Application source code
│   ├── components/          # UI components
│   ├── utils/               # Utility functions
│   ├── api/                 # API integration
│   └── ...
├── 📁 public/               # Static assets
│   ├── assets/             # Images, icons, fonts
│   ├── manifest.json       # PWA manifest
│   └── instances.json      # API instances configuration
├── 📄 index.html           # Application entry point
├── 📄 vite.config.js       # Build and PWA configuration
├── 📄 package.json         # Dependencies and scripts
└── 📄 README.md            # Project documentation
```

### Key Directories

- **`/js`** - All JavaScript source code
    - Keep modules focused and single-purpose
    - Use ES6+ features
    - Add JSDoc comments for complex functions

- **`/public`** - Static assets copied directly to build
    - Images should be optimized before adding
    - Keep file sizes reasonable
    - Use appropriate formats (WebP where possible)

---

## Contributing Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/description-of-fix
```

### 2. Make Your Changes

- Follow existing code style
- Write clear, self-documenting code
- Add comments for complex logic
- Update documentation if needed

### 3. Test Your Changes

```bash
# Run all linters
bun run lint

# Test the build
bun run build
```

### 4. Commit Your Changes

Follow our [commit message guidelines](#commit-message-guidelines).

```bash
git add .
git commit -m "feat(player): add keyboard shortcut for loop toggle"
```

### 5. Push and Create a Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a pull request on GitHub with:

- Clear title describing the change
- Detailed description of what changed and why
- Reference any related issues

---

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear, structured commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Description                                       |
| ---------- | ------------------------------------------------- |
| `feat`     | New feature                                       |
| `fix`      | Bug fix                                           |
| `docs`     | Documentation changes                             |
| `style`    | Code style changes (formatting, semicolons, etc.) |
| `refactor` | Code refactoring without changing behavior        |
| `perf`     | Performance improvements                          |
| `test`     | Adding or updating tests                          |
| `chore`    | Maintenance tasks (dependencies, build, etc.)     |

### Scopes

Common scopes in our project:

- `player` - Audio player functionality
- `ui` - User interface components
- `api` - API integration
- `library` - Library management
- `playlists` - Playlist functionality
- `lyrics` - Lyrics display
- `downloads` - Download functionality
- `auth` - Authentication
- `pwa` - Progressive Web App features
- `settings` - Settings/preferences
- `theme` - Theming system

### Examples

```bash
# Feature addition
feat(playlists): add shuffle playlist button

# Bug fix
fix(metadata): resolve corrupted Hi-res metadata issue

# Refactoring
refactor(downloads): simplify cancel download logic

# Documentation
docs(README): improve installation instructions

# Maintenance
chore(deps): bump lyrics package to fix vulnerability

# Style changes
style(player): fix indentation in audio controls
```

### Tips

- Use the present tense ("add feature" not "added feature")
- Use imperative mood ("move cursor to..." not "moves cursor to...")
- Don't capitalize the first letter
- No period at the end
- Keep the first line under 72 characters

📋 **Cheat Sheet:** [Conventional Commits Cheat Sheet](https://gist.github.com/Zekfad/f51cb06ac76e2457f11c80ed705c95a3)

---

## Deployment

Deployment is fully automated via **Cloudflare Pages**.

### How It Works

1. Push changes to the `main` branch
2. Cloudflare automatically builds and deploys
3. Changes are live within minutes

### Configuration Notes

The project uses a **relative base path** (`./`) in `vite.config.js`. This allows the same build artifact to work on both:

- **Cloudflare Pages** (served from root)
- **GitHub Pages** (served from `/monochrome/`)

Hash routing is used to ensure compatibility across all hosting platforms.

### Manual Deployment

If you need to deploy manually:

```bash
# Build for production
bun run build

# The `dist/` folder contains the deployable files
```

---

## Questions?

- 💬 Join our community discussions
- 🐛 Open an issue for bugs or feature requests
- 📧 Contact the maintainers

---

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

Thank you for contributing to Monochrome!
