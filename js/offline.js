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
 * Get all offline track IDs (keys only, no blob data).
 */
async function getAllOfflineKeys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const req = tx.objectStore(STORE_TRACKS).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Export offline tracks to a .mcbackup file.
 * Fetches one track at a time by key to keep memory low.
 *
 * Format: [MAGIC 4B][VERSION 4B][COUNT 4B] then per track:
 *   [metaLen 4B][audioLen 4B][coverLen 4B][meta JSON][audio bytes][cover bytes]
 */
export async function exportOfflineTracks(onProgress) {
    const keys = await getAllOfflineKeys();
    if (keys.length === 0) throw new Error('No offline tracks to export');

    const encoder = new TextEncoder();
    const count = keys.length;

    // Try streaming export via File System Access API
    if (window.showSaveFilePicker) {
        try {
            const date = new Date().toISOString().slice(0, 10);
            const handle = await window.showSaveFilePicker({
                suggestedName: `monochrome-offline-${date}.mcbackup`,
                types: [{ description: 'Monochrome Backup', accept: { 'application/octet-stream': ['.mcbackup'] } }],
            });
            const writable = await handle.createWritable();

            // Write header
            const header = new ArrayBuffer(12);
            const hv = new DataView(header);
            hv.setUint32(0, 0x4D434241);
            hv.setUint32(4, 1);
            hv.setUint32(8, count);
            await writable.write(header);

            for (let i = 0; i < count; i++) {
                const entry = await getOfflineTrack(keys[i]);
                if (!entry) continue;

                const metaBytes = encoder.encode(JSON.stringify({
                    id: entry.id, metadata: entry.metadata, savedAt: entry.savedAt
                }));
                const audioSize = entry.audioBlob?.size || 0;
                const coverSize = entry.coverBlob?.size || 0;

                const lengths = new ArrayBuffer(12);
                const lv = new DataView(lengths);
                lv.setUint32(0, metaBytes.byteLength);
                lv.setUint32(4, audioSize);
                lv.setUint32(8, coverSize);
                await writable.write(lengths);
                await writable.write(metaBytes);
                if (audioSize > 0) await writable.write(entry.audioBlob);
                if (coverSize > 0) await writable.write(entry.coverBlob);

                if (onProgress) onProgress(i + 1, count);
            }

            await writable.close();
            return null; // File already saved via picker
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('Export cancelled');
            // Fall through to Blob approach
        }
    }

    // Fallback: chunked Blob approach — one track at a time
    const parts = [];

    const header = new ArrayBuffer(12);
    const hv = new DataView(header);
    hv.setUint32(0, 0x4D434241);
    hv.setUint32(4, 1);
    hv.setUint32(8, count);
    parts.push(header);

    for (let i = 0; i < count; i++) {
        const entry = await getOfflineTrack(keys[i]);
        if (!entry) continue;

        const metaBytes = encoder.encode(JSON.stringify({
            id: entry.id, metadata: entry.metadata, savedAt: entry.savedAt
        }));
        const audioSize = entry.audioBlob?.size || 0;
        const coverSize = entry.coverBlob?.size || 0;

        const lengths = new ArrayBuffer(12);
        const lv = new DataView(lengths);
        lv.setUint32(0, metaBytes.byteLength);
        lv.setUint32(4, audioSize);
        lv.setUint32(8, coverSize);
        parts.push(lengths);
        parts.push(metaBytes.buffer);
        if (audioSize > 0) parts.push(entry.audioBlob);
        if (coverSize > 0) parts.push(entry.coverBlob);

        if (onProgress) onProgress(i + 1, count);
    }

    return new Blob(parts, { type: 'application/octet-stream' });
}

/**
 * Read a slice of a File as an ArrayBuffer.
 */
function readFileSlice(file, start, length) {
    return file.slice(start, start + length).arrayBuffer();
}

/**
 * Import offline tracks from a .mcbackup file.
 * Reads the file in slices (one track at a time) to keep memory low.
 * Deduplicates by track ID — skips tracks that already exist.
 */
export async function importOfflineTracks(file, onProgress, overwrite = false) {
    // Read header (12 bytes)
    const headerBuf = await readFileSlice(file, 0, 12);
    const headerView = new DataView(headerBuf);

    const magic = headerView.getUint32(0);
    if (magic !== 0x4D434241) throw new Error('Invalid backup file');
    const version = headerView.getUint32(4);
    if (version !== 1) throw new Error('Unsupported backup version');
    const count = headerView.getUint32(8);

    // Pre-load existing IDs for fast duplicate check
    const existingIds = new Set();
    if (!overwrite) {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_TRACKS, 'readonly');
            const req = tx.objectStore(STORE_TRACKS).getAllKeys();
            req.onsuccess = () => { req.result.forEach(k => existingIds.add(String(k))); resolve(); };
            req.onerror = () => reject(req.error);
        });
    }

    const decoder = new TextDecoder();
    let offset = 12;
    let imported = 0;
    let skipped = 0;
    const seenIds = new Set(); // catch duplicates within the file itself

    for (let i = 0; i < count; i++) {
        // Read length header (12 bytes)
        const lenBuf = await readFileSlice(file, offset, 12);
        const lenView = new DataView(lenBuf);
        const metaLen = lenView.getUint32(0);
        const audioLen = lenView.getUint32(4);
        const coverLen = lenView.getUint32(8);
        offset += 12;

        // Read metadata
        const metaBuf = await readFileSlice(file, offset, metaLen);
        const metaJson = decoder.decode(new Uint8Array(metaBuf));
        offset += metaLen;

        const parsed = JSON.parse(metaJson);
        const trackId = String(parsed.id);

        // Skip if duplicate within file or already exists in DB
        if (seenIds.has(trackId) || (!overwrite && existingIds.has(trackId))) {
            offset += audioLen + coverLen;
            skipped++;
            if (onProgress) onProgress(i + 1, count);
            continue;
        }
        seenIds.add(trackId);

        // Read audio and cover as Blobs (slice — no full copy into memory)
        const audioBlob = audioLen > 0
            ? new Blob([await readFileSlice(file, offset, audioLen)], { type: 'audio/flac' })
            : new Blob([]);
        offset += audioLen;

        const coverBlob = coverLen > 0
            ? new Blob([await readFileSlice(file, offset, coverLen)], { type: 'image/jpeg' })
            : null;
        offset += coverLen;

        // Write to IndexedDB
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_TRACKS, 'readwrite');
            tx.objectStore(STORE_TRACKS).put({
                id: parsed.id,
                metadata: parsed.metadata,
                audioBlob,
                coverBlob,
                savedAt: parsed.savedAt || Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });

        imported++;
        if (onProgress) onProgress(i + 1, count);
    }

    window.dispatchEvent(new CustomEvent('offline-tracks-changed'));
    return { imported, skipped, total: count };
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
