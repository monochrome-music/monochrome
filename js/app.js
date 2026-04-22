//js/app.js
import discordSvg from '../images/discord.svg?svg&size=22';
import googleSvg from '../images/google.svg?svg&size=22';
import githubSvg from '../images/github.svg?svg&size=22';
import spotifySvg from '../images/spotify.svg?svg&size=22';
import { isIos, isSafari } from './platform-detection.js';
import { hapticLight } from './haptics.js';
import { MusicAPI } from './music-api.js';
import {
    apiSettings,
    themeManager,
    nowPlayingSettings,
    fullscreenCoverClickSettings,
    downloadQualitySettings,
    sidebarSettings,
    pwaUpdateSettings,
    modalSettings,
    keyboardShortcuts,
} from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { MultiScrobbler } from './multi-scrobbler.js';
import { LyricsManager, openLyricsPanel, clearLyricsPanelSync } from './lyrics.js';
import { createRouter, updateTabTitle, navigate } from './router.js';
import { initializePlayerEvents, initializeTrackInteractions, handleTrackAction } from './events.js';
import { initializeUIInteractions } from './ui-interactions.js';
import { debounce, getShareUrl } from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { db } from './db.js';
import { showNotification } from './downloads.js';
import { syncManager } from './accounts/pocketbase.js';
import { authManager } from './accounts/auth.js';
import { registerSW } from 'virtual:pwa-register';
import { openEditProfile } from './profile.js';
import { ThemeStore } from './themeStore.js';
import './commandPalette.js';
import { initTracker } from './tracker.js';
import { initAnalytics } from './analytics.js';
import {
    parseCSV,
    parseJSPF,
    parseXSPF,
    parseXML,
    parseM3U,
    parseDynamicCSV,
    importToLibrary,
} from './playlist-importer.js';
import { modernSettings } from './ModernSettings.js';
import {
    SVG_OFFLINE,
    SVG_RIGHT_ARROW,
    SVG_LEFT_ARROW,
    SVG_ANIMATE_SPIN,
    SVG_PLAY,
    SVG_CLOSE,
    SVG_RESET,
} from './icons.js';
import { HiFiClient } from './HiFi.js';

// Capture real iOS state before spoofing (needed for background audio)
if (typeof window !== 'undefined') {
    const _ua = navigator.userAgent.toLowerCase();
    // Spoof User-Agent to bypass Google's embedded browser check
    Object.defineProperty(navigator, 'userAgent', {
        get: function () {
            return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        },
    });

    // analytics
    const plausibleScript = document.createElement('script');
    plausibleScript.async = true;
    plausibleScript.src = 'https://plausible.canine.tools/js/pa-dCMvQpiD1-AJmi8o3xviO.js';
    document.head.appendChild(plausibleScript);

    window.plausible =
        window.plausible ||
        function () {
            (window.plausible.q = window.plausible.q || []).push(arguments);
        };
    window.plausible.init =
        window.plausible.init ||
        function (i) {
            window.plausible.o = i || {};
        };
    window.plausible.init();
}

// Lazy-loaded modules
let settingsModule = null;
let downloadsModule = null;
let metadataModule = null;

async function loadSettingsModule() {
    if (!settingsModule) {
        settingsModule = await import('./settings.js');
    }
    return settingsModule;
}

async function loadDownloadsModule() {
    if (!downloadsModule) {
        downloadsModule = await import('./downloads.js');
    }
    return downloadsModule;
}

async function fetchcontributors() {
    try {
        const response = await fetch('https://api.samidy.com/api/contributors');
        if (!response.ok) return;
        const data1 = await response.json();
        if (!Array.isArray(data1)) return;

        let data = data1.filter(
            (user) => user.type !== 'Bot' && user.login !== 'edidealt' && user.login !== 'satanyahoo'
        );

        const edideaur = data.find((user) => user.login === 'edideaur');
        if (edideaur) {
            edideaur.contributions += data1.find((u) => u.login === 'edidealt')?.contributions || 0;
            edideaur.contributions += data1.find((u) => u.login === 'satanyahoo')?.contributions || 0;
        }

        data.sort((a, b) => b.contributions - a.contributions);

        const con = document.querySelector('.about-contributors');
        if (!con) return;

        data.forEach((user) => {
            const userDIV = document.createElement('div');
            userDIV.innerHTML = `
            <a href="${user.html_url}" target="_blank">
            <img src="${user.avatar_url}&s=50" alt="${user.login}" width="50" height="50" style="border-radius: 50%;" loading="lazy">
            <span>${user.login}</span>
            <span class="contrib">Contributions: ${user.contributions}</span>
            </a>
            `;
            con.appendChild(userDIV);
        });
    } catch (e) {
        const con = document.querySelector('.about-contributors-failed');
        if (!con) return;
        const userDIV = document.createElement('div');
        userDIV.innerHTML = `
        <h4 style="text-align: center; color: var(--muted-foreground);">Failed to Fetch Contributor List</h4>
        `;
        con.appendChild(userDIV);
    }
}

async function loadMetadataModule() {
    if (!metadataModule) {
        metadataModule = await import('./metadata.js');
    }
    return metadataModule;
}

function initializeCasting(audioPlayer, castBtn) {
    if (!castBtn) return;

    if ('remote' in audioPlayer) {
        audioPlayer.remote
            .watchAvailability((available) => {
                if (available) {
                    castBtn.style.display = 'flex';
                    castBtn.classList.add('available');
                }
            })
            .catch((err) => {
                console.log('Remote playback not available:', err);
                if (window.innerWidth > 768) {
                    castBtn.style.display = 'flex';
                }
            });

        castBtn.addEventListener('click', () => {
            if (!audioPlayer.src) {
                alert('Please play a track first to enable casting.');
                return;
            }
            audioPlayer.remote.prompt().catch((err) => {
                if (err.name === 'NotAllowedError') return;
                if (err.name === 'NotFoundError') {
                    alert('No remote playback devices (Chromecast/AirPlay) were found on your network.');
                    return;
                }
                console.log('Cast prompt error:', err);
            });
        });

        audioPlayer.addEventListener('playing', () => {
            if (audioPlayer.remote && audioPlayer.remote.state === 'connected') {
                castBtn.classList.add('connected');
            }
        });

        audioPlayer.addEventListener('pause', () => {
            if (audioPlayer.remote && audioPlayer.remote.state === 'disconnected') {
                castBtn.classList.remove('connected');
            }
        });
    } else if (audioPlayer.webkitShowPlaybackTargetPicker) {
        castBtn.style.display = 'flex';
        castBtn.classList.add('available');

        castBtn.addEventListener('click', () => {
            audioPlayer.webkitShowPlaybackTargetPicker();
        });

        audioPlayer.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
            if (e.availability === 'available') {
                castBtn.classList.add('available');
            }
        });

        audioPlayer.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
            if (audioPlayer.webkitCurrentPlaybackTargetIsWireless) {
                castBtn.classList.add('connected');
            } else {
                castBtn.classList.remove('connected');
            }
        });
    } else if (window.innerWidth > 768) {
        castBtn.style.display = 'flex';
        castBtn.addEventListener('click', () => {
            alert('Casting is not supported in this browser. Try Chrome for Chromecast or Safari for AirPlay.');
        });
    }
}

function initializeKeyboardShortcuts(player, _audioPlayer) {
    const keyActionMap = {
        playPause: () => {
            player.handlePlayPause();
        },
        seekForward: () => {
            player.seekForward(10);
        },
        seekBackward: () => {
            player.seekBackward(10);
        },
        nextTrack: () => {
            player.playNext();
        },
        previousTrack: () => {
            player.playPrev();
        },
        volumeUp: () => {
            player.setVolume(player.userVolume + 0.1);
        },
        volumeDown: () => {
            player.setVolume(player.userVolume - 0.1);
        },
        mute: () => {
            const el = player.activeElement;
            el.muted = !el.muted;
        },
        shuffle: () => {
            document.getElementById('shuffle-btn')?.click();
        },
        repeat: () => {
            document.getElementById('repeat-btn')?.click();
        },
        queue: () => {
            document.getElementById('queue-btn')?.click();
        },
        lyrics: () => {
            const overlay = document.getElementById('fullscreen-cover-overlay');
            const isFullscreenOpen = overlay && getComputedStyle(overlay).display !== 'none';

            if (isFullscreenOpen && UIRenderer.instance?.toggleFullscreenLyrics(overlay)) {
                return;
            }

            document.getElementById('toggle-lyrics-btn')?.click();
        },
        search: () => {
            document.getElementById('search-input')?.focus();
        },
        escape: () => {
            document.getElementById('search-input')?.blur();
            sidePanelManager.close();
            clearLyricsPanelSync(player.activeElement, sidePanelManager.panel);
        },
        visualizerNext: () => {
            if (UIRenderer.instance.visualizer?.presets?.['butterchurn']) {
                UIRenderer.instance.visualizer.presets['butterchurn'].nextPreset();
            }
        },
        visualizerPrev: () => {
            if (UIRenderer.instance.visualizer?.presets?.['butterchurn']) {
                UIRenderer.instance.visualizer.presets['butterchurn'].prevPreset();
            }
        },
        visualizerCycle: () => {
            if (UIRenderer.instance.visualizer?.presets?.['butterchurn']) {
                UIRenderer.instance.visualizer.presets['butterchurn'].toggleCycle();
            }
        },
    };

    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea, [contenteditable="true"]')) return;

        const shortcuts = keyboardShortcuts.getShortcuts();
        const pressedKey = e.key.toLowerCase();
        const hasShift = e.shiftKey;
        const hasCtrl = e.ctrlKey || e.metaKey;
        const hasAlt = e.altKey;

        for (const [action, shortcut] of Object.entries(shortcuts)) {
            if (!shortcut?.key) continue;
            const shortcutKey = shortcut.key.toLowerCase();
            const matches =
                pressedKey === shortcutKey &&
                shortcut.shift === hasShift &&
                shortcut.ctrl === hasCtrl &&
                shortcut.alt === hasAlt;

            if (matches) {
                e.preventDefault();
                const actionFn = keyActionMap[action];
                if (actionFn) {
                    actionFn();
                }
                return;
            }
        }
    });
}

async function closeFullscreenOverlay() {
    if (UIRenderer.instance?.dismissFullscreenCover) {
        await UIRenderer.instance.dismissFullscreenCover({ animate: false });
        return;
    }

    if (window.location.hash === '#fullscreen') {
        window.history.back();
    } else {
        UIRenderer.instance?.closeFullscreenCover();
    }
}

function showOfflineNotification() {
    const notification = document.createElement('div');
    notification.className = 'offline-notification';
    notification.innerHTML = `
        ${SVG_OFFLINE(20)}
        <span>You are offline. Some features may not work.</span>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function hideOfflineNotification() {
    const notification = document.querySelector('.offline-notification');
    if (notification) {
        notification.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }
}

async function disablePwaForAuthGate() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (error) {
        console.warn('Failed to unregister service workers:', error);
    }

    if ('caches' in window) {
        try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key)));
        } catch (error) {
            console.warn('Failed to clear caches:', error);
        }
    }
}

async function uploadCoverImage(file) {
    try {
        const response = await fetch(`https://worker.uploads.monochrome.qzz.io/${file.name}`, {
            method: 'PUT',
            headers: {
                'x-api-key': 'if_youre_reading_this_fuck_off',
                'Content-Type': file.type || 'application/octet-stream',
            },
            body: file,
        });

        if (!response.ok) {
            if (response.status === 413) throw new Error('File exceeds 10MB');
            throw new Error(`Upload failed: ${response.status}`);
        }

        return `https://images.monochrome.qzz.io/${await response.text()}`;
    } catch (error) {
        console.error('Cover upload error:', error);
        throw error;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await modernSettings.waitPending();

    // Request persistent storage to reduce risk of browser wiping data on updates or cleanup
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {
            // Ignore errors; persistence is a best-effort request
        });
    }

    if (import.meta.env.DEV) {
        window.monochrome = {
            HiFiClient,
            LyricsManager,
            MusicAPI,
            Player,
            UIRenderer,
        };
    }

    // Haptic feedback on every click
    document.addEventListener('click', () => hapticLight(), { capture: true });

    // Initialize analytics
    initAnalytics();

    // Populate commit info
    {
        const repo = 'https://github.com/monochrome-music/monochrome';
        // eslint-disable-next-line no-undef
        const hash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev';
        const commitLink =
            hash !== 'dev' && hash !== 'unknown'
                ? `<a href="${repo}/commit/${hash}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">${hash}</a>`
                : hash;
        const repoLink = `<a href="${repo}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">monochrome-music/monochrome</a>`;
        const html = `Commit ${commitLink} · ${repoLink}`;
        const aboutEl = document.getElementById('about-commit-info');
        const settingsEl = document.getElementById('settings-commit-info');
        if (aboutEl) aboutEl.innerHTML = html;
        if (settingsEl) settingsEl.innerHTML = html;
    }

    new ThemeStore();
    await HiFiClient.initialize({
        storage: [
            localStorage,
            ...(import.meta.env.DEV
                ? [
                      {
                          setItem: (key, value) => console.debug(`HiFiClient storage set: ${key} = ${value}`),
                          removeItem: (key) => console.debug(`HiFiClient storage remove: ${key}`),
                      },
                  ]
                : []),
        ],
        token: localStorage.getItem('hifi_token') || undefined,
        tokenExpiry: parseInt(localStorage.getItem('hifi_token_expiry') || '0'),
    });

    await MusicAPI.initialize(apiSettings);

    const audioPlayer = document.getElementById('audio-player');

    // i love ios and macos!!!! webkit fucking SUCKS BULLSHIT sorry ios/macos heads yall getting lossless only playback
    const currentQuality = localStorage.getItem('playback-quality') || 'HI_RES_LOSSLESS';
    await Player.initialize(audioPlayer, MusicAPI.instance, currentQuality);

    // Initialize tracker
    initTracker().catch(console.error);

    await fetchcontributors();
    const castBtn = document.getElementById('cast-btn');
    initializeCasting(audioPlayer, castBtn);

    await UIRenderer.initialize(MusicAPI.instance, Player.instance);

    /**
     * Scans the configured local media folder and refreshes `window.localFilesCache`.
     * Called by the folder-select button handler and by downloads.js after a
     * successful write to the local media folder.
     *
     * @param {boolean} [onlyIfAlreadyScanned=false] When true, skips the scan if
     *   `window.localFilesCache` has never been populated (i.e. the user hasn't
     *   visited the local tab yet).
     */
    async function scanLocalMediaFolder(onlyIfAlreadyScanned = false) {
        // Skip the scan if the user has never visited the local tab - they'll
        // get a fresh scan when they navigate there for the first time.
        if (onlyIfAlreadyScanned && !window.localFilesCache) return;

        // Prevent concurrent scans.
        if (window.localFilesScanInProgress) return;
        window.localFilesScanInProgress = true;

        try {
            const handle = await db.getSetting('local_folder_handle');
            if (!handle) return;

            const tracks = (window.localFilesCache = []);
            let idCounter = 0;
            const { readTrackMetadata } = await loadMetadataModule();

            // Request read permission before iterating. When the browser has
            // already granted it (e.g. within the same session or via a
            // persistent grant) this succeeds without a user gesture.
            if (typeof handle.requestPermission === 'function') {
                const permission = await handle.requestPermission({ mode: 'read' });
                if (permission !== 'granted') return;
            }

            async function scanBrowser(dirHandle) {
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file') {
                        const name = entry.name.toLowerCase();
                        if (
                            name.endsWith('.flac') ||
                            name.endsWith('.mp3') ||
                            name.endsWith('.m4a') ||
                            name.endsWith('.wav') ||
                            name.endsWith('.ogg')
                        ) {
                            const file = await entry.getFile();
                            const metadata = await readTrackMetadata(file);
                            metadata.id = `local-${idCounter++}-${file.name}`;
                            tracks.push(metadata);
                            UIRenderer.instance.renderLocalFiles(document.getElementById('library-local-container'));
                        }
                    } else if (entry.kind === 'directory') {
                        await scanBrowser(entry);
                    }
                }
            }
            await scanBrowser(handle);

            tracks.sort((a, b) => (a.artist.name || '').localeCompare(b.artist.name || ''));
            // Update only the local-files section without navigating to the library page.
            UIRenderer.instance.renderLocalFiles(document.getElementById('library-local-container'));
        } finally {
            window.localFilesScanInProgress = false;
        }

        return window.localFilesCache;
    }

    /**
     * Called by downloads.js (via window) after a successful write to the local
     * media folder so the track appears in Library > Local without the user
     * having to manually re-scan.
     *
     * When called with a `blob` and `filename` (single-track download case) it
     * performs a cheap partial update - reading metadata only from that one file
     * and inserting it into the existing cache - so the full folder does not need
     * to be re-walked.  When called with no arguments (bulk download case, or when
     * `localFilesCache` has never been populated) it falls back to a full rescan.
     */
    window.refreshLocalMediaFolder = async (blob = null, filename = null) => {
        if (blob && filename) {
            try {
                /** @type {import("./metadata.js")} */
                const { readTrackMetadata } = await loadMetadataModule();
                const baseName = filename.split('/').pop();
                const metadata = await readTrackMetadata(new Uint8Array(await blob.arrayBuffer()), {
                    filename: baseName,
                });
                const existing = window.localFilesCache || [];
                metadata.id = `local-${existing.length}-${baseName}`;
                window.localFilesCache = [...existing, metadata].sort((a, b) =>
                    (a.artist.name || '').localeCompare(b.artist.name || '')
                );
                UIRenderer.instance.renderLocalFiles(document.getElementById('library-local-container'));
            } catch {
                // Fall back to a full rescan if metadata extraction fails.
                await scanLocalMediaFolder(true);
            }
        } else {
            await scanLocalMediaFolder(!!window.localFilesCache);
        }
    };

    // Kick off a background scan of the saved local media folder on startup so
    // that the Library > Local tab is populated without requiring the user to
    // manually press "Load [folder]" every session.  The function internally
    // checks for a saved handle and (in browser mode) requests read permission,
    // so this is a silent no-op when no folder is configured or permission is not
    // yet granted.
    scanLocalMediaFolder().catch(console.error);

    const scrobbler = new MultiScrobbler();
    window.monochromeScrobbler = scrobbler;

    const lyricsManager = await LyricsManager.initialize(MusicAPI.instance);
    UIRenderer.instance.lyricsManager = lyricsManager;

    // Check browser support for local files
    const selectLocalBtn = document.getElementById('select-local-folder-btn');
    const browserWarning = document.getElementById('local-browser-warning');

    if (selectLocalBtn && browserWarning) {
        const ua = navigator.userAgent;
        const isChromeOrEdge = (ua.indexOf('Chrome') > -1 || ua.indexOf('Edg') > -1) && !/Mobile|Android/.test(ua);
        const hasFileSystemApi = 'showDirectoryPicker' in window;

        if (!isChromeOrEdge || !hasFileSystemApi) {
            selectLocalBtn.style.display = 'none';
            browserWarning.style.display = 'block';
        }
    }

    // Kuroshiro is now loaded on-demand only when needed for Asian text with Romaji mode enabled

    const currentTheme = themeManager.getTheme();
    themeManager.setTheme(currentTheme);

    // Restore sidebar state
    sidebarSettings.restoreState();

    // Render pinned items
    await UIRenderer.instance.renderPinnedItems();

    // Load settings module and initialize
    const { initializeSettings } = await loadSettingsModule();
    await initializeSettings(scrobbler, Player.instance, MusicAPI.instance, UIRenderer.instance);

    // Track sidebar navigation clicks
    document.querySelectorAll('.sidebar-nav a').forEach((link) => {
        link.addEventListener('click', () => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http')) {
                const item = link.querySelector('span')?.textContent || href;
            }
        });
    });

    await initializePlayerEvents(Player.instance, audioPlayer, scrobbler, UIRenderer.instance);
    initializeTrackInteractions(
        Player.instance,
        MusicAPI.instance,
        document.querySelector('.main-content'),
        document.getElementById('context-menu'),
        lyricsManager,
        UIRenderer.instance,
        scrobbler
    );
    initializeUIInteractions(Player.instance, MusicAPI.instance, UIRenderer.instance);
    initializeKeyboardShortcuts(Player.instance, audioPlayer);

    // Restore UI state for the current track (like button, theme)
    if (Player.instance.currentTrack) {
        UIRenderer.instance.setCurrentTrack(Player.instance.currentTrack);
    }

    document.querySelector('.now-playing-bar').addEventListener('click', async (e) => {
        if (!e.target.closest('.cover')) return;

        if (!Player.instance.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const mode = nowPlayingSettings.getMode();

        if (mode === 'lyrics') {
            const isActive = sidePanelManager.isActive('lyrics');
        } else if (mode === 'cover') {
            const overlay = document.getElementById('fullscreen-cover-overlay');
            if (overlay && overlay.style.display === 'flex') {
            } else {
            }
        }

        if (mode === 'lyrics') {
            const isActive = sidePanelManager.isActive('lyrics');

            if (isActive) {
                sidePanelManager.close();
                clearLyricsPanelSync(Player.instance.activeElement, sidePanelManager.panel);
            } else {
                openLyricsPanel(Player.instance.currentTrack, Player.instance.activeElement, lyricsManager);
            }
        } else if (mode === 'cover') {
            const overlay = document.getElementById('fullscreen-cover-overlay');
            if (overlay && overlay.style.display === 'flex') {
                await closeFullscreenOverlay();
            } else {
                const nextTrack = Player.instance.getNextTrack();
                UIRenderer.instance.showFullscreenCover(
                    Player.instance.currentTrack,
                    nextTrack,
                    lyricsManager,
                    Player.instance.activeElement
                );
            }
        } else {
            // Default to 'album' mode - navigate to album
            if (Player.instance.currentTrack.album?.id) {
                navigate(`/album/${Player.instance.currentTrack.album.id}`);
            }
        }
    });

    // Toggle Share Button visibility on switch change
    document.getElementById('playlist-public-toggle')?.addEventListener('change', (e) => {
        const shareBtn = document.getElementById('playlist-share-btn');
        if (shareBtn) shareBtn.style.display = e.target.checked ? 'flex' : 'none';
    });

    document.getElementById('close-fullscreen-cover-btn')?.addEventListener('click', async () => {
        await closeFullscreenOverlay();
    });

    document.getElementById('fullscreen-cover-overlay')?.addEventListener('click', (e) => {
        const coverImage = document.getElementById('fullscreen-cover-image');
        if (!coverImage) return;
        const isOnCoverImage = e.target.closest('#fullscreen-cover-image') || e.target.id === 'fullscreen-cover-image';
        if (!isOnCoverImage) return;

        const action = fullscreenCoverClickSettings.getAction();
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const playerInstance = Player.instance;

        switch (action) {
            case 'exit':
                closeFullscreenOverlay();
                break;
            case 'hide-ui':
                if (overlay) {
                    const isCurrentlyHidden = overlay.classList.contains('ui-hidden');
                    if (isCurrentlyHidden) {
                        overlay.classList.remove('ui-hidden');
                        const toggleBtn = document.getElementById('toggle-ui-btn');
                        if (toggleBtn) {
                            toggleBtn.classList.remove('active');
                            toggleBtn.classList.add('visible');
                            toggleBtn.title = 'Hide UI';
                        }
                    } else {
                        overlay.classList.add('ui-hidden');
                        const toggleBtn = document.getElementById('toggle-ui-btn');
                        if (toggleBtn) {
                            toggleBtn.classList.add('active');
                            toggleBtn.classList.remove('visible');
                            toggleBtn.title = 'Show UI';
                        }
                    }
                    if (UIRenderer.instance && typeof UIRenderer.instance.setupUIToggleButton === 'function') {
                        if (UIRenderer.instance.uiToggleCleanup) {
                            UIRenderer.instance.uiToggleCleanup();
                        }
                        UIRenderer.instance.setupUIToggleButton(overlay);
                    }
                }
                break;
            case 'pause-resume':
                if (playerInstance) playerInstance.handlePlayPause();
                break;
            case 'next':
                if (playerInstance) playerInstance.playNext();
                break;
            case 'previous':
                if (playerInstance) playerInstance.playPrev();
                break;
            case 'nothing':
                break;
            default:
                closeFullscreenOverlay();
        }
    });

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = isCollapsed ? SVG_RIGHT_ARROW(20) : SVG_LEFT_ARROW(20);
        }
        // Save sidebar state to localStorage
        sidebarSettings.setCollapsed(isCollapsed);
    });

    // Import tab switching in playlist modal
    document.querySelectorAll('.import-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const importType = tab.dataset.importType;

            // Update tab styles
            document.querySelectorAll('.import-tab').forEach((t) => {
                t.classList.remove('active');
                t.style.opacity = '0.7';
            });
            tab.classList.add('active');
            tab.style.opacity = '1';

            // Show/hide panels
            document.getElementById('csv-import-panel').style.display = importType === 'csv' ? 'block' : 'none';
            document.getElementById('jspf-import-panel').style.display = importType === 'jspf' ? 'block' : 'none';
            document.getElementById('xspf-import-panel').style.display = importType === 'xspf' ? 'block' : 'none';
            document.getElementById('xml-import-panel').style.display = importType === 'xml' ? 'block' : 'none';
            document.getElementById('m3u-import-panel').style.display = importType === 'm3u' ? 'block' : 'none';

            // Clear all file inputs except the active one
            document.getElementById('csv-file-input').value =
                importType === 'csv' ? document.getElementById('csv-file-input').value : '';
            document.getElementById('jspf-file-input').value =
                importType === 'jspf' ? document.getElementById('jspf-file-input').value : '';
            document.getElementById('xspf-file-input').value =
                importType === 'xspf' ? document.getElementById('xspf-file-input').value : '';
            document.getElementById('xml-file-input').value =
                importType === 'xml' ? document.getElementById('xml-file-input').value : '';
            document.getElementById('m3u-file-input').value =
                importType === 'm3u' ? document.getElementById('m3u-file-input').value : '';
        });
    });
    const spotifyBtn = document.getElementById('csv-spotify-btn');
    const appleBtn = document.getElementById('csv-apple-btn');
    const ytmBtn = document.getElementById('csv-ytm-btn');
    const spotifyGuide = document.getElementById('csv-spotify-guide');
    const appleGuide = document.getElementById('csv-apple-guide');
    const ytmGuide = document.getElementById('csv-ytm-guide');
    const inputContainer = document.getElementById('csv-input-container');

    if (spotifyBtn && appleBtn && ytmBtn) {
        spotifyBtn.addEventListener('click', () => {
            spotifyBtn.classList.remove('btn-secondary');
            spotifyBtn.classList.add('btn-primary');
            spotifyBtn.style.opacity = '1';

            appleBtn.classList.remove('btn-primary');
            appleBtn.classList.add('btn-secondary');
            appleBtn.style.opacity = '0.7';

            ytmBtn.classList.remove('btn-primary');
            ytmBtn.classList.add('btn-secondary');
            ytmBtn.style.opacity = '0.7';

            spotifyGuide.style.display = 'block';
            appleGuide.style.display = 'none';
            ytmGuide.style.display = 'none';
            inputContainer.style.display = 'block';
        });

        appleBtn.addEventListener('click', () => {
            appleBtn.classList.remove('btn-secondary');
            appleBtn.classList.add('btn-primary');
            appleBtn.style.opacity = '1';

            spotifyBtn.classList.remove('btn-primary');
            spotifyBtn.classList.add('btn-secondary');
            spotifyBtn.style.opacity = '0.7';

            ytmBtn.classList.remove('btn-primary');
            ytmBtn.classList.add('btn-secondary');
            ytmBtn.style.opacity = '0.7';

            appleGuide.style.display = 'block';
            spotifyGuide.style.display = 'none';
            ytmGuide.style.display = 'none';
            inputContainer.style.display = 'block';
        });

        ytmBtn.addEventListener('click', () => {
            ytmBtn.classList.remove('btn-secondary');
            ytmBtn.classList.add('btn-primary');
            ytmBtn.style.opacity = '1';

            spotifyBtn.classList.remove('btn-primary');
            spotifyBtn.classList.add('btn-secondary');
            spotifyBtn.style.opacity = '0.7';

            appleBtn.classList.remove('btn-primary');
            appleBtn.classList.add('btn-secondary');
            appleBtn.style.opacity = '0.7';

            ytmGuide.style.display = 'block';
            spotifyGuide.style.display = 'none';
            appleGuide.style.display = 'none';
            inputContainer.style.display = 'none';
        });
    }

    // Cover image upload functionality
    const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
    const coverFileInput = document.getElementById('playlist-cover-file-input');
    const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
    const coverUrlInput = document.getElementById('playlist-cover-input');
    const coverUploadStatus = document.getElementById('playlist-cover-upload-status');
    const coverUploadText = document.getElementById('playlist-cover-upload-text');

    let useUrlInput = false;

    coverUploadBtn?.addEventListener('click', () => {
        if (useUrlInput) return;
        coverFileInput?.click();
    });

    coverFileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Show uploading status
        coverUploadStatus.style.display = 'block';
        coverUploadText.textContent = 'Uploading...';
        coverUploadBtn.disabled = true;

        try {
            const publicUrl = await uploadCoverImage(file);
            coverUrlInput.value = publicUrl;
            coverUploadText.textContent = 'Done!';
            coverUploadText.style.color = 'var(--success)';

            setTimeout(() => {
                coverUploadStatus.style.display = 'none';
            }, 2000);
        } catch (error) {
            coverUploadText.textContent = 'Failed - try URL';
            coverUploadText.style.color = 'var(--error)';
            console.error('Upload failed:', error);
        } finally {
            coverUploadBtn.disabled = false;
        }
    });

    coverToggleUrlBtn?.addEventListener('click', () => {
        useUrlInput = !useUrlInput;
        if (useUrlInput) {
            coverUploadBtn.style.flex = '0 0 auto';
            coverUploadBtn.style.display = 'none';
            coverUrlInput.style.display = 'block';
            coverToggleUrlBtn.textContent = 'Upload';
            coverToggleUrlBtn.title = 'Switch to file upload';
        } else {
            coverUploadBtn.style.flex = '1';
            coverUploadBtn.style.display = 'flex';
            coverUrlInput.style.display = 'none';
            coverToggleUrlBtn.textContent = 'or URL';
            coverToggleUrlBtn.title = 'Switch to URL input';
        }
    });

    document.getElementById('nav-back')?.addEventListener('click', () => {
        window.history.back();
    });

    document.getElementById('nav-forward')?.addEventListener('click', () => {
        window.history.forward();
    });

    document.getElementById('toggle-lyrics-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!Player.instance.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const isActive = sidePanelManager.isActive('lyrics');

        if (isActive) {
            sidePanelManager.close();
            clearLyricsPanelSync(Player.instance.activeElement, sidePanelManager.panel);
        } else {
            openLyricsPanel(Player.instance.currentTrack, Player.instance.activeElement, lyricsManager);
        }
    });

    document.getElementById('download-current-btn')?.addEventListener('click', async () => {
        if (Player.instance.currentTrack) {
            await handleTrackAction(
                'download',
                Player.instance.currentTrack,
                Player.instance,
                MusicAPI.instance,
                lyricsManager,
                'track',
                UIRenderer.instance
            );
        }
    });

    // Auto-update lyrics when track changes
    let previousTrackId = null;
    audioPlayer.addEventListener('play', async () => {
        if (!Player.instance.currentTrack) return;

        // Update UI with current track info for theme
        UIRenderer.instance.setCurrentTrack(Player.instance.currentTrack);

        // Update Media Session with new track
        Player.instance.updateMediaSession(Player.instance.currentTrack);

        const currentTrackId = Player.instance.currentTrack.id;
        if (currentTrackId === previousTrackId) return;
        previousTrackId = currentTrackId;

        // Update lyrics panel if it's open
        if (sidePanelManager.isActive('lyrics')) {
            // Re-open forces update/refresh of content and sync
            openLyricsPanel(Player.instance.currentTrack, Player.instance.activeElement, lyricsManager, true);
        }

        // Update Fullscreen if it's open
        const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
        if (fullscreenOverlay && getComputedStyle(fullscreenOverlay).display !== 'none') {
            const nextTrack = Player.instance.getNextTrack();
            UIRenderer.instance.showFullscreenCover(
                Player.instance.currentTrack,
                nextTrack,
                lyricsManager,
                Player.instance.activeElement
            );
        }

        // DEV: Auto-open fullscreen mode if ?fullscreen=1 in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (
            urlParams.get('fullscreen') === '1' &&
            fullscreenOverlay &&
            getComputedStyle(fullscreenOverlay).display === 'none'
        ) {
            const nextTrack = Player.instance.getNextTrack();
            UIRenderer.instance.showFullscreenCover(
                Player.instance.currentTrack,
                nextTrack,
                lyricsManager,
                Player.instance.activeElement
            );
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#play-album-btn')) {
            const btn = e.target.closest('#play-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            let albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;
            // Handle /album/t/ID format
            if (albumId === 't') {
                albumId = pathParts[albumIndex + 2];
            }

            if (!albumId) return;

            try {
                const { tracks } = await MusicAPI.instance.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    // Sort tracks by disc and track number for consistent playback
                    const sortedTracks = [...tracks].sort((a, b) => {
                        const discA = a.volumeNumber ?? a.discNumber ?? 1;
                        const discB = b.volumeNumber ?? b.discNumber ?? 1;
                        if (discA !== discB) return discA - discB;
                        return a.trackNumber - b.trackNumber;
                    });

                    Player.instance.setQueue(sortedTracks, 0);
                    Player.instance.enableAutoplay();
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    Player.instance.shuffleActive = false;
                    await Player.instance.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play album:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to play album');
            }
        }

        if (e.target.closest('#shuffle-album-btn')) {
            const btn = e.target.closest('#shuffle-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            let albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;
            // Handle /album/t/ID format
            if (albumId === 't') {
                albumId = pathParts[albumIndex + 2];
            }

            if (!albumId) return;

            try {
                const { tracks } = await MusicAPI.instance.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                    Player.instance.setQueue(shuffledTracks, 0);
                    Player.instance.enableAutoplay();
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    Player.instance.shuffleActive = false;
                    await Player.instance.playTrackFromQueue();

                    const { showNotification } = await loadDownloadsModule();
                    showNotification('Shuffling album');
                }
            } catch (error) {
                console.error('Failed to shuffle album:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to shuffle album');
            }
        }

        if (e.target.closest('#shuffle-artist-btn')) {
            const btn = e.target.closest('#shuffle-artist-btn');
            if (btn.disabled) return;
            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `${SVG_ANIMATE_SPIN(18)}<span>Shuffling...</span>`;

            try {
                const artist = await MusicAPI.instance.getArtist(artistId);
                const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
                const trackSet = new Set();
                const allTracks = [];

                // Fetch full artist discography tracks (albums + EPs), deduped by track ID.
                const chunkSize = 8;
                for (let i = 0; i < allReleases.length; i += chunkSize) {
                    const chunk = allReleases.slice(i, i + chunkSize);
                    await Promise.all(
                        chunk.map(async (album) => {
                            try {
                                const { tracks } = await MusicAPI.instance.getAlbum(album.id);
                                tracks.forEach((track) => {
                                    if (!trackSet.has(track.id)) {
                                        trackSet.add(track.id);
                                        allTracks.push(track);
                                    }
                                });
                            } catch (err) {
                                console.warn(`Failed to fetch tracks for album ${album.title}:`, err);
                            }
                        })
                    );
                }

                // Fallback to artist top tracks if discography fetch yields nothing.
                if (allTracks.length === 0 && Array.isArray(artist.tracks)) {
                    artist.tracks.forEach((track) => {
                        if (!trackSet.has(track.id)) {
                            trackSet.add(track.id);
                            allTracks.push(track);
                        }
                    });
                }

                if (allTracks.length === 0) {
                    throw new Error('No tracks found for this artist');
                }

                const shuffledTracks = [...allTracks].sort(() => Math.random() - 0.5);
                Player.instance.setQueue(shuffledTracks, 0);
                Player.instance.enableAutoplay();
                const shuffleBtn = document.getElementById('shuffle-btn');
                if (shuffleBtn) shuffleBtn.classList.remove('active');
                Player.instance.shuffleActive = false;
                await Player.instance.playTrackFromQueue();

                const { showNotification } = await loadDownloadsModule();
                showNotification('Shuffling artist discography');
            } catch (error) {
                console.error('Failed to shuffle artist tracks:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to shuffle artist tracks');
            } finally {
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }
            }
        }
        if (e.target.closest('#download-mix-btn')) {
            const btn = e.target.closest('#download-mix-btn');
            if (btn.disabled) return;

            const mixId = window.location.pathname.split('/')[2];
            if (!mixId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `${SVG_ANIMATE_SPIN(20)}<span>Downloading...</span>`;

            try {
                const { mix, tracks } = await MusicAPI.instance.getMix(mixId);
                const { downloadPlaylist } = await loadDownloadsModule();
                await downloadPlaylist(
                    mix,
                    tracks,
                    MusicAPI.instance,
                    downloadQualitySettings.getQuality(),
                    lyricsManager
                );
            } catch (error) {
                console.error('Mix download failed:', error);
                alert('Failed to download mix: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#download-playlist-btn')) {
            const btn = e.target.closest('#download-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `${SVG_ANIMATE_SPIN(20)}<span>Downloading...</span>`;

            try {
                let playlist, tracks;
                let userPlaylist = await db.getPlaylist(playlistId);

                if (!userPlaylist) {
                    try {
                        userPlaylist = await syncManager.getPublicPlaylist(playlistId);
                    } catch {
                        // Not a public playlist
                    }
                }

                if (userPlaylist) {
                    playlist = { ...userPlaylist, title: userPlaylist.name || userPlaylist.title };
                    tracks = userPlaylist.tracks || [];
                } else {
                    const data = await MusicAPI.instance.getPlaylist(playlistId);
                    playlist = data.playlist;
                    tracks = data.tracks;
                }

                const { downloadPlaylist } = await loadDownloadsModule();
                await downloadPlaylist(
                    playlist,
                    tracks,
                    MusicAPI.instance,
                    downloadQualitySettings.getQuality(),
                    lyricsManager
                );
            } catch (error) {
                console.error('Playlist download failed:', error);
                alert('Failed to download playlist: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#create-playlist-btn') || e.target.closest('#library-create-playlist-card')) {
            const modal = document.getElementById('playlist-modal');
            document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-cover-input').value = '';
            document.getElementById('playlist-cover-file-input').value = '';
            document.getElementById('playlist-description-input').value = '';
            modal.dataset.editingId = '';
            document.getElementById('import-section').style.display = 'block';
            document.getElementById('csv-file-input').value = '';
            document.getElementById('ytm-url-input').value = '';
            document.getElementById('ytm-status').textContent = '';
            document.getElementById('jspf-file-input').value = '';
            document.getElementById('xspf-file-input').value = '';
            document.getElementById('xml-file-input').value = '';
            document.getElementById('m3u-file-input').value = '';

            // Reset import tabs to CSV
            document.querySelectorAll('.import-tab').forEach((tab) => {
                tab.classList.toggle('active', tab.dataset.importType === 'csv');
            });
            document.getElementById('csv-import-panel').style.display = 'block';
            document.getElementById('jspf-import-panel').style.display = 'none';
            document.getElementById('xspf-import-panel').style.display = 'none';
            document.getElementById('xml-import-panel').style.display = 'none';
            document.getElementById('m3u-import-panel').style.display = 'none';

            // Reset Public Toggle
            const publicToggle = document.getElementById('playlist-public-toggle');
            const shareBtn = document.getElementById('playlist-share-btn');
            if (publicToggle) publicToggle.checked = false;
            if (shareBtn) shareBtn.style.display = 'none';

            // Reset cover upload state
            const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
            const coverUrlInput = document.getElementById('playlist-cover-input');
            const coverUploadStatus = document.getElementById('playlist-cover-upload-status');
            const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
            if (coverUploadBtn) {
                coverUploadBtn.style.flex = '1';
                coverUploadBtn.style.display = 'flex';
            }
            if (coverUrlInput) coverUrlInput.style.display = 'none';
            if (coverUploadStatus) coverUploadStatus.style.display = 'none';
            if (coverToggleUrlBtn) {
                coverToggleUrlBtn.textContent = 'or URL';
                coverToggleUrlBtn.title = 'Switch to URL input';
            }

            modal.classList.add('active');
            document.getElementById('playlist-name-input').focus();
        }

        if (e.target.closest('#create-folder-btn') || e.target.closest('#library-create-folder-card')) {
            const modal = document.getElementById('folder-modal');
            document.getElementById('folder-name-input').value = '';
            document.getElementById('folder-cover-input').value = '';
            modal.classList.add('active');
            document.getElementById('folder-name-input').focus();
        }

        if (e.target.closest('#folder-modal-save')) {
            const name = document.getElementById('folder-name-input').value.trim();
            const cover = document.getElementById('folder-cover-input').value.trim();

            if (name) {
                const folder = await db.createFolder(name, cover);
                await syncManager.syncUserFolder(folder, 'create');
                UIRenderer.instance.renderLibraryPage();
                document.getElementById('folder-modal').classList.remove('active');
            } else {
                showNotification('Please enter a folder name.');
            }
        }

        if (e.target.closest('#folder-modal-cancel')) {
            document.getElementById('folder-modal').classList.remove('active');
        }

        if (e.target.closest('#library-liked-tracks-view-list')) {
            localStorage.setItem('libraryLikedTracksView', 'list');
            if (window.location.pathname.split('/').filter(Boolean)[0] === 'library') {
                await UIRenderer.instance.renderLibraryPage();
            }
        }
        if (e.target.closest('#library-liked-tracks-view-grid')) {
            localStorage.setItem('libraryLikedTracksView', 'grid');
            if (window.location.pathname.split('/').filter(Boolean)[0] === 'library') {
                await UIRenderer.instance.renderLibraryPage();
            }
        }

        if (e.target.closest('#delete-folder-btn')) {
            const folderId = window.location.pathname.split('/')[2];
            if (folderId && confirm('Are you sure you want to delete this folder?')) {
                await db.deleteFolder(folderId);
                // Sync deletion to cloud
                await syncManager.syncUserFolder({ id: folderId }, 'delete');
                navigate('/library');
            }
        }

        if (e.target.closest('#playlist-modal-save')) {
            let name = document.getElementById('playlist-name-input').value.trim();
            let description = document.getElementById('playlist-description-input').value.trim();
            const isPublic = document.getElementById('playlist-public-toggle')?.checked;
            const isStrictAlbumMatch = document.getElementById('strict-album-match-toggle')?.checked;

            if (name) {
                const modal = document.getElementById('playlist-modal');
                const editingId = modal.dataset.editingId;

                const handlePublicStatus = async (playlist) => {
                    playlist.isPublic = isPublic;
                    if (isPublic) {
                        try {
                            await syncManager.publishPlaylist(playlist);
                        } catch (e) {
                            console.error('Failed to publish playlist:', e);
                            alert('Failed to publish playlist. Please ensure you are logged in.');
                        }
                    } else {
                        try {
                            await syncManager.unpublishPlaylist(playlist.id);
                        } catch {
                            // Ignore error if it wasn't public
                        }
                    }
                    return playlist;
                };

                if (editingId) {
                    // Edit
                    const cover = document.getElementById('playlist-cover-input').value.trim();
                    await db.getPlaylist(editingId).then(async (playlist) => {
                        if (playlist) {
                            playlist.name = name;
                            playlist.cover = cover;
                            playlist.description = description;
                            await handlePublicStatus(playlist);
                            await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                            await syncManager.syncUserPlaylist(playlist, 'update');
                            UIRenderer.instance.renderLibraryPage();
                            // Also update current page if we are on it
                            if (window.location.pathname === `/userplaylist/${editingId}`) {
                                UIRenderer.instance.renderPlaylistPage(editingId, 'user');
                            }
                            modal.classList.remove('active');
                            delete modal.dataset.editingId;
                        }
                    });
                } else {
                    // Create
                    const csvFileInput = document.getElementById('csv-file-input');
                    const jspfFileInput = document.getElementById('jspf-file-input');
                    const xspfFileInput = document.getElementById('xspf-file-input');
                    const xmlFileInput = document.getElementById('xml-file-input');
                    const m3uFileInput = document.getElementById('m3u-file-input');

                    const importOptions = { strictArtistMatch: true, strictAlbumMatch: isStrictAlbumMatch };

                    let tracks = [];
                    let importSource = 'manual';
                    let cover = document.getElementById('playlist-cover-input').value.trim();

                    // Helper function for import progress
                    const setupProgressElements = () => {
                        const progressElement = document.getElementById('csv-import-progress');
                        const progressFill = document.getElementById('csv-progress-fill');
                        const progressCurrent = document.getElementById('csv-progress-current');
                        const progressTotal = document.getElementById('csv-progress-total');
                        const currentTrackElement = progressElement.querySelector('.current-track');
                        const currentArtistElement = progressElement.querySelector('.current-artist');
                        return {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        };
                    };

                    const isYTMActive = document.getElementById('csv-ytm-btn')?.classList.contains('btn-primary');
                    const ytmUrlInput = document.getElementById('ytm-url-input');

                    if (isYTMActive && ytmUrlInput.value.trim()) {
                        importSource = 'ytm_import';
                        const url = ytmUrlInput.value.trim();
                        const playlistId = url.split('list=')[1]?.split('&')[0];

                        const workerUrl = `https://ytmimport.samidy.workers.dev?playlistId=${playlistId}`;

                        if (!playlistId) {
                            alert("Invalid URL. Make sure it has 'list=' in it.");
                            return;
                        }

                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Fetching from YouTube...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const response = await fetch(workerUrl);
                            const songs = await response.json();

                            if (songs.error) throw new Error(songs.error);

                            currentTrackElement.textContent = `Processing ${songs.length} songs...`;

                            const headers = 'Title,Artist,URL\n';
                            const csvText =
                                headers +
                                songs
                                    .map(
                                        (s) =>
                                            `"${s.title.replace(/"/g, '""')}","${s.artist.replace(/"/g, '""')}","${s.url}"`
                                    )
                                    .join('\n');

                            const totalTracks = songs.length;
                            progressTotal.textContent = totalTracks.toString();

                            const result = await parseCSV(
                                csvText,
                                MusicAPI.instance,
                                (progress) => {
                                    const percentage = totalTracks > 0 ? (progress.current / totalTracks) * 100 : 0;
                                    progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                    progressCurrent.textContent = progress.current.toString();
                                    currentTrackElement.textContent = progress.currentTrack;
                                    if (currentArtistElement)
                                        currentArtistElement.textContent = progress.currentArtist || '';
                                },
                                importOptions
                            );

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the YouTube playlist!');
                                progressElement.style.display = 'none';
                                return;
                            }

                            console.log(`Imported ${tracks.length} tracks from YouTube`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks, name || 'Untitled');
                                }, 500);
                            }
                        } catch (err) {
                            console.error('YTM Import Error:', err);
                            alert(`Error importing from YouTube: ${err.message}`);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (jspfFileInput.files.length > 0) {
                        // Import from JSPF
                        importSource = 'jspf_import';
                        const file = jspfFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading JSPF file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const jspfText = await file.text();

                            const result = await parseJSPF(jspfText, MusicAPI.instance, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the JSPF file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from JSPF`);

                            // Auto-fill playlist metadata from JSPF if not provided
                            const jspfData = result.jspfData;
                            if (jspfData && jspfData.playlist) {
                                const playlist = jspfData.playlist;
                                if (!name && playlist.title) {
                                    name = playlist.title;
                                }
                                if (!description && playlist.annotation) {
                                    description = playlist.annotation;
                                }
                                if (!cover && playlist.image) {
                                    cover = playlist.image;
                                }
                            }

                            // Track JSPF import
                            const jspfPlaylist = result.jspfData?.playlist;
                            const jspfCreator =
                                jspfPlaylist?.creator ||
                                jspfPlaylist?.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.creator ||
                                'unknown';

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks, name || 'Untitled');
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse JSPF!', error);
                            alert('Failed to parse JSPF file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (csvFileInput.files.length > 0) {
                        const file = csvFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading CSV file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const csvText = await file.text();
                            const lines = csvText.trim().split('\n');
                            const totalItems = Math.max(0, lines.length - 1);
                            progressTotal.textContent = totalItems.toString();

                            const result = await parseDynamicCSV(
                                csvText,
                                MusicAPI.instance,
                                (progress) => {
                                    const percentage = totalItems > 0 ? (progress.current / totalItems) * 100 : 0;
                                    progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                    progressCurrent.textContent = progress.current.toString();
                                    currentTrackElement.textContent = progress.currentItem;
                                    if (currentArtistElement) {
                                        currentArtistElement.textContent = progress.type
                                            ? `Importing ${progress.type}...`
                                            : '';
                                    }
                                },
                                importOptions
                            );

                            const isLibraryImport =
                                result.albums.length > 0 ||
                                result.artists.length > 0 ||
                                Object.keys(result.playlists).length > 1;

                            if (isLibraryImport) {
                                currentTrackElement.textContent = 'Adding to library...';

                                const importResults = await importToLibrary(
                                    result,
                                    db,
                                    (progress) => {
                                        if (progress.action === 'playlist') {
                                            currentTrackElement.textContent = `Creating playlist: ${progress.item}`;
                                        } else {
                                            currentTrackElement.textContent = `Adding ${progress.action}: ${progress.item}`;
                                        }
                                    },
                                    {
                                        favoriteTracks: false,
                                        favoriteAlbums: false,
                                        favoriteArtists: false,
                                    }
                                );

                                console.log('Import results:', importResults);

                                const summary = [];
                                if (importResults.tracks.added > 0)
                                    summary.push(`${importResults.tracks.added} tracks`);
                                if (importResults.albums.added > 0)
                                    summary.push(`${importResults.albums.added} albums`);
                                if (importResults.artists.added > 0)
                                    summary.push(`${importResults.artists.added} artists`);
                                if (importResults.playlists.created > 0)
                                    summary.push(`${importResults.playlists.created} playlists`);

                                alert(
                                    `Imported to library:\n${summary.join(', ')}\n\n${
                                        result.missingItems.length > 0
                                            ? `${result.missingItems.length} items could not be found.`
                                            : ''
                                    }`
                                );
                                progressElement.style.display = 'none';
                            }

                            tracks = result.tracks;
                            const missingTracks = result.missingItems.filter((i) => i.type === 'track');

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the CSV file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from CSV`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks, name || 'Untitled');
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse CSV!', error);
                            alert('Failed to parse CSV file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (xspfFileInput.files.length > 0) {
                        // Import from XSPF
                        importSource = 'xspf_import';
                        const file = xspfFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading XSPF file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const xspfText = await file.text();

                            const result = await parseXSPF(xspfText, MusicAPI.instance, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the XSPF file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from XSPF`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks, name || 'Untitled');
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse XSPF!', error);
                            alert('Failed to parse XSPF file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (xmlFileInput.files.length > 0) {
                        // Import from XML
                        importSource = 'xml_import';
                        const file = xmlFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading XML file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const xmlText = await file.text();

                            const result = await parseXML(xmlText, MusicAPI.instance, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the XML file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from XML`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks, name || 'Untitled');
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse XML!', error);
                            alert('Failed to parse XML file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    } else if (m3uFileInput.files.length > 0) {
                        // Import from M3U/M3U8
                        importSource = 'm3u_import';
                        const file = m3uFileInput.files[0];
                        const {
                            progressElement,
                            progressFill,
                            progressCurrent,
                            progressTotal,
                            currentTrackElement,
                            currentArtistElement,
                        } = setupProgressElements();

                        try {
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading M3U file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const m3uText = await file.text();

                            const result = await parseM3U(m3uText, MusicAPI.instance, (progress) => {
                                const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                progressTotal.textContent = progress.total.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the M3U file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from M3U`);

                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks, name || 'Untitled');
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse M3U!', error);
                            alert('Failed to parse M3U file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    }

                    // Check for pending tracks (from Add to Playlist -> New Playlist)
                    const modal = document.getElementById('playlist-modal');
                    if (modal._pendingTracks && Array.isArray(modal._pendingTracks)) {
                        tracks = [...tracks, ...modal._pendingTracks];
                        delete modal._pendingTracks;
                        // Also clear CSV input if we came from there? No, keep it separate.
                        console.log(`Added ${tracks.length} tracks (including pending)`);
                    }

                    await db.createPlaylist(name, tracks, cover, description).then(async (playlist) => {
                        await handlePublicStatus(playlist);
                        // Update DB again with isPublic flag
                        await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                        await syncManager.syncUserPlaylist(playlist, 'create');
                        UIRenderer.instance.renderLibraryPage();
                        modal.classList.remove('active');
                    });
                }
            } else {
                showNotification('Please enter a playlist name.');
            }
        }

        if (e.target.closest('#playlist-modal-cancel')) {
            document.getElementById('playlist-modal').classList.remove('active');
        }

        if (e.target.closest('.edit-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            await db.getPlaylist(playlistId).then(async (playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';
                    document.getElementById('playlist-description-input').value = playlist.description || '';

                    // Set Public Toggle
                    const publicToggle = document.getElementById('playlist-public-toggle');
                    const shareBtn = document.getElementById('playlist-share-btn');

                    // Check if actually public in Pocketbase to be sure (async) or trust local flag
                    // We trust local flag for UI speed, but could verify.
                    if (publicToggle) publicToggle.checked = !!playlist.isPublic;

                    if (shareBtn) {
                        shareBtn.style.display = playlist.isPublic ? 'flex' : 'none';
                        shareBtn.onclick = () => {
                            const url = getShareUrl(`/userplaylist/${playlist.id}`);
                            navigator.clipboard
                                .writeText(url)
                                .then(() => alert('Link copied to clipboard!'))
                                .catch(console.error);
                        };
                    }

                    // Set cover upload state - show URL input if there's an existing cover
                    const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
                    const coverUrlInput = document.getElementById('playlist-cover-input');
                    const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
                    if (playlist.cover) {
                        if (coverUploadBtn) coverUploadBtn.style.display = 'none';
                        if (coverUrlInput) coverUrlInput.style.display = 'block';
                        if (coverToggleUrlBtn) {
                            coverToggleUrlBtn.textContent = 'Upload';
                            coverToggleUrlBtn.title = 'Switch to file upload';
                        }
                    } else {
                        if (coverUploadBtn) {
                            coverUploadBtn.style.flex = '1';
                            coverUploadBtn.style.display = 'flex';
                        }
                        if (coverUrlInput) coverUrlInput.style.display = 'none';
                        if (coverToggleUrlBtn) {
                            coverToggleUrlBtn.textContent = 'or URL';
                            coverToggleUrlBtn.title = 'Switch to URL input';
                        }
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        if (e.target.closest('.delete-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            if (confirm('Are you sure you want to delete this playlist?')) {
                await db.deletePlaylist(playlistId);
                await syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                UIRenderer.instance.renderLibraryPage();
            }
        }

        if (e.target.closest('#edit-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            await db
                .getPlaylist(playlistId)
                .then((playlist) => {
                    if (playlist) {
                        const modal = document.getElementById('playlist-modal');
                        document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                        document.getElementById('playlist-name-input').value = playlist.name;
                        document.getElementById('playlist-cover-input').value = playlist.cover || '';
                        document.getElementById('playlist-description-input').value = playlist.description || '';

                        const publicToggle = document.getElementById('playlist-public-toggle');
                        const shareBtn = document.getElementById('playlist-share-btn');

                        if (publicToggle) publicToggle.checked = !!playlist.isPublic;
                        if (shareBtn) {
                            shareBtn.style.display = playlist.isPublic ? 'flex' : 'none';
                            shareBtn.onclick = async () => {
                                const url = getShareUrl(`/userplaylist/${playlist.id}`);
                                await navigator.clipboard
                                    .writeText(url)
                                    .then(() => alert('Link copied to clipboard!'))
                                    .catch(console.error);
                            };
                        }

                        // Set cover upload state - show URL input if there's an existing cover
                        const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
                        const coverUrlInput = document.getElementById('playlist-cover-input');
                        const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
                        if (playlist.cover) {
                            if (coverUploadBtn) coverUploadBtn.style.display = 'none';
                            if (coverUrlInput) coverUrlInput.style.display = 'block';
                            if (coverToggleUrlBtn) {
                                coverToggleUrlBtn.textContent = 'Upload';
                                coverToggleUrlBtn.title = 'Switch to file upload';
                            }
                        } else {
                            if (coverUploadBtn) {
                                coverUploadBtn.style.flex = '1';
                                coverUploadBtn.style.display = 'flex';
                            }
                            if (coverUrlInput) coverUrlInput.style.display = 'none';
                            if (coverToggleUrlBtn) {
                                coverToggleUrlBtn.textContent = 'or URL';
                                coverToggleUrlBtn.title = 'Switch to URL input';
                            }
                        }

                        modal.dataset.editingId = playlistId;
                        document.getElementById('import-section').style.display = 'none';
                        modal.classList.add('active');
                        document.getElementById('playlist-name-input').focus();
                    }
                })
                .catch(console.error);
        }

        if (e.target.closest('#delete-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            if (confirm('Are you sure you want to delete this playlist?')) {
                await db.deletePlaylist(playlistId);
                await syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                navigate('/library');
            }
        }

        if (e.target.closest('.remove-from-playlist-btn')) {
            e.stopPropagation();
            const btn = e.target.closest('.remove-from-playlist-btn');
            const playlistId = window.location.pathname.split('/')[2];

            await db.getPlaylist(playlistId).then(async (playlist) => {
                let trackId = null;
                let trackType = null;

                // Prefer ID if available (from sorted view)
                if (btn.dataset.trackId) {
                    trackId = btn.dataset.trackId;
                    trackType = btn.dataset.type || 'track';
                } else if (btn.dataset.trackIndex) {
                    // Fallback to index (legacy/unsorted)
                    const index = parseInt(btn.dataset.trackIndex);
                    if (playlist && playlist.tracks[index]) {
                        trackId = playlist.tracks[index].id;
                        trackType = playlist.tracks[index].type || 'track';
                    }
                }

                if (trackId) {
                    const updatedPlaylist = await db.removeTrackFromPlaylist(playlistId, trackId, trackType);
                    await syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                    const scrollTop = document.querySelector('.main-content').scrollTop;
                    await UIRenderer.instance.renderPlaylistPage(playlistId, 'user');
                    document.querySelector('.main-content').scrollTop = scrollTop;
                }
            });
        }

        if (e.target.closest('#play-playlist-btn')) {
            const btn = e.target.closest('#play-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            try {
                let tracks;
                const userPlaylist = await db.getPlaylist(playlistId);
                if (userPlaylist) {
                    tracks = userPlaylist.tracks;
                } else {
                    // Try API, if fail, try Public Pocketbase
                    try {
                        const { tracks: apiTracks } = await MusicAPI.instance.getPlaylist(playlistId);
                        tracks = apiTracks;
                    } catch (e) {
                        const publicPlaylist = await syncManager.getPublicPlaylist(playlistId);
                        if (publicPlaylist) {
                            tracks = publicPlaylist.tracks;
                        } else {
                            throw e;
                        }
                    }
                }
                if (tracks.length > 0) {
                    Player.instance.setQueue(tracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    await Player.instance.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play playlist:', error);
                alert('Failed to play playlist: ' + error.message);
            }
        }

        if (e.target.closest('#download-album-btn')) {
            const btn = e.target.closest('#download-album-btn');
            if (btn.disabled) return;

            const albumId = window.location.pathname.split('/')[2];
            if (!albumId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `${SVG_ANIMATE_SPIN(20)}<span>Downloading...</span>`;

            try {
                const { album, tracks } = await MusicAPI.instance.getAlbum(albumId);
                const { downloadAlbum } = await loadDownloadsModule();
                await downloadAlbum(
                    album,
                    tracks,
                    MusicAPI.instance,
                    downloadQualitySettings.getQuality(),
                    lyricsManager
                );
            } catch (error) {
                console.error('Album download failed:', error);
                alert('Failed to download album: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#add-album-to-playlist-btn')) {
            const btn = e.target.closest('#add-album-to-playlist-btn');
            if (btn.disabled) return;

            const albumId = window.location.pathname.split('/')[2];
            if (!albumId) return;

            try {
                const { tracks } = await MusicAPI.instance.getAlbum(albumId);

                if (!tracks || tracks.length === 0) {
                    const { showNotification } = await loadDownloadsModule();
                    showNotification('No tracks found in this album.');
                    return;
                }

                const modal = document.getElementById('playlist-select-modal');
                const list = document.getElementById('playlist-select-list');
                const cancelBtn = document.getElementById('playlist-select-cancel');
                const overlay = modal.querySelector('.modal-overlay');

                const playlists = await db.getPlaylists(false);

                list.innerHTML =
                    `
                    <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                        <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
                    </div>
                ` +
                    playlists
                        .map(
                            (p) => `
                    <div class="modal-option" data-id="${p.id}">
                        <span>${p.name}</span>
                    </div>
                `
                        )
                        .join('');

                const closeModal = () => {
                    modal.classList.remove('active');
                    cleanup();
                };

                const handleOptionClick = async (e) => {
                    const option = e.target.closest('.modal-option');
                    if (!option) return;

                    if (option.classList.contains('create-new-option')) {
                        closeModal();
                        const createModal = document.getElementById('playlist-modal');
                        document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
                        document.getElementById('playlist-name-input').value = '';
                        document.getElementById('playlist-cover-input').value = '';
                        createModal.dataset.editingId = '';
                        document.getElementById('import-section').style.display = 'none'; // Hide import for simple add

                        // Pass tracks
                        createModal._pendingTracks = tracks;

                        createModal.classList.add('active');
                        document.getElementById('playlist-name-input').focus();
                        return;
                    }

                    const playlistId = option.dataset.id;

                    try {
                        await db.addTracksToPlaylist(playlistId, tracks);
                        const updatedPlaylist = await db.getPlaylist(playlistId);
                        await syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                        const { showNotification } = await loadDownloadsModule();
                        showNotification(`Added ${tracks.length} tracks to playlist.`);
                        closeModal();
                    } catch (err) {
                        console.error(err);
                        const { showNotification } = await loadDownloadsModule();
                        showNotification('Failed to add tracks.');
                    }
                };

                const cleanup = () => {
                    cancelBtn.removeEventListener('click', closeModal);
                    overlay.removeEventListener('click', closeModal);
                    list.removeEventListener('click', handleOptionClick);
                };

                cancelBtn.addEventListener('click', closeModal);
                overlay.addEventListener('click', closeModal);
                list.addEventListener('click', handleOptionClick);

                modal.classList.add('active');
            } catch (error) {
                console.error('Failed to prepare album for playlist:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to load album tracks.');
            }
        }

        if (e.target.closest('#play-artist-radio-btn')) {
            const btn = e.target.closest('#play-artist-radio-btn');
            if (btn.disabled) return;

            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `${SVG_ANIMATE_SPIN(20)}<span>Loading...</span>`;

            try {
                const artist = await MusicAPI.instance.getArtist(artistId);

                const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
                if (allReleases.length === 0) {
                    throw new Error('No albums or EPs found for this artist');
                }

                const trackSet = new Set();
                const allTracks = [];

                const chunks = [];
                const chunkSize = 3;
                const albums = allReleases;

                for (let i = 0; i < albums.length; i += chunkSize) {
                    chunks.push(albums.slice(i, i + chunkSize));
                }

                for (const chunk of chunks) {
                    await Promise.all(
                        chunk.map(async (album) => {
                            try {
                                const { tracks } = await MusicAPI.instance.getAlbum(album.id);
                                tracks.forEach((track) => {
                                    if (!trackSet.has(track.id)) {
                                        trackSet.add(track.id);
                                        allTracks.push(track);
                                    }
                                });
                            } catch (err) {
                                console.warn(`Failed to fetch tracks for album ${album.title}:`, err);
                            }
                        })
                    );
                }

                if (allTracks.length > 0) {
                    for (let i = allTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
                    }

                    Player.instance.setQueue(allTracks, 0);
                    await Player.instance.playTrackFromQueue();
                } else {
                    throw new Error('No tracks found across all albums');
                }
            } catch (error) {
                console.error('Artist radio failed:', error);
                alert('Failed to start artist radio: ' + error.message);
            } finally {
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }
            }
        }

        if (e.target.closest('#shuffle-liked-tracks-btn')) {
            const btn = e.target.closest('#shuffle-liked-tracks-btn');
            if (btn.disabled) return;

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length > 0) {
                    // Shuffle array
                    for (let i = likedTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [likedTracks[i], likedTracks[j]] = [likedTracks[j], likedTracks[i]];
                    }
                    Player.instance.setQueue(likedTracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    await Player.instance.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to shuffle liked tracks:', error);
            }
        }

        if (e.target.closest('#download-liked-tracks-btn')) {
            const btn = e.target.closest('#download-liked-tracks-btn');
            if (btn.disabled) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = SVG_ANIMATE_SPIN(16);

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length === 0) {
                    alert('No liked tracks to download.');
                    return;
                }
                const { downloadLikedTracks } = await loadDownloadsModule();
                await downloadLikedTracks(
                    likedTracks,
                    MusicAPI.instance,
                    downloadQualitySettings.getQuality(),
                    lyricsManager
                );
            } catch (error) {
                console.error('Liked tracks download failed:', error);
                alert('Failed to download liked tracks: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#download-discography-btn')) {
            const btn = e.target.closest('#download-discography-btn');
            if (btn.disabled) return;

            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            try {
                const artist = await MusicAPI.instance.getArtist(artistId);
                showDiscographyDownloadModal(
                    artist,
                    MusicAPI.instance,
                    downloadQualitySettings.getQuality(),
                    lyricsManager,
                    btn
                );
            } catch (error) {
                console.error('Failed to load artist for discography download:', error);
                alert('Failed to load artist: ' + error.message);
            }
        }

        // Local Files Logic lollll
        if (e.target.closest('#select-local-folder-btn') || e.target.closest('#change-local-folder-btn')) {
            const isChange = e.target.closest('#change-local-folder-btn') !== null;
            try {
                const handle = await window.showDirectoryPicker({
                    id: 'music-folder',
                    mode: 'read',
                });

                await db.saveSetting('local_folder_handle', handle);

                const btn = document.getElementById('select-local-folder-btn');
                const btnText = document.getElementById('select-local-folder-text');
                if (btn) {
                    if (btnText) btnText.textContent = 'Scanning...';
                    else btn.textContent = 'Scanning...';
                    btn.disabled = true;
                }

                const tracks = scanLocalMediaFolder(true);
                UIRenderer.instance.renderLibraryPage();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error selecting folder:', err);
                    alert('Failed to access folder. Please try again.');
                }
                const btn = document.getElementById('select-local-folder-btn');
                const btnText = document.getElementById('select-local-folder-text');
                if (btn) {
                    if (btnText) btnText.textContent = 'Select Music Folder';
                    else btn.textContent = 'Select Music Folder';
                    btn.disabled = false;
                }
            }
        }
    });

    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');

    UIRenderer.instance.setupSearchClearButton(searchInput);

    const performSearch = (query) => {
        if (query) {
            navigate(`/search/${encodeURIComponent(query)}`);
        }
    };

    const debouncedSearch = debounce((query) => {
        if (query && query === searchInput.value.trim()) {
            performSearch(query);
        }
    }, 3000);

    const handleExternalLink = (query) => {
        const isExternalLink =
            query.includes('monochrome.tf/') ||
            query.includes('monochrome.samidy.com/') ||
            query.includes('tidal.com/');

        if (isExternalLink) {
            const url = query.startsWith('http') ? query : 'https://' + query;
            try {
                const urlObj = new URL(url);
                let path = urlObj.pathname;
                path = path.replace(/\/+$/, '');
                const segments = path.split('/').filter((s) => s);
                if (segments.length >= 2) {
                    path = '/' + segments[0] + '/' + segments[1];
                }
                navigate(path);
                return true;
            } catch {
                return false;
            }
        }
        return false;
    };

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) return;

        if (handleExternalLink(query)) {
            return;
        }

        debouncedSearch(query);
    });

    searchInput.addEventListener('change', (e) => {
        const query = e.target.value.trim();
        if (query) {
            UIRenderer.instance.addToSearchHistory(query);
        }
    });

    searchInput.addEventListener('focus', () => {
        UIRenderer.instance.renderSearchHistory();
    });

    searchInput.addEventListener('click', () => {
        UIRenderer.instance.renderSearchHistory();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-bar')) {
            const historyEl = document.getElementById('search-history');
            if (historyEl) historyEl.style.display = 'none';
        }
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;

        if (!handleExternalLink(query)) {
            UIRenderer.instance.addToSearchHistory(query);
            performSearch(query);
            const historyEl = document.getElementById('search-history');
            if (historyEl) historyEl.style.display = 'none';
        }
    });

    window.addEventListener('online', () => {
        hideOfflineNotification();
        console.log('Back online');
    });

    window.addEventListener('offline', () => {
        showOfflineNotification();
        console.log('Gone offline');
    });

    document.querySelector('.now-playing-bar .play-pause-btn').innerHTML = SVG_PLAY(20);

    const router = createRouter(UIRenderer.instance);

    const handleRouteChange = async (event) => {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const isFullscreenOpen = overlay && getComputedStyle(overlay).display === 'flex';

        if (isFullscreenOpen && window.location.hash !== '#fullscreen') {
            UIRenderer.instance.closeFullscreenCover();
        }

        if (event && event.state && event.state.exitTrap) {
            const { showNotification } = await loadDownloadsModule();
            showNotification('Press back again to exit');
            setTimeout(() => {
                if (history.state && history.state.exitTrap) {
                    history.pushState({ app: true }, '', window.location.pathname);
                }
            }, 2000);
            return;
        }

        // Intercept back navigation to close modals first if setting is enabled
        if (event && modalSettings.shouldInterceptBackToClose() && modalSettings.hasOpenModalsOrPanels()) {
            sidePanelManager.close();
            modalSettings.closeAllModals();
            history.pushState(history.state || { app: true }, '', window.location.pathname);
            return;
        }

        // Close side panel (queue/lyrics) and modals on navigation if setting is enabled
        if (modalSettings.shouldCloseOnNavigation()) {
            sidePanelManager.close();
            modalSettings.closeAllModals();
        }

        await router();
        updateTabTitle(Player.instance);
    };

    await handleRouteChange();

    window.addEventListener('popstate', handleRouteChange);

    document.body.addEventListener('click', (e) => {
        const link = e.target.closest('a');

        if (
            link &&
            link.origin === window.location.origin &&
            link.target !== '_blank' &&
            !link.hasAttribute('download')
        ) {
            e.preventDefault();
            navigate(link.pathname);
        }
    });

    audioPlayer.addEventListener('play', () => {
        updateTabTitle(Player.instance);
    });

    // PWA Update Logic
    if (window.__AUTH_GATE__) {
        await disablePwaForAuthGate().catch(console.error);
    } else {
        const updateSW = registerSW({
            onNeedRefresh() {
                if (pwaUpdateSettings.isAutoUpdateEnabled()) {
                    // Auto-update: immediately activate the new service worker
                    updateSW(true);
                } else {
                    // Show notification with Update button and dismiss option
                    showUpdateNotification(() => {
                        updateSW(true);
                    });
                }
            },
            onOfflineReady() {
                console.log('App ready to work offline');
            },
        });
    }

    document.getElementById('show-shortcuts-btn')?.addEventListener('click', () => {
        showKeyboardShortcuts();
    });

    document.getElementById('customize-shortcuts-btn')?.addEventListener('click', () => {
        showCustomizeShortcutsModal();
    });

    // Font Settings
    const fontSelect = document.getElementById('font-select');
    if (fontSelect) {
        const savedFont = localStorage.getItem('monochrome-font');
        if (savedFont) {
            fontSelect.value = savedFont;
        }
        fontSelect.addEventListener('change', (e) => {
            const font = e.target.value;
            document.documentElement.style.setProperty('--font-family', font);
            localStorage.setItem('monochrome-font', font);
        });
    }

    // Listener for Pocketbase Sync updates
    window.addEventListener('library-changed', () => {
        const path = window.location.pathname;
        if (path === '/library') {
            UIRenderer.instance.renderLibraryPage();
        } else if (path === '/' || path === '/home') {
            UIRenderer.instance.renderHomePage();
        } else if (path.startsWith('/userplaylist/')) {
            const playlistId = path.split('/')[2];
            const content = document.querySelector('.main-content');
            const scroll = content ? content.scrollTop : 0;
            UIRenderer.instance.renderPlaylistPage(playlistId, 'user').then(() => {
                if (content) content.scrollTop = scroll;
            });
        }
    });
    window.addEventListener('history-changed', () => {
        const path = window.location.pathname;
        if (path === '/recent') {
            UIRenderer.instance.renderRecentPage();
        }
    });

    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (contextMenu.style.display === 'block') {
                        const track = contextMenu._contextTrack;
                        const albumItem = contextMenu.querySelector('[data-action="go-to-album"]');

                        if (track) {
                            if (albumItem) {
                                let label = 'album';
                                const albumType = track.album?.type?.toUpperCase();
                                const trackCount = track.album?.numberOfTracks;

                                if (albumType === 'SINGLE' || trackCount === 1) label = 'single';
                                else if (albumType === 'EP') label = 'EP';
                                else if (trackCount && trackCount <= 6) label = 'EP';

                                albumItem.textContent = `Go to ${label}`;
                                albumItem.style.display = track.album ? 'block' : 'none';
                            }
                        }
                    }
                }
            });
        });

        observer.observe(contextMenu, { attributes: true });
    }

    const headerAccountBtn = document.getElementById('header-account-btn');
    const headerAccountDropdown = document.getElementById('header-account-dropdown');
    const headerAccountImg = document.getElementById('header-account-img');
    const headerAccountIcon = document.getElementById('header-account-icon');

    // Temporarily disable accounts - show popup
    const isAccountsDisabled = false;

    if (headerAccountBtn && headerAccountDropdown) {
        if (isAccountsDisabled) {
            headerAccountBtn.style.opacity = '0.5';
            headerAccountBtn.style.cursor = 'not-allowed';
            headerAccountBtn.title = 'Accounts temporarily unavailable';
            headerAccountBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                alert('.');
            });
        } else {
            headerAccountBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                headerAccountDropdown.classList.toggle('active');
                await updateAccountDropdown();
            });
        }

        document.addEventListener('click', (e) => {
            if (!headerAccountBtn.contains(e.target) && !headerAccountDropdown.contains(e.target)) {
                headerAccountDropdown.classList.remove('active');
            }
        });

        async function updateAccountDropdown() {
            const user = authManager?.user;
            headerAccountDropdown.innerHTML = '';

            if (!user) {
                const iconBtnStyle =
                    'background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;transition:opacity 0.15s';
                headerAccountDropdown.innerHTML = `
                    <span style="font-size:0.75rem;color:var(--muted-foreground);padding:0.25rem 0.5rem">Connect with</span>
                    <div style="display:flex;gap:0.5rem;padding:0.25rem 0.5rem;align-items:center">
                        <button id="header-discord-auth" title="Discord" style="${iconBtnStyle}">${discordSvg}</button>
                        <button id="header-google-auth" title="Google" style="${iconBtnStyle}">${googleSvg}</button>
                        <button id="header-github-auth" title="GitHub" style="${iconBtnStyle}">${githubSvg}</button>
                        <button id="header-spotify-auth" title="Spotify" style="${iconBtnStyle}">${spotifySvg}</button>
                    </div>
                    <hr style="border:none;border-top:1px solid var(--border);margin:0.25rem 0">
                    <button class="btn-secondary" id="header-email-auth">Connect with Email</button>
                `;

                for (const id of [
                    'header-discord-auth',
                    'header-google-auth',
                    'header-github-auth',
                    'header-spotify-auth',
                ]) {
                    const btn = document.getElementById(id);
                    const svg = btn.querySelector('svg');
                    svg.style.filter = 'brightness(0) invert(1)';
                    svg.style.transition = 'filter 0.15s';
                    btn.addEventListener('mouseenter', () => {
                        svg.style.filter = 'brightness(0) invert(0.5)';
                    });
                    btn.addEventListener('mouseleave', () => {
                        svg.style.filter = 'brightness(0) invert(1)';
                    });
                }

                document.getElementById('header-google-auth').onclick = () => authManager.signInWithGoogle();
                document.getElementById('header-github-auth').onclick = () => authManager.signInWithGitHub();
                document.getElementById('header-discord-auth').onclick = () => authManager.signInWithDiscord();
                document.getElementById('header-spotify-auth').onclick = () => authManager.signInWithSpotify();
                document.getElementById('header-email-auth').onclick = () => {
                    document.getElementById('email-auth-modal').classList.add('active');
                    headerAccountDropdown.classList.remove('active');
                };
            } else {
                const data = await syncManager.getUserData();
                const hasProfile = data && data.profile && data.profile.username;

                if (hasProfile) {
                    headerAccountDropdown.innerHTML = `
                        <button class="btn-secondary" id="header-view-profile">My Profile</button>
                        <button class="btn-secondary danger" id="header-sign-out">Sign Out</button>
                    `;
                    document.getElementById('header-view-profile').onclick = () => {
                        navigate(`/user/@${data.profile.username}`);
                        headerAccountDropdown.classList.remove('active');
                    };
                } else {
                    headerAccountDropdown.innerHTML = `
                        <button class="btn-primary" id="header-create-profile">Create Profile</button>
                        <button class="btn-secondary danger" id="header-sign-out">Sign Out</button>
                    `;
                    document.getElementById('header-create-profile').onclick = async () => {
                        openEditProfile().catch(console.error);
                        headerAccountDropdown.classList.remove('active');
                    };
                }

                document.getElementById('header-sign-out').onclick = () => authManager.signOut();
            }
        }

        authManager.onAuthStateChanged(async (user) => {
            if (user) {
                const data = await syncManager.getUserData();
                if (data && data.profile && data.profile.avatar_url) {
                    headerAccountImg.src = data.profile.avatar_url + '&s=100';
                    headerAccountImg.style.display = 'block';
                    headerAccountIcon.style.display = 'none';
                    return;
                }
            }
            headerAccountImg.style.display = 'none';
            headerAccountIcon.style.display = 'flex';
        });
    }
});

function showUpdateNotification(updateCallback) {
    // Remove any existing update notification
    const existingNotification = document.querySelector('.update-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div>
            <strong>Update Available</strong>
            <p>A new version of Monochrome is available.</p>
        </div>
        <div class="update-notification-actions">
            <button class="btn-primary" id="update-now-btn">Update Now</button>
            <button class="btn-icon" id="dismiss-update-btn" title="Dismiss">
                ${SVG_CLOSE(16)}
            </button>
        </div>
    `;
    document.body.appendChild(notification);

    document.getElementById('update-now-btn').addEventListener('click', () => {
        if (typeof updateCallback === 'function') {
            updateCallback();
        } else if (updateCallback && updateCallback.postMessage) {
            updateCallback.postMessage({ action: 'skipWaiting' });
        } else {
            window.location.reload();
        }
    });

    document.getElementById('dismiss-update-btn').addEventListener('click', () => {
        notification.remove();
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showMissingTracksNotification(missingTracks, playlistName) {
    const modal = document.getElementById('missing-tracks-modal');
    const listUl = document.getElementById('missing-tracks-list-ul');
    const copyBtn = document.getElementById('copy-missing-tracks-btn');
    const exportCSVBtn = document.getElementById('export-missing-tracks-csv-btn');

    listUl.innerHTML = missingTracks
        .map((track) => {
            const text =
                typeof track === 'string' ? track : `${track.artist ? track.artist + ' - ' : ''}${track.title}`;
            return `<li>${escapeHtml(text)}</li>`;
        })
        .join('');

    if (copyBtn) {
        const newCopyBtn = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);

        newCopyBtn.addEventListener('click', async () => {
            const header = `Missing songs from ${playlistName} import:\n\n`;
            const textToCopy =
                header +
                missingTracks
                    .map((track) => {
                        return typeof track === 'string'
                            ? track
                            : `${track.artist ? track.artist + ' - ' : ''}${track.title}`;
                    })
                    .join('\n');

            await navigator.clipboard
                .writeText(textToCopy)
                .then(async () => {
                    const originalText = newCopyBtn.textContent;
                    newCopyBtn.textContent = 'Copied!';
                    setTimeout(() => (newCopyBtn.textContent = originalText), 2000);
                })
                .catch(console.error);
        });
    }

    if (exportCSVBtn) {
        const newExportBtn = exportCSVBtn.cloneNode(true);
        exportCSVBtn.parentNode.replaceChild(newExportBtn, exportCSVBtn);

        newExportBtn.addEventListener('click', () => {
            const headers = ['Artist', 'Title', 'Album'];
            let csvContent = headers.join(',') + '\n';

            missingTracks.forEach((track) => {
                if (typeof track === 'string') {
                    csvContent += `"${track.replace(/"/g, '""')}","",""\n`;
                } else {
                    const artist = (track.artist || '').replace(/"/g, '""');
                    const title = (track.title || '').replace(/"/g, '""');
                    const album = (track.album || '').replace(/"/g, '""');
                    csvContent += `"${artist}","${title}","${album}"\n`;
                }
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            const fileName = `${playlistName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_missing_tracks.csv`;
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    const closeModal = () => modal.classList.remove('active');

    // Remove old listeners if any (though usually these functions are called once per instance,
    // but since we reuse the same modal element we should be careful or use a one-time listener)
    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.closest('.close-missing-tracks') ||
            e.target.id === 'close-missing-tracks-btn' ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
            modal.removeEventListener('click', handleClose);
        }
    };

    modal.addEventListener('click', handleClose);
    modal.classList.add('active');
}

function showDiscographyDownloadModal(artist, api, quality, lyricsManager, triggerBtn) {
    const modal = document.getElementById('discography-download-modal');

    document.getElementById('discography-artist-name').textContent = artist.name;
    document.getElementById('albums-count').textContent = artist.albums?.length || 0;
    document.getElementById('eps-count').textContent = (artist.eps || []).filter((a) => a.type === 'EP').length;
    document.getElementById('singles-count').textContent = (artist.eps || []).filter((a) => a.type === 'SINGLE').length;

    // Reset checkboxes
    document.getElementById('download-albums').checked = true;
    document.getElementById('download-eps').checked = true;
    document.getElementById('download-singles').checked = true;

    const closeModal = () => {
        modal.classList.remove('active');
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('modal-overlay') ||
            e.target.closest('.close-modal-btn') ||
            e.target.id === 'cancel-discography-download'
        ) {
            closeModal();
        }
    };

    modal.addEventListener('click', handleClose);

    document.getElementById('start-discography-download').onclick = async () => {
        const includeAlbums = document.getElementById('download-albums').checked;
        const includeEPs = document.getElementById('download-eps').checked;
        const includeSingles = document.getElementById('download-singles').checked;

        if (!includeAlbums && !includeEPs && !includeSingles) {
            alert('Please select at least one type of release to download.');
            return;
        }

        closeModal();

        // Filter releases based on selection
        let selectedReleases = [];
        if (includeAlbums) {
            selectedReleases = selectedReleases.concat(artist.albums || []);
        }
        if (includeEPs) {
            selectedReleases = selectedReleases.concat((artist.eps || []).filter((a) => a.type === 'EP'));
        }
        if (includeSingles) {
            selectedReleases = selectedReleases.concat((artist.eps || []).filter((a) => a.type === 'SINGLE'));
        }

        triggerBtn.disabled = true;
        const originalHTML = triggerBtn.innerHTML;
        triggerBtn.innerHTML = `${SVG_ANIMATE_SPIN(20)}<span>Downloading...</span>`;

        try {
            const { downloadDiscography } = await loadDownloadsModule();
            await downloadDiscography(artist, selectedReleases, api, quality, lyricsManager);
        } catch (error) {
            console.error('Discography download failed:', error);
            alert('Failed to download discography: ' + error.message);
        } finally {
            triggerBtn.disabled = false;
            triggerBtn.innerHTML = originalHTML;
        }
    };

    modal.classList.add('active');
}

function showKeyboardShortcuts() {
    const modal = document.getElementById('shortcuts-modal');

    const closeModal = () => {
        modal.classList.remove('active');

        modal.removeEventListener('click', handleClose);
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('close-shortcuts') ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
        }
    };

    modal.addEventListener('click', handleClose);
    modal.classList.add('active');
}

function showCustomizeShortcutsModal() {
    const modal = document.getElementById('customize-shortcuts-modal');
    const shortcutsList = document.getElementById('shortcuts-list');
    let recordingAction = null;
    let recordingTimeout = null;

    const formatKey = (key) => {
        if (!key) return 'none';
        const keyMap = {
            ' ': 'Space',
            arrowup: '↑',
            arrowdown: '↓',
            arrowleft: '←',
            arrowright: '→',
            escape: 'Esc',
            backspace: 'Backspace',
            delete: 'Delete',
            insert: 'Insert',
            home: 'Home',
            end: 'End',
            pageup: 'Page Up',
            pagedown: 'Page Down',
            '[': '[',
            ']': ']',
            '\\': '\\',
            tab: 'Tab',
            enter: 'Enter',
            capslock: 'Caps Lock',
            shift: 'Shift',
            control: 'Ctrl',
            alt: 'Alt',
            meta: 'Meta',
            contextmenu: 'Context Menu',
        };
        return keyMap[key.toLowerCase()] || key.toUpperCase();
    };

    const renderShortcuts = () => {
        shortcutsList.innerHTML = '';
        const currentShortcuts = keyboardShortcuts.getShortcuts();

        for (const [action, shortcut] of Object.entries(currentShortcuts || {})) {
            const item = document.createElement('div');
            item.className = 'customize-shortcut-item';
            item.dataset.action = action;

            const modifiers = [];
            if (shortcut?.shift) modifiers.push('Shift');
            if (shortcut?.ctrl) modifiers.push('Ctrl');
            if (shortcut?.alt) modifiers.push('Alt');

            const keyDisplay = [...modifiers, formatKey(shortcut?.key)].join(' + ');

            item.innerHTML = `
                <span class="shortcut-description">${shortcut?.description || 'Unknown'}</span>
                <div class="shortcut-key">
                    <kbd class="${recordingAction === action ? 'recording' : ''}">${keyDisplay}</kbd>
                    <button class="shortcut-btn" title="Reset to default">
                        ${SVG_RESET(16)}
                    </button>
                </div>
            `;

            const kbd = item.querySelector('kbd');
            kbd.addEventListener('click', (e) => {
                e.stopPropagation();
                if (recordingAction === action) {
                    recordingAction = null;
                    clearTimeout(recordingTimeout);
                } else {
                    recordingAction = action;
                    recordingTimeout = setTimeout(() => {
                        keyboardShortcuts.setShortcut(action, {
                            key: null,
                            shift: false,
                            ctrl: false,
                            alt: false,
                            description: shortcut?.description || 'Unknown',
                        });
                        recordingAction = null;
                        renderShortcuts();
                    }, 3000);
                }
                renderShortcuts();
            });

            const resetBtn = item.querySelector('.shortcut-btn');
            resetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const defaults = keyboardShortcuts.getDefaultShortcuts();
                keyboardShortcuts.setShortcut(action, defaults[action]);
                renderShortcuts();
            });

            shortcutsList.appendChild(item);
        }
    };

    const handleKeyDown = (e) => {
        if (!recordingAction) return;

        e.preventDefault();
        e.stopPropagation();

        const key = e.key === ' ' ? ' ' : e.key;

        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
            return;
        }

        keyboardShortcuts.setShortcut(recordingAction, {
            key: key,
            shift: e.shiftKey,
            ctrl: e.ctrlKey || e.metaKey,
            alt: e.altKey,
        });

        clearTimeout(recordingTimeout);
        recordingAction = null;
        renderShortcuts();
    };

    const closeModal = () => {
        modal.classList.remove('active');
        recordingAction = null;
        clearTimeout(recordingTimeout);
        document.removeEventListener('keydown', handleKeyDown);
        modal.removeEventListener('click', handleClose);
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('close-customize-shortcuts') ||
            e.target.id === 'close-customize-shortcuts-btn' ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
        }
    };

    document.getElementById('reset-shortcuts-btn')?.addEventListener('click', () => {
        keyboardShortcuts.resetShortcuts();
        renderShortcuts();
    });

    document.addEventListener('keydown', handleKeyDown);
    modal.addEventListener('click', handleClose);
    renderShortcuts();
    modal.classList.add('active');
}
