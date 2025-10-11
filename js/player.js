//js/player.js
import { REPEAT_MODE, SVG_PLAY, SVG_PAUSE, formatTime } from './utils.js';

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
    }

    setQuality(quality) {
        this.quality = quality;
    }

    async playTrackFromQueue() {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        const track = currentQueue[this.currentQueueIndex];
        
        document.querySelector('.now-playing-bar .cover').src = 
            this.api.getCoverUrl(track.album?.cover, '1280');
        document.querySelector('.now-playing-bar .title').textContent = track.title;
        document.querySelector('.now-playing-bar .artist').textContent = track.artist?.name || 'Unknown Artist';
        document.title = `${track.title} • ${track.artist?.name || 'Unknown'}`;
        
        this.updatePlayingTrackIndicator();
        this.updateMediaSession(track);

        try {
            const streamUrl = await this.api.getStreamUrl(track.id, this.quality);
            this.audio.src = streamUrl;
            await this.audio.play();
        } catch (error) {
            console.error(`Could not get track URL for: ${track.title}`, error);
            document.querySelector('.now-playing-bar .title').textContent = `Error: ${track.title}`;
            document.querySelector('.now-playing-bar .artist').textContent = error.message || 'Could not load track';
            document.querySelector('.play-pause-btn').innerHTML = SVG_PLAY;
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
        } else if (this.currentQueueIndex > 0) {
            this.currentQueueIndex--;
            this.playTrackFromQueue();
        }
    }

    handlePlayPause() {
        if (!this.audio.src) return;
        this.audio.paused ? this.audio.play() : this.audio.pause();
    }

    seekBackward(seconds = 10) {
        const newTime = Math.max(0, this.audio.currentTime - seconds);
        this.audio.currentTime = newTime;
    }

    seekForward(seconds = 10) {
        const duration = this.audio.duration || 0;
        const newTime = Math.min(duration, this.audio.currentTime + seconds);
        this.audio.currentTime = newTime;
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
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        return this.repeatMode;
    }

    setQueue(tracks, startIndex = 0) {
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
    }

    addToQueue(track) {
        this.queue.push(track);
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
    
    if (coverId) {
        sizes.forEach(size => {
            const url = this.api.getCoverUrl(coverId, size);
            artwork.push({
                src: url,
                sizes: `${size}x${size}`,
                type: 'image/jpeg'
            });
        });
    }
    
    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Unknown Title',
        artist: track.artist?.name || 'Unknown Artist',
        album: track.album?.title || 'Unknown Album',
        artwork: artwork.length > 0 ? artwork : undefined
    });

    navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
}

    updateMediaSessionPlaybackState() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
        }
    }

    updateMediaSessionPositionState() {
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            if (this.audio.duration && !isNaN(this.audio.duration)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: this.audio.duration,
                        playbackRate: this.audio.playbackRate,
                        position: this.audio.currentTime
                    });
                } catch (error) {
                    console.debug('Failed to update position state:', error);
                }
            }
        }
    }
}