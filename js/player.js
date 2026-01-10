//js/player.js
import { REPEAT_MODE, formatTime, getTrackArtists, getTrackTitle, getTrackArtistsHTML } from './utils.js';
import { queueManager, replayGainSettings } from './storage.js';

export class Player {
    constructor(audioElement, api, quality = 'LOSSLESS') {
        this.audio = audioElement;
        this.api = api;
        this.quality = quality;
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.shuffleActive = false;
        this.repeatMode = REPEAT_MODE.OFF;
        this.preloadCache = new Map();
        this.preloadAbortController = null;
        this.currentTrack = null;
        this.currentRgValues = null;
        this.userVolume = parseFloat(localStorage.getItem('volume') || '0.7');

        // Sleep timer properties
        this.sleepTimer = null;
        this.sleepTimerEndTime = null;
        this.sleepTimerInterval = null;

        this.loadQueueState();
        this.setupMediaSession();

        window.addEventListener('beforeunload', () => {
            this.saveQueueState();
        });
    }

    setVolume(value) {
        this.userVolume = Math.max(0, Math.min(1, value));
        localStorage.setItem('volume', this.userVolume);
        this.applyReplayGain();
    }

    applyReplayGain() {
        const mode = replayGainSettings.getMode(); // 'off', 'track', 'album'
        let gainDb = 0;
        let peak = 1.0;

        if (mode !== 'off' && this.currentRgValues) {
            const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude } = this.currentRgValues;

            if (mode === 'album' && albumReplayGain !== undefined) {
                gainDb = albumReplayGain;
                peak = albumPeakAmplitude || 1.0;
            } else if (trackReplayGain !== undefined) {
                gainDb = trackReplayGain;
                peak = trackPeakAmplitude || 1.0;
            }

            // Apply Pre-Amp
            gainDb += replayGainSettings.getPreamp();
        }

        // Convert dB to linear scale: 10^(dB/20)
        let scale = Math.pow(10, gainDb / 20);

        // Peak protection (prevent clipping)
        if (scale * peak > 1.0) {
            scale = 1.0 / peak;
        }

        // Calculate effective volume
        const effectiveVolume = this.userVolume * scale;

        // Apply to audio element
        this.audio.volume = Math.max(0, Math.min(1, effectiveVolume));
    }

    loadQueueState() {
        const savedState = queueManager.getQueue();
        if (savedState) {
            this.queue = savedState.queue || [];
            this.shuffledQueue = savedState.shuffledQueue || [];
            this.originalQueueBeforeShuffle = savedState.originalQueueBeforeShuffle || [];
            this.currentQueueIndex = savedState.currentQueueIndex ?? -1;
            this.shuffleActive = savedState.shuffleActive || false;
            this.repeatMode = savedState.repeatMode || REPEAT_MODE.OFF;

            // Restore current track if queue exists and index is valid
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            if (this.currentQueueIndex >= 0 && this.currentQueueIndex < currentQueue.length) {
                this.currentTrack = currentQueue[this.currentQueueIndex];

                // Restore UI
                const track = this.currentTrack;
                const trackTitle = getTrackTitle(track);
                const trackArtistsHTML = getTrackArtistsHTML(track);

                let yearDisplay = '';
                const releaseDate = track.album?.releaseDate || track.streamStartDate;
                if (releaseDate) {
                    const date = new Date(releaseDate);
                    if (!isNaN(date.getTime())) {
                        yearDisplay = ` • ${date.getFullYear()}`;
                    }
                }

                const coverEl = document.querySelector('.now-playing-bar .cover');
                const titleEl = document.querySelector('.now-playing-bar .title');
                const artistEl = document.querySelector('.now-playing-bar .artist');

                if (coverEl) coverEl.src = this.api.getCoverUrl(track.album?.cover);
                if (titleEl) titleEl.textContent = trackTitle;
                if (artistEl) artistEl.innerHTML = trackArtistsHTML + yearDisplay;

                const mixBtn = document.getElementById('now-playing-mix-btn');
                if (mixBtn) {
                    mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
                }
                const totalDurationEl = document.getElementById('total-duration');
                if (totalDurationEl) totalDurationEl.textContent = formatTime(track.duration);
                document.title = `${trackTitle} • ${getTrackArtists(track)}`;

                this.updatePlayingTrackIndicator();
                this.updateMediaSession(track);
            }
        }
    }

    saveQueueState() {
        queueManager.saveQueue({
            queue: this.queue,
            shuffledQueue: this.shuffledQueue,
            originalQueueBeforeShuffle: this.originalQueueBeforeShuffle,
            currentQueueIndex: this.currentQueueIndex,
            shuffleActive: this.shuffleActive,
            repeatMode: this.repeatMode,
        });
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            this.audio.play().catch(console.error);
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            this.audio.pause();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            this.playPrev();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.playNext();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekBackward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekForward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.audio.currentTime = Math.max(0, details.seekTime);
                this.updateMediaSessionPositionState();
            }
        });

        navigator.mediaSession.setActionHandler('stop', () => {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.updateMediaSessionPlaybackState();
        });
    }

    setQuality(quality) {
        this.quality = quality;
    }

    async preloadNextTracks() {
        if (this.preloadAbortController) {
            this.preloadAbortController.abort();
        }

        this.preloadAbortController = new AbortController();
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const tracksToPreload = [];

        for (let i = 1; i <= 2; i++) {
            const nextIndex = this.currentQueueIndex + i;
            if (nextIndex < currentQueue.length) {
                tracksToPreload.push({ track: currentQueue[nextIndex], index: nextIndex });
            }
        }

        for (const { track } of tracksToPreload) {
            if (this.preloadCache.has(track.id)) continue;
            const trackTitle = getTrackTitle(track);
            try {
                const streamUrl = await this.api.getStreamUrl(track.id, this.quality);

                if (this.preloadAbortController.signal.aborted) break;

                this.preloadCache.set(track.id, streamUrl);
                // Warm connection/cache
                fetch(streamUrl, { method: 'HEAD', signal: this.preloadAbortController.signal }).catch(() => {});
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    async playTrackFromQueue(startTime = 0) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        this.saveQueueState();

        const track = currentQueue[this.currentQueueIndex];
        this.currentTrack = track;

        const trackTitle = getTrackTitle(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);

        let yearDisplay = '';
        const releaseDate = track.album?.releaseDate || track.streamStartDate;
        if (releaseDate) {
            const date = new Date(releaseDate);
            if (!isNaN(date.getTime())) {
                yearDisplay = ` • ${date.getFullYear()}`;
            }
        }

        document.querySelector('.now-playing-bar .cover').src = this.api.getCoverUrl(track.album?.cover);
        document.querySelector('.now-playing-bar .title').textContent = trackTitle;
        document.querySelector('.now-playing-bar .artist').innerHTML = trackArtistsHTML + yearDisplay;

        const mixBtn = document.getElementById('now-playing-mix-btn');
        if (mixBtn) {
            mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
        }
        document.title = `${trackTitle} • ${getTrackArtists(track)}`;

        this.updatePlayingTrackIndicator();

        try {
            // Get track data for ReplayGain (should be cached by API)
            const trackData = await this.api.getTrack(track.id, this.quality);

            if (trackData && trackData.info) {
                this.currentRgValues = {
                    trackReplayGain: trackData.info.trackReplayGain,
                    trackPeakAmplitude: trackData.info.trackPeakAmplitude,
                    albumReplayGain: trackData.info.albumReplayGain,
                    albumPeakAmplitude: trackData.info.albumPeakAmplitude,
                };
            } else {
                this.currentRgValues = null;
            }
            this.applyReplayGain();

            let streamUrl;

            if (this.preloadCache.has(track.id)) {
                streamUrl = this.preloadCache.get(track.id);
            } else if (trackData.originalTrackUrl) {
                streamUrl = trackData.originalTrackUrl;
            } else {
                streamUrl = this.api.extractStreamUrlFromManifest(trackData.info.manifest);
            }

            this.audio.src = streamUrl;
            if (startTime > 0) {
                this.audio.currentTime = startTime;
            }
            await this.audio.play();

            // Update Media Session AFTER play starts to ensure metadata is captured
            this.updateMediaSession(track);
            this.updateMediaSessionPlaybackState();
            this.preloadNextTracks();
        } catch (error) {
            console.error(`Could not play track: ${trackTitle}`, error);
            document.querySelector('.now-playing-bar .title').textContent = `Error: ${trackTitle}`;
            document.querySelector('.now-playing-bar .artist').textContent = error.message || 'Could not load track';
        }
    }

    playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            this.playTrackFromQueue();
        }
    }

    playNext() {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;

        if (this.repeatMode === REPEAT_MODE.ONE) {
            this.audio.currentTime = 0;
            this.audio.play();
            return;
        }

        if (!isLastTrack) {
            this.currentQueueIndex++;
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            this.currentQueueIndex = 0;
        } else {
            return;
        }

        this.playTrackFromQueue();
    }

    playPrev() {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            this.updateMediaSessionPositionState();
        } else if (this.currentQueueIndex > 0) {
            this.currentQueueIndex--;
            this.playTrackFromQueue();
        }
    }

    handlePlayPause() {
        if (!this.audio.src || this.audio.error) {
            if (this.currentTrack) {
                this.playTrackFromQueue();
            }
            return;
        }

        if (this.audio.paused) {
            this.audio.play().catch((e) => {
                if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
                console.error('Play failed, reloading track:', e);
                if (this.currentTrack) {
                    this.playTrackFromQueue();
                }
            });
        } else {
            this.audio.pause();
            this.saveQueueState();
        }
    }

    seekBackward(seconds = 10) {
        const newTime = Math.max(0, this.audio.currentTime - seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    seekForward(seconds = 10) {
        const duration = this.audio.duration || 0;
        const newTime = Math.min(duration, this.audio.currentTime + seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    toggleShuffle() {
        this.shuffleActive = !this.shuffleActive;

        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle = [...this.queue];
            const currentTrack = this.queue[this.currentQueueIndex];
            this.shuffledQueue = [...this.queue].sort(() => Math.random() - 0.5);
            this.currentQueueIndex = this.shuffledQueue.findIndex((t) => t.id === currentTrack?.id);

            if (this.currentQueueIndex === -1 && currentTrack) {
                this.shuffledQueue.unshift(currentTrack);
                this.currentQueueIndex = 0;
            }
        } else {
            const currentTrack = this.shuffledQueue[this.currentQueueIndex];
            this.queue = [...this.originalQueueBeforeShuffle];
            this.currentQueueIndex = this.queue.findIndex((t) => t.id === currentTrack?.id);
        }

        this.preloadCache.clear();
        this.preloadNextTracks();
        this.saveQueueState();
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        this.saveQueueState();
        return this.repeatMode;
    }

    setQueue(tracks, startIndex = 0) {
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.preloadCache.clear();
        this.saveQueueState();
    }

    addToQueue(track) {
        this.queue.push(track);

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.queue.length - 1;
            this.playTrackFromQueue();
        }
        this.saveQueueState();
    }

    addNextToQueue(track) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const insertIndex = this.currentQueueIndex + 1;

        // Insert after current track
        currentQueue.splice(insertIndex, 0, track);

        // If we are shuffling, we might want to also add it to the original queue for consistency,
        // though syncing that is tricky. The standard logic often just appends to the active queue view.
        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle.push(track); // Just append to end of main list? Or logic needed.
            // Simplest is to just modify the active playing queue.
        } else {
            // In linear mode, `currentQueue` IS `this.queue`
        }

        this.saveQueueState();
        this.preloadNextTracks(); // Update preload since next track changed
    }

    removeFromQueue(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        // If removing current track
        if (index === this.currentQueueIndex) {
            // If playing, we might want to stop or just let it finish?
            // For now, let's just remove it.
            // If it's the last track, playback will stop naturally or we handle it?
        }

        if (index < this.currentQueueIndex) {
            this.currentQueueIndex--;
        }

        const removedTrack = currentQueue.splice(index, 1)[0];

        if (this.shuffleActive) {
            // Also remove from original queue
            const originalIndex = this.originalQueueBeforeShuffle.findIndex((t) => t.id === removedTrack.id); // Simple ID check
            if (originalIndex !== -1) {
                this.originalQueueBeforeShuffle.splice(originalIndex, 1);
            }
        }

        this.saveQueueState();
        this.preloadNextTracks();
    }

    clearQueue() {
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.preloadCache.clear();
        this.saveQueueState();
    }

    moveInQueue(fromIndex, toIndex) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        if (fromIndex < 0 || fromIndex >= currentQueue.length) return;
        if (toIndex < 0 || toIndex >= currentQueue.length) return;

        const [track] = currentQueue.splice(fromIndex, 1);
        currentQueue.splice(toIndex, 0, track);

        if (this.currentQueueIndex === fromIndex) {
            this.currentQueueIndex = toIndex;
        } else if (fromIndex < this.currentQueueIndex && toIndex >= this.currentQueueIndex) {
            this.currentQueueIndex--;
        } else if (fromIndex > this.currentQueueIndex && toIndex <= this.currentQueueIndex) {
            this.currentQueueIndex++;
        }
        this.saveQueueState();
    }

    getCurrentQueue() {
        return this.shuffleActive ? this.shuffledQueue : this.queue;
    }

    getNextTrack() {
        const currentQueue = this.getCurrentQueue();
        if (this.currentQueueIndex === -1 || currentQueue.length === 0) return null;

        const nextIndex = this.currentQueueIndex + 1;
        if (nextIndex < currentQueue.length) {
            return currentQueue[nextIndex];
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            return currentQueue[0];
        }
        return null;
    }

    updatePlayingTrackIndicator() {
        const currentTrack = this.getCurrentQueue()[this.currentQueueIndex];
        document.querySelectorAll('.track-item').forEach((item) => {
            item.classList.toggle('playing', currentTrack && item.dataset.trackId == currentTrack.id);
        });

        document.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);
            item.classList.toggle('playing', index === this.currentQueueIndex);
        });
    }

    updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;

        // Force a refresh for picky Bluetooth systems by clearing metadata first
        navigator.mediaSession.metadata = null;

        const artwork = [];
        const sizes = ['320'];
        const coverId = track.album?.cover;
        const trackTitle = getTrackTitle(track);

        if (coverId) {
            sizes.forEach((size) => {
                artwork.push({
                    src: this.api.getCoverUrl(coverId, size),
                    sizes: `${size}x${size}`,
                    type: 'image/jpeg',
                });
            });
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackTitle || 'Unknown Title',
            artist: getTrackArtists(track) || 'Unknown Artist',
            album: track.album?.title || 'Unknown Album',
            artwork: artwork.length > 0 ? artwork : undefined,
        });

        this.updateMediaSessionPlaybackState();
        this.updateMediaSessionPositionState();
    }

    updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    }

    updateMediaSessionPositionState() {
        if (!('mediaSession' in navigator)) return;
        if (!('setPositionState' in navigator.mediaSession)) return;

        const duration = this.audio.duration;

        if (!duration || isNaN(duration) || !isFinite(duration)) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: this.audio.playbackRate || 1,
                position: Math.min(this.audio.currentTime, duration),
            });
        } catch (error) {
            console.debug('Failed to update Media Session position:', error);
        }
    }

    // Sleep Timer Methods
    setSleepTimer(minutes) {
        this.clearSleepTimer(); // Clear any existing timer

        this.sleepTimerEndTime = Date.now() + minutes * 60 * 1000;

        this.sleepTimer = setTimeout(
            () => {
                this.audio.pause();
                this.clearSleepTimer();
                this.updateSleepTimerUI();
            },
            minutes * 60 * 1000
        );

        // Update UI every second
        this.sleepTimerInterval = setInterval(() => {
            this.updateSleepTimerUI();
        }, 1000);

        this.updateSleepTimerUI();
    }

    clearSleepTimer() {
        if (this.sleepTimer) {
            clearTimeout(this.sleepTimer);
            this.sleepTimer = null;
        }
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.sleepTimerEndTime = null;
        this.updateSleepTimerUI();
    }

    getSleepTimerRemaining() {
        if (!this.sleepTimerEndTime) return null;
        const remaining = Math.max(0, this.sleepTimerEndTime - Date.now());
        return Math.ceil(remaining / 1000); // Return seconds remaining
    }

    isSleepTimerActive() {
        return this.sleepTimer !== null;
    }

    updateSleepTimerUI() {
        const timerBtn = document.getElementById('sleep-timer-btn');
        const timerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');

        const updateBtn = (btn) => {
            if (!btn) return;
            if (this.isSleepTimerActive()) {
                const remaining = this.getSleepTimerRemaining();
                if (remaining > 0) {
                    const minutes = Math.floor(remaining / 60);
                    const seconds = remaining % 60;
                    btn.innerHTML = `<span style="font-size: 12px; font-weight: bold;">${minutes}:${seconds.toString().padStart(2, '0')}</span>`;
                    btn.title = `Sleep Timer: ${minutes}:${seconds.toString().padStart(2, '0')} remaining`;
                    btn.classList.add('active');
                    btn.style.color = 'var(--primary)';
                } else {
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12,6 12,12 16,14"/>
                        </svg>
                    `;
                    btn.title = 'Sleep Timer';
                    btn.classList.remove('active');
                    btn.style.color = '';
                }
            } else {
                btn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                    </svg>
                `;
                btn.title = 'Sleep Timer';
                btn.classList.remove('active');
                btn.style.color = '';
            }
        };

        updateBtn(timerBtn);
        updateBtn(timerBtnDesktop);
    }
}
