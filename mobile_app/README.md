# Monochrome Mobile App

Native iOS & Android app for [Monochrome](https://monochrome.tf) — the open-source, privacy-respecting, ad-free music app. Built with [Capacitor](https://capacitorjs.com/).

## Architecture

This app loads the **live website** (`https://monochrome.tf`) in a native WebView, enhanced with Capacitor plugins for native functionality:

- **No bundled web assets** — always up-to-date with the latest web version
- **Native haptic feedback** on all interactive elements
- **Background audio** playback (iOS AVAudioSession + Android foreground service)
- **Deep links** via `monochrome://` URL scheme and universal links
- **Native share sheet** integration
- **Network monitoring** with offline detection toasts
- **Safe area handling** for notched devices / Dynamic Island
- **Edge-to-edge** dark UI matching Monochrome's design

## Capacitor Plugins Used

| Plugin | Purpose |
|--------|---------|
| `@capacitor/app` | App lifecycle, back button, deep links, state changes |
| `@capacitor/browser` | Open external links in system/in-app browser |
| `@capacitor/clipboard` | Native clipboard read/write with feedback |
| `@capacitor/haptics` | Tactile feedback on buttons, long press, selection |
| `@capacitor/keyboard` | Keyboard show/hide events, layout adjustment |
| `@capacitor/local-notifications` | Sleep timer, download complete alerts |
| `@capacitor/network` | Connectivity monitoring, offline/online toasts |
| `@capacitor/preferences` | Persistent native key-value storage |
| `@capacitor/screen-orientation` | Lock/unlock orientation for visualizers |
| `@capacitor/share` | Native share sheet for tracks, albums, playlists |
| `@capacitor/splash-screen` | Branded launch screen with spinner |
| `@capacitor/status-bar` | Dark status bar, overlay mode |
| `@capacitor/toast` | Native toast messages |

## Prerequisites

- **Node.js** 18+ and **npm**
- **iOS**: macOS with Xcode 15+, CocoaPods
- **Android**: Android Studio, JDK 17+, Android SDK 35

## Setup

```bash
cd mobile_app

# Install dependencies
npm install

# Build the web shell
npm run build:web

# Sync native projects
npx cap sync
```

## Running

### iOS

```bash
# Open in Xcode
npx cap open ios

# Or run directly
npx cap run ios
```

In Xcode, select your target device/simulator and press Run.

### Android

```bash
# Open in Android Studio
npx cap open android

# Or run directly
npx cap run android
```

## Building for Release

### iOS

1. Open `ios/App/App.xcworkspace` in Xcode
2. Set your signing team in Signing & Capabilities
3. Archive via Product → Archive
4. Upload to App Store Connect

### Android

```bash
cd android
./gradlew assembleRelease   # APK
./gradlew bundleRelease     # AAB for Play Store
```

## Deep Links

The app registers the `monochrome://` URL scheme and universal links for `monochrome.tf`:

```
monochrome://track/123456
monochrome://album/789012
monochrome://artist/345678
https://monochrome.tf/track/123456  (universal link)
```

## Native Bridge API

The bridge exposes native capabilities to the web app via `window.__monochrome_*`:

```js
// Haptics
window.__monochrome_haptics.light()
window.__monochrome_haptics.success()

// Share
window.__monochrome_share({ title, text, url })

// Clipboard
window.__monochrome_clipboard.write('text')

// Toast
window.__monochrome_toast.show('Message')

// Browser
window.__monochrome_browser.open('https://...')

// Notifications
window.__monochrome_notifications.schedule({ title, body })

// Orientation
window.__monochrome_orientation.lock('landscape')

// Preferences
window.__monochrome_preferences.set('key', value)
window.__monochrome_preferences.get('key')

// Platform info
window.__monochrome_native.isNative  // true
window.__monochrome_native.platform  // 'ios' | 'android'
```

## Events

The bridge dispatches custom events the web app can listen for:

| Event | Detail | When |
|-------|--------|------|
| `monochrome:app-resume` | — | App returns to foreground |
| `monochrome:app-pause` | — | App goes to background |
| `monochrome:deep-link` | `{ url, path }` | Deep link opened |
| `monochrome:network-change` | `{ connected, connectionType }` | Network status changed |
| `monochrome:keyboard-show` | `{ height }` | Keyboard appears |
| `monochrome:keyboard-hide` | — | Keyboard dismissed |
| `monochrome:orientation-change` | `{ type }` | Screen rotated |
