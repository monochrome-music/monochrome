# Monochrome Desktop (Tauri Fork)

![Monochrome Desktop App](https://ik.imagekit.io/shubhampathak/temp-monochrome/desktop_app.png)

This folder contains the Rust backend (`tauri`) that wraps the Monochrome web application into a fully native desktop application. It preserves the exact Vanilla JS/Vite frontend while injecting desktop capabilities.

## Setup & Commands

Run these commands from the root directory of the project:

- **Start Development Mode:** 
  ```bash
  bun run tauri:dev
  ```
- **Compile Release/Production Installer (.exe / .msi):** 
  ```bash
  bun run tauri:build
  ```

## Current Features

I've tried integrating several native desktop features without altering the original frontend:
- **Frameless Title Bar:** Native OS window borders have been replaced with a translucent title bar using Tauri's window API.
- **System Tray:** The app minimizes to the system tray instead of closing completely, allowing music to safely play in the background.
- **Global Media Keys:** Play/Pause, Next, and Previous track shortcuts on your physical keyboard work globally.
- **Native Icons:** High-fidelity `.ico` and `.icns` taskbar assets compiled from the original 512x512 logo.
- **F11 Fullscreen:** Borderless fullscreen support via the native window API.
- **Native Downloads:** Seamlessly downloads audio straight to your local `Downloads` directory.

  ![Downloads Working](https://ik.imagekit.io/shubhampathak/temp-monochrome/downloads_working.png)
  
  ![Downloads Saved](https://ik.imagekit.io/shubhampathak/temp-monochrome/downloads_saved.png)

## What Remains

- **Download Bug:** Audio files download properly to the `Downloads` folder, but track cover art currently fails to download in the Tauri wrapper.

  ![Album Cover Bug](https://ik.imagekit.io/shubhampathak/temp-monochrome/album_cover_bug.png)

- **OS Support:** Build currently only configured and explicitly tested on **Windows**. macOS and Linux configurations need to be verified.

---

## ⚠️ Important Limitations

### WebView2 Dependency
Because Tauri fundamentally relies on the native OS renderer, this desktop client **requires** the local user to have **Microsoft Edge WebView2** installed. This is bundled in almost all Windows 11 machines natively.

### RAM Usage

Task Manager can be slightly misleading in dev mode. The `Monochrome.exe` Rust wrapper uses ~11MB, while the actual web player memory is outsourced to a background **WebView2 Edge Renderer** process.

**Development Build RAM Usage**
![Development Build Memory Footprint](https://ik.imagekit.io/shubhampathak/temp-monochrome/ram_usage_dev_build.png)

**Release Build RAM Usage**
Release builds run much faster! By removing the Vite dev server and unminified maps from Chromium caching, the final application memory footprint drops lower than heavy <b>Electron-based wrappers</b> (like <b>Spotify</b>).
![Release Build Memory Footprint](https://ik.imagekit.io/shubhampathak/temp-monochrome/ram_usage_release_build.png)
