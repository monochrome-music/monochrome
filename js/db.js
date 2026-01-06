export class MusicDatabase {
    constructor() {
        this.dbName = 'MonochromeDB';
        this.version = 5;
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                console.error("Database error:", event.target.error);
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
        // Use a unique timestamp even if called rapidly
        // (though unlikely to be <1ms for playback start)
        const entry = { ...minified, timestamp: Date.now() };

        const db = await this.open();
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);

        // Add new entry
        store.put(entry);

        return entry;
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
        } catch (e) {
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
            const index = store.index('addedAt');
            const request = index.getAll(); // Returns sorted by addedAt ascending

            request.onsuccess = () => {
                // Reverse to show newest first
                resolve(request.result.reverse());
            };
            request.onerror = () => reject(request.error);
        });
    }

    _minifyItem(type, item) {
        if (!item) return item;

        // Base properties to keep
        const base = {
            id: item.id,
            addedAt: item.addedAt || null
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title,
                duration: item.duration,
                explicit: item.explicit,
                // Keep minimal artist info
                artists: item.artists?.map(a => ({ id: a.id, name: a.name })) || [],
                // Keep minimal album info
                album: item.album ? {
                    id: item.album.id,
                    cover: item.album.cover,
                    releaseDate: item.album.releaseDate || null,
                    vibrantColor: item.album.vibrantColor || null
                } : null,
                // Fallback date
                streamStartDate: item.streamStartDate || null,
                // Keep version if exists
                version: item.version || null
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title,
                cover: item.cover,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit,
                // UI uses singular 'artist'
                artist: item.artist ? { name: item.artist.name, id: item.artist.id } : (item.artists?.[0] ? { name: item.artists[0].name, id: item.artists[0].id } : null),
                // Keep type and track count for UI labels
                type: item.type || null,
                numberOfTracks: item.numberOfTracks
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name,
                picture: item.picture || item.image || null // Handle both just in case
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid,
                addedAt: item.addedAt,
                title: item.title,
                // UI checks squareImage || image || uuid
                image: item.image || item.squareImage,
                numberOfTracks: item.numberOfTracks,
                user: item.user ? { name: item.user.name } : null
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
                cover: item.cover
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

        const userPlaylists = await this.getPlaylists();
        const data = {
            favorites_tracks: tracks.map(t => this._minifyItem('track', t)),
            favorites_albums: albums.map(a => this._minifyItem('album', a)),
            favorites_artists: artists.map(a => this._minifyItem('artist', a)),
            favorites_playlists: playlists.map(p => this._minifyItem('playlist', p)),
            favorites_mixes: mixes.map(m => this._minifyItem('mix', m)),
            history_tracks: history.map(t => this._minifyItem('track', t)),
            user_playlists: userPlaylists
        };
        return data;
    }

    async importData(data, clear = false) {
        // Let's merge by put (replaces if ID exists).
        const db = await this.open();

        const importStore = async (storeName, items) => {
            // If items is undefined, we skip this store (don't clear, don't update)
            // This allows partial updates (e.g. library only)
            if (items === undefined) return;

            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            if (clear) {
                store.clear();
            }

            for (const item of items) {
                store.put(item);
            }
        };

        await importStore('favorites_tracks', data.favorites_tracks);
        await importStore('favorites_albums', data.favorites_albums);
        await importStore('favorites_artists', data.favorites_artists);
        await importStore('favorites_playlists', data.favorites_playlists);
        await importStore('favorites_mixes', data.favorites_mixes);
        await importStore('history_tracks', data.history_tracks);
        if (data.user_playlists) {
            await importStore('user_playlists', data.user_playlists);
        }
    }

    // User Playlists API
    async createPlaylist(name, tracks = [], cover = '') {
        const id = crypto.randomUUID();
        const playlist = {
            id: id,
            name: name,
            tracks: tracks.map(t => this._minifyItem('track', t)),
            cover: cover,
            createdAt: Date.now()
        };
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }

    async addTrackToPlaylist(playlistId, track) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        const minifiedTrack = this._minifyItem('track', track);
        if (playlist.tracks.some(t => t.id === track.id)) return;
        playlist.tracks.push(minifiedTrack);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }

    async removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        playlist.tracks = playlist.tracks.filter(t => t.id !== trackId);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }

    async deletePlaylist(playlistId) {
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.delete(playlistId));
    }

    async getPlaylist(playlistId) {
        return await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
    }

    async getPlaylists() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readonly');
            const store = transaction.objectStore('user_playlists');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => {
                resolve(request.result.reverse()); // Newest first
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updatePlaylistName(playlistId, newName) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.name = newName;
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }
}

export const db = new MusicDatabase();
