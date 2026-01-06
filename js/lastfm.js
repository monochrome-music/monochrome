//js/lastfm.js
import { delay, getTrackArtists } from './utils.js';

export class LastFMScrobbler {
    constructor() {
        this.API_KEY = '0ecf01914957b40c17030db822845a76';
        this.API_SECRET = 'bd37e61e0b16b8c7bf8de2862de5493c';
        this.API_URL = 'https://ws.audioscrobbler.com/2.0/';

        this.sessionKey = null;
        this.username = null;
        this.currentTrack = null;
        this.scrobbleTimer = null;
        this.scrobbleThreshold = 0;
        this.hasScrobbled = false;

        this.loadSession();
    }

    loadSession() {
        try {
            const session = localStorage.getItem('lastfm-session');
            if (session) {
                const data = JSON.parse(session);
                this.sessionKey = data.key;
                this.username = data.name;
            }
        } catch (e) {
            console.error('Failed to load Last.fm session:', e);
        }
    }

    saveSession(sessionKey, username) {
        this.sessionKey = sessionKey;
        this.username = username;
        localStorage.setItem('lastfm-session', JSON.stringify({
            key: sessionKey,
            name: username
        }));
    }

    clearSession() {
        this.sessionKey = null;
        this.username = null;
        localStorage.removeItem('lastfm-session');
    }

    isAuthenticated() {
        return !!this.sessionKey;
    }

    async generateSignature(params) {
        const filteredParams = { ...params };
        delete filteredParams.format;
        delete filteredParams.callback;

        const sortedKeys = Object.keys(filteredParams).sort();

        const signatureString = sortedKeys
            .map(key => `${key}${filteredParams[key]}`)
            .join('') + this.API_SECRET;

        console.log('Signature string:', signatureString);

        try {
            const { default: md5 } = await import('https://cdn.jsdelivr.net/npm/md5@2.3.0/+esm');
            return md5(signatureString);
        } catch (e) {
            console.error('MD5 library not available');
            throw new Error('MD5 library required for Last.fm');
        }
    }

    async makeRequest(method, params = {}, requiresAuth = false) {
        const requestParams = {
            method,
            api_key: this.API_KEY,
            ...params
        };

        if (requiresAuth && this.sessionKey) {
            requestParams.sk = this.sessionKey;
        }

        const signature = await this.generateSignature(requestParams);

        const formData = new URLSearchParams({
            ...requestParams,
            api_sig: signature,
            format: 'json'
        });

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.message || 'Last.fm API error');
            }

            return data;
        } catch (error) {
            console.error('Last.fm API request failed:', error);
            throw error;
        }
    }

    async getAuthUrl() {
        try {
            const data = await this.makeRequest('auth.getToken');
            const token = data.token;

            return {
                token,
                url: `https://www.last.fm/api/auth/?api_key=${this.API_KEY}&token=${token}`
            };
        } catch (error) {
            console.error('Failed to get auth URL:', error);
            throw error;
        }
    }

    async completeAuthentication(token) {
        try {
            const data = await this.makeRequest('auth.getSession', { token });

            if (data.session) {
                this.saveSession(data.session.key, data.session.name);
                return {
                    success: true,
                    username: data.session.name
                };
            }

            throw new Error('No session returned');
        } catch (error) {
            console.error('Authentication failed:', error);
            throw error;
        }
    }

    async updateNowPlaying(track) {
        if (!this.isAuthenticated()) return;

        this.currentTrack = track;
        this.hasScrobbled = false;
        this.clearScrobbleTimer();

        try {
            const params = {
                artist: track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist',
                track: track.title
            };

            if (track.album?.title) {
                params.album = track.album.title;
            }

            if (track.duration) {
                params.duration = Math.floor(track.duration);
            }

            if (track.trackNumber) {
                params.trackNumber = track.trackNumber;
            }

            await this.makeRequest('track.updateNowPlaying', params, true);

            console.log('Now playing updated:', track.title);

            this.scrobbleThreshold = Math.min(track.duration / 2, 240);
            this.scheduleScrobble(this.scrobbleThreshold * 1000);

        } catch (error) {
            console.error('Failed to update now playing:', error);
        }
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
        if (!this.isAuthenticated() || !this.currentTrack || this.hasScrobbled) return;

        try {
            const timestamp = Math.floor(Date.now() / 1000);

            const params = {
                artist: this.currentTrack.artist?.name || this.currentTrack.artists?.[0]?.name || 'Unknown Artist',
                track: this.currentTrack.title,
                timestamp: timestamp
            };

            if (this.currentTrack.album?.title) {
                params.album = this.currentTrack.album.title;
            }

            if (this.currentTrack.duration) {
                params.duration = Math.floor(this.currentTrack.duration);
            }

            if (this.currentTrack.trackNumber) {
                params.trackNumber = this.currentTrack.trackNumber;
            }

            await this.makeRequest('track.scrobble', params, true);

            this.hasScrobbled = true;
            console.log('Scrobbled:', this.currentTrack.title);

        } catch (error) {
            console.error('Failed to scrobble:', error);
        }
    }

    async loveTrack(track) {
        if (!this.isAuthenticated()) return;

        try {
            const params = {
                artist: track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist',
                track: track.title
            };

            await this.makeRequest('track.love', params, true);
            console.log('Loved track on Last.fm:', track.title);
        } catch (error) {
            console.error('Failed to love track on Last.fm:', error);
        }
    }

    onTrackChange(track) {
        if (!this.isAuthenticated()) return;
        this.updateNowPlaying(track);
    }

    onPlaybackStop() {
        this.clearScrobbleTimer();
    }

    disconnect() {
        this.clearSession();
        this.clearScrobbleTimer();
        this.currentTrack = null;
    }
}
