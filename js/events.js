import { SVG_PLAY, SVG_PAUSE, SVG_VOLUME, SVG_MUTE, REPEAT_MODE, trackDataStore, RATE_LIMIT_ERROR_MESSAGE, buildTrackFilename } from './utils.js';
import { lastFMStorage } from './storage.js';
import { addDownloadTask, updateDownloadProgress, completeDownloadTask } from './downloads.js';
import { updateTabTitle } from './router.js';

export function initializePlayerEvents(player, audioPlayer, scrobbler) {
    const playPauseBtn = document.querySelector('.play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    
    audioPlayer.addEventListener('play', () => {
        if (scrobbler.isAuthenticated() && lastFMStorage.isEnabled() && player.currentTrack) {
            scrobbler.updateNowPlaying(player.currentTrack);
        }
        playPauseBtn.innerHTML = SVG_PAUSE;
        player.updateMediaSessionPlaybackState();
        updateTabTitle(player);
    });
    
    audioPlayer.addEventListener('pause', () => {
        playPauseBtn.innerHTML = SVG_PLAY;
        player.updateMediaSessionPlaybackState();
    });
    
    audioPlayer.addEventListener('ended', () => {
        player.playNext();
    });
    
    audioPlayer.addEventListener('timeupdate', () => {
        const { currentTime, duration } = audioPlayer;
        if (duration) {
            const progressFill = document.getElementById('progress-fill');
            const currentTimeEl = document.getElementById('current-time');
            progressFill.style.width = `${(currentTime / duration) * 100}%`;
            currentTimeEl.textContent = formatTime(currentTime);
            player.updateMediaSessionPositionState();
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
        renderQueue(player);
    });
    
    repeatBtn.addEventListener('click', () => {
        const mode = player.toggleRepeat();
        repeatBtn.classList.toggle('active', mode !== REPEAT_MODE.OFF);
        repeatBtn.classList.toggle('repeat-one', mode === REPEAT_MODE.ONE);
        repeatBtn.title = mode === REPEAT_MODE.OFF 
            ? 'Repeat' 
            : (mode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One');
    });
    
    // Volume controls
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');
    
    const updateVolumeUI = () => {
        const { volume, muted } = audioPlayer;
        volumeBtn.innerHTML = (muted || volume === 0) ? SVG_MUTE : SVG_VOLUME;
        const effectiveVolume = muted ? 0 : volume * 100;
        volumeFill.style.setProperty('--volume-level', `${effectiveVolume}%`);
    };
    
    volumeBtn.addEventListener('click', () => {
        audioPlayer.muted = !audioPlayer.muted;
    });
    
    audioPlayer.addEventListener('volumechange', updateVolumeUI);
    
    // Initialize volume from localStorage
    const savedVolume = parseFloat(localStorage.getItem('volume') || '0.7');
    audioPlayer.volume = savedVolume;
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
        
        seek(progressBar, e, position => {
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
            seek(progressBar, e, position => {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    progressFill.style.width = `${position * 100}%`;
                }
            });
        }
        
        if (isAdjustingVolume) {
            seek(volumeBar, e, position => {
                audioPlayer.volume = position;
                volumeFill.style.width = `${position * 100}%`;
                volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
                localStorage.setItem('volume', position);
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
            audioPlayer.volume = position;
            volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            localStorage.setItem('volume', position);
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        if (isSeeking) {
            seek(progressBar, e, position => {
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
    
    progressBar.addEventListener('click', e => {
        if (!isSeeking) {
            seek(progressBar, e, position => {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    player.updateMediaSessionPositionState();
                }
            });
        }
    });
    
    volumeBar.addEventListener('mousedown', (e) => {
        isAdjustingVolume = true;
        seek(volumeBar, e, position => {
            audioPlayer.volume = position;
            volumeFill.style.width = `${position * 100}%`;
            volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
            localStorage.setItem('volume', position);
        });
    });
    
    volumeBar.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isAdjustingVolume = true;
        const touch = e.touches[0];
        const rect = volumeBar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        audioPlayer.volume = position;
        volumeFill.style.width = `${position * 100}%`;
        volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
        localStorage.setItem('volume', position);
    });
    
    volumeBar.addEventListener('click', e => {
        if (!isAdjustingVolume) {
            seek(volumeBar, e, position => {
                audioPlayer.volume = position;
                volumeFill.style.width = `${position * 100}%`;
                volumeBar.style.setProperty('--volume-level', `${position * 100}%`);
                localStorage.setItem('volume', position);
            });
        }
    });
}

export function initializeTrackInteractions(player, api, mainContent, contextMenu) {
    let contextTrack = null;
    
    mainContent.addEventListener('click', e => {
        const menuBtn = e.target.closest('.track-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            const trackItem = menuBtn.closest('.track-item');
            if (trackItem && !trackItem.dataset.queueIndex) {
                contextTrack = trackDataStore.get(trackItem);
                if (contextTrack) {
                    const rect = menuBtn.getBoundingClientRect();
                    contextMenu.style.top = `${rect.bottom + 5}px`;
                    contextMenu.style.left = `${rect.left}px`;
                    contextMenu.style.display = 'block';
                }
            }
            return;
        }
        
        const trackItem = e.target.closest('.track-item');
        if (trackItem && !trackItem.dataset.queueIndex) {
            const parentList = trackItem.closest('.track-list');
            const allTrackElements = Array.from(parentList.querySelectorAll('.track-item'));
            const trackList = allTrackElements.map(el => trackDataStore.get(el)).filter(Boolean);
            
            if (trackList.length > 0) {
                const clickedTrackId = trackItem.dataset.trackId;
                const startIndex = trackList.findIndex(t => t.id == clickedTrackId);
                
                player.setQueue(trackList, startIndex);
                document.getElementById('shuffle-btn').classList.remove('active');
                player.playTrackFromQueue();
            }
        }
    });
    
    mainContent.addEventListener('contextmenu', e => {
        const trackItem = e.target.closest('.track-item');
        if (trackItem && !trackItem.dataset.queueIndex) {
            e.preventDefault();
            contextTrack = trackDataStore.get(trackItem);
            
            if (contextTrack) {
                contextMenu.style.top = `${e.pageY}px`;
                contextMenu.style.left = `${e.pageX}px`;
                contextMenu.style.display = 'block';
            }
        }
    });
    
    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });
    
    contextMenu.addEventListener('click', async e => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        
        if (action === 'add-to-queue' && contextTrack) {
            player.addToQueue(contextTrack);
            renderQueue(player);
        } else if (action === 'download' && contextTrack) {
            const quality = player.quality;
            const filename = buildTrackFilename(contextTrack, quality);
            
            try {
                const { taskEl, abortController } = addDownloadTask(
                    contextTrack.id,
                    contextTrack,
                    filename,
                    api
                );
                
                await api.downloadTrack(contextTrack.id, quality, filename, {
                    signal: abortController.signal,
                    onProgress: (progress) => {
                        updateDownloadProgress(contextTrack.id, progress);
                    }
                });
                
                completeDownloadTask(contextTrack.id, true);
            } catch (error) {
                if (error.name !== 'AbortError') {
                    const errorMsg = error.message === RATE_LIMIT_ERROR_MESSAGE 
                        ? error.message 
                        : 'Download failed. Please try again.';
                    completeDownloadTask(contextTrack.id, false, errorMsg);
                }
            }
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
    
    document.querySelector('.now-playing-bar .artist').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.artist?.id) {
            window.location.hash = `#artist/${track.artist.id}`;
        }
    });
}

function renderQueue(player) {
    // This will be called from queue module
    if (window.renderQueueFunction) {
        window.renderQueueFunction();
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}