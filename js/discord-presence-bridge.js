(function () {
    if (!window.__TAURI__?.core?.invoke) {
        // stops the script from running outside the desktop app
        return;
    }

    if (window.discordRpcInjected) {
        return;
    }
    window.discordRpcInjected = true;

    let pendingTimer = null; // holds a queued-but-not-yet-sent update
    let lastSentTime = 0; // wall-clock ms of the last successful send
    let lastAudioTime = 0; // audio position at last send (for drift detection)
    let lastUpdateTime = 0; // alias kept for syncRPCTime compatibility
    let lastState = {};

    const MIN_UPDATE_INTERVAL_MS = 10000; // Minimum time between updates to avoid hitting rate limits

    function invoke(cmd, args) {
        return window.__TAURI__.core.invoke(cmd, args);
    }

    if (window.__TAURI__.event?.listen) {
        window.__TAURI__.event.listen('media-toggle', () => {
            const audio = document.getElementById('audio-player');
            if (audio) {
                if (audio.paused) audio.play();
                else audio.pause();
            }
        });
    }

    // -------------------------------------------------------------------------
    // Queue
    // -------------------------------------------------------------------------

    function getCurrentTrackFromQueue() {
        try {
            const queueData = localStorage.getItem('monochrome-queue');
            if (!queueData) return null;

            const queue = JSON.parse(queueData);
            const activeQueue = queue.shuffleActive ? queue.shuffledQueue : queue.queue;
            if (!activeQueue || activeQueue.length === 0) return null;

            const currentTrack = activeQueue[queue.currentQueueIndex];
            return currentTrack || null;
        } catch (e) {
            if (window.__DISCORD_RPC_DEBUG__) {
                console.error('[Discord RPC] Failed to read queue:', e);
            }
            return null;
        }
    }

    // ---------------------------------------------------------------------------
    // State building
    // ---------------------------------------------------------------------------

    function buildCurrentState(currentTrack, audioEl) {
        const isPaused = audioEl.paused;
        const isLocal = Boolean(currentTrack?.isLocal);

        // Determine Tidal IDs based on source type
        const trackId = isLocal ? currentTrack?.tidalData?.id || '' : currentTrack?.id || '';
        const artistId = isLocal ? currentTrack?.tidalData?.artist?.id || '' : currentTrack?.artist?.id || '';
        const albumId = isLocal ? currentTrack?.tidalData?.album?.id || '' : currentTrack?.album?.id || '';
        const coverId = isLocal ? currentTrack?.tidalData?.album?.cover || '' : currentTrack?.album?.cover || '';

        // Extract metadata
        const title = currentTrack.title || 'Unknown Track';
        const artistName = currentTrack.artists?.[0]?.name || currentTrack.artist?.name || 'Unknown Artist';
        const albumName = currentTrack.album?.title || '';

        // Extract year from release date
        const releaseDate = currentTrack.album?.releaseDate || currentTrack?.streamStartDate || '';
        const yearMatch = releaseDate.match(/^(\d{4})/);
        const year = yearMatch ? yearMatch[1] : '';

        // Determine the cover image URL for the track
        // if someone can provide a better way to get the cover image, please do so
        // cause the current method does not follow SSOT for cover images
        let image = isLocal ? 'local' : 'logo';
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (coverId) {
            if (coverId.length < 256 && coverId.startsWith('http')) {
                image = coverId;
            } else if (uuidRegex.test(coverId)) {
                const size = 320; // Desired image size (can be 80, 160, 320, 640, or 1280)
                const formattedId = String(coverId).replace(/-/g, '/');
                image = `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
            }
        }

        // Build URLs for track, artist, and album pages
        const baseUrl = window.location.origin;
        const trackUrl = trackId && /^[1-9]\d+$/.test(trackId) ? `${baseUrl}/track/${trackId}` : '';
        const artistUrl = artistId && /^[1-9]\d*$/.test(artistId) ? `${baseUrl}/artist/${artistId}` : '';
        const albumUrl = albumId && /^\d+$/.test(albumId) ? `${baseUrl}/album/${albumId}` : '';

        return {
            trackId,
            title,
            artist: artistName,
            year,
            album: albumName,
            image,
            isPaused,
            isLocal,
            trackUrl,
            artistUrl,
            albumUrl,
            baseUrl,
        };
    }

    // ---------------------------------------------------------------------------
    // Timestamps
    // ---------------------------------------------------------------------------

    function buildTimestamps(audioEl, isPaused) {
        if (isPaused) return { startTimestamp: null, endTimestamp: null };

        const currentMs = audioEl.currentTime * 1000 || 0;
        const totalMs = audioEl.duration * 1000 || 0;

        const startTimestamp = Math.floor(Date.now() - currentMs);
        const endTimestamp = Math.floor(
            totalMs > 0 && isFinite(totalMs) && totalMs - currentMs > 0 ? Date.now() + totalMs - currentMs : null
        );

        return { startTimestamp, endTimestamp };
    }

    // ---------------------------------------------------------------------------
    // RPC update
    // ---------------------------------------------------------------------------

    function updateRPC(force = false) {
        const audioEl = document.getElementById('audio-player');
        if (!audioEl) return;

        const currentTrack = getCurrentTrackFromQueue();
        if (!currentTrack) {
            // No track in queue, clear RPC; though this never happens because the
            // queue always has a track, but just in case
            if (Object.keys(lastState).length > 0) {
                lastState = {};
                invoke('clear_discord_presence', {}).catch(() => {});
            }
            return;
        }

        const currentState = buildCurrentState(currentTrack, audioEl);

        // Only update if track changed or play/pause state changed
        const trackChanged = lastState.trackId !== currentState.trackId;
        const playStateChanged = lastState.isPaused !== currentState.isPaused;

        if (!force && !trackChanged && !playStateChanged) {
            return;
        }

        lastState = currentState;

        // Destructure the current state for easier access
        const { title, artist, year, album, image, isPaused, isLocal, trackUrl, artistUrl, albumUrl, baseUrl } =
            currentState;

        // ── Throttle: hold the update and send only when 3s have elapsed ────
        const elapsed = Date.now() - lastSentTime;
        const delay = elapsed >= MIN_UPDATE_INTERVAL_MS ? 0 : MIN_UPDATE_INTERVAL_MS - elapsed;

        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
            // Timestamps are computed here — at actual send time — for maximum accuracy.
            const { startTimestamp, endTimestamp } = buildTimestamps(audioEl, isPaused);

            const payload = {
                title,
                artist,
                year,
                album,
                image,
                isPaused,
                isLocal,
                startTimestamp,
                endTimestamp,
                trackUrl,
                artistUrl,
                albumUrl,
                baseUrl,
            };

            // Debug logging
            if (window.__DISCORD_RPC_DEBUG__) {
                const held =
                    elapsed >= MIN_UPDATE_INTERVAL_MS ? 'immediate' : `${MIN_UPDATE_INTERVAL_MS - elapsed}ms hold`;
                console.log(`[Discord RPC] Sending after ${held}`);
                console.log('[Discord RPC] Payload:', JSON.stringify(payload, null, 2));
            }

            invoke('update_discord_presence', { payload }).catch(() => {});
            lastAudioTime = audioEl.currentTime || 0;
            lastSentTime = Date.now();
            lastUpdateTime = lastSentTime;
        }, delay);
    }

    // ---------------------------------------------------------------------------
    // Drift detection
    // ---------------------------------------------------------------------------

    function syncRPCTime() {
        const audioEl = document.getElementById('audio-player');
        if (!audioEl || audioEl.paused || !lastState.trackId) return;

        const currentTime = audioEl.currentTime || 0;
        const timeSinceLastUpdate = (Date.now() - lastUpdateTime) / 1000;

        // If audio time has drifted more than 2 seconds from expected position, resync
        const expectedTime = lastAudioTime + timeSinceLastUpdate;
        const drift = Math.abs(currentTime - expectedTime);

        if (drift > 2.0) {
            if (window.__DISCORD_RPC_DEBUG__) {
                console.log(`[Discord RPC] Time drift detected: ${drift.toFixed(1)}s - resyncing`);
            }
            updateRPC(true);
        }
    }

    // ---------------------------------------------------------------------------
    // Audio listeners
    // ---------------------------------------------------------------------------

    function attachAudioListeners() {
        const audio = document.getElementById('audio-player');
        if (audio && !audio.dataset.rpcAttached) {
            audio.addEventListener('play', () => updateRPC(false));
            audio.addEventListener('pause', () => updateRPC(false));
            audio.addEventListener('seeked', () => updateRPC(true));
            audio.addEventListener('loadedmetadata', () => updateRPC(true));
            audio.addEventListener('timeupdate', () => {
                // Check for drift every 10 seconds of playback
                const currentTime = audio.currentTime || 0;
                if (Math.floor(currentTime) % 10 === 0 && Math.floor(currentTime) !== Math.floor(lastAudioTime)) {
                    syncRPCTime();
                }
            });
            audio.dataset.rpcAttached = 'true';
        }
    }

    // ---------------------------------------------------------------------------
    // Queue polling
    // ---------------------------------------------------------------------------

    let lastQueueString = '';
    function checkQueueChanges() {
        try {
            const currentTrack = getCurrentTrackFromQueue();
            const queueData = currentTrack ? JSON.stringify(currentTrack) : '';
            if (queueData !== lastQueueString) {
                lastQueueString = queueData;
                // Queue changed - update immediately
                updateRPC(true);
            }
        } catch (e) {}
    }

    // ---------------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------------

    function initializeWatcher() {
        attachAudioListeners();
        checkQueueChanges();
        updateRPC(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeWatcher);
    } else {
        initializeWatcher();
    }

    // Check for queue changes every 2 seconds
    setInterval(checkQueueChanges, 2000);

    // Check for time drift every 5 seconds
    setInterval(syncRPCTime, 5000);

    // Re-init periodically as fallback
    setInterval(initializeWatcher, 10000);

    // ---------------------------------------------------------------------------
    // Debug helpers
    // ---------------------------------------------------------------------------

    window.toggleDiscordRPCDebug = function () {
        window.__DISCORD_RPC_DEBUG__ = !window.__DISCORD_RPC_DEBUG__;
        console.log('[Discord RPC] Debug mode:', window.__DISCORD_RPC_DEBUG__ ? 'ENABLED' : 'DISABLED');
        if (window.__DISCORD_RPC_DEBUG__) {
            console.log('[Discord RPC] Current state:', lastState);
            console.log('[Discord RPC] Current track from queue:', getCurrentTrackFromQueue());
            console.log('[Discord RPC] To disable: toggleDiscordRPCDebug()');
        }
        return window.__DISCORD_RPC_DEBUG__;
    };

    // Global function to force RPC update
    window.forceDiscordRPCUpdate = function () {
        console.log('[Discord RPC] Forcing update...');
        updateRPC(true);
        return 'Update triggered';
    };
})();
