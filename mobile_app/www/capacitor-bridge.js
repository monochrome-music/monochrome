/**
 * Monochrome Capacitor Bridge
 *
 * This script is injected into the live website's WebView context.
 * It connects Capacitor's native plugins to the Monochrome web app,
 * providing enhanced native functionality for iOS and Android.
 *
 * Since the app loads https://monochrome.tf/ via Capacitor's server.url,
 * Capacitor automatically injects its runtime. This bridge script
 * registers listeners and exposes native features to the web layer.
 */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Clipboard } from '@capacitor/clipboard';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { Toast } from '@capacitor/toast';

// ─── Platform Detection ────────────────────────────────────────────

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

if (!isNative) {
  console.log('[Monochrome Bridge] Running in web mode — native features disabled.');
}

// ─── Status Bar ────────────────────────────────────────────────────

async function configureStatusBar() {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: StatusBarStyle.Dark });
    if (platform === 'android') {
      await StatusBar.setBackgroundColor({ color: '#000000' });
    }
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch (e) {
    console.warn('[Bridge] StatusBar config failed:', e);
  }
}

// ─── Splash Screen ────────────────────────────────────────────────

async function hideSplash() {
  if (!isNative) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 500 });
  } catch (e) {
    console.warn('[Bridge] SplashScreen hide failed:', e);
  }
}

// ─── App Lifecycle ─────────────────────────────────────────────────

function setupAppLifecycle() {
  if (!isNative) return;

  // Handle back button (Android)
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      // If we're at root, minimize the app instead of closing
      App.minimizeApp();
    }
  });

  // Handle app state changes (foreground/background)
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      // App came to foreground — dispatch event so Monochrome can refresh
      window.dispatchEvent(new CustomEvent('monochrome:app-resume'));
    } else {
      window.dispatchEvent(new CustomEvent('monochrome:app-pause'));
    }
  });

  // Handle deep links (monochrome://track/123, etc.)
  App.addListener('appUrlOpen', ({ url }) => {
    const parsed = new URL(url);
    // Navigate to the deep link path within the app
    const path = parsed.pathname || parsed.hash?.replace('#', '') || '/';
    if (path && path !== '/') {
      window.location.hash = path;
    }
    window.dispatchEvent(new CustomEvent('monochrome:deep-link', { detail: { url, path } }));
  });

  // Handle app restoration from recent apps
  App.addListener('appRestoredResult', (data) => {
    window.dispatchEvent(new CustomEvent('monochrome:restored', { detail: data }));
  });
}

// ─── Network Monitoring ────────────────────────────────────────────

function setupNetworkMonitoring() {
  if (!isNative) return;

  Network.addListener('networkStatusChange', (status) => {
    window.dispatchEvent(new CustomEvent('monochrome:network-change', {
      detail: {
        connected: status.connected,
        connectionType: status.connectionType,
      },
    }));

    // Show native toast when connectivity changes
    if (!status.connected) {
      Toast.show({ text: 'No internet connection', duration: 'long', position: 'bottom' });
    } else {
      Toast.show({ text: 'Back online', duration: 'short', position: 'bottom' });
    }
  });
}

// ─── Keyboard Handling ─────────────────────────────────────────────

function setupKeyboard() {
  if (!isNative) return;

  Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
    document.body.classList.add('keyboard-visible');
    window.dispatchEvent(new CustomEvent('monochrome:keyboard-show', {
      detail: { height: info.keyboardHeight },
    }));
  });

  Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px');
    document.body.classList.remove('keyboard-visible');
    window.dispatchEvent(new CustomEvent('monochrome:keyboard-hide'));
  });
}

// ─── Haptic Feedback Integration ───────────────────────────────────

function setupHaptics() {
  if (!isNative) return;

  // Expose haptic methods on window for Monochrome's JS to call
  window.__monochrome_haptics = {
    light: () => Haptics.impact({ style: ImpactStyle.Light }),
    medium: () => Haptics.impact({ style: ImpactStyle.Medium }),
    heavy: () => Haptics.impact({ style: ImpactStyle.Heavy }),
    success: () => Haptics.notification({ type: NotificationType.Success }),
    warning: () => Haptics.notification({ type: NotificationType.Warning }),
    error: () => Haptics.notification({ type: NotificationType.Error }),
    selection: () => Haptics.selectionStart(),
    selectionChanged: () => Haptics.selectionChanged(),
    selectionEnd: () => Haptics.selectionEnd(),
  };

  // Auto-attach haptic feedback to interactive elements
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const el = target?.closest?.('button, [role="button"], a, .clickable, [data-haptic]');
    if (el) {
      const hapticType = el.getAttribute?.('data-haptic') || 'light';
      window.__monochrome_haptics[hapticType]?.();
    }
  }, { passive: true });

  // Haptic on long press (context menu)
  document.addEventListener('contextmenu', () => {
    Haptics.impact({ style: ImpactStyle.Heavy });
  }, { passive: true });
}

// ─── Share Integration ─────────────────────────────────────────────

function setupShare() {
  if (!isNative) return;

  // Override or supplement web share with native share sheet
  window.__monochrome_share = async ({ title, text, url }) => {
    try {
      await Share.share({ title, text, url, dialogTitle: 'Share from Monochrome' });
      return true;
    } catch (e) {
      if (e.message !== 'Share canceled') {
        console.warn('[Bridge] Share failed:', e);
      }
      return false;
    }
  };

  // Listen for share requests from the web app
  window.addEventListener('monochrome:share-request', async (e) => {
    const detail = /** @type {CustomEvent} */ (e).detail;
    await window.__monochrome_share(detail);
  });
}

// ─── Clipboard Integration ─────────────────────────────────────────

function setupClipboard() {
  if (!isNative) return;

  window.__monochrome_clipboard = {
    write: async (text) => {
      await Clipboard.write({ string: text });
      await Toast.show({ text: 'Copied to clipboard', duration: 'short', position: 'bottom' });
      Haptics.notification({ type: NotificationType.Success });
    },
    read: async () => {
      const { type, value } = await Clipboard.read();
      return { type, value };
    },
  };
}

// ─── Browser Integration (External Links) ──────────────────────────

function setupBrowser() {
  if (!isNative) return;

  // Intercept external link clicks and open in in-app browser
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const anchor = /** @type {HTMLAnchorElement | null} */ (target?.closest?.('a[href]'));
    if (!anchor) return;

    const href = anchor.href;
    if (!href) return;

    try {
      const linkUrl = new URL(href);
      const appHost = 'monochrome.tf';

      // If it's an external link (not monochrome.tf), open in system browser
      if (
        linkUrl.hostname !== appHost &&
        !linkUrl.hostname.endsWith('.' + appHost) &&
        linkUrl.hostname !== 'monochrome.samidy.com' &&
        linkUrl.protocol.startsWith('http')
      ) {
        e.preventDefault();
        e.stopPropagation();
        Browser.open({
          url: href,
          presentationStyle: 'popover',
          toolbarColor: '#000000',
        });
      }
    } catch {
      // Invalid URL, let default behavior handle it
    }
  }, { capture: true });

  // Expose browser opener for programmatic use
  window.__monochrome_browser = {
    open: (url) => Browser.open({
      url,
      presentationStyle: 'popover',
      toolbarColor: '#000000',
    }),
    close: () => Browser.close(),
  };
}

// ─── Local Notifications ───────────────────────────────────────────

async function setupNotifications() {
  if (!isNative) return;

  try {
    const perms = await LocalNotifications.requestPermissions();
    if (perms.display !== 'granted') {
      console.warn('[Bridge] Notification permission not granted');
      return;
    }
  } catch (e) {
    console.warn('[Bridge] Notification permission request failed:', e);
    return;
  }

  // Listen for notification action events
  LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
    window.dispatchEvent(new CustomEvent('monochrome:notification-action', {
      detail: notification,
    }));
  });

  // Expose notification API to web app
  window.__monochrome_notifications = {
    schedule: async ({ title, body, id, at }) => {
      await LocalNotifications.schedule({
        notifications: [{
          title,
          body,
          id: id || Date.now(),
          schedule: at ? { at: new Date(at) } : undefined,
          sound: undefined,
          smallIcon: 'ic_stat_notification',
        }],
      });
    },
    cancel: async (ids) => {
      await LocalNotifications.cancel({
        notifications: ids.map((id) => ({ id })),
      });
    },
  };
}

// ─── Screen Orientation ────────────────────────────────────────────

function setupScreenOrientation() {
  if (!isNative) return;

  window.__monochrome_orientation = {
    lock: async (orientation) => {
      await ScreenOrientation.lock({ orientation });
    },
    unlock: async () => {
      await ScreenOrientation.unlock();
    },
    get: async () => {
      return await ScreenOrientation.orientation();
    },
  };

  // Listen for orientation changes
  ScreenOrientation.addListener('screenOrientationChange', (orientation) => {
    window.dispatchEvent(new CustomEvent('monochrome:orientation-change', {
      detail: orientation,
    }));
  });
}

// ─── Preferences (Persistent Key-Value Storage) ────────────────────

function setupPreferences() {
  if (!isNative) return;

  window.__monochrome_preferences = {
    set: async (key, value) => {
      await Preferences.set({ key, value: JSON.stringify(value) });
    },
    get: async (key) => {
      const { value } = await Preferences.get({ key });
      return value ? JSON.parse(value) : null;
    },
    remove: async (key) => {
      await Preferences.remove({ key });
    },
    clear: async () => {
      await Preferences.clear();
    },
    keys: async () => {
      const { keys } = await Preferences.keys();
      return keys;
    },
  };
}

// ─── Safe Area Insets (Notch / Dynamic Island) ─────────────────────

function setupSafeAreaInsets() {
  if (!isNative) return;

  // Inject CSS custom properties for safe area handling
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --safe-area-inset-top: env(safe-area-inset-top, 0px);
      --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
      --safe-area-inset-left: env(safe-area-inset-left, 0px);
      --safe-area-inset-right: env(safe-area-inset-right, 0px);
      --keyboard-height: 0px;
    }

    /* Ensure content respects safe areas on notched devices */
    body {
      padding-top: env(safe-area-inset-top, 0px);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      padding-left: env(safe-area-inset-left, 0px);
      padding-right: env(safe-area-inset-right, 0px);
    }

    /* Adjust player bar for bottom safe area */
    body.keyboard-visible {
      padding-bottom: var(--keyboard-height, 0px);
    }
  `;
  document.head.appendChild(style);
}

// ─── Toast Integration ─────────────────────────────────────────────

function setupToast() {
  if (!isNative) return;

  window.__monochrome_toast = {
    show: async (text, duration = 'short', position = 'bottom') => {
      await Toast.show({ text, duration, position });
    },
  };
}

// ─── Initialize All Bridges ────────────────────────────────────────

async function initialize() {
  console.log(`[Monochrome Bridge] Initializing on ${platform} (native: ${isNative})`);

  // Expose platform info globally
  window.__monochrome_native = {
    isNative,
    platform,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
  };

  if (!isNative) return;

  // Configure appearance
  await configureStatusBar();
  setupSafeAreaInsets();

  // Set up plugin bridges
  setupAppLifecycle();
  setupNetworkMonitoring();
  setupKeyboard();
  setupHaptics();
  setupShare();
  setupClipboard();
  setupBrowser();
  setupScreenOrientation();
  setupPreferences();
  setupToast();
  await setupNotifications();

  // Hide splash screen after everything is initialized
  // Slight delay to let the WebView render
  setTimeout(() => hideSplash(), 500);

  console.log('[Monochrome Bridge] All native bridges initialized successfully.');
}

// Boot
initialize().catch((err) => {
  console.error('[Monochrome Bridge] Initialization failed:', err);
  // Still hide splash on error so user isn't stuck
  hideSplash();
});
