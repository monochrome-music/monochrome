// js/offline.js — Offline Music Storage Manager
// Stores audio blobs + track metadata in IndexedDB for fully offline playback.

const DB_NAME = 'MonochromeOfflineDB';
const DB_VERSION = 1;
const STORE_TRACKS = 'offline_tracks'; // { id, metadata, audioBlob, coverBlob, savedAt }
const BACKUP_MAGIC = 0x4D434241;
const BACKUP_VERSION = 1;
const BACKUP_HEADER_BYTES = 12;
const BACKUP_ENTRY_HEADER_BYTES = 12;

let _db = null;

function emitBackupProgress(onProgress, progress) {
    if (typeof onProgress !== 'function') return;
    if (onProgress.length >= 2) {
        onProgress(progress.processed, progress.total, progress);
        return;
    }
    onProgress(progress);
}

function createBackupProgress(phase, processed, total, bytesProcessed = 0, totalBytes = 0) {
    const normalizedTotal = Math.max(total, 1);
    const percent = totalBytes > 0
        ? Math.min(100, Math.round((bytesProcessed / totalBytes) * 100))
        : Math.min(100, Math.round((processed / normalizedTotal) * 100));

    return {
        phase,
        processed,
        total,
        bytesProcessed,
        totalBytes,
        percent,
    };
}

function getSerializedBackupMetadata(entry, encoder) {
    return encoder.encode(JSON.stringify({
        id: entry.id,
        metadata: entry.metadata,
        savedAt: entry.savedAt,
    }));
}

function getBackupEntrySize(metaBytes, audioSize, coverSize) {
    return BACKUP_ENTRY_HEADER_BYTES + metaBytes.byteLength + audioSize + coverSize;
}

/**
 * Get the byte size of data regardless of type (Blob, ArrayBuffer, Uint8Array, etc.).
 * IndexedDB on mobile browsers may return any of these types.
 */
function getDataSize(data) {
    if (!data) return 0;
    if (typeof data.size === 'number') return data.size;           // Blob
    if (typeof data.byteLength === 'number') return data.byteLength; // ArrayBuffer / TypedArray
    return 0;
}

/**
 * Convert any data type from IndexedDB into a Uint8Array.
 * Handles Blob, ArrayBuffer, Uint8Array, and other typed arrays.
 */
async function toUint8Array(data) {
    if (!data) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return new Uint8Array(0);
}

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
        total += getDataSize(t.audioBlob);
        total += getDataSize(t.coverBlob);
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
 * Get keys of tracks that have NOT been backed up yet.
 */
async function getUnbackedUpKeys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRACKS, 'readonly');
        const req = tx.objectStore(STORE_TRACKS).getAll();
        req.onsuccess = () => {
            const unbacked = req.result
                .filter(entry => !entry.backedUpAt)
                .map(entry => entry.id);
            resolve(unbacked);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get count of tracks not yet included in any backup.
 */
export async function getUnbackedUpCount() {
    const keys = await getUnbackedUpKeys();
    return keys.length;
}

/**
 * Stamp exported tracks with backedUpAt so they are skipped in future
 * incremental exports.
 */
export async function markTracksBackedUp(trackKeys) {
    if (!trackKeys || trackKeys.length === 0) return;
    const db = await openDB();
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(STORE_TRACKS);
    const now = Date.now();

    for (const key of trackKeys) {
        const entry = await new Promise((res, rej) => {
            const r = store.get(key);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        if (entry) {
            entry.backedUpAt = now;
            store.put(entry);
        }
    }

    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Export offline tracks to .mcbackup file(s).
 * Fetches one track at a time by key to keep memory low.
 *
 * Format: [MAGIC 4B][VERSION 4B][COUNT 4B] then per track:
 *   [metaLen 4B][audioLen 4B][coverLen 4B][meta JSON][audio bytes][cover bytes]
 *
 * Desktop (File System Access API): streams directly to disk — any size.
 * Mobile (Blob fallback): single-pass with auto-chunking at ~500 MB per file.
 *   Each chunk is a standalone .mcbackup that can be imported independently.
 */
const BLOB_CHUNK_BYTES = 500 * 1024 * 1024; // 500 MB per chunk for Blob downloads

function buildBackupHeader(trackCount) {
    const header = new ArrayBuffer(BACKUP_HEADER_BYTES);
    const hv = new DataView(header);
    hv.setUint32(0, BACKUP_MAGIC);
    hv.setUint32(4, BACKUP_VERSION);
    hv.setUint32(8, trackCount);
    return header;
}

function buildEntryLengths(metaLen, audioSize, coverSize) {
    const buf = new ArrayBuffer(BACKUP_ENTRY_HEADER_BYTES);
    const lv = new DataView(buf);
    lv.setUint32(0, metaLen);
    lv.setUint32(4, audioSize);
    lv.setUint32(8, coverSize);
    return buf;
}

export async function exportOfflineTracks(onProgress, { incremental = false } = {}) {
    const keys = incremental ? await getUnbackedUpKeys() : await getAllOfflineKeys();
    if (keys.length === 0) {
        throw new Error(incremental ? 'All tracks are already backed up' : 'No offline tracks to export');
    }

    const encoder = new TextEncoder();
    const count = keys.length;

    // ── Desktop: streaming export via File System Access API (any size) ──
    if (window.showSaveFilePicker) {
        // Pre-calculate total size for accurate progress + verification
        let totalBytes = BACKUP_HEADER_BYTES;
        emitBackupProgress(onProgress, createBackupProgress('preparing', 0, count, 0, 0));

        for (let i = 0; i < count; i++) {
            const entry = await getOfflineTrack(keys[i]);
            if (!entry) throw new Error('Failed to read one or more offline tracks for export');
            const metaBytes = getSerializedBackupMetadata(entry, encoder);
            totalBytes += getBackupEntrySize(metaBytes, getDataSize(entry.audioBlob), getDataSize(entry.coverBlob));
        }

        try {
            const date = new Date().toISOString().slice(0, 10);
            const handle = await window.showSaveFilePicker({
                suggestedName: `monochrome-offline-${date}.mcbackup`,
                types: [{ description: 'Monochrome Backup', accept: { 'application/octet-stream': ['.mcbackup'] } }],
            });
            const writable = await handle.createWritable();
            let bytesWritten = 0;

            await writable.write(buildBackupHeader(count));
            bytesWritten += BACKUP_HEADER_BYTES;
            emitBackupProgress(onProgress, createBackupProgress('writing', 0, count, bytesWritten, totalBytes));

            for (let i = 0; i < count; i++) {
                const entry = await getOfflineTrack(keys[i]);
                if (!entry) throw new Error('Failed to read one or more offline tracks for export');

                const metaBytes = getSerializedBackupMetadata(entry, encoder);
                const audioBytes = await toUint8Array(entry.audioBlob);
                const coverBytes = await toUint8Array(entry.coverBlob);
                const audioSize = audioBytes.byteLength;
                const coverSize = coverBytes.byteLength;

                await writable.write(buildEntryLengths(metaBytes.byteLength, audioSize, coverSize));
                await writable.write(metaBytes);
                if (audioSize > 0) await writable.write(audioBytes);
                if (coverSize > 0) await writable.write(coverBytes);
                bytesWritten += getBackupEntrySize(metaBytes, audioSize, coverSize);

                emitBackupProgress(onProgress, createBackupProgress('writing', i + 1, count, bytesWritten, totalBytes));
            }

            await writable.close();
            const savedFile = await handle.getFile();
            if (savedFile.size !== totalBytes) {
                throw new Error('Backup file verification failed. Please export again.');
            }
            emitBackupProgress(onProgress, createBackupProgress('verifying', count, count, totalBytes, totalBytes));
            return { blob: null, count, totalBytes, method: 'file-picker', verified: true, exportedKeys: keys };
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('Export cancelled');
            if (err.message?.includes('verification failed')) throw err;
            // Fall through to Blob approach
        }
    }

    // ── Mobile: single-pass chunked Blob export ──
    // Each track is read from IDB only once (no pre-calculation pass).
    // All data is normalized to Uint8Array to avoid mobile browser Blob quirks.
    // When a chunk exceeds BLOB_CHUNK_BYTES it's finalized as a standalone
    // .mcbackup file and a new chunk begins. Each chunk imports independently.
    const chunks = [];       // { blob, count, totalBytes }
    let parts = [];          // Uint8Array / ArrayBuffer parts only — no raw Blobs
    let chunkTrackCount = 0;
    let chunkBytes = BACKUP_HEADER_BYTES; // reserve space for header (prepended at finalize)

    emitBackupProgress(onProgress, createBackupProgress('writing', 0, count, 0, 0));

    const finalizeChunk = () => {
        // Prepend header with the actual track count for this chunk
        parts.unshift(new Uint8Array(buildBackupHeader(chunkTrackCount)));
        const blob = new Blob(parts, { type: 'application/octet-stream' });
        chunks.push({ blob, count: chunkTrackCount, totalBytes: blob.size });
        // Reset for next chunk
        parts = [];
        chunkTrackCount = 0;
        chunkBytes = BACKUP_HEADER_BYTES;
    };

    for (let i = 0; i < count; i++) {
        const entry = await getOfflineTrack(keys[i]);
        if (!entry) throw new Error('Failed to read one or more offline tracks for export');

        const metaBytes = getSerializedBackupMetadata(entry, encoder);
        // Normalize IDB data — may be Blob, ArrayBuffer or Uint8Array on different devices
        const audioBytes = await toUint8Array(entry.audioBlob);
        const coverBytes = await toUint8Array(entry.coverBlob);
        const audioSize = audioBytes.byteLength;
        const coverSize = coverBytes.byteLength;
        const entryBytes = getBackupEntrySize(metaBytes, audioSize, coverSize);

        // If this track would push the chunk past the limit, finalize first
        if (chunkTrackCount > 0 && chunkBytes + entryBytes > BLOB_CHUNK_BYTES) {
            finalizeChunk();
        }

        parts.push(new Uint8Array(buildEntryLengths(metaBytes.byteLength, audioSize, coverSize)));
        parts.push(metaBytes);
        if (audioSize > 0) parts.push(audioBytes);
        if (coverSize > 0) parts.push(coverBytes);
        chunkTrackCount++;
        chunkBytes += entryBytes;

        emitBackupProgress(onProgress, createBackupProgress('writing', i + 1, count));
    }

    // Finalize the last (or only) chunk
    if (chunkTrackCount > 0) {
        finalizeChunk();
    }

    const grandTotalBytes = chunks.reduce((sum, c) => sum + c.totalBytes, 0);
    emitBackupProgress(onProgress, createBackupProgress('verifying', count, count, grandTotalBytes, grandTotalBytes));

    // Single chunk — return the same shape as before for backward compat
    if (chunks.length === 1) {
        return { blob: chunks[0].blob, count, totalBytes: chunks[0].totalBytes, method: 'download', verified: true, exportedKeys: keys };
    }

    // Multiple chunks — caller (UI) will trigger one download per chunk
    return { blob: null, chunks, count, totalBytes: grandTotalBytes, method: 'chunked-download', verified: true, exportedKeys: keys };
}

/**
 * Read a slice of a File as an ArrayBuffer.
 */
function readFileSlice(file, start, length) {
    return file.slice(start, start + length).arrayBuffer();
}

async function readExactFileSlice(file, start, length, label) {
    if (length < 0 || start < 0 || start + length > file.size) {
        throw new Error(`Backup file is truncated while reading ${label}`);
    }

    const buffer = await readFileSlice(file, start, length);
    if (buffer.byteLength !== length) {
        throw new Error(`Backup file is truncated while reading ${label}`);
    }

    return buffer;
}

/**
 * Import offline tracks from a .mcbackup file.
 * Reads the file in slices (one track at a time) to keep memory low.
 * Deduplicates by track ID — skips tracks that already exist.
 */
export async function importOfflineTracks(file, onProgress, overwrite = false) {
    if (!file || file.size < BACKUP_HEADER_BYTES) {
        throw new Error('Backup file is missing or too small');
    }

    // Read header
    const headerBuf = await readExactFileSlice(file, 0, BACKUP_HEADER_BYTES, 'backup header');
    const headerView = new DataView(headerBuf);

    const magic = headerView.getUint32(0);
    if (magic !== BACKUP_MAGIC) throw new Error('Invalid backup file');
    const version = headerView.getUint32(4);
    if (version !== BACKUP_VERSION) throw new Error('Unsupported backup version');
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
    let offset = BACKUP_HEADER_BYTES;
    let imported = 0;
    let skipped = 0;
    const seenIds = new Set(); // catch duplicates within the file itself
    emitBackupProgress(onProgress, createBackupProgress('reading', 0, count, offset, file.size));

    for (let i = 0; i < count; i++) {
        // Read length header
        const lenBuf = await readExactFileSlice(file, offset, BACKUP_ENTRY_HEADER_BYTES, `backup entry ${i + 1} header`);
        const lenView = new DataView(lenBuf);
        const metaLen = lenView.getUint32(0);
        const audioLen = lenView.getUint32(4);
        const coverLen = lenView.getUint32(8);
        offset += BACKUP_ENTRY_HEADER_BYTES;

        // Read metadata
        const metaBuf = await readExactFileSlice(file, offset, metaLen, `backup entry ${i + 1} metadata`);
        let metaJson;
        let parsed;
        try {
            metaJson = decoder.decode(new Uint8Array(metaBuf));
            parsed = JSON.parse(metaJson);
        } catch {
            throw new Error(`Backup file is corrupted near track ${i + 1}`);
        }
        offset += metaLen;

        if (!parsed || typeof parsed !== 'object' || parsed.id === undefined || !parsed.metadata || typeof parsed.metadata !== 'object') {
            throw new Error(`Backup file is missing metadata for track ${i + 1}`);
        }
        const trackId = String(parsed.id);

        // Skip if duplicate within file or already exists in DB
        if (seenIds.has(trackId) || (!overwrite && existingIds.has(trackId))) {
            if (offset + audioLen + coverLen > file.size) {
                throw new Error(`Backup file is truncated while skipping track ${i + 1}`);
            }
            offset += audioLen + coverLen;
            skipped++;
            emitBackupProgress(onProgress, createBackupProgress('reading', i + 1, count, offset, file.size));
            continue;
        }
        seenIds.add(trackId);

        // Read audio and cover as Blobs (slice — no full copy into memory)
        const audioBlob = audioLen > 0
            ? new Blob([await readExactFileSlice(file, offset, audioLen, `audio data for track ${i + 1}`)], { type: 'audio/flac' })
            : new Blob([]);
        offset += audioLen;

        const coverBlob = coverLen > 0
            ? new Blob([await readExactFileSlice(file, offset, coverLen, `cover art for track ${i + 1}`)], { type: 'image/jpeg' })
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
        emitBackupProgress(onProgress, createBackupProgress('reading', i + 1, count, offset, file.size));
    }

    if (offset !== file.size) {
        throw new Error('Backup file has unexpected extra data and may be corrupted');
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
