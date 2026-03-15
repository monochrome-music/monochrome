// js/offline.js — Offline Music Storage Manager
// Stores audio blobs + track metadata in IndexedDB for fully offline playback.

const DB_NAME = 'MonochromeOfflineDB';
const DB_VERSION = 1;
const STORE_TRACKS = 'offline_tracks'; // { id, metadata, audioBlob, coverBlob, savedAt }

let _db = null;

async function openDB() {
    if (_db) return _db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => {
            _db = request.result;
            resolve(_db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_TRACKS)) {
                const store = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
                store.createIndex('savedAt', 'savedAt', { unique: false });
                store.createIndex('artist', 'metadata.artistName', { unique: false });
                store.createIndex('album', 'metadata.albumTitle', { unique: false });
            }
        };
    });
}

/**
 * Save a track for offline playback.
 * @param {Object} track - Track metadata object
 * @param {Blob} audioBlob - The audio data
 * @param {Blob|null} coverBlob - Album art JPEG blob (optional)
 */
export async function saveOfflineTrack(track, audioBlob, coverBlob = null) {
    const db = await openDB();
    const artists = track.artists?.map(a => a.name).join(', ') || track.artist?.name || 'Unknown Artist';

    const entry = {
        id: track.id,
        metadata: {
            id: track.id,
            title: track.title || 'Unknown Title',
            artistName: artists,
            artist: track.artist || (track.artists?.[0]) || { name: artists },
            artists: track.artists || [{ name: artists }],
            albumTitle: track.album?.title || '',
            albumCover: track.album?.cover || null,
            duration: track.duration || 0,
            trackNumber: track.trackNumber || null,
            explicit: track.explicit || false,
            version: track.version || null,
            album: track.album || null,
        },
        audioBlob: audioBlob,
        coverBlob: coverBlob,
        savedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readwrite');
        tx.objectStore(STORE_TRACKS).put(entry);
        tx.oncomplete = () => {
            window.dispatchEvent(new CustomEvent('offline-tracks-changed'));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Remove a track from offline storage.
 */
export async function removeOfflineTrack(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readwrite');
        tx.objectStore(STORE_TRACKS).delete(id);
        tx.oncomplete = () => {
            window.dispatchEvent(new CustomEvent('offline-tracks-changed'));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Check if a track is saved offline.
 */
export async function isTrackOffline(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const req = tx.objectStore(STORE_TRACKS).count(id);
        req.onsuccess = () => resolve(req.result > 0);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get all offline tracks, sorted by savedAt descending (newest first).
 */
export async function getAllOfflineTracks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const req = tx.objectStore(STORE_TRACKS).getAll();
        req.onsuccess = () => {
            const results = req.result.sort((a, b) => b.savedAt - a.savedAt);
            resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get a single offline track entry (including audio blob).
 */
export async function getOfflineTrack(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const req = tx.objectStore(STORE_TRACKS).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get total count of offline tracks.
 */
export async function getOfflineTrackCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const req = tx.objectStore(STORE_TRACKS).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get total storage used by offline tracks (bytes).
 */
export async function getOfflineStorageUsed() {
    const tracks = await getAllOfflineTracks();
    let total = 0;
    for (const t of tracks) {
        if (t.audioBlob) total += t.audioBlob.size;
        if (t.coverBlob) total += t.coverBlob.size;
    }
    return total;
}

/**
 * Clear all offline tracks.
 */
export async function clearAllOfflineTracks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readwrite');
        tx.objectStore(STORE_TRACKS).clear();
        tx.oncomplete = () => {
            window.dispatchEvent(new CustomEvent('offline-tracks-changed'));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Build a playable track object from an offline entry,
 * creating blob URLs for audio and cover art.
 */
export function buildPlayableTrack(entry) {
    const audioUrl = URL.createObjectURL(entry.audioBlob);
    const coverUrl = entry.coverBlob ? URL.createObjectURL(entry.coverBlob) : null;
    const meta = entry.metadata;

    return {
        id: meta.id,
        title: meta.title,
        artist: meta.artist,
        artists: meta.artists,
        duration: meta.duration,
        trackNumber: meta.trackNumber,
        explicit: meta.explicit,
        version: meta.version,
        album: {
            ...(meta.album || {}),
            title: meta.albumTitle,
            cover: coverUrl || meta.albumCover,
            // Preserve the original TIDAL cover ID so it can be used
            // as a fallback after hard reload when blob URLs are dead
            _originalCover: meta.albumCover || null,
        },
        audioUrl: audioUrl,
        isOffline: true,
    };
}
