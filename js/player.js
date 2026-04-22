import {
    REPEAT_MODE,
    formatTime,
    getTrackArtists,
    getTrackTitle,
    getTrackArtistsHTML,
    getTrackYearDisplay,
    createQualityBadgeHTML,
    escapeHtml,
    deriveTrackQuality,
} from './utils.js';
import {
    queueManager,
    replayGainSettings,
    trackDateSettings,
    exponentialVolumeSettings,
    audioEffectsSettings,
    radioSettings,
    autoplaySettings,
    binauralDspSettings,
} from './storage.js';
import { audioContextManager } from './audio-context.js';
import { isIos, isSafari } from './platform-detection.js';
import { db } from './db.js';
import { getProxyUrl } from './proxy-utils.js';

import { SVG_CLOCK, SVG_ATMOS } from './icons.js';
import { UIRenderer } from './ui.js';
import { MediaSession } from '@capgo/capacitor-media-session';

export class Player {
    static #instance = null;

    static get instance() {
        if (!Player.#instance) {
            throw new Error('Player is not initialized. Call Player.initialize(audioElement, api) first.');
        }
        return Player.#instance;
    }

    /** @private */
    constructor(audioElement, api, quality = 'LOSSLESS') {
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
        this._pendingPreload = false;
        setInterval(this.checkPreloadConditions.bind(this), 2000);
        this.preloadAbortController = null;
        this.currentTrack = null;
        this.currentRgValues = null;
        this.userVolume = parseFloat(localStorage.getItem('volume') || '0.7');
        this.isFallbackRetry = false;
        this.isFallbackInProgress = false;
        this.autoplayBlocked = false;
        this.isIOS = isIos;
        this.isPwa =
            typeof window !== 'undefined' &&
            (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true);

        this.hls = null;
        // Sleep timer properties
        this.sleepTimer = null;
        this.sleepTimerEndTime = null;
        this.sleepTimerInterval = null;
        // Artist popular tracks state
        this.artistPopularTracksState = {
            artistId: null,
            offset: 0,
            initialTracks: [],
            isFetching: false,
            hasMore: true,
        };
    }

    static async initialize(audioElement, api, quality) {
        if (Player.#instance) {
            throw new Error('Player is already initialized');
        }

        const player = new Player(audioElement, api, quality);
        await player.init();
        Player.#instance = player;
        return player;
    }

    async init() {
        // Apply audio effects when track is ready
        this.audio.addEventListener('canplay', () => {
            this.applyAudioEffects();
        });
        if (this.video) {
            this.video.addEventListener('canplay', () => {
                this.applyAudioEffects();
            });
        }

        const waitForImagesLoading = () => {
            const images = Array.from(document.images).filter((img) => !img.complete);
            if (images.length === 0) return Promise.resolve();
            return Promise.all(
                images.map(
                    (img) =>
                        new Promise((res) => {
                            img.onload = img.onerror = res;
                        })
                )
            );
        };

        if (document.readyState !== 'complete') {
            await new Promise((resolve) => window.addEventListener('load', resolve));
        }
        await waitForImagesLoading();

        // Initialize Shaka player
        const shaka = await import('shaka-player');
        shaka.polyfill.installAll();
        if (shaka.Player.isBrowserSupported()) {
            this.shakaPlayer = new shaka.Player();
            this.shakaPlayer.configure({
                streaming: {
                    bufferingGoal: 30,
                    rebufferingGoal: 2,
                    bufferBehind: 30,
                    jumpLargeGaps: true,
                },
                abr: {
                    enabled: true,
                    defaultBandwidthEstimate: 100000,
                    switchInterval: 1,
                    bandwidthDowngradeTarget: 0.8,
                    restrictToElementSize: false,
                },
                mediaSource: {
                    codecSwitchingStrategy: 'smooth',
                },
            });
            this.shakaPlayer.getNetworkingEngine().registerRequestFilter((type, request) => {
                if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT) {
                    const uris = request.uris;
                    for (let i = 0; i < uris.length; i++) {
                        if (uris[i].includes('tidal.com')) {
                            uris[i] = getProxyUrl(uris[i]);
                        }
                    }
                }
            });
            this.shakaPlayer.addEventListener('adaptation', this.updateAdaptiveQualityBadge.bind(this));
            this.shakaPlayer.addEventListener('variantchanged', this.updateAdaptiveQualityBadge.bind(this));

            this.shakaInitialized = false;

            // Monitor and bridge different codec groups (e.g. AAC to FLAC) since native ABR isolates them
            setInterval(this.evaluateCrossCodecAbr.bind(this), 3000);
        } else {
            console.error('Browser not supported for Shaka Player');
        }

        this.loadQueueState();
        await this.setupMediaSession();

        this.radioEnabled = radioSettings.isEnabled();
        this.radioSeeds = [];
        this.isFetchingRadio = false;
        this.radioFetchPromise = null;

        this.autoplayEnabled = autoplaySettings.isEnabled();
        this.autoplaySeeds = [];
        this.isFetchingAutoplay = false;
        this.autoplayFetchPromise = null;
        this._recentlyPlayedIds = [];
        this._maxRecentlyPlayed = 100;

        this.playbackSequence = 0;

        window.addEventListener('beforeunload', async () => {
            await this.saveQueueState();
            import('./listening-tracker.js')
                .then(({ listeningTracker }) => {
                    listeningTracker.onTrackEnd();
                    listeningTracker.forceFlush();
                })
                .catch(() => {});
        });

        // Handle visibility change - AudioContext can be suspended when backgrounded
        document.addEventListener('visibilitychange', async () => {
            const el = this.activeElement;
            if (document.visibilityState === 'hidden' && !el.paused) {
                // Proactively resume context when going to background to prevent suspension
                void audioContextManager.resume();
            }
            if (document.visibilityState === 'visible' && !el.paused) {
                // Ensure audio context is resumed when user returns to the app
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(el);
                }
                await audioContextManager.resume();
            }
            if (document.visibilityState === 'visible' && this.autoplayBlocked) {
                this.autoplayBlocked = false;
                el.play().catch(() => {});
            }
        });

        this._setupVideoSync();
        this._setupAnimatedCoverSync();
    }

    _setupAnimatedCoverSync() {
        const syncPlayPause = () => {
            const isPaused = this.activeElement.paused;
            document.querySelectorAll('.cover, #fullscreen-cover-image').forEach((el) => {
                if (el.tagName === 'VIDEO' && el !== this.video) {
                    if (isPaused) {
                        el.pause();
                    } else {
                        el.play().catch(() => {});
                    }
                }
            });
        };

        this.audio.addEventListener('play', syncPlayPause);
        this.audio.addEventListener('pause', syncPlayPause);
        if (this.video) {
            this.video.addEventListener('play', syncPlayPause);
            this.video.addEventListener('pause', syncPlayPause);
        }
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
                        } catch {
                            // Video-to-audio time sync may fail if readyState is stale
                        }
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

        el.volume = Math.max(0, Math.min(1, effectiveVolume));
    }

    applyAudioEffects() {
        const speed = audioEffectsSettings.getSpeed();
        const el = this.activeElement;

        if (el.playbackRate !== speed) {
            el.playbackRate = speed;
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
        const parsed = parseFloat(speed);
        const validSpeed = Math.max(0.01, Math.min(100, isNaN(parsed) ? 1.0 : parsed));
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
                    const coverId = track.image || track.cover || track.album?.cover;
                    const coverUrl = videoCoverUrl || this.api.getCoverUrl(coverId);
                    const coverSrcset = videoCoverUrl ? null : this.api.getCoverSrcset(coverId);

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
                        const setImgSrcset = (img) => {
                            if (img.getAttribute('src') !== coverUrl) img.src = coverUrl;
                            if (coverSrcset) {
                                img.setAttribute('srcset', coverSrcset);
                                img.setAttribute('sizes', '(max-width: 640px) 160px, (max-width: 1024px) 320px, 640px');
                            } else {
                                img.removeAttribute('srcset');
                                img.removeAttribute('sizes');
                            }
                        };
                        if (coverEl.tagName === 'VIDEO') {
                            const img = document.createElement('img');
                            img.className = coverEl.className;
                            img.id = coverEl.id;
                            setImgSrcset(img);
                            coverEl.replaceWith(img);
                        } else {
                            setImgSrcset(coverEl);
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

    async saveQueueState() {
        queueManager.saveQueue({
            queue: this.queue,
            shuffledQueue: this.shuffledQueue,
            originalQueueBeforeShuffle: this.originalQueueBeforeShuffle,
            currentQueueIndex: this.currentQueueIndex,
            shuffleActive: this.shuffleActive,
            repeatMode: this.repeatMode,
        });

        if (window.renderQueueFunction) {
            await window.renderQueueFunction();
        }
    }

    async setupMediaSession() {
        const setHandlers = async () => {
            await MediaSession.setActionHandler({ action: 'play' }, async () => {
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
                    await this.handlePlayPause();
                }
            });

            await MediaSession.setActionHandler({ action: 'pause' }, () => {
                this.activeElement.pause();
            });

            await MediaSession.setActionHandler({ action: 'previoustrack' }, async () => {
                // Ensure audio context is active for iOS lock screen controls
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(this.activeElement);
                    this.applyReplayGain();
                }
                await audioContextManager.resume();
                this.playPrev();
            });

            await MediaSession.setActionHandler({ action: 'nexttrack' }, async () => {
                // Ensure audio context is active for iOS lock screen controls
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(this.activeElement);
                    this.applyReplayGain();
                }
                await audioContextManager.resume();
                await this.playNext();
            });

            if (!this.isIOS) {
                await MediaSession.setActionHandler({ action: 'seekbackward' }, (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.seekBackward(skipTime);
                });
                await MediaSession.setActionHandler({ action: 'seekforward' }, (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.seekForward(skipTime);
                });
            }

            await MediaSession.setActionHandler({ action: 'seekto' }, (details) => {
                if (details.seekTime !== undefined) {
                    this.activeElement.currentTime = Math.max(0, details.seekTime);
                    this.updateMediaSessionPositionState();
                }
            });

            await MediaSession.setActionHandler({ action: 'stop' }, () => {
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
            await setHandlers();
        }
    }

    setQuality(quality) {
        this.quality = quality;
    }

    preloadNextTracks() {
        this._pendingPreload = true;
    }

    async checkPreloadConditions() {
        if (!this._pendingPreload || !this.activeElement || this.activeElement.paused) return;

        const currentTime = this.activeElement.currentTime || 0;
        const duration = this.activeElement.duration || 0;
        const timeRemaining = duration - currentTime;

        // Preload if we are in last 30 seconds of song
        const shouldPreload = duration > 0 && timeRemaining <= 30;

        if (shouldPreload) {
            this._pendingPreload = false;
            void this._executePreloadNextTracks().catch(console.error);
        }
    }

    async _executePreloadNextTracks() {
        if (this.preloadAbortController) {
            this.preloadAbortController.abort();
        }

        this.preloadAbortController = new AbortController();
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const tracksToPreload = [];

        // Only preload the next 1 song to prevent data waste
        for (let i = 1; i <= 1; i++) {
            const nextIndex = this.currentQueueIndex + i;
            if (nextIndex < currentQueue.length) {
                tracksToPreload.push({ track: currentQueue[nextIndex], index: nextIndex });
            }
        }

        for (const { track } of tracksToPreload) {
            if (this.preloadCache.has(track.id)) continue;
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            const isPodcast = track.isPodcast || (track.id && String(track.id).startsWith('podcast_'));
            if (track.isLocal || isTracker || isPodcast || (track.audioUrl && !track.isLocal)) continue;
            try {
                const streamInfo =
                    track.type == 'video'
                        ? await this.api.getVideoStreamUrl(track.id)
                        : await this.api.getStreamUrl(track.id, this.quality);

                if (this.preloadAbortController.signal.aborted) break;

                // Also preload ReplayGain legacy metadata if the fast manifest endpoint failed to provide it
                if (track.type !== 'video' && !streamInfo.rgInfo) {
                    try {
                        const trackData = await this.api.getTrack(track.id, this.quality);
                        if (trackData && trackData.info) {
                            streamInfo.rgInfoFallback = {
                                trackReplayGain: trackData.info.trackReplayGain,
                                trackPeakAmplitude: trackData.info.trackPeakAmplitude,
                                albumReplayGain: trackData.info.albumReplayGain,
                                albumPeakAmplitude: trackData.info.albumPeakAmplitude,
                            };
                        }
                    } catch (_e) {} // Fail silently
                }

                this.preloadCache.set(track.id, streamInfo);
                const streamUrl = streamInfo.url;

                // Warm connection and pre-fetch
                if (!streamUrl.startsWith('blob:')) {
                    if (streamUrl.includes('.mpd') || streamUrl.includes('.m3u8')) {
                        if (
                            this.shakaInitialized &&
                            this.shakaPlayer &&
                            typeof this.shakaPlayer.preload === 'function'
                        ) {
                            try {
                                let preloadConfig = undefined;
                                if (typeof this.shakaPlayer.getConfiguration === 'function') {
                                    preloadConfig = this.shakaPlayer.getConfiguration();
                                    const stats =
                                        typeof this.shakaPlayer.getStats === 'function'
                                            ? this.shakaPlayer.getStats()
                                            : null;
                                    if (stats && stats.estimatedBandwidth) {
                                        preloadConfig.abr.defaultBandwidthEstimate = stats.estimatedBandwidth;
                                    }

                                    // Lock the preload to the exact current audio codec to prevent ABR mismatch,
                                    // which forces the player to discard and re-fetch chunks on slow connections.
                                    preloadConfig.abr.enabled = false;
                                    try {
                                        const variants =
                                            typeof this.shakaPlayer.getVariantTracks === 'function'
                                                ? this.shakaPlayer.getVariantTracks()
                                                : [];
                                        const activeVariant = variants.find((v) => v.active);
                                        if (activeVariant && activeVariant.audioCodec) {
                                            preloadConfig.preferredAudioCodecs = [activeVariant.audioCodec];
                                        }
                                    } catch (_e) {}
                                }
                                const preloadManager = await this.shakaPlayer.preload(
                                    streamUrl,
                                    null,
                                    null,
                                    preloadConfig
                                );
                                streamInfo.preloadManager = preloadManager;
                            } catch (_e) {
                                // Ignore preload errors, will just load fresh
                            }
                        } else {
                            fetch(streamUrl, { method: 'GET', signal: this.preloadAbortController.signal }).catch(
                                () => {}
                            );
                        }
                    } else {
                        // For static files (FLAC, MP3), the audio element completely primes the cache.
                        const preloader = new Audio();
                        preloader.preload = 'auto';
                        preloader.muted = true;
                        preloader.src = getProxyUrl(streamUrl);
                        streamInfo.preloader = preloader; // Hold reference
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    async setupHlsVideo(video, result, fallbackImg) {
        const url = result.videoUrl || result.hlsUrl || result;
        const Hls = (await import('hls.js')).default;
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
                this.hls.on(Hls.Events.MANIFEST_PARSED, async () => {
                    video.play().catch(() => {});
                    await this.setupVideoQualitySelector();
                });
                this.hls.on(Hls.Events.ERROR, (_event, data) => {
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
            video.onerror = async () => {
                if (result && result.hlsUrl) {
                    await this.setupHlsVideo(video, { videoUrl: null, hlsUrl: result.hlsUrl }, fallbackImg);
                } else if (fallbackImg) {
                    video.replaceWith(fallbackImg);
                }
            };
        }
    }

    async setupVideoQualitySelector() {
        if (!this.hls || !this.hls.levels || this.hls.levels.length === 0) return;
        const Hls = (await import('hls.js')).default;

        const qualityBtn = document.getElementById('fs-quality-btn');
        const qualityMenu = document.getElementById('fs-quality-menu');
        if (!qualityBtn || !qualityMenu) return;

        const levels = this.hls.levels;
        const qualityLabels = [
            'Auto',
            ...levels.map((level) => {
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
        await this.setQueue([videoTrack], 0);
        await this.playTrackFromQueue();
    }

    async updateVideoCovers(videoUrl) {
        if (!videoUrl) return;

        const syncCover = async (el) => {
            if (!el) return;
            const isPaused = this.activeElement.paused;
            let videoEl;
            if (el.tagName === 'IMG') {
                videoEl = document.createElement('video');
                videoEl.autoplay = !isPaused;
                videoEl.loop = true;
                videoEl.muted = true;
                videoEl.playsInline = true;
                videoEl.className = el.className;
                videoEl.id = el.id;
                videoEl.style.objectFit = 'cover';
                el.replaceWith(videoEl);
            } else if (el.tagName === 'VIDEO') {
                videoEl = el;
            } else {
                return;
            }

            if (UIRenderer.instance) {
                await UIRenderer.instance.setupHlsVideo(videoEl, videoUrl, null);
                if (isPaused) {
                    videoEl.pause();
                } else {
                    videoEl.play().catch(() => {});
                }
            }
        };

        const playerBarCover = document.querySelector('.now-playing-bar .cover');
        if (playerBarCover) await syncCover(playerBarCover);

        const fullscreenCover = document.getElementById('fullscreen-cover-image');
        if (fullscreenCover) await syncCover(fullscreenCover);
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
            await this.playNext();
            return;
        }

        // Check if track is blocked
        const { contentBlockingSettings } = await import('./storage.js');
        if (contentBlockingSettings.shouldHideTrack(track)) {
            console.warn(`Attempted to play blocked track: ${track.title}. Skipping...`);
            await this.playNext();
            return;
        }

        // Proactively fetch more artist tracks when the last track starts playing
        console.log('[playTrackFromQueue] Check for fetch:', {
            radioEnabled: this.radioEnabled,
            artistId: this.artistPopularTracksState.artistId,
            hasMore: this.artistPopularTracksState.hasMore,
            isFetching: this.artistPopularTracksState.isFetching,
            currentIndex: this.currentQueueIndex,
            queueLength: currentQueue.length,
            isLastTrack: this.currentQueueIndex >= currentQueue.length - 1,
        });

        if (
            !this.radioEnabled &&
            this.artistPopularTracksState.artistId &&
            this.artistPopularTracksState.hasMore &&
            !this.artistPopularTracksState.isFetching &&
            this.currentQueueIndex >= currentQueue.length - 1
        ) {
            console.log('[playTrackFromQueue] Fetching more tracks!');
            await this.fetchMoreArtistPopularTracks().then(async (newTracks) => {
                console.log('[playTrackFromQueue] Got tracks:', newTracks?.length);
                if (newTracks && newTracks.length > 0) {
                    await this.addToQueue(newTracks);
                }
            });
        }

        await this.saveQueueState();

        this.currentTrack = track;
        this.addToRecentlyPlayed(track.id);
        const trackTitle = getTrackTitle(track);
        const artistName = getTrackArtists(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);
        const yearDisplay = getTrackYearDisplay(track);

        if (!track.videoUrl && !track.videoCoverUrl && !track.album?.videoCoverUrl) {
            this.api.getVideoArtwork(trackTitle, artistName).then((result) => {
                if (this.currentTrack?.id === track.id && result && (result.videoUrl || result.hlsUrl)) {
                    track.videoCoverUrl = result.videoUrl || result.hlsUrl;
                    this.updateVideoCovers(track.videoCoverUrl);

                    if (
                        UIRenderer.instance &&
                        document.getElementById('fullscreen-cover-overlay')?.style.display === 'flex'
                    ) {
                        UIRenderer.instance.updateFullscreenMetadata(track, this.getNextTrack());
                    }
                }
            });
        }

        const trackInfo = document.querySelector('.now-playing-bar .track-info');
        const coverEl = trackInfo?.querySelector('.cover:not(#audio-player):not(#video-player)');

        const isVideoTrack = track.type === 'video';
        const activeElement = isVideoTrack ? this.video : this.audio;
        const inactiveElement = isVideoTrack ? this.audio : this.video;
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // Retain the initialized Shaka player if we are remaining on the same HTMLMediaElement
        if (this.shakaInitialized && this.shakaPlayer) {
            if (this.shakaPlayer.getMediaElement() !== activeElement) {
                this.shakaPlayer.unload();
                this.shakaInitialized = false;
            }
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
            // Let Shaka overwrite the activeElement's decoder pipeline gracefully if we're carrying it over.
            // It manages its own buffering teardown implicitly when `load()` is executed.
            if (!this.shakaInitialized) {
                activeElement.pause();
                activeElement.src = '';
                activeElement.removeAttribute('src');
            }
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
                const videoCoverUrl = track.videoUrl || track.videoCoverUrl || track.album?.videoCoverUrl || null;
                const coverId = track.image || track.cover || track.album?.cover;
                const coverUrl = videoCoverUrl || this.api.getCoverUrl(coverId);
                const coverSrcset = videoCoverUrl ? null : this.api.getCoverSrcset(coverId);

                if (videoCoverUrl) {
                    this.updateVideoCovers(videoCoverUrl);
                } else {
                    let imgEl = coverEl;
                    if (coverEl.tagName === 'VIDEO') {
                        imgEl = document.createElement('img');
                        imgEl.className = coverEl.className;
                        imgEl.id = coverEl.id;
                        coverEl.replaceWith(imgEl);
                    }

                    if (imgEl.getAttribute('src') !== coverUrl) {
                        imgEl.src = coverUrl;
                        if (coverSrcset) {
                            imgEl.setAttribute('srcset', coverSrcset);
                            imgEl.setAttribute('sizes', '(max-width: 640px) 160px, (max-width: 1024px) 320px, 640px');
                        } else {
                            imgEl.removeAttribute('srcset');
                            imgEl.removeAttribute('sizes');
                        }
                    }
                }
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

        try {
            let streamUrl;

            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            const isPodcast = track.isPodcast || (track.id && String(track.id).startsWith('podcast_'));

            if (isPodcast) {
                streamUrl = track.enclosureUrl;
                if (!streamUrl) {
                    console.warn(`Podcast episode ${trackTitle} audio URL is missing. Skipping.`);
                    track.isUnavailable = true;
                    await this.playNext();
                    return;
                }

                if (this.playbackSequence !== currentSequence) return;

                this.currentRgValues = null;
                this.applyReplayGain();

                activeElement.src = streamUrl;
                this.applyAudioEffects();

                const canPlay = await this.waitForCanPlayOrTimeout(activeElement);
                if (!canPlay || this.playbackSequence !== currentSequence) return;

                if (startTime > 0) {
                    activeElement.currentTime = startTime;
                }
                const played = await this.safePlay(activeElement);
                if (!played) return;
            } else if (isTracker || (track.audioUrl && !track.isLocal)) {
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
                    await this.playNext();
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
                if (UIRenderer.instance) {
                    const isInFullscreen =
                        document.getElementById('fullscreen-cover-overlay')?.style.display === 'flex';
                    if (!isInFullscreen) {
                        const lyricsManager = UIRenderer.instance.lyricsManager;
                        UIRenderer.instance.showFullscreenCover(
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
                    await this.setupHlsVideo(activeElement, streamUrl, null);
                } else if (streamUrl.startsWith('blob:') || streamUrl.includes('.mpd')) {
                    await this.shakaPlayer.attach(activeElement);

                    const loadTarget =
                        track.type == 'video' && this.preloadCache.has(track.id)
                            ? this.preloadCache.get(track.id).preloadManager || streamUrl
                            : streamUrl;

                    try {
                        await this.shakaPlayer.load(getProxyUrl(loadTarget));
                    } catch (e) {
                        console.error('PreloadManager load Error:', e);
                        if (loadTarget !== streamUrl) await this.shakaPlayer.load(getProxyUrl(streamUrl));
                        else throw e;
                    }

                    this.shakaInitialized = true;

                    const savedAdaptiveQuality = localStorage.getItem('adaptive-playback-quality') || 'auto';
                    this.forceQuality(savedAdaptiveQuality);

                    this.updateAdaptiveQualityBadge();
                } else {
                    activeElement.src = streamUrl;
                }

                this.applyAudioEffects();

                if (startTime > 0) {
                    activeElement.currentTime = startTime;
                }

                await this.safePlay(activeElement);
            } else {
                // Tidal: Try to get ReplayGain from manifest first, supplement with track info if needed
                const streamInfoPromise = this.preloadCache.has(track.id)
                    ? Promise.resolve(this.preloadCache.get(track.id))
                    : this.api.getStreamUrl(track.id, this.quality);

                // We only need the legacy track info if we missed getting ReplayGain from the manifest endpoint
                const resolvedStreamInfo = await streamInfoPromise;
                if (this.playbackSequence !== currentSequence) return;

                streamUrl = resolvedStreamInfo.url;

                if (resolvedStreamInfo.rgInfo) {
                    this.currentRgValues = resolvedStreamInfo.rgInfo;
                    this.applyReplayGain();
                } else if (resolvedStreamInfo.rgInfoFallback) {
                    this.currentRgValues = resolvedStreamInfo.rgInfoFallback;
                    this.applyReplayGain();
                } else {
                    // Fallback to legacy metadata if manifest lacked normalization data
                    const trackData = await this.api.getTrack(track.id, this.quality).catch(() => null);
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
                }

                if (this.playbackSequence !== currentSequence) return;

                // Handle playback
                if (streamUrl && (streamUrl.startsWith('blob:') || streamUrl.includes('.mpd')) && !track.isLocal) {
                    // It's likely a DASH manifest URL
                    if (this.shakaPlayer.getMediaElement() !== activeElement) {
                        await this.shakaPlayer.attach(activeElement);
                        this.shakaInitialized = true;
                    }

                    const loadTarget = resolvedStreamInfo.preloadManager || streamUrl;

                    try {
                        if (startTime > 0) {
                            await this.shakaPlayer.load(getProxyUrl(loadTarget), startTime);
                        } else {
                            await this.shakaPlayer.load(getProxyUrl(loadTarget));
                        }
                    } catch (e) {
                        console.error('PreloadManager load Error:', e);
                        if (loadTarget !== streamUrl) await this.shakaPlayer.load(getProxyUrl(streamUrl));
                        else throw e;
                    }

                    this.shakaInitialized = true;
                    this.applyAudioEffects();

                    const savedAdaptiveQuality = localStorage.getItem('adaptive-playback-quality') || 'auto';
                    this.forceQuality(savedAdaptiveQuality);

                    this.updateAdaptiveQualityBadge();

                    // Instantly trigger playback rather than explicitly waiting for 'canplay'
                    // which delays the event loop and natively adds gap/latency
                    await this.safePlay(activeElement);
                } else {
                    if (this.shakaInitialized) {
                        try {
                            this.shakaPlayer.unload();
                            this.shakaPlayer.detach();
                        } catch {}
                        this.shakaInitialized = false;
                    }
                    activeElement.src = getProxyUrl(streamUrl);
                    this.applyAudioEffects();
                    this.updateAdaptiveQualityBadge();

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
                } catch {
                    // LOSSLESS fallback also failed - fall through to error handling below
                } finally {
                    this.quality = originalQuality;
                    this.isFallbackRetry = false;
                    this.isFallbackInProgress = false;
                }

                return;
            }

            console.error(`Could not play track: ${trackTitle}`, error);
        }
    }

    async playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            await this.playTrackFromQueue(0, 0);
        }
    }

    async playNext(recursiveCount = 0) {
        const currentQueue = this.getCurrentQueue();
        const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;

        if (recursiveCount > currentQueue.length) {
            if (this.radioEnabled && isLastTrack) {
                this.fetchRadioRecommendations().then(async () => {
                    const updatedQueue = this.getCurrentQueue();
                    if (this.currentQueueIndex < updatedQueue.length - 1) {
                        await this.playNext(0);
                    }
                });
                return;
            }
            if (this.autoplayEnabled && isLastTrack) {
                this.fetchAutoplayRecommendations().then(async () => {
                    const updatedQueue = this.getCurrentQueue();
                    if (this.currentQueueIndex < updatedQueue.length - 1) {
                        await this.playNext(0);
                    }
                });
                return;
            }
            if (this.artistPopularTracksState.artistId && this.artistPopularTracksState.hasMore) {
                await this.fetchMoreArtistPopularTracks().then(async (newTracks) => {
                    if (newTracks && newTracks.length > 0) {
                        await this.addToQueue(newTracks);
                        await this.playNext(0);
                    } else {
                        this.activeElement.pause();
                    }
                });
                return;
            }
            this.activeElement.pause();
            return;
        }

        import('./storage.js')
            .then(async ({ contentBlockingSettings }) => {
                if (
                    this.repeatMode === REPEAT_MODE.ONE &&
                    !currentQueue[this.currentQueueIndex]?.isUnavailable &&
                    !contentBlockingSettings.shouldHideTrack(currentQueue[this.currentQueueIndex])
                ) {
                    await this.playTrackFromQueue(0, recursiveCount);
                    return;
                }

                if (!isLastTrack) {
                    this.currentQueueIndex++;
                    const track = currentQueue[this.currentQueueIndex];
                    if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                        return this.playNext(recursiveCount + 1);
                    }
                } else if (this.radioEnabled) {
                    this.fetchRadioRecommendations().then(async () => {
                        const updatedQueue = this.getCurrentQueue();
                        if (this.currentQueueIndex < updatedQueue.length - 1) {
                            await this.playNext(0);
                        }
                    });
                    return;
                } else if (this.autoplayEnabled) {
                    this.fetchAutoplayRecommendations().then(async () => {
                        const updatedQueue = this.getCurrentQueue();
                        if (this.currentQueueIndex < updatedQueue.length - 1) {
                            await this.playNext(0);
                        }
                    });
                    return;
                } else if (this.artistPopularTracksState.artistId && this.artistPopularTracksState.hasMore) {
                    await this.fetchMoreArtistPopularTracks().then(async (newTracks) => {
                        if (newTracks && newTracks.length > 0) {
                            await this.addToQueue(newTracks);
                        }
                        this.currentQueueIndex++;
                        await this.playTrackFromQueue(0, recursiveCount);
                    });
                    return;
                } else if (this.repeatMode === REPEAT_MODE.ALL) {
                    this.currentQueueIndex = 0;
                    const track = currentQueue[this.currentQueueIndex];
                    if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                        return this.playNext(recursiveCount + 1);
                    }
                } else {
                    return;
                }

                await this.playTrackFromQueue(0, recursiveCount);
            })
            .catch(console.error);
    }

    async enableRadio(seeds = []) {
        this.radioEnabled = true;
        radioSettings.setEnabled(true);

        if (seeds.length === 0) {
            await this.wipeQueue();
            const pickedSeeds = await this.pickRadioSeeds();
            if (pickedSeeds.length > 0) {
                this.radioSeeds = pickedSeeds;
                const initialQueue = [...pickedSeeds].sort(() => 0.5 - Math.random()).slice(0, 5);
                await this.setQueue(initialQueue, 0, true);
                await this.playAtIndex(0);
            }
        } else {
            this.radioSeeds = Array.isArray(seeds) ? seeds : [seeds];
            await this.wipeQueue();
            const initialQueue = Array.isArray(seeds) ? seeds.slice(0, 5) : [seeds];
            await this.setQueue(initialQueue, 0, true);
            await this.playAtIndex(0);
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
                const seeds =
                    shuffledSeeds.length > 0 ? shuffledSeeds.slice(0, 5) : this.currentTrack ? [this.currentTrack] : [];

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
                    ...this._recentlyPlayedIds,
                ]);

                let recommendations = await this.api.getRecommendedTracksForPlaylist(seeds, 20, {
                    knownTrackIds: knownTrackIds,
                });

                const { autoplaySettings: _autoplaySettings } = await import('./storage.js');
                if (_autoplaySettings.isSmartRecsEnabled()) {
                    const { smartRecommendations } = await import('./smart-recommendations.js');
                    recommendations = smartRecommendations.filterRecommendations(recommendations);
                    recommendations = smartRecommendations.rankRecommendations(recommendations);
                }

                if (recommendations && recommendations.length > 0) {
                    const currentQueueIds = new Set(this.getCurrentQueue().map((t) => t.id));

                    let newTracks = recommendations.filter((t) => {
                        return !currentQueueIds.has(t.id);
                    });

                    if (newTracks.length > 0) {
                        const tracksToAdd = newTracks.sort(() => 0.5 - Math.random()).slice(0, 5);
                        await this.addToQueue(tracksToAdd);
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
            const { smartRecommendations } = await import('./smart-recommendations.js');
            const smartSeeds = await smartRecommendations.getSmartSeeds(50);
            if (smartSeeds.length > 0) return smartSeeds;
        } catch (e) {
            console.warn('Smart seeds failed, falling back to basic seed selection:', e);
        }

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

    enableAutoplay() {
        this.autoplayEnabled = true;
        autoplaySettings.setEnabled(true);
    }

    disableAutoplay() {
        this.autoplayEnabled = false;
        autoplaySettings.setEnabled(false);
    }

    addToRecentlyPlayed(trackId) {
        if (!trackId) return;
        this._recentlyPlayedIds = this._recentlyPlayedIds.filter((id) => id !== trackId);
        this._recentlyPlayedIds.push(trackId);
        if (this._recentlyPlayedIds.length > this._maxRecentlyPlayed) {
            this._recentlyPlayedIds = this._recentlyPlayedIds.slice(-this._maxRecentlyPlayed);
        }
    }

    fetchAutoplayRecommendations() {
        if (this.isFetchingAutoplay) return this.autoplayFetchPromise || Promise.resolve();
        this.isFetchingAutoplay = true;

        this.showRadioLoading(true);

        this.autoplayFetchPromise = (async () => {
            try {
                const { smartRecommendations } = await import('./smart-recommendations.js');
                const { autoplaySettings: _autoplaySettings } = await import('./storage.js');

                const currentQueue = this.getCurrentQueue();
                const recentQueueTracks = currentQueue.slice(
                    Math.max(0, this.currentQueueIndex - 10),
                    this.currentQueueIndex + 1
                );

                const seeds = await smartRecommendations.getAdaptiveQueueSeeds(
                    recentQueueTracks,
                    this._recentlyPlayedIds,
                    5
                );

                if (seeds.length === 0) {
                    if (this.currentTrack) seeds.push(this.currentTrack);
                    else return;
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
                    ...this._recentlyPlayedIds,
                    ...currentQueue.map((t) => t.id),
                ]);

                let recommendations = await this.api.getRecommendedTracksForPlaylist(seeds, 20, {
                    knownTrackIds: knownTrackIds,
                });

                if (_autoplaySettings.isSmartRecsEnabled()) {
                    recommendations = smartRecommendations.filterRecommendations(recommendations);
                    recommendations = smartRecommendations.rankRecommendations(recommendations);
                }

                if (recommendations && recommendations.length > 0) {
                    const currentQueueIds = new Set(currentQueue.map((t) => t.id));
                    let newTracks = recommendations.filter((t) => !currentQueueIds.has(t.id));

                    if (newTracks.length > 0) {
                        const tracksToAdd = newTracks.slice(0, 5);
                        await this.addToQueue(tracksToAdd);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch autoplay recommendations:', error);
            } finally {
                this.isFetchingAutoplay = false;
                this.autoplayFetchPromise = null;
                setTimeout(() => this.showRadioLoading(false), 500);
            }
        })();

        return this.autoplayFetchPromise;
    }

    playPrev(recursiveCount = 0) {
        const el = this.activeElement;
        if (el.currentTime > 3) {
            el.currentTime = 0;
            this.updateMediaSessionPositionState();
        } else if (this.currentQueueIndex > 0) {
            this.currentQueueIndex--;
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

            if (recursiveCount > currentQueue.length) {
                console.error('All tracks in queue are unavailable or blocked.');
                el.pause();
                return;
            }

            import('./storage.js')
                .then(async ({ contentBlockingSettings }) => {
                    const track = currentQueue[this.currentQueueIndex];
                    if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                        return this.playPrev(recursiveCount + 1);
                    }
                    import('./listening-tracker.js')
                        .then(({ listeningTracker }) => {
                            listeningTracker.onSkip();
                            listeningTracker.forceFlush();
                        })
                        .catch(() => {});
                    await this.playTrackFromQueue(0, recursiveCount);
                })
                .catch(console.error);
        }
    }

    get activeElement() {
        return this.currentTrack?.type === 'video' ? this.video : this.audio;
    }

    async handlePlayPause() {
        const el = this.activeElement;
        const hasSource = el.src || el.currentSrc || el.srcObject || this.shakaInitialized;

        if (!hasSource || el.error) {
            if (this.currentTrack) {
                await this.playTrackFromQueue(0, 0);
            }
            return;
        }

        if (el.paused) {
            this.safePlay(el).catch(async (e) => {
                if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
                console.error('Play failed, reloading track:', e);
                if (this.currentTrack) {
                    await this.playTrackFromQueue(0, 0);
                }
            });
        } else {
            el.pause();
            await this.saveQueueState();
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

    async toggleShuffle() {
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
        await this.saveQueueState();
    }

    async toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        await this.saveQueueState();
        return this.repeatMode;
    }

    async setQueue(tracks, startIndex = 0, isRadio = false) {
        if (!isRadio) {
            this.disableRadio();
        }
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.preloadCache.clear();
        await this.saveQueueState();
    }

    setArtistPopularTracksContext(artistId, initialTracks, offset = 15, hasMore = true) {
        this.artistPopularTracksState = {
            artistId,
            offset,
            initialTracks,
            isFetching: false,
            hasMore,
        };
    }

    clearArtistPopularTracksContext() {
        this.artistPopularTracksState = {
            artistId: null,
            offset: 0,
            initialTracks: [],
            isFetching: false,
            hasMore: false,
        };
    }

    async fetchMoreArtistPopularTracks() {
        const state = this.artistPopularTracksState;
        console.log('[fetchMoreArtistPopularTracks] Called:', {
            artistId: state.artistId,
            offset: state.offset,
            isFetching: state.isFetching,
            hasMore: state.hasMore,
        });

        if (!state.artistId || state.isFetching || !state.hasMore) {
            console.log('[fetchMoreArtistPopularTracks] Early return');
            return [];
        }

        state.isFetching = true;

        try {
            console.log('[fetchMoreArtistPopularTracks] Fetching with offset:', state.offset);
            const result = await this.api.getArtistTopTracks(state.artistId, {
                offset: state.offset,
                limit: 15,
                firstTrackId: state.initialTracks[0]?.id,
            });

            console.log('[fetchMoreArtistPopularTracks] Result:', result);

            if (result.tracks && result.tracks.length > 0) {
                state.offset += result.tracks.length;
                state.hasMore = result.hasMore;

                return result.tracks;
            } else {
                state.hasMore = false;
                return [];
            }
        } catch (error) {
            console.warn('Failed to fetch more artist popular tracks:', error);
            state.hasMore = false;
            return [];
        } finally {
            state.isFetching = false;
        }
    }

    async addToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        this.queue.push(...tracks);

        if (this.shuffleActive) {
            this.shuffledQueue.push(...tracks);
            this.originalQueueBeforeShuffle.push(...tracks);
        }

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.getCurrentQueue().length - tracks.length;
            await this.playTrackFromQueue(0, 0);
        }
        await this.saveQueueState();
    }

    async addNextToQueue(trackOrTracks) {
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

        await this.saveQueueState();
        this.preloadNextTracks(); // Update preload since next track changed
    }

    async removeFromQueue(index) {
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

        await this.saveQueueState();
        this.preloadNextTracks();
    }

    async clearQueue() {
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
        await this.saveQueueState();
    }

    async wipeQueue() {
        const el = this.activeElement;
        el.pause();
        el.src = '';
        this.currentTrack = null;
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        await this.saveQueueState();
        if (UIRenderer.instance) {
            UIRenderer.instance.setCurrentTrack(null);
        }
        if (window.renderQueueFunction) {
            await window.renderQueueFunction();
        }
    }

    async moveInQueue(fromIndex, toIndex) {
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
        await this.saveQueueState();
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

    updateAdaptiveQualityBadge() {
        if (!this.currentTrack) return;

        try {
            const titleEl = document.querySelector('.now-playing-bar .title');
            if (!titleEl) return;

            let badgeEl = titleEl.querySelector('.shaka-quality-badge');

            // Determine if the track is inherently an Atmos track based on metadata
            const trackBaseQuality = deriveTrackQuality(this.currentTrack);
            const isTrackAtmos =
                trackBaseQuality === 'DOLBY_ATMOS' || this.currentTrack?.audioQuality === 'DOLBY_ATMOS';

            if (this.shakaInitialized) {
                const variants = this.shakaPlayer.getVariantTracks();
                const activeVariant = variants.find((t) => t.active);
                if (activeVariant) {
                    if (!badgeEl) {
                        badgeEl = document.createElement('span');
                        badgeEl.className = 'quality-badge quality-hires shaka-quality-badge';
                        badgeEl.title = 'Adaptive Stream Quality';
                        titleEl.appendChild(badgeEl);
                        const staticBadge = titleEl.querySelector('.quality-badge:not(.shaka-quality-badge)');
                        if (staticBadge) staticBadge.style.display = 'none';
                    }

                    let text = '';
                    let isAtmosPlaying = false;

                    if (activeVariant.videoBandwidth && activeVariant.height) {
                        text = `${activeVariant.height}p`;
                    } else if (activeVariant.audioCodec) {
                        const codec = activeVariant.audioCodec.toLowerCase();
                        if (codec.includes('flac')) {
                            const sampleRate = activeVariant.audioSamplingRate
                                ? activeVariant.audioSamplingRate / 1000
                                : 44.1;
                            if (sampleRate > 48 || activeVariant.audioBandwidth > 1200000) {
                                text = `HD 24/${sampleRate}`;
                            } else {
                                text = 'FLAC';
                            }
                        } else if (codec.includes('mp4a')) {
                            text = 'AAC';
                        } else if (codec.includes('ec-3') || codec.includes('ac-3')) {
                            if (codec.includes('joc') || codec === 'ec-3') {
                                isAtmosPlaying = true;
                            } else {
                                text = 'Dolby';
                            }
                        } else {
                            text = activeVariant.audioCodec;
                        }
                        if (
                            activeVariant.audioBandwidth &&
                            !text.includes('FLAC') &&
                            !text.includes('HD') &&
                            !isAtmosPlaying
                        ) {
                            text += ` ${Math.round(activeVariant.audioBandwidth / 1000)}k`;
                        }
                    } else {
                        text = 'Auto';
                    }

                    if (isAtmosPlaying) {
                        // Auto-enable binaural DSP for spatial content
                        if (binauralDspSettings.getAutoEnableForSpatial() && !binauralDspSettings.isEnabled()) {
                            void audioContextManager.toggleBinaural(true);
                            // Update toggle in settings UI if visible
                            const toggle = document.getElementById('binaural-dsp-toggle');
                            if (toggle) toggle.checked = true;
                            const container = document.getElementById('binaural-dsp-container');
                            if (container) container.style.display = 'block';
                        }
                        // Notify binaural DSP of the actual multichannel layout when Shaka exposes it.
                        const atmosChannelCount =
                            Number.isFinite(activeVariant.channelsCount) && activeVariant.channelsCount > 0
                                ? activeVariant.channelsCount
                                : 6;
                        void audioContextManager.notifyBinauralChannelCount(atmosChannelCount);

                        const binauralActive = audioContextManager.isBinauralActive();
                        badgeEl.className = 'quality-badge quality-atmos shaka-quality-badge';
                        badgeEl.innerHTML =
                            SVG_ATMOS(20) + (binauralActive ? ' <span class="binaural-badge">Binaural</span>' : '');
                    } else {
                        // Notify binaural DSP that we're in stereo mode
                        void audioContextManager.notifyBinauralChannelCount(2);
                        badgeEl.className = 'quality-badge quality-hires shaka-quality-badge';
                        badgeEl.textContent = text;
                    }
                    badgeEl.style.display = text || isAtmosPlaying ? 'inline-flex' : 'none';
                }
            } else if (
                (isIos || isSafari) &&
                this.activeElement &&
                this.activeElement.src &&
                (this.activeElement.src.includes('.m3u8') || this.currentTrack)
            ) {
                if (!badgeEl) {
                    badgeEl = document.createElement('span');
                    badgeEl.className = 'quality-badge quality-hires shaka-quality-badge';
                    badgeEl.title = 'HLS Stream Quality';
                    titleEl.appendChild(badgeEl);
                    const staticBadge = titleEl.querySelector('.quality-badge:not(.shaka-quality-badge)');
                    if (staticBadge) staticBadge.style.display = 'none';
                }

                let text = '';

                // Ensure device can actually decode Atmos before rendering logo for HLS
                let deviceSupportsAtmos = false;
                try {
                    if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
                        deviceSupportsAtmos =
                            MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"') ||
                            MediaSource.isTypeSupported('audio/mp4; codecs="eac3"');
                    }
                    if (!deviceSupportsAtmos && typeof document !== 'undefined') {
                        const a = document.createElement('audio');
                        deviceSupportsAtmos = !!(
                            a.canPlayType('audio/mp4; codecs="ec-3"') || a.canPlayType('audio/mp4; codecs="eac3"')
                        );
                    }
                } catch {
                    // Atmos codec detection may fail on some browsers
                }

                let isAtmosPlaying = isTrackAtmos && deviceSupportsAtmos;
                const q = this.quality || localStorage.getItem('adaptive-playback-quality') || 'auto';

                if (!isAtmosPlaying) {
                    if (q === 'HI_RES_LOSSLESS') text = 'HD FLAC';
                    else if (q === 'LOSSLESS') text = 'FLAC';
                    else if (q === 'HIGH') text = 'AAC';
                    else if (q === 'LOW') text = 'AAC Low';
                    else if (q === 'auto') text = 'HLS Auto';
                    else text = 'HLS';
                }

                if (isAtmosPlaying) {
                    badgeEl.innerHTML = SVG_ATMOS(20);
                    badgeEl.className = 'quality-badge quality-atmos shaka-quality-badge';
                } else {
                    badgeEl.textContent = text;
                    badgeEl.className = 'quality-badge quality-hires shaka-quality-badge';
                }
                badgeEl.style.display = 'inline-flex';
            } else {
                if (badgeEl) badgeEl.style.display = 'none';
            }
        } catch (e) {
            console.error('Failed to update adaptive quality badge', e);
        }
    }

    evaluateCrossCodecAbr() {
        if (!this.shakaInitialized || !this.shakaPlayer || this.shakaPlayer.isBuffering() || this.activeElement.paused)
            return;

        try {
            const stats = this.shakaPlayer.getStats();
            const estimatedBandwidth = stats.estimatedBandwidth;
            if (!estimatedBandwidth) return;

            const variants = this.shakaPlayer.getVariantTracks();
            if (variants.length < 2) return;

            const activeVariant = variants.find((v) => v.active);
            if (!activeVariant) return;

            // Sort variants by bandwidth descending
            const sortedVariants = [...variants].sort((a, b) => b.bandwidth - a.bandwidth);
            const safeUpBandwidth = estimatedBandwidth * 0.85;

            let bestVariant = sortedVariants[0];
            for (const variant of sortedVariants) {
                if (variant.bandwidth <= safeUpBandwidth) {
                    bestVariant = variant;
                    break;
                }
            }

            if (sortedVariants[sortedVariants.length - 1].bandwidth > safeUpBandwidth) {
                bestVariant = sortedVariants[sortedVariants.length - 1];
            }

            if (bestVariant.audioCodec !== activeVariant.audioCodec && bestVariant.id !== activeVariant.id) {
                // To safely cross AdaptationSet boundaries in Shaka, explicitly select the track
                this.shakaPlayer.configure({ preferredAudioCodecs: [bestVariant.audioCodec] });
                this.shakaPlayer.selectVariantTrack(bestVariant, false, 0); // false = don't clear buffer, smooth transition
                // Re-enable ABR so it can dynamically downgrade within that new codec family if needed
                this.shakaPlayer.configure({ abr: { enabled: true } });
            }
        } catch {
            // fail silently on abr checks
        }
    }

    forceQuality(quality) {
        if (!this.shakaInitialized || !this.shakaPlayer) return;

        try {
            if (quality === 'auto') {
                this.shakaPlayer.configure({
                    abr: { enabled: true },
                    preferredAudioCodecs: [],
                });
                return;
            }

            const variants = this.shakaPlayer.getVariantTracks();
            if (variants.length === 0) return;

            let bestVariant = variants[0];

            if (quality === 'LOW' || quality === 'HIGH') {
                const targetBandwidth = quality === 'LOW' ? 96000 : 320000;
                const aacVariants = variants.filter((v) => v.audioCodec && v.audioCodec.toLowerCase().includes('mp4a'));
                const searchVariants = aacVariants.length > 0 ? aacVariants : variants;

                let minDiff = Infinity;
                for (const variant of searchVariants) {
                    const bw = variant.audioBandwidth || variant.bandwidth;
                    const diff = Math.abs(bw - targetBandwidth);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestVariant = variant;
                    }
                }
            } else if (quality === 'LOSSLESS' || quality === 'HI_RES_LOSSLESS') {
                const flacVariants = variants.filter(
                    (v) => v.audioCodec && v.audioCodec.toLowerCase().includes('flac')
                );

                if (flacVariants.length > 0) {
                    if (quality === 'HI_RES_LOSSLESS') {
                        // Find highest quality FLAC
                        bestVariant = flacVariants.reduce((prev, current) => {
                            const prevBw = prev.audioBandwidth || prev.bandwidth || 0;
                            const currBw = current.audioBandwidth || current.bandwidth || 0;
                            return currBw > prevBw ? current : prev;
                        }, flacVariants[0]);
                    } else {
                        // Find standard lossless (lowest bandwidth FLAC, usually 16-bit 44.1kHz)
                        bestVariant = flacVariants.reduce((prev, current) => {
                            const prevBw = prev.audioBandwidth || prev.bandwidth || 0;
                            const currBw = current.audioBandwidth || current.bandwidth || 0;
                            return currBw < prevBw ? current : prev;
                        }, flacVariants[0]);
                    }
                } else {
                    // Fallback to highest overall
                    bestVariant = variants.reduce((prev, current) => {
                        const prevBw = prev.audioBandwidth || prev.bandwidth || 0;
                        const currBw = current.audioBandwidth || current.bandwidth || 0;
                        return currBw > prevBw ? current : prev;
                    }, variants[0]);
                }
            }

            this.shakaPlayer.configure({ abr: { enabled: false } });

            if (bestVariant.audioCodec) {
                this.shakaPlayer.configure({ preferredAudioCodecs: [bestVariant.audioCodec] });
            }
            this.shakaPlayer.selectVariantTrack(bestVariant, false, 0); // false = don't clear buffer, smooth transition
        } catch (e) {
            console.error('Failed to force quality', e);
        }
    }

    updateMediaSession(track) {
        const coverId = track.album?.cover;
        const trackTitle = getTrackTitle(track);

        // Force a refresh for picky Bluetooth systems by clearing metadata first
        MediaSession.setMetadata({})
            .finally(() =>
                MediaSession.setMetadata({
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
                })
            )
            .catch(() => {})
            .finally(() => {
                this.updateMediaSessionPlaybackState();
                this.updateMediaSessionPositionState();
            });
    }

    updateMediaSessionPlaybackState() {
        const isPlaying = !this.activeElement.paused;
        void MediaSession.setPlaybackState({ playbackState: isPlaying ? 'playing' : 'paused' });

        // Start/stop Android foreground service to prevent background audio throttling
        this._updateBackgroundAudioService(isPlaying);
    }

    /**
     * On Android (Capacitor), start or stop the foreground service that keeps
     * the WebView alive so Web Audio EQ processing isn't throttled.
     */
    _updateBackgroundAudioService(isPlaying) {
        if (this._bgAudioPending) return;
        this._bgAudioPending = true;

        // Lazy-load Capacitor core; no-op on web/iOS
        void (async () => {
            try {
                const { Capacitor } = await import('@capacitor/core');
                if (Capacitor.getPlatform() !== 'android') return;
                const { registerPlugin } = await import('@capacitor/core');
                if (!this._bgAudioPlugin) {
                    this._bgAudioPlugin = registerPlugin('BackgroundAudio');
                }
                if (isPlaying) {
                    await this._bgAudioPlugin.start();
                } else {
                    await this._bgAudioPlugin.stop();
                }
            } catch {
                // Not running in Capacitor or plugin unavailable - ignore
            } finally {
                this._bgAudioPending = false;
            }
        })();
    }

    updateMediaSessionPositionState() {
        const el = this.activeElement;
        const duration = el.duration;

        if (!duration || isNaN(duration) || !isFinite(duration)) {
            return;
        }

        MediaSession.setPositionState({
            duration: duration,
            playbackRate: el.playbackRate || 1,
            position: Math.min(el.currentTime, duration),
        }).catch((error) => {
            console.log('Failed to update Media Session position:', error);
        });
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
                    btn.innerHTML = SVG_CLOCK(20);
                    btn.title = 'Sleep Timer';
                    btn.classList.remove('active');
                    btn.style.color = '';
                }
            } else {
                btn.innerHTML = SVG_CLOCK(20);
                btn.title = 'Sleep Timer';
                btn.classList.remove('active');
                btn.style.color = '';
            }
        };

        updateBtn(timerBtn);
        updateBtn(timerBtnDesktop);
    }
}
