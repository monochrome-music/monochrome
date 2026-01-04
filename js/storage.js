//storage.js
export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances-v2',
    INSTANCES_URL: "../instances.json",
    SPEED_TEST_CACHE_KEY: 'monochrome-instance-speeds',
    SPEED_TEST_CACHE_DURATION: 1000 * 60 * 60,
    defaultInstances: { api: [], streaming: [] },
    instancesLoaded: false,

        async loadInstancesFromGitHub() {
            if (this.instancesLoaded) {
                return this.defaultInstances;
            }
    
            try {
                const response = await fetch(this.INSTANCES_URL);
                if (!response.ok) throw new Error('Failed to fetch instances');
    
                const data = await response.json();
                
                let groupedInstances = { api: [], streaming: [] };
    
                if (Array.isArray(data)) {
                    // Legacy array format
                    groupedInstances.api = [...data];
                    groupedInstances.streaming = [...data];
                } else {
                    // New object format or legacy object format
                    if (data.api && Array.isArray(data.api)) {
                         const isSimpleArray = data.api.length > 0 && typeof data.api[0] === 'string';
                         if (isSimpleArray) {
                             groupedInstances.api = [...data.api];
                         } else {
                            for (const [provider, config] of Object.entries(data.api)) {
                                if (config.cors === false && Array.isArray(config.urls)) {
                                    groupedInstances.api.push(...config.urls);
                                }
                            }
                         }
                    }
                    
                    if (data.streaming && Array.isArray(data.streaming)) {
                        groupedInstances.streaming = [...data.streaming];
                    } else if (groupedInstances.api.length > 0) {
                        groupedInstances.streaming = [...groupedInstances.api];
                    }
                }
    
                this.defaultInstances = groupedInstances;
                this.instancesLoaded = true;
    
                return groupedInstances;
            } catch (error) {
                console.error('Failed to load instances from GitHub:', error);
                this.defaultInstances = {
                    api: ["https://monochrome-api.samidy.com"],
                    streaming: [
                        "https://triton.squid.wtf",
                        "https://wolf.qqdl.site",
                        "https://maus.qqdl.site",
                        "https://vogel.qqdl.site",
                        "https://katze.qqdl.site",
                        "https://hund.qqdl.site",
                        "https://tidal.kinoplus.online",
                        "https://tidal-api.binimum.org"
                      ]
                };
                this.instancesLoaded = true;
                return this.defaultInstances;
            }
        },
    
        async speedTestInstance(url, type = 'api') {
            let testUrl;
            // API instances might not support /track/ endpoint (which checks for streamability)
            // So we test API instances with a lightweight metadata endpoint
            if (type === 'streaming') {
                 testUrl = url.endsWith('/')
                    ? `${url}track/?id=204567804&quality=HIGH`
                    : `${url}/track/?id=204567804&quality=HIGH`;
            } else {
                 testUrl = url.endsWith('/')
                    ? `${url}artist/?id=3532302` // Daft Punk
                    : `${url}/artist/?id=3532302`;
            }
    
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
                    return { url, type, speed: Infinity, error: `HTTP ${response.status}` };
                }
    
                const endTime = performance.now();
                const speed = endTime - startTime;
    
                return { url, type, speed, error: null };
            } catch (error) {
                return { url, type, speed: Infinity, error: error.message };
            }
        },
    
        getCachedSpeedTests() {
            try {
                const cached = localStorage.getItem(this.SPEED_TEST_CACHE_KEY);
                if (!cached) return { speeds: {}, timestamp: Date.now() };
    
                const data = JSON.parse(cached);
                
                if (Date.now() - data.timestamp > this.SPEED_TEST_CACHE_DURATION) {
                     return { speeds: {}, timestamp: Date.now() };
                }
    
                return data;
            } catch (e) {
                return { speeds: {}, timestamp: Date.now() };
            }
        },
    
        updateSpeedCache(newResults) {
            const currentCache = this.getCachedSpeedTests();
            
            newResults.forEach(r => {
                // Use distinct keys for streaming tests to avoid overwriting API tests for same URL
                // API tests use raw URL as key (for backward compatibility with UI)
                const key = r.type === 'streaming' ? `${r.url}#streaming` : r.url;
                currentCache.speeds[key] = { speed: r.speed, error: r.error };
            });
            
            currentCache.timestamp = Date.now();
    
            try {
                localStorage.setItem(this.SPEED_TEST_CACHE_KEY, JSON.stringify(currentCache));
            } catch (e) {
                console.warn('[SpeedTest] Failed to cache results');
            }
            
            return currentCache;
        },
    
        async testSpecificUrls(urls, type) {
            if (!urls || urls.length === 0) return [];
            console.log(`[SpeedTest] Testing ${urls.length} instances for ${type}...`);
            
            const results = await Promise.all(
                urls.map(url => this.speedTestInstance(url, type))
            );
            
            const validResults = results.filter(r => r.speed !== Infinity);
            console.log(`[SpeedTest] ${type} Results:`, validResults.map(r => `${r.url}: ${r.speed.toFixed(0)}ms`));
            
            return results;
        },
    
        async getInstances(type = 'api') {
            let instancesObj;
            
            try {
                const stored = localStorage.getItem(this.STORAGE_KEY);
                if (stored) {
                    instancesObj = JSON.parse(stored);
                }
            } catch (e) {}
            
            if (!instancesObj) {
                instancesObj = await this.loadInstancesFromGitHub();
            }
    
            const targetUrls = instancesObj[type] || instancesObj.api || [];
            if (targetUrls.length === 0) return [];
    
            const speedCache = this.getCachedSpeedTests();
            // Construct cache key based on type
            const getCacheKey = (u) => type === 'streaming' ? `${u}#streaming` : u;
            
            const urlsToTest = targetUrls.filter(url => !speedCache.speeds[getCacheKey(url)]);
    
            if (urlsToTest.length > 0) {
                const results = await this.testSpecificUrls(urlsToTest, type);
                this.updateSpeedCache(results);
                Object.assign(speedCache, this.getCachedSpeedTests());
            }
    
            const sortList = (list) => {
                 return [...list].sort((a, b) => {
                    const speedA = speedCache.speeds[getCacheKey(a)]?.speed ?? Infinity;
                    const speedB = speedCache.speeds[getCacheKey(b)]?.speed ?? Infinity;
                    return speedA - speedB;
                });
            };
    
            const sortedList = sortList(targetUrls);
            
            // Persist the sorted order
            instancesObj[type] = sortedList;
            this.saveInstances(instancesObj);
    
            return sortedList;
        },
    
            async refreshSpeedTests() {
                const instances = await this.loadInstancesFromGitHub();
                const promises = [];
                
                if (instances.api && instances.api.length) {
                    promises.push(this.testSpecificUrls(instances.api, 'api'));
                }
                
                if (instances.streaming && instances.streaming.length) {
                    promises.push(this.testSpecificUrls(instances.streaming, 'streaming'));
                }
                
                const resultsArray = await Promise.all(promises);
                const allResults = resultsArray.flat();
                
                this.updateSpeedCache(allResults);
                
                // Return API instances for the UI to render (default view)
                return this.getInstances('api');
            },    
            saveInstances(instances, type) {
                if (type) {
                    try {
                        const stored = localStorage.getItem(this.STORAGE_KEY);
                        let fullObj = stored ? JSON.parse(stored) : { api: [], streaming: [] };
                        fullObj[type] = instances;
                        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(fullObj));
                    } catch (e) {
                        console.error("Failed to save instances:", e);
                    }
                } else {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(instances));
                }
            }    };
export const recentActivityManager = {
    STORAGE_KEY: 'monochrome-recent-activity',
    LIMIT: 10,

    _get() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            const parsed = data ? JSON.parse(data) : { artists: [], albums: [], playlists: [], mixes: [] };
            if (!parsed.playlists) parsed.playlists = [];
            if (!parsed.mixes) parsed.mixes = [];
            return parsed;
        } catch (e) {
            return { artists: [], albums: [], playlists: [], mixes: [] };
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
    },

    addPlaylist(playlist) {
        this._add('playlists', playlist);
    },

    addMix(mix) {
        this._add('mixes', mix);
    }
};

export const themeManager = {
    STORAGE_KEY: 'monochrome-theme',
    CUSTOM_THEME_KEY: 'monochrome-custom-theme',

    defaultThemes: {
        light: {},
        dark: {},
        monochrome: {},
        ocean: {},
        purple: {},
        forest: {},
        mocha: {},
        machiatto: {},
        frappe: {},
        latte: {}
    },

    getTheme() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'system';
        } catch (e) {
            return 'system';
        }
    },

    setTheme(theme) {
        localStorage.setItem(this.STORAGE_KEY, theme);
        
        if (theme === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
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
    LOVE_ON_LIKE_KEY: 'lastfm-love-on-like',

    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },

    shouldLoveOnLike() {
        try {
            return localStorage.getItem(this.LOVE_ON_LIKE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    setLoveOnLike(enabled) {
        localStorage.setItem(this.LOVE_ON_LIKE_KEY, enabled ? 'true' : 'false');
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

export const backgroundSettings = {
    STORAGE_KEY: 'album-background-enabled',

    isEnabled() {
        try {
            // Default to true if not set
            return localStorage.getItem(this.STORAGE_KEY) !== 'false';
        } catch (e) {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    }
};

export const trackListSettings = {
    STORAGE_KEY: 'track-list-actions-mode',

    getMode() {
        try {
            const mode = localStorage.getItem(this.STORAGE_KEY) || 'dropdown';
            document.documentElement.setAttribute('data-track-actions-mode', mode);
            return mode;
        } catch (e) {
            return 'dropdown';
        }
    },

    setMode(mode) {
        localStorage.setItem(this.STORAGE_KEY, mode);
        document.documentElement.setAttribute('data-track-actions-mode', mode);
    }
};

export const cardSettings = {
    COMPACT_ARTIST_KEY: 'card-compact-artist',
    COMPACT_ALBUM_KEY: 'card-compact-album',

    isCompactArtist() {
        try {
            const val = localStorage.getItem(this.COMPACT_ARTIST_KEY);
            return val === null ? true : val === 'true';
        } catch (e) {
            return true;
        }
    },

    setCompactArtist(enabled) {
        localStorage.setItem(this.COMPACT_ARTIST_KEY, enabled ? 'true' : 'false');
    },

    isCompactAlbum() {
        try {
            return localStorage.getItem(this.COMPACT_ALBUM_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    setCompactAlbum(enabled) {
        localStorage.setItem(this.COMPACT_ALBUM_KEY, enabled ? 'true' : 'false');
    }
};

export const queueManager = {
    STORAGE_KEY: 'monochrome-queue',

    getQueue() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            return null;
        }
    },

    saveQueue(queueState) {
        try {
            // Only save essential data to avoid quota limits
            const minimalState = {
                queue: queueState.queue,
                shuffledQueue: queueState.shuffledQueue,
                originalQueueBeforeShuffle: queueState.originalQueueBeforeShuffle,
                currentQueueIndex: queueState.currentQueueIndex,
                shuffleActive: queueState.shuffleActive,
                repeatMode: queueState.repeatMode
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(minimalState));
        } catch (e) {
            console.warn('Failed to save queue to localStorage:', e);
        }
    }
};



// System theme listener
if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (themeManager.getTheme() === 'system') {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        }
    });
}
