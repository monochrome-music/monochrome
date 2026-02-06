//js/app.js
import { LosslessAPI } from './api.js';
import { apiSettings, themeManager, nowPlayingSettings, downloadQualitySettings, sidebarSettings } from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { MultiScrobbler } from './multi-scrobbler.js';
import { LyricsManager, openLyricsPanel, clearLyricsPanelSync } from './lyrics.js';
import { createRouter, updateTabTitle, navigate } from './router.js';
import { initializePlayerEvents, initializeTrackInteractions, handleTrackAction } from './events.js';
import { initializeUIInteractions } from './ui-interactions.js';
import { debounce, SVG_PLAY } from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { db } from './db.js';
import { syncManager } from './accounts/pocketbase.js';
import { registerSW } from 'virtual:pwa-register';
import './smooth-scrolling.js';

// Lazy-loaded modules
let settingsModule = null;
let downloadsModule = null;
let trackerModule = null;
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

async function loadTrackerModule() {
    if (!trackerModule) {
        trackerModule = await import('./tracker.js');
    }
    return trackerModule;
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

function initializeKeyboardShortcuts(player, audioPlayer) {
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea')) return;

        switch (e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                player.handlePlayPause();
                break;
            case 'arrowright':
                if (e.shiftKey) {
                    player.playNext();
                } else {
                    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
                }
                break;
            case 'arrowleft':
                if (e.shiftKey) {
                    player.playPrev();
                } else {
                    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
                }
                break;
            case 'arrowup':
                e.preventDefault();
                player.setVolume(player.userVolume + 0.1);
                break;
            case 'arrowdown':
                e.preventDefault();
                player.setVolume(player.userVolume - 0.1);
                break;
            case 'm':
                audioPlayer.muted = !audioPlayer.muted;
                break;
            case 's':
                document.getElementById('shuffle-btn')?.click();
                break;
            case 'r':
                document.getElementById('repeat-btn')?.click();
                break;
            case 'q':
                document.getElementById('queue-btn')?.click();
                break;
            case '/':
                e.preventDefault();
                document.getElementById('search-input')?.focus();
                break;
            case 'escape':
                document.getElementById('search-input')?.blur();
                sidePanelManager.close();
                clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
                break;
            case 'l':
                document.querySelector('.now-playing-bar .cover')?.click();
                break;
        }
    });
}

function showOfflineNotification() {
    const notification = document.createElement('div');
    notification.className = 'offline-notification';
    notification.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
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

document.addEventListener('DOMContentLoaded', async () => {
    const api = new LosslessAPI(apiSettings);

    const audioPlayer = document.getElementById('audio-player');

    // i love ios and macos!!!! webkit fucking SUCKS BULLSHIT sorry ios/macos heads yall getting lossless only
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && navigator.maxTouchPoints > 1);
    const isSafari =
        ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios') && !ua.includes('android');

    if (isIOS || isSafari) {
        const qualitySelect = document.getElementById('streaming-quality-setting');
        const downloadSelect = document.getElementById('download-quality-setting');

        const removeHiRes = (select) => {
            if (!select) return;
            const option = select.querySelector('option[value="HI_RES_LOSSLESS"]');
            if (option) option.remove();
        };

        removeHiRes(qualitySelect);
        removeHiRes(downloadSelect);

        const currentQualitySetting = localStorage.getItem('playback-quality');
        if (!currentQualitySetting || currentQualitySetting === 'HI_RES_LOSSLESS') {
            localStorage.setItem('playback-quality', 'LOSSLESS');
        }
    }

    const currentQuality = localStorage.getItem('playback-quality') || 'HI_RES_LOSSLESS';
    const player = new Player(audioPlayer, api, currentQuality);

    const ui = new UIRenderer(api, player);
    const scrobbler = new MultiScrobbler();
    const lyricsManager = new LyricsManager(api);

    const originalRenderPlaylistPage = ui.renderPlaylistPage.bind(ui);
    ui.renderPlaylistPage = async function (id, type) {
        await originalRenderPlaylistPage(id, type);

        if (type === 'user') {
            try {
                const playlist = await db.getPlaylist(id);
                const imgElement = document.getElementById('playlist-detail-image');

                if (!imgElement) return;

                let container = imgElement.parentElement;
                let collageElement = document.getElementById('playlist-detail-collage');

                if (!container.classList.contains('detail-header-cover-container')) {
                    container = document.createElement('div');
                    container.className = 'detail-header-cover-container';
                    imgElement.parentNode.insertBefore(container, imgElement);
                    container.appendChild(imgElement);

                    collageElement = document.createElement('div');
                    collageElement.id = 'playlist-detail-collage';
                    collageElement.className = 'detail-header-collage';
                    collageElement.style.display = 'none';
                    container.appendChild(collageElement);
                }

                if (playlist && !playlist.cover && collageElement && playlist.tracks && playlist.tracks.length > 0) {
                    const tracksWithCovers = playlist.tracks.filter((t) => t.album && t.album.cover);

                    if (tracksWithCovers.length > 0) {
                        imgElement.style.setProperty('display', 'none', 'important');
                        collageElement.style.display = 'grid';
                        collageElement.innerHTML = '';

                        const uniqueCovers = [];
                        const seen = new Set();
                        for (const t of tracksWithCovers) {
                            if (!seen.has(t.album.cover)) {
                                seen.add(t.album.cover);
                                uniqueCovers.push(t.album.cover);
                                if (uniqueCovers.length >= 4) break;
                            }
                        }

                        const images = [];
                        for (let i = 0; i < 4; i++) {
                            images.push(uniqueCovers[i % uniqueCovers.length]);
                        }

                        images.forEach((src) => {
                            const img = document.createElement('img');
                            img.src = api.getCoverUrl(src);
                            collageElement.appendChild(img);
                        });
                    } else {
                        imgElement.style.removeProperty('display');
                        collageElement.style.display = 'none';
                    }
                } else if (collageElement) {
                    imgElement.style.removeProperty('display');
                    collageElement.style.display = 'none';
                }
            } catch (e) {
                console.error('Error generating playlist cover:', e);
            }
        }
    };

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

    // Load settings module and initialize
    const { initializeSettings } = await loadSettingsModule();
    initializeSettings(scrobbler, player, api, ui);

    initializePlayerEvents(player, audioPlayer, scrobbler, ui);
    initializeTrackInteractions(
        player,
        api,
        document.querySelector('.main-content'),
        document.getElementById('context-menu'),
        lyricsManager,
        ui,
        scrobbler
    );
    initializeUIInteractions(player, api, ui);
    initializeKeyboardShortcuts(player, audioPlayer);

    // Load tracker module
    const { initTracker } = await loadTrackerModule();
    initTracker(player);

    const castBtn = document.getElementById('cast-btn');
    initializeCasting(audioPlayer, castBtn);

    // Restore UI state for the current track (like button, theme)
    if (player.currentTrack) {
        ui.setCurrentTrack(player.currentTrack);
    }

    document.querySelector('.now-playing-bar .cover').addEventListener('click', async () => {
        if (!player.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const mode = nowPlayingSettings.getMode();

        if (mode === 'lyrics') {
            const isActive = sidePanelManager.isActive('lyrics');

            if (isActive) {
                sidePanelManager.close();
                clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
            } else {
                openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager);
            }
        } else if (mode === 'cover') {
            const overlay = document.getElementById('fullscreen-cover-overlay');
            if (overlay && overlay.style.display === 'flex') {
                if (window.location.hash === '#fullscreen') {
                    window.history.back();
                } else {
                    ui.closeFullscreenCover();
                }
            } else {
                const nextTrack = player.getNextTrack();
                ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
            }
        } else {
            // Default to 'album' mode - navigate to album
            if (player.currentTrack.album?.id) {
                navigate(`/album/${player.currentTrack.album.id}`);
            }
        }
    });

    // Toggle Share Button visibility on switch change
    document.getElementById('playlist-public-toggle')?.addEventListener('change', (e) => {
        const shareBtn = document.getElementById('playlist-share-btn');
        if (shareBtn) shareBtn.style.display = e.target.checked ? 'flex' : 'none';
    });

    document.getElementById('close-fullscreen-cover-btn')?.addEventListener('click', () => {
        if (window.location.hash === '#fullscreen') {
            window.history.back();
        } else {
            ui.closeFullscreenCover();
        }
    });

    document.getElementById('fullscreen-cover-image')?.addEventListener('click', () => {
        if (window.location.hash === '#fullscreen') {
            window.history.back();
        } else {
            ui.closeFullscreenCover();
        }
    });

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = isCollapsed
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
        }
        // Save sidebar state to localStorage
        sidebarSettings.setCollapsed(isCollapsed);
    });

    document.getElementById('nav-back')?.addEventListener('click', () => {
        window.history.back();
    });

    document.getElementById('nav-forward')?.addEventListener('click', () => {
        window.history.forward();
    });

    document.getElementById('toggle-lyrics-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!player.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const isActive = sidePanelManager.isActive('lyrics');

        if (isActive) {
            sidePanelManager.close();
            clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        } else {
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager);
        }
    });

    document.getElementById('download-current-btn')?.addEventListener('click', () => {
        if (player.currentTrack) {
            handleTrackAction('download', player.currentTrack, player, api, lyricsManager, 'track', ui);
        }
    });

    // Auto-update lyrics when track changes
    let previousTrackId = null;
    audioPlayer.addEventListener('play', async () => {
        if (!player.currentTrack) return;

        // Update UI with current track info for theme
        ui.setCurrentTrack(player.currentTrack);

        const currentTrackId = player.currentTrack.id;
        if (currentTrackId === previousTrackId) return;
        previousTrackId = currentTrackId;

        // Update lyrics panel if it's open
        if (sidePanelManager.isActive('lyrics')) {
            // Re-open forces update/refresh of content and sync
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager, true);
        }

        // Update Fullscreen if it's open
        const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
        if (fullscreenOverlay && getComputedStyle(fullscreenOverlay).display !== 'none') {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }

        // DEV: Auto-open fullscreen mode if ?fullscreen=1 in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (
            urlParams.get('fullscreen') === '1' &&
            fullscreenOverlay &&
            getComputedStyle(fullscreenOverlay).display === 'none'
        ) {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#play-album-btn')) {
            const btn = e.target.closest('#play-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            const albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;

            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    // Sort tracks by disc and track number for consistent playback
                    const sortedTracks = [...tracks].sort((a, b) => {
                        const discA = a.volumeNumber ?? a.discNumber ?? 1;
                        const discB = b.volumeNumber ?? b.discNumber ?? 1;
                        if (discA !== discB) return discA - discB;
                        return a.trackNumber - b.trackNumber;
                    });

                    player.setQueue(sortedTracks, 0);
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    player.shuffleActive = false;
                    player.playTrackFromQueue();
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
            const albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;

            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                    player.setQueue(shuffledTracks, 0);
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    player.shuffleActive = false;
                    player.playTrackFromQueue();
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
            document.getElementById('play-artist-radio-btn')?.click();
        }
        if (e.target.closest('#download-mix-btn')) {
            const btn = e.target.closest('#download-mix-btn');
            if (btn.disabled) return;

            const mixId = window.location.pathname.split('/')[2];
            if (!mixId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { mix, tracks } = await api.getMix(mixId);
                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(mix, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
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
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

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
                    const data = await api.getPlaylist(playlistId);
                    playlist = data.playlist;
                    tracks = data.tracks;
                }

                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(playlist, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Playlist download failed:', error);
                alert('Failed to download playlist: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#create-playlist-btn')) {
            const modal = document.getElementById('playlist-modal');
            document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-cover-input').value = '';
            modal.dataset.editingId = '';
            document.getElementById('csv-import-section').style.display = 'block';
            document.getElementById('csv-file-input').value = '';

            // Reset Public Toggle
            const publicToggle = document.getElementById('playlist-public-toggle');
            const shareBtn = document.getElementById('playlist-share-btn');
            if (publicToggle) publicToggle.checked = false;
            if (shareBtn) shareBtn.style.display = 'none';

            modal.classList.add('active');
            document.getElementById('playlist-name-input').focus();
        }

        if (e.target.closest('#create-folder-btn')) {
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
                await db.createFolder(name, cover);
                ui.renderLibraryPage();
                document.getElementById('folder-modal').classList.remove('active');
            }
        }

        if (e.target.closest('#folder-modal-cancel')) {
            document.getElementById('folder-modal').classList.remove('active');
        }

        if (e.target.closest('#delete-folder-btn')) {
            const folderId = window.location.pathname.split('/')[2];
            if (folderId && confirm('Are you sure you want to delete this folder?')) {
                await db.deleteFolder(folderId);
                navigate('/library');
            }
        }

        if (e.target.closest('#playlist-modal-save')) {
            const name = document.getElementById('playlist-name-input').value.trim();
            const isPublic = document.getElementById('playlist-public-toggle')?.checked;

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
                    db.getPlaylist(editingId).then(async (playlist) => {
                        if (playlist) {
                            playlist.name = name;
                            playlist.cover = cover;
                            await handlePublicStatus(playlist);
                            await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                            syncManager.syncUserPlaylist(playlist, 'update');
                            ui.renderLibraryPage();
                            // Also update current page if we are on it
                            if (window.location.pathname === `/userplaylist/${editingId}`) {
                                ui.renderPlaylistPage(editingId, 'user');
                            }
                            modal.classList.remove('active');
                            delete modal.dataset.editingId;
                        }
                    });
                } else {
                    // Create
                    const csvFileInput = document.getElementById('csv-file-input');
                    let tracks = [];

                    if (csvFileInput.files.length > 0) {
                        // Import from CSV
                        const file = csvFileInput.files[0];
                        const progressElement = document.getElementById('csv-import-progress');
                        const progressFill = document.getElementById('csv-progress-fill');
                        const progressCurrent = document.getElementById('csv-progress-current');
                        const progressTotal = document.getElementById('csv-progress-total');
                        const currentTrackElement = progressElement.querySelector('.current-track');
                        const currentArtistElement = progressElement.querySelector('.current-artist');

                        try {
                            // Show progress bar
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading CSV file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const csvText = await file.text();
                            const lines = csvText.trim().split('\n');
                            const totalTracks = Math.max(0, lines.length - 1);
                            progressTotal.textContent = totalTracks.toString();

                            const result = await parseCSV(csvText, api, (progress) => {
                                const percentage = totalTracks > 0 ? (progress.current / totalTracks) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the CSV file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from CSV`);

                            // if theres missing songs, warn the user
                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse CSV!', error);
                            alert('Failed to parse CSV file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            // Hide progress bar
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    }

                    const cover = document.getElementById('playlist-cover-input').value.trim();

                    // Check for pending tracks (from Add to Playlist -> New Playlist)
                    const modal = document.getElementById('playlist-modal');
                    if (modal._pendingTracks && Array.isArray(modal._pendingTracks)) {
                        tracks = [...tracks, ...modal._pendingTracks];
                        delete modal._pendingTracks;
                        // Also clear CSV input if we came from there? No, keep it separate.
                        console.log(`Added ${tracks.length} tracks (including pending)`);
                    }

                    db.createPlaylist(name, tracks, cover).then(async (playlist) => {
                        await handlePublicStatus(playlist);
                        // Update DB again with isPublic flag
                        await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                        syncManager.syncUserPlaylist(playlist, 'create');
                        ui.renderLibraryPage();
                        modal.classList.remove('active');
                    });
                }
            }
        }

        if (e.target.closest('#playlist-modal-cancel')) {
            document.getElementById('playlist-modal').classList.remove('active');
        }

        if (e.target.closest('.edit-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            db.getPlaylist(playlistId).then(async (playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';

                    // Set Public Toggle
                    const publicToggle = document.getElementById('playlist-public-toggle');
                    const shareBtn = document.getElementById('playlist-share-btn');

                    // Check if actually public in Pocketbase to be sure (async) or trust local flag
                    // We trust local flag for UI speed, but could verify.
                    if (publicToggle) publicToggle.checked = !!playlist.isPublic;

                    if (shareBtn) {
                        shareBtn.style.display = playlist.isPublic ? 'flex' : 'none';
                        shareBtn.onclick = () => {
                            const url = `${window.location.origin}/userplaylist/${playlist.id}`;
                            navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!'));
                        };
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('csv-import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        if (e.target.closest('.delete-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            if (confirm('Are you sure you want to delete this playlist?')) {
                db.deletePlaylist(playlistId).then(() => {
                    syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                    ui.renderLibraryPage();
                });
            }
        }

        if (e.target.closest('#edit-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            db.getPlaylist(playlistId).then((playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';

                    const publicToggle = document.getElementById('playlist-public-toggle');
                    const shareBtn = document.getElementById('playlist-share-btn');

                    if (publicToggle) publicToggle.checked = !!playlist.isPublic;
                    if (shareBtn) {
                        shareBtn.style.display = playlist.isPublic ? 'flex' : 'none';
                        shareBtn.onclick = () => {
                            const url = `${window.location.origin}/userplaylist/${playlist.id}`;
                            navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!'));
                        };
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('csv-import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        if (e.target.closest('#delete-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            if (confirm('Are you sure you want to delete this playlist?')) {
                db.deletePlaylist(playlistId).then(() => {
                    syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                    navigate('/library');
                });
            }
        }

        if (e.target.closest('.remove-from-playlist-btn')) {
            e.stopPropagation();
            const btn = e.target.closest('.remove-from-playlist-btn');
            const playlistId = window.location.pathname.split('/')[2];

            db.getPlaylist(playlistId).then(async (playlist) => {
                let trackId = null;

                // Prefer ID if available (from sorted view)
                if (btn.dataset.trackId) {
                    trackId = btn.dataset.trackId;
                } else if (btn.dataset.trackIndex) {
                    // Fallback to index (legacy/unsorted)
                    const index = parseInt(btn.dataset.trackIndex);
                    if (playlist && playlist.tracks[index]) {
                        trackId = playlist.tracks[index].id;
                    }
                }

                if (trackId) {
                    const updatedPlaylist = await db.removeTrackFromPlaylist(playlistId, trackId);
                    syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                    const scrollTop = document.querySelector('.main-content').scrollTop;
                    await ui.renderPlaylistPage(playlistId, 'user');
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
                        const { tracks: apiTracks } = await api.getPlaylist(playlistId);
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
                    player.setQueue(tracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
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
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { album, tracks } = await api.getAlbum(albumId);
                const { downloadAlbumAsZip } = await loadDownloadsModule();
                await downloadAlbumAsZip(album, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
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
                const { tracks } = await api.getAlbum(albumId);

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
                        document.getElementById('csv-import-section').style.display = 'none'; // Hide CSV for simple add

                        // Pass tracks
                        createModal._pendingTracks = tracks;

                        createModal.classList.add('active');
                        document.getElementById('playlist-name-input').focus();
                        return;
                    }

                    const playlistId = option.dataset.id;

                    try {
                        await db.addTracksToPlaylist(playlistId, tracks);
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
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Loading...</span>';

            try {
                const artist = await api.getArtist(artistId);

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
                                const { tracks } = await api.getAlbum(album.id);
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

                    player.setQueue(allTracks, 0);
                    player.playTrackFromQueue();
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
                    player.setQueue(likedTracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
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
            btn.innerHTML =
                '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length === 0) {
                    alert('No liked tracks to download.');
                    return;
                }
                const { downloadLikedTracks } = await loadDownloadsModule();
                await downloadLikedTracks(likedTracks, api, downloadQualitySettings.getQuality(), lyricsManager);
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
                const artist = await api.getArtist(artistId);
                showDiscographyDownloadModal(artist, api, downloadQualitySettings.getQuality(), lyricsManager, btn);
            } catch (error) {
                console.error('Failed to load artist for discography download:', error);
                alert('Failed to load artist: ' + error.message);
            }
        }

        // Local Files Logic lollll
        if (e.target.closest('#select-local-folder-btn') || e.target.closest('#change-local-folder-btn')) {
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

                const tracks = [];
                let idCounter = 0;

                async function scanDirectory(dirHandle) {
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
                                const { readTrackMetadata } = await loadMetadataModule();
                                const metadata = await readTrackMetadata(file);
                                metadata.id = `local-${idCounter++}-${file.name}`;
                                tracks.push(metadata);
                            }
                        } else if (entry.kind === 'directory') {
                            await scanDirectory(entry);
                        }
                    }
                }

                await scanDirectory(handle);

                tracks.sort((a, b) => {
                    const artistA = a.artist.name || '';
                    const artistB = b.artist.name || '';
                    return artistA.localeCompare(artistB);
                });

                window.localFilesCache = tracks;
                ui.renderLibraryPage();
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

    // Setup clear button for search bar
    ui.setupSearchClearButton(searchInput);

    const performSearch = debounce((query) => {
        if (query) {
            navigate(`/search/${encodeURIComponent(query)}`);
        }
    }, 300);

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 2) {
            performSearch(query);
        }
    });

    searchInput.addEventListener('change', (e) => {
        const query = e.target.value.trim();
        if (query.length > 2) {
            ui.addToSearchHistory(query);
        }
    });

    searchInput.addEventListener('focus', () => {
        ui.renderSearchHistory();
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
        if (query) {
            ui.addToSearchHistory(query);
            navigate(`/search/${encodeURIComponent(query)}`);
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

    document.querySelector('.now-playing-bar .play-pause-btn').innerHTML = SVG_PLAY;

    const router = createRouter(ui);

    const handleRouteChange = async (event) => {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const isFullscreenOpen = overlay && getComputedStyle(overlay).display === 'flex';

        if (isFullscreenOpen && window.location.hash !== '#fullscreen') {
            ui.closeFullscreenCover();
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

        await router();
        updateTabTitle(player);
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
        updateTabTitle(player);
    });

    // PWA Update Logic
    const updateSW = registerSW({
        onNeedRefresh() {
            showUpdateNotification(() => updateSW(true));
        },
        onOfflineReady() {
            console.log('App ready to work offline');
        },
    });

    document.getElementById('show-shortcuts-btn')?.addEventListener('click', () => {
        showKeyboardShortcuts();
    });

    // Listener for Pocketbase Sync updates
    window.addEventListener('library-changed', () => {
        const path = window.location.pathname;
        if (path === '/library') {
            ui.renderLibraryPage();
        } else if (path === '/' || path === '/home') {
            ui.renderHomePage();
        } else if (path.startsWith('/userplaylist/')) {
            const playlistId = path.split('/')[2];
            const content = document.querySelector('.main-content');
            const scroll = content ? content.scrollTop : 0;
            ui.renderPlaylistPage(playlistId, 'user').then(() => {
                if (content) content.scrollTop = scroll;
            });
        }
    });
    window.addEventListener('history-changed', () => {
        const path = window.location.pathname;
        if (path === '/recent') {
            ui.renderRecentPage();
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
                        const artistItem = contextMenu.querySelector('[data-action="go-to-artist"]');

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
                            if (artistItem) {
                                const hasArtist = track.artist || (track.artists && track.artists.length > 0);
                                artistItem.style.display = hasArtist ? 'block' : 'none';
                            }
                        }
                    }
                }
            });
        });

        observer.observe(contextMenu, { attributes: true });
    }
});

function showUpdateNotification(updateCallback) {
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div>
            <strong>Update Available</strong>
            <p>A new version of Monochrome is available.</p>
        </div>
        <button class="btn-primary" id="update-now-btn">Update Now</button>
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
}

function showMissingTracksNotification(missingTracks) {
    const modal = document.getElementById('missing-tracks-modal');
    const listUl = document.getElementById('missing-tracks-list-ul');

    listUl.innerHTML = missingTracks.map((track) => `<li>${track}</li>`).join('');

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

async function parseCSV(csvText, api, onProgress) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    // Robust CSV line parser that respects quotes
    const parseLine = (text) => {
        const values = [];
        let current = '';
        let inQuote = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === ',' && !inQuote) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        // Clean up quotes: remove surrounding quotes and unescape double quotes if any
        return values.map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1);

    const tracks = [];
    const missingTracks = [];
    const totalTracks = rows.length;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.trim()) continue; // Skip empty lines

        const values = parseLine(row);

        if (values.length >= headers.length) {
            let trackTitle = '';
            let artistNames = '';
            let albumName = '';

            headers.forEach((header, index) => {
                const value = values[index];
                if (!value) return;

                switch (header.toLowerCase()) {
                    case 'track name':
                    case 'title':
                    case 'song':
                        trackTitle = value;
                        break;
                    case 'artist name(s)':
                    case 'artist name':
                    case 'artist':
                    case 'artists':
                        artistNames = value;
                        break;
                    case 'album':
                    case 'album name':
                        albumName = value;
                        break;
                }
            });

            if (onProgress) {
                onProgress({
                    current: i,
                    total: totalTracks,
                    currentTrack: trackTitle || 'Unknown track',
                    currentArtist: artistNames || '',
                });
            }

            // Search for the track in hifi tidal api's catalog
            if (trackTitle && artistNames) {
                // Add a small delay to prevent rate limiting
                await new Promise((resolve) => setTimeout(resolve, 300));

                try {
                    let foundTrack = null;

                    // Helper: Normalize strings for fuzzy matching
                    const normalize = (str) =>
                        str
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .toLowerCase()
                            .replace(/[^\w\s]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();

                    // Helper: Check if result matches our criteria
                    const isValidMatch = (track, title, artists, album) => {
                        if (!track) return false;

                        const trackTitle = normalize(track.title || '');
                        const trackArtists = (track.artists || []).map((a) => normalize(a.name || '')).join(' ');
                        const trackAlbum = normalize(track.album?.name || '');

                        const queryTitle = normalize(title);
                        const queryArtists = normalize(artists);
                        const queryAlbum = normalize(album || '');

                        // Must match title (exact or substring match)
                        const titleMatch =
                            trackTitle === queryTitle ||
                            trackTitle.includes(queryTitle) ||
                            queryTitle.includes(trackTitle);
                        if (!titleMatch) return false;

                        // Must match at least one artist
                        const artistMatch =
                            trackArtists.includes(queryArtists.split(' ')[0]) ||
                            queryArtists.includes(trackArtists.split(' ')[0]);
                        if (!artistMatch) return false;

                        // If album provided, prefer matching album but not strict
                        if (queryAlbum) {
                            const albumMatch =
                                trackAlbum === queryAlbum ||
                                trackAlbum.includes(queryAlbum) ||
                                queryAlbum.includes(trackAlbum);
                            return albumMatch;
                        }

                        return true;
                    };

                    // 1. Initial Search: Title + All Artists + Album (most specific)
                    if (!foundTrack) {
                        let searchQuery = `${trackTitle} ${artistNames}`;
                        if (albumName) searchQuery += ` ${albumName}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            // Try to find best match within results
                            for (const result of searchResults.items) {
                                if (isValidMatch(result, trackTitle, artistNames, albumName)) {
                                    foundTrack = result;
                                    break;
                                }
                            }
                            // Fallback: if no valid match found, use first result only if album matches
                            if (!foundTrack && albumName) {
                                const firstResult = searchResults.items[0];
                                if (isValidMatch(firstResult, trackTitle, artistNames, albumName)) {
                                    foundTrack = firstResult;
                                }
                            }
                        }
                    }

                    // 2. Retry: Title + Main Artist + Album
                    if (!foundTrack && artistNames) {
                        const mainArtist = artistNames.split(',')[0].trim();
                        if (mainArtist && mainArtist !== artistNames) {
                            let searchQuery = `${trackTitle} ${mainArtist}`;
                            if (albumName) searchQuery += ` ${albumName}`;
                            const searchResults = await api.searchTracks(searchQuery);

                            if (searchResults.items && searchResults.items.length > 0) {
                                for (const result of searchResults.items) {
                                    if (isValidMatch(result, trackTitle, mainArtist, albumName)) {
                                        foundTrack = result;
                                        console.log(`Found (Retry 1 - Main Artist): ${trackTitle}`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 3. Retry: Just Title + Album (strong album context)
                    if (!foundTrack && albumName) {
                        const searchQuery = `${trackTitle} ${albumName}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            for (const result of searchResults.items) {
                                if (isValidMatch(result, trackTitle, artistNames, albumName)) {
                                    foundTrack = result;
                                    console.log(`Found (Retry 2 - Album): ${trackTitle}`);
                                    break;
                                }
                            }
                        }
                    }

                    // Clean title for retry strategies
                    // Remove " - ", "(feat. ...)", "[feat. ...]"
                    const cleanTitle = (t) =>
                        t
                            .split(' - ')[0]
                            .replace(/\s*[([]feat\.?.*?[)\]]/i, '')
                            .trim();
                    const cleanedTitle = cleanTitle(trackTitle);
                    const isTitleCleaned = cleanedTitle !== trackTitle;

                    // 4. Retry: Cleaned Title + Main Artist + Album
                    if (!foundTrack && isTitleCleaned) {
                        const mainArtist = (artistNames || '').split(',')[0].trim();
                        if (cleanedTitle) {
                            let searchQuery = `${cleanedTitle} ${mainArtist}`;
                            if (albumName) searchQuery += ` ${albumName}`;
                            const searchResults = await api.searchTracks(searchQuery);

                            if (searchResults.items && searchResults.items.length > 0) {
                                for (const result of searchResults.items) {
                                    if (isValidMatch(result, cleanedTitle, mainArtist, albumName)) {
                                        foundTrack = result;
                                        console.log(`Found (Retry 3 - Cleaned Title): ${trackTitle}`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 5. Retry: Title + Main Artist (Ignore Album in Query and Match)
                    if (!foundTrack) {
                        const mainArtist = (artistNames || '').split(',')[0].trim();
                        // Search WITHOUT album name to find tracks where album metadata differs
                        const searchQuery = `${trackTitle} ${mainArtist}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            for (const result of searchResults.items) {
                                // Pass null for album to ignore it in validation
                                if (isValidMatch(result, trackTitle, mainArtist, null)) {
                                    foundTrack = result;
                                    console.log(`Found (Retry 4 - Ignore Album): ${trackTitle}`);
                                    break;
                                }
                            }
                        }
                    }

                    // 6. Retry: Cleaned Title + Main Artist (Ignore Album in Query and Match)
                    if (!foundTrack && isTitleCleaned) {
                        const mainArtist = (artistNames || '').split(',')[0].trim();
                        const searchQuery = `${cleanedTitle} ${mainArtist}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            for (const result of searchResults.items) {
                                if (isValidMatch(result, cleanedTitle, mainArtist, null)) {
                                    foundTrack = result;
                                    console.log(`Found (Retry 5 - Cleaned Title + Ignore Album): ${trackTitle}`);
                                    break;
                                }
                            }
                        }
                    }

                    if (foundTrack) {
                        tracks.push(foundTrack);
                        console.log(`✓ "${trackTitle}" by ${artistNames}${albumName ? ' [' + albumName + ']' : ''}`);
                    } else {
                        console.warn(
                            `✗ Track not found: "${trackTitle}" by ${artistNames}${albumName ? ' [' + albumName + ']' : ''}`
                        );
                        missingTracks.push(
                            `${trackTitle} - ${artistNames}${albumName ? ' (album: ' + albumName + ')' : ''}`
                        );
                    }
                } catch (error) {
                    console.error(`Error searching for track "${trackTitle}":`, error);
                    missingTracks.push(
                        `${trackTitle} - ${artistNames}${albumName ? ' (album: ' + albumName + ')' : ''}`
                    );
                }
            }
        }
    }

    // yayyy its finished :P
    if (onProgress) {
        onProgress({
            current: totalTracks,
            total: totalTracks,
            currentTrack: 'Import complete',
        });
    }

    return { tracks, missingTracks };
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
        triggerBtn.innerHTML =
            '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

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
