export class MusicDatabase {
    constructor() {
        this.dbName = 'MonochromeDB';
        this.version = 7;
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                console.error('Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Favorites stores
                if (!db.objectStoreNames.contains('favorites_tracks')) {
                    const store = db.createObjectStore('favorites_tracks', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_albums')) {
                    const store = db.createObjectStore('favorites_albums', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_artists')) {
                    const store = db.createObjectStore('favorites_artists', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_playlists')) {
                    const store = db.createObjectStore('favorites_playlists', { keyPath: 'uuid' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_mixes')) {
                    const store = db.createObjectStore('favorites_mixes', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('history_tracks')) {
                    const store = db.createObjectStore('history_tracks', { keyPath: 'timestamp' });
                    store.createIndex('timestamp', 'timestamp', { unique: true });
                }
                if (!db.objectStoreNames.contains('user_playlists')) {
                    const store = db.createObjectStore('user_playlists', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('user_folders')) {
                    const store = db.createObjectStore('user_folders', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
            };
        });
    }

    // Generic Helper
    async performTransaction(storeName, mode, callback) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);

            transaction.oncomplete = () => {
                resolve(request?.result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    // History API
    async addToHistory(track) {
        const storeName = 'history_tracks';
        const minified = this._minifyItem('track', track);
        const timestamp = Date.now();
        const entry = { ...minified, timestamp };

        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const index = store.index('timestamp');

            // Check the most recent entry
            const cursorReq = index.openCursor(null, 'prev');

            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const lastTrack = cursor.value;
                    if (lastTrack.id === track.id) {
                        // If same track, delete the old entry so we just update the timestamp
                        store.delete(cursor.primaryKey);
                    }
                }
                // Add the new entry
                store.put(entry);
            };

            cursorReq.onerror = (_e) => {
                // If cursor fails, just try to put (fallback)
                store.put(entry);
            };

            transaction.oncomplete = () => resolve(entry);
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    async getHistory() {
        const storeName = 'history_tracks';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index('timestamp');
            const request = index.getAll();

            request.onsuccess = () => {
                // Return reversed (newest first)
                resolve(request.result.reverse());
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearHistory() {
        const storeName = 'history_tracks';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Favorites API
    async toggleFavorite(type, item) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        const key = type === 'playlist' ? item.uuid : item.id;
        const exists = await this.isFavorite(type, key);

        if (exists) {
            await this.performTransaction(storeName, 'readwrite', (store) => store.delete(key));
            return false; // Removed
        } else {
            const minified = this._minifyItem(type, item);
            const entry = { ...minified, addedAt: Date.now() };
            await this.performTransaction(storeName, 'readwrite', (store) => store.put(entry));
            return true; // Added
        }
    }

    async isFavorite(type, id) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        try {
            const result = await this.performTransaction(storeName, 'readonly', (store) => store.get(id));
            return !!result;
        } catch {
            return false;
        }
    }

    async getFavorites(type) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result;
                results.sort((a, b) => {
                    const aTime = a.addedAt || 0;
                    const bTime = b.addedAt || 0;
                    return bTime - aTime; // Newest first
                });
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    _minifyItem(type, item) {
        if (!item) return item;

        // Base properties to keep
        const base = {
            id: item.id,
            addedAt: item.addedAt || null,
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                // Keep minimal artist info
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                // Keep minimal album info
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                          mediaMetadata: item.album.mediaMetadata ? { tags: item.album.mediaMetadata.tags } : null,
                      }
                    : null,
                copyright: item.copyright || null,
                isrc: item.isrc || null,
                trackNumber: item.trackNumber || null,
                // Fallback date
                streamStartDate: item.streamStartDate || null,
                // Keep version if exists
                version: item.version || null,
                // Keep mix info
                mixes: item.mixes || null,
                isTracker: item.isTracker || (item.id && String(item.id).startsWith('tracker-')),
                trackerInfo: item.trackerInfo || null,
                audioUrl: item.remoteUrl || item.audioUrl || null,
                remoteUrl: item.remoteUrl || null,
                audioQuality: item.audioQuality || null,
                mediaMetadata: item.mediaMetadata ? { tags: item.mediaMetadata.tags } : null,
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                // UI uses singular 'artist'
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
                // Keep type and track count for UI labels
                type: item.type || null,
                numberOfTracks: item.numberOfTracks || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null, // Handle both just in case
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || item.createdAt || null,
                title: item.title || item.name || null,
                // UI checks squareImage || image || uuid
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                user: item.user ? { name: item.user.name || null } : null,
            };
        }

        if (type === 'mix') {
            return {
                id: item.id,
                addedAt: item.addedAt,
                title: item.title,
                subTitle: item.subTitle,
                description: item.description,
                mixType: item.mixType,
                cover: item.cover,
            };
        }

        return item;
    }

    async exportData() {
        const tracks = await this.getFavorites('track');
        const albums = await this.getFavorites('album');
        const artists = await this.getFavorites('artist');
        const playlists = await this.getFavorites('playlist');
        const mixes = await this.getFavorites('mix');
        const history = await this.getHistory();

        const userPlaylists = await this.getPlaylists(true);
        const userFolders = await this.getFolders();
        const data = {
            favorites_tracks: tracks.map((t) => this._minifyItem('track', t)),
            favorites_albums: albums.map((a) => this._minifyItem('album', a)),
            favorites_artists: artists.map((a) => this._minifyItem('artist', a)),
            favorites_playlists: playlists.map((p) => this._minifyItem('playlist', p)),
            favorites_mixes: mixes.map((m) => this._minifyItem('mix', m)),
            history_tracks: history.map((t) => this._minifyItem('track', t)),
            user_playlists: userPlaylists,
            user_folders: userFolders,
        };
        return data;
    }

    async importData(data, clear = false) {
        const db = await this.open();

        const importStore = async (storeName, items) => {
            if (items === undefined) return false;

            let itemsArray = Array.isArray(items) ? items : Object.values(items || {});

            console.log(`Importing to ${storeName}: ${itemsArray.length} items`);

            if (itemsArray.length === 0) {
                if (clear) {
                    return new Promise((resolve, reject) => {
                        const transaction = db.transaction(storeName, 'readwrite');
                        const store = transaction.objectStore(storeName);

                        const countReq = store.count();
                        countReq.onsuccess = () => {
                            if (countReq.result > 0) {
                                store.clear();
                            }
                        };

                        transaction.oncomplete = () => {
                            resolve(countReq.result > 0);
                        };
                        transaction.onerror = () => reject(transaction.error);
                    });
                }
                return false;
            }

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);

                // force clear on first sync
                console.log(`Clearing ${storeName} to Make Sure Everythings Good`);
                store.clear();

                itemsArray.forEach((item) => {
                    if (item.id && typeof item.id === 'string' && !isNaN(item.id)) {
                        item.id = parseInt(item.id, 10);
                    }
                    if (item.album?.id && typeof item.album.id === 'string' && !isNaN(item.album.id)) {
                        item.album.id = parseInt(item.album.id, 10);
                    }
                    if (item.artists) {
                        item.artists.forEach((artist) => {
                            if (artist.id && typeof artist.id === 'string' && !isNaN(artist.id)) {
                                artist.id = parseInt(artist.id, 10);
                            }
                        });
                    }

                    console.log(`${storeName}: Adding item with ID ${item.id || item.uuid || item.timestamp}`);

                    // Critical: Ensure key exists for IndexedDB store.put()
                    const keyPath = store.keyPath;
                    if (keyPath && !item[keyPath]) {
                        console.warn(`Item missing keyPath "${keyPath}" in ${storeName}, generating fallback.`);
                        if (keyPath === 'uuid') item.uuid = crypto.randomUUID();
                        else if (keyPath === 'id')
                            item.id = item.trackId || item.albumId || item.artistId || Date.now() + Math.random();
                        else if (keyPath === 'timestamp') item.timestamp = Date.now() + Math.random();
                    }

                    store.put(item);
                });

                transaction.oncomplete = () => {
                    console.log(`${storeName}: Imported ${itemsArray.length} items`);
                    resolve(true);
                };

                transaction.onerror = (event) => {
                    console.error(`${storeName}: Transaction error:`, event.target.error);
                    reject(transaction.error);
                };
            });
        };

        console.log('Starting import with data:', {
            tracks: data.favorites_tracks?.length || 0,
            albums: data.favorites_albums?.length || 0,
            artists: data.favorites_artists?.length || 0,
            playlists: data.favorites_playlists?.length || 0,
            mixes: data.favorites_mixes?.length || 0,
            history: data.history_tracks?.length || 0,
            userPlaylists: data.user_playlists?.length || 0,
            user_folders: data.user_folders?.length || 0,
        });

        const results = await Promise.all([
            importStore('favorites_tracks', data.favorites_tracks),
            importStore('favorites_albums', data.favorites_albums),
            importStore('favorites_artists', data.favorites_artists),
            importStore('favorites_playlists', data.favorites_playlists),
            importStore('favorites_mixes', data.favorites_mixes),
            importStore('history_tracks', data.history_tracks),
            data.user_playlists ? importStore('user_playlists', data.user_playlists) : Promise.resolve(false),
            data.user_folders ? importStore('user_folders', data.user_folders) : Promise.resolve(false),
        ]);

        console.log('Import results:', results);
        return results.some((r) => r);
    }

    _updatePlaylistMetadata(playlist) {
        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;

        if (!playlist.cover) {
            const uniqueCovers = [];
            const seenCovers = new Set();
            const tracks = playlist.tracks || [];
            for (const track of tracks) {
                const cover = track.album?.cover;
                if (cover && !seenCovers.has(cover)) {
                    seenCovers.add(cover);
                    uniqueCovers.push(cover);
                    if (uniqueCovers.length >= 4) break;
                }
            }
            playlist.images = uniqueCovers;
        }
        return playlist;
    }

    _dispatchPlaylistSync(action, playlist) {
        window.dispatchEvent(
            new CustomEvent('sync-playlist-change', {
                detail: { action, playlist },
            })
        );
    }

    // User Playlists API
    async createPlaylist(name, tracks = [], cover = '') {
        const id = crypto.randomUUID();
        const playlist = {
            id: id,
            name: name,
            tracks: tracks.map((t) => this._minifyItem('track', { ...t, addedAt: Date.now() })),
            cover: cover,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            numberOfTracks: tracks.length,
            images: [], // Initialize images
        };
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        // TRIGGER SYNC
        this._dispatchPlaylistSync('create', playlist);

        return playlist;
    }

    async addTrackToPlaylist(playlistId, track) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        const trackWithDate = { ...track, addedAt: Date.now() };
        const minifiedTrack = this._minifyItem('track', trackWithDate);
        if (playlist.tracks.some((t) => t.id === track.id)) return;
        playlist.tracks.push(minifiedTrack);
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async addTracksToPlaylist(playlistId, tracks) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];

        let addedCount = 0;
        for (const track of tracks) {
            if (!playlist.tracks.some((t) => t.id === track.id)) {
                const trackWithDate = { ...track, addedAt: Date.now() };
                playlist.tracks.push(this._minifyItem('track', trackWithDate));
                addedCount++;
            }
        }

        if (addedCount > 0) {
            playlist.updatedAt = Date.now();
            this._updatePlaylistMetadata(playlist);
            await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
            this._dispatchPlaylistSync('update', playlist);
        }

        return playlist;
    }

    async removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        playlist.tracks = playlist.tracks.filter((t) => t.id != trackId);
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async deletePlaylist(playlistId) {
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.delete(playlistId));

        // TRIGGER SYNC (but for deleting)
        this._dispatchPlaylistSync('delete', { id: playlistId });
    }

    async getPlaylist(playlistId) {
        return await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
    }

    async updatePlaylist(playlist) {
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async addPlaylistToFolder(folderId, playlistId) {
        const folder = await this.getFolder(folderId);
        if (!folder) throw new Error('Folder not found');
        folder.playlists = folder.playlists || [];
        if (!folder.playlists.includes(playlistId)) {
            folder.playlists.push(playlistId);
            folder.updatedAt = Date.now();
            await this.performTransaction('user_folders', 'readwrite', (store) => store.put(folder));
        }
        return folder;
    }

    // User Folders API
    async createFolder(name, cover = '') {
        const id = crypto.randomUUID();
        const folder = {
            id: id,
            name: name,
            cover: cover,
            playlists: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await this.performTransaction('user_folders', 'readwrite', (store) => store.put(folder));
        return folder;
    }

    async getFolders() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_folders', 'readonly');
            const store = transaction.objectStore('user_folders');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    async getFolder(id) {
        return await this.performTransaction('user_folders', 'readonly', (store) => store.get(id));
    }

    async deleteFolder(id) {
        await this.performTransaction('user_folders', 'readwrite', (store) => store.delete(id));
    }

    async getPlaylists(includeTracks = false) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readwrite'); // Changed to readwrite for lazy migration
            const store = transaction.objectStore('user_playlists');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => {
                const playlists = request.result.reverse(); // Newest first
                const processedPlaylists = playlists.map((playlist) => {
                    let needsUpdate = false;

                    // Lazy migration for numberOfTracks
                    if (typeof playlist.numberOfTracks === 'undefined') {
                        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;
                        needsUpdate = true;
                    }

                    // Lazy migration for images (collage)
                    if (!playlist.cover && (!playlist.images || playlist.images.length === 0)) {
                        this._updatePlaylistMetadata(playlist);
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        // We are in a readwrite transaction, so we can put back
                        try {
                            store.put(playlist);
                        } catch (e) {
                            console.warn('Failed to update playlist metadata', e);
                        }
                    }

                    if (includeTracks) {
                        return playlist;
                    }

                    // Return lightweight copy without tracks
                    // eslint-disable-next-line no-unused-vars
                    const { tracks, ...minified } = playlist;
                    return minified;
                });
                resolve(processedPlaylists);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updatePlaylistName(playlistId, newName) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.name = newName;
        playlist.updatedAt = Date.now();
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }

    async updatePlaylistTracks(playlistId, tracks) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readwrite');
            const store = transaction.objectStore('user_playlists');

            const getRequest = store.get(playlistId);
            getRequest.onsuccess = () => {
                const playlist = getRequest.result;
                if (!playlist) {
                    reject(new Error('Playlist not found'));
                    return;
                }
                playlist.tracks = tracks;
                playlist.updatedAt = Date.now();
                this._updatePlaylistMetadata(playlist);
                const putRequest = store.put(playlist);
                putRequest.onsuccess = () => {
                    resolve(playlist);
                };
                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };
            getRequest.onerror = () => {
                reject(getRequest.error);
            };

            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async saveSetting(key, value) {
        await this.performTransaction('settings', 'readwrite', (store) => store.put(value, key));
    }

    async getSetting(key) {
        return await this.performTransaction('settings', 'readonly', (store) => store.get(key));
    }
}

export const db = new MusicDatabase();
