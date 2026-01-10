//js/events.js
import {
    SVG_PLAY,
    SVG_PAUSE,
    SVG_VOLUME,
    SVG_MUTE,
    REPEAT_MODE,
    trackDataStore,
    RATE_LIMIT_ERROR_MESSAGE,
    buildTrackFilename,
    getTrackTitle,
    formatTime,
} from './utils.js';
import { lastFMStorage, waveformSettings } from './storage.js';
import { showNotification, downloadTrackWithMetadata } from './downloads.js';
import { lyricsSettings, downloadQualitySettings } from './storage.js';
import { updateTabTitle } from './router.js';
import { db } from './db.js';
import { syncManager } from './firebase/sync.js';
import { waveformGenerator } from './waveform.js';

let currentWaveformPeaks = null;
let currentTrackIdForWaveform = null;

export function initializePlayerEvents(player, audioPlayer, scrobbler, ui) {
    const playPauseBtn = document.querySelector('.play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const sleepTimerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');
    const sleepTimerBtnMobile = document.getElementById('sleep-timer-btn');

    // History tracking
    let historyLoggedTrackId = null;

    // Sync UI with player state on load
    if (player.shuffleActive) {
        shuffleBtn.classList.add('active');
    }

    if (player.repeatMode !== REPEAT_MODE.OFF) {
        repeatBtn.classList.add('active');
        if (player.repeatMode === REPEAT_MODE.ONE) {
            repeatBtn.classList.add('repeat-one');
        }
        repeatBtn.title = player.repeatMode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One';
    } else {
        repeatBtn.title = 'Repeat';
    }

    audioPlayer.addEventListener('play', () => {
        if (player.currentTrack) {
            // Scrobble
            if (scrobbler.isAuthenticated() && lastFMStorage.isEnabled()) {
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

    audioPlayer.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        document.querySelector('.now-playing-bar .artist').textContent = 'Playback error. Try another track.';
        playPauseBtn.innerHTML = SVG_PLAY;
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

        if (!waveformSettings.isEnabled() || !player.currentTrack) {
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
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');

    let isSeeking = false;
    let wasPlaying = false;
    let isAdjustingVolume = false;

    const seek = (bar, event, setter) => {
        const rect = bar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        setter(position);
    };

    // Progress bar with smooth dragging
    progressBar.addEventListener('mousedown', (e) => {
        isSeeking = true;
        wasPlaying = !audioPlayer.paused;
        if (wasPlaying) audioPlayer.pause();

        seek(progressBar, e, (position) => {
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = position * audioPlayer.duration;
                progressFill.style.width = `${position * 100}%`;
            }
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
        if (!isNaN(audioPlayer.duration)) {
            audioPlayer.currentTime = position * audioPlayer.duration;
            progressFill.style.width = `${position * 100}%`;
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isSeeking) {
            seek(progressBar, e, (position) => {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    progressFill.style.width = `${position * 100}%`;
                }
            });
        }

        if (isAdjustingVolume) {
            seek(volumeBar, e, (position) => {
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
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = position * audioPlayer.duration;
                progressFill.style.width = `${position * 100}%`;
            }
        }

        if (isAdjustingVolume) {
            const touch = e.touches[0];
            const rect = volumeBar.getBoundingClientRect();
            const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
            player.setVolume(position);
            volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (isSeeking) {
            seek(progressBar, e, (position) => {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    player.updateMediaSessionPositionState();
                    if (wasPlaying) audioPlayer.play();
                }
            });
            isSeeking = false;
        }

        if (isAdjustingVolume) {
            isAdjustingVolume = false;
        }
    });

    document.addEventListener('touchend', (e) => {
        if (isSeeking) {
            if (!isNaN(audioPlayer.duration)) {
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
        player.setVolume(position);
        volumeFill.style.width = `${position * 100}%`;
        volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
    });

    volumeBar.addEventListener('click', (e) => {
        if (!isAdjustingVolume) {
            seek(volumeBar, e, (position) => {
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

    if (action === 'add-to-queue') {
        player.addToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Added to queue: ${item.title}`);
    } else if (action === 'play-next') {
        player.addNextToQueue(item);
        if (window.renderQueueFunction) window.renderQueueFunction();
        showNotification(`Playing next: ${item.title}`);
    } else if (action === 'track-mix') {
        if (item.mixes && item.mixes.TRACK_MIX) {
            window.location.hash = `#mix/${item.mixes.TRACK_MIX}`;
        }
    } else if (action === 'play-card') {
        try {
            let tracks = [];
            if (type === 'album') {
                const data = await api.getAlbum(item.id);
                tracks = data.tracks;
            } else if (type === 'playlist') {
                const data = await api.getPlaylist(item.uuid);
                tracks = data.tracks;
            } else if (type === 'user-playlist') {
                let playlist = await db.getPlaylist(item.id);
                if (!playlist) {
                    try {
                        playlist = await syncManager.getPublicPlaylist(item.id);
                    } catch (e) {
                        // Ignore
                    }
                }
                tracks = playlist ? playlist.tracks : item.tracks || [];
            }

            if (tracks.length > 0) {
                player.setQueue(tracks, 0);
                const shuffleBtn = document.getElementById('shuffle-btn');
                if (shuffleBtn) shuffleBtn.classList.remove('active');
                player.playAtIndex(0);
                const name = type === 'user-playlist' ? item.name : item.title;
                showNotification(`Playing ${type.replace('user-', '')}: ${name}`);
            } else {
                showNotification(`No tracks found in this ${type}`);
            }
        } catch (error) {
            console.error('Failed to play card:', error);
            showNotification(`Failed to play ${type}`);
        }
    } else if (action === 'download') {
        await downloadTrackWithMetadata(item, downloadQualitySettings.getQuality(), api, lyricsManager);
    } else if (action === 'toggle-like') {
        const added = await db.toggleFavorite(type, item);
        syncManager.syncLibraryItem(type, item, added);

        if (added && type === 'track' && scrobbler && lastFMStorage.isEnabled() && lastFMStorage.shouldLoveOnLike()) {
            scrobbler.loveTrack(item);
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
        const playlists = await db.getPlaylists();
        if (playlists.length === 0) {
            showNotification('No playlists yet. Create one first.');
            return;
        }

        const modal = document.getElementById('playlist-select-modal');
        const list = document.getElementById('playlist-select-list');
        const cancelBtn = document.getElementById('playlist-select-cancel');
        const overlay = modal.querySelector('.modal-overlay');

        // Check what playlists already have this
        const trackId = item.id;
        const playlistsWithTrack = new Set();

        for (const playlist of playlists) {
            if (playlist.tracks && playlist.tracks.some((track) => track.id === trackId)) {
                playlistsWithTrack.add(playlist.id);
            }
        }

        const checkmarkSvg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

        list.innerHTML = playlists
            .map((p) => {
                const alreadyContains = playlistsWithTrack.has(p.id);
                return `
                <div class="modal-option ${alreadyContains ? 'already-contains' : ''}" data-id="${p.id}">
                    <span>${p.name}</span>
                    ${alreadyContains ? `<span class="checkmark">${checkmarkSvg}</span>` : ''}
                </div>
            `;
            })
            .join('');

        const closeModal = () => {
            modal.classList.remove('active');
            cleanup();
        };

        const handleOptionClick = async (e) => {
            const option = e.target.closest('.modal-option');
            if (option) {
                const playlistId = option.dataset.id;
                const alreadyContains = playlistsWithTrack.has(playlistId);

                if (alreadyContains) {
                    return;
                }

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

            let item = itemElement ? trackDataStore.get(itemElement) : null;

            // If no item from element (e.g. header buttons), try to get from hash
            if (!item && action === 'toggle-like') {
                const id = window.location.hash.split('/')[1];
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

        const menuBtn = e.target.closest('.track-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            const trackItem = menuBtn.closest('.track-item');
            if (trackItem && !trackItem.dataset.queueIndex) {
                const clickedTrack = trackDataStore.get(trackItem);

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
                    await updateContextMenuLikeState(contextMenu, contextTrack);
                    const rect = menuBtn.getBoundingClientRect();
                    positionMenu(contextMenu, rect.left, rect.bottom + 5, rect);
                }
            }
            return;
        }

        const trackItem = e.target.closest('.track-item');
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
                window.location.hash = href;
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
                await updateContextMenuLikeState(contextMenu, contextTrack);
                positionMenu(contextMenu, e.pageX, e.pageY);
            }
        }
    });

    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });

    contextMenu.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        const track = contextMenu._contextTrack || contextTrack;
        if (action && track) {
            await handleTrackAction(action, track, player, api, lyricsManager, 'track', ui, scrobbler);
        }
        contextMenu.style.display = 'none';
    });

    // Now playing bar interactions
    document.querySelector('.now-playing-bar .title').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.album?.id) {
            window.location.hash = `#album/${track.album.id}`;
        }
    });

    document.querySelector('.now-playing-bar .artist').addEventListener('click', (e) => {
        const link = e.target.closest('.artist-link');
        if (link) {
            e.stopPropagation();
            const artistId = link.dataset.artistId;
            if (artistId) {
                window.location.hash = `#artist/${artistId}`;
            }
            return;
        }

        // Fallback for non-link clicks (e.g. separators) or single artist legacy
        const track = player.currentTrack;
        if (track?.artist?.id) {
            window.location.hash = `#artist/${track.artist.id}`;
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
