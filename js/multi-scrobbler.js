import { LastFMScrobbler } from './lastfm.js';
import { ListenBrainzScrobbler } from './listenbrainz.js';
import { MalojaScrobbler } from './maloja.js';
import { LibreFmScrobbler } from './librefm.js';

export class MultiScrobbler {
    constructor() {
        this.lastfm = new LastFMScrobbler();
        this.listenbrainz = new ListenBrainzScrobbler();
        this.maloja = new MalojaScrobbler();
        this.librefm = new LibreFmScrobbler();
    }

    // Proxy method for Last.fm specific usage (auth flow)
    getLastFM() {
        return this.lastfm;
    }

    // Proxy method for Libre.fm specific usage (auth flow)
    getLibreFm() {
        return this.librefm;
    }

    isAuthenticated() {
        // Return true if any service is configured, so events.js will proceed to call updateNowPlaying
        // Individual services check their own enabled/auth state internally
        return (
            this.lastfm.isAuthenticated() ||
            this.listenbrainz.isEnabled() ||
            this.maloja.isEnabled() ||
            this.librefm.isAuthenticated()
        );
    }

    async updateNowPlaying(track) {
        await Promise.allSettled(
            [
                this.lastfm.updateNowPlaying(track),
                this.listenbrainz.updateNowPlaying(track),
                this.maloja.updateNowPlaying(track),
                this.librefm.updateNowPlaying(track),
            ].map((p) => p.catch(console.error))
        );
    }

    async onTrackChange(track) {
        await Promise.allSettled(
            [
                this.lastfm.onTrackChange(track),
                this.listenbrainz.onTrackChange(track),
                this.maloja.onTrackChange(track),
                this.librefm.onTrackChange(track),
            ].map((p) => p.catch(console.error))
        );
    }

    onPlaybackStop() {
        this.lastfm.onPlaybackStop();
        this.listenbrainz.onPlaybackStop();
        this.maloja.onPlaybackStop();
        this.librefm.onPlaybackStop();
    }

    // Love/Like tracks on all services that support it
    async loveTrack(track) {
        await Promise.allSettled(
            [this.lastfm.loveTrack(track), this.librefm.loveTrack(track), this.listenbrainz.loveTrack(track)].map((p) =>
                p.catch(console.error)
            )
        );
        // Maloja feedback could be added here when supported
    }
}
