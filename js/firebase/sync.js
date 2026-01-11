// js/firebase/sync.js
import { database } from './config.js';
import {
    ref,
    get,
    set,
    update,
    onValue,
    off,
    child,
    remove,
    runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { db } from '../db.js';

export class SyncManager {
    constructor() {
        this.user = null;
        this.userRef = null;
        this.unsubscribeFunctions = [];
        this.isSyncing = false;
    }

    initialize(user) {
        if (!database || !user) return;
        this.user = user;
        this.userRef = ref(database, `users/${user.uid}`);

        console.log('Initializing SyncManager for user:', user.uid);
        this.performInitialSync();
    }

    disconnect() {
        if (this.userRef) {
            // Remove listeners
            this.unsubscribeFunctions.forEach((unsub) => unsub());
            this.unsubscribeFunctions = [];
        }
        this.user = null;
        this.userRef = null;
        console.log('SyncManager disconnected');
    }

    async performInitialSync() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            console.log('Starting initial sync...');

            // 1. Fetch Cloud Data
            const snapshot = await get(this.userRef);
            const cloudData = snapshot.val() || {};
            const deletedPlaylists = cloudData.deleted_playlists || {};

            // 2. Fetch Local Data
            const localData = await db.exportData();

            // Filter out deleted playlists from local data
            if (localData.user_playlists && Array.isArray(localData.user_playlists)) {
                localData.user_playlists = localData.user_playlists.filter((p) => !deletedPlaylists[p.id]);
            }

            // 3. Merge Data (Union Strategy)
            const mergedData = this.mergeData(localData, cloudData);

            // 4. Update Cloud (if different)
            // We optimize by just rewriting the whole node for simplicity in Phase 1,
            // or we could diff. Rewriting is safer for "Initial Merge".
            await update(this.userRef, mergedData);

            // 5. Update Local (Import merged data)
            // Convert Cloud Schema back to Local Schema for IndexedDB
            const importData = {
                favorites_tracks: mergedData.library?.tracks ? Object.values(mergedData.library.tracks) : [],
                favorites_albums: mergedData.library?.albums ? Object.values(mergedData.library.albums) : [],
                favorites_artists: mergedData.library?.artists ? Object.values(mergedData.library.artists) : [],
                favorites_playlists: mergedData.library?.playlists ? Object.values(mergedData.library.playlists) : [],
                history_tracks: mergedData.history?.recentTracks ? Object.values(mergedData.history.recentTracks) : [],
                user_playlists: mergedData.user_playlists ? Object.values(mergedData.user_playlists) : [],
            };

            await db.importData(importData, true);

            console.log('Initial sync complete.');

            // 6. Setup Listeners for future changes
            this.setupListeners();
        } catch (error) {
            console.error('Initial sync failed:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    mergeData(local, cloud) {
        // Helper to merge lists of objects based on ID/UUID
        // We assume 'favorites_*' structure from db.exportData()

        const mergeStores = (localItems, cloudItems, idKey = 'id') => {
            const map = new Map();

            // Add all local items
            if (Array.isArray(localItems)) {
                localItems.forEach((item) => map.set(item[idKey], item));
            } else if (localItems && typeof localItems === 'object') {
                // Handle case where cloud stores as object keys
                Object.values(localItems).forEach((item) => map.set(item[idKey], item));
            }

            // Add/Overwrite with cloud items (Union Strategy)
            if (cloudItems) {
                if (Array.isArray(cloudItems)) {
                    cloudItems.forEach((item) => map.set(item[idKey], item));
                } else {
                    Object.keys(cloudItems).forEach((key) => {
                        const val = cloudItems[key];
                        if (typeof val === 'object') {
                            map.set(val[idKey] || key, val);
                        }
                    });
                }
            }

            return Array.from(map.values());
        };

        const merged = {
            library: {
                tracks: this.arrayToObject(mergeStores(local.favorites_tracks, cloud.library?.tracks), 'id'),
                albums: this.arrayToObject(mergeStores(local.favorites_albums, cloud.library?.albums), 'id'),
                artists: this.arrayToObject(mergeStores(local.favorites_artists, cloud.library?.artists), 'id'),
                playlists: this.arrayToObject(
                    mergeStores(local.favorites_playlists, cloud.library?.playlists, 'uuid'),
                    'uuid'
                ),
            },
            history: {
                recentTracks: this.arrayToObject(
                    mergeStores(local.history_tracks, cloud.history?.recentTracks, 'timestamp'),
                    'timestamp'
                ),
            },
            user_playlists: this.arrayToObject(mergeStores(local.user_playlists, cloud.user_playlists), 'id'),
            // Settings are NOT synced (device specific)
            lastUpdated: Date.now(),
        };

        // Transform back to local structure for db.importData
        return merged;
    }

    // Helper to convert array to object with keys
    arrayToObject(arr, keyField) {
        const obj = {};
        arr.forEach((item) => {
            if (item && item[keyField]) {
                obj[item[keyField]] = item;
            }
        });
        return obj;
    }

    setupListeners() {
        // Listen for changes in library
        const libraryRef = child(this.userRef, 'library');

        const unsubLibrary = onValue(libraryRef, (snapshot) => {
            if (this.isSyncing) return;

            const val = snapshot.val();
            if (val) {
                const importData = {
                    favorites_tracks: val.tracks ? Object.values(val.tracks) : [],
                    favorites_albums: val.albums ? Object.values(val.albums) : [],
                    favorites_artists: val.artists ? Object.values(val.artists) : [],
                    favorites_playlists: val.playlists ? Object.values(val.playlists) : [],
                };
                db.importData(importData, true).then(() => {
                    // Notify UI to refresh
                    window.dispatchEvent(new Event('library-changed'));
                });
            }
        });

        this.unsubscribeFunctions.push(() => off(libraryRef, 'value', unsubLibrary));

        // Listen for changes in history
        const historyRef = child(this.userRef, 'history/recentTracks');

        const unsubHistory = onValue(historyRef, (snapshot) => {
            if (this.isSyncing) return;

            const val = snapshot.val();
            if (val) {
                const importData = {
                    history_tracks: Object.values(val),
                };
                db.importData(importData, true).then(() => {
                    // Notify UI to refresh
                    window.dispatchEvent(new Event('history-changed'));
                });
            }
        });

        this.unsubscribeFunctions.push(() => off(historyRef, 'value', unsubHistory));

        // Listen for changes in user playlists
        const userPlaylistsRef = child(this.userRef, 'user_playlists');

        const unsubUserPlaylists = onValue(userPlaylistsRef, (snapshot) => {
            if (this.isSyncing) return;

            const val = snapshot.val();
            if (val) {
                const importData = {
                    user_playlists: Object.values(val),
                };
                db.importData(importData, true).then(() => {
                    // Notify UI to refresh library
                    window.dispatchEvent(new Event('library-changed'));
                });
            }
        });

        this.unsubscribeFunctions.push(() => off(userPlaylistsRef, 'value', unsubUserPlaylists));
    }

    // --- Public API for Broadcasters ---

    async syncLibraryItem(type, item, isAdded) {
        if (!this.user || !this.userRef) return;

        // type: 'track', 'album', 'artist', 'playlist'
        // item: the object (minified preferably)
        // isAdded: boolean

        const categoryMap = {
            track: 'tracks',
            album: 'albums',
            artist: 'artists',
            playlist: 'playlists',
        };
        const category = categoryMap[type];
        if (!category) return;

        const id = type === 'playlist' ? item.uuid : item.id;
        const path = `library/${category}/${id}`;
        const itemRef = child(this.userRef, path);

        if (isAdded) {
            // Minify to ensure consistency and reduce bandwidth
            // We use the db helper to ensure consistent structure
            const minified = db._minifyItem(type, item);
            // Ensure addedAt is present. If the passed item didn't have it (e.g. from player),
            // we add it now. Ideally this matches local DB time, but a small diff is negligible.
            const entry = {
                ...minified,
                addedAt: item.addedAt || minified.addedAt || Date.now(),
            };
            await set(itemRef, entry);
        } else {
            await remove(itemRef);
        }
    }

    async syncHistoryItem(track) {
        if (!this.user || !this.userRef || !track.timestamp) return;

        const itemRef = child(this.userRef, `history/recentTracks/${track.timestamp}`);
        try {
            await set(itemRef, track);
        } catch (error) {
            console.error('Failed to sync history item:', error);
        }
    }

    async syncUserPlaylist(playlist, action) {
        if (!this.user || !this.userRef) return;

        const id = playlist.id;
        const path = `user_playlists/${id}`;
        const itemRef = child(this.userRef, path);

        if (action === 'create' || action === 'update') {
            await set(itemRef, playlist);
            // Ensure it's not in deleted_playlists (just in case)
            const deletedRef = child(this.userRef, `deleted_playlists/${id}`);
            await remove(deletedRef);
        } else if (action === 'delete') {
            await remove(itemRef);
            // Add tombstone
            const deletedRef = child(this.userRef, `deleted_playlists/${id}`);
            await set(deletedRef, { timestamp: Date.now() });
        }
    }

    async clearCloudData() {
        if (!this.user || !this.userRef) {
            throw new Error('Not authenticated');
        }
        await remove(this.userRef);
    }

    // Public Playlist API

    async publishPlaylist(playlist) {
        if (!this.user) throw new Error('Not authenticated');

        const minified = db._minifyItem('playlist', playlist);
        const playlistId = playlist.id || playlist.uuid;

        if (!playlistId) throw new Error('Invalid playlist ID');

        // Ensure playlist has necessary data
        const publicData = {
            ...minified,
            uid: this.user.uid,
            originalId: playlistId,
            publishedAt: Date.now(),
            tracks: playlist.tracks ? playlist.tracks.map((t) => db._minifyItem('track', t)) : [],
        };

        // Use a global 'public_playlists' node
        const publicRef = ref(database, `public_playlists/${playlistId}`);
        await set(publicRef, publicData);
    }

    async unpublishPlaylist(playlistId) {
        if (!this.user) throw new Error('Not authenticated');
        const publicRef = ref(database, `public_playlists/${playlistId}`);
        await remove(publicRef);
    }

    async getPublicPlaylist(playlistId) {
        if (!database) {
            console.warn('[Sync] Database not initialized, cannot fetch public playlist');
            return null;
        }
        try {
            const publicRef = ref(database, `public_playlists/${playlistId}`);
            const snapshot = await get(publicRef);
            if (!snapshot.exists()) {
                console.warn(`[Sync] Public playlist ${playlistId} not found in database.`);
                return null;
            }
            const data = snapshot.val();
            console.log(`[Sync] Public playlist fetch for ${playlistId}: Found`);
            return data;
        } catch (error) {
            console.error('[Sync] Failed to fetch public playlist:', error);
            return null;
        }
    }
}

export const syncManager = new SyncManager();
