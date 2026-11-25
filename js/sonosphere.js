import { LibreFmScrobbler } from './librefm.js';
import { sonosphereSettings } from './storage.js';

// https://sonosphere.fm/
export class SonosphereScrobbler extends LibreFmScrobbler {
    constructor() {
        super({
            name: 'Sonosphere',
            apiKey: 'a400b71e205c5820fb0ba32e3b3ba880',
            apiSecret: '4f28c9d33bad60c398a997d67842efcc',
            apiUrl: 'https://sonosphere.fm/2.0/',
            authUrl: 'https://sonosphere.fm/api/auth',
            storagePrefix: 'sonosphere',
            settings: sonosphereSettings,
        });
    }

    async loveTrack(track) {
        if (!sonosphereSettings.shouldLoveOnLike()) return;
        return super.loveTrack(track);
    }
}
