//js/events.js
import {
    SVG_PLAY,
    SVG_PAUSE,
    SVG_VOLUME,
    SVG_MUTE,
    REPEAT_MODE,
    trackDataStore,
    formatTime,
    SVG_BIN,
    getTrackArtists,
} from './utils.js';
import { lastFMStorage, libreFmSettings, waveformSettings } from './storage.js';
import { showNotification, downloadTrackWithMetadata, downloadAlbumAsZip, downloadPlaylistAsZip } from './downloads.js';
import { downloadQualitySettings } from './storage.js';
import { updateTabTitle, navigate } from './router.js';
import { db } from './db.js';
import { syncManager } from './accounts/pocketbase.js';
import { waveformGenerator } from './waveform.js';
import { audioContextManager } from './audio-context.js';

let currentTrackIdForWaveform = null;

export function initializePlayerEvents(player, audioPlayer, scrobbler, ui) {
    const playPauseBtn = document.querySelector('.now-playing-bar .play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const sleepTimerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');
    const sleepTimerBtnMobile = document.getElementById('sleep-timer-btn');

    // History tracking
    let historyLoggedTrackId = null;

    audioPlayer.addEventListener('loadstart', () => {
        historyLoggedTrackId = null;
    });

    // Sync UI with player state on load
    if (player.shuffleActive) {
        shuffleBtn.classList.add('active');
    }

    if (player.repeatMode && player.repeatMode !== REPEAT_MODE.OFF) {
        repeatBtn.classList.add('active');
        if (player.repeatMode === REPEAT_MODE.ONE) {
            repeatBtn.classList.add('repeat-one');
        }
        repeatBtn.title = player.repeatMode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
    } else {
        repeatBtn.title = 'Repeat';
    }

    audioPlayer.addEventListener('play', () => {
        // Initialize audio context manager for EQ (only once)
        if (!audioContextManager.isReady()) {
            audioContextManager.init(audioPlayer);
        }
        audioContextManager.resume();

        if (player.currentTrack) {
            // Scrobble
            if (scrobbler.isAuthenticated()) {
                scrobbler.updateNowPlaying(player.currentTrack);
            }

            // Resume AudioContext for waveform on mobile (iOS)
            if (waveformGenerator.audioContext.state === 'suspended') {
                waveformGenerator.audioContext.resume();
            }

            updateWaveform();
        }

        playPauseBtn.innerHTML = SVG_PAUSE;
        player.updateMediaSessionPlaybackState();
        player.updateMediaSessionPositionState();
        updateTabTitle(player);
    });

    audioPlayer.addEventListener('playing', () => {
        player.updateMediaSessionPlaybackState();
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('pause', () => {
        playPauseBtn.innerHTML = SVG_PLAY;
        player.updateMediaSessionPlaybackState();
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('ended', () => {
        player.playNext();
    });

    audioPlayer.addEventListener('timeupdate', async () => {
        const { currentTime, duration } = audioPlayer;
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
        }
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        const totalDurationEl = document.getElementById('total-duration');
        totalDurationEl.textContent = formatTime(audioPlayer.duration);
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('error', async (e) => {
        console.error('Audio playback error:', e);
        playPauseBtn.innerHTML = SVG_PLAY;

        const currentQuality = player.quality;

        // Check if we can fallback to a lower quality
        if (
            player.currentTrack &&
            currentQuality === 'HI_RES_LOSSLESS' &&
            !player.currentTrack.isLocal &&
            !player.currentTrack.isTracker &&
            !player.isFallbackRetry
        ) {
            console.warn('Playback failed, attempting fallback to LOSSLESS quality...');
            player.isFallbackRetry = true; // Set flag to prevent infinite loops

            try {
                // Force getTrack to fetch new URL for LOSSLESS
                const trackId = player.currentTrack.id;

                // Fetch new stream URL
                const newStreamUrl = await player.api.getStreamUrl(trackId, 'LOSSLESS');

                if (newStreamUrl) {
                    // Reset player state for standard playback (non-DASH if possible)
                    if (player.dashInitialized) {
                        player.dashPlayer.reset();
                        player.dashInitialized = false;
                    }

                    audioPlayer.src = newStreamUrl;
                    audioPlayer.load();
                    await audioPlayer.play();

                    // Reset flag after successful start
                    setTimeout(() => {
                        player.isFallbackRetry = false;
                    }, 5000);
                    return; // Successfully handled
                }
            } catch (fallbackError) {
                console.error('Fallback failed:', fallbackError);
            }
        }

        player.isFallbackRetry = false;

        // Skip to next track on error to prevent queue stalling
        if (player.currentTrack) {
            console.warn('Skipping to next track due to playback error');
            setTimeout(() => player.playNext(), 1000); // Small delay to avoid rapid skipping
        }
    });

    playPauseBtn.addEventListener('click', () => player.handlePlayPause());
    nextBtn.addEventListener('click', () => player.playNext());
    prevBtn.addEventListener('click', () => player.playPrev());

    shuffleBtn.addEventListener('click', () => {
        player.toggleShuffle();
        shuffleBtn.classList.toggle('active', player.shuffleActive);
        if (window.renderQueueFunction) window.renderQueueFunction();
    });

    repeatBtn.addEventListener('click', () => {
        const mode = player.toggleRepeat();
        repeatBtn.classList.toggle('active', mode !== REPEAT_MODE.OFF);
        repeatBtn.classList.toggle('repeat-one', mode === REPEAT_MODE.ONE);
        repeatBtn.title =
            mode === REPEAT_MODE.OFF ? 'Repeat' : mode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
    });

    // Sleep Timer for desktop
    if (sleepTimerBtnDesktop) {
        sleepTimerBtnDesktop.addEventListener('click', () => {
            if (player.isSleepTimerActive()) {
                player.clearSleepTimer();
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
                showNotification('Sleep timer cancelled');
            } else {
                showSleepTimerModal(player);
            }
        });
    }

    // Volume controls
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');

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

    const updateVolumeUI = () => {
        const { muted } = audioPlayer;
        const volume = player.userVolume;
        volumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE : SVG_VOLUME;
        const effectiveVolume = muted ? 0 : volume * 100;
        volumeFill.style.setProperty('--volume-level', `${effectiveVolume}%`);
        volumeFill.style.width = `${effectiveVolume}%`;
    };

    volumeBtn.addEventListener('click', () => {
        audioPlayer.muted = !audioPlayer.muted;
        localStorage.setItem('muted', audioPlayer.muted);
    });

    audioPlayer.addEventListener('volumechange', updateVolumeUI);

    // Initialize volume and mute from localStorage
    const savedVolume = parseFloat(localStorage.getItem('volume') || '0.7');
    const savedMuted = localStorage.getItem('muted') === 'true';

    player.setVolume(savedVolume);
    audioPlayer.muted = savedMuted;

    volumeFill.style.width = `${savedVolume * 100}%`;
    volumeBar.style.setProperty('--volume-level', `${savedVolume * 100}%`);
    updateVolumeUI();

    initializeSmoothSliders(audioPlayer, player);
}

function initializeSmoothSliders(audioPlayer, player) {
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
        if (!isNaN(audioPlayer.duration)) {
            progressFill.style.width = `${position * 100}%`;
            if (currentTimeEl) {
                currentTimeEl.textContent = formatTime(position * audioPlayer.duration);
            }
        }
    };

    // Progress bar with smooth dragging
    progressBar.addEventListener('mousedown', (e) => {
        isSeeking = true;
        wasPlaying = !audioPlayer.paused;
        if (wasPlaying) audioPlayer.pause();

        seek(progressBar, e, (position) => {
            lastSeekPosition = position;
            updateSeekUI(position);
        });
    });

    // Touch events for mobile
    progressBar.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isSeeking = true;
        wasPlaying = !audioPlayer.paused;
        if (wasPlaying) audioPlayer.pause();

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
                if (audioPlayer.muted) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
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
            if (audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
            }
            player.setVolume(position);
            volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isSeeking) {
            // Commit the seek
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = lastSeekPosition * audioPlayer.duration;
                player.updateMediaSessionPositionState();
                if (wasPlaying) audioPlayer.play();
            }
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    document.addEventListener('touchend', () => {
        if (isSeeking) {
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = lastSeekPosition * audioPlayer.duration;
                player.updateMediaSessionPositionState();
                if (wasPlaying) audioPlayer.play();
            }
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    progressBar.addEventListener('click', (e) => {
        if (!isSeeking) {
            // Only handle click if not result of a drag release
            seek(progressBar, e, (position) => {
                if (!isNaN(audioPlayer.duration) && audioPlayer.duration > 0 && audioPlayer.duration !== Infinity) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
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
            if (audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
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
        if (audioPlayer.muted) {
            audioPlayer.muted = false;
            localStorage.setItem('muted', false);
        }
        player.setVolume(position);
        volumeFill.style.width = `${position * 100}%`;
        volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
    });

    volumeBar.addEventListener('click', (e) => {
        if (!isAdjustingVolume) {
            seek(volumeBar, e, (position) => {
                if (audioPlayer.muted) {
                    audioPlayer.muted = false;
                    localStorage.setItem('muted', false);
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

            if (delta > 0 && audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
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

            if (delta > 0 && audioPlayer.muted) {
                audioPlayer.muted = false;
                localStorage.setItem('muted', false);
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
                            ? `<button class="remove-from-playlist-btn-modal" title="Remove from playlist" style="background: transparent; border: none; color: inherit; cursor: pointer; padding: 4px; display: flex; align-items: center;">${SVG_BIN}</button>`
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
            createModal.dataset.editingId = '';
            document.getElementById('csv-import-section').style.display = 'none';

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
    scrobbler = null
) {
    if (!item) return;

    // Actions not allowed for unavailable tracks
    const forbiddenForUnavailable = ['add-to-queue', 'play-next', 'track-mix', 'download'];
    if (item.isUnavailable && forbiddenForUnavailable.includes(action)) {
        showNotification('This track is unavailable.');
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

    // Individual Track Actions
    if (action === 'add-to-queue') {
        player.addToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Added to queue: ${item.title}`);
    } else if (action === 'play-next') {
        player.addNextToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Playing next: ${item.title}`);
    } else if (action === 'play-card') {
        player.setQueue([item], 0);
        player.playAtIndex(0);
        showNotification(`Playing track: ${item.title}`);
    } else if (action === 'start-mix') {
        if (item.mixes?.TRACK_MIX) {
            navigate(`/mix/${item.mixes.TRACK_MIX}`);
        } else {
            showNotification('No mix available for this track');
        }
    } else if (action === 'download') {
        await downloadTrackWithMetadata(item, downloadQualitySettings.getQuality(), api, lyricsManager);
    } else if (action === 'toggle-like') {
        const added = await db.toggleFavorite(type, item);
        syncManager.syncLibraryItem(type, item, added);

        if (added && type === 'track' && scrobbler) {
            if (lastFMStorage.isEnabled() && lastFMStorage.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
            if (libreFmSettings.isEnabled() && libreFmSettings.shouldLoveOnLike()) {
                scrobbler.loveTrack(item);
            }
        }

        // Update all instances of this item's like button on the page
        const id = type === 'playlist' ? item.uuid : item.id;
        const selector =
            type === 'track'
                ? `[data-track-id="${id}"] .like-btn`
                : `.card[data-${type}-id="${id}"] .like-btn, .card[data-playlist-id="${id}"] .like-btn`;

        // Also check header buttons
        const headerBtn = document.getElementById(`like-${type}-btn`);

        const elementsToUpdate = [...document.querySelectorAll(selector)];
        if (headerBtn) elementsToUpdate.push(headerBtn);

        const nowPlayingLikeBtn = document.getElementById('now-playing-like-btn');
        if (nowPlayingLikeBtn && type === 'track' && player?.currentTrack?.id === item.id) {
            elementsToUpdate.push(nowPlayingLikeBtn);
        }

        const fsLikeBtn = document.getElementById('fs-like-btn');
        if (fsLikeBtn && type === 'track' && player?.currentTrack?.id === item.id) {
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
                    : `.card[data-${type}-id="${id}"], .card[data-playlist-id="${id}"]`;

            const itemEl = document.querySelector(itemSelector);

            if (!added && itemEl) {
                // Remove item
                const container = itemEl.parentElement;
                itemEl.remove();
                if (container && container.children.length === 0) {
                    const msg = type === 'track' ? 'No liked tracks yet.' : `No liked ${type}s yet.`;
                    container.innerHTML = `<div class="placeholder-text">${msg}</div>`;
                }
            } else if (added && !itemEl && ui && type === 'track') {
                // Add item (specifically for tracks currently)
                const tracksContainer = document.getElementById('library-tracks-container');
                if (tracksContainer) {
                    // Remove placeholder if it exists
                    const placeholder = tracksContainer.querySelector('.placeholder-text');
                    if (placeholder) placeholder.remove();

                    // Create track element
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
            const playlistsWithTrack = new Set();

            for (const playlist of playlists) {
                if (playlist.tracks && playlist.tracks.some((track) => track.id == trackId)) {
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
                                ? `<button class="remove-from-playlist-btn-modal" title="Remove from playlist" style="background: transparent; border: none; color: inherit; cursor: pointer; padding: 4px; display: flex; align-items: center;">${SVG_BIN}</button>`
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
                createModal.dataset.editingId = '';
                document.getElementById('csv-import-section').style.display = 'none';

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
        const artistId = item.artist?.id || item.artists?.[0]?.id;
        if (artistId) {
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
        const url = storedHref
            ? `${window.location.origin}${storedHref}`
            : `${window.location.origin}/track/${item.id || item.uuid}`;

        navigator.clipboard.writeText(url).then(() => {
            showNotification('Link copied to clipboard!');
        });
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
                    <h3 style="margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600;">${item.title}</h3>
                    <div style="color: var(--muted-foreground); font-size: 0.9rem; line-height: 1.8;">
                        <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                            <p style="color: var(--primary); font-weight: 500;">Unreleased Track</p>
                        </div>
                        
                        <div style="display: grid; gap: 0.5rem;">
                            ${item.artists ? `<p><strong style="color: var(--foreground);">Artist:</strong> ${Array.isArray(item.artists) ? item.artists.map((a) => a.name || a).join(', ') : item.artists}</p>` : ''}
                            ${item.trackerInfo.artist ? `<p><strong style="color: var(--foreground);">Tracked Artist:</strong> ${item.trackerInfo.artist}</p>` : ''}
                            ${item.trackerInfo.project ? `<p><strong style="color: var(--foreground);">Project:</strong> ${item.trackerInfo.project}</p>` : ''}
                            ${item.trackerInfo.era ? `<p><strong style="color: var(--foreground);">Era:</strong> ${item.trackerInfo.era}</p>` : ''}
                            ${item.trackerInfo.timeline ? `<p><strong style="color: var(--foreground);">Timeline:</strong> ${item.trackerInfo.timeline}</p>` : ''}
                            ${item.trackerInfo.category ? `<p><strong style="color: var(--foreground);">Category:</strong> ${item.trackerInfo.category}</p>` : ''}
                            ${item.trackerInfo.trackNumber ? `<p><strong style="color: var(--foreground);">Track Number:</strong> ${item.trackerInfo.trackNumber}</p>` : ''}
                            <p><strong style="color: var(--foreground);">Duration:</strong> ${formatTime(item.duration)}</p>
                            ${releaseDate !== 'Unknown' ? `<p><strong style="color: var(--foreground);">Release Date:</strong> ${dateDisplay}</p>` : ''}
                            ${item.trackerInfo.addedDate ? `<p><strong style="color: var(--foreground);">Added to Tracker:</strong> ${addedDate}</p>` : ''}
                            ${item.trackerInfo.leakedDate ? `<p><strong style="color: var(--foreground);">Leak Date:</strong> ${new Date(item.trackerInfo.leakedDate).toLocaleDateString()}</p>` : ''}
                            ${item.trackerInfo.recordingDate ? `<p><strong style="color: var(--foreground);">Recording Date:</strong> ${new Date(item.trackerInfo.recordingDate).toLocaleDateString()}</p>` : ''}
                        </div>
                        
                        ${
                            item.trackerInfo.description
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Description</p>
                                <p style="font-size: 0.85rem; line-height: 1.6;">${item.trackerInfo.description}</p>
                            </div>
                        `
                                : ''
                        }
                        
                        ${
                            item.trackerInfo.notes
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Notes</p>
                                <p style="font-size: 0.85rem; line-height: 1.6;">${item.trackerInfo.notes}</p>
                            </div>
                        `
                                : ''
                        }
                        
                        ${
                            item.trackerInfo.sourceUrl
                                ? `
                            <div style="margin-top: 1rem;">
                                <p style="margin-bottom: 0.5rem;"><strong style="color: var(--foreground);">Source URL:</strong></p>
                                <a href="${item.trackerInfo.sourceUrl}" target="_blank" style="color: var(--primary); word-break: break-all; font-size: 0.85rem; display: block; padding: 0.5rem; background: var(--accent); border-radius: 6px; text-decoration: none;">
                                    ${item.trackerInfo.sourceUrl}
                                </a>
                            </div>
                        `
                                : ''
                        }
                        
                        ${item.id ? `<p style="margin-top: 1rem; font-size: 0.8rem; color: var(--muted);"><strong>Track ID:</strong> ${item.id}</p>` : ''}
                    </div>
                    <button onclick="this.closest('.modal-overlay').remove()" class="btn-primary" style="margin-top: 1.5rem; width: 100%;">Close</button>
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
                    <h3 style="margin-bottom: 1rem; font-size: 1.3rem; font-weight: 600;">${item.title}</h3>
                    <div style="color: var(--muted-foreground); font-size: 0.9rem; line-height: 1.8;">
                        <div style="display: grid; gap: 0.5rem;">
                            <p><strong style="color: var(--foreground);">Artist:</strong> ${getTrackArtists(item)}</p>
                            <p><strong style="color: var(--foreground);">Album:</strong> ${item.album?.title || 'Unknown'}</p>
                            ${item.album?.artist?.name ? `<p><strong style="color: var(--foreground);">Album Artist:</strong> ${item.album.artist.name}</p>` : ''}
                            <p><strong style="color: var(--foreground);">Release Date:</strong> ${dateDisplay}</p>
                            <p><strong style="color: var(--foreground);">Duration:</strong> ${formatTime(item.duration)}</p>
                            ${item.trackNumber ? `<p><strong style="color: var(--foreground);">Track Number:</strong> ${item.trackNumber}</p>` : ''}
                            ${item.discNumber ? `<p><strong style="color: var(--foreground);">Disc Number:</strong> ${item.discNumber}</p>` : ''}
                            ${item.version ? `<p><strong style="color: var(--foreground);">Version:</strong> ${item.version}</p>` : ''}
                            ${item.explicit ? `<p><strong style="color: var(--foreground);">Explicit:</strong> Yes</p>` : ''}
                            <p><strong style="color: var(--foreground);">Quality:</strong> ${quality} ${bitrate ? `(${bitrate})` : ''}</p>
                        </div>
                        
                        ${
                            item.credits && item.credits.length > 0
                                ? `
                            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--accent); border-radius: 8px;">
                                <p style="color: var(--foreground); font-weight: 500; margin-bottom: 0.5rem;">Credits</p>
                                <div style="font-size: 0.85rem; line-height: 1.6;">
                                    ${item.credits.map((c) => `<p>${c.type}: ${c.name}</p>`).join('')}
                                </div>
                            </div>
                        `
                                : ''
                        }
                        
                        ${
                            item.composers && item.composers.length > 0
                                ? `
                            <p style="margin-top: 0.5rem;"><strong style="color: var(--foreground);">Composers:</strong> ${item.composers.map((c) => c.name).join(', ')}</p>
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
                        
                        ${item.id ? `<p style="margin-top: 1rem; font-size: 0.8rem; color: var(--muted);"><strong>Track ID:</strong> ${item.id}</p>` : ''}
                        ${item.album?.id ? `<p style="font-size: 0.8rem; color: var(--muted);"><strong>Album ID:</strong> ${item.album.id}</p>` : ''}
                    </div>
                    <button onclick="this.closest('.modal-overlay').remove()" class="btn-primary" style="margin-top: 1.5rem; width: 100%;">Close</button>
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
    }
}

async function updateContextMenuLikeState(contextMenu, contextTrack) {
    if (!contextMenu || !contextTrack) return;

    const likeItem = contextMenu.querySelector('li[data-action="toggle-like"]');
    if (likeItem) {
        const { db } = await import('./db.js');
        const isLiked = await db.isFavorite('track', contextTrack.id);
        likeItem.textContent = isLiked ? 'Unlike' : 'Like';
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

    // Filter items based on type
    const type = contextMenu._contextType || 'track';
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
            const labelKey = `label${type.charAt(0).toUpperCase() + type.slice(1).replace('User-playlist', 'Playlist')}`;
            const label = item.dataset[labelKey] || item.dataset.labelTrack || 'Like';
            item.textContent = label;
        }
    });
}

export function initializeTrackInteractions(player, api, mainContent, contextMenu, lyricsManager, ui, scrobbler) {
    let contextTrack = null;

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

        const cardMenuBtn = e.target.closest('.card-menu-btn');
        if (cardMenuBtn) {
            e.stopPropagation();
            const card = cardMenuBtn.closest('.card');
            const type = cardMenuBtn.dataset.type;
            const id = cardMenuBtn.dataset.id;

            let item = card ? trackDataStore.get(card) : null;

            if (!item) {
                // Fallback: create a shell item
                item = { id, uuid: id, title: card.querySelector('.card-title')?.textContent || 'Item' };
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
                    contextMenu.style.display = 'none';
                    return;
                }

                contextTrack = clickedTrack;
                if (contextTrack) {
                    contextMenu._contextTrack = contextTrack;
                    contextMenu._contextType = 'track';
                    await updateContextMenuLikeState(contextMenu, contextTrack);
                    const rect = menuBtn.getBoundingClientRect();
                    positionMenu(contextMenu, rect.left, rect.bottom + 5, rect);
                }
            }
            return;
        }

        const trackItem = e.target.closest('.track-item');
        if (trackItem && trackItem.classList.contains('unavailable')) {
            return;
        }
        if (trackItem && !trackItem.dataset.queueIndex && !e.target.closest('.remove-from-playlist-btn')) {
            const parentList = trackItem.closest('.track-list');
            const allTrackElements = Array.from(parentList.querySelectorAll('.track-item'));
            const trackList = allTrackElements.map((el) => trackDataStore.get(el)).filter(Boolean);

            if (trackList.length > 0) {
                const clickedTrackId = trackItem.dataset.trackId;
                const startIndex = trackList.findIndex((t) => t.id == clickedTrackId);

                player.setQueue(trackList, startIndex);
                document.getElementById('shuffle-btn').classList.remove('active');
                player.playTrackFromQueue();
            }
        }

        const card = e.target.closest('.card');
        if (card) {
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

                // Hide actions for unavailable tracks
                const unavailableActions = ['play-next', 'add-to-queue', 'download', 'track-mix'];
                contextMenu.querySelectorAll('[data-action]').forEach((btn) => {
                    if (unavailableActions.includes(btn.dataset.action)) {
                        btn.style.display = contextTrack.isUnavailable ? 'none' : 'block';
                    }
                });

                contextMenu._contextTrack = contextTrack;
                contextMenu._contextType = 'track';
                await updateContextMenuLikeState(contextMenu, contextTrack);
                positionMenu(contextMenu, e.pageX, e.pageY);
            }
        }
    });

    mainContent.addEventListener('contextmenu', async (e) => {
        const trackItem = e.target.closest('.track-item, .queue-track-item');
        const card = e.target.closest('.card');

        if (trackItem) {
            e.preventDefault();
            if (trackItem.classList.contains('queue-track-item')) {
                const queueIndex = parseInt(trackItem.dataset.queueIndex);
                contextTrack = player.getCurrentQueue()[queueIndex];
            } else {
                contextTrack = trackDataStore.get(trackItem);
            }

            if (contextTrack) {
                if (contextTrack.isLocal) return;
                contextMenu._contextTrack = contextTrack;
                contextMenu._contextType = 'track';
                await updateContextMenuLikeState(contextMenu, contextTrack);
                positionMenu(contextMenu, e.pageX, e.pageY);
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
            contextTrack = item;
            contextMenu._contextTrack = item;
            contextMenu._contextType = type.replace('userplaylist', 'user-playlist');
            contextMenu._contextHref = card.dataset.href;

            await updateContextMenuLikeState(contextMenu, item);
            positionMenu(contextMenu, e.pageX, e.pageY);
        }
    });

    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });

    contextMenu.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const track = contextMenu._contextTrack || contextTrack;
        const type = contextMenu._contextType || 'track';
        if (action && track) {
            await handleTrackAction(action, track, player, api, lyricsManager, type, ui, scrobbler);
        }
        contextMenu.style.display = 'none';
        contextMenu._contextType = null;
    });

    // Now playing bar interactions
    document.querySelector('.now-playing-bar .title').addEventListener('click', () => {
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
                    'track',
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
                    'track',
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
                    'track',
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

function positionMenu(menu, x, y, anchorRect = null) {
    // Temporarily show to measure dimensions
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = x;
    let top = y;

    if (anchorRect) {
        // Adjust horizontal position if it overflows right
        if (left + menuWidth > windowWidth - 10) {
            // 10px buffer
            left = anchorRect.right - menuWidth;
            if (left < 10) left = 10;
        }
        // Adjust vertical position if it overflows bottom
        if (top + menuHeight > windowHeight - 10) {
            top = anchorRect.top - menuHeight - 5;
        }
    } else {
        // Adjust horizontal position if it overflows right
        if (left + menuWidth > windowWidth - 10) {
            left = windowWidth - menuWidth - 10;
        }
        // Adjust vertical position if it overflows bottom
        if (top + menuHeight > windowHeight - 10) {
            top = y - menuHeight;
        }
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'visible';
}
