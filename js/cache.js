//js/cache.js
export class APICache {
    constructor(options = {}) {
        this.memoryCache = new Map();
        this.maxSize = options.maxSize || 200;
        this.ttl = options.ttl || 1000 * 60 * 30;
        this.dbName = 'monochrome-cache';
        this.dbVersion = 1;
        this.db = null;
        this.initDB();
    }

    async initDB() {
        if (typeof indexedDB === 'undefined') return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('responses')) {
                    const store = db.createObjectStore('responses', { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    generateKey(type, params) {
        const paramString = typeof params === 'object' ? JSON.stringify(params) : String(params);
        return `${type}:${paramString}`;
    }

    async get(type, params) {
        const key = this.generateKey(type, params);

        if (this.memoryCache.has(key)) {
            const cached = this.memoryCache.get(key);
            if (Date.now() - cached.timestamp < this.ttl) {
                return cached.data;
            }
            this.memoryCache.delete(key);
        }

        if (this.db) {
            try {
                const cached = await this.getFromIndexedDB(key);
                if (cached && Date.now() - cached.timestamp < this.ttl) {
                    this.memoryCache.set(key, cached);
                    return cached.data;
                }
            } catch (error) {
                console.log('IndexedDB read error:', error);
            }
        }

        return null;
    }

    async set(type, params, data) {
        const key = this.generateKey(type, params);
        const entry = {
            key,
            data,
            timestamp: Date.now(),
        };

        this.memoryCache.set(key, entry);

        if (this.memoryCache.size > this.maxSize) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }

        if (this.db) {
            try {
                await this.setInIndexedDB(entry);
            } catch (error) {
                console.log('IndexedDB write error:', error);
            }
        }
    }

    getFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve(null);
                return;
            }

            const transaction = this.db.transaction(['responses'], 'readonly');
            const store = transaction.objectStore('responses');
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    setInIndexedDB(entry) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }

            const transaction = this.db.transaction(['responses'], 'readwrite');
            const store = transaction.objectStore('responses');
            const request = store.put(entry);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear() {
        this.memoryCache.clear();

        if (this.db) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['responses'], 'readwrite');
                const store = transaction.objectStore('responses');
                const request = store.clear();

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
    }

    async clearExpired() {
        const now = Date.now();
        const expired = [];

        for (const [key, entry] of this.memoryCache.entries()) {
            if (now - entry.timestamp >= this.ttl) {
                expired.push(key);
            }
        }

        expired.forEach((key) => this.memoryCache.delete(key));

        if (this.db) {
            try {
                const transaction = this.db.transaction(['responses'], 'readwrite');
                const store = transaction.objectStore('responses');
                const index = store.index('timestamp');
                const range = IDBKeyRange.upperBound(now - this.ttl);
                const request = index.openCursor(range);

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    }
                };
            } catch (error) {
                console.log('Failed to clear expired IndexedDB entries:', error);
            }
        }
    }

    getCacheStats() {
        return {
            memoryEntries: this.memoryCache.size,
            maxSize: this.maxSize,
            ttl: this.ttl,
        };
    }
}
