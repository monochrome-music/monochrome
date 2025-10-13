export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances',
    defaultInstances: [
        'https://frankfurt.monochrome.tf/',
        'https://ohio.monochrome.tf/',
        'https://oregon.monochrome.tf/',
        'https://virginia.monochrome.tf/',
        'https://singapore.monochrome.tf/',
        'https://tokyo.monochrome.tf/',
        'https://hund.qqdl.site',
        'https://katze.qqdl.site',
        'https://maus.qqdl.site',
        'https://vogel.qqdl.site',
        'https://wolf.qqdl.site',
        'https://tidal.401658.xyz'
    ],
    
    getInstances() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : [...this.defaultInstances];
        } catch (e) {
            return [...this.defaultInstances];
        }
    },
    
    saveInstances(instances) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(instances));
    }
};

export const recentActivityManager = {
    STORAGE_KEY: 'monochrome-recent-activity',
    LIMIT: 10,
    
    _get() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : { artists: [], albums: [] };
        } catch (e) {
            return { artists: [], albums: [] };
        }
    },
    
    _save(data) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    },
    
    getRecents() {
        return this._get();
    },
    
    _add(type, item) {
        const data = this._get();
        data[type] = data[type].filter(i => i.id !== item.id);
        data[type].unshift(item);
        data[type] = data[type].slice(0, this.LIMIT);
        this._save(data);
    },
    
    addArtist(artist) {
        this._add('artists', artist);
    },
    
    addAlbum(album) {
        this._add('albums', album);
    }
};
