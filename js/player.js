//js/player.js
import { REPEAT_MODE, formatTime, getTrackArtists, getTrackTitle} from './utils.js';

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

        this.setupMediaSession();
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
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    async playTrackFromQueue() {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        const track = currentQueue[this.currentQueueIndex];
        this.currentTrack = track;

        const trackTitle = getTrackTitle(track);
        const trackArtists = getTrackArtists(track);

        document.querySelector('.now-playing-bar .cover').src =
            this.api.getCoverUrl(track.album?.cover, '1280');
        document.querySelector('.now-playing-bar .title').textContent = trackTitle;
        document.querySelector('.now-playing-bar .artist').textContent = trackArtists;
        document.title = `${trackTitle} • ${track.artist?.name || 'Unknown'}`;

        this.updatePlayingTrackIndicator();
        this.updateMediaSession(track);

        try {
            let streamUrl;

            if (this.preloadCache.has(track.id)) {
                streamUrl = this.preloadCache.get(track.id);
            } else {
                const trackData = await this.api.getTrack(track.id, this.quality);

                if (trackData.originalTrackUrl) {
                    streamUrl = trackData.originalTrackUrl;
                } else {
                    streamUrl = this.api.extractStreamUrlFromManifest(trackData.info.manifest);
                }
            }

            this.audio.src = streamUrl;
            await this.audio.play();

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
        if (!this.audio.src) return;

        if (this.audio.paused) {
            this.audio.play().catch(console.error);
        } else {
            this.audio.pause();
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
            this.currentQueueIndex = this.shuffledQueue.findIndex(t => t.id === currentTrack?.id);

            if (this.currentQueueIndex === -1 && currentTrack) {
                this.shuffledQueue.unshift(currentTrack);
                this.currentQueueIndex = 0;
            }
        } else {
            const currentTrack = this.shuffledQueue[this.currentQueueIndex];
            this.queue = [...this.originalQueueBeforeShuffle];
            this.currentQueueIndex = this.queue.findIndex(t => t.id === currentTrack?.id);
        }

        this.preloadCache.clear();
        this.preloadNextTracks();
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        return this.repeatMode;
    }

    setQueue(tracks, startIndex = 0) {
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.preloadCache.clear();
    }

    addToQueue(track) {
        this.queue.push(track);

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.queue.length - 1;
            this.playTrackFromQueue();
        }
    }

    removeFromQueue(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        if (index < 0 || index >= currentQueue.length) return;

        if (this.shuffleActive) {
            this.shuffledQueue.splice(index, 1);
        } else {
            this.queue.splice(index, 1);
        }

        if (index < this.currentQueueIndex) {
            this.currentQueueIndex--;
        } else if (index === this.currentQueueIndex) {
            if (currentQueue.length > 0) {
                this.playTrackFromQueue();
            }
        }
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
    }

    getCurrentQueue() {
        return this.shuffleActive ? this.shuffledQueue : this.queue;
    }

    updatePlayingTrackIndicator() {
        const currentTrack = this.getCurrentQueue()[this.currentQueueIndex];
        document.querySelectorAll('.track-item').forEach(item => {
            item.classList.toggle('playing',
                currentTrack && item.dataset.trackId == currentTrack.id
            );
        });
    }

    updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;

        const artwork = [];
        const sizes = ['1280'];
        const coverId = track.album?.cover;
        const trackTitle = getTrackTitle(track);

        if (coverId) {
            sizes.forEach(size => {
                artwork.push({
                    src: this.api.getCoverUrl(coverId, size),
                    sizes: `${size}x${size}`,
                    type: 'image/jpeg'
                });
            });
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackTitle || 'Unknown Title',
            artist: track.artist?.name || 'Unknown Artist',
            album: track.album?.title || 'Unknown Album',
            artwork: artwork.length > 0 ? artwork : undefined
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
                position: Math.min(this.audio.currentTime, duration)
            });
        } catch (error) {
            console.debug('Failed to update Media Session position:', error);
        }
    }
}
