export class MusicDatabase {
    constructor() {
        this.dbName = 'MonochromeDB';
        this.version = 2;
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

    // Favorites API
    async toggleFavorite(type, item) {
        const storeName = `favorites_${type}s`; // tracks, albums, artists
        const key = type === 'playlist' ? item.uuid : item.id;
        const exists = await this.isFavorite(type, key);

        if (exists) {
            await this.performTransaction(storeName, 'readwrite', (store) => store.delete(key));
            return false; // Removed
        } else {
            const entry = { ...item, addedAt: Date.now() };
            await this.performTransaction(storeName, 'readwrite', (store) => store.put(entry));
            return true; // Added
        }
    }

    async isFavorite(type, id) {
        const storeName = `favorites_${type}s`;
        try {
            const result = await this.performTransaction(storeName, 'readonly', (store) => store.get(id));
            return !!result;
        } catch (e) {
            return false;
        }
    }

    async getFavorites(type) {
        const storeName = `favorites_${type}s`;
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

    async exportData() {
        const data = {
            favorites_tracks: await this.getFavorites('track'),
            favorites_albums: await this.getFavorites('album'),
            favorites_artists: await this.getFavorites('artist'),
            favorites_playlists: await this.getFavorites('playlist')
        };
        return data;
    }

    async importData(data) {
        // Clear existing? Or merge? Prompt says "Sync" or "Export/Import".
        // Let's merge by put (replaces if ID exists).
        const db = await this.open();
        
        const importStore = async (storeName, items) => {
            if (!items || !Array.isArray(items)) return;
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            for (const item of items) {
                store.put(item);
            }
        };

        await importStore('favorites_tracks', data.favorites_tracks);
        await importStore('favorites_albums', data.favorites_albums);
        await importStore('favorites_artists', data.favorites_artists);
        await importStore('favorites_playlists', data.favorites_playlists);
    }
}

export const db = new MusicDatabase();
