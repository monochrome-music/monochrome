import { listenBrainzSettings } from './storage.js';

export class ListenBrainzScrobbler {
    constructor() {
        this.DEFAULT_API_URL = 'https://api.listenbrainz.org/1';
        this.currentTrack = null;
        this.scrobbleTimer = null;
        this.scrobbleThreshold = 0;
        this.hasScrobbled = false;
    }

    getApiUrl() {
        const customUrl = listenBrainzSettings.getCustomUrl();
        return customUrl || this.DEFAULT_API_URL;
    }

    isEnabled() {
        return listenBrainzSettings.isEnabled() && !!listenBrainzSettings.getToken();
    }

    getToken() {
        return listenBrainzSettings.getToken();
    }

    _getMetadata(track) {
        if (!track) return null;

        // Get the primary artist name
        let artistName = 'Unknown Artist';

        if (track.artist?.name) {
            artistName = track.artist.name;
        } else if (typeof track.artist === 'string') {
            artistName = track.artist;
        } else if (track.artists && track.artists.length > 0) {
            const first = track.artists[0];
            artistName = typeof first === 'string' ? first : first.name || 'Unknown Artist';
        }

        // Clean artist name
        if (typeof artistName === 'string') {
            artistName = artistName
                .split(/\s*[&]\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+/i)[0]
                .trim();
        }

        const payload = {
            artist_name: artistName,
            track_name: track.cleanTitle || track.title,
            additional_info: {
                submission_client: 'Monochrome',
                submission_client_version: '1.0.0',
            },
        };

        if (track.album?.title) {
            payload.release_name = track.album.title;
        }

        if (track.duration) {
            payload.additional_info.duration = Math.floor(track.duration);
        }

        if (track.trackNumber) {
            payload.additional_info.track_number = track.trackNumber;
        }

        if (track.isLocal) {
            payload.additional_info.is_local = true;
        }

        return payload;
    }

    async submitListen(listenType, track, timestamp = null) {
        if (!this.isEnabled()) return;

        const metadata = this._getMetadata(track);
        if (!metadata) return;

        const payload = [
            {
                track_metadata: metadata,
            },
        ];

        if (timestamp) {
            payload[0].listened_at = timestamp;
        }

        const body = {
            listen_type: listenType,
            payload: payload,
        };

        try {
            const apiUrl = this.getApiUrl();
            const response = await fetch(`${apiUrl}/submit-listens`, {
                method: 'POST',
                headers: {
                    Authorization: `Token ${this.getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                // ListenBrainz doesn't always return JSON on error
                const text = await response.text();
                throw new Error(`ListenBrainz API Error ${response.status}: ${text}`);
            }

            console.log(`[ListenBrainz] Submitted ${listenType}: ${metadata.track_name}`);
        } catch (error) {
            console.error('[ListenBrainz] Submission failed:', error);
        }
    }

    async updateNowPlaying(track) {
        if (!this.isEnabled()) return;

        this.currentTrack = track;
        this.hasScrobbled = false;
        this.clearScrobbleTimer();

        await this.submitListen('playing_now', track);

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
        await this.submitListen('single', this.currentTrack, timestamp);
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
