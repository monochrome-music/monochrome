const STORAGE_KEY = 'monochrome-listening-data';
const MAX_TRACKS = 2000;
const MAX_ARTISTS = 500;
const SKIP_THRESHOLD_S = 5;
const COMPLETION_RATIO_THRESHOLD = 0.3;

class ListeningTracker {
    constructor() {
        this._data = null;
        this._currentTrackId = null;
        this._playStartTime = null;
        this._lastTimeUpdate = 0;
        this._accumulatedPlayTime = 0;
        this._trackDuration = 0;
        this._flushTimer = null;
    }

    _load() {
        if (this._data) return this._data;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            this._data = raw ? JSON.parse(raw) : this._empty();
        } catch {
            this._data = this._empty();
        }
        return this._data;
    }

    _empty() {
        return { tracks: {}, artists: {}, version: 1 };
    }

    _save() {
        try {
            const d = this._data || this._load();
            const trackEntries = Object.entries(d.tracks);
            if (trackEntries.length > MAX_TRACKS) {
                trackEntries.sort((a, b) => (b[1].lastPlayed || 0) - (a[1].lastPlayed || 0));
                d.tracks = Object.fromEntries(trackEntries.slice(0, MAX_TRACKS));
            }
            const artistEntries = Object.entries(d.artists);
            if (artistEntries.length > MAX_ARTISTS) {
                artistEntries.sort((a, b) => (b[1].affinity || 0) - (a[1].affinity || 0));
                d.artists = Object.fromEntries(artistEntries.slice(0, MAX_ARTISTS));
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
        } catch (e) {
            console.warn('ListeningTracker: save failed', e);
        }
    }

    _flush() {
        if (this._flushTimer) return;
        this._flushTimer = setTimeout(() => {
            this._save();
            this._flushTimer = null;
        }, 2000);
    }

    onTrackStart(track) {
        if (!track || !track.id) return;
        this._finalizeCurrent();
        this._currentTrackId = track.id;
        this._playStartTime = Date.now();
        this._lastTimeUpdate = 0;
        this._accumulatedPlayTime = 0;
        this._trackDuration = (track.duration || 0) / 1000;
    }

    onTimeUpdate(currentTime, duration) {
        if (!this._currentTrackId || this._playStartTime === null) return;
        if (duration > 0) this._trackDuration = duration;
        if (this._lastTimeUpdate > 0 && currentTime > this._lastTimeUpdate) {
            const delta = currentTime - this._lastTimeUpdate;
            if (delta < 5) {
                this._accumulatedPlayTime += delta;
            }
        }
        this._lastTimeUpdate = currentTime;
    }

    onTrackEnd() {
        this._finalizeCurrent();
    }

    onSkip() {
        if (!this._currentTrackId || this._playStartTime === null) return;
        const elapsed = this._accumulatedPlayTime;
        this._recordTrackSignal(this._currentTrackId, elapsed, this._trackDuration, true);
        if (this._currentTrackId) {
            const currentData = this._load();
            const trackMeta = this._findTrackMeta(this._currentTrackId);
            if (trackMeta) {
                this._updateArtistAffinityFromData(currentData, trackMeta, elapsed, this._trackDuration, true);
            }
        }
        this._currentTrackId = null;
        this._playStartTime = null;
        this._accumulatedPlayTime = 0;
        this._lastTimeUpdate = 0;
        this._flush();
    }

    _finalizeCurrent() {
        if (!this._currentTrackId || this._playStartTime === null) return;
        const elapsed = this._accumulatedPlayTime;
        this._recordTrackSignal(this._currentTrackId, elapsed, this._trackDuration, false);
        if (this._currentTrackId) {
            const currentData = this._load();
            const trackMeta = this._findTrackMeta(this._currentTrackId);
            if (trackMeta) {
                this._updateArtistAffinityFromData(currentData, trackMeta, elapsed, this._trackDuration, false);
            }
        }
        this._currentTrackId = null;
        this._playStartTime = null;
        this._accumulatedPlayTime = 0;
        this._lastTimeUpdate = 0;
        this._flush();
    }

    _findTrackMeta(_trackId) {
        return null;
    }

    _recordTrackSignal(trackId, playTimeS, durationS, wasSkipped) {
        const d = this._load();
        if (!d.tracks[trackId]) {
            d.tracks[trackId] = {
                playCount: 0,
                skipCount: 0,
                totalPlayTime: 0,
                completionCount: 0,
                lastPlayed: 0,
                avgCompletionRatio: 0,
            };
        }
        const t = d.tracks[trackId];
        t.playCount++;
        t.totalPlayTime += playTimeS;
        t.lastPlayed = Date.now();

        const completionRatio = durationS > 0 ? Math.min(playTimeS / durationS, 1) : 0;
        t.avgCompletionRatio =
            t.avgCompletionRatio === 0 ? completionRatio : t.avgCompletionRatio * 0.8 + completionRatio * 0.2;

        if (wasSkipped || playTimeS < SKIP_THRESHOLD_S) {
            t.skipCount++;
        } else if (playTimeS >= durationS * 0.9 || completionRatio >= 0.9) {
            t.completionCount++;
        }
    }

    updateArtistAffinity(track, playTimeS, durationS, wasSkipped) {
        if (!track) return;
        const d = this._load();
        this._updateArtistAffinityFromData(d, track, playTimeS, durationS, wasSkipped);
        this._flush();
    }

    _updateArtistAffinityFromData(d, track, playTimeS, durationS, wasSkipped) {
        const artistIds = [];
        if (track.artist && track.artist.id) artistIds.push(track.artist.id);
        if (track.artists && Array.isArray(track.artists)) {
            for (const a of track.artists) {
                if (a.id) artistIds.push(a.id);
            }
        }
        if (artistIds.length === 0) return;

        const completionRatio = durationS > 0 ? Math.min(playTimeS / durationS, 1) : 0;
        const weight = wasSkipped
            ? -0.5
            : completionRatio > 0.8
              ? 1.0
              : completionRatio > 0.5
                ? 0.5
                : completionRatio > COMPLETION_RATIO_THRESHOLD
                  ? 0.2
                  : -0.2;

        for (const artistId of artistIds) {
            const name = track.artists?.find((a) => a.id === artistId)?.name || track.artist?.name || '';
            if (!d.artists[artistId]) {
                d.artists[artistId] = { name, affinity: 0, playCount: 0, skipCount: 0, totalPlayTime: 0 };
            }
            const a = d.artists[artistId];
            a.affinity = a.affinity * 0.9 + weight;
            a.playCount++;
            a.totalPlayTime += playTimeS;
            if (wasSkipped) a.skipCount++;
            if (name) a.name = name;
        }
    }

    getTrackSignal(trackId) {
        const d = this._load();
        return d.tracks[trackId] || null;
    }

    getTrackScore(trackId) {
        const signal = this.getTrackSignal(trackId);
        if (!signal) return 0;
        const skipRate = signal.playCount > 0 ? signal.skipCount / signal.playCount : 0;
        const completionRate = signal.playCount > 0 ? signal.completionCount / signal.playCount : 0;
        return (
            signal.avgCompletionRatio * 2 + completionRate * 3 - skipRate * 4 + Math.log2(signal.playCount + 1) * 0.5
        );
    }

    getArtistAffinity(artistId) {
        const d = this._load();
        return d.artists[artistId]?.affinity || 0;
    }

    getTopArtists(limit = 20) {
        const d = this._load();
        return Object.entries(d.artists)
            .filter(([, v]) => v.playCount >= 2)
            .sort((a, b) => b[1].affinity - a[1].affinity)
            .slice(0, limit)
            .map(([id, v]) => ({ id, name: v.name, affinity: v.affinity, playCount: v.playCount }));
    }

    getDislikedArtists(limit = 20) {
        const d = this._load();
        return Object.entries(d.artists)
            .filter(([, v]) => v.playCount >= 2 && v.affinity < -0.3)
            .sort((a, b) => a[1].affinity - b[1].affinity)
            .slice(0, limit)
            .map(([id, v]) => ({ id, name: v.name, affinity: v.affinity }));
    }

    getHighlyPlayedTracks(limit = 50) {
        const d = this._load();
        return Object.entries(d.tracks)
            .filter(([, v]) => v.playCount >= 2 && v.avgCompletionRatio > 0.6)
            .sort((a, b) => b[1].playCount - a[1].playCount)
            .slice(0, limit)
            .map(([id]) => id);
    }

    getFrequentlySkippedTrackIds(limit = 50) {
        const d = this._load();
        return Object.entries(d.tracks)
            .filter(([, v]) => v.playCount >= 2 && v.skipCount / v.playCount > 0.5)
            .sort((a, b) => b[1].skipCount / b[1].playCount - a[1].skipCount / a[1].playCount)
            .slice(0, limit)
            .map(([id]) => id);
    }

    getShortPlayTrackIds(limit = 50) {
        const d = this._load();
        return Object.entries(d.tracks)
            .filter(([, v]) => v.playCount >= 2 && v.avgCompletionRatio < COMPLETION_RATIO_THRESHOLD)
            .sort((a, b) => a[1].avgCompletionRatio - b[1].avgCompletionRatio)
            .slice(0, limit)
            .map(([id]) => id);
    }

    getDislikedArtistIds() {
        return this.getDislikedArtists(30).map((a) => a.id);
    }

    getSessionSignals() {
        return {
            currentTrackId: this._currentTrackId,
            accumulatedPlayTime: this._accumulatedPlayTime,
            trackDuration: this._trackDuration,
        };
    }

    forceFlush() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._save();
    }
}

export const listeningTracker = new ListeningTracker();
