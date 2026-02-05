import { malojaSettings } from './storage.js';

export class MalojaScrobbler {
    constructor() {
        this.currentTrack = null;
        this.scrobbleTimer = null;
        this.scrobbleThreshold = 0;
        this.hasScrobbled = false;
    }

    getApiUrl() {
        const customUrl = malojaSettings.getCustomUrl();
        // Remove trailing slash if present
        return customUrl ? customUrl.replace(/\/$/, '') : '';
    }

    isEnabled() {
        return malojaSettings.isEnabled() && !!malojaSettings.getToken() && !!this.getApiUrl();
    }

    getApiKey() {
        return malojaSettings.getToken();
    }

    _getScrobbleArtist(track) {
        if (!track) return 'Unknown Artist';

        let artistName = 'Unknown Artist';

        if (track.artist?.name) {
            artistName = track.artist.name;
        } else if (typeof track.artist === 'string') {
            artistName = track.artist;
        } else if (track.artists && track.artists.length > 0) {
            const first = track.artists[0];
            artistName = typeof first === 'string' ? first : first.name || 'Unknown Artist';
        }

        if (typeof artistName !== 'string') return 'Unknown Artist';

        artistName = artistName
            .split(/\s*[&]\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+/i)[0]
            .trim();

        return artistName || 'Unknown Artist';
    }

    async submitScrobble(track, timestamp = null) {
        if (!this.isEnabled()) return;

        const apiUrl = this.getApiUrl();
        const apiKey = this.getApiKey();

        if (!apiUrl || !apiKey) return;

        const artist = this._getScrobbleArtist(track);
        const title = track.cleanTitle || track.title;

        // Build the scrobble data
        const scrobbleData = {
            artist: artist,
            title: title,
            key: apiKey,
        };

        if (track.album?.title) {
            scrobbleData.album = track.album.title;
        }

        if (track.duration) {
            scrobbleData.duration = Math.floor(track.duration);
        }

        if (track.trackNumber) {
            scrobbleData.track_number = track.trackNumber;
        }

        if (timestamp) {
            scrobbleData.time = timestamp;
        }

        try {
            // Try the newer Maloja API format first (mlj_1)
            let response = await fetch(`${apiUrl}/apis/mlj_1/newscrobble`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams(scrobbleData),
            });

            if (!response.ok) {
                // Fallback to older API format
                response = await fetch(`${apiUrl}/apis/native/newscrobble`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams(scrobbleData),
                });
            }

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Maloja API Error ${response.status}: ${text}`);
            }

            console.log(`[Maloja] Submitted scrobble: ${title} by ${artist}`);
        } catch (error) {
            console.error('[Maloja] Submission failed:', error);
        }
    }

    async updateNowPlaying(track) {
        if (!this.isEnabled()) return;

        this.currentTrack = track;
        this.hasScrobbled = false;
        this.clearScrobbleTimer();

        // Maloja doesn't have a separate "now playing" endpoint like Last.fm
        // It just scrobbles when the track is actually played
        // We'll set up the timer to scrobble after the threshold

        this.scrobbleThreshold = Math.min(track.duration / 2, 240);
        this.scheduleScrobble(this.scrobbleThreshold * 1000);
    }

    scheduleScrobble(delay) {
        this.clearScrobbleTimer();
        this.scrobbleTimer = setTimeout(() => {
            this.scrobbleCurrentTrack();
        }, delay);
    }

    clearScrobbleTimer() {
        if (this.scrobbleTimer) {
            clearTimeout(this.scrobbleTimer);
            this.scrobbleTimer = null;
        }
    }

    async scrobbleCurrentTrack() {
        if (!this.isEnabled() || !this.currentTrack || this.hasScrobbled) return;

        const timestamp = Math.floor(Date.now() / 1000);
        await this.submitScrobble(this.currentTrack, timestamp);
        this.hasScrobbled = true;
    }

    onTrackChange(track) {
        this.updateNowPlaying(track);
    }

    onPlaybackStop() {
        this.clearScrobbleTimer();
    }

    disconnect() {
        this.clearScrobbleTimer();
        this.currentTrack = null;
    }
}
