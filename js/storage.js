//storage.js
export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances-v6',
    INSTANCES_URL: 'instances.json',
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
                        for (const [, config] of Object.entries(data.api)) {
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
                api: [
                    'https://arran.monochrome.tf',
                    'https://api.monochrome.tf',
                    'https://triton.squid.wtf',
                    'https://wolf.qqdl.site',
                    'https://tidal-api.binimum.org',
                    'https://monochrome-api.samidy.com',
                    'https://hifi-one.spotisaver.net',
                    'https://hifi-two.spotisaver.net',
                    'https://maus.qqdl.site',
                    'https://tidal.kinoplus.online',
                    'https://hund.qqdl.site',
                    'https://vogel.qqdl.site',
                ],
                streaming: [
                    'https://arran.monochrome.tf',
                    'https://triton.squid.wtf',
                    'https://wolf.qqdl.site',
                    'https://maus.qqdl.site',
                    'https://vogel.qqdl.site',
                    'https://katze.qqdl.site',
                    'https://hund.qqdl.site',
                    'https://tidal.kinoplus.online',
                    'https://tidal-api.binimum.org',
                    'https://hifi-one.spotisaver.net',
                    'https://hifi-two.spotisaver.net',
                ],
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
                cache: 'no-store',
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
        } catch {
            return { speeds: {}, timestamp: Date.now() };
        }
    },

    updateSpeedCache(newResults) {
        const currentCache = this.getCachedSpeedTests();

        newResults.forEach((r) => {
            // Use distinct keys for streaming tests to avoid overwriting API tests for same URL
            // API tests use raw URL as key (for backward compatibility with UI)
            const key = r.type === 'streaming' ? `${r.url}#streaming` : r.url;
            currentCache.speeds[key] = { speed: r.speed, error: r.error };
        });

        currentCache.timestamp = Date.now();

        try {
            localStorage.setItem(this.SPEED_TEST_CACHE_KEY, JSON.stringify(currentCache));
        } catch {
            console.warn('[SpeedTest] Failed to cache results');
        }

        return currentCache;
    },

    async testSpecificUrls(urls, type) {
        if (!urls || urls.length === 0) return [];
        console.log(`[SpeedTest] Testing ${urls.length} instances for ${type}...`);

        const results = await Promise.all(urls.map((url) => this.speedTestInstance(url, type)));

        const validResults = results.filter((r) => r.speed !== Infinity);
        console.log(
            `[SpeedTest] ${type} Results:`,
            validResults.map((r) => `${r.url}: ${r.speed.toFixed(0)}ms`)
        );

        return results;
    },

    async getInstances(type = 'api') {
        let instancesObj;

        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            instancesObj = JSON.parse(stored);

            // love it when local storage doesnt update
            if (instancesObj?.api?.length === 2) {
                const hasBinimum = instancesObj.api.some((url) => url.includes('tidal-api.binimum.org'));
                const hasSamidy = instancesObj.api.some((url) => url.includes('monochrome-api.samidy.com'));

                if (hasBinimum && hasSamidy) {
                    localStorage.removeItem(this.STORAGE_KEY);
                    instancesObj = null;
                }
            }
        }

        if (!instancesObj) {
            instancesObj = await this.loadInstancesFromGitHub();
        }

        const targetUrls = instancesObj[type] || instancesObj.api || [];
        if (targetUrls.length === 0) return [];

        // Use cached speed results to sort if available, but DON'T run new speed tests
        // Speed tests should only run explicitly via refreshSpeedTests() to avoid
        // mass /track API calls when playing a song
        const speedCache = this.getCachedSpeedTests();
        const getCacheKey = (u) => (type === 'streaming' ? `${u}#streaming` : u);

        // Sort by cached speeds if we have any cached data
        const hasCachedData = targetUrls.some((url) => speedCache.speeds[getCacheKey(url)]);

        if (hasCachedData) {
            const sortedList = [...targetUrls].sort((a, b) => {
                const speedA = speedCache.speeds[getCacheKey(a)]?.speed ?? Infinity;
                const speedB = speedCache.speeds[getCacheKey(b)]?.speed ?? Infinity;
                return speedA - speedB;
            });
            return sortedList;
        }

        // No cached data - return in default order without testing
        return targetUrls;
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
                console.error('Failed to save instances:', e);
            }
        } else {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(instances));
        }
    },
};
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
        } catch {
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
        data[type] = data[type].filter((i) => i.id !== item.id);
        data[type].unshift(item);
        data[type] = data[type].slice(0, this.LIMIT);
        this._save(data);
    },

    clear() {
        this._save({ artists: [], albums: [], playlists: [], mixes: [] });
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
    },
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
        latte: {},
    },

    getTheme() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'system';
        } catch {
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

        if (theme !== 'custom') {
            const root = document.documentElement;
            ['background', 'foreground', 'primary', 'secondary', 'muted', 'border', 'highlight'].forEach((key) => {
                root.style.removeProperty(`--${key}`);
            });
        } else {
            const customTheme = this.getCustomTheme();
            if (customTheme) {
                this.applyCustomTheme(customTheme);
            }
        }
    },

    getCustomTheme() {
        try {
            const stored = localStorage.getItem(this.CUSTOM_THEME_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    },

    setCustomTheme(colors) {
        localStorage.setItem(this.CUSTOM_THEME_KEY, JSON.stringify(colors));
        this.applyCustomTheme(colors);
        this.setTheme('custom');
    },

    applyCustomTheme(colors) {
        const root = document.documentElement;
        for (const [key, value] of Object.entries(colors)) {
            root.style.setProperty(`--${key}`, value);
        }
    },
};

export const lastFMStorage = {
    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },

    shouldLoveOnLike() {
        try {
            return localStorage.getItem(this.LOVE_ON_LIKE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setLoveOnLike(enabled) {
        localStorage.setItem(this.LOVE_ON_LIKE_KEY, enabled ? 'true' : 'false');
    },
};

export const nowPlayingSettings = {
    STORAGE_KEY: 'now-playing-mode',

    getMode() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'cover';
        } catch {
            return 'cover';
        }
    },

    setMode(mode) {
        localStorage.setItem(this.STORAGE_KEY, mode);
    },
};

export const lyricsSettings = {
    DOWNLOAD_WITH_TRACKS: 'lyrics-download-with-tracks',

    shouldDownloadLyrics() {
        try {
            return localStorage.getItem(this.DOWNLOAD_WITH_TRACKS) === 'true';
        } catch {
            return false;
        }
    },

    setDownloadLyrics(enabled) {
        localStorage.setItem(this.DOWNLOAD_WITH_TRACKS, enabled ? 'true' : 'false');
    },
};

export const backgroundSettings = {
    STORAGE_KEY: 'album-background-enabled',

    isEnabled() {
        try {
            // Default to true if not set
            return localStorage.getItem(this.STORAGE_KEY) !== 'false';
        } catch {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const cardSettings = {
    COMPACT_ARTIST_KEY: 'card-compact-artist',
    COMPACT_ALBUM_KEY: 'card-compact-album',

    isCompactArtist() {
        try {
            const val = localStorage.getItem(this.COMPACT_ARTIST_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setCompactArtist(enabled) {
        localStorage.setItem(this.COMPACT_ARTIST_KEY, enabled ? 'true' : 'false');
    },

    isCompactAlbum() {
        try {
            return localStorage.getItem(this.COMPACT_ALBUM_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setCompactAlbum(enabled) {
        localStorage.setItem(this.COMPACT_ALBUM_KEY, enabled ? 'true' : 'false');
    },
};

export const replayGainSettings = {
    STORAGE_KEY_MODE: 'replay-gain-mode', // 'off', 'track', 'album'
    STORAGE_KEY_PREAMP: 'replay-gain-preamp',
    getMode() {
        return localStorage.getItem(this.STORAGE_KEY_MODE) || 'track';
    },
    setMode(mode) {
        localStorage.setItem(this.STORAGE_KEY_MODE, mode);
    },
    getPreamp() {
        const val = parseFloat(localStorage.getItem(this.STORAGE_KEY_PREAMP));
        return isNaN(val) ? 3 : val;
    },
    setPreamp(db) {
        localStorage.setItem(this.STORAGE_KEY_PREAMP, db);
    },
};

export const downloadQualitySettings = {
    STORAGE_KEY: 'download-quality',
    getQuality() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'HI_RES_LOSSLESS';
        } catch {
            return 'HI_RES_LOSSLESS';
        }
    },
    setQuality(quality) {
        localStorage.setItem(this.STORAGE_KEY, quality);
    },
};

export const coverArtSizeSettings = {
    STORAGE_KEY: 'cover-art-size',
    getSize() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || '1280';
        } catch {
            return '1280';
        }
    },
    setSize(size) {
        localStorage.setItem(this.STORAGE_KEY, size);
    },
};

export const waveformSettings = {
    STORAGE_KEY: 'waveform-seekbar-enabled',

    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const smoothScrollingSettings = {
    STORAGE_KEY: 'smooth-scrolling-enabled',

    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const qualityBadgeSettings = {
    STORAGE_KEY: 'show-quality-badges',

    isEnabled() {
        try {
            const val = localStorage.getItem(this.STORAGE_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const trackDateSettings = {
    STORAGE_KEY: 'use-album-release-year',

    useAlbumYear() {
        try {
            const val = localStorage.getItem(this.STORAGE_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setUseAlbumYear(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const bulkDownloadSettings = {
    STORAGE_KEY: 'force-individual-downloads',

    shouldForceIndividual() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setForceIndividual(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const playlistSettings = {
    M3U_KEY: 'playlist-generate-m3u',
    M3U8_KEY: 'playlist-generate-m3u8',
    CUE_KEY: 'playlist-generate-cue',
    NFO_KEY: 'playlist-generate-nfo',
    JSON_KEY: 'playlist-generate-json',
    RELATIVE_PATHS_KEY: 'playlist-relative-paths',

    shouldGenerateM3U() {
        try {
            const val = localStorage.getItem(this.M3U_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    shouldGenerateM3U8() {
        try {
            return localStorage.getItem(this.M3U8_KEY) === 'true';
        } catch {
            return false;
        }
    },

    shouldGenerateCUE() {
        try {
            return localStorage.getItem(this.CUE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    shouldGenerateNFO() {
        try {
            return localStorage.getItem(this.NFO_KEY) === 'true';
        } catch {
            return false;
        }
    },

    shouldGenerateJSON() {
        try {
            return localStorage.getItem(this.JSON_KEY) === 'true';
        } catch {
            return false;
        }
    },

    shouldUseRelativePaths() {
        try {
            const val = localStorage.getItem(this.RELATIVE_PATHS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setGenerateM3U(enabled) {
        localStorage.setItem(this.M3U_KEY, enabled ? 'true' : 'false');
    },

    setGenerateM3U8(enabled) {
        localStorage.setItem(this.M3U8_KEY, enabled ? 'true' : 'false');
    },

    setGenerateCUE(enabled) {
        localStorage.setItem(this.CUE_KEY, enabled ? 'true' : 'false');
    },

    setGenerateNFO(enabled) {
        localStorage.setItem(this.NFO_KEY, enabled ? 'true' : 'false');
    },

    setGenerateJSON(enabled) {
        localStorage.setItem(this.JSON_KEY, enabled ? 'true' : 'false');
    },

    setUseRelativePaths(enabled) {
        localStorage.setItem(this.RELATIVE_PATHS_KEY, enabled ? 'true' : 'false');
    },
};

export const visualizerSettings = {
    SENSITIVITY_KEY: 'visualizer-sensitivity',
    SMART_INTENSITY_KEY: 'visualizer-smart-intensity',
    ENABLED_KEY: 'visualizer-enabled',
    MODE_KEY: 'visualizer-mode', // 'solid' or 'blended'
    PRESET_KEY: 'visualizer-preset',

    getPreset() {
        try {
            return localStorage.getItem(this.PRESET_KEY) || 'lcd';
        } catch {
            return 'lcd';
        }
    },

    setPreset(preset) {
        localStorage.setItem(this.PRESET_KEY, preset);
    },

    isEnabled() {
        try {
            const val = localStorage.getItem(this.ENABLED_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.ENABLED_KEY, enabled);
    },

    getMode() {
        try {
            return localStorage.getItem(this.MODE_KEY) || 'solid';
        } catch {
            return 'solid';
        }
    },

    setMode(mode) {
        localStorage.setItem(this.MODE_KEY, mode);
    },

    getSensitivity() {
        try {
            const val = localStorage.getItem(this.SENSITIVITY_KEY);
            if (val === null) return 1.0;
            return parseFloat(val);
        } catch {
            return 1.0;
        }
    },

    setSensitivity(value) {
        localStorage.setItem(this.SENSITIVITY_KEY, value);
    },

    isSmartIntensityEnabled() {
        try {
            const val = localStorage.getItem(this.SMART_INTENSITY_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setSmartIntensity(enabled) {
        localStorage.setItem(this.SMART_INTENSITY_KEY, enabled);
    },
};

export const equalizerSettings = {
    ENABLED_KEY: 'equalizer-enabled',
    GAINS_KEY: 'equalizer-gains',
    PRESET_KEY: 'equalizer-preset',

    isEnabled() {
        try {
            // Disabled by default
            return localStorage.getItem(this.ENABLED_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.ENABLED_KEY, enabled ? 'true' : 'false');
    },

    getGains() {
        try {
            const stored = localStorage.getItem(this.GAINS_KEY);
            if (stored) {
                const gains = JSON.parse(stored);
                if (Array.isArray(gains) && gains.length === 16) {
                    return gains;
                }
            }
        } catch {
            /* ignore */
        }
        // Return flat EQ (all zeros) by default
        return new Array(16).fill(0);
    },

    setGains(gains) {
        try {
            if (Array.isArray(gains) && gains.length === 16) {
                localStorage.setItem(this.GAINS_KEY, JSON.stringify(gains));
            }
        } catch (e) {
            console.warn('[EQ] Failed to save gains:', e);
        }
    },

    getPreset() {
        try {
            return localStorage.getItem(this.PRESET_KEY) || 'flat';
        } catch {
            return 'flat';
        }
    },

    setPreset(preset) {
        localStorage.setItem(this.PRESET_KEY, preset);
    },
};

export const sidebarSettings = {
    STORAGE_KEY: 'monochrome-sidebar-collapsed',

    isCollapsed() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setCollapsed(collapsed) {
        localStorage.setItem(this.STORAGE_KEY, collapsed ? 'true' : 'false');
    },

    restoreState() {
        const isCollapsed = this.isCollapsed();
        if (isCollapsed) {
            document.body.classList.add('sidebar-collapsed');
            const toggleBtn = document.getElementById('sidebar-toggle');
            if (toggleBtn) {
                toggleBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
            }
        }
    },
};

export const queueManager = {
    STORAGE_KEY: 'monochrome-queue',

    getQueue() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch {
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
                repeatMode: queueState.repeatMode,
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(minimalState));
        } catch (e) {
            console.warn('Failed to save queue to localStorage:', e);
        }
    },
};

export const listenBrainzSettings = {
    ENABLED_KEY: 'listenbrainz-enabled',
    TOKEN_KEY: 'listenbrainz-token',
    CUSTOM_URL_KEY: 'listenbrainz-custom-url',

    isEnabled() {
        try {
            return localStorage.getItem(this.ENABLED_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.ENABLED_KEY, enabled ? 'true' : 'false');
    },

    getToken() {
        try {
            return localStorage.getItem(this.TOKEN_KEY) || '';
        } catch {
            return '';
        }
    },

    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    getCustomUrl() {
        try {
            return localStorage.getItem(this.CUSTOM_URL_KEY) || '';
        } catch {
            return '';
        }
    },

    setCustomUrl(url) {
        localStorage.setItem(this.CUSTOM_URL_KEY, url);
    },
};

export const malojaSettings = {
    ENABLED_KEY: 'maloja-enabled',
    TOKEN_KEY: 'maloja-token',
    CUSTOM_URL_KEY: 'maloja-custom-url',

    isEnabled() {
        try {
            return localStorage.getItem(this.ENABLED_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.ENABLED_KEY, enabled ? 'true' : 'false');
    },

    getToken() {
        try {
            return localStorage.getItem(this.TOKEN_KEY) || '';
        } catch {
            return '';
        }
    },

    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    getCustomUrl() {
        try {
            return localStorage.getItem(this.CUSTOM_URL_KEY) || '';
        } catch {
            return '';
        }
    },

    setCustomUrl(url) {
        localStorage.setItem(this.CUSTOM_URL_KEY, url);
    },
};

export const libreFmSettings = {
    ENABLED_KEY: 'librefm-enabled',
    LOVE_ON_LIKE_KEY: 'librefm-love-on-like',

    isEnabled() {
        try {
            return localStorage.getItem(this.ENABLED_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.ENABLED_KEY, enabled ? 'true' : 'false');
    },

    shouldLoveOnLike() {
        try {
            return localStorage.getItem(this.LOVE_ON_LIKE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setLoveOnLike(enabled) {
        localStorage.setItem(this.LOVE_ON_LIKE_KEY, enabled ? 'true' : 'false');
    },
};

export const homePageSettings = {
    SHOW_RECOMMENDED_SONGS_KEY: 'home-show-recommended-songs',
    SHOW_RECOMMENDED_ALBUMS_KEY: 'home-show-recommended-albums',
    SHOW_RECOMMENDED_ARTISTS_KEY: 'home-show-recommended-artists',
    SHOW_JUMP_BACK_IN_KEY: 'home-show-jump-back-in',

    shouldShowRecommendedSongs() {
        try {
            const val = localStorage.getItem(this.SHOW_RECOMMENDED_SONGS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowRecommendedSongs(enabled) {
        localStorage.setItem(this.SHOW_RECOMMENDED_SONGS_KEY, enabled ? 'true' : 'false');
    },

    shouldShowRecommendedAlbums() {
        try {
            const val = localStorage.getItem(this.SHOW_RECOMMENDED_ALBUMS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowRecommendedAlbums(enabled) {
        localStorage.setItem(this.SHOW_RECOMMENDED_ALBUMS_KEY, enabled ? 'true' : 'false');
    },

    shouldShowRecommendedArtists() {
        try {
            const val = localStorage.getItem(this.SHOW_RECOMMENDED_ARTISTS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowRecommendedArtists(enabled) {
        localStorage.setItem(this.SHOW_RECOMMENDED_ARTISTS_KEY, enabled ? 'true' : 'false');
    },

    shouldShowJumpBackIn() {
        try {
            const val = localStorage.getItem(this.SHOW_JUMP_BACK_IN_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowJumpBackIn(enabled) {
        localStorage.setItem(this.SHOW_JUMP_BACK_IN_KEY, enabled ? 'true' : 'false');
    },
};

export const sidebarSectionSettings = {
    SHOW_HOME_KEY: 'sidebar-show-home',
    SHOW_LIBRARY_KEY: 'sidebar-show-library',
    SHOW_RECENT_KEY: 'sidebar-show-recent',
    SHOW_UNRELEASED_KEY: 'sidebar-show-unreleased',
    SHOW_DONATE_KEY: 'sidebar-show-donate',
    SHOW_SETTINGS_KEY: 'sidebar-show-settings',
    SHOW_ACCOUNT_KEY: 'sidebar-show-account',
    SHOW_ABOUT_KEY: 'sidebar-show-about',
    SHOW_DOWNLOAD_KEY: 'sidebar-show-download',
    SHOW_DISCORD_KEY: 'sidebar-show-discord',

    shouldShowHome() {
        try {
            const val = localStorage.getItem(this.SHOW_HOME_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowHome(enabled) {
        localStorage.setItem(this.SHOW_HOME_KEY, enabled ? 'true' : 'false');
    },

    shouldShowLibrary() {
        try {
            const val = localStorage.getItem(this.SHOW_LIBRARY_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowLibrary(enabled) {
        localStorage.setItem(this.SHOW_LIBRARY_KEY, enabled ? 'true' : 'false');
    },

    shouldShowRecent() {
        try {
            const val = localStorage.getItem(this.SHOW_RECENT_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowRecent(enabled) {
        localStorage.setItem(this.SHOW_RECENT_KEY, enabled ? 'true' : 'false');
    },

    shouldShowUnreleased() {
        try {
            const val = localStorage.getItem(this.SHOW_UNRELEASED_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowUnreleased(enabled) {
        localStorage.setItem(this.SHOW_UNRELEASED_KEY, enabled ? 'true' : 'false');
    },

    shouldShowDonate() {
        try {
            const val = localStorage.getItem(this.SHOW_DONATE_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowDonate(enabled) {
        localStorage.setItem(this.SHOW_DONATE_KEY, enabled ? 'true' : 'false');
    },

    shouldShowSettings() {
        try {
            const val = localStorage.getItem(this.SHOW_SETTINGS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowSettings(enabled) {
        localStorage.setItem(this.SHOW_SETTINGS_KEY, enabled ? 'true' : 'false');
    },

    shouldShowAccount() {
        try {
            const val = localStorage.getItem(this.SHOW_ACCOUNT_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowAccount(enabled) {
        localStorage.setItem(this.SHOW_ACCOUNT_KEY, enabled ? 'true' : 'false');
    },

    shouldShowAbout() {
        try {
            const val = localStorage.getItem(this.SHOW_ABOUT_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowAbout(enabled) {
        localStorage.setItem(this.SHOW_ABOUT_KEY, enabled ? 'true' : 'false');
    },

    shouldShowDownload() {
        try {
            const val = localStorage.getItem(this.SHOW_DOWNLOAD_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowDownload(enabled) {
        localStorage.setItem(this.SHOW_DOWNLOAD_KEY, enabled ? 'true' : 'false');
    },

    shouldShowDiscord() {
        try {
            const val = localStorage.getItem(this.SHOW_DISCORD_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowDiscord(enabled) {
        localStorage.setItem(this.SHOW_DISCORD_KEY, enabled ? 'true' : 'false');
    },

    applySidebarVisibility() {
        const items = [
            { id: 'sidebar-nav-home', check: this.shouldShowHome() },
            { id: 'sidebar-nav-library', check: this.shouldShowLibrary() },
            { id: 'sidebar-nav-recent', check: this.shouldShowRecent() },
            { id: 'sidebar-nav-unreleased', check: this.shouldShowUnreleased() },
            { id: 'sidebar-nav-donate', check: this.shouldShowDonate() },
            { id: 'sidebar-nav-settings', check: this.shouldShowSettings() },
            { id: 'sidebar-nav-account', check: this.shouldShowAccount() },
            { id: 'sidebar-nav-about', check: this.shouldShowAbout() },
            { id: 'sidebar-nav-download', check: this.shouldShowDownload() },
            { id: 'sidebar-nav-discord', check: this.shouldShowDiscord() },
        ];

        items.forEach(({ id, check }) => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = check ? '' : 'none';
            }
        });
    },
};

// System theme listener
if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (themeManager.getTheme() === 'system') {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        }
    });
}
