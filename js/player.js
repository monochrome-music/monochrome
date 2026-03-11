//js/player.js
import { MediaPlayer } from 'dashjs';
import {
    REPEAT_MODE,
    formatTime,
    getTrackArtists,
    getTrackTitle,
    getTrackArtistsHTML,
    getTrackYearDisplay,
    createQualityBadgeHTML,
    escapeHtml,
} from './utils.js';
import {
    queueManager,
    replayGainSettings,
    trackDateSettings,
    exponentialVolumeSettings,
    audioEffectsSettings,
    radioSettings,
} from './storage.js';
import { audioContextManager } from './audio-context.js';
import { db } from './db.js';
import Hls from 'hls.js';

export class Player {
    constructor(audioElement, api, quality = 'HI_RES_LOSSLESS') {
        this.audio = audioElement;
        this.video = document.getElementById('video-player');
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
        this.isFallbackRetry = false;
        this.isFallbackInProgress = false;
        this.autoplayBlocked = false;
        this.isIOS = typeof window !== 'undefined' && window.__IS_IOS__ === true;
        this.isPwa =
            typeof window !== 'undefined' &&
            (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true);

        this.hls = null;
        // Sleep timer properties
        this.sleepTimer = null;
        this.sleepTimerEndTime = null;
        this.sleepTimerInterval = null;

        // Apply audio effects when track is ready
        this.audio.addEventListener('canplay', () => {
            this.applyAudioEffects();
        });
        if (this.video) {
            this.video.addEventListener('canplay', () => {
                this.applyAudioEffects();
            });
        }

        // Initialize dash.js player
        this.dashPlayer = MediaPlayer().create();
        this.dashPlayer.updateSettings({
            streaming: {
                buffer: {
                    fastSwitchEnabled: true,
                },
            },
        });
        this.dashInitialized = false;

        this.loadQueueState();
        this.setupMediaSession();

        this.radioEnabled = radioSettings.isEnabled();
        this.radioSeeds = [];
        this.isFetchingRadio = false;
        this.radioFetchPromise = null;

        this.playbackSequence = 0;

        window.addEventListener('beforeunload', () => {
            this.saveQueueState();
        });

        // Handle visibility change for iOS - AudioContext gets suspended when screen locks
        document.addEventListener('visibilitychange', () => {
            const el = this.activeElement;
            if (document.visibilityState === 'visible' && !el.paused) {
                // Ensure audio context is resumed when user returns to the app
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(el);
                }
                audioContextManager.resume();
            }
            if (document.visibilityState === 'visible' && this.autoplayBlocked) {
                this.autoplayBlocked = false;
                el.play().catch(() => {});
            }
        });

        this._setupVideoSync();
    }

    _setupVideoSync() {
        if (!this.video || !this.audio) return;

        const eventsToSync = ['timeupdate', 'seeking', 'seeked', 'volumechange'];
        eventsToSync.forEach((eventName) => {
            this.video.addEventListener(eventName, (e) => {
                if (this.currentTrack?.type === 'video') {
                    if (eventName === 'timeupdate' || eventName === 'seeking' || eventName === 'seeked') {
                        try {
                            if (this.video.readyState >= 2 && (this.audio.readyState > 0 || this.audio.src)) {
                                this.audio.currentTime = this.video.currentTime;
                            }
                        } catch (err) {}
                    }

                    const syncedEvent = new Event(eventName, { bubbles: e.bubbles, cancelable: e.cancelable });
                    this.audio.dispatchEvent(syncedEvent);
                }
            });
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

        // Apply exponential volume curve if enabled
        const curvedVolume = exponentialVolumeSettings.applyCurve(this.userVolume);

        // Calculate effective volume
        const effectiveVolume = curvedVolume * scale;

        const el = this.activeElement;

        // Apply to audio element and/or Web Audio graph
        if (audioContextManager.isReady()) {
            // If Web Audio is active, we apply volume there for better compatibility
            // Especially on Linux where audio.volume might not affect the Web Audio graph
            el.volume = 1.0;
            audioContextManager.setVolume(effectiveVolume);
        } else {
            el.volume = Math.max(0, Math.min(1, effectiveVolume));
        }
    }

    applyAudioEffects() {
        const speed = audioEffectsSettings.getSpeed();
        const el = this.activeElement;

        if (this.dashInitialized && this.dashPlayer) {
            if (this.dashPlayer.getPlaybackRate() !== speed) {
                this.dashPlayer.setPlaybackRate(speed);
            }
        } else {
            if (el.playbackRate !== speed) {
                el.playbackRate = speed;
            }
        }

        const preservePitch = audioEffectsSettings.isPreservePitchEnabled();
        if (el.preservesPitch !== preservePitch) {
            el.preservesPitch = preservePitch;
            // Firefox support
            if (el.mozPreservesPitch !== undefined) {
                el.mozPreservesPitch = preservePitch;
            }
        }
    }

    setPlaybackSpeed(speed) {
        const validSpeed = Math.max(0.01, Math.min(100, parseFloat(speed) || 1.0));
        audioEffectsSettings.setSpeed(validSpeed);
        this.applyAudioEffects();
    }

    setPreservePitch(enabled) {
        audioEffectsSettings.setPreservePitch(enabled);
        this.applyAudioEffects();
    }

    loadQueueState() {
        const savedState = queueManager.getQueue();
        if (savedState) {
            this.queue = savedState.queue || [];
            this.shuffledQueue = savedState.shuffledQueue || [];
            this.originalQueueBeforeShuffle = savedState.originalQueueBeforeShuffle || [];
            this.currentQueueIndex = savedState.currentQueueIndex ?? -1;
            this.shuffleActive = savedState.shuffleActive || false;
            this.repeatMode = savedState.repeatMode !== undefined ? savedState.repeatMode : REPEAT_MODE.OFF;

            // Restore current track if queue exists and index is valid
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            if (this.currentQueueIndex >= 0 && this.currentQueueIndex < currentQueue.length) {
                this.currentTrack = currentQueue[this.currentQueueIndex];

                // Restore UI
                const track = this.currentTrack;
                const trackTitle = getTrackTitle(track);
                const trackArtistsHTML = getTrackArtistsHTML(track);
                const yearDisplay = getTrackYearDisplay(track);

                const coverEl = document.querySelector('.now-playing-bar .cover');
                const titleEl = document.querySelector('.now-playing-bar .title');
                const albumEl = document.querySelector('.now-playing-bar .album');
                const artistEl = document.querySelector('.now-playing-bar .artist');

                if (coverEl) {
                    const videoCoverUrl = track.videoUrl || track.videoCoverUrl || track.album?.videoCoverUrl || null;
                    const coverUrl =
                        videoCoverUrl || this.api.getCoverUrl(track.image || track.cover || track.album?.cover);

                    if (videoCoverUrl) {
                        if (coverEl.tagName === 'IMG') {
                            const video = document.createElement('video');
                            video.src = videoCoverUrl;
                            video.autoplay = true;
                            video.loop = true;
                            video.muted = true;
                            video.playsInline = true;
                            video.className = coverEl.className;
                            video.id = coverEl.id;
                            video.style.objectFit = 'cover';
                            coverEl.replaceWith(video);
                        } else if (coverEl.tagName === 'VIDEO' && coverEl.src !== videoCoverUrl) {
                            coverEl.src = videoCoverUrl;
                        }
                    } else {
                        if (coverEl.tagName === 'VIDEO') {
                            const img = document.createElement('img');
                            img.src = coverUrl;
                            img.className = coverEl.className;
                            img.id = coverEl.id;
                            coverEl.replaceWith(img);
                        } else {
                            coverEl.src = coverUrl;
                        }
                    }
                }
                if (titleEl) {
                    const qualityBadge = createQualityBadgeHTML(track);
                    titleEl.innerHTML = `${escapeHtml(trackTitle)} ${qualityBadge}`;
                }
                if (albumEl) {
                    const albumTitle = track.album?.title || '';
                    if (albumTitle && albumTitle !== trackTitle) {
                        albumEl.textContent = albumTitle;
                        albumEl.style.display = 'block';
                    } else {
                        albumEl.textContent = '';
                        albumEl.style.display = 'none';
                    }
                }
                if (artistEl) artistEl.innerHTML = trackArtistsHTML + yearDisplay;

                // Fetch album release date in background if missing
                if (!yearDisplay && track.album?.id) {
                    this.loadAlbumYear(track, trackArtistsHTML, artistEl);
                }

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

        if (window.renderQueueFunction) {
            window.renderQueueFunction();
        }
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        const setHandlers = () => {
            navigator.mediaSession.setActionHandler('play', async () => {
                const el = this.activeElement;
                // Initialize and resume audio context first (required for iOS lock screen)
                // Must happen before audio.play() or audio won't route through Web Audio
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(el);
                    this.applyReplayGain();
                }
                await audioContextManager.resume();

                try {
                    await el.play();
                } catch (e) {
                    console.error('MediaSession play failed:', e);
                    // If play fails, try to handle it like a regular play/pause
                    this.handlePlayPause();
                }
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                this.activeElement.pause();
            });

            navigator.mediaSession.setActionHandler('previoustrack', async () => {
                // Ensure audio context is active for iOS lock screen controls
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(this.activeElement);
                    this.applyReplayGain();
                }
                await audioContextManager.resume();
                this.playPrev();
            });

            navigator.mediaSession.setActionHandler('nexttrack', async () => {
                // Ensure audio context is active for iOS lock screen controls
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(this.activeElement);
                    this.applyReplayGain();
                }
                await audioContextManager.resume();
                this.playNext();
            });

            if (!this.isIOS) {
                navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.seekBackward(skipTime);
                });
                navigator.mediaSession.setActionHandler('seekforward', (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.seekForward(skipTime);
                });
            }

            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime !== undefined) {
                    this.activeElement.currentTime = Math.max(0, details.seekTime);
                    this.updateMediaSessionPositionState();
                }
            });

            navigator.mediaSession.setActionHandler('stop', () => {
                this.activeElement.pause();
                this.activeElement.currentTime = 0;
                this.updateMediaSessionPlaybackState();
            });
        };

        if (this.isIOS) {
            // iOS: set handlers only when playback starts. Setting them in the constructor makes
            // the lock screen show +10/-10. Registering on first 'playing' gives next/previous track
            this.audio.addEventListener('playing', () => setHandlers(), { once: true });
            if (this.video) {
                this.video.addEventListener('playing', () => setHandlers(), { once: true });
            }
        } else {
            setHandlers();
        }
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
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            if (track.isLocal || isTracker || (track.audioUrl && !track.isLocal)) continue;
            try {
                const streamUrl = await this.api.getStreamUrl(track.id, this.quality);

                if (this.preloadAbortController.signal.aborted) break;

                this.preloadCache.set(track.id, streamUrl);
                // Warm connection/cache
                // For Blob URLs (DASH), this head request is not needed and can cause errors.
                if (!streamUrl.startsWith('blob:')) {
                    fetch(streamUrl, { method: 'HEAD', signal: this.preloadAbortController.signal }).catch(() => {});
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    setupHlsVideo(video, result, fallbackImg) {
        const url = result.videoUrl || result.hlsUrl || result;
        if (!url) return;

        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        const qualityBtn = document.getElementById('fs-quality-btn');
        const qualityMenu = document.getElementById('fs-quality-menu');
        if (qualityBtn) qualityBtn.style.display = 'none';
        if (qualityMenu) qualityMenu.style.display = 'none';

        if (typeof url === 'string' && (url.includes('.m3u8') || url.includes('application/vnd.apple.mpegurl'))) {
            if (Hls.isSupported()) {
                this.hls = new Hls();
                this.hls.loadSource(url);
                this.hls.attachMedia(video);
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(() => {});
                    this.setupVideoQualitySelector();
                });
                this.hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        console.warn('HLS fatal error:', data.type);
                        if (fallbackImg) video.replaceWith(fallbackImg);
                        this.hls.destroy();
                        this.hls = null;
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
            } else {
                if (fallbackImg) video.replaceWith(fallbackImg);
            }
        } else {
            video.src = url;
            video.onerror = () => {
                if (result && result.hlsUrl) {
                    this.setupHlsVideo(video, { videoUrl: null, hlsUrl: result.hlsUrl }, fallbackImg);
                } else if (fallbackImg) {
                    video.replaceWith(fallbackImg);
                }
            };
        }
    }

    setupVideoQualitySelector() {
        if (!this.hls || !this.hls.levels || this.hls.levels.length === 0) return;

        const qualityBtn = document.getElementById('fs-quality-btn');
        const qualityMenu = document.getElementById('fs-quality-menu');
        if (!qualityBtn || !qualityMenu) return;

        const levels = this.hls.levels;
        const qualityLabels = [
            'Auto',
            ...levels.map((level, i) => {
                const height = level.height || 0;
                const bandwidth = level.bitrate || 0;
                if (height >= 1080) return '1080p';
                if (height >= 720) return '720p';
                if (height >= 480) return '480p';
                if (height >= 360) return '360p';
                if (height >= 180) return '180p';
                return `${Math.round(bandwidth / 1000)}k`;
            }),
        ];

        const updateQualityMenu = () => {
            const currentLevel = this.hls.currentLevel;
            qualityMenu.innerHTML = qualityLabels
                .map((label, i) => {
                    const isActive = currentLevel === i - 1 || (i === 0 && currentLevel === -1);
                    return `<button class="fs-quality-option ${isActive ? 'active' : ''}" data-level="${i - 1}">${label}</button>`;
                })
                .join('');

            qualityMenu.querySelectorAll('.fs-quality-option').forEach((btn) => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const level = parseInt(btn.dataset.level);
                    this.hls.currentLevel = level;
                    const labelSpan = qualityBtn.querySelector('.fs-quality-label');
                    if (labelSpan) labelSpan.textContent = level === -1 ? 'Auto' : qualityLabels[level + 1] || 'Auto';
                    qualityMenu.style.display = 'none';
                };
            });
        };

        qualityBtn.style.display = 'flex';
        qualityBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = qualityMenu.style.display === 'block';
            qualityMenu.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) {
                updateQualityMenu();
            }
        };

        this.hls.on(Hls.Events.LEVEL_SWITCHED, () => {
            updateQualityMenu();
            const labelSpan = qualityBtn.querySelector('.fs-quality-label');
            if (labelSpan) {
                const currentLevel = this.hls.currentLevel;
                labelSpan.textContent = currentLevel === -1 ? 'Auto' : qualityLabels[currentLevel + 1] || 'Auto';
            }
        });

        document.addEventListener('click', () => {
            qualityMenu.style.display = 'none';
        });

        qualityMenu.onclick = (e) => e.stopPropagation();
    }

    async playVideo(video) {
        if (!video) return;
        const videoTrack = {
            ...video,
            type: 'video',
            artist: video.artist || (video.artists && video.artists[0]) || 'Unknown Artist',
            album: video.album || { title: 'Video', cover: video.image || video.cover },
        };
        this.setQueue([videoTrack], 0);
        await this.playTrackFromQueue();
    }

    async playTrackFromQueue(startTime = 0, recursiveCount = 0, isRetry = false) {
        if (!isRetry) {
            this.isFallbackRetry = false;
        }

        const currentSequence = ++this.playbackSequence;
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        const track = currentQueue[this.currentQueueIndex];
        if (track.isUnavailable) {
            console.warn(`Attempted to play unavailable track: ${track.title}. Skipping...`);
            this.playNext();
            return;
        }

        // Check if track is blocked
        const { contentBlockingSettings } = await import('./storage.js');
        if (contentBlockingSettings.shouldHideTrack(track)) {
            console.warn(`Attempted to play blocked track: ${track.title}. Skipping...`);
            this.playNext();
            return;
        }

        this.saveQueueState();

        this.currentTrack = track;

        const trackTitle = getTrackTitle(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);
        const yearDisplay = getTrackYearDisplay(track);

        const trackInfo = document.querySelector('.now-playing-bar .track-info');
        const coverEl = trackInfo?.querySelector('.cover:not(#audio-player):not(#video-player)');

        const isVideoTrack = track.type === 'video';
        const activeElement = isVideoTrack ? this.video : this.audio;
        const inactiveElement = isVideoTrack ? this.audio : this.video;
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.dashInitialized) {
            this.dashPlayer.reset();
            this.dashInitialized = false;
        }

        if (inactiveElement) {
            inactiveElement.pause();
            inactiveElement.src = '';
            inactiveElement.removeAttribute('src');
            inactiveElement.style.display = 'none';
            if (inactiveElement.parentElement !== document.body) {
                document.body.appendChild(inactiveElement);
            }
        }

        if (activeElement) {
            activeElement.pause();
            activeElement.src = '';
            activeElement.removeAttribute('src');
        }

        audioContextManager.changeSource(activeElement);

        if (isVideoTrack) {
            if (coverEl) coverEl.style.display = 'none';
            if (this.video) {
                const isInFullscreen = document.getElementById('fullscreen-cover-overlay')?.style.display === 'flex';

                if (!isInFullscreen) {
                    this.video.style.display = 'block';
                    this.video.className = 'cover video-cover-mirror';
                    this.video.style.width = '56px';
                    this.video.style.height = '56px';
                    this.video.style.borderRadius = 'var(--radius-sm)';
                    this.video.style.objectFit = 'cover';
                    this.video.style.gridArea = 'none';
                    this.video.muted = false;

                    if (trackInfo && this.video.parentElement !== trackInfo) {
                        trackInfo.insertBefore(this.video, trackInfo.firstChild);
                    }
                }
            }
        } else {
            if (coverEl) {
                coverEl.style.display = 'block';
                const coverUrl = this.api.getCoverUrl(track.image || track.cover || track.album?.cover);
                if (coverEl.src !== coverUrl) coverEl.src = coverUrl;
            }
            if (this.audio) {
                const isInFullscreen = document.getElementById('fullscreen-cover-overlay')?.style.display === 'flex';
                if (!isInFullscreen) {
                    this.audio.style.display = 'none';
                }
            }
        }
        document.querySelector('.now-playing-bar .title').innerHTML =
            `${escapeHtml(trackTitle)} ${createQualityBadgeHTML(track)}`;
        const albumEl = document.querySelector('.now-playing-bar .album');
        if (albumEl) {
            const albumTitle = track.album?.title || '';
            if (albumTitle && albumTitle !== trackTitle) {
                albumEl.textContent = albumTitle;
                albumEl.style.display = 'block';
            } else {
                albumEl.textContent = '';
                albumEl.style.display = 'none';
            }
        }
        const artistEl = document.querySelector('.now-playing-bar .artist');
        artistEl.innerHTML = trackArtistsHTML + yearDisplay;

        // Fetch album release date in background if missing
        if (!yearDisplay && track.album?.id) {
            this.loadAlbumYear(track, trackArtistsHTML, artistEl);
        }

        const mixBtn = document.getElementById('now-playing-mix-btn');
        if (mixBtn) {
            mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
        }
        document.title = `${trackTitle} • ${getTrackArtists(track)}`;

        this.updatePlayingTrackIndicator();
        this.updateMediaSession(track);
        this.updateMediaSessionPlaybackState();
        this.updateNativeWindow(track);

        try {
            let streamUrl;

            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));

            if (isTracker || (track.audioUrl && !track.isLocal)) {
                streamUrl = track.audioUrl;

                if (
                    (!streamUrl || (typeof streamUrl === 'string' && streamUrl.startsWith('blob:'))) &&
                    track.remoteUrl
                ) {
                    streamUrl = track.remoteUrl;
                }

                if (!streamUrl) {
                    console.warn(`Track ${trackTitle} audio URL is missing. Skipping.`);
                    track.isUnavailable = true;
                    this.playNext();
                    return;
                }

                if (isTracker && !streamUrl.startsWith('blob:') && streamUrl.startsWith('http')) {
                    try {
                        const response = await fetch(streamUrl);
                        if (response.ok) {
                            const blob = await response.blob();
                            streamUrl = URL.createObjectURL(blob);
                        }
                    } catch (e) {
                        console.warn('Failed to fetch tracker blob, trying direct link', e);
                    }
                }

                if (this.playbackSequence !== currentSequence) return;

                this.currentRgValues = null;
                this.applyReplayGain();

                activeElement.src = streamUrl;
                this.applyAudioEffects();

                // Wait for audio to be ready before playing (prevents restart issues with blob URLs)
                const canPlay = await this.waitForCanPlayOrTimeout(activeElement);
                if (!canPlay || this.playbackSequence !== currentSequence) return;

                if (startTime > 0) {
                    activeElement.currentTime = startTime;
                }
                const played = await this.safePlay(activeElement);
                if (!played) return;
            } else if (track.isLocal && track.file) {
                streamUrl = URL.createObjectURL(track.file);
                if (this.playbackSequence !== currentSequence) return;

                this.currentRgValues = null; // No replaygain for local files yet
                this.applyReplayGain();

                activeElement.src = streamUrl;
                this.applyAudioEffects();

                // Wait for audio to be ready before playing
                const canPlay = await this.waitForCanPlayOrTimeout(activeElement);
                if (!canPlay || this.playbackSequence !== currentSequence) return;

                if (startTime > 0) {
                    activeElement.currentTime = startTime;
                }
                const played = await this.safePlay(activeElement);
                if (!played) return;
            } else if (track.type === 'video') {
                if (window.monochromeUi) {
                    const isInFullscreen =
                        document.getElementById('fullscreen-cover-overlay')?.style.display === 'flex';
                    if (!isInFullscreen) {
                        const lyricsManager = window.monochromeUi.lyricsManager;
                        window.monochromeUi.showFullscreenCover(
                            track,
                            this.getNextTrack(),
                            lyricsManager,
                            activeElement
                        );
                    }
                }

                streamUrl = await this.api.getVideoStreamUrl(track.id);
                if (this.playbackSequence !== currentSequence) return;

                if (streamUrl.includes('.m3u8') || streamUrl.includes('application/vnd.apple.mpegurl')) {
                    this.setupHlsVideo(activeElement, streamUrl, null);
                } else if (streamUrl.startsWith('blob:') || streamUrl.includes('.mpd')) {
                    this.dashPlayer.initialize(activeElement, streamUrl, false);
                    this.dashInitialized = true;
                } else {
                    activeElement.src = streamUrl;
                }

                this.applyAudioEffects();

                const canPlay = await this.waitForCanPlayOrTimeout(activeElement);
                if (!canPlay || this.playbackSequence !== currentSequence) return;

                if (startTime > 0) {
                    activeElement.currentTime = startTime;
                }

                await this.safePlay(activeElement);
            } else {
                const isQobuz = String(track.id).startsWith('q:');

                if (isQobuz) {
                    // Qobuz: skip getTrack call, directly fetch stream URL
                    this.currentRgValues = null;
                    this.applyReplayGain();

                    if (this.preloadCache.has(track.id)) {
                        streamUrl = this.preloadCache.get(track.id);
                    } else {
                        streamUrl = await this.api.getStreamUrl(track.id, this.quality);
                    }
                } else {
                    // Tidal: Get track data for ReplayGain (should be cached by API)
                    const trackData = await this.api.getTrack(track.id, this.quality);
                    if (this.playbackSequence !== currentSequence) return;

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

                    if (this.preloadCache.has(track.id)) {
                        streamUrl = this.preloadCache.get(track.id);
                    } else if (trackData.originalTrackUrl) {
                        streamUrl = trackData.originalTrackUrl;
                    } else if (trackData.info?.manifest) {
                        streamUrl = this.api.extractStreamUrlFromManifest(trackData.info.manifest);
                    } else {
                        streamUrl = await this.api.getStreamUrl(track.id, this.quality);
                    }
                }

                if (this.playbackSequence !== currentSequence) return;

                // Handle playback
                if (streamUrl && streamUrl.startsWith('blob:') && !track.isLocal) {
                    // It's likely a DASH manifest blob URL
                    this.dashPlayer.initialize(activeElement, streamUrl, false);
                    this.dashInitialized = true;
                    this.applyAudioEffects();

                    if (startTime > 0) {
                        this.dashPlayer.seek(startTime);
                    }

                    const canPlay = await this.waitForCanPlayOrTimeout(activeElement);
                    if (!canPlay || this.playbackSequence !== currentSequence) return;
                    await this.safePlay(activeElement);
                } else {
                    activeElement.src = streamUrl;
                    this.applyAudioEffects();

                    // Wait for audio to be ready before playing
                    const canPlay = await this.waitForCanPlayOrTimeout(activeElement);
                    if (!canPlay || this.playbackSequence !== currentSequence) return;

                    if (startTime > 0) {
                        activeElement.currentTime = startTime;
                    }
                    const played = await this.safePlay(activeElement);
                    if (!played) return;
                }
            }

            this.preloadNextTracks();
        } catch (error) {
            if (this.playbackSequence !== currentSequence) return;
            if (error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
                this.autoplayBlocked = true;
                return;
            }

            if (this.quality === 'HI_RES_LOSSLESS' && !this.isFallbackRetry) {
                this.isFallbackRetry = true;
                const originalQuality = this.quality;
                this.quality = 'LOSSLESS';
                this.isFallbackInProgress = true;
                try {
                    await this.playTrackFromQueue(startTime, recursiveCount, true);
                    return;
                } catch (retryError) {
                } finally {
                    this.quality = originalQuality;
                    this.isFallbackRetry = false;
                    this.isFallbackInProgress = false;
                    return;
                }
            }

            console.error(`Could not play track: ${trackTitle}`, error);
            // Skip to next track on unexpected error
            if (recursiveCount < currentQueue.length) {
                setTimeout(() => this.playNext(recursiveCount + 1), 1000);
            }
        }
    }

    playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            this.playTrackFromQueue(0, 0);
        }
    }

    playNext(recursiveCount = 0) {
        const currentQueue = this.getCurrentQueue();
        const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;

        if (this.radioEnabled && this.currentQueueIndex >= currentQueue.length - 3) {
            this.fetchRadioRecommendations();
        }

        if (recursiveCount > currentQueue.length) {
            if (this.radioEnabled && isLastTrack) {
                this.fetchRadioRecommendations().then(() => {
                    const updatedQueue = this.getCurrentQueue();
                    if (this.currentQueueIndex < updatedQueue.length - 1) {
                        this.playNext(0);
                    }
                });
                return;
            }
            console.error('All tracks in queue are unavailable or blocked.');
            this.activeElement.pause();
            return;
        }

        // Import blocking settings dynamically
        import('./storage.js').then(({ contentBlockingSettings }) => {
            if (
                this.repeatMode === REPEAT_MODE.ONE &&
                !currentQueue[this.currentQueueIndex]?.isUnavailable &&
                !contentBlockingSettings.shouldHideTrack(currentQueue[this.currentQueueIndex])
            ) {
                this.playTrackFromQueue(0, recursiveCount);
                return;
            }

            if (!isLastTrack) {
                this.currentQueueIndex++;
                const track = currentQueue[this.currentQueueIndex];
                // Skip unavailable and blocked tracks
                if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                    return this.playNext(recursiveCount + 1);
                }
            } else if (this.radioEnabled) {
                this.fetchRadioRecommendations().then(() => {
                    const updatedQueue = this.getCurrentQueue();
                    if (this.currentQueueIndex < updatedQueue.length - 1) {
                        this.playNext(0);
                    }
                });
                return;
            } else if (this.repeatMode === REPEAT_MODE.ALL) {
                this.currentQueueIndex = 0;
                const track = currentQueue[this.currentQueueIndex];
                // Skip unavailable and blocked tracks
                if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                    return this.playNext(recursiveCount + 1);
                }
            } else {
                return;
            }

            this.playTrackFromQueue(0, recursiveCount);
        });
    }

    async enableRadio(seeds = []) {
        this.radioEnabled = true;
        radioSettings.setEnabled(true);

        if (seeds.length === 0) {
            this.wipeQueue();
            const pickedSeeds = await this.pickRadioSeeds();
            if (pickedSeeds.length > 0) {
                this.radioSeeds = pickedSeeds;
                const initialQueue = [...pickedSeeds].sort(() => 0.5 - Math.random()).slice(0, 5);
                this.setQueue(initialQueue, 0, true);
                this.playAtIndex(0);
            }
        } else {
            this.radioSeeds = Array.isArray(seeds) ? seeds : [seeds];
            this.wipeQueue();
            const initialQueue = Array.isArray(seeds) ? seeds.slice(0, 5) : [seeds];
            this.setQueue(initialQueue, 0, true);
            this.playAtIndex(0);
        }

        const currentQueue = this.getCurrentQueue();
        if (this.currentQueueIndex >= currentQueue.length - 2) {
            await this.fetchRadioRecommendations();
        }

        window.dispatchEvent(new CustomEvent('radio-state-changed', { detail: { enabled: true } }));
    }

    disableRadio() {
        if (!this.radioEnabled) return;
        this.radioEnabled = false;
        radioSettings.setEnabled(false);
        window.dispatchEvent(new CustomEvent('radio-state-changed', { detail: { enabled: false } }));
    }

    fetchRadioRecommendations() {
        if (this.isFetchingRadio) return this.radioFetchPromise || Promise.resolve();
        this.isFetchingRadio = true;

        this.showRadioLoading(true);

        this.radioFetchPromise = (async () => {
            try {
                if (this.radioSeeds.length === 0) {
                    this.radioSeeds = await this.pickRadioSeeds();
                }

                const shuffledSeeds = [...this.radioSeeds].sort(() => 0.5 - Math.random());
                const seeds = shuffledSeeds.length > 0 
                    ? shuffledSeeds.slice(0, 5) 
                    : this.currentTrack ? [this.currentTrack] : [];

                if (seeds.length === 0) {
                    return;
                }

                const [favorites, userPlaylists, history] = await Promise.all([
                    db.getFavorites('track'),
                    db.getAll('user_playlists'),
                    db.getHistory(),
                ]);

                const knownTrackIds = new Set([
                    ...favorites.map((t) => t.id),
                    ...userPlaylists.flatMap((p) => (p.tracks || []).map((t) => t.id)),
                    ...history.map((t) => t.id),
                ]);

                const recommendations = await this.api.getRecommendedTracksForPlaylist(seeds, 20, {
                    knownTrackIds: knownTrackIds
                });

                if (recommendations && recommendations.length > 0) {
                    const currentQueueIds = new Set(this.getCurrentQueue().map((t) => t.id));

                    let newTracks = recommendations.filter((t) => {
                        return !currentQueueIds.has(t.id);
                    });

                    if (newTracks.length > 0) {
                        const tracksToAdd = newTracks.sort(() => 0.5 - Math.random()).slice(0, 5);
                        this.addToQueue(tracksToAdd);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch radio recommendations:', error);
            } finally {
                this.isFetchingRadio = false;
                this.radioFetchPromise = null;
                setTimeout(() => this.showRadioLoading(false), 500);
            }
        })();

        return this.radioFetchPromise;
    }

    async pickRadioSeeds() {
        try {
            const [history, favorites, userPlaylists] = await Promise.all([
                db.getHistory(),
                db.getFavorites('track'),
                db.getAll('user_playlists'),
            ]);

            let potentialSeeds = [];

            if (history && history.length > 0) {
                const frequencyMap = new Map();
                history.forEach((t) => {
                    frequencyMap.set(t.id, (frequencyMap.get(t.id) || 0) + 1);
                });

                const historyTracks = Array.from(new Set(history.map((t) => t.id)))
                    .map((id) => history.find((t) => t.id === id))
                    .sort((a, b) => frequencyMap.get(b.id) - frequencyMap.get(a.id));

                potentialSeeds.push(...historyTracks.slice(0, 20));
            }

            if (favorites && favorites.length > 0) {
                potentialSeeds.push(...favorites);
            }

            if (userPlaylists && userPlaylists.length > 0) {
                userPlaylists.forEach((p) => {
                    if (p.tracks && p.tracks.length > 0) {
                        const randomTracks = p.tracks.sort(() => 0.5 - Math.random()).slice(0, 5);
                        potentialSeeds.push(...randomTracks);
                    }
                });
            }

            if (potentialSeeds.length === 0) return [];

            const uniqueSeeds = Array.from(new Set(potentialSeeds.map((s) => s.id))).map((id) =>
                potentialSeeds.find((s) => s.id === id)
            );

            return uniqueSeeds.sort(() => 0.5 - Math.random()).slice(0, 50);
        } catch (error) {
            console.error('Failed to pick radio seeds:', error);
            return this.currentTrack ? [this.currentTrack] : [];
        }
    }

    showRadioLoading(show) {
        const loadingEl = document.getElementById('radio-loading-indicator');
        if (loadingEl) {
            loadingEl.style.display = show ? 'flex' : 'none';
        }
    }

    playPrev(recursiveCount = 0) {
        const el = this.activeElement;
        if (el.currentTime > 3) {
            el.currentTime = 0;
            this.updateMediaSessionPositionState();
        } else if (this.currentQueueIndex > 0) {
            this.currentQueueIndex--;
            // Skip unavailable and blocked tracks
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

            if (recursiveCount > currentQueue.length) {
                console.error('All tracks in queue are unavailable or blocked.');
                el.pause();
                return;
            }

            import('./storage.js').then(({ contentBlockingSettings }) => {
                const track = currentQueue[this.currentQueueIndex];
                if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                    return this.playPrev(recursiveCount + 1);
                }
                this.playTrackFromQueue(0, recursiveCount);
            });
        }
    }

    get activeElement() {
        return this.currentTrack?.type === 'video' ? this.video : this.audio;
    }

    handlePlayPause() {
        const el = this.activeElement;
        if (!el.src || el.error) {
            if (this.currentTrack) {
                this.playTrackFromQueue(0, 0);
            }
            return;
        }

        if (el.paused) {
            this.safePlay(el).catch((e) => {
                if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
                console.error('Play failed, reloading track:', e);
                if (this.currentTrack) {
                    this.playTrackFromQueue(0, 0);
                }
            });
        } else {
            el.pause();
            this.saveQueueState();
        }
    }

    seekBackward(seconds = 10) {
        const el = this.activeElement;
        const newTime = Math.max(0, el.currentTime - seconds);
        el.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    seekForward(seconds = 10) {
        const el = this.activeElement;
        const duration = el.duration || 0;
        const newTime = Math.min(duration, el.currentTime + seconds);
        el.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    toggleShuffle() {
        this.shuffleActive = !this.shuffleActive;

        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle = [...this.queue];
            const currentTrack = this.queue[this.currentQueueIndex];

            const tracksToShuffle = [...this.queue];
            if (currentTrack && this.currentQueueIndex >= 0) {
                tracksToShuffle.splice(this.currentQueueIndex, 1);
            }

            for (let i = tracksToShuffle.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tracksToShuffle[i], tracksToShuffle[j]] = [tracksToShuffle[j], tracksToShuffle[i]];
            }

            if (currentTrack) {
                this.shuffledQueue = [currentTrack, ...tracksToShuffle];
                this.currentQueueIndex = 0;
            } else {
                this.shuffledQueue = tracksToShuffle;
                this.currentQueueIndex = -1;
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

    setQueue(tracks, startIndex = 0, isRadio = false) {
        if (!isRadio) {
            this.disableRadio();
        }
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.preloadCache.clear();
        this.saveQueueState();
    }

    addToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        this.queue.push(...tracks);

        if (this.shuffleActive) {
            this.shuffledQueue.push(...tracks);
            this.originalQueueBeforeShuffle.push(...tracks);
        }

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.getCurrentQueue().length - tracks.length;
            this.playTrackFromQueue(0, 0);
        }
        this.saveQueueState();
    }

    addNextToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const insertIndex = this.currentQueueIndex + 1;

        // Insert after current track
        currentQueue.splice(insertIndex, 0, ...tracks);

        // If we are shuffling, we might want to also add it to the original queue for consistency,
        // though syncing that is tricky. The standard logic often just appends to the active queue view.
        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle.push(...tracks); // Sync original queue
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
        if (this.currentTrack) {
            this.queue = [this.currentTrack];

            if (this.shuffleActive) {
                this.shuffledQueue = [this.currentTrack];
                this.originalQueueBeforeShuffle = [this.currentTrack];
            } else {
                this.shuffledQueue = [];
                this.originalQueueBeforeShuffle = [];
            }
            this.currentQueueIndex = 0;
        } else {
            this.queue = [];
            this.shuffledQueue = [];
            this.originalQueueBeforeShuffle = [];
            this.currentQueueIndex = -1;
        }

        this.preloadCache.clear();
        this.saveQueueState();
    }

    wipeQueue() {
        const el = this.activeElement;
        el.pause();
        el.src = '';
        this.currentTrack = null;
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.saveQueueState();
        if (window.monochromeUi) {
            window.monochromeUi.setCurrentTrack(null);
        }
        if (window.renderQueueFunction) {
            window.renderQueueFunction();
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

    loadAlbumYear(track, trackArtistsHTML, artistEl) {
        if (!trackDateSettings.useAlbumYear()) return;

        this.api
            .getAlbum(track.album.id)
            .then(({ album }) => {
                if (album?.releaseDate && this.currentTrack?.id === track.id) {
                    track.album.releaseDate = album.releaseDate;
                    const year = new Date(album.releaseDate).getFullYear();
                    if (!isNaN(year) && artistEl) {
                        artistEl.innerHTML = `${trackArtistsHTML} • ${year}`;
                    }
                }
            })
            .catch(() => {});
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

        const coverId = track.album?.cover;
        const trackTitle = getTrackTitle(track);

        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackTitle || 'Unknown Title',
            artist: getTrackArtists(track) || 'Unknown Artist',
            album: track.album?.title || 'Unknown Album',
            artwork: coverId
                ? [
                      {
                          src: this.api.getCoverUrl(coverId, '1280'),
                          sizes: '1280x1280',
                          type: 'image/jpeg',
                      },
                  ]
                : undefined,
        });

        this.updateMediaSessionPlaybackState();
        this.updateMediaSessionPositionState();
    }

    updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = this.activeElement.paused ? 'paused' : 'playing';
    }

    updateMediaSessionPositionState() {
        if (!('mediaSession' in navigator)) return;
        if (!('setPositionState' in navigator.mediaSession)) return;

        const el = this.activeElement;
        const duration = el.duration;

        if (!duration || isNaN(duration) || !isFinite(duration)) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: el.playbackRate || 1,
                position: Math.min(el.currentTime, duration),
            });
        } catch (error) {
            console.log('Failed to update Media Session position:', error);
        }
    }

    async safePlay(element = this.activeElement) {
        try {
            await element.play();
            this.autoplayBlocked = false;
            return true;
        } catch (error) {
            if (error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
                this.autoplayBlocked = true;
                return false;
            }
            throw error;
        }
    }

    async waitForCanPlayOrTimeout(element = this.activeElement, timeoutMs = 10000) {
        if (element.readyState >= 2) {
            return true;
        }

        return await new Promise((resolve, reject) => {
            const onCanPlay = () => {
                element.removeEventListener('canplay', onCanPlay);
                element.removeEventListener('error', onError);
                resolve(true);
            };
            const onError = (e) => {
                element.removeEventListener('canplay', onCanPlay);
                element.removeEventListener('error', onError);
                reject(e);
            };
            element.addEventListener('canplay', onCanPlay);
            element.addEventListener('error', onError);

            // Timeout after 10 seconds. Treat as autoplay blocked when backgrounded (esp. iOS PWA).
            setTimeout(() => {
                element.removeEventListener('canplay', onCanPlay);
                element.removeEventListener('error', onError);
                if (document.visibilityState === 'hidden' || (this.isIOS && this.isPwa)) {
                    this.autoplayBlocked = true;
                    resolve(false);
                    return;
                }
                reject(new Error('Timeout waiting for audio to load'));
            }, timeoutMs);
        });
    }

    // Sleep Timer Methods
    setSleepTimer(minutes) {
        this.clearSleepTimer(); // Clear any existing timer

        this.sleepTimerEndTime = Date.now() + minutes * 60 * 1000;

        this.sleepTimer = setTimeout(
            () => {
                this.activeElement.pause();
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

    async updateNativeWindow(track) {
        if (!window.Neutralino) return;

        const trackTitle = getTrackTitle(track);
        const artist = getTrackArtists(track);
        try {
            await Neutralino.window.setTitle(`${trackTitle} • ${artist}`);
        } catch (e) {
            console.error('Failed to set window title:', e);
        }
    }
}
