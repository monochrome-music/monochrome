import { listeningTracker } from './listening-tracker.js';
import { db } from './db.js';

class SmartRecommendations {
    async getSmartSeeds(count = 50) {
        const [history, favorites, playlists] = await Promise.all([
            db.getHistory(),
            db.getFavorites('track'),
            db.getPlaylists(true),
        ]);
        const playlistTracks = playlists.flatMap((p) => p.tracks || []);

        const scoredTracks = new Map();

        const addWithScore = (tracks, baseWeight) => {
            for (const t of tracks) {
                if (!t || !t.id) continue;
                const signalScore = listeningTracker.getTrackScore(t.id);
                const completionBonus = this._getCompletionBonus(t.id);
                const score = baseWeight + signalScore + completionBonus;
                const existing = scoredTracks.get(t.id);
                if (existing) {
                    existing.score += score;
                    existing.track = t;
                } else {
                    scoredTracks.set(t.id, { score, track: t });
                }
            }
        };

        addWithScore(favorites, 3);
        addWithScore(playlistTracks, 2);
        addWithScore(history, 1);

        const sorted = [...scoredTracks.values()].sort((a, b) => b.score - a.score);

        const dislikedArtistIds = new Set(listeningTracker.getDislikedArtistIds());

        const filteredSeeds = sorted
            .filter((s) => {
                const t = s.track;
                if (this._isTrackByDislikedArtist(t, dislikedArtistIds)) return false;
                const signal = listeningTracker.getTrackSignal(t.id);
                if (signal && signal.playCount >= 3 && signal.avgCompletionRatio < 0.2) return false;
                return true;
            })
            .slice(0, count)
            .map((s) => s.track);

        const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
        return shuffle(filteredSeeds);
    }

    _getCompletionBonus(trackId) {
        const signal = listeningTracker.getTrackSignal(trackId);
        if (!signal) return 0;
        if (signal.avgCompletionRatio > 0.8) return 2;
        if (signal.avgCompletionRatio > 0.5) return 1;
        if (signal.avgCompletionRatio < 0.2 && signal.playCount >= 2) return -3;
        return 0;
    }

    _isTrackByDislikedArtist(track, dislikedArtistIds) {
        if (!track || dislikedArtistIds.size === 0) return false;
        if (track.artist?.id && dislikedArtistIds.has(String(track.artist.id))) return true;
        if (track.artists?.some((a) => a.id && dislikedArtistIds.has(String(a.id)))) return true;
        return false;
    }

    filterRecommendations(tracks) {
        const dislikedArtistIds = new Set(listeningTracker.getDislikedArtistIds());
        const frequentlySkippedIds = new Set(listeningTracker.getFrequentlySkippedTrackIds(100));
        const shortPlayIds = new Set(listeningTracker.getShortPlayTrackIds(100));

        return tracks.filter((t) => {
            if (!t || !t.id) return false;
            if (frequentlySkippedIds.has(t.id)) return false;
            if (shortPlayIds.has(t.id)) return false;
            if (this._isTrackByDislikedArtist(t, dislikedArtistIds)) return false;
            return true;
        });
    }

    scoreRecommendation(track) {
        if (!track) return 0;
        let score = 0;
        const dislikedArtistIds = new Set(listeningTracker.getDislikedArtistIds());
        const topArtists = listeningTracker.getTopArtists(30);
        const topArtistIds = new Set(topArtists.map((a) => a.id));

        if (track.artist?.id && topArtistIds.has(String(track.artist.id))) {
            const artist = topArtists.find((a) => a.id === String(track.artist.id));
            score += artist ? Math.min(artist.affinity * 2, 5) : 1;
        }
        if (track.artists?.some((a) => a.id && topArtistIds.has(String(a.id)))) {
            score += 1;
        }
        if (this._isTrackByDislikedArtist(track, dislikedArtistIds)) {
            score -= 5;
        }
        const skipIds = new Set(listeningTracker.getFrequentlySkippedTrackIds(50));
        if (skipIds.has(track.id)) score -= 3;

        return score;
    }

    rankRecommendations(tracks) {
        return tracks
            .map((t) => ({ track: t, score: this.scoreRecommendation(t) }))
            .sort((a, b) => b.score - a.score)
            .map((t) => t.track);
    }

    async getAdaptiveQueueSeeds(currentQueueTracks, recentlyPlayedIds, count = 5) {
        const topArtistIds = new Set(listeningTracker.getTopArtists(20).map((a) => a.id));

        const queueArtistIds = new Set();
        for (const t of currentQueueTracks) {
            if (t.artist?.id) queueArtistIds.add(String(t.artist.id));
            if (t.artists)
                t.artists.forEach((a) => {
                    if (a.id) queueArtistIds.add(String(a.id));
                });
        }

        const currentArtistIds = new Set();
        for (const id of queueArtistIds) {
            if (topArtistIds.has(id)) currentArtistIds.add(id);
        }

        const recentTrackIds = new Set(recentlyPlayedIds);
        const dislikedArtistIds = new Set(listeningTracker.getDislikedArtistIds());

        const scoredTracks = [];
        for (const t of currentQueueTracks) {
            if (!t || recentTrackIds.has(t.id)) continue;
            if (this._isTrackByDislikedArtist(t, dislikedArtistIds)) continue;
            const signal = listeningTracker.getTrackSignal(t.id);
            const completionRatio = signal ? signal.avgCompletionRatio : 0.5;
            const score = completionRatio;
            scoredTracks.push({ track: t, score });
        }

        scoredTracks.sort((a, b) => b.score - a.score);

        const bestSeeds = scoredTracks.slice(0, Math.ceil(count / 2)).map((s) => s.track);

        if (bestSeeds.length < count) {
            const smartSeeds = await this.getSmartSeeds(20);
            const additional = smartSeeds.filter((s) => {
                if (recentTrackIds.has(s.id)) return false;
                return !bestSeeds.some((b) => b.id === s.id);
            });
            bestSeeds.push(...additional.slice(0, count - bestSeeds.length));
        }

        return bestSeeds.slice(0, count);
    }

    getKnownBadTrackIds() {
        const skipped = new Set(listeningTracker.getFrequentlySkippedTrackIds(100));
        const shortPlay = new Set(listeningTracker.getShortPlayTrackIds(100));
        return new Set([...skipped, ...shortPlay]);
    }

    getKnownBadArtistIds() {
        return new Set(listeningTracker.getDislikedArtistIds(30));
    }
}

export const smartRecommendations = new SmartRecommendations();
