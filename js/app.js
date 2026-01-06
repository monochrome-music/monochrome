//js/app.js
import { LosslessAPI } from './api.js';
import { apiSettings, themeManager, nowPlayingSettings, trackListSettings } from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { LastFMScrobbler } from './lastfm.js';
import { LyricsManager, openLyricsPanel, clearLyricsPanelSync, renderLyricsInFullscreen, clearFullscreenLyricsSync } from './lyrics.js';
import { createRouter, updateTabTitle } from './router.js';
import { initializeSettings } from './settings.js';
import { initializePlayerEvents, initializeTrackInteractions, handleTrackAction } from './events.js';
import { initializeUIInteractions } from './ui-interactions.js';
import { downloadAlbumAsZip, downloadDiscography, downloadPlaylistAsZip } from './downloads.js';
import { debounce, SVG_PLAY } from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { db } from './db.js';
import { syncManager } from './firebase/sync.js';

function initializeCasting(audioPlayer, castBtn) {
    if (!castBtn) return;

    if ('remote' in audioPlayer) {
        audioPlayer.remote.watchAvailability((available) => {
            if (available) {
                castBtn.style.display = 'flex';
                castBtn.classList.add('available');
            }
        }).catch(err => {
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
            audioPlayer.remote.prompt().catch(err => {
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
    }
    else if (audioPlayer.webkitShowPlaybackTargetPicker) {
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
    }
    else if (window.innerWidth > 768) {
        castBtn.style.display = 'flex';
        castBtn.addEventListener('click', () => {
            alert('Casting is not supported in this browser. Try Chrome for Chromecast or Safari for AirPlay.');
        });
    }
}

function initializeKeyboardShortcuts(player, audioPlayer) {
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea')) return;

        switch(e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                player.handlePlayPause();
                break;
            case 'arrowright':
                if (e.shiftKey) {
                    player.playNext();
                } else {
                    audioPlayer.currentTime = Math.min(
                        audioPlayer.duration,
                        audioPlayer.currentTime + 10
                    );
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
                audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.1);
                break;
            case 'arrowdown':
                e.preventDefault();
                audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.1);
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
        notification.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function hideOfflineNotification() {
    const notification = document.querySelector('.offline-notification');
    if (notification) {
        notification.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const api = new LosslessAPI(apiSettings);

    const audioPlayer = document.getElementById('audio-player');
    const currentQuality = localStorage.getItem('playback-quality') || 'LOSSLESS';
    const player = new Player(audioPlayer, api, currentQuality);

    const ui = new UIRenderer(api, player);
    const scrobbler = new LastFMScrobbler();
    const lyricsManager = new LyricsManager(api);

    const currentTheme = themeManager.getTheme();
    themeManager.setTheme(currentTheme);
    trackListSettings.getMode();

    initializeSettings(scrobbler, player, api, ui);
    initializePlayerEvents(player, audioPlayer, scrobbler, ui);
    initializeTrackInteractions(player, api, document.querySelector('.main-content'), document.getElementById('context-menu'), lyricsManager, ui, scrobbler);
    initializeUIInteractions(player, api);
    initializeKeyboardShortcuts(player, audioPlayer);

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
                ui.closeFullscreenCover();
            } else {
                const nextTrack = player.getNextTrack();
                ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
            }
        } else {
            // Default to 'album' mode - navigate to album
            if (player.currentTrack.album?.id) {
                window.location.hash = `#album/${player.currentTrack.album.id}`;
            }
        }
    });

    document.getElementById('close-fullscreen-cover-btn')?.addEventListener('click', () => {
        ui.closeFullscreenCover();
    });

    document.getElementById('fullscreen-cover-image')?.addEventListener('click', () => {
        ui.closeFullscreenCover();
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
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager);
        }

        // Update Fullscreen/Enlarged Cover if it's open
        const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
        if (fullscreenOverlay && getComputedStyle(fullscreenOverlay).display !== 'none') {
             const nextTrack = player.getNextTrack();
             ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#play-album-btn')) {
            const btn = e.target.closest('#play-album-btn');
            if (btn.disabled) return;

            const albumId = window.location.hash.split('/')[1];
            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks.length > 0) {
                    player.setQueue(tracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play album:', error);
                alert('Failed to play album: ' + error.message);
            }
        }
        if (e.target.closest('#download-mix-btn')) {
            const btn = e.target.closest('#download-mix-btn');
            if (btn.disabled) return;

            const mixId = window.location.hash.split('#mix/')[1];
            if (!mixId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { mix, tracks } = await api.getMix(mixId);
                await downloadPlaylistAsZip(mix, tracks, api, player.quality, lyricsManager);
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

        const playlistId = window.location.hash.split('/')[1];
        if (!playlistId) return;

        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

        try {
            let playlist, tracks;
            const userPlaylist = await db.getPlaylist(playlistId);
            
            if (userPlaylist) {
                playlist = { ...userPlaylist, title: userPlaylist.name };
                tracks = userPlaylist.tracks || [];
            } else {
                const data = await api.getPlaylist(playlistId);
                playlist = data.playlist;
                tracks = data.tracks;
            }
            
            await downloadPlaylistAsZip(playlist, tracks, api, player.quality, lyricsManager);
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
        modal.dataset.editingId = '';
        document.getElementById('csv-import-section').style.display = 'block';
        document.getElementById('csv-file-input').value = '';
        modal.style.display = 'flex';
        document.getElementById('playlist-name-input').focus();
    }

    if (e.target.closest('#playlist-modal-save')) {
        const name = document.getElementById('playlist-name-input').value.trim();
        if (name) {
            const modal = document.getElementById('playlist-modal');
            const editingId = modal.dataset.editingId;
            if (editingId) {
                // Edit
                db.getPlaylist(editingId).then(async (playlist) => {
                    if (playlist) {
                        playlist.name = name;
                        await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                        syncManager.syncUserPlaylist(playlist, 'update');
                        ui.renderLibraryPage();
                        modal.style.display = 'none';
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

                    try {
                        // Show progress bar
                        progressElement.style.display = 'block';
                        progressFill.style.width = '0%';
                        progressCurrent.textContent = '0';
                        currentTrackElement.textContent = 'Reading CSV file...';

                        const csvText = await file.text();
                        const lines = csvText.trim().split('\n');
                        const totalTracks = Math.max(0, lines.length - 1);
                        progressTotal.textContent = totalTracks.toString();

                        const result = await parseCSV(csvText, api, (progress) => {
                            const percentage = totalTracks > 0 ? (progress.current / totalTracks) * 100 : 0;
                            progressFill.style.width = `${Math.min(percentage, 100)}%`;
                            progressCurrent.textContent = progress.current.toString();
                            currentTrackElement.textContent = progress.currentTrack;
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

                db.createPlaylist(name, tracks, '').then(playlist => {
                    syncManager.syncUserPlaylist(playlist, 'create');
                    ui.renderLibraryPage();
                    modal.style.display = 'none';
                });
            }
        }
    }

    if (e.target.closest('#playlist-modal-cancel')) {
        document.getElementById('playlist-modal').style.display = 'none';
    }

    if (e.target.closest('.edit-playlist-btn')) {
        const card = e.target.closest('.user-playlist');
        const playlistId = card.dataset.playlistId;
        db.getPlaylist(playlistId).then(playlist => {
            if (playlist) {
                const modal = document.getElementById('playlist-modal');
                document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                document.getElementById('playlist-name-input').value = playlist.name;
                modal.dataset.editingId = playlistId;
                document.getElementById('csv-import-section').style.display = 'none';
                modal.style.display = 'flex';
                document.getElementById('playlist-name-input').focus();
            }
        });
    }

    if (e.target.closest('.delete-playlist-btn')) {
        const card = e.target.closest('.user-playlist');
        const playlistId = card.dataset.playlistId;
        if (confirm('Are you sure you want to delete this playlist?')) {
            db.deletePlaylist(playlistId).then(() => {
                syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                ui.renderLibraryPage();
            });
        }
    }

    if (e.target.closest('#edit-playlist-btn')) {
        const playlistId = window.location.hash.split('/')[1];
        db.getPlaylist(playlistId).then(playlist => {
            if (playlist) {
                const modal = document.getElementById('playlist-modal');
                document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                document.getElementById('playlist-name-input').value = playlist.name;
                modal.dataset.editingId = playlistId;
                document.getElementById('csv-import-section').style.display = 'none';
                modal.style.display = 'flex';
                document.getElementById('playlist-name-input').focus();
            }
        });
    }

    if (e.target.closest('#delete-playlist-btn')) {
        const playlistId = window.location.hash.split('/')[1];
        if (confirm('Are you sure you want to delete this playlist?')) {
            db.deletePlaylist(playlistId).then(() => {
                window.location.hash = '#library';
            });
        }
    }

    if (e.target.closest('.remove-from-playlist-btn')) {
        e.stopPropagation();
        const btn = e.target.closest('.remove-from-playlist-btn');
        const index = parseInt(btn.dataset.trackIndex);
        const playlistId = window.location.hash.split('/')[1];
        db.getPlaylist(playlistId).then(async (playlist) => {
            if (playlist && playlist.tracks[index]) {
                const trackId = playlist.tracks[index].id;
                const updatedPlaylist = await db.removeTrackFromPlaylist(playlistId, trackId);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                ui.renderPlaylistPage(playlistId);
            }
        });
    }

        if (e.target.closest('#play-playlist-btn')) {
            const btn = e.target.closest('#play-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.hash.split('/')[1];
            if (!playlistId) return;

            try {
                let tracks;
                const userPlaylist = await db.getPlaylist(playlistId);
                if (userPlaylist) {
                    tracks = userPlaylist.tracks;
                } else {
                    const { tracks: apiTracks } = await api.getPlaylist(playlistId);
                    tracks = apiTracks;
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

            const albumId = window.location.hash.split('/')[1];
            if (!albumId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { album, tracks } = await api.getAlbum(albumId);
                await downloadAlbumAsZip(album, tracks, api, player.quality, lyricsManager);
            } catch (error) {
                console.error('Album download failed:', error);
                alert('Failed to download album: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#play-artist-radio-btn')) {
            const btn = e.target.closest('#play-artist-radio-btn');
            if (btn.disabled) return;

            const artistId = window.location.hash.split('/')[1];
            if (!artistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Loading...</span>';

            try {
                const artist = await api.getArtist(artistId);
                
                const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
                if (allReleases.length === 0) {
                    throw new Error("No albums or EPs found for this artist");
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
                    await Promise.all(chunk.map(async (album) => {
                        try {
                            const { tracks } = await api.getAlbum(album.id);
                            tracks.forEach(track => {
                                if (!trackSet.has(track.id)) {
                                    trackSet.add(track.id);
                                    allTracks.push(track);
                                }
                            });
                        } catch (err) {
                            console.warn(`Failed to fetch tracks for album ${album.title}:`, err);
                        }
                    }));
                }

                if (allTracks.length > 0) {
                    for (let i = allTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
                    }

                    player.setQueue(allTracks, 0);
                    player.playTrackFromQueue();
                } else {
                     throw new Error("No tracks found across all albums");
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

        if (e.target.closest('#download-discography-btn')) {
            const btn = e.target.closest('#download-discography-btn');
            if (btn.disabled) return;

            const artistId = window.location.hash.split('/')[1];
            if (!artistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const artist = await api.getArtist(artistId);
                await downloadDiscography(artist, api, player.quality, lyricsManager);
            } catch (error) {
                console.error('Discography download failed:', error);
                alert('Failed to download discography: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }
    });

    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');

    const performSearch = debounce((query) => {
        if (query) {
            window.location.hash = `#search/${encodeURIComponent(query)}`;
        }
    }, 300);

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 2) {
            performSearch(query);
        }
    });

    searchForm.addEventListener('submit', e => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            window.location.hash = `#search/${encodeURIComponent(query)}`;
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

    document.querySelector('.play-pause-btn').innerHTML = SVG_PLAY;

    const router = createRouter(ui);
    router();
    window.addEventListener('hashchange', router);

    // Simple Navigation History
    const navStack = [window.location.hash];
    let navIndex = 0;

    const updateNavButtons = () => {
        const backBtn = document.getElementById('nav-back');
        const fwdBtn = document.getElementById('nav-forward');
        if (backBtn) backBtn.disabled = navIndex <= 0;
        if (fwdBtn) fwdBtn.disabled = navIndex >= navStack.length - 1;
    };

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash;
        if (hash === navStack[navIndex]) return;

        if (navIndex > 0 && hash === navStack[navIndex - 1]) {
            navIndex--; // User went back
        } else if (navIndex < navStack.length - 1 && hash === navStack[navIndex + 1]) {
            navIndex++; // User went forward
        } else {
            navIndex++;
            navStack.splice(navIndex); // Truncate forward history
            navStack.push(hash);
        }
        updateNavButtons();
    });
    updateNavButtons();

    audioPlayer.addEventListener('play', () => {
        updateTabTitle(player);
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('Service worker registered');

                    if (reg.waiting) {
                        showUpdateNotification(reg.waiting);
                    }

                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                showUpdateNotification(newWorker);
                            }
                        });
                    });
                })
                .catch(err => console.log('Service worker not registered', err));
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (!localStorage.getItem('installPromptDismissed')) {
            showInstallPrompt(deferredPrompt);
        }
    });

    document.getElementById('show-shortcuts-btn')?.addEventListener('click', () => {
        showKeyboardShortcuts();
    });

    if (!localStorage.getItem('shortcuts-shown') && window.innerWidth > 768) {
        setTimeout(() => {
            showKeyboardShortcuts();
            localStorage.setItem('shortcuts-shown', 'true');
        }, 3000);
    }

    // Listener for Firebase Sync updates
    window.addEventListener('library-changed', () => {
        const hash = window.location.hash;
        if (hash === '#library') {
            ui.renderLibraryPage();
        } else if (hash === '#home' || hash === '') {
            ui.renderHomePage();
        }
    });
    window.addEventListener('history-changed', () => {
        const hash = window.location.hash;
        if (hash === '#recent') {
            ui.renderRecentPage();
        }
    });
});

function showUpdateNotification(worker) {
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div>
            <strong>Update Available</strong>
            <p>A new version of Monochrome is available.</p>
        </div>
        <button class="btn-secondary" id="update-now-btn">Update Now</button>
    `;
    document.body.appendChild(notification);

    document.getElementById('update-now-btn').addEventListener('click', () => {
        if (worker) {
            worker.postMessage({ action: 'skipWaiting' });
        } else {
            window.location.reload();
        }
    });
}

function showInstallPrompt(deferredPrompt) {
    if (!deferredPrompt) return;

    const notification = document.createElement('div');
    notification.className = 'install-prompt';
    notification.innerHTML = `
        <div>
            <strong>Install Monochrome</strong>
            <p>Install this app for a better experience.</p>
        </div>
        <div style="display: flex; gap: 0.5rem;">
            <button class="btn-secondary" id="install-btn">Install</button>
            <button class="btn-secondary" id="dismiss-install">Dismiss</button>
        </div>
    `;
    document.body.appendChild(notification);

    document.getElementById('install-btn').addEventListener('click', async () => {
        notification.remove();
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        deferredPrompt = null;
    });

    document.getElementById('dismiss-install').addEventListener('click', () => {
        notification.remove();
        localStorage.setItem('installPromptDismissed', 'true');
    });
}

function showMissingTracksNotification(missingTracks) {
    const modal = document.createElement('div');
    modal.className = 'missing-tracks-modal-overlay';
    modal.innerHTML = `
        <div class="missing-tracks-modal">
            <div class="missing-tracks-header">
                <h3>Note</h3>
                <button class="close-missing-tracks">&times;</button>
            </div>
            <div class="missing-tracks-content">
                <p>Unfortunately some songs weren't able to be added. This could be an issue with our import system, try searching for the song and adding it. But it could also be due to Monochrome not having it sadly :(</p>
                <div class="missing-tracks-list">
                    <h4>Missing Tracks:</h4>
                    <ul>
                        ${missingTracks.map(track => `<li>${track}</li>`).join('')}
                    </ul>
                </div>
            </div>
            <div class="missing-tracks-actions">
                <button class="btn-secondary" id="close-missing-tracks-btn">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();

    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('close-missing-tracks') || e.target.id === 'close-missing-tracks-btn') {
            closeModal();
        }
    });
}

async function parseCSV(csvText, api, onProgress) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const rows = lines.slice(1);

    const tracks = [];
    const missingTracks = [];
    const totalTracks = rows.length;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const values = row.split(',').map(v => v.replace(/"/g, '').trim());
        if (values.length >= headers.length) {
            let trackTitle = '';
            let artistNames = '';

            headers.forEach((header, index) => {
                const value = values[index];
                switch (header.toLowerCase()) {
                    case 'track name':
                    case 'title':
                    case 'song':
                        trackTitle = value;
                        break;
                    case 'artist name(s)':
                    case 'artist':
                    case 'artists':
                        artistNames = value;
                        break;
                }
            });

            if (onProgress) {
                onProgress({
                    current: i,
                    total: totalTracks,
                    currentTrack: trackTitle || 'Unknown track'
                });
            }

            // Search for the track in hifi tidal api's catalog
            if (trackTitle && artistNames) {
                try {
                    const searchQuery = `${trackTitle} ${artistNames}`;
                    const searchResults = await api.searchTracks(searchQuery);

                    if (searchResults.items && searchResults.items.length > 0) {
                        // Use the first result
                        const foundTrack = searchResults.items[0];
                        tracks.push(foundTrack);
                        console.log(`Found track: "${trackTitle}" by ${artistNames}`);
                    } else {
                        console.warn(`Track not found: "${trackTitle}" by ${artistNames}`);
                        missingTracks.push(`${trackTitle} - ${artistNames}`);
                    }
                } catch (error) {
                    console.error(`Error searching for track "${trackTitle}":`, error);
                    missingTracks.push(`${trackTitle} - ${artistNames}`);
                }
            }
        }
    }

    // yayyy its finished :P
    if (onProgress) {
        onProgress({
            current: totalTracks,
            total: totalTracks,
            currentTrack: 'Import complete'
        });
    }

    return { tracks, missingTracks };
}

function showKeyboardShortcuts() {
    const modal = document.createElement('div');
    modal.className = 'shortcuts-modal-overlay';
    modal.innerHTML = `
        <div class="shortcuts-modal">
            <div class="shortcuts-header">
                <h3>Keyboard Shortcuts</h3>
                <button class="close-shortcuts">&times;</button>
            </div>
            <div class="shortcuts-content">
                <div class="shortcut-item">
                    <kbd>Space</kbd>
                    <span>Play / Pause</span>
                </div>
                <div class="shortcut-item">
                    <kbd>→</kbd>
                    <span>Seek forward 10s</span>
                </div>
                <div class="shortcut-item">
                    <kbd>←</kbd>
                    <span>Seek backward 10s</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Shift</kbd> + <kbd>→</kbd>
                    <span>Next track</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Shift</kbd> + <kbd>←</kbd>
                    <span>Previous track</span>
                </div>
                <div class="shortcut-item">
                    <kbd>↑</kbd>
                    <span>Volume up</span>
                </div>
                <div class="shortcut-item">
                    <kbd>↓</kbd>
                    <span>Volume down</span>
                </div>
                <div class="shortcut-item">
                    <kbd>M</kbd>
                    <span>Mute / Unmute</span>
                </div>
                <div class="shortcut-item">
                    <kbd>S</kbd>
                    <span>Toggle shuffle</span>
                </div>
                <div class="shortcut-item">
                    <kbd>R</kbd>
                    <span>Toggle repeat</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Q</kbd>
                    <span>Open queue</span>
                </div>
                <div class="shortcut-item">
                    <kbd>L</kbd>
                    <span>Toggle lyrics</span>
                </div>
                <div class="shortcut-item">
                    <kbd>/</kbd>
                    <span>Focus search</span>
                </div>
                <div class="shortcut-item">
                    <kbd>Esc</kbd>
                    <span>Close modals</span>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('close-shortcuts')) {
            modal.remove();
        }
    });
}
