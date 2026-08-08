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
    formatQualityBadgeText,
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
    contentBlockingSettings,
    nativeOsAtmosSettings,
    crossfadeSettings,
} from './storage.js';
import { audioContextManager } from './audio-context.js';
import { isIos, isSafari, isEdge, canUseNativeAmazonCenc, getAmazonDecrypterCodec } from './platform-detection.js';
import { db } from './db.js';
import { getProxyUrl } from './proxy-utils.js';
import { waveformGenerator } from './waveform.js';

import { SVG_CLOCK, SVG_ATMOS, SVG_TRIANGLE_ALERT, SVG_PLAY, SVG_PAUSE } from './icons.js';
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
        const crossfadeAudio = document.createElement('audio');
        crossfadeAudio.id = 'audio-player-crossfade';
        crossfadeAudio.crossOrigin = 'anonymous';
        crossfadeAudio.preload = 'auto';
        crossfadeAudio.style.display = 'none';
        audioElement.insertAdjacentElement('afterend', crossfadeAudio);
        this.audioElements = [audioElement, crossfadeAudio];
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
        this.crossfadePreloadPlayer = null;
        this._pendingPreload = false;
        setInterval(this.checkPreloadConditions.bind(this), 2000);
        this.preloadAbortController = null;
        this.currentTrack = null;
        this.currentStreamProvider = null;
        this.safariSeekCorrectionSeconds = 0;
        this.seekSequence = 0;
        this.currentRgValues = null;
        this.userVolume = parseFloat(localStorage.getItem('volume') || '0.7');
        this.isFallbackRetry = false;
        this.isFallbackInProgress = false;
        this.autoplayBlocked = false;
        this.isLoadingTrack = false;
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
        const handleExactSeekRequest = (event) => {
            if (!Number.isFinite(Number(event.detail?.time))) return;
            event.preventDefault();
            void this.seekTo(event.detail.time, { resume: event.detail.resume === true });
        };
        this.audioElements.forEach((element) => element.addEventListener('exact-seek-request', handleExactSeekRequest));
        if (this.video) {
            this.video.addEventListener('exact-seek-request', handleExactSeekRequest);
        }

        // Apply audio effects when track is ready
        this.audioElements.forEach((element) => {
            element.addEventListener('canplay', () => {
                if (this.activeElement === element) this.applyAudioEffects();
            });
        });
        if (this.video) {
            this.video.addEventListener('canplay', () => {
                this.applyAudioEffects();
            });
        }

        this.shakaReady = this._initShaka();

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

        document.addEventListener('visibilitychange', async () => {
            const el = this.activeElement;
            if (document.visibilityState === 'hidden' && !el.paused) {
                void audioContextManager.resume();
            }
            if (document.visibilityState === 'visible' && !el.paused) {
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

    async _initShaka() {
        try {
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

            const shaka = await import('shaka-player');
            shaka.polyfill.installAll();
            if (!shaka.Player.isBrowserSupported()) {
                console.error('Browser not supported for Shaka Player');
                return;
            }

            this.shakaPlayer = new shaka.Player();
            this.configureShakaPlayer(this.shakaPlayer, shaka, { updateQualityBadge: true });

            this.shakaInitialized = false;

            setInterval(this.evaluateCrossCodecAbr.bind(this), 3000);
        } catch (e) {
            console.error('Shaka Player initialization failed:', e);
        }
    }

    configureShakaPlayer(shakaPlayer, shaka, { updateQualityBadge = false } = {}) {
        shakaPlayer.configure({
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
                useSourceElements: false,
            },
        });
        shakaPlayer.getNetworkingEngine()?.registerRequestFilter((type, request) => {
            if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT) {
                const uris = request.uris;
                for (let i = 0; i < uris.length; i++) {
                    if (uris[i].includes('tidal.com')) {
                        uris[i] = getProxyUrl(uris[i]);
                    }
                }
            }
        });
        if (updateQualityBadge) {
            shakaPlayer.addEventListener('adaptation', this.updateAdaptiveQualityBadge.bind(this));
            shakaPlayer.addEventListener('variantchanged', this.updateAdaptiveQualityBadge.bind(this));
        }
    }

    isCrossfadeShakaStream(streamInfo) {
        const streamUrl = String(streamInfo?.url || '');
        const playbackType = String(streamInfo?.playbackType || '').toLowerCase();
        const delivery = String(streamInfo?.delivery || '').toLowerCase();
        const mimeType = String(streamInfo?.mimeType || streamInfo?.mediaMimeType || '').toLowerCase();
        const isHls =
            playbackType === 'hls' || delivery === 'hls' || mimeType.includes('mpegurl') || streamUrl.includes('.m3u8');
        const isDash =
            !isHls &&
            (playbackType.includes('dash') ||
                delivery === 'dash' ||
                mimeType.includes('dash') ||
                streamUrl.startsWith('data:') ||
                streamUrl.includes('.mpd'));

        return (
            isDash ||
            playbackType.includes('cenc') ||
            (isHls && !isSafari && !isIos) ||
            (this.isNativeAmazonHlsDecryptionUrl(streamUrl) && !isSafari) ||
            (streamUrl.startsWith('blob:') && playbackType !== 'direct' && playbackType !== 'hls')
        );
    }

    async createCrossfadeShakaPlayer(element, streamInfo) {
        await this.shakaReady;
        const shaka = await import('shaka-player');
        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported()) {
            throw new Error('Shaka Player is not supported for crossfade playback');
        }

        const player = new shaka.Player();
        this.configureShakaPlayer(player, shaka);
        await player.attach(element);

        if (
            String(streamInfo.playbackType || '')
                .toLowerCase()
                .includes('cenc')
        ) {
            if (!streamInfo.keyId || !streamInfo.decryptionKey) {
                await player.destroy();
                throw new Error('Encrypted crossfade stream is missing its Clear Key');
            }
            player.configure({
                drm: {
                    clearKeys: {
                        [streamInfo.keyId]: streamInfo.decryptionKey,
                    },
                },
            });
        } else {
            player.configure({ drm: { clearKeys: {} } });
        }

        const shakaMimeType = String(streamInfo.playbackType || '')
            .toLowerCase()
            .includes('cenc')
            ? streamInfo.mimeType || null
            : this.isNativeAmazonHlsDecryptionUrl(streamInfo.url)
              ? 'application/vnd.apple.mpegurl'
              : null;
        try {
            await player.load(getProxyUrl(streamInfo.url), null, shakaMimeType);
            return player;
        } catch (error) {
            await player.destroy().catch(() => {});
            throw error;
        }
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

        this.audioElements.forEach((element) => {
            element.addEventListener('play', syncPlayPause);
            element.addEventListener('pause', syncPlayPause);
        });
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
        const effectiveVolume = this.getEffectiveVolume(this.currentRgValues);
        const el = this.activeElement;
        el.volume = effectiveVolume;
    }

    getEffectiveVolume(rgValues = null) {
        const mode = replayGainSettings.getMode(); // 'off', 'track', 'album'
        let gainDb = 0;
        let peak = 1.0;

        if (mode !== 'off' && rgValues) {
            const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude, programLoudnessLufs } =
                rgValues;

            if (mode === 'album' && typeof albumReplayGain === 'number' && albumReplayGain !== 0) {
                gainDb = albumReplayGain;
                peak = albumPeakAmplitude || 1.0;
            } else if (typeof trackReplayGain === 'number' && trackReplayGain !== 0) {
                gainDb = trackReplayGain;
                peak = trackPeakAmplitude || 1.0;
            } else if (typeof programLoudnessLufs === 'number') {
                gainDb = -18 - programLoudnessLufs;
                peak = trackPeakAmplitude || 1.0;
            } else {
                gainDb = trackReplayGain || 0;
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
        return Math.max(0, Math.min(1, curvedVolume * scale));
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
                            img.crossOrigin = 'anonymous';
                            img.referrerPolicy = 'no-referrer';
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
                    this.updateNowPlayingTitle(track);
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
                    void this.seekTo(details.seekTime);
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
            this.audio.addEventListener('playing', () => setHandlers().catch(() => {}), { once: true });
            if (this.video) {
                this.video.addEventListener('playing', () => setHandlers().catch(() => {}), { once: true });
            }
        } else {
            try {
                await setHandlers();
            } catch (e) {
                console.warn('MediaSession action handlers not registered:', e);
            }
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

        // Waveform-aware crossfades may need to preroll the next track through
        // a long quiet intro before the audible three-second overlap.
        const shouldPreload = duration > 0 && timeRemaining <= 45;

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

                const crossfadeStreamInfo = this.getCrossfadeStreamInfo(streamInfo);
                await this.prepareCrossfadeWaveform(track, crossfadeStreamInfo);
                this.preloadCache.set(track.id, crossfadeStreamInfo);
                const streamUrl = crossfadeStreamInfo.url;

                if (!this.canCrossfadeStream(track, crossfadeStreamInfo)) continue;

                // A second Shaka instance is required for real overlap. A preload
                // manager owned by the current player cannot decode into the
                // inactive media element while the current track is still playing.
                if (crossfadeSettings.isEnabled() && this.isCrossfadeShakaStream(crossfadeStreamInfo)) {
                    const preloader = this.audioElements.find((element) => element !== this.activeElement);
                    if (preloader) {
                        preloader.pause();
                        preloader.removeAttribute('src');
                        preloader.load();
                        try {
                            if (this.crossfadePreloadPlayer && this.crossfadePreloadPlayer !== this.shakaPlayer) {
                                await this.crossfadePreloadPlayer.destroy().catch(() => {});
                                this.crossfadePreloadPlayer = null;
                            }
                            const crossfadeShakaPlayer = await this.createCrossfadeShakaPlayer(
                                preloader,
                                crossfadeStreamInfo
                            );
                            if (this.preloadAbortController.signal.aborted) {
                                await crossfadeShakaPlayer.destroy().catch(() => {});
                                break;
                            }
                            this.crossfadePreloadPlayer = crossfadeShakaPlayer;
                            crossfadeStreamInfo.crossfadeShakaPlayer = crossfadeShakaPlayer;
                            crossfadeStreamInfo.preloader = preloader;
                        } catch (error) {
                            console.warn('Unable to preload the next adaptive stream for crossfade:', error);
                        }
                    }
                    continue;
                }

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
                        // Prime the actual handoff element. A throwaway Audio would consume a
                        // signed URL (or duplicate work in the decrypter service worker) and then
                        // force the transition to request the same stream again.
                        const preloader = this.audioElements.find((element) => element !== this.activeElement);
                        if (preloader) {
                            preloader.pause();
                            preloader.removeAttribute('src');
                            preloader.load();
                            preloader.preload = 'auto';
                            preloader.src = getProxyUrl(streamUrl);
                            preloader.load();
                            crossfadeStreamInfo.preloader = preloader;
                            crossfadeStreamInfo.preloadedUrl = preloader.src;
                        }
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    shouldFetchMoreArtistPopularTracks(currentQueue = this.getCurrentQueue()) {
        return (
            !this.radioEnabled &&
            this.artistPopularTracksState.artistId &&
            this.artistPopularTracksState.hasMore &&
            !this.artistPopularTracksState.isFetching &&
            this.currentQueueIndex >= currentQueue.length - 1
        );
    }

    async fetchMoreArtistPopularTracksForPlayback(currentQueue = this.getCurrentQueue()) {
        if (!this.shouldFetchMoreArtistPopularTracks(currentQueue)) {
            return;
        }

        const newTracks = await this.fetchMoreArtistPopularTracks();
        if (newTracks && newTracks.length > 0) {
            await this.addToQueue(newTracks);
        }
    }

    backfillReplayGainFromTrack(_track, _currentSequence) {}

    shouldUseNativeAmazonDecrypter() {
        return !canUseNativeAmazonCenc;
    }

    getAmazonNativeDecrypterCodec(streamInfo = null) {
        const resourceCodec = String(streamInfo?.codec || '').toLowerCase();
        if (resourceCodec === 'opus') return 'opus';
        if (resourceCodec === 'aac' || resourceCodec.startsWith('mp4a')) return 'mp4a';
        return getAmazonDecrypterCodec(this.quality);
    }

    isNativeAmazonHlsDecryptionUrl(url) {
        if (!url || !url.includes('/api/decrypt-stream')) return false;

        try {
            const parsed = new URL(url, window.location.origin);
            return parsed.searchParams.get('codec') === 'flac-hls';
        } catch {
            return url.includes('codec=flac-hls');
        }
    }

    getNativeAmazonDecryptionUrl(streamInfo, streamUrl) {
        if (!this.shouldUseNativeAmazonDecrypter()) return null;
        if (!streamInfo || streamInfo.provider !== 'amazon' || !streamInfo.decryptionKey || !streamUrl) return null;
        if (streamUrl.includes('/api/decrypt-stream')) return null;

        const sourceUrl = streamInfo.sourceUrl || streamUrl;
        if (!sourceUrl || sourceUrl.startsWith('blob:') || sourceUrl.includes('.mpd')) return null;

        const params = new URLSearchParams();
        params.set('url', sourceUrl);
        params.set('key', streamInfo.decryptionKey);
        params.set('codec', this.getAmazonNativeDecrypterCodec(streamInfo));

        console.warn('[Amazon SW Decrypter] Player rescued raw Amazon stream URL');
        return `${window.location.protocol}//${window.location.host}/api/decrypt-stream?${params.toString()}`;
    }

    async teardownShakaForNativePlayback() {
        if (!this.shakaInitialized || !this.shakaPlayer) return;

        try {
            await this.shakaPlayer.unload();
        } catch (error) {
            console.warn('Failed to unload Shaka before native playback:', error);
        }

        try {
            if (typeof this.shakaPlayer.detach === 'function') {
                await this.shakaPlayer.detach();
            }
        } catch (error) {
            console.warn('Failed to detach Shaka before native playback:', error);
        } finally {
            this.shakaInitialized = false;
        }
    }

    async prepareNativePlayback(element, streamUrl, { singleUse = false } = {}) {
        await this.teardownShakaForNativePlayback();

        element.pause();
        element.removeAttribute('src');
        element.load();
        element.preload = singleUse ? 'none' : 'auto';
        element.src = getProxyUrl(streamUrl);
        // Safari needs an explicit load after replacing a failed MSE/Shaka source.
        element.load();
    }

    tryStartPreloadedTrackImmediately({
        track,
        activeElement,
        previousActiveElement,
        currentSequence,
        startTime = 0,
        recursiveCount = 0,
    }) {
        const cachedStreamInfo = this.preloadCache.get(track.id);
        const rescuedStreamUrl = this.getNativeAmazonDecryptionUrl(cachedStreamInfo, cachedStreamInfo?.url);
        const streamInfo = rescuedStreamUrl
            ? { ...cachedStreamInfo, url: rescuedStreamUrl, playbackType: [], preloadManager: null, preloader: null }
            : cachedStreamInfo;
        const streamUrl = streamInfo?.url;
        const canReuseAudioElement = previousActiveElement === this.audio && activeElement === this.audio;

        if (!canReuseAudioElement || !streamUrl) {
            return false;
        }

        this.currentStreamInfo = streamInfo;

        const isHlsManifest =
            streamInfo.playbackType === 'hls' ||
            streamInfo.delivery === 'hls' ||
            streamInfo.mimeType?.includes('mpegurl') ||
            (typeof streamUrl === 'string' && streamUrl.includes('.m3u8'));

        const isDashManifest =
            !isHlsManifest &&
            (streamInfo.playbackType === 'dash' ||
                streamInfo.playbackType === 'dash-cenc' ||
                streamInfo.delivery === 'dash' ||
                streamInfo.mimeType?.includes('dash') ||
                (typeof streamUrl === 'string' && (streamUrl.startsWith('data:') || streamUrl.includes('.mpd'))));

        const requiresShaka =
            !track.isLocal &&
            (isDashManifest ||
                streamInfo.playbackType?.includes('cenc') ||
                (streamUrl.startsWith('blob:') &&
                    streamInfo.playbackType !== 'direct' &&
                    streamInfo.playbackType !== 'hls') ||
                (isHlsManifest && !isSafari && !isIos) ||
                (this.isNativeAmazonHlsDecryptionUrl(streamUrl) && !isSafari));
        if (requiresShaka && (!this.shakaPlayer || this.shakaPlayer.getMediaElement() !== activeElement)) {
            return false;
        }

        if (streamInfo.rgInfo) {
            this.currentRgValues = streamInfo.rgInfo;
            this.applyReplayGain();
        } else if (streamInfo.rgInfoFallback) {
            this.currentRgValues = streamInfo.rgInfoFallback;
            this.applyReplayGain();
        } else {
            this.currentRgValues = null;
            this.applyReplayGain();
            this.backfillReplayGainFromTrack(track, currentSequence);
        }

        const deezerHiResFallback =
            streamInfo.provider === 'deezer' &&
            (streamInfo.deezerHiRes || deriveTrackQuality(track) === 'HI_RES_LOSSLESS');
        track.deezerHiResFallback = deezerHiResFallback;
        if (this.currentTrack?.id === track.id) {
            this.currentTrack.deezerHiResFallback = deezerHiResFallback;
        }
        if (deezerHiResFallback) {
            this.updateNowPlayingTitle(track);
        }

        const retryImmediateHandoff = async (error) => {
            if (this.playbackSequence !== currentSequence || this.currentTrack?.id !== track.id) {
                return;
            }

            console.error('Immediate preloaded handoff failed:', error);
            await this.playTrackFromQueue(startTime, recursiveCount, false);
        };

        const skipPlay = Symbol('skip-immediate-play');
        let handoffPromise = Promise.resolve();

        if (requiresShaka) {
            const loadTarget = streamInfo.preloadManager || streamUrl;
            if (streamInfo.playbackType?.includes('cenc')) {
                this.shakaPlayer.configure({
                    drm: {
                        clearKeys: {
                            [streamInfo.keyId]: streamInfo.decryptionKey,
                        },
                    },
                });
            } else {
                this.shakaPlayer.configure({ drm: { clearKeys: {} } });
            }
            const shakaMimeType = streamInfo.playbackType?.includes('cenc')
                ? streamInfo.mimeType || null
                : this.isNativeAmazonHlsDecryptionUrl(streamUrl)
                  ? 'application/vnd.apple.mpegurl'
                  : null;
            handoffPromise =
                startTime > 0
                    ? this.shakaPlayer.load(loadTarget, startTime, shakaMimeType)
                    : this.shakaPlayer.load(loadTarget, null, shakaMimeType);
            this.shakaInitialized = true;

            handoffPromise = handoffPromise.then(() => {
                if (this.playbackSequence !== currentSequence || this.currentTrack?.id !== track.id) {
                    return skipPlay;
                }

                this.applyAudioEffects();
                const savedAdaptiveQuality = localStorage.getItem('adaptive-playback-quality') || 'auto';
                this.forceQuality(savedAdaptiveQuality);
                this.updateAdaptiveQualityBadge();

                return this.safePlay(activeElement);
            });
        } else {
            activeElement.src = streamUrl;
            this.applyAudioEffects();
            this.updateAdaptiveQualityBadge();

            if (startTime > 0) {
                activeElement.currentTime = startTime;
            }
            handoffPromise = this.safePlay(activeElement);
        }

        void handoffPromise
            .then((played) => {
                if (played === skipPlay) {
                    return;
                }

                if (!played) {
                    return retryImmediateHandoff(new Error('Immediate handoff did not start playback')).catch(
                        console.error
                    );
                }

                if (this.playbackSequence !== currentSequence || this.currentTrack?.id !== track.id) {
                    return;
                }

                this.preloadNextTracks();
            })
            .catch((error) => retryImmediateHandoff(error).catch(console.error));

        return true;
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

    async playTrackFromQueue(startTime = 0, recursiveCount = 0, isRetry = false, options = {}) {
        await this.shakaReady;
        const { preserveGestureToken = false, preparedPlayback = null } = options;
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

        if (contentBlockingSettings.shouldHideTrack(track)) {
            console.warn(`Attempted to play blocked track: ${track.title}. Skipping...`);
            await this.playNext();
            return;
        }

        this.setLoadingState(true);
        this.resetProgressUI();

        const previousActiveElement = preparedPlayback?.previousElement || this.activeElement;
        const shouldPreserveGestureToken =
            preserveGestureToken && previousActiveElement === this.audio && track.type !== 'video';

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

        if (this.shouldFetchMoreArtistPopularTracks(currentQueue)) {
            if (shouldPreserveGestureToken) {
                void this.fetchMoreArtistPopularTracksForPlayback(currentQueue).catch(console.error);
            } else {
                await this.fetchMoreArtistPopularTracksForPlayback(currentQueue);
            }
        }

        if (shouldPreserveGestureToken) {
            void this.saveQueueState().catch(console.error);
        } else {
            await this.saveQueueState();
        }

        this.currentTrack = track;
        this.currentStreamProvider = null;
        this.safariSeekCorrectionSeconds = 0;
        this.seekSequence += 1;
        this.addToRecentlyPlayed(track.id);
        const trackTitle = getTrackTitle(track);
        const artistName = getTrackArtists(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);
        const yearDisplay = getTrackYearDisplay(track);

        if (!track.videoUrl && !track.videoCoverUrl && !track.album?.videoCoverUrl) {
            this.api.getVideoArtwork(trackTitle, artistName).then((result) => {
                if (this.currentTrack?.id === track.id && result && (result.videoUrl || result.hlsUrl)) {
                    track.videoCoverUrl = result.videoUrl || result.hlsUrl;
                    void this.updateVideoCovers(track.videoCoverUrl);

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
        const activeElement = preparedPlayback?.element || (isVideoTrack ? this.video : this.audio);
        if (preparedPlayback && !isVideoTrack) {
            this.audio = activeElement;
            this.syncDurationUI(
                activeElement,
                track.duration ?? preparedPlayback.streamInfo?.waveform?.duration_ms ?? null
            );
        }
        const inactiveElement = isVideoTrack ? this.audio : this.video;
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // Retain the initialized Shaka player if we are remaining on the same HTMLMediaElement
        if (this.shakaInitialized && this.shakaPlayer) {
            if (this.shakaPlayer.getMediaElement() !== activeElement) {
                await this.teardownShakaForNativePlayback();
            }
        }

        if (inactiveElement) {
            inactiveElement.pause();
            inactiveElement.src = '';
            inactiveElement.removeAttribute('src');
            inactiveElement.load();
            inactiveElement.style.display = 'none';
            if (inactiveElement.parentElement !== document.body) {
                document.body.appendChild(inactiveElement);
            }
        }

        if (activeElement && !preparedPlayback) {
            activeElement.pause();
            // Let Shaka overwrite the activeElement's decoder pipeline gracefully if we're carrying it over.
            // It manages its own buffering teardown implicitly when `load()` is executed.
            if (!this.shakaInitialized) {
                activeElement.src = '';
                activeElement.removeAttribute('src');
                activeElement.load();
            }
        }

        audioContextManager.changeSource(activeElement);
        preparedPlayback?.crossfadeOutput?.disconnect();

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
                    void this.updateVideoCovers(videoCoverUrl);
                } else {
                    let imgEl = coverEl;
                    if (coverEl.tagName === 'VIDEO') {
                        imgEl = document.createElement('img');
                        imgEl.crossOrigin = 'anonymous';
                        imgEl.referrerPolicy = 'no-referrer';
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
        this.updateNowPlayingTitle(track);
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
                if (
                    shouldPreserveGestureToken &&
                    this.tryStartPreloadedTrackImmediately({
                        track,
                        activeElement,
                        previousActiveElement,
                        currentSequence,
                        startTime,
                        recursiveCount,
                    })
                ) {
                    return;
                }

                // Tidal: Try to get ReplayGain from manifest first, supplement with track info if needed
                const streamInfoPromise = preparedPlayback?.streamInfo
                    ? Promise.resolve(preparedPlayback.streamInfo)
                    : this.preloadCache.has(track.id)
                      ? Promise.resolve(this.preloadCache.get(track.id))
                      : this.api.getStreamUrl(track.id, this.quality);

                // We only need the legacy track info if we missed getting ReplayGain from the manifest endpoint
                let resolvedStreamInfo = await streamInfoPromise;
                if (this.playbackSequence !== currentSequence) return;

                const rescuedStreamUrl = preparedPlayback
                    ? null
                    : this.getNativeAmazonDecryptionUrl(resolvedStreamInfo, resolvedStreamInfo.url);
                if (rescuedStreamUrl) {
                    resolvedStreamInfo = {
                        ...resolvedStreamInfo,
                        url: rescuedStreamUrl,
                        playbackType: [],
                        preloadManager: null,
                        preloader: null,
                    };
                }

                streamUrl = resolvedStreamInfo.url;
                this.currentStreamInfo = resolvedStreamInfo;
                this.currentStreamProvider = resolvedStreamInfo.provider || null;
                track.playbackQualityInfo = {
                    codec: resolvedStreamInfo.codec,
                    quality: resolvedStreamInfo.quality,
                    lossless: resolvedStreamInfo.lossless,
                    bitDepth: resolvedStreamInfo.bitDepth,
                    sampleRateHz: resolvedStreamInfo.sampleRateHz || resolvedStreamInfo.sampleRate,
                    bitrateKbps: resolvedStreamInfo.bitrateKbps,
                };
                if (resolvedStreamInfo.provider === 'amazon' && resolvedStreamInfo.quality) {
                    track.amazonMusicQualitySelected = resolvedStreamInfo.quality;
                    track.amazonMusicQualityDisplay = resolvedStreamInfo.qualityDisplay;
                    if (this.currentTrack?.id === track.id) {
                        this.currentTrack.amazonMusicQualitySelected = resolvedStreamInfo.quality;
                        this.currentTrack.amazonMusicQualityDisplay = resolvedStreamInfo.qualityDisplay;
                    }
                    this.updateNowPlayingTitle(track);
                }

                const deezerHiResFallback =
                    resolvedStreamInfo.provider === 'deezer' &&
                    (resolvedStreamInfo.deezerHiRes || deriveTrackQuality(track) === 'HI_RES_LOSSLESS');
                track.deezerHiResFallback = deezerHiResFallback;
                if (this.currentTrack?.id === track.id) {
                    this.currentTrack.deezerHiResFallback = deezerHiResFallback;
                }
                if (deezerHiResFallback) {
                    this.updateNowPlayingTitle(track);
                }

                this.updateNowPlayingTitle(track);
                this.updateAdaptiveQualityBadge();

                this.currentWaveform = resolvedStreamInfo.waveform || null;
                this.currentSilenceBoundaries = null;
                this._skippedLeadingSilence = false;
                this._crossfadingTrack = false;
                this._crossfadeUnavailable = false;
                window.dispatchEvent(new CustomEvent('waveform-update'));

                if (resolvedStreamInfo.rgInfo) {
                    this.currentRgValues = resolvedStreamInfo.rgInfo;
                } else if (resolvedStreamInfo.rgInfoFallback) {
                    this.currentRgValues = resolvedStreamInfo.rgInfoFallback;
                } else {
                    this.currentRgValues = null;
                }
                this.applyReplayGain();

                if (this.playbackSequence !== currentSequence) return;

                const isHlsManifest =
                    resolvedStreamInfo.playbackType === 'hls' ||
                    resolvedStreamInfo.delivery === 'hls' ||
                    resolvedStreamInfo.mimeType?.includes('mpegurl') ||
                    (typeof streamUrl === 'string' && streamUrl.includes('.m3u8'));

                const isDashManifest =
                    !isHlsManifest &&
                    (resolvedStreamInfo.playbackType === 'dash' ||
                        resolvedStreamInfo.playbackType === 'dash-cenc' ||
                        resolvedStreamInfo.delivery === 'dash' ||
                        resolvedStreamInfo.mimeType?.includes('dash') ||
                        (typeof streamUrl === 'string' &&
                            (streamUrl.startsWith('data:') || streamUrl.includes('.mpd'))));

                const shouldUseShaka =
                    streamUrl &&
                    !track.isLocal &&
                    (isDashManifest ||
                        resolvedStreamInfo.playbackType?.includes('cenc') ||
                        (isHlsManifest && !isSafari && !isIos) ||
                        (this.isNativeAmazonHlsDecryptionUrl(streamUrl) && !isSafari) ||
                        (streamUrl.startsWith('blob:') &&
                            resolvedStreamInfo.playbackType !== 'direct' &&
                            resolvedStreamInfo.playbackType !== 'hls'));

                if (preparedPlayback) {
                    this.applyAudioEffects();
                    this.updateAdaptiveQualityBadge();
                    if (activeElement.paused) {
                        const played = await this.safePlay(activeElement);
                        if (!played) return;
                    } else {
                        activeElement.dispatchEvent(new Event('play'));
                    }
                } else if (shouldUseShaka) {
                    // It's likely a DASH manifest URL
                    if (this.shakaPlayer.getMediaElement() !== activeElement) {
                        await this.shakaPlayer.attach(activeElement);
                        this.shakaInitialized = true;
                    }

                    const loadTarget = resolvedStreamInfo.preloadManager || streamUrl;
                    if (resolvedStreamInfo.playbackType?.includes('cenc')) {
                        this.shakaPlayer.configure({
                            drm: {
                                clearKeys: {
                                    [resolvedStreamInfo.keyId]: resolvedStreamInfo.decryptionKey,
                                },
                            },
                        });
                    } else {
                        this.shakaPlayer.configure({ drm: { clearKeys: {} } });
                    }
                    const shakaMimeType = resolvedStreamInfo.playbackType?.includes('cenc')
                        ? resolvedStreamInfo.mimeType || null
                        : this.isNativeAmazonHlsDecryptionUrl(streamUrl)
                          ? 'application/vnd.apple.mpegurl'
                          : null;

                    try {
                        if (startTime > 0) {
                            await this.shakaPlayer.load(getProxyUrl(loadTarget), startTime, shakaMimeType);
                        } else {
                            await this.shakaPlayer.load(getProxyUrl(loadTarget), null, shakaMimeType);
                        }
                    } catch (e) {
                        console.error('PreloadManager load Error:', e);
                        if (loadTarget !== streamUrl)
                            await this.shakaPlayer.load(getProxyUrl(streamUrl), null, shakaMimeType);
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
                    await this.prepareNativePlayback(activeElement, streamUrl, {
                        singleUse: resolvedStreamInfo.provider === 'monochrome',
                    });
                    if (this.playbackSequence !== currentSequence) return;
                    this.applyAudioEffects();
                    this.updateAdaptiveQualityBadge();

                    if (startTime > 0) {
                        await this.seekTo(startTime);
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
        } finally {
            if (this.playbackSequence === currentSequence) {
                this.setLoadingState(false);
            }
        }
    }

    setLoadingState(isLoading) {
        this.isLoadingTrack = isLoading;
        const playPauseBtn = document.querySelector('.now-playing-bar .play-pause-btn');
        const SPINNER_20 =
            '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
        const SPINNER_32 =
            '<svg class="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
        if (isLoading) {
            if (playPauseBtn) playPauseBtn.innerHTML = SPINNER_20;
            const fsBtn = document.getElementById('fs-play-pause-btn');
            if (fsBtn) fsBtn.innerHTML = SPINNER_32;
        } else {
            const isPaused = this.activeElement?.paused ?? true;
            if (playPauseBtn) playPauseBtn.innerHTML = isPaused ? SVG_PLAY(20) : SVG_PAUSE(20);
        }
    }

    resetProgressUI() {
        document.querySelectorAll('#progress-fill, #fs-progress-fill').forEach((el) => (el.style.width = '0%'));
        document.querySelectorAll('#current-time, #fs-current-time').forEach((el) => (el.textContent = '0:00'));
        document.querySelectorAll('#total-duration, #fs-total-duration').forEach((el) => (el.textContent = '0:00'));
        document.querySelectorAll('#progress-bar, #fs-progress-bar').forEach((el) => {
            el.style.webkitMaskImage = '';
            el.style.maskImage = '';
            el.style.removeProperty('--waveform-mask-image');
            el.style.removeProperty('--waveform-mask-width');
            el.style.removeProperty('--waveform-geometry-width');
            el.querySelectorAll('.waveform-image, .waveform-geometry').forEach((element) => element.remove());
            el.classList.remove('has-waveform', 'waveform-loaded');
        });
    }

    syncDurationUI(element = this.activeElement, fallbackDuration = this.currentTrack?.duration) {
        let duration = Number(element?.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
            duration = Number(fallbackDuration);
            if (duration > 10000) duration /= 1000;
        }
        if (!Number.isFinite(duration) || duration <= 0) return false;

        document
            .querySelectorAll('#total-duration, #fs-total-duration')
            .forEach((durationElement) => (durationElement.textContent = formatTime(duration)));
        return true;
    }

    async playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            await this.playTrackFromQueue(0, 0);
        }
    }

    getNextCrossfadeCandidate() {
        const currentQueue = this.getCurrentQueue();
        if (currentQueue.length < 2 || this.repeatMode === REPEAT_MODE.ONE) return null;

        let index = this.currentQueueIndex + 1;
        if (index >= currentQueue.length) {
            if (this.repeatMode !== REPEAT_MODE.ALL) return null;
            index = 0;
        }

        for (let checked = 0; checked < currentQueue.length; checked++) {
            const track = currentQueue[index];
            if (track && !track.isUnavailable && !contentBlockingSettings.shouldHideTrack(track)) {
                return { index, track };
            }
            index = (index + 1) % currentQueue.length;
        }
        return null;
    }

    getNextCrossfadeLeadingSilenceSeconds() {
        const candidate = this.getNextCrossfadeCandidate();
        if (!candidate) return 0;
        return Math.max(
            0,
            Number(this.preloadCache.get(candidate.track.id)?.crossfadeSilenceBoundaries?.leadingSilenceSeconds || 0)
        );
    }

    getCrossfadeStreamInfo(streamInfo) {
        if (!streamInfo || streamInfo.provider !== 'amazon' || !streamInfo.decryptionKey) return streamInfo;
        // Chrome can overlap the original DASH/CENC stream with a second Shaka
        // player. Converting it to a service-worker URL here leaves a plain
        // <audio> element trying to decode fragmented encrypted MP4 instead.
        if (this.isCrossfadeShakaStream(streamInfo)) return streamInfo;
        if (String(streamInfo.url || '').includes('/api/decrypt-stream')) {
            const targetCodec = new URL(streamInfo.url, window.location.origin).searchParams.get('codec');
            return {
                ...streamInfo,
                playbackType: 'direct',
                mimeType:
                    targetCodec === 'flac-hls'
                        ? 'application/vnd.apple.mpegurl'
                        : streamInfo.mediaMimeType || 'audio/mp4',
            };
        }

        const sourceUrl = streamInfo.sourceUrl;
        if (!sourceUrl || !this.hasControllingServiceWorker()) return streamInfo;

        const params = new URLSearchParams();
        params.set('url', sourceUrl);
        params.set('key', streamInfo.decryptionKey);
        const targetCodec = this.getAmazonNativeDecrypterCodec(streamInfo);
        params.set('codec', targetCodec);

        return {
            ...streamInfo,
            url: `${window.location.protocol}//${window.location.host}/api/decrypt-stream?${params.toString()}`,
            playbackType: 'direct',
            mimeType:
                targetCodec === 'flac-hls' ? 'application/vnd.apple.mpegurl' : streamInfo.mediaMimeType || 'audio/mp4',
            preloadManager: null,
            preloader: null,
        };
    }

    hasControllingServiceWorker() {
        return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
    }

    async prepareCrossfadeWaveform(track, streamInfo) {
        if (!track || !streamInfo) return null;
        if (streamInfo.crossfadeSilenceBoundaries) return streamInfo.crossfadeSilenceBoundaries;

        const waveform = streamInfo.waveform || track.waveform || null;
        const waveData = await waveformGenerator.loadWaveformData(waveform, track.id);
        let samples = waveData?.samples || null;
        if (!samples?.length && waveData?.pngUrl) {
            samples = await waveformGenerator.loadWaveformPngSamples(waveData.pngUrl);
        }
        if (!samples?.length) return null;

        let duration = Number(waveData.durationSeconds || track.duration || 0);
        if (duration > 10000) duration /= 1000;
        if (!Number.isFinite(duration) || duration <= 0) return null;

        const boundaries = waveformGenerator.getSilenceBoundaries(samples, duration);
        streamInfo.crossfadeSilenceBoundaries = boundaries;
        return boundaries;
    }

    canCrossfadeStream(track, streamInfo) {
        if (!track || track.type === 'video' || track.isLocal || track.isTracker || track.isPodcast) return false;
        const streamUrl = streamInfo?.url;
        if (!streamUrl || typeof streamUrl !== 'string') return false;

        const playbackType = String(streamInfo.playbackType || '').toLowerCase();
        const mimeType = String(streamInfo.mimeType || streamInfo.mediaMimeType || '').toLowerCase();
        const isServiceWorkerStream = streamUrl.includes('/api/decrypt-stream');
        if (isServiceWorkerStream) {
            const targetCodec = new URL(streamUrl, window.location.origin).searchParams.get('codec');
            return targetCodec !== 'flac-hls' || isSafari || isIos || this.isCrossfadeShakaStream(streamInfo);
        }
        if (this.isCrossfadeShakaStream(streamInfo)) return true;
        return !(
            playbackType.includes('dash') ||
            playbackType.includes('hls') ||
            playbackType.includes('cenc') ||
            mimeType.includes('dash') ||
            mimeType.includes('mpegurl') ||
            streamUrl.includes('.mpd') ||
            streamUrl.includes('.m3u8') ||
            (streamInfo.decryptionKey && !streamUrl.includes('/api/decrypt-stream'))
        );
    }

    async crossfadeToNext(durationSeconds = 5, options = {}) {
        if (this._crossfadePromise) return this._crossfadePromise;
        const { removeSilence = false, fadeStartTime: requestedFadeStartTime = null } = options;

        this._crossfadePromise = (async () => {
            const candidate = this.getNextCrossfadeCandidate();
            const oldElement = this.activeElement;
            if (!candidate || oldElement !== this.audio || oldElement.paused) return false;

            const nextElement = this.audioElements.find((element) => element !== oldElement);
            if (!nextElement) return false;

            let streamInfo;
            try {
                streamInfo =
                    this.preloadCache.get(candidate.track.id) ||
                    (await this.api.getStreamUrl(candidate.track.id, this.quality));
            } catch {
                return false;
            }
            streamInfo = this.getCrossfadeStreamInfo(streamInfo);
            await this.prepareCrossfadeWaveform(candidate.track, streamInfo);
            if (!this.canCrossfadeStream(candidate.track, streamInfo)) return false;

            const sequence = this.playbackSequence;
            const nextVolume = this.getEffectiveVolume(streamInfo.rgInfo || streamInfo.rgInfoFallback || null);
            const oldOutputGainNode = audioContextManager.volumeNode?.gain;
            if (!oldOutputGainNode) return false;
            const oldOutputGain = oldOutputGainNode.value;
            let crossfadeOutput = null;
            let nextShakaPlayer = null;
            let previousShakaPlayer = null;
            let adoptedShakaPlayer = false;

            try {
                nextElement.pause();
                nextElement.volume = nextVolume;
                nextElement.playbackRate = oldElement.playbackRate;
                nextElement.preservesPitch = oldElement.preservesPitch;

                if (this.isCrossfadeShakaStream(streamInfo)) {
                    const preloadedPlayer = streamInfo.crossfadeShakaPlayer;
                    const hasPreparedShakaPlayer =
                        preloadedPlayer &&
                        streamInfo.preloader === nextElement &&
                        preloadedPlayer.getMediaElement?.() === nextElement;
                    if (hasPreparedShakaPlayer) {
                        nextShakaPlayer = preloadedPlayer;
                    } else {
                        if (preloadedPlayer) await preloadedPlayer.destroy().catch(() => {});
                        nextElement.removeAttribute('src');
                        nextElement.load();
                        nextShakaPlayer = await this.createCrossfadeShakaPlayer(nextElement, streamInfo);
                        streamInfo.crossfadeShakaPlayer = nextShakaPlayer;
                        streamInfo.preloader = nextElement;
                    }
                } else {
                    const targetUrl = getProxyUrl(streamInfo.url);
                    const alreadyPreloaded =
                        streamInfo.preloader === nextElement &&
                        (streamInfo.preloadedUrl === nextElement.src || targetUrl === nextElement.src);
                    if (!alreadyPreloaded) {
                        nextElement.removeAttribute('src');
                        nextElement.load();
                        nextElement.preload = 'auto';
                        nextElement.src = targetUrl;
                        nextElement.load();
                    }
                }

                const canPlay = await this.waitForCanPlayOrTimeout(nextElement, 10000);
                if (!canPlay || this.playbackSequence !== sequence) return false;

                crossfadeOutput = audioContextManager.createCrossfadeOutput(nextElement);
                if (!crossfadeOutput) return false;

                await nextElement.play();
                const leadingSilenceSeconds = removeSilence
                    ? Math.max(0, Number(streamInfo.crossfadeSilenceBoundaries?.leadingSilenceSeconds || 0))
                    : 0;
                const fallbackFadeEnd =
                    removeSilence && this.currentSilenceBoundaries?.hasTrailingSilence
                        ? this.currentSilenceBoundaries.trailingSilenceStartTime
                        : oldElement.duration;
                const fadeStartTime = Number.isFinite(Number(requestedFadeStartTime))
                    ? Number(requestedFadeStartTime)
                    : Math.max(0, fallbackFadeEnd - (Number(durationSeconds) || 5));
                while (
                    this.playbackSequence === sequence &&
                    (oldElement.currentTime < fadeStartTime || nextElement.currentTime < leadingSilenceSeconds)
                ) {
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                if (this.playbackSequence !== sequence) return false;

                const fadeDurationSeconds = Math.max(1, Math.min(12, Number(durationSeconds) || 5));
                const durationMs = fadeDurationSeconds * 1000;
                const audioContext = audioContextManager.audioContext;
                const canScheduleFade =
                    audioContext &&
                    typeof oldOutputGainNode.setValueCurveAtTime === 'function' &&
                    typeof crossfadeOutput.gainNode.gain.setValueCurveAtTime === 'function';

                if (canScheduleFade) {
                    const pointCount = 128;
                    const oldCurve = new Float32Array(pointCount);
                    const nextCurve = new Float32Array(pointCount);
                    for (let i = 0; i < pointCount; i++) {
                        const progress = i / (pointCount - 1);
                        oldCurve[i] = oldOutputGain * Math.cos((progress * Math.PI) / 2);
                        nextCurve[i] = Math.sin((progress * Math.PI) / 2);
                    }
                    const startAt = audioContext.currentTime;
                    oldOutputGainNode.cancelScheduledValues(startAt);
                    crossfadeOutput.gainNode.gain.cancelScheduledValues(startAt);
                    oldOutputGainNode.value = oldOutputGain;
                    crossfadeOutput.gainNode.gain.value = 0;
                    oldOutputGainNode.setValueCurveAtTime(oldCurve, startAt, fadeDurationSeconds);
                    crossfadeOutput.gainNode.gain.setValueCurveAtTime(nextCurve, startAt, fadeDurationSeconds);
                    await new Promise((resolve) => setTimeout(resolve, durationMs));
                } else {
                    const startedAt = performance.now();
                    while (this.playbackSequence === sequence) {
                        const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
                        oldOutputGainNode.value = oldOutputGain * Math.cos((progress * Math.PI) / 2);
                        crossfadeOutput.gainNode.gain.value = Math.sin((progress * Math.PI) / 2);
                        if (progress >= 1) break;
                        await new Promise((resolve) => setTimeout(resolve, 16));
                    }
                }

                if (this.playbackSequence !== sequence) return false;
                const resetAt = audioContextManager.audioContext?.currentTime || 0;
                oldOutputGainNode.cancelScheduledValues?.(resetAt);
                oldOutputGainNode.value = oldOutputGain;
                oldElement.pause();
                this.currentQueueIndex = candidate.index;

                if (nextShakaPlayer) {
                    previousShakaPlayer = this.shakaPlayer;
                    this.shakaPlayer = nextShakaPlayer;
                    this.shakaInitialized = true;
                    adoptedShakaPlayer = true;
                    this.crossfadePreloadPlayer = null;
                    streamInfo.crossfadeShakaPlayer = null;
                    streamInfo.preloader = null;
                    nextShakaPlayer.addEventListener('adaptation', this.updateAdaptiveQualityBadge.bind(this));
                    nextShakaPlayer.addEventListener('variantchanged', this.updateAdaptiveQualityBadge.bind(this));
                }

                await this.playTrackFromQueue(0, 0, false, {
                    preserveGestureToken: true,
                    preparedPlayback: {
                        element: nextElement,
                        previousElement: oldElement,
                        streamInfo,
                        crossfadeOutput,
                    },
                });
                if (previousShakaPlayer && previousShakaPlayer !== this.shakaPlayer) {
                    await previousShakaPlayer.destroy().catch((error) => {
                        console.warn('Unable to release the previous adaptive player after crossfade:', error);
                    });
                    previousShakaPlayer = null;
                }
                this.preloadCache.delete(candidate.track.id);
                crossfadeOutput = null;
                return this.audio === nextElement && !nextElement.paused;
            } catch (error) {
                console.warn('Crossfade failed, falling back to silence skip:', error);
                return false;
            } finally {
                if (crossfadeOutput) crossfadeOutput.disconnect();
                if (nextShakaPlayer && !adoptedShakaPlayer) {
                    await nextShakaPlayer.destroy().catch(() => {});
                    if (this.crossfadePreloadPlayer === nextShakaPlayer) {
                        this.crossfadePreloadPlayer = null;
                    }
                    if (streamInfo?.crossfadeShakaPlayer === nextShakaPlayer) {
                        streamInfo.crossfadeShakaPlayer = null;
                        streamInfo.preloader = null;
                    }
                }
                if (this.audio !== nextElement) {
                    nextElement.pause();
                    nextElement.removeAttribute('src');
                    nextElement.load();
                }
                oldOutputGainNode.value = oldOutputGain;
            }
        })();

        try {
            return await this._crossfadePromise;
        } finally {
            this._crossfadePromise = null;
        }
    }

    async playNext(recursiveCount = 0, options = {}) {
        try {
            const currentQueue = this.getCurrentQueue();
            const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;

            if (recursiveCount > currentQueue.length) {
                if (this.radioEnabled && isLastTrack) {
                    this.fetchRadioRecommendations().then(async () => {
                        const updatedQueue = this.getCurrentQueue();
                        if (this.currentQueueIndex < updatedQueue.length - 1) {
                            await this.playNext(0, options);
                        }
                    });
                    return;
                }
                if (this.autoplayEnabled && isLastTrack) {
                    this.fetchAutoplayRecommendations().then(async () => {
                        const updatedQueue = this.getCurrentQueue();
                        if (this.currentQueueIndex < updatedQueue.length - 1) {
                            await this.playNext(0, options);
                        }
                    });
                    return;
                }
                if (this.artistPopularTracksState.artistId && this.artistPopularTracksState.hasMore) {
                    const newTracks = await this.fetchMoreArtistPopularTracks();
                    if (newTracks && newTracks.length > 0) {
                        await this.addToQueue(newTracks);
                        await this.playNext(0, options);
                    } else {
                        this.activeElement.pause();
                    }
                    return;
                }
                this.activeElement.pause();
                return;
            }

            if (
                this.repeatMode === REPEAT_MODE.ONE &&
                !currentQueue[this.currentQueueIndex]?.isUnavailable &&
                !contentBlockingSettings.shouldHideTrack(currentQueue[this.currentQueueIndex])
            ) {
                await this.playTrackFromQueue(0, recursiveCount, false, options);
                return;
            }

            if (!isLastTrack) {
                this.currentQueueIndex++;
                const track = currentQueue[this.currentQueueIndex];
                if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                    return this.playNext(recursiveCount + 1, options);
                }
            } else if (this.radioEnabled) {
                this.fetchRadioRecommendations().then(async () => {
                    const updatedQueue = this.getCurrentQueue();
                    if (this.currentQueueIndex < updatedQueue.length - 1) {
                        await this.playNext(0, options);
                    }
                });
                return;
            } else if (this.autoplayEnabled) {
                this.fetchAutoplayRecommendations().then(async () => {
                    const updatedQueue = this.getCurrentQueue();
                    if (this.currentQueueIndex < updatedQueue.length - 1) {
                        await this.playNext(0, options);
                    }
                });
                return;
            } else if (this.artistPopularTracksState.artistId && this.artistPopularTracksState.hasMore) {
                const newTracks = await this.fetchMoreArtistPopularTracks();
                if (newTracks && newTracks.length > 0) {
                    await this.addToQueue(newTracks);
                    this.currentQueueIndex++;
                    await this.playTrackFromQueue(0, recursiveCount, false, options);
                    return;
                }

                if (this.repeatMode === REPEAT_MODE.ALL) {
                    this.currentQueueIndex = 0;
                    const track = currentQueue[this.currentQueueIndex];
                    if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                        return this.playNext(recursiveCount + 1, options);
                    }
                } else {
                    return;
                }
            } else if (this.repeatMode === REPEAT_MODE.ALL) {
                this.currentQueueIndex = 0;
                const track = currentQueue[this.currentQueueIndex];
                if (track?.isUnavailable || contentBlockingSettings.shouldHideTrack(track)) {
                    return this.playNext(recursiveCount + 1, options);
                }
            } else {
                return;
            }

            await this.playTrackFromQueue(0, recursiveCount, false, options);
        } catch (error) {
            console.error(error);
        }
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

    shouldCorrectSafariSeek() {
        return (isSafari || isIos) && this.currentStreamProvider === 'monochrome';
    }

    clampSeekTime(time, element = this.activeElement) {
        const requested = Number(time);
        const safeTime = Number.isFinite(requested) ? Math.max(0, requested) : 0;
        const duration = Number(element?.duration);
        return Number.isFinite(duration) && duration > 0 ? Math.min(safeTime, duration) : safeTime;
    }

    waitForSeeked(element, timeoutMs = 650) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                element.removeEventListener('seeked', finish);
                resolve();
            };
            const timeout = setTimeout(finish, timeoutMs);
            element.addEventListener('seeked', finish, { once: true });
        });
    }

    async seekTo(time, { resume = false } = {}) {
        const element = this.activeElement;
        if (!element) return;

        const target = this.clampSeekTime(time, element);
        const sequence = ++this.seekSequence;
        const shouldCorrect = this.shouldCorrectSafariSeek();
        const resumeAfterSeek = resume || (shouldCorrect && !element.paused);
        let correction = shouldCorrect ? this.safariSeekCorrectionSeconds : 0;
        const attempts = shouldCorrect ? 3 : 1;

        if (shouldCorrect && !element.paused) {
            element.pause();
        }

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const requestedTime = this.clampSeekTime(target + correction, element);
            const seeked = shouldCorrect ? this.waitForSeeked(element) : null;
            element.currentTime = requestedTime;

            if (!shouldCorrect) break;
            await seeked;
            if (sequence !== this.seekSequence || element !== this.activeElement) return;

            const error = target - element.currentTime;
            if (!Number.isFinite(error) || Math.abs(error) <= 0.05) break;

            // Safari can land direct FLAC seeks on a nearby decode point. Measure that
            // miss and compensate instead of applying a fixed timing offset to lyrics.
            correction = Math.max(-2, Math.min(2, correction + error));
        }

        if (shouldCorrect) {
            this.safariSeekCorrectionSeconds = correction;
        }
        this.updateMediaSessionPositionState();
        if (resumeAfterSeek && sequence === this.seekSequence) {
            await this.safePlay(element);
        }
    }

    seekBackward(seconds = 10) {
        const el = this.activeElement;
        const newTime = Math.max(0, el.currentTime - seconds);
        void this.seekTo(newTime);
    }

    seekForward(seconds = 10) {
        const el = this.activeElement;
        const duration = el.duration || 0;
        const newTime = Math.min(duration, el.currentTime + seconds);
        void this.seekTo(newTime);
    }

    async toggleShuffle() {
        this.shuffleActive = !this.shuffleActive;

        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle = [...this.queue];
            this.originalQueueBeforeShuffle.forEach((t, i) => (t._originalIndex = i));
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
            this.currentQueueIndex =
                currentTrack?._originalIndex ?? this.queue.findIndex((t) => t.id === currentTrack?.id);
            if (this.currentQueueIndex === -1) {
                this.currentQueueIndex = this.queue.findIndex((t) => t.id === currentTrack?.id);
            }
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
            this.originalQueueBeforeShuffle.forEach((track, index) => {
                track._originalIndex = index;
            });
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
            const currentTrack = this.shuffledQueue[this.currentQueueIndex];
            const originalIndex =
                currentTrack?._originalIndex ??
                this.originalQueueBeforeShuffle.findIndex((t) => t.id === currentTrack?.id);

            if (originalIndex !== -1 && originalIndex !== undefined) {
                this.originalQueueBeforeShuffle.splice(originalIndex + 1, 0, ...tracks);
            } else {
                this.originalQueueBeforeShuffle.push(...tracks); // Sync original queue
            }
            this.originalQueueBeforeShuffle.forEach((t, i) => (t._originalIndex = i));
        }

        await this.saveQueueState();
        this.preloadNextTracks(); // Update preload since next track changed
    }

    async removeFromQueue(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        const isRemovingCurrent = index === this.currentQueueIndex;

        if (index < this.currentQueueIndex) {
            this.currentQueueIndex--;
        }

        const removedTrack = currentQueue.splice(index, 1)[0];

        if (this.shuffleActive) {
            // Also remove from original queue
            const originalIndex =
                removedTrack._originalIndex ??
                this.originalQueueBeforeShuffle.findIndex((t) => t.id === removedTrack.id); // Simple ID check
            if (originalIndex !== -1 && originalIndex !== undefined) {
                this.originalQueueBeforeShuffle.splice(originalIndex, 1);
            }
            this.originalQueueBeforeShuffle.forEach((t, i) => (t._originalIndex = i));
        }

        if (isRemovingCurrent) {
            if (this.currentQueueIndex < currentQueue.length) {
                await this.playTrackFromQueue(0, 0);
            } else {
                this.playbackSequence++;
                this.setLoadingState(false);
                const el = this.activeElement;
                if (el) {
                    el.pause();
                    el.src = '';
                }
                this.currentTrack = null;
                this.currentQueueIndex = -1;
                if (UIRenderer.instance) {
                    UIRenderer.instance.setCurrentTrack(null);
                }
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

    updateNowPlayingTitle(track = this.currentTrack) {
        if (!track) return;
        const titleEl = document.querySelector('.now-playing-bar .title');
        if (!titleEl) return;
        const warning = track.deezerHiResFallback
            ? `<span class="deezer-hires-warning" role="img" tabindex="0" aria-label="Hi-Res unavailable for this track. Playing in CD-quality lossless instead. That's 16-bit / 44.1 kHz FLAC.">${SVG_TRIANGLE_ALERT(16)}</span>`
            : '';
        titleEl.innerHTML = `${escapeHtml(getTrackTitle(track))} ${createQualityBadgeHTML(track)}${warning}`;
    }

    updateAdaptiveQualityBadge() {
        if (!this.currentTrack) return;

        try {
            const titleEl = document.querySelector('.now-playing-bar .title');
            if (!titleEl) return;

            let badgeEl = titleEl.querySelector('.shaka-quality-badge');
            if (!badgeEl) {
                badgeEl = document.createElement('span');
                badgeEl.className = 'quality-badge quality-hires shaka-quality-badge';
                badgeEl.title = 'Stream Quality';
                titleEl.appendChild(badgeEl);
                const staticBadge = titleEl.querySelector('.quality-badge:not(.shaka-quality-badge)');
                if (staticBadge) staticBadge.style.display = 'none';
            }

            let activeVariant = null;
            if (this.shakaInitialized && this.shakaPlayer) {
                try {
                    const variants = this.shakaPlayer.getVariantTracks();
                    activeVariant = variants.find((t) => t.active) || null;
                } catch {
                    activeVariant = null;
                }
            }

            const isAtmosPlaying =
                this.currentStreamInfo?.codec === 'eac3-joc' ||
                this.currentStreamInfo?.quality === 'DOLBY_ATMOS' ||
                (activeVariant?.audioCodec &&
                    (activeVariant.audioCodec.toLowerCase().includes('ec-3') ||
                        activeVariant.audioCodec.toLowerCase().includes('ac-3') ||
                        activeVariant.audioCodec.toLowerCase().includes('joc')));

            if (isAtmosPlaying) {
                if (binauralDspSettings.getAutoEnableForSpatial() && !binauralDspSettings.isEnabled()) {
                    void audioContextManager.toggleBinaural(true);
                    const toggle = document.getElementById('binaural-dsp-toggle');
                    if (toggle) toggle.checked = true;
                    const container = document.getElementById('binaural-dsp-container');
                    if (container) container.style.display = 'block';
                }
                const atmosChannelCount =
                    activeVariant && Number.isFinite(activeVariant.channelsCount) && activeVariant.channelsCount > 0
                        ? activeVariant.channelsCount
                        : 6;
                void audioContextManager.notifyBinauralChannelCount(atmosChannelCount);

                badgeEl.className = 'quality-badge quality-atmos shaka-quality-badge';
                badgeEl.innerHTML = SVG_ATMOS(20);
                badgeEl.style.display = 'inline-flex';
                return;
            }

            void audioContextManager.notifyBinauralChannelCount(2);

            const badgeText = formatQualityBadgeText(this.currentStreamInfo, activeVariant, this.quality);
            if (badgeText) {
                badgeEl.textContent = badgeText;
                badgeEl.className = 'quality-badge quality-hires shaka-quality-badge';
                badgeEl.style.display = 'inline-flex';
            } else {
                badgeEl.style.display = 'none';
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
        MediaSession.setPlaybackState({ playbackState: isPlaying ? 'playing' : 'paused' }).catch(() => {});

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
