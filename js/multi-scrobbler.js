import { LastFMScrobbler } from './lastfm.js';
import { ListenBrainzScrobbler } from './listenbrainz.js';

export class MultiScrobbler {
    constructor() {
        this.lastfm = new LastFMScrobbler();
        this.listenbrainz = new ListenBrainzScrobbler();
    }

    // Proxy method for Last.fm specific usage (auth flow)
    getLastFM() {
        return this.lastfm;
    }

    isAuthenticated() {
        // Return true if any service is configured, so events.js will proceed to call updateNowPlaying
        // Individual services check their own enabled/auth state internally
        return this.lastfm.isAuthenticated() || this.listenbrainz.isEnabled();
    }

    updateNowPlaying(track) {
        this.lastfm.updateNowPlaying(track);
        this.listenbrainz.updateNowPlaying(track);
    }

    onTrackChange(track) {
        this.lastfm.onTrackChange(track);
        this.listenbrainz.onTrackChange(track);
    }

    onPlaybackStop() {
        this.lastfm.onPlaybackStop();
        this.listenbrainz.onPlaybackStop();
    }

    // Love/Like is currently Last.fm specific in the UI, but we can extend later
    async loveTrack(track) {
        await this.lastfm.loveTrack(track);
        // ListenBrainz feedback could be added here
    }
}
