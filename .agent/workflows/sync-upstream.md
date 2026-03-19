---
description: Sync local fork with upstream monochrome-music/monochrome, preserving our custom changes
---

# Sync Upstream

Merges the latest changes from `upstream/main` (monochrome-music/monochrome) into our fork (`origin/main` = next-mmo/monochrome), preserving our custom modifications.

## Pre-flight

// turbo
1. Make sure working tree is clean (commit or stash first):
```bash
git status --short
```

If there are uncommitted changes, commit them first:
```bash
git add -A && git commit -m "wip: save before upstream sync"
```

## Fetch upstream

// turbo
2. Fetch the latest from upstream:
```bash
git fetch upstream
```

## Check what's new

// turbo
3. See what upstream has that we don't:
```bash
git log --oneline main..upstream/main | head -20
```

If empty, upstream has no new commits — you're already up to date. Stop here.

## Merge upstream

4. Merge upstream/main into our main branch:
```bash
git merge upstream/main --no-edit
```

## Handle conflicts

5. If there are merge conflicts, they will most likely be in these files (our custom modifications):
   - `vite.config.ts` — we changed `registerType` to `autoUpdate` + added `skipWaiting`/`clientsClaim`
   - `js/app.js` — our radio mode logic, PWA auto-update logic, fullscreen cover click handler
   - `js/ui.js` — our radio mode in `showFullscreenCover`, `closeFullscreenCover`, `setupFullscreenControls`, vinyl overlay
   - `styles.css` — our `.radio-mode` CSS rules at the end of the file, offline button overflow fixes
   - `index.html` — usually safe, but check radio button markup

   **Resolution strategy**: For each conflict:
   - **Keep BOTH** upstream's new features AND our custom code
   - Our radio-mode code is mostly additive (new CSS rules, extra if-blocks) so it should merge cleanly
   - If upstream changed the same function we modified, manually merge by applying our additions on top of upstream's version

   After resolving all conflicts:
   ```bash
   git add -A && git commit --no-edit
   ```

## Verify build

// turbo
6. Make sure the build still works:
```bash
npm run build
```

## Push

7. Push to our fork:
```bash
git push origin main
```

## Quick one-liner (when you're feeling lucky)

For fast syncs when you don't expect conflicts:
```bash
git fetch upstream && git merge upstream/main --no-edit && npm run build && git push origin main
```

## Tips

- **Check upstream releases**: Visit https://github.com/monochrome-music/monochrome/releases before syncing to see what changed
- **Our custom files** are mostly additive — we add new CSS sections, new if-blocks, new event handlers. Upstream rarely touches the same exact lines
- **If merge is too messy**, you can abort with `git merge --abort` and try a different approach (cherry-pick specific commits, or rebase)
