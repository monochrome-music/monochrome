//storage.js
export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances',
    INSTANCES_URL: 'https://raw.githubusercontent.com/EduardPrigoana/hifi-instances/refs/heads/main/instances.json',
    SPEED_TEST_CACHE_KEY: 'monochrome-instance-speeds',
    SPEED_TEST_CACHE_DURATION: 1000 * 60 * 60,
    defaultInstances: [],
    instancesLoaded: false,

    async loadInstancesFromGitHub() {
        if (this.instancesLoaded) {
            return this.defaultInstances;
        }

        try {
            const response = await fetch(this.INSTANCES_URL);
            if (!response.ok) throw new Error('Failed to fetch instances');

            const data = await response.json();
            const allInstances = [];

            for (const [provider, config] of Object.entries(data.api)) {
                if (config.cors === false && Array.isArray(config.urls)) {
                    allInstances.push(...config.urls);
                }
            }

            this.defaultInstances = allInstances;
            this.instancesLoaded = true;

            return allInstances;
        } catch (error) {
            console.error('Failed to load instances from GitHub:', error);
            this.defaultInstances = [
                'https://ohio.monochrome.tf/',
                'https://virginia.monochrome.tf/',
                'https://oregon.monochrome.tf/',
                'https://california.monochrome.tf/',
                'https://frankfurt.monochrome.tf/',
                'https://singapore.monochrome.tf/',
                'https://tokyo.monochrome.tf/',
                'https://jakarta.monochrome.tf/',
                'https://wolf.qqdl.site',
                'https://maus.qqdl.site',
                'https://vogel.qqdl.site',
                'https://katze.qqdl.site',
                'https://hund.qqdl.site',
                'https://tidal.401658.xyz'
            ];
            this.instancesLoaded = true;
            return this.defaultInstances;
        }
    },

    async speedTestInstance(url) {
        const testUrl = url.endsWith('/')
            ? `${url}track/?id=204567804&quality=HIGH`
            : `${url}/track/?id=204567804&quality=HIGH`;

        const startTime = performance.now();

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(testUrl, {
                signal: controller.signal,
                cache: 'no-store'
            });

            clearTimeout(timeout);

            if (!response.ok) {
                return { url, speed: Infinity, error: `HTTP ${response.status}` };
            }

            const endTime = performance.now();
            const speed = endTime - startTime;

            return { url, speed, error: null };
        } catch (error) {
            return { url, speed: Infinity, error: error.message };
        }
    },

    async runSpeedTests(instances) {
        console.log('[SpeedTest] Testing', instances.length, 'instances...');

        const results = await Promise.all(
            instances.map(url => this.speedTestInstance(url))
        );

        const validResults = results.filter(r => r.speed !== Infinity);
        const failedResults = results.filter(r => r.speed === Infinity);

        if (failedResults.length > 0) {
            console.log('[SpeedTest] Failed instances:', failedResults.map(r => `${r.url} (${r.error})`));
        }

        validResults.sort((a, b) => a.speed - b.speed);

        console.log('[SpeedTest] Results:', validResults.map(r => `${r.url}: ${r.speed.toFixed(0)}ms`));

        const sortedInstances = [
            ...validResults.map(r => r.url),
            ...failedResults.map(r => r.url)
        ];

        const cacheData = {
            timestamp: Date.now(),
            speeds: results.reduce((acc, r) => {
                acc[r.url] = { speed: r.speed, error: r.error };
                return acc;
            }, {})
        };

        try {
            localStorage.setItem(this.SPEED_TEST_CACHE_KEY, JSON.stringify(cacheData));
        } catch (e) {
            console.warn('[SpeedTest] Failed to cache results');
        }

        return sortedInstances;
    },

    getCachedSpeedTests() {
        try {
            const cached = localStorage.getItem(this.SPEED_TEST_CACHE_KEY);
            if (!cached) return null;

            const data = JSON.parse(cached);

            if (Date.now() - data.timestamp > this.SPEED_TEST_CACHE_DURATION) {
                return null;
            }

            return data;
        } catch (e) {
            return null;
        }
    },

    sortInstancesByCache(instances, cachedData) {
        const speeds = cachedData.speeds;

        const sorted = [...instances].sort((a, b) => {
            const speedA = speeds[a]?.speed ?? Infinity;
            const speedB = speeds[b]?.speed ?? Infinity;
            return speedA - speedB;
        });

        console.log('[SpeedTest] Using cached results (age:',
            Math.round((Date.now() - cachedData.timestamp) / 1000 / 60), 'minutes)');

        return sorted;
    },

    async getInstances() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }

            const instances = await this.loadInstancesFromGitHub();

            const cachedSpeedTests = this.getCachedSpeedTests();

            let sortedInstances;
            if (cachedSpeedTests) {
                sortedInstances = this.sortInstancesByCache(instances, cachedSpeedTests);
            } else {
                sortedInstances = await this.runSpeedTests(instances);
            }

            this.saveInstances(sortedInstances);

            return sortedInstances;
        } catch (e) {
            const instances = await this.loadInstancesFromGitHub();
            return instances;
        }
    },

    async refreshSpeedTests() {
        const instances = await this.loadInstancesFromGitHub();
        const sortedInstances = await this.runSpeedTests(instances);
        this.saveInstances(sortedInstances);
        return sortedInstances;
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

export const themeManager = {
    STORAGE_KEY: 'monochrome-theme',
    CUSTOM_THEME_KEY: 'monochrome-custom-theme',

    defaultThemes: {
        monochrome: {},
        dark: {},
        ocean: {},
        purple: {},
        forest: {}
    },

    getTheme() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'monochrome';
        } catch (e) {
            return 'monochrome';
        }
    },

    setTheme(theme) {
        localStorage.setItem(this.STORAGE_KEY, theme);
        document.documentElement.setAttribute('data-theme', theme);
    },

    getCustomTheme() {
        try {
            const stored = localStorage.getItem(this.CUSTOM_THEME_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            return null;
        }
    },

    setCustomTheme(colors) {
        localStorage.setItem(this.CUSTOM_THEME_KEY, JSON.stringify(colors));
        this.applyCustomTheme(colors);
    },

    applyCustomTheme(colors) {
        const root = document.documentElement;
        for (const [key, value] of Object.entries(colors)) {
            root.style.setProperty(`--${key}`, value);
        }
    }
};

export const lastFMStorage = {
    STORAGE_KEY: 'lastfm-enabled',

    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    }
};

export const nowPlayingSettings = {
    STORAGE_KEY: 'now-playing-mode',

    getMode() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'cover';
        } catch (e) {
            return 'cover';
        }
    },

    setMode(mode) {
        localStorage.setItem(this.STORAGE_KEY, mode);
    }
};

export const lyricsSettings = {
    DOWNLOAD_WITH_TRACKS: 'lyrics-download-with-tracks',

    shouldDownloadLyrics() {
        try {
            return localStorage.getItem(this.DOWNLOAD_WITH_TRACKS) === 'true';
        } catch (e) {
            return false;
        }
    },

    setDownloadLyrics(enabled) {
        localStorage.setItem(this.DOWNLOAD_WITH_TRACKS, enabled ? 'true' : 'false');
    }
};
