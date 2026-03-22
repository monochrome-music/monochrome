//js/events.js
import {
    REPEAT_MODE,
    trackDataStore,
    formatTime,
    getTrackArtists,
    positionMenu,
    getShareUrl,
    escapeHtml,
} from './utils.js';
import {
    lastFMStorage,
    libreFmSettings,
    listenBrainzSettings,
    waveformSettings,
    keyboardShortcuts,
} from './storage.js';
import { showNotification, downloadTrackWithMetadata, downloadAlbumAsZip, downloadPlaylistAsZip } from './downloads.js';
import { downloadQualitySettings } from './storage.js';
import { updateTabTitle, navigate } from './router.js';
import { db } from './db.js';
import { syncManager } from './accounts/pocketbase.js';
import { waveformGenerator } from './waveform.js';
import { audioContextManager } from './audio-context.js';
import { hapticLongPress, hapticMedium, hapticLight } from './haptics.js';
import {
    trackPlayTrack,
    trackPauseTrack,
    trackSkipTrack,
    trackToggleShuffle,
    trackToggleRepeat,
    trackAddToQueue,
    trackPlayNext,
    trackLikeTrack,
    trackUnlikeTrack,
    trackLikeAlbum,
    trackUnlikeAlbum,
    trackLikeArtist,
    trackUnlikeArtist,
    trackLikePlaylist,
    trackUnlikePlaylist,
    trackDownloadTrack,
    trackContextMenuAction,
    trackBlockTrack,
    trackUnblockTrack,
    trackBlockAlbum,
    trackUnblockAlbum,
    trackBlockArtist,
    trackUnblockArtist,
    trackCopyLink,
    trackOpenInNewTab,
    trackSetSleepTimer,
    trackCancelSleepTimer,
    trackStartMix,
    trackEvent,
} from './analytics.js';
import { SVG_BIN, SVG_MUTE, SVG_PAUSE, SVG_PLAY, SVG_VOLUME, SVG_CHECKBOX,  SVG_CHECKBOX_CHECKED, SVG_REPEAT, SVG_REPEAT_ONE } from './icons.js';

let currentTrackIdForWaveform = null;

const trackSelection = {
    selectedIds: new Set(),
    lastClickedId: null,
    isSelecting: false,
};

let longPressTimer = null;
let isLongPress = false;
let longPressTrackItem = null;
const LONG_PRESS_DURATION = 500;

function handleTrackTouchStart(e) {
    if (!('ontouchstart' in window)) return;
    const trackItem = e.target.closest('.track-item');
    if (!trackItem || trackItem.classList.contains('unavailable') || trackItem.classList.contains('blocked')) return;

    isLongPress = false;
    longPressTrackItem = trackItem;

    longPressTimer = setTimeout(() => {
        isLongPress = true;
        toggleTrackSelection(trackItem, true, false);
        hapticLongPress();
    }, LONG_PRESS_DURATION);
}

function handleTrackTouchMove(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

function handleTrackTouchEnd(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    setTimeout(() => {
        isLongPress = false;
        longPressTrackItem = null;
    }, 100);
}

function isMultiSelectToggle(e) {
    const shortcut = keyboardShortcuts.getShortcutForAction('multiSelectToggle');
    if (!shortcut) return e.ctrlKey || e.metaKey;
    const key = e.key?.toLowerCase();
    const shortcutKey = shortcut.key?.toLowerCase();

    if (['control', 'shift', 'alt', 'meta'].includes(shortcutKey)) {
        if (shortcut.ctrl && !(e.ctrlKey || e.metaKey)) return false;
        if (shortcut.shift && !e.shiftKey) return false;
        if (shortcut.alt && !e.altKey) return false;
        return true;
    }

    return (
        (shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey) &&
        (shortcut.shift ? e.shiftKey : !e.shiftKey) &&
        (shortcut.alt ? e.altKey : !e.altKey) &&
        key === shortcutKey
    );
}

function isMultiSelectRange(e) {
    const shortcut = keyboardShortcuts.getShortcutForAction('multiSelectRange');
    if (!shortcut) return e.shiftKey;
    const key = e.key?.toLowerCase();
    const shortcutKey = shortcut.key?.toLowerCase();

    if (['control', 'shift', 'alt', 'meta'].includes(shortcutKey)) {
        if (shortcut.ctrl && !(e.ctrlKey || e.metaKey)) return false;
        if (shortcut.shift && !e.shiftKey) return false;
        if (shortcut.alt && !e.altKey) return false;
        return true;
    }

    return (
        (shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey) &&
        (shortcut.shift ? e.shiftKey : !e.shiftKey) &&
        (shortcut.alt ? e.altKey : !e.altKey) &&
        key === shortcutKey
    );
}

function getSelectedTracks() {
    return Array.from(trackSelection.selectedIds);
}

function updateCheckbox(checkbox, checked) {
    if (checkbox) {
        checkbox.innerHTML = checked ? SVG_CHECKBOX_CHECKED(18) : SVG_CHECKBOX(18);
        checkbox.classList.toggle('checked', checked);
    }
}

function toggleTrackSelection(trackItem, ctrlHeld, shiftHeld) {
    const trackId = trackItem.dataset.trackId;
    const isSelected = trackSelection.selectedIds.has(trackId);

    if (ctrlHeld) {
        if (isSelected) {
            trackSelection.selectedIds.delete(trackId);
            trackItem.classList.remove('selected');
            updateCheckbox(trackItem.querySelector('.track-checkbox'), false);
        } else {
            trackSelection.selectedIds.add(trackId);
            trackItem.classList.add('selected');
            updateCheckbox(trackItem.querySelector('.track-checkbox'), true);
        }
        trackSelection.lastClickedId = trackId;
    } else if (shiftHeld && trackSelection.lastClickedId && trackSelection.lastClickedId !== trackId) {
        const parentList = trackItem.closest('.track-list') || trackItem.closest('#main-content');
        const allTrackElements = Array.from(parentList.querySelectorAll('.track-item'));
        const lastIndex = allTrackElements.findIndex((el) => el.dataset.trackId === trackSelection.lastClickedId);
        const currentIndex = allTrackElements.findIndex((el) => el.dataset.trackId === trackId);

        if (lastIndex !== -1 && currentIndex !== -1) {
            const start = Math.min(lastIndex, currentIndex);
            const end = Math.max(lastIndex, currentIndex);
            for (let i = start; i <= end; i++) {
                const el = allTrackElements[i];
                trackSelection.selectedIds.add(el.dataset.trackId);
                el.classList.add('selected');
                updateCheckbox(el.querySelector('.track-checkbox'), true);
            }
        }
    } else {
        if (!isSelected) {
            trackSelection.selectedIds.add(trackId);
            trackItem.classList.add('selected');
            updateCheckbox(trackItem.querySelector('.track-checkbox'), true);
        } else {
            trackSelection.selectedIds.delete(trackId);
            trackItem.classList.remove('selected');
            updateCheckbox(trackItem.querySelector('.track-checkbox'), false);
        }
        trackSelection.lastClickedId = trackId;
    }

    trackSelection.isSelecting = trackSelection.selectedIds.size > 0;
    document.body.classList.toggle('multi-select-mode', trackSelection.isSelecting);
}

function showMultiSelectPlaylistModal(tracks) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText =
        'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
    modal.innerHTML = `
        <div class="modal-content" style="background: var(--card); border-radius: var(--radius); padding: 1.5rem; min-width: 350px; max-width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
                <h3 style="margin: 0;">Add to Playlist</h3>
                <button class="modal-close" style="background: none; border: none; color: var(--foreground); font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
            </div>
            <div class="playlist-body" style="max-height: 300px; overflow-y: auto;">
                <div class="create-new-playlist" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--border); color: var(--primary); font-weight: 500;">
                    + Create new playlist
                </div>
                <div class="playlist-list"></div>
            </div>
        </div>
    `;

    const closeModal = () => {
        modal.remove();
        document.body.style.overflow = '';
    };

    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    db.getPlaylists(true).then((playlists) => {
        const listEl = modal.querySelector('.playlist-list');
        if (playlists.length === 0) {
            listEl.innerHTML = '<div style="padding: 12px; color: var(--muted-foreground);">No playlists yet</div>';
        } else {
            listEl.innerHTML = playlists
                .map(
                    (p) => `
                <div class="playlist-item" data-playlist-id="${p.id}" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--border);">
                    <span>${escapeHtml(p.name)}</span>
                    <span style="color: var(--muted-foreground); font-size: 0.85rem; margin-left: 8px;">${p.tracks?.length || 0} tracks</span>
                </div>
            `
                )
                .join('');
        }

        listEl.querySelectorAll('.playlist-item').forEach((item) => {
            item.addEventListener('click', async () => {
                const playlistId = item.dataset.playlistId;
                for (const track of tracks) {
                    await db.addTrackToPlaylist(playlistId, track);
                }
                syncManager.syncUserPlaylist(await db.getPlaylist(playlistId), 'update');
                showNotification(`Added ${tracks.length} tracks to playlist`);
                closeModal();
            });
        });
    });

    modal.querySelector('.create-new-playlist').addEventListener('click', () => {
        const name = prompt('Playlist name:');
        if (name) {
            db.createPlaylist(name, tracks).then((playlist) => {
                showNotification(`Created playlist "${name}" with ${tracks.length} tracks`);
                closeModal();
            });
        }
    });
}

export function initializePlayerEvents(player, audioPlayer, scrobbler, ui) {
    const playPauseBtn = document.querySelector('.now-playing-bar .play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const homeStartRadioBtn = document.getElementById('home-start-infinite-radio-btn');
    const sleepTimerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');

    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');

    const updateVolumeUI = () => {
        const activeEl = player.activeElement;
        const { muted } = activeEl;
        const volume = player.userVolume;
        volumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE(20) : SVG_VOLUME(20);
        const effectiveVolume = muted ? 0 : volume * 100;
        volumeFill.style.setProperty('--volume-level', `${effectiveVolume}%`);
        volumeFill.style.width = `${effectiveVolume}%`;
    };

    function clearSelection() {
        trackSelection.selectedIds.clear();
        trackSelection.lastClickedId = null;
        trackSelection.isSelecting = false;
        document.body.classList.remove('multi-select-mode');
        document.querySelectorAll('.track-item.selected').forEach((el) => {
            el.classList.remove('selected');
        });
        document.querySelectorAll('.track-checkbox').forEach((checkbox) => {
            checkbox.innerHTML = SVG_CHECKBOX(18);
            checkbox.classList.remove('checked');
        });
        updateSelectionBar();
    }

    function updateSelectionBar() {
        let bar = document.getElementById('selection-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'selection-bar';
            bar.className = 'selection-bar';
            bar.innerHTML = `
                <span class="selection-count">0 selected</span>
                <div class="selection-actions">
                    <button data-action="play-selected">Play</button>
                    <button data-action="add-to-queue-selected">Add to queue</button>
                    <button data-action="add-to-playlist-selected">Add to playlist</button>
                    <button data-action="download-selected">Download</button>
                    <button data-action="like-selected">Like</button>
                </div>
                <button data-action="clear-selection" style="margin-left: 8px;">Clear</button>
            `;
            document.body.appendChild(bar);

            bar.querySelectorAll('button').forEach((btn) => {
                btn.addEventListener('click', () => handleSelectionAction(btn.dataset.action));
            });
        }

        const count = trackSelection.selectedIds.size;
        bar.querySelector('.selection-count').textContent = `${count} selected`;
        bar.classList.toggle('visible', count > 0);
    }

    function handleSelectionAction(action) {
        const selectedIds = getSelectedTracks();
        if (selectedIds.length === 0) return;

        const mainContent = document.getElementById('main-content');
        const selectedTracks = [];
        mainContent.querySelectorAll('.track-item').forEach((item) => {
            if (trackSelection.selectedIds.has(item.dataset.trackId)) {
                const track = trackDataStore.get(item);
                if (track) selectedTracks.push(track);
            }
        });

        switch (action) {
            case 'play-selected':
                if (selectedTracks.length > 0) {
                    player.setQueue(selectedTracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
                break;
            case 'add-to-queue-selected':
                if (selectedTracks.length > 0) {
                    player.addToQueue(selectedTracks);
                    if (window.renderQueueFunction) window.renderQueueFunction();
                    showNotification(`Added ${selectedTracks.length} tracks to queue`);
                }
                break;
            case 'add-to-playlist-selected':
                if (selectedTracks.length > 0) {
                    showMultiSelectPlaylistModal(selectedTracks);
                }
                break;
            case 'download-selected':
                if (selectedTracks.length > 0) {
                    selectedTracks.forEach((track) => {
                        downloadTrackWithMetadata(track, downloadQualitySettings.getQuality(), api, lyricsManager);
                    });
                    showNotification(`Downloading ${selectedTracks.length} tracks`);
                }
                break;
            case 'like-selected':
                selectedTracks.forEach(async (track) => {
                    const added = await db.toggleFavorite('track', track);
                    syncManager.syncLibraryItem('track', track, added);
                });
                showNotification(`Liked ${selectedTracks.length} tracks`);
                break;
            case 'clear-selection':
                clearSelection();
                break;
        }
    }

    if (homeStartRadioBtn) {
        homeStartRadioBtn.addEventListener('click', async () => {
            await player.enableRadio();
        });
    }

    const sleepTimerBtnMobile = document.getElementById('sleep-timer-btn');

    // History tracking
    let historyLoggedTrackId = null;

    const setupMediaListeners = (element) => {
        element.addEventListener('loadstart', () => {
            if (player.activeElement === element) {
                historyLoggedTrackId = null;
            }
        });

        element.addEventListener('play', () => {
            if (player.activeElement !== element) return;

            // Initialize audio context manager for EQ (only once)
            if (!audioContextManager.isReady()) {
                audioContextManager.init(element);
            }
            audioContextManager.resume();

            if (player.currentTrack) {
                // Track play event
                trackPlayTrack(player.currentTrack);

                // Scrobble
                if (scrobbler.isAuthenticated()) {
                    scrobbler.updateNowPlaying(player.currentTrack);
                }

                updateWaveform();
            }

            playPauseBtn.innerHTML = SVG_PAUSE(20);
            player.updateMediaSessionPlaybackState();
            player.updateMediaSessionPositionState();
            updateTabTitle(player);
        });

        element.addEventListener('playing', () => {
            if (player.activeElement !== element) return;
            player.updateMediaSessionPlaybackState();
            player.updateMediaSessionPositionState();
        });

        element.addEventListener('pause', () => {
            if (player.activeElement !== element) return;
            if (player.currentTrack) {
                trackPauseTrack(player.currentTrack);
            }
            playPauseBtn.innerHTML = SVG_PLAY(20);
            player.updateMediaSessionPlaybackState();
            player.updateMediaSessionPositionState();
        });

        element.addEventListener('ended', () => {
            if (player.activeElement !== element) return;
            player.clearPlaybackContinuationForCurrentTrack();
            player.playNext();
        });

        element.addEventListener('timeupdate', async () => {
            if (player.activeElement !== element) return;

            const { currentTime, duration } = element;
            if (duration) {
                const progressFill = document.getElementById('progress-fill');
                const currentTimeEl = document.getElementById('current-time');
                progressFill.style.width = `${(currentTime / duration) * 100}%`;
                currentTimeEl.textContent = formatTime(currentTime);

                // Log to history after 10 seconds of playback
                if (currentTime >= 10 && player.currentTrack && player.currentTrack.id !== historyLoggedTrackId) {
                    historyLoggedTrackId = player.currentTrack.id;
                    const historyEntry = await db.addToHistory(player.currentTrack);
                    syncManager.syncHistoryItem(historyEntry);

                    if (window.location.hash === '#recent') {
                        ui.renderRecentPage();
                    }
                }

                player.savePlaybackContinuation();
            }
        });

        element.addEventListener('loadedmetadata', () => {
            if (player.activeElement !== element) return;
            const totalDurationEl = document.getElementById('total-duration');
            totalDurationEl.textContent = formatTime(element.duration);
            player.updateMediaSessionPositionState();
        });

        element.addEventListener('error', (e) => {
            if (player.activeElement !== element) return;

            if (!element.src) return;

            const error = element.error;
            let errorMsg = 'Unknown error';
            if (error) {
                switch (error.code) {
                    case 1:
                        errorMsg = 'Playback aborted';
                        break;
                    case 2:
                        errorMsg = 'Network error';
                        break;
                    case 3:
                        errorMsg = 'Decoding error';
                        break;
                    case 4:
                        errorMsg = 'Source not supported';
                        break;
                }
                if (error.message) errorMsg += `: ${error.message}`;
            }

            console.error(`Media playback error (${element.id}):`, errorMsg, e);
            playPauseBtn.innerHTML = SVG_PLAY(20);

            const canFallback =
                player.quality === 'HI_RES_LOSSLESS' &&
                errorMsg.includes('Source not supported') &&
                errorMsg.includes('0x80004005') &&
                !player.isFallbackRetry;

            if (canFallback) {
                console.warn('Hi-Res failed due to DASH.js Error (FUCK DASH)');
            }

            if (player.currentTrack && error && error.code !== 1) {
                if (player.isFallbackInProgress || canFallback) {
                    return;
                }
                console.warn('Skipping to next track due to playback error');
                setTimeout(() => player.playNext(), 1000);
            }
        });

        element.addEventListener('volumechange', () => {
            if (player.activeElement === element) {
                updateVolumeUI();
            }
        });
    };

    setupMediaListeners(audioPlayer);
    if (player.video) {
        setupMediaListeners(player.video);
    }

    playPauseBtn.addEventListener('click', () => { hapticMedium(); player.handlePlayPause(); });
    nextBtn.addEventListener('click', () => {
        hapticMedium();
        trackSkipTrack(player.currentTrack, 'next');
        player.playNext();
    });
    prevBtn.addEventListener('click', () => {
        hapticMedium();
        trackSkipTrack(player.currentTrack, 'previous');
        player.playPrev();
    });

    shuffleBtn.addEventListener('click', () => {
        hapticLight();
        player.toggleShuffle();
        trackToggleShuffle(player.shuffleActive);
        shuffleBtn.classList.toggle('active', player.shuffleActive);
        if (window.renderQueueFunction) window.renderQueueFunction();
    });

    repeatBtn.addEventListener('click', () => {
        hapticLight();
        const mode = player.toggleRepeat();
        trackToggleRepeat(mode === REPEAT_MODE.OFF ? 'off' : mode === REPEAT_MODE.ALL ? 'all' : 'one');
        repeatBtn.classList.toggle('active', mode !== REPEAT_MODE.OFF);
        repeatBtn.classList.toggle('repeat-one', mode === REPEAT_MODE.ONE);
        repeatBtn.title =
            mode === REPEAT_MODE.OFF ? 'Repeat' : mode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
                // Sync fullscreen repeat button
        const fsRepeatBtn = document.getElementById('fs-repeat-btn');
        if (fsRepeatBtn) {
            fsRepeatBtn.classList.toggle('active', mode !== REPEAT_MODE.OFF);
            fsRepeatBtn.classList.toggle('repeat-one', mode === REPEAT_MODE.ONE);
            fsRepeatBtn.title = mode === REPEAT_MODE.OFF ? 'Repeat' : mode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
                        fsRepeatBtn.innerHTML = mode === REPEAT_MODE.ONE ? SVG_REPEAT_ONE(24) : SVG_REPEAT(24);
        }
    });

    window.addEventListener('radio-state-changed', (e) => {
        if (e.detail && e.detail.enabled) {
            showNotification('Infinite Radio Enabled');
        }
    });

    // Sleep Timer for desktop
    if (sleepTimerBtnDesktop) {
        sleepTimerBtnDesktop.addEventListener('click', () => {
            if (player.isSleepTimerActive()) {
                player.clearSleepTimer();
                trackCancelSleepTimer();
                showNotification('Sleep timer cancelled');
            } else {
                showSleepTimerModal(player);
            }
        });
    }

    // Sleep Timer for mobile
    if (sleepTimerBtnMobile) {
        sleepTimerBtnMobile.addEventListener('click', () => {
            if (player.isSleepTimerActive()) {
                player.clearSleepTimer();
                trackCancelSleepTimer();
                showNotification('Sleep timer cancelled');
            } else {
                showSleepTimerModal(player);
            }
        });
    }

    // Playback Speed Control for miniplayer
    const playbackSpeedBtn = document.getElementById('playback-speed-btn');
    const playbackSpeedPopup = document.getElementById('playback-speed-popup');
    const miniSpeedSlider = document.getElementById('mini-playback-speed-slider');
    const speedValue = playbackSpeedBtn?.querySelector('.speed-value');
    const speedPopupClose = document.querySelector('.speed-popup-close');
    const speedPresetBtns = document.querySelectorAll('.speed-preset-btn');

    if (playbackSpeedBtn && playbackSpeedPopup && miniSpeedSlider) {
        // Get initial speed from storage (dynamic import in async context)
        import('./storage.js').then(({ audioEffectsSettings }) => {
            const currentSpeed = audioEffectsSettings.getSpeed();
            miniSpeedSlider.value = currentSpeed;
            if (speedValue) speedValue.textContent = `${currentSpeed.toFixed(2)}x`;
        });

        // Toggle popup
        playbackSpeedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = playbackSpeedPopup.style.display === 'block';
            playbackSpeedPopup.style.display = isVisible ? 'none' : 'block';
        });

        // Close popup
        if (speedPopupClose) {
            speedPopupClose.addEventListener('click', () => {
                playbackSpeedPopup.style.display = 'none';
            });
        }

        // Close popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!playbackSpeedBtn.contains(e.target) && !playbackSpeedPopup.contains(e.target)) {
                playbackSpeedPopup.style.display = 'none';
            }
        });

        // Slider change
        miniSpeedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            import('./storage.js').then(({ audioEffectsSettings }) => {
                audioEffectsSettings.setSpeed(speed);
                player.setPlaybackSpeed(speed);
                if (speedValue) speedValue.textContent = `${speed.toFixed(2)}x`;

                // Update fullscreen speed if exists
                const fsSpeedSlider = document.getElementById('fs-playback-speed-slider');
                const fsSpeedValue = document.querySelector('.fs-speed-value');
                if (fsSpeedSlider) fsSpeedSlider.value = speed;
                if (fsSpeedValue) fsSpeedValue.textContent = `${speed.toFixed(2)}x`;
            });
        });

        // Preset buttons
        speedPresetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed);
                miniSpeedSlider.value = speed;
                import('./storage.js').then(({ audioEffectsSettings }) => {
                    audioEffectsSettings.setSpeed(speed);
                    player.setPlaybackSpeed(speed);
                    if (speedValue) speedValue.textContent = `${speed.toFixed(2)}x`;

                    // Update fullscreen speed if exists
                    const fsSpeedSlider = document.getElementById('fs-playback-speed-slider');
                    const fsSpeedValue = document.querySelector('.fs-speed-value');
                    if (fsSpeedSlider) fsSpeedSlider.value = speed;
                    if (fsSpeedValue) fsSpeedValue.textContent = `${speed.toFixed(2)}x`;
                });
            });
        });
    }

    // Waveform Masking Logic
    const updateWaveform = async () => {
        const progressBar = document.getElementById('progress-bar');
        const playerControls = document.querySelector('.player-controls');

        const isTracker =
            player.currentTrack &&
            (player.currentTrack.isTracker ||
                (player.currentTrack.id && String(player.currentTrack.id).startsWith('tracker-')));

        if (!waveformSettings.isEnabled() || !player.currentTrack || isTracker) {
            if (progressBar) {
                progressBar.style.webkitMaskImage = '';
                progressBar.style.maskImage = '';
                progressBar.classList.remove('has-waveform', 'waveform-loaded');
            }
            if (playerControls) {
                playerControls.classList.remove('waveform-loaded');
            }
            currentTrackIdForWaveform = null;
            return;
        }

        if (progressBar && currentTrackIdForWaveform !== player.currentTrack.id) {
            currentTrackIdForWaveform = player.currentTrack.id;
            progressBar.classList.add('has-waveform');
            progressBar.classList.remove('waveform-loaded');
            if (playerControls) {
                playerControls.classList.remove('waveform-loaded');
            }

            // Clear current mask while loading
            progressBar.style.webkitMaskImage = '';
            progressBar.style.maskImage = '';

            try {
                const streamUrl = await player.api.getStreamUrl(player.currentTrack.id, 'LOW');
                const waveformData = await waveformGenerator.getWaveform(streamUrl, player.currentTrack.id);

                if (waveformData && currentTrackIdForWaveform === player.currentTrack.id) {
                    let { peaks, duration } = waveformData;
                    const trackDuration = player.currentTrack.duration;

                    // Padding logic for sync
                    if (trackDuration && duration && duration < trackDuration) {
                        const diff = trackDuration - duration;
                        if (diff > 0.5) {
                            // If difference is significant (> 500ms)
                            // Calculate how many peaks represent the missing time
                            // peaks.length represents 'duration'
                            // X peaks represent 'diff'
                            const peaksPerSecond = peaks.length / duration;
                            const paddingPeaksCount = Math.floor(diff * peaksPerSecond);

                            if (paddingPeaksCount > 0) {
                                const newPeaks = new Float32Array(peaks.length + paddingPeaksCount);
                                // Fill start with 0s (implied by new Float32Array)
                                newPeaks.set(peaks, paddingPeaksCount);
                                peaks = newPeaks;
                            }
                        }
                    }

                    // Create a temporary canvas to generate the mask
                    const canvas = document.createElement('canvas');
                    const rect = progressBar.getBoundingClientRect();
                    canvas.width = rect.width || 500;
                    canvas.height = 28; // Fixed height for mask generation

                    waveformGenerator.drawWaveform(canvas, peaks);

                    const dataUrl = canvas.toDataURL();
                    progressBar.style.webkitMaskImage = `url(${dataUrl})`;
                    progressBar.style.webkitMaskSize = '100% 100%';
                    progressBar.style.webkitMaskRepeat = 'no-repeat';
                    progressBar.style.maskImage = `url(${dataUrl})`;
                    progressBar.style.maskSize = '100% 100%';
                    progressBar.style.maskRepeat = 'no-repeat';

                    progressBar.classList.add('waveform-loaded');
                    if (playerControls) {
                        playerControls.classList.add('waveform-loaded');
                    }
                }
            } catch (e) {
                console.error('Failed to load waveform mask:', e);
            }
        }
    };

    window.addEventListener('waveform-toggle', (e) => {
        if (!e.detail.enabled) {
            const progressBar = document.getElementById('progress-bar');
            const playerControls = document.querySelector('.player-controls');
            if (progressBar) {
                progressBar.style.webkitMaskImage = '';
                progressBar.style.maskImage = '';
                progressBar.classList.remove('has-waveform', 'waveform-loaded');
            }
            if (playerControls) {
                playerControls.classList.remove('waveform-loaded');
            }
        }
        updateWaveform();
    });

    if (volumeBtn) {
        volumeBtn.addEventListener('click', () => {
            const activeEl = player.activeElement;
            activeEl.muted = !activeEl.muted;
            localStorage.setItem('muted', activeEl.muted);

            const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
            if (inactiveEl) inactiveEl.muted = activeEl.muted;

            updateVolumeUI();
        });
    }
    const isMuted = localStorage.getItem('muted') === 'true';
    audioPlayer.muted = isMuted;
    if (player.video) player.video.muted = isMuted;
    updateVolumeUI();

    initializeSmoothSliders(player);
}

function initializeSmoothSliders(player) {
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const currentTimeEl = document.getElementById('current-time');
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');

    let isSeeking = false;
    let wasPlaying = false;
    let isAdjustingVolume = false;
    let lastSeekPosition = 0;

    const seek = (bar, event, setter) => {
        const rect = bar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        setter(position);
    };

    const updateSeekUI = (position) => {
        const activeEl = player.activeElement;
        if (!isNaN(activeEl.duration)) {
            progressFill.style.width = `${position * 100}%`;
            if (currentTimeEl) {
                currentTimeEl.textContent = formatTime(position * activeEl.duration);
            }
        }
    };

    // Progress bar with smooth dragging
    progressBar.addEventListener('mousedown', (e) => {
        const activeEl = player.activeElement;
        isSeeking = true;
        wasPlaying = !activeEl.paused;
        if (wasPlaying) activeEl.pause();

        seek(progressBar, e, (position) => {
            lastSeekPosition = position;
            updateSeekUI(position);
        });
    });

    // Touch events for mobile
    progressBar.addEventListener('touchstart', (e) => {
        const activeEl = player.activeElement;
        e.preventDefault();
        isSeeking = true;
        wasPlaying = !activeEl.paused;
        if (wasPlaying) activeEl.pause();

        const touch = e.touches[0];
        const rect = progressBar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));

        lastSeekPosition = position;
        updateSeekUI(position);
    });

    document.addEventListener('mousemove', (e) => {
        if (isSeeking) {
            seek(progressBar, e, (position) => {
                lastSeekPosition = position;
                updateSeekUI(position);
            });
        }

        if (isAdjustingVolume) {
            seek(volumeBar, e, (position) => {
                const activeEl = player.activeElement;
                if (activeEl.muted) {
                    activeEl.muted = false;
                    localStorage.setItem('muted', false);

                    const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
                    if (inactiveEl) inactiveEl.muted = false;
                }
                player.setVolume(position);
                volumeFill.style.width = `${position * 100}%`;
                volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            });
        }
    });

    document.addEventListener('touchmove', (e) => {
        if (isSeeking) {
            const touch = e.touches[0];
            const rect = progressBar.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));

            lastSeekPosition = position;
            updateSeekUI(position);
        }

        if (isAdjustingVolume) {
            const touch = e.touches[0];
            const rect = volumeBar.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            const activeEl = player.activeElement;
            if (activeEl.muted) {
                activeEl.muted = false;
                localStorage.setItem('muted', false);

                const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
                if (inactiveEl) inactiveEl.muted = false;
            }
            player.setVolume(position);
            volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isSeeking) {
            const activeEl = player.activeElement;
            // Commit the seek
            if (!isNaN(activeEl.duration)) {
                activeEl.currentTime = lastSeekPosition * activeEl.duration;
                player.updateMediaSessionPositionState();
                if (wasPlaying) activeEl.play();
            }
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    document.addEventListener('touchend', () => {
        if (isSeeking) {
            const activeEl = player.activeElement;
            if (!isNaN(activeEl.duration)) {
                activeEl.currentTime = lastSeekPosition * activeEl.duration;
                player.updateMediaSessionPositionState();
                if (wasPlaying) activeEl.play();
            }
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    progressBar.addEventListener('click', (e) => {
        if (!isSeeking) {
            const activeEl = player.activeElement;
            // Only handle click if not result of a drag release
            seek(progressBar, e, (position) => {
                if (!isNaN(activeEl.duration) && activeEl.duration > 0 && activeEl.duration !== Infinity) {
                    activeEl.currentTime = position * activeEl.duration;
                    player.updateMediaSessionPositionState();
                } else if (player.currentTrack && player.currentTrack.duration) {
                    const targetTime = position * player.currentTrack.duration;
                    const progressFill = document.querySelector('.progress-fill');
                    if (progressFill) progressFill.style.width = `${position * 100}%`;
                    player.playTrackFromQueue(targetTime);
                }
            });
        }
    });

    volumeBar.addEventListener('mousedown', (e) => {
        isAdjustingVolume = true;
        seek(volumeBar, e, (position) => {
            const activeEl = player.activeElement;
            if (activeEl.muted) {
                activeEl.muted = false;
                localStorage.setItem('muted', false);

                const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
                if (inactiveEl) inactiveEl.muted = false;
            }
            player.setVolume(position);
            volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        });
    });

    volumeBar.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isAdjustingVolume = true;
        const touch = e.touches[0];
        const rect = volumeBar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        const activeEl = player.activeElement;
        if (activeEl.muted) {
            activeEl.muted = false;
            localStorage.setItem('muted', false);

            const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
            if (inactiveEl) inactiveEl.muted = false;
        }
        player.setVolume(position);
        volumeFill.style.width = `${position * 100}%`;
        volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
    });

    volumeBar.addEventListener('click', (e) => {
        if (!isAdjustingVolume) {
            seek(volumeBar, e, (position) => {
                const activeEl = player.activeElement;
                if (activeEl.muted) {
                    activeEl.muted = false;
                    localStorage.setItem('muted', false);

                    const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
                    if (inactiveEl) inactiveEl.muted = false;
                }
                player.setVolume(position);
                volumeFill.style.width = `${position * 100}%`;
                volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            });
        }
    });
    volumeBar.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newVolume = Math.max(0, Math.min(1, player.userVolume + delta));
            const activeEl = player.activeElement;

            if (delta > 0 && activeEl.muted) {
                activeEl.muted = false;
                localStorage.setItem('muted', false);

                const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
                if (inactiveEl) inactiveEl.muted = false;
            }

            player.setVolume(newVolume);
            volumeFill.style.width = `${newVolume * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${newVolume * 100}%`);
        },
        { passive: false }
    );

    volumeBtn?.addEventListener(
        'wheel',
        (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const newVolume = Math.max(0, Math.min(1, player.userVolume + delta));
            const activeEl = player.activeElement;

            if (delta > 0 && activeEl.muted) {
                activeEl.muted = false;
                localStorage.setItem('muted', false);

                const inactiveEl = player.currentTrack?.type === 'video' ? player.audio : player.video;
                if (inactiveEl) inactiveEl.muted = false;
            }

            player.setVolume(newVolume);
            volumeFill.style.width = `${newVolume * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${newVolume * 100}%`);
        },
        { passive: false }
    );
}

// Standalone function to show add to playlist modal
export async function showAddToPlaylistModal(track) {
    const modal = document.getElementById('playlist-select-modal');
    const list = document.getElementById('playlist-select-list');
    const cancelBtn = document.getElementById('playlist-select-cancel');
    const overlay = modal.querySelector('.modal-overlay');

    const renderModal = async () => {
        const playlists = await db.getPlaylists(true);

        const trackId = track.id;
        const playlistsWithTrack = new Set();

        for (const playlist of playlists) {
            if (playlist.tracks && playlist.tracks.some((t) => t.id == trackId)) {
                playlistsWithTrack.add(playlist.id);
            }
        }

        list.innerHTML =
            `
            <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
            </div>
        ` +
            playlists
                .map((p) => {
                    const alreadyContains = playlistsWithTrack.has(p.id);
                    return `
                <div class="modal-option ${alreadyContains ? 'already-contains' : ''}" data-id="${p.id}">
                    <span>${p.name}</span>
                    ${
                        alreadyContains
                            ? `<button class="remove-from-playlist-btn-modal" title="Remove from playlist" style="background: transparent; border: none; color: inherit; cursor: pointer; padding: 4px; display: flex; align-items: center;">${SVG_BIN(20)}</button>`
                            : ''
                    }
                </div>
            `;
                })
                .join('');
        return true;
    };

    if (!(await renderModal())) return;

    const closeModal = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const handleOptionClick = async (e) => {
        const removeBtn = e.target.closest('.remove-from-playlist-btn-modal');
        const option = e.target.closest('.modal-option');

        if (!option) return;

        if (option.classList.contains('create-new-option')) {
            closeModal();
            const createModal = document.getElementById('playlist-modal');
            document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-cover-input').value = '';
            document.getElementById('playlist-cover-file-input').value = '';
            document.getElementById('playlist-description-input').value = '';
            createModal.dataset.editingId = '';
            document.getElementById('import-section').style.display = 'none';

            // Reset cover upload state
            const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
            const coverUrlInput = document.getElementById('playlist-cover-input');
            const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
            if (coverUploadBtn) {
                coverUploadBtn.style.flex = '1';
                coverUploadBtn.style.display = 'flex';
            }
            if (coverUrlInput) coverUrlInput.style.display = 'none';
            if (coverToggleUrlBtn) {
                coverToggleUrlBtn.textContent = 'or URL';
                coverToggleUrlBtn.title = 'Switch to URL input';
            }

            // Pass track
            createModal._pendingTracks = [track];

            createModal.classList.add('active');
            document.getElementById('playlist-name-input').focus();
            return;
        }

        const playlistId = option.dataset.id;

        if (removeBtn) {
            e.stopPropagation();
            await db.removeTrackFromPlaylist(playlistId, track.id);
            const updatedPlaylist = await db.getPlaylist(playlistId);
            syncManager.syncUserPlaylist(updatedPlaylist, 'update');
            showNotification(`Removed from playlist: ${option.querySelector('span').textContent}`);
            await renderModal();
        } else {
            if (option.classList.contains('already-contains')) return;

            await db.addTrackToPlaylist(playlistId, track);
            const updatedPlaylist = await db.getPlaylist(playlistId);
            syncManager.syncUserPlaylist(updatedPlaylist, 'update');
            showNotification(`Added to playlist: ${option.querySelector('span').textContent}`);
            closeModal();
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
}

export async function handleTrackAction(
    action,
    item,
    player,
    api,
    lyricsManager,
    type = 'track',
    ui = null,
    scrobbler = null,
    extraData = null
) {
    if (!item) return;

    // Actions not allowed for unavailable tracks
    const forbiddenForUnavailable = [
        'add-to-queue',
        'play-next',
        'track-mix',
        'download',
        'start-radio',
        'start-infinite-radio',
    ];
    if (item.isUnavailable && forbiddenForUnavailable.includes(action)) {
        showNotification('This track is unavailable.');
        return;
    }

    if (action === 'start-radio' || action === 'start-infinite-radio') {
        let tracks = [];
        if (type === 'track') {
            tracks = [item];
        } else if (item.tracks) {
            tracks = item.tracks;
        } else if (type === 'album') {
            const data = await api.getAlbum(item.id);
            tracks = data.tracks;
        } else if (type === 'playlist') {
            const data = await api.getPlaylist(item.uuid);
            tracks = data.tracks;
        } else if (type === 'user-playlist') {
            const playlist = await db.getPlaylist(item.id);
            tracks = playlist ? playlist.tracks : [];
        }

        if (tracks.length > 0) {
            player.setQueue(tracks, 0);
            player.playAtIndex(0);
            player.enableRadio(tracks);
            showNotification(`Started radio based on ${type}: ${item.title || item.name}`);
        } else {
            showNotification('Could not start infinite radio: No tracks found');
        }
        return;
    }

    if (action === 'track-mix' && type === 'track') {
        if (item.mixes && item.mixes.TRACK_MIX) {
            navigate(`/mix/${item.mixes.TRACK_MIX}`);
        }
        return;
    }

    // Collection Actions (Album, Playlist, Mix)
    const isCollection = ['album', 'playlist', 'user-playlist', 'mix'].includes(type);
    const collectionActions = ['play-card', 'shuffle-play-card', 'add-to-queue', 'play-next', 'download', 'start-mix'];

    if (isCollection && collectionActions.includes(action)) {
        try {
            // Check if album/artist is blocked
            const { contentBlockingSettings } = await import('./storage.js');
            if (type === 'album' && contentBlockingSettings.shouldHideAlbum(item)) {
                showNotification('This album is blocked');
                return;
            }

            let tracks = [];
            let collectionItem = item;

            if (type === 'album') {
                const data = await api.getAlbum(item.id);
                tracks = data.tracks;
                collectionItem = data.album || item;
            } else if (type === 'playlist') {
                const data = await api.getPlaylist(item.uuid);
                tracks = data.tracks;
                collectionItem = data.playlist || item;
            } else if (type === 'user-playlist') {
                let playlist = await db.getPlaylist(item.id);
                if (!playlist) {
                    try {
                        playlist = await syncManager.getPublicPlaylist(item.id);
                    } catch {
                        /* ignore */
                    }
                }
                tracks = playlist ? playlist.tracks : item.tracks || [];
                collectionItem = playlist || item;
            } else if (type === 'mix') {
                const data = await api.getMix(item.id);
                tracks = data.tracks;
                collectionItem = data.mix || item;
            }

            if (tracks.length === 0 && action !== 'start-mix') {
                showNotification(`No tracks found in this ${type}`);
                return;
            }

            if (action === 'download') {
                if (type === 'album') {
                    await downloadAlbumAsZip(
                        collectionItem,
                        tracks,
                        api,
                        downloadQualitySettings.getQuality(),
                        lyricsManager
                    );
                } else {
                    await downloadPlaylistAsZip(
                        collectionItem,
                        tracks,
                        api,
                        downloadQualitySettings.getQuality(),
                        lyricsManager
                    );
                }
                return;
            }

            // Filter blocked tracks from collections
            tracks = contentBlockingSettings.filterTracks(tracks);

            if (action === 'add-to-queue') {
                player.addToQueue(tracks);
                if (window.renderQueueFunction) window.renderQueueFunction();
                showNotification(`Added ${tracks.length} tracks to queue`);
                return;
            }

            if (action === 'play-next') {
                player.addNextToQueue(tracks);
                if (window.renderQueueFunction) window.renderQueueFunction();
                showNotification(`Playing next: ${tracks.length} tracks`);
                return;
            }

            if (action === 'start-mix') {
                if (type === 'album' && collectionItem.artist?.id) {
                    const artistData = await api.getArtist(collectionItem.artist.id);
                    if (artistData.mixes?.ARTIST_MIX) {
                        navigate(`/mix/${artistData.mixes.ARTIST_MIX}`);
                        return;
                    }
                }
                // Fallback to item's own page or first track's mix
                if (tracks.length > 0 && tracks[0].mixes?.TRACK_MIX) {
                    navigate(`/mix/${tracks[0].mixes.TRACK_MIX}`);
                } else {
                    navigate(`/${type.replace('user-', '')}/${item.id || item.uuid}`);
                }
                return;
            }

            // play-card and shuffle-play-card
            if (action === 'shuffle-play-card') {
                player.shuffleActive = true;
                const tracksToShuffle = [...tracks];
                tracksToShuffle.sort(() => Math.random() - 0.5);
                player.setQueue(tracksToShuffle, 0);
                const shuffleBtn = document.getElementById('shuffle-btn');
                if (shuffleBtn) shuffleBtn.classList.add('active');
            } else {
                player.setQueue(tracks, 0);
                const shuffleBtn = document.getElementById('shuffle-btn');
                if (shuffleBtn) shuffleBtn.classList.remove('active');
            }
            player.playAtIndex(0);
            const name = type === 'user-playlist' ? collectionItem.name : collectionItem.title;
            showNotification(`Playing ${type.replace('user-', '')}: ${name}`);
        } catch (error) {
            console.error('Failed to handle collection action:', error);
            showNotification(`Failed to process ${type} action`);
        }
        return;
    }

    if (action === 'toggle-pin') {
        const pinned = await db.togglePinned(item, type);
        showNotification(pinned ? `Pinned to sidebar` : `Unpinned from sidebar`);

        if (ui && typeof ui.renderPinnedItems === 'function') {
            ui.renderPinnedItems();
        }
    }

    // Individual Track Actions
    // Check if track/artist is blocked
    const { contentBlockingSettings } = await import('./storage.js');
    if (type === 'track' && contentBlockingSettings.shouldHideTrack(item)) {
        showNotification('This track is blocked');
        return;
    }

    if (action === 'add-to-queue') {
        trackAddToQueue(item, 'end');
        player.addToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Added to queue: ${item.title}`);
    } else if (action === 'play-next') {
        trackPlayNext(item);
        player.addNextToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Playing next: ${item.title}`);
    } else if (action === 'play-card') {
        player.setQueue([item], 0);
        player.playAtIndex(0);
        showNotification(`Playing track: ${item.title}`);
    } else if (action === 'start-mix') {
        trackStartMix(type, item);
        if (item.mixes?.TRACK_MIX) {
            navigate(`/mix/${item.mixes.TRACK_MIX}`);
        } else {
            showNotification('No mix available for this track');
        }
    } else if (action === 'download') {
        trackDownloadTrack(item, downloadQualitySettings.getQuality());
        await downloadTrackWithMetadata(item, downloadQualitySettings.getQuality(), api, lyricsManager);
    } else if (action === 'toggle-like') {
        const added = await db.toggleFavorite(type, item);
        syncManager.syncLibraryItem(type, item, added);

        // Track like/unlike
        if (added) {
            if (type === 'track') trackLikeTrack(item);
            else if (type === 'video') trackEvent('Like Video', { title: item.title });
            else if (type === 'album') trackLikeAlbum(item);
            else if (type === 'artist') trackLikeArtist(item);
            else if (type === 'playlist' || type === 'user-playlist') trackLikePlaylist(item);
        } else {
            if (type === 'track') trackUnlikeTrack(item);
            else if (type === 'video') trackEvent('Unlike Video', { title: item.title });
            else if (type === 'album') trackUnlikeAlbum(item);
            else if (type === 'artist') trackUnlikeArtist(item);
            else if (type === 'playlist' || type === 'user-playlist') trackUnlikePlaylist(item);
        }

        if (added && type === 'track' && scrobbler) {
            if (lastFMStorage.isEnabled() && lastFMStorage.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
            if (libreFmSettings.isEnabled() && libreFmSettings.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
            if (listenBrainzSettings.isEnabled() && listenBrainzSettings.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
        }

        // Update all instances of this item's like button on the page
        const id = type === 'playlist' ? item.uuid : item.id;
        const selector =
            type === 'track'
                ? `[data-track-id="${id}"] .like-btn`
                : type === 'video'
                  ? `.card[data-video-id="${id}"] .like-btn`
                  : `.card[data-${type}-id="${id}"] .like-btn, .card[data-playlist-id="${id}"] .like-btn`;

        // Also check header buttons
        const headerBtn = document.getElementById(`like-${type}-btn`);

        const elementsToUpdate = [...document.querySelectorAll(selector)];
        if (headerBtn) elementsToUpdate.push(headerBtn);

        const nowPlayingLikeBtn = document.getElementById('now-playing-like-btn');
        if (nowPlayingLikeBtn && (type === 'track' || type === 'video') && player?.currentTrack?.id === item.id) {
            elementsToUpdate.push(nowPlayingLikeBtn);
        }

        const fsLikeBtn = document.getElementById('fs-like-btn');
        if (fsLikeBtn && (type === 'track' || type === 'video') && player?.currentTrack?.id === item.id) {
            elementsToUpdate.push(fsLikeBtn);
        }

        elementsToUpdate.forEach((btn) => {
            const heartIcon = btn.querySelector('svg');
            if (heartIcon) {
                heartIcon.classList.toggle('filled', added);
                if (heartIcon.hasAttribute('fill')) {
                    heartIcon.setAttribute('fill', added ? 'currentColor' : 'none');
                }
            }
            btn.classList.toggle('active', added);
            btn.title = added ? 'Remove from Favorites' : 'Add to Favorites';
        });

        // Handle Library Page Update
        if (window.location.hash === '#library') {
            const itemSelector =
                type === 'track'
                    ? `.track-item[data-track-id="${id}"]`
                    : type === 'video'
                      ? `.video-card[data-video-id="${id}"]`
                      : `.card[data-${type}-id="${id}"], .card[data-playlist-id="${id}"]`;

            const itemEl = document.querySelector(itemSelector);

            if (!added && itemEl) {
                // Remove item
                const container = itemEl.parentElement;
                itemEl.remove();
                if (container && container.children.length === 0) {
                    const msg =
                        type === 'track'
                            ? 'No liked tracks yet.'
                            : type === 'video'
                              ? 'No liked videos yet.'
                              : `No liked ${type}s yet.`;
                    container.innerHTML = `<div class="placeholder-text">${msg}</div>`;
                }
            } else if (added && !itemEl && ui && (type === 'track' || type === 'video')) {
                // Add item
                if (type === 'track') {
                    const tracksContainer = document.getElementById('library-tracks-container');
                    if (tracksContainer) {
                        const placeholder = tracksContainer.querySelector('.placeholder-text');
                        if (placeholder) placeholder.remove();

                        const index = tracksContainer.children.length;
                        const trackHTML = ui.createTrackItemHTML(item, index, true, false);

                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = trackHTML;
                        const newEl = tempDiv.firstElementChild;

                        if (newEl) {
                            tracksContainer.appendChild(newEl);
                            trackDataStore.set(newEl, item);
                            ui.updateLikeState(newEl, 'track', item.id);
                        }
                    }
                } else if (type === 'video') {
                    const videosTabContent = document.getElementById('library-tab-videos');
                    if (videosTabContent) {
                        const grid = videosTabContent.querySelector('.card-grid');
                        if (grid) {
                            const placeholder = grid.querySelector('.placeholder-text');
                            if (placeholder) grid.innerHTML = '';

                            const videoHTML = ui.createVideoCardHTML(item);
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = videoHTML;
                            const newEl = tempDiv.firstElementChild;

                            if (newEl) {
                                grid.appendChild(newEl);
                                trackDataStore.set(newEl, item);
                                ui.updateLikeState(newEl, 'video', item.id);
                                newEl.addEventListener('click', (e) => {
                                    if (
                                        e.target.closest('.card-play-btn') ||
                                        e.target.closest('.card-image-container')
                                    ) {
                                        e.stopPropagation();
                                        player.playVideo(item);
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }
    } else if (action === 'add-to-playlist') {
        const modal = document.getElementById('playlist-select-modal');
        const list = document.getElementById('playlist-select-list');
        const cancelBtn = document.getElementById('playlist-select-cancel');
        const overlay = modal.querySelector('.modal-overlay');

        const renderModal = async () => {
            const playlists = await db.getPlaylists(true);
            // Removed empty check to allow creating new playlist

            const trackId = item.id;
            const trackType = item.type || 'track';
            const playlistsWithTrack = new Set();

            for (const playlist of playlists) {
                if (
                    playlist.tracks &&
                    playlist.tracks.some((t) => t.id == trackId && (t.type || 'track') === trackType)
                ) {
                    playlistsWithTrack.add(playlist.id);
                }
            }

            list.innerHTML =
                `
                <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                    <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
                </div>
            ` +
                playlists
                    .map((p) => {
                        const alreadyContains = playlistsWithTrack.has(p.id);
                        return `
                    <div class="modal-option ${alreadyContains ? 'already-contains' : ''}" data-id="${p.id}">
                        <span>${p.name}</span>
                        ${
                            alreadyContains
                                ? `<button class="remove-from-playlist-btn-modal" title="Remove from playlist" style="background: transparent; border: none; color: inherit; cursor: pointer; padding: 4px; display: flex; align-items: center;">${SVG_BIN(20)}</button>`
                                : ''
                        }
                    </div>
                `;
                    })
                    .join('');
            return true;
        };

        if (!(await renderModal())) return;

        const closeModal = () => {
            modal.classList.remove('active');
            cleanup();
        };

        const handleOptionClick = async (e) => {
            const removeBtn = e.target.closest('.remove-from-playlist-btn-modal');
            const option = e.target.closest('.modal-option');

            if (!option) return;

            if (option.classList.contains('create-new-option')) {
                closeModal();
                const createModal = document.getElementById('playlist-modal');
                document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
                document.getElementById('playlist-name-input').value = '';
                document.getElementById('playlist-cover-input').value = '';
                document.getElementById('playlist-cover-file-input').value = '';
                document.getElementById('playlist-description-input').value = '';
                createModal.dataset.editingId = '';
                document.getElementById('import-section').style.display = 'none';

                // Reset cover upload state
                const coverUploadBtn = document.getElementById('playlist-cover-upload-btn');
                const coverUrlInput = document.getElementById('playlist-cover-input');
                const coverToggleUrlBtn = document.getElementById('playlist-cover-toggle-url-btn');
                if (coverUploadBtn) {
                    coverUploadBtn.style.flex = '1';
                    coverUploadBtn.style.display = 'flex';
                }
                if (coverUrlInput) coverUrlInput.style.display = 'none';
                if (coverToggleUrlBtn) {
                    coverToggleUrlBtn.textContent = 'or URL';
                    coverToggleUrlBtn.title = 'Switch to URL input';
                }

                // Pass track
                createModal._pendingTracks = [item];

                createModal.classList.add('active');
                document.getElementById('playlist-name-input').focus();
                return;
            }

            const playlistId = option.dataset.id;

            if (removeBtn) {
                e.stopPropagation();
                await db.removeTrackFromPlaylist(playlistId, item.id);
                const updatedPlaylist = await db.getPlaylist(playlistId);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                showNotification(`Removed from playlist: ${option.querySelector('span').textContent}`);
                await renderModal();
            } else {
                if (option.classList.contains('already-contains')) return;

                await db.addTrackToPlaylist(playlistId, item);
                const updatedPlaylist = await db.getPlaylist(playlistId);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                showNotification(`Added to playlist: ${option.querySelector('span').textContent}`);
                closeModal();
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
    } else if (action === 'go-to-artist') {
        const artistId = extraData?.artistId || item.artist?.id || item.artists?.[0]?.id;
        const trackerSheetId = extraData?.trackerSheetId || (item.isTracker ? item.trackerInfo?.sheetId : null);

        if (trackerSheetId) {
            navigate(`/unreleased/${trackerSheetId}`);
        } else if (artistId) {
            navigate(`/artist/${artistId}`);
        }
    } else if (action === 'go-to-album') {
        if (item.album?.id) {
            navigate(`/album/${item.album.id}`);
        }
    } else if (action === 'copy-link' || action === 'share') {
        // Use stored href from card if available, otherwise construct URL
        const contextMenu = document.getElementById('context-menu');
        const storedHref = contextMenu?._contextHref;
        const url = getShareUrl(storedHref ? storedHref : `/${type}/${item.id || item.uuid}`);

        trackCopyLink(type, item.id || item.uuid);
        navigator.clipboard.writeText(url).then(() => {
            showNotification('Link copied to clipboard!');
        });
    } else if (action === 'open-in-new-tab') {
        // Use stored href from card if available, otherwise construct URL
        const contextMenu = document.getElementById('context-menu');
        const storedHref = contextMenu?._contextHref;
        const url = storedHref
            ? `${window.location.origin}${storedHref}`
            : `${window.location.origin}/${type}/${item.id || item.uuid}`;

        trackOpenInNewTab(type, item.id || item.uuid);
        window.open(url, '_blank');
    } else if (action === 'open-in-harmony') {
        const albumId = item.id;
        const harmonyUrl = `https://harmony.pulsewidth.org.uk/release?url=${encodeURIComponent(`https://tidal.com/album/${albumId}`)}&gtin=&region=&musicbrainz=&deezer=&itunes=&spotify=&tidal=&beatport=`;
        window.open(harmonyUrl, '_blank');
    } else if (action === 'track-info') {
        // Show detailed track info modal
        const isTracker = item.isTracker;
        let infoHTML = '';

        if (isTracker && item.trackerInfo) {
            // Detailed unreleased/tracker track info
            const releaseDate = item.trackerInfo.releaseDate || item.streamStartDate;
            const dateDisplay = releaseDate ? new Date(releaseDate).toLocaleDateString() : 'Unknown';
            const addedDate = item.trackerInfo.addedDate
                ? new Date(item.trackerInfo.addedDate).toLocaleDateString()
                : 'Unknown';

            infoHTML = `
                <div style="padding: 1.5rem; max-width: 500px; max-height: 80vh; overflow-y: auto;">
                    <h3 style="margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600;">${escapeHtml(item.title)}</h3>
                    <div style="color: var(--muted-foreground); font-size: 0.9rem; line-height: 1.8;">
                        <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                            <p style="color: var(--primary); font-weight: 500;">Unreleased Track</p>
                        </div>

                        <div style="display: grid; gap: 0.5rem;">
                            ${item.artists ? `<p><strong style="color: var(--foreground);">Artist:</strong> ${escapeHtml(Array.isArray(item.artists) ? item.artists.map((a) => a.name || a).join(', ') : item.artists)}</p>` : ''}
                            ${item.trackerInfo.artist ? `<p><strong style="color: var(--foreground);">Tracked Artist:</strong> ${escapeHtml(item.trackerInfo.artist)}</p>` : ''}
                            ${item.trackerInfo.project ? `<p><strong style="color: var(--foreground);">Project:</strong> ${escapeHtml(item.trackerInfo.project)}</p>` : ''}
                            ${item.trackerInfo.era ? `<p><strong style="color: var(--foreground);">Era:</strong> ${escapeHtml(item.trackerInfo.era)}</p>` : ''}
                            ${item.trackerInfo.timeline ? `<p><strong style="color: var(--foreground);">Timeline:</strong> ${escapeHtml(item.trackerInfo.timeline)}</p>` : ''}
                            ${item.trackerInfo.category ? `<p><strong style="color: var(--foreground);">Category:</strong> ${escapeHtml(item.trackerInfo.category)}</p>` : ''}
                            ${item.trackerInfo.trackNumber ? `<p><strong style="color: var(--foreground);">Track Number:</strong> ${escapeHtml(String(item.trackerInfo.trackNumber))}</p>` : ''}
                            <p><strong style="color: var(--foreground);">Duration:</strong> ${escapeHtml(formatTime(item.duration))}</p>
                            ${releaseDate !== 'Unknown' ? `<p><strong style="color: var(--foreground);">Release Date:</strong> ${escapeHtml(dateDisplay)}</p>` : ''}
                            ${item.trackerInfo.addedDate ? `<p><strong style="color: var(--foreground);">Added to Tracker:</strong> ${escapeHtml(addedDate)}</p>` : ''}
                            ${item.trackerInfo.leakedDate ? `<p><strong style="color: var(--foreground);">Leak Date:</strong> ${escapeHtml(new Date(item.trackerInfo.leakedDate).toLocaleDateString())}</p>` : ''}
                            ${item.trackerInfo.recordingDate ? `<p><strong style="color: var(--foreground);">Recording Date:</strong> ${escapeHtml(new Date(item.trackerInfo.recordingDate).toLocaleDateString())}</p>` : ''}
                        </div>

                        ${
                            item.trackerInfo.description
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Description</p>
                                <p style="font-size: 0.85rem; line-height: 1.6;">${escapeHtml(item.trackerInfo.description)}</p>
                            </div>
                        `
                                : ''
                        }

                        ${
                            item.trackerInfo.notes
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Notes</p>
                                <p style="font-size: 0.85rem; line-height: 1.6;">${escapeHtml(item.trackerInfo.notes)}</p>
                            </div>
                        `
                                : ''
                        }

                        ${
                            item.trackerInfo.sourceUrl
                                ? `
                            <div style="margin-top: 1rem;">
                                <p style="margin-bottom: 0.5rem;"><strong style="color: var(--foreground);">Source URL:</strong></p>
                                <a href="${escapeHtml(item.trackerInfo.sourceUrl)}" target="_blank" style="color: var(--primary); word-break: break-all; font-size: 0.85rem; display: block; padding: 0.5rem; background: var(--accent); border-radius: 6px; text-decoration: none;">
                                    ${escapeHtml(item.trackerInfo.sourceUrl)}
                                </a>
                            </div>
                        `
                                : ''
                        }

                        ${item.id ? `<p style="margin-top: 1rem; font-size: 0.8rem; color: var(--muted);"><strong>Track ID:</strong> ${escapeHtml(item.id)}</p>` : ''}
                    </div>
                    <button class="btn-primary track-info-close-btn" style="margin-top: 1.5rem; width: 100%;">Close</button>
                </div>
            `;
        } else {
            // Detailed normal track info
            const releaseDate = item.album?.releaseDate || item.streamStartDate;
            const dateDisplay = releaseDate ? new Date(releaseDate).toLocaleDateString() : 'Unknown';
            const quality = item.audioQuality || 'Unknown';
            const bitrate = item.bitrate ? `${item.bitrate} kbps` : '';

            infoHTML = `
                <div style="padding: 1.5rem; max-width: 500px; max-height: 80vh; overflow-y: auto;">
                    <h3 style="margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600;">${escapeHtml(item.title)}</h3>
                    <div style="color: var(--muted-foreground); font-size: 0.9rem; line-height: 1.8;">
                        <div style="display: grid; gap: 0.5rem;">
                            <p><strong style="color: var(--foreground);">Artist:</strong> ${escapeHtml(getTrackArtists(item))}</p>
                            <p><strong style="color: var(--foreground);">Album:</strong> ${escapeHtml(item.album?.title || 'Unknown')}</p>
                            ${item.album?.artist?.name ? `<p><strong style="color: var(--foreground);">Album Artist:</strong> ${escapeHtml(item.album.artist.name)}</p>` : ''}
                            <p><strong style="color: var(--foreground);">Release Date:</strong> ${escapeHtml(dateDisplay)}</p>
                            <p><strong style="color: var(--foreground);">Duration:</strong> ${escapeHtml(formatTime(item.duration))}</p>
                            ${item.trackNumber ? `<p><strong style="color: var(--foreground);">Track Number:</strong> ${escapeHtml(String(item.trackNumber))}</p>` : ''}
                            ${item.discNumber ? `<p><strong style="color: var(--foreground);">Disc Number:</strong> ${escapeHtml(String(item.discNumber))}</p>` : ''}
                            ${item.version ? `<p><strong style="color: var(--foreground);">Version:</strong> ${escapeHtml(item.version)}</p>` : ''}
                            ${item.explicit ? `<p><strong style="color: var(--foreground);">Explicit:</strong> Yes</p>` : ''}
                            <p><strong style="color: var(--foreground);">Quality:</strong> ${escapeHtml(quality)} ${bitrate ? `(${escapeHtml(bitrate)})` : ''}</p>
                        </div>

                        ${
                            item.credits && item.credits.length > 0
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Credits</p>
                                <div style="font-size: 0.85rem; line-height: 1.6;">
                                    ${item.credits.map((c) => `<p>${escapeHtml(c.type)}: ${escapeHtml(c.name)}</p>`).join('')}
                                </div>
                            </div>
                        `
                                : ''
                        }

                        ${
                            item.composers && item.composers.length > 0
                                ? `
                            <p style="margin-top: 0.5rem;"><strong style="color: var(--foreground);">Composers:</strong> ${escapeHtml(item.composers.map((c) => c.name).join(', '))}</p>
                        `
                                : ''
                        }

                        ${
                            item.lyrics?.text
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Has Lyrics</p>
                            </div>
                        `
                                : ''
                        }

                        ${item.id ? `<p style="margin-top: 1rem; font-size: 0.8rem; color: var(--muted);"><strong>Track ID:</strong> ${escapeHtml(item.id)}</p>` : ''}
                        ${item.album?.id ? `<p style="font-size: 0.8rem; color: var(--muted);"><strong>Album ID:</strong> ${escapeHtml(item.album.id)}</p>` : ''}
                    </div>
                    <button class="btn-primary track-info-close-btn" style="margin-top: 1.5rem; width: 100%;">Close</button>
                </div>
            `;
        }

        // Create and show modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText =
            'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        modal.innerHTML = infoHTML;
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
        const closeBtn = modal.querySelector('.track-info-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => modal.remove();
        }
        document.body.appendChild(modal);
    } else if (action === 'open-original-url') {
        // Open the original source URL for the track
        let url = null;

        if (item.isTracker && item.trackerInfo && item.trackerInfo.sourceUrl) {
            url = item.trackerInfo.sourceUrl;
        } else if (item.remoteUrl) {
            url = item.remoteUrl;
        }

        if (url) {
            window.open(url, '_blank');
        } else {
            showNotification('No original URL available for this track.');
        }
    } else if (action === 'block-track') {
        const { contentBlockingSettings } = await import('./storage.js');
        if (contentBlockingSettings.isTrackBlocked(item.id)) {
            contentBlockingSettings.unblockTrack(item.id);
            trackUnblockTrack(item);
            showNotification(`Unblocked track: ${item.title}`);
        } else {
            contentBlockingSettings.blockTrack(item);
            trackBlockTrack(item);
            showNotification(`Blocked track: ${item.title}`);
        }
    } else if (action === 'block-album') {
        const { contentBlockingSettings } = await import('./storage.js');
        const albumId = type === 'album' ? item.id : item.album?.id;
        const albumTitle = type === 'album' ? item.title : item.album?.title;
        const albumArtist = type === 'album' ? item.artist : item.album?.artist;

        if (!albumId) {
            showNotification('No album information available');
            return;
        }

        const albumObj = { id: albumId, title: albumTitle, artist: albumArtist };

        if (contentBlockingSettings.isAlbumBlocked(albumId)) {
            contentBlockingSettings.unblockAlbum(albumId);
            trackUnblockAlbum(albumObj);
            showNotification(`Unblocked album: ${albumTitle || 'Unknown Album'}`);
        } else {
            contentBlockingSettings.blockAlbum(albumObj);
            trackBlockAlbum(albumObj);
            showNotification(`Blocked album: ${albumTitle || 'Unknown Album'}`);
        }
    } else if (action === 'block-artist') {
        const { contentBlockingSettings } = await import('./storage.js');
        const artistId = item.artist?.id || item.artists?.[0]?.id;
        const artistName = item.artist?.name || item.artists?.[0]?.name || item.name;

        if (!artistId) {
            showNotification('No artist information available');
            return;
        }

        const artistObj = { id: artistId, name: artistName };

        if (contentBlockingSettings.isArtistBlocked(artistId)) {
            contentBlockingSettings.unblockArtist(artistId);
            trackUnblockArtist(artistObj);
            showNotification(`Unblocked artist: ${artistName || 'Unknown Artist'}`);
        } else {
            contentBlockingSettings.blockArtist(artistObj);
            trackBlockArtist(artistObj);
            showNotification(`Blocked artist: ${artistName || 'Unknown Artist'}`);
        }
    }
}

async function updateContextMenuLikeState(contextMenu, contextTrack) {
    if (!contextMenu || !contextTrack) return;

    const type = contextMenu._contextType || 'track';

    const likeItem = contextMenu.querySelector('li[data-action="toggle-like"]');
    let isLiked = false;
    if (likeItem) {
        const key = type === 'playlist' ? contextTrack.uuid : contextTrack.id;
        isLiked = await db.isFavorite(type, key);
    }

    const pinItem = contextMenu.querySelector('li[data-action="toggle-pin"]');
    if (pinItem) {
        const isPinned = await db.isPinned(contextTrack.id || contextTrack.uuid);
        pinItem.textContent = isPinned ? 'Unpin' : 'Pin';
    }

    const trackMixItem = contextMenu.querySelector('li[data-action="track-mix"]');
    if (trackMixItem) {
        const hasMix = contextTrack.mixes && contextTrack.mixes.TRACK_MIX;
        trackMixItem.style.display = hasMix ? 'block' : 'none';
    }

    // Show/hide "Open Original URL" only for unreleased/tracker tracks
    const openOriginalUrlItem = contextMenu.querySelector('li[data-action="open-original-url"]');
    if (openOriginalUrlItem) {
        const isUnreleased = contextTrack.isTracker || (contextTrack.trackerInfo && contextTrack.trackerInfo.sourceUrl);
        openOriginalUrlItem.style.display = isUnreleased ? 'block' : 'none';
    }

    // Update block/unblock labels
    const { contentBlockingSettings } = await import('./storage.js');

    const blockTrackItem = contextMenu.querySelector('li[data-action="block-track"]');
    if (blockTrackItem) {
        const isBlocked = contentBlockingSettings.isTrackBlocked(contextTrack.id);
        blockTrackItem.textContent = isBlocked
            ? blockTrackItem.dataset.labelUnblock || 'Unblock track'
            : blockTrackItem.dataset.labelBlock || 'Block track';
    }

    const blockAlbumItem = contextMenu.querySelector('li[data-action="block-album"]');
    if (blockAlbumItem) {
        const albumId = type === 'album' ? contextTrack.id : contextTrack.album?.id;
        const isBlocked = albumId ? contentBlockingSettings.isAlbumBlocked(albumId) : false;
        blockAlbumItem.textContent = isBlocked
            ? blockAlbumItem.dataset.labelUnblock || 'Unblock album'
            : blockAlbumItem.dataset.labelBlock || 'Block album';
    }

    const blockArtistItem = contextMenu.querySelector('li[data-action="block-artist"]');
    if (blockArtistItem) {
        const artistId = contextTrack.artist?.id || contextTrack.artists?.[0]?.id;
        const isBlocked = artistId ? contentBlockingSettings.isArtistBlocked(artistId) : false;
        blockArtistItem.textContent = isBlocked
            ? blockArtistItem.dataset.labelUnblock || 'Unblock artist'
            : blockArtistItem.dataset.labelBlock || 'Block artist';
    }

    // Filter items based on type
    contextMenu.querySelectorAll('li[data-action]').forEach((item) => {
        const filter = item.dataset.typeFilter;
        if (filter) {
            const types = filter.split(',');
            item.style.display = types.includes(type) ? 'block' : 'none';
        } else {
            item.style.display = 'block';
        }

        // Update labels for Like/Save
        if (item.dataset.action === 'toggle-like') {
            const labelPrefix = isLiked ? 'labelUnlike' : 'label';
            const labelKey = `${labelPrefix}${type.charAt(0).toUpperCase() + type.slice(1).replace('User-playlist', 'Playlist')}`;
            const fallbackKey = isLiked ? 'labelUnlikeTrack' : 'labelTrack';
            const label = item.dataset[labelKey] || item.dataset[fallbackKey] || (isLiked ? 'Unlike' : 'Like');
            item.textContent = label;
        }
    });

    // Handle multiple artists for "Go to artist"
    const artistItem = contextMenu.querySelector('li[data-action="go-to-artist"]');
    if (artistItem) {
        const artists = Array.isArray(contextTrack.artists)
            ? contextTrack.artists
            : contextTrack.artist
              ? [contextTrack.artist]
              : [];
        const canShowArtist = type === 'track' || type === 'album';

        if (artists.length > 1 && canShowArtist) {
            artistItem.style.display = 'block';
            artistItem.textContent = 'Go to artists';
            artistItem.dataset.hasMultipleArtists = 'true';
        } else {
            const hasArtist = artists.length > 0;
            artistItem.style.display = hasArtist && canShowArtist ? 'block' : 'none';
            artistItem.dataset.hasMultipleArtists = 'false';
            artistItem.textContent = artists.length > 1 ? 'Go to artists' : 'Go to artist';
            delete artistItem.dataset.artistId;
            delete artistItem.dataset.trackerSheetId;
        }
    }
}

export function initializeTrackInteractions(player, api, mainContent, contextMenu, lyricsManager, ui, scrobbler) {
    let contextTrack = null;

    mainContent.addEventListener('touchstart', handleTrackTouchStart, { passive: true });
    mainContent.addEventListener('touchmove', handleTrackTouchMove, { passive: true });
    mainContent.addEventListener('touchend', handleTrackTouchEnd, { passive: true });

    mainContent.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.track-action-btn, .like-btn, .play-btn');
        if (actionBtn && actionBtn.dataset.action) {
            e.preventDefault(); // Prevent card navigation
            e.stopPropagation();
            const itemElement = actionBtn.closest('.track-item, .card');
            const action = actionBtn.dataset.action;
            const type = actionBtn.dataset.type || 'track';

            let item = itemElement ? trackDataStore.get(itemElement) : trackDataStore.get(actionBtn);

            // If no item from element (e.g. header buttons), try to get from hash
            if (!item && action === 'toggle-like') {
                const id = window.location.pathname.split('/')[2];
                if (id) {
                    try {
                        if (type === 'album') {
                            const data = await api.getAlbum(id);
                            item = data.album;
                        } else if (type === 'artist') {
                            item = await api.getArtist(id);
                        } else if (type === 'playlist') {
                            const data = await api.getPlaylist(id);
                            item = data.playlist;
                        } else if (type === 'mix') {
                            const data = await api.getMix(id);
                            item = data.mix;
                        } else if (type === 'track') {
                            const data = await api.getTrack(id);
                            item = data.track;
                        }
                    } catch (err) {
                        console.error(err);
                    }
                }
            }

            if (item) {
                await handleTrackAction(action, item, player, api, lyricsManager, type, ui, scrobbler);
            }
            return;
        }

        const cardMenuBtn = e.target.closest('.card-menu-btn, #album-menu-btn');
        if (cardMenuBtn) {
            e.stopPropagation();
            const card = cardMenuBtn.closest('.card');
            const type = cardMenuBtn.dataset.type;
            const id = cardMenuBtn.dataset.id;

            let item = card ? trackDataStore.get(card) : null;

            if (!item) {
                // Check if item is stored on the button itself (e.g., album page header menu)
                item = trackDataStore.get(cardMenuBtn);
            }

            if (!item) {
                // Fallback: create a shell item
                item = { id, uuid: id, title: card?.querySelector('.card-title')?.textContent || 'Item' };
            }

            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
                contextMenu._originalHTML = null;
            }

            contextTrack = item;
            contextMenu._contextTrack = item;
            contextMenu._contextType = type;

            await updateContextMenuLikeState(contextMenu, item);
            const rect = cardMenuBtn.getBoundingClientRect();
            positionMenu(contextMenu, rect.left, rect.bottom + 5, rect);
            return;
        }

        const menuBtn = e.target.closest('.track-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            const trackItem = menuBtn.closest('.track-item');
            if (trackItem && !trackItem.dataset.queueIndex) {
                const clickedTrack = trackDataStore.get(trackItem);

                if (clickedTrack && clickedTrack.isLocal) return;

                if (
                    contextMenu.style.display === 'block' &&
                    contextTrack &&
                    clickedTrack &&
                    contextTrack.id === clickedTrack.id
                ) {
                    if (contextMenu._originalHTML) {
                        contextMenu.innerHTML = contextMenu._originalHTML;
                    }
                    contextMenu.style.display = 'none';
                    contextMenu._contextType = null;
                    contextMenu._originalHTML = null;
                    return;
                }

                contextTrack = clickedTrack;
                if (contextTrack) {
                    if (contextMenu._originalHTML) {
                        contextMenu.innerHTML = contextMenu._originalHTML;
                        contextMenu._originalHTML = null;
                    }
                    contextMenu._contextTrack = contextTrack;
                    contextMenu._contextType = menuBtn.dataset.type || trackItem.dataset.type || 'track';
                    if (trackSelection.isSelecting && trackSelection.selectedIds.size > 0) {
                        const selectedTracks = [];
                        document.querySelectorAll('.track-item.selected').forEach((item) => {
                            const track = trackDataStore.get(item);
                            if (track) selectedTracks.push(track);
                        });
                        contextMenu._selectedTracks = selectedTracks;
                    }
                    await updateContextMenuLikeState(contextMenu, contextTrack);
                    const rect = menuBtn.getBoundingClientRect();
                    positionMenu(contextMenu, rect.left, rect.bottom + 5, rect);
                }
            }
            return;
        }

        const checkbox = e.target.closest('.track-checkbox');
        if (checkbox) {
            e.stopPropagation();
            const trackItem = checkbox.closest('.track-item');
            if (trackItem) {
                toggleTrackSelection(trackItem, isMultiSelectToggle(e), isMultiSelectRange(e));
            }
            return;
        }

        const trackItem = e.target.closest('.track-item');
        if (trackItem && (trackItem.classList.contains('unavailable') || trackItem.classList.contains('blocked'))) {
            return;
        }
        if (isLongPress && longPressTrackItem === trackItem) {
            return;
        }
        if (
            trackItem &&
            !trackItem.dataset.queueIndex &&
            !e.target.closest('.remove-from-playlist-btn') &&
            !e.target.closest('.artist-link')
        ) {
            const clickedTrackId = trackItem.dataset.trackId;
            const isSearch = window.location.pathname.startsWith('/search/');

            if (isMultiSelectToggle(e)) {
                e.preventDefault();
                toggleTrackSelection(trackItem, true, isMultiSelectRange(e));
                return;
            }

            if (isMultiSelectRange(e) && trackSelection.isSelecting) {
                e.preventDefault();
                toggleTrackSelection(trackItem, false, true);
                return;
            }

            if (trackSelection.isSelecting) {
                return;
            }

            if (isSearch) {
                const clickedTrack = trackDataStore.get(trackItem);
                if (clickedTrack) {
                    if (trackItem.dataset.type === 'video') {
                        player.playVideo(clickedTrack);
                    } else {
                        player.setQueue([clickedTrack], 0);
                        document.getElementById('shuffle-btn').classList.remove('active');
                        player.playTrackFromQueue();

                        api.getTrackRecommendations(clickedTrack.id).then((recs) => {
                            if (recs && recs.length > 0) {
                                player.addToQueue(recs);
                            }
                        });
                    }
                }
            } else {
                const parentList = trackItem.closest('.track-list');
                const allTrackElements = Array.from(parentList.querySelectorAll('.track-item'));
                const trackList = allTrackElements.map((el) => trackDataStore.get(el)).filter(Boolean);

                if (trackList.length > 0) {
                    const startIndex = trackList.findIndex((t) => t.id == clickedTrackId);

                    player.setQueue(trackList, startIndex);

                    // Set artist popular tracks context if on artist page
                    console.log('[Events] Setting context:', {
                        page: ui.currentPage,
                        artistId: ui.currentArtistId,
                        trackCount: trackList.length,
                    });
                    if (ui.currentPage === 'artist' && ui.currentArtistId) {
                        player.setArtistPopularTracksContext(ui.currentArtistId, trackList, trackList.length, true);
                    }

                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
            }
        }

        // Handle artist link clicks in track lists
        const artistLink = e.target.closest('.artist-link');
        if (artistLink) {
            e.stopPropagation();
            const artistId = artistLink.dataset.artistId;
            const trackerSheetId = artistLink.dataset.trackerSheetId;
            if (trackerSheetId) {
                navigate(`/unreleased/${trackerSheetId}`);
            } else if (artistId) {
                navigate(`/artist/${artistId}`);
            }
            return;
        }

        const card = e.target.closest('.card');
        if (card) {
            // Don't navigate if card is blocked (unless clicking menu button)
            if (card.classList.contains('blocked') && !e.target.closest('.card-menu-btn')) {
                return;
            }

            if (e.target.closest('.edit-playlist-btn') || e.target.closest('.delete-playlist-btn')) {
                return;
            }

            const href = card.dataset.href;
            if (href) {
                // Allow native links inside card to work if any exist
                if (e.target.closest('a')) return;

                e.preventDefault();
                navigate(href);
            }
        }
    });

    mainContent.addEventListener('contextmenu', async (e) => {
        const trackItem = e.target.closest('.track-item, .queue-track-item');
        const card = e.target.closest('.card');

        if (trackItem) {
            e.preventDefault();
            if (trackItem.classList.contains('queue-track-item')) {
                // For queue items, get track from player's queue
                const queueIndex = parseInt(trackItem.dataset.queueIndex);
                contextTrack = player.getCurrentQueue()[queueIndex];
            } else {
                // For regular track items
                contextTrack = trackDataStore.get(trackItem);
            }

            if (contextTrack) {
                if (contextTrack.isLocal) return;

                if (contextMenu._originalHTML) {
                    contextMenu.innerHTML = contextMenu._originalHTML;
                    contextMenu._originalHTML = null;
                }

                // Store selected tracks for multi-select actions
                let selectedTracks = [];
                if (trackSelection.isSelecting && trackSelection.selectedIds.size > 0) {
                    document.querySelectorAll('.track-item.selected').forEach((item) => {
                        const track = trackDataStore.get(item);
                        if (track) selectedTracks.push(track);
                    });
                }

                // Hide actions for unavailable tracks
                const unavailableActions = ['play-next', 'add-to-queue', 'download', 'track-mix'];
                contextMenu.querySelectorAll('[data-action]').forEach((btn) => {
                    if (unavailableActions.includes(btn.dataset.action)) {
                        btn.style.display = contextTrack.isUnavailable ? 'none' : 'block';
                    }
                });

                contextMenu._contextTrack = contextTrack;
                contextMenu._contextType = contextTrack.type || 'track';
                contextMenu._selectedTracks = selectedTracks;
                await updateContextMenuLikeState(contextMenu, contextTrack);
                positionMenu(contextMenu, e.clientX, e.clientY);
            }
        } else if (card) {
            e.preventDefault();
            const type = card.dataset.albumId
                ? 'album'
                : card.dataset.playlistId
                  ? 'playlist'
                  : card.dataset.mixId
                    ? 'mix'
                    : card.dataset.href
                      ? card.dataset.href.split('/')[1]
                      : 'item';
            const id = card.dataset.albumId || card.dataset.playlistId || card.dataset.mixId;

            const item = trackDataStore.get(card) || {
                id,
                uuid: id,
                title: card.querySelector('.card-title')?.textContent,
            };

            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
                contextMenu._originalHTML = null;
            }

            contextTrack = item;
            contextMenu._contextTrack = item;
            contextMenu._contextType = type.replace('userplaylist', 'user-playlist');
            contextMenu._contextHref = card.dataset.href;

            await updateContextMenuLikeState(contextMenu, item);
            positionMenu(contextMenu, e.clientX, e.clientY);
        }
    });

    document.addEventListener('click', (e) => {
        if (contextMenu.style.display === 'block') {
            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
            }
            contextMenu.style.display = 'none';
            contextMenu._contextType = null;
            contextMenu._originalHTML = null;
        }

        if (
            trackSelection.isSelecting &&
            !e.target.closest('.track-item') &&
            !e.target.closest('.selection-bar') &&
            !e.target.closest('.track-checkbox')
        ) {
            clearSelection();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && trackSelection.isSelecting) {
            clearSelection();
        }
    });

    contextMenu.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const track = contextMenu._contextTrack || contextTrack;
        const type = contextMenu._contextType || 'track';

        if (action === 'go-to-artists' || (action === 'go-to-artist' && target.dataset.hasMultipleArtists === 'true')) {
            const artists = Array.isArray(track.artists) ? track.artists : track.artist ? [track.artist] : [];
            if (artists.length > 1) {
                // Save original HTML if not already saved
                if (!contextMenu._originalHTML) {
                    contextMenu._originalHTML = contextMenu.innerHTML;
                }

                // Render sub-menu
                let subMenuHTML =
                    '<li data-action="back-to-main-menu" style="font-weight: bold; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem; padding: 0.75rem 1rem; cursor: pointer;">← Back</li>';
                artists.forEach((artist) => {
                    subMenuHTML += `<li data-action="go-to-artist" data-artist-id="${artist.id}" style="padding: 0.75rem 1rem; cursor: pointer;">${escapeHtml(artist.name || 'Unknown Artist')}</li>`;
                });
                contextMenu.innerHTML = `<ul>${subMenuHTML}</ul>`;
                return;
            }
        }

        if (action === 'back-to-main-menu') {
            if (contextMenu._originalHTML) {
                contextMenu.innerHTML = contextMenu._originalHTML;
                contextMenu._originalHTML = null;
                // Re-update like state since we replaced the HTML
                await updateContextMenuLikeState(contextMenu, track);
            }
            return;
        }

        if (action && track) {
            const selectedTracks = contextMenu._selectedTracks || [];
            const isMultiSelect = selectedTracks.length > 1;

            if (isMultiSelect) {
                // Handle multi-select actions
                switch (action) {
                    case 'play-next':
                        selectedTracks.forEach((t) => {
                            trackPlayNext(t);
                            player.addNextToQueue(t);
                        });
                        if (window.renderQueueFunction) window.renderQueueFunction();
                        showNotification(`Playing next: ${selectedTracks.length} tracks`);
                        clearSelection();
                        break;
                    case 'add-to-queue':
                        player.addToQueue(selectedTracks);
                        if (window.renderQueueFunction) window.renderQueueFunction();
                        showNotification(`Added ${selectedTracks.length} tracks to queue`);
                        clearSelection();
                        break;
                    case 'toggle-like':
                        selectedTracks.forEach(async (t) => {
                            const added = await db.toggleFavorite('track', t);
                            syncManager.syncLibraryItem('track', t, added);
                        });
                        showNotification(`Liked ${selectedTracks.length} tracks`);
                        clearSelection();
                        break;
                    case 'add-to-playlist':
                        showMultiSelectPlaylistModal(selectedTracks);
                        clearSelection();
                        break;
                    case 'download':
                        selectedTracks.forEach((t) => {
                            downloadTrackWithMetadata(t, downloadQualitySettings.getQuality(), api, lyricsManager);
                        });
                        showNotification(`Downloading ${selectedTracks.length} tracks`);
                        clearSelection();
                        break;
                    default:
                        clearSelection();
                        break;
                }
            } else {
                // Track context menu action
                trackContextMenuAction(action, type, track);
                await handleTrackAction(action, track, player, api, lyricsManager, type, ui, scrobbler, target.dataset);
            }
        }

        // Reset menu state before closing
        if (contextMenu._originalHTML) {
            contextMenu.innerHTML = contextMenu._originalHTML;
            contextMenu._originalHTML = null;
        }
        contextMenu.style.display = 'none';
        contextMenu._contextType = null;
        contextMenu._selectedTracks = null;
    });

    // Now playing bar interactions
    document.querySelector('.now-playing-bar .title').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.album?.id) {
            navigate(`/album/${track.album.id}`);
        }
    });

    document.querySelector('.now-playing-bar .album').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.album?.id) {
            navigate(`/album/${track.album.id}`);
        }
    });

    document.querySelector('.now-playing-bar .artist').addEventListener('click', (e) => {
        const link = e.target.closest('.artist-link');
        if (link) {
            e.stopPropagation();
            const artistId = link.dataset.artistId;
            const trackerSheetId = link.dataset.trackerSheetId;
            if (trackerSheetId) {
                // Navigate to tracker artist page
                navigate(`/unreleased/${trackerSheetId}`);
            } else if (artistId) {
                navigate(`/artist/${artistId}`);
            }
            return;
        }

        // Fallback for non-link clicks (e.g. separators) or single artist legacy
        const track = player.currentTrack;
        if (track) {
            // Check if this is a tracker track
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            if (isTracker && track.trackerInfo?.sheetId) {
                navigate(`/unreleased/${track.trackerInfo.sheetId}`);
            } else if (track.artist?.id) {
                navigate(`/artist/${track.artist.id}`);
            }
        }
    });

    const nowPlayingLikeBtn = document.getElementById('now-playing-like-btn');
    if (nowPlayingLikeBtn) {
        nowPlayingLikeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'toggle-like',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    player.currentTrack.type || 'track',
                    ui,
                    scrobbler
                );
            }
        });
    }

    const nowPlayingMixBtn = document.getElementById('now-playing-mix-btn');
    if (nowPlayingMixBtn) {
        nowPlayingMixBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'track-mix',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    'track',
                    ui,
                    scrobbler
                );
            }
        });
    }

    const nowPlayingAddPlaylistBtn = document.getElementById('now-playing-add-playlist-btn');
    if (nowPlayingAddPlaylistBtn) {
        nowPlayingAddPlaylistBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'add-to-playlist',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    player.currentTrack.type || 'track',
                    ui,
                    scrobbler
                );
            }
        });
    }

    // Mobile add playlist button functionality
    const mobileAddPlaylistBtn = document.getElementById('mobile-add-playlist-btn');

    if (mobileAddPlaylistBtn) {
        mobileAddPlaylistBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (player.currentTrack) {
                await handleTrackAction(
                    'add-to-playlist',
                    player.currentTrack,
                    player,
                    api,
                    lyricsManager,
                    player.currentTrack.type || 'track',
                    ui,
                    scrobbler
                );
            }
        });
    }
}

function showSleepTimerModal(player) {
    const modal = document.getElementById('sleep-timer-modal');
    if (!modal) return;

    const closeModal = () => {
        modal.classList.remove('active');
        cleanup();
    };

    const handleOptionClick = (e) => {
        const timerOption = e.target.closest('.timer-option');
        if (timerOption) {
            let minutes;
            if (timerOption.id === 'custom-timer-btn') {
                const customInput = document.getElementById('custom-minutes');
                minutes = parseInt(customInput.value);
                if (!minutes || minutes < 1) {
                    showNotification('Please enter a valid number of minutes');
                    return;
                }
            } else {
                minutes = parseInt(timerOption.dataset.minutes);
            }

            if (minutes) {
                player.setSleepTimer(minutes);
                trackSetSleepTimer(minutes);
                showNotification(`Sleep timer set for ${minutes} minute${minutes === 1 ? '' : 's'}`);
                closeModal();
            }
        }
    };

    const handleCancel = (e) => {
        if (e.target.id === 'cancel-sleep-timer' || e.target.classList.contains('modal-overlay')) {
            closeModal();
        }
    };

    const cleanup = () => {
        modal.removeEventListener('click', handleOptionClick);
        modal.removeEventListener('click', handleCancel);
    };

    modal.addEventListener('click', handleOptionClick);
    modal.addEventListener('click', handleCancel);

    modal.classList.add('active');
}
