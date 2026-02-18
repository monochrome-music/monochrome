//storage.js
export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances-v6',
    INSTANCES_URL: 'instances.json',
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
                        for (const [_key, config] of Object.entries(data.api)) {
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
                    'https://eu-central.monochrome.tf',
                    'https://us-west.monochrome.tf',
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

    async getInstances(type = 'api', _sortBySpeed = false) {
        let instancesObj;

        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            instancesObj = JSON.parse(stored);

            // love it when local storage doesnt update
            if (instancesObj?.api?.length === 2) {
                const hasBinimum = instancesObj.api.some((url) => {
                    try {
                        const urlObj = new URL(url);
                        return urlObj.hostname === 'tidal-api.binimum.org';
                    } catch {
                        return false;
                    }
                });
                const hasSamidy = instancesObj.api.some((url) => {
                    try {
                        const urlObj = new URL(url);
                        return urlObj.hostname === 'monochrome-api.samidy.com';
                    } catch {
                        return false;
                    }
                });

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

        return targetUrls;
    },

    async refreshInstances() {
        const instances = await this.loadInstancesFromGitHub();

        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        if (instances.api && instances.api.length) {
            instances.api = shuffle([...instances.api]);
        }

        if (instances.streaming && instances.streaming.length) {
            instances.streaming = shuffle([...instances.streaming]);
        }

        this.saveInstances(instances);

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
        macchiato: {},
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
            document.documentElement.setAttribute('data-theme', isDark ? 'monochrome' : 'white');
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

// Simple obfuscation to avoid clear-text storage of sensitive data
function encodeSensitiveData(text) {
    if (!text) return '';
    const encoded = btoa(text.split('').reverse().join(''));
    return encoded;
}

function decodeSensitiveData(encoded) {
    if (!encoded) return '';
    try {
        return atob(encoded).split('').reverse().join('');
    } catch {
        return '';
    }
}

export const lastFMStorage = {
    STORAGE_KEY: 'lastfm-enabled',
    LOVE_ON_LIKE_KEY: 'lastfm-love-on-like',
    SCROBBLE_PERCENTAGE_KEY: 'lastfm-scrobble-percentage',
    CUSTOM_API_KEY: 'lastfm-custom-api-key',
    CUSTOM_API_SECRET: 'lastfm-custom-api-secret',
    USE_CUSTOM_CREDENTIALS_KEY: 'lastfm-use-custom-credentials',

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

    getScrobblePercentage() {
        try {
            const value = localStorage.getItem(this.SCROBBLE_PERCENTAGE_KEY);
            return value ? parseInt(value, 10) : 75;
        } catch {
            return 75;
        }
    },

    setScrobblePercentage(percentage) {
        const validPercentage = Math.max(1, Math.min(100, parseInt(percentage, 10) || 75));
        localStorage.setItem(this.SCROBBLE_PERCENTAGE_KEY, validPercentage.toString());
    },

    useCustomCredentials() {
        try {
            return localStorage.getItem(this.USE_CUSTOM_CREDENTIALS_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setUseCustomCredentials(enabled) {
        localStorage.setItem(this.USE_CUSTOM_CREDENTIALS_KEY, enabled ? 'true' : 'false');
    },

    getCustomApiKey() {
        try {
            const stored = localStorage.getItem(this.CUSTOM_API_KEY);
            return decodeSensitiveData(stored) || '';
        } catch {
            return '';
        }
    },

    setCustomApiKey(key) {
        localStorage.setItem(this.CUSTOM_API_KEY, encodeSensitiveData(key));
    },

    getCustomApiSecret() {
        try {
            const stored = localStorage.getItem(this.CUSTOM_API_SECRET);
            return decodeSensitiveData(stored) || '';
        } catch {
            return '';
        }
    },

    setCustomApiSecret(secret) {
        localStorage.setItem(this.CUSTOM_API_SECRET, encodeSensitiveData(secret));
    },

    clearCustomCredentials() {
        localStorage.removeItem(this.CUSTOM_API_KEY);
        localStorage.removeItem(this.CUSTOM_API_SECRET);
        localStorage.removeItem(this.USE_CUSTOM_CREDENTIALS_KEY);
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

export const dynamicColorSettings = {
    STORAGE_KEY: 'dynamic-color-enabled',

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
    BUTTERCHURN_CYCLE_KEY: 'butterchurn-cycle-duration',

    getPreset() {
        try {
            return localStorage.getItem(this.PRESET_KEY) || 'butterchurn';
        } catch {
            return 'butterchurn';
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

    // Butterchurn preset cycle duration in seconds
    getButterchurnCycleDuration() {
        try {
            const val = localStorage.getItem(this.BUTTERCHURN_CYCLE_KEY);
            return val ? parseInt(val, 10) : 30;
        } catch {
            return 30;
        }
    },

    setButterchurnCycleDuration(seconds) {
        localStorage.setItem(this.BUTTERCHURN_CYCLE_KEY, seconds.toString());
    },

    // Butterchurn cycle enabled
    isButterchurnCycleEnabled() {
        try {
            return localStorage.getItem('butterchurn-cycle-enabled') !== 'false';
        } catch {
            return true;
        }
    },

    setButterchurnCycleEnabled(enabled) {
        localStorage.setItem('butterchurn-cycle-enabled', enabled);
    },

    // Butterchurn randomize preset
    isButterchurnRandomizeEnabled() {
        try {
            return localStorage.getItem('butterchurn-randomize-enabled') !== 'false';
        } catch {
            return true;
        }
    },

    setButterchurnRandomizeEnabled(enabled) {
        localStorage.setItem('butterchurn-randomize-enabled', enabled);
    },
};

export const equalizerSettings = {
    ENABLED_KEY: 'equalizer-enabled',
    GAINS_KEY: 'equalizer-gains',
    PRESET_KEY: 'equalizer-preset',
    CUSTOM_PRESETS_KEY: 'equalizer-custom-presets',
    BAND_COUNT_KEY: 'equalizer-band-count',
    RANGE_MIN_KEY: 'equalizer-range-min',
    RANGE_MAX_KEY: 'equalizer-range-max',
    FREQ_MIN_KEY: 'equalizer-freq-min',
    FREQ_MAX_KEY: 'equalizer-freq-max',
    PREAMP_KEY: 'equalizer-preamp',
    DEFAULT_BAND_COUNT: 16,
    MIN_BANDS: 3,
    MAX_BANDS: 32,
    DEFAULT_RANGE_MIN: -30,
    DEFAULT_RANGE_MAX: 30,
    ABSOLUTE_MIN: -60,
    ABSOLUTE_MAX: 60,
    DEFAULT_FREQ_MIN: 20,
    DEFAULT_FREQ_MAX: 20000,
    ABSOLUTE_FREQ_MIN: 10,
    ABSOLUTE_FREQ_MAX: 96000,
    DEFAULT_PREAMP: 0,
    PREAMP_MIN: -20,
    PREAMP_MAX: 20,

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

    getBandCount() {
        try {
            const stored = localStorage.getItem(this.BAND_COUNT_KEY);
            if (stored) {
                const count = parseInt(stored, 10);
                if (!isNaN(count) && count >= this.MIN_BANDS && count <= this.MAX_BANDS) {
                    return count;
                }
            }
        } catch {
            /* ignore */
        }
        return this.DEFAULT_BAND_COUNT;
    },

    setBandCount(count) {
        const validCount = Math.max(
            this.MIN_BANDS,
            Math.min(this.MAX_BANDS, parseInt(count, 10) || this.DEFAULT_BAND_COUNT)
        );
        localStorage.setItem(this.BAND_COUNT_KEY, validCount.toString());
    },

    getRangeMin() {
        try {
            const stored = localStorage.getItem(this.RANGE_MIN_KEY);
            if (stored) {
                const val = parseInt(stored, 10);
                if (!isNaN(val) && val >= this.ABSOLUTE_MIN && val < 0) {
                    return val;
                }
            }
        } catch {
            /* ignore */
        }
        return this.DEFAULT_RANGE_MIN;
    },

    setRangeMin(value) {
        const val = parseInt(value, 10);
        if (!isNaN(val) && val >= this.ABSOLUTE_MIN && val < 0) {
            localStorage.setItem(this.RANGE_MIN_KEY, val.toString());
            return true;
        }
        return false;
    },

    getRangeMax() {
        try {
            const stored = localStorage.getItem(this.RANGE_MAX_KEY);
            if (stored) {
                const val = parseInt(stored, 10);
                if (!isNaN(val) && val > 0 && val <= this.ABSOLUTE_MAX) {
                    return val;
                }
            }
        } catch {
            /* ignore */
        }
        return this.DEFAULT_RANGE_MAX;
    },

    setRangeMax(value) {
        const val = parseInt(value, 10);
        if (!isNaN(val) && val > 0 && val <= this.ABSOLUTE_MAX) {
            localStorage.setItem(this.RANGE_MAX_KEY, val.toString());
            return true;
        }
        return false;
    },

    getRange() {
        return {
            min: this.getRangeMin(),
            max: this.getRangeMax(),
        };
    },

    setRange(min, max) {
        const validMin = this.setRangeMin(min);
        const validMax = this.setRangeMax(max);
        return validMin && validMax;
    },

    getFreqMin() {
        try {
            const stored = localStorage.getItem(this.FREQ_MIN_KEY);
            if (stored) {
                const val = parseInt(stored, 10);
                if (!isNaN(val) && val >= this.ABSOLUTE_FREQ_MIN && val < this.ABSOLUTE_FREQ_MAX) {
                    return val;
                }
            }
        } catch {
            /* ignore */
        }
        return this.DEFAULT_FREQ_MIN;
    },

    setFreqMin(value) {
        const val = parseInt(value, 10);
        // Get effective max from storage without recursive call
        let effectiveMax = this.DEFAULT_FREQ_MAX;
        try {
            const storedMax = localStorage.getItem(this.FREQ_MAX_KEY);
            if (storedMax) {
                const parsedMax = parseInt(storedMax, 10);
                if (!isNaN(parsedMax) && parsedMax > this.ABSOLUTE_FREQ_MIN && parsedMax <= this.ABSOLUTE_FREQ_MAX) {
                    effectiveMax = parsedMax;
                }
            }
        } catch {
            /* ignore and use default max */
        }
        if (!isNaN(val) && val >= this.ABSOLUTE_FREQ_MIN && val < effectiveMax) {
            localStorage.setItem(this.FREQ_MIN_KEY, val.toString());
            return true;
        }
        return false;
    },

    getFreqMax() {
        try {
            const storedMax = localStorage.getItem(this.FREQ_MAX_KEY);
            if (storedMax) {
                const maxVal = parseInt(storedMax, 10);
                if (!isNaN(maxVal) && maxVal > this.ABSOLUTE_FREQ_MIN && maxVal <= this.ABSOLUTE_FREQ_MAX) {
                    // Get stored min without recursive call
                    try {
                        const storedMin = localStorage.getItem(this.FREQ_MIN_KEY);
                        if (storedMin) {
                            const minVal = parseInt(storedMin, 10);
                            if (!isNaN(minVal) && maxVal <= minVal) {
                                return this.DEFAULT_FREQ_MAX;
                            }
                        }
                    } catch {
                        /* ignore */
                    }
                    return maxVal;
                }
            }
        } catch {
            /* ignore */
        }
        return this.DEFAULT_FREQ_MAX;
    },

    setFreqMax(value) {
        const maxVal = parseInt(value, 10);
        if (!isNaN(maxVal) && maxVal > this.ABSOLUTE_FREQ_MIN && maxVal <= this.ABSOLUTE_FREQ_MAX) {
            // Check against stored min without recursive call
            try {
                const storedMin = localStorage.getItem(this.FREQ_MIN_KEY);
                if (storedMin) {
                    const minVal = parseInt(storedMin, 10);
                    if (!isNaN(minVal) && maxVal <= minVal) {
                        return false;
                    }
                }
            } catch {
                /* ignore */
            }
            localStorage.setItem(this.FREQ_MAX_KEY, maxVal.toString());
            return true;
        }
        return false;
    },

    getFreqRange() {
        return {
            min: this.getFreqMin(),
            max: this.getFreqMax(),
        };
    },

    setFreqRange(min, max) {
        const validMax = this.setFreqMax(max);
        const validMin = this.setFreqMin(min);
        return validMin && validMax;
    },

    getPreamp() {
        try {
            const stored = localStorage.getItem(this.PREAMP_KEY);
            if (stored) {
                const val = parseFloat(stored);
                if (!isNaN(val) && val >= this.PREAMP_MIN && val <= this.PREAMP_MAX) {
                    return val;
                }
            }
        } catch {
            /* ignore */
        }
        return this.DEFAULT_PREAMP;
    },

    setPreamp(value) {
        const val = parseFloat(value);
        if (!isNaN(val) && val >= this.PREAMP_MIN && val <= this.PREAMP_MAX) {
            localStorage.setItem(this.PREAMP_KEY, val.toString());
            return true;
        }
        return false;
    },

    getGains(bandCount) {
        const count = bandCount || this.getBandCount();
        try {
            const stored = localStorage.getItem(this.GAINS_KEY);
            if (stored) {
                const gains = JSON.parse(stored);
                if (Array.isArray(gains)) {
                    // If stored gains match current band count, return them
                    if (gains.length === count) {
                        return gains;
                    }
                    // If different band count, try to interpolate or return flat
                    if (gains.length > 0) {
                        return this._interpolateGains(gains, count);
                    }
                }
            }
        } catch {
            /* ignore */
        }
        // Return flat EQ (all zeros) by default
        return new Array(count).fill(0);
    },

    setGains(gains) {
        try {
            if (Array.isArray(gains) && gains.length >= this.MIN_BANDS && gains.length <= this.MAX_BANDS) {
                localStorage.setItem(this.GAINS_KEY, JSON.stringify(gains));
            }
        } catch (e) {
            console.warn('[EQ] Failed to save gains:', e);
        }
    },

    /**
     * Interpolate gains array to match target band count
     */
    _interpolateGains(sourceGains, targetCount) {
        if (sourceGains.length === targetCount) {
            return [...sourceGains];
        }

        const result = [];
        for (let i = 0; i < targetCount; i++) {
            // Map target index to source index
            const sourceIndex = (i / (targetCount - 1)) * (sourceGains.length - 1);
            const indexLow = Math.floor(sourceIndex);
            const indexHigh = Math.min(Math.ceil(sourceIndex), sourceGains.length - 1);
            const fraction = sourceIndex - indexLow;

            // Linear interpolation
            const lowValue = sourceGains[indexLow] || 0;
            const highValue = sourceGains[indexHigh] || 0;
            const interpolated = lowValue + (highValue - lowValue) * fraction;
            result.push(Math.round(interpolated * 10) / 10);
        }
        return result;
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

    // Custom Preset Methods
    getCustomPresets() {
        try {
            const stored = localStorage.getItem(this.CUSTOM_PRESETS_KEY);
            if (stored) {
                const presets = JSON.parse(stored);
                if (typeof presets === 'object' && presets !== null) {
                    return presets;
                }
            }
        } catch {
            /* ignore */
        }
        return {};
    },

    saveCustomPreset(name, gains) {
        try {
            if (!name || !Array.isArray(gains) || gains.length < this.MIN_BANDS || gains.length > this.MAX_BANDS) {
                console.warn('[EQ] Invalid preset data');
                return false;
            }

            // Sanitize name - remove special characters and limit length
            const sanitizedName = name
                .trim()
                .substring(0, 50)
                .replace(/[^\w\s-]/g, '');
            if (!sanitizedName) {
                console.warn('[EQ] Invalid preset name');
                return false;
            }

            const presets = this.getCustomPresets();
            const presetId = 'custom_' + Date.now();

            presets[presetId] = {
                name: sanitizedName,
                gains: gains.map((g) => Math.round(g * 10) / 10), // Round to 1 decimal place
                bandCount: gains.length,
                createdAt: Date.now(),
            };

            localStorage.setItem(this.CUSTOM_PRESETS_KEY, JSON.stringify(presets));
            return presetId;
        } catch (e) {
            console.warn('[EQ] Failed to save custom preset:', e);
            return false;
        }
    },

    deleteCustomPreset(presetId) {
        try {
            const presets = this.getCustomPresets();
            if (presets[presetId]) {
                delete presets[presetId];
                localStorage.setItem(this.CUSTOM_PRESETS_KEY, JSON.stringify(presets));
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[EQ] Failed to delete custom preset:', e);
            return false;
        }
    },

    updateCustomPreset(presetId, name, gains) {
        try {
            const presets = this.getCustomPresets();
            if (!presets[presetId]) {
                return false;
            }

            if (name !== undefined) {
                const sanitizedName = name
                    .trim()
                    .substring(0, 50)
                    .replace(/[^\w\s-]/g, '');
                if (sanitizedName) {
                    presets[presetId].name = sanitizedName;
                }
            }

            if (Array.isArray(gains) && gains.length === this.DEFAULT_BAND_COUNT) {
                presets[presetId].gains = gains.map((g) => Math.round(g * 10) / 10);
                presets[presetId].updatedAt = Date.now();
            }

            localStorage.setItem(this.CUSTOM_PRESETS_KEY, JSON.stringify(presets));
            return true;
        } catch (e) {
            console.warn('[EQ] Failed to update custom preset:', e);
            return false;
        }
    },
};

export const monoAudioSettings = {
    STORAGE_KEY: 'mono-audio-enabled',

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

export const exponentialVolumeSettings = {
    STORAGE_KEY: 'exponential-volume-enabled',

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

    // Apply exponential curve to linear volume (0-1)
    // Uses a power curve: output = input^3 for more natural volume control
    applyCurve(linearVolume) {
        if (!this.isEnabled()) {
            return linearVolume;
        }
        // Exponential curve: cubed for much finer low-volume control
        // This creates a more dramatic difference that you'll actually notice
        return Math.pow(linearVolume, 3);
    },

    // Convert from perceived volume back to linear for UI
    inverseCurve(perceivedVolume) {
        if (!this.isEnabled()) {
            return perceivedVolume;
        }
        return Math.cbrt(perceivedVolume);
    },
};

export const audioEffectsSettings = {
    SPEED_KEY: 'audio-effects-speed',

    // Playback speed (0.01 to 100, default 1.0)
    getSpeed() {
        try {
            const val = parseFloat(localStorage.getItem(this.SPEED_KEY));
            return isNaN(val) ? 1.0 : Math.max(0.01, Math.min(100, val));
        } catch {
            return 1.0;
        }
    },

    setSpeed(speed) {
        const validSpeed = Math.max(0.01, Math.min(100, parseFloat(speed) || 1.0));
        localStorage.setItem(this.SPEED_KEY, validSpeed.toString());
    },
};

export const settingsUiState = {
    ACTIVE_TAB_KEY: 'settings-active-tab',

    getActiveTab() {
        try {
            return localStorage.getItem(this.ACTIVE_TAB_KEY) || 'appearance';
        } catch {
            return 'appearance';
        }
    },

    setActiveTab(tab) {
        localStorage.setItem(this.ACTIVE_TAB_KEY, tab);
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

    SHOW_EDITORS_PICKS_KEY: 'home-show-editors-picks',

    shouldShowEditorsPicks() {
        try {
            const val = localStorage.getItem(this.SHOW_EDITORS_PICKS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowEditorsPicks(enabled) {
        localStorage.setItem(this.SHOW_EDITORS_PICKS_KEY, enabled ? 'true' : 'false');
    },

    SHUFFLE_EDITORS_PICKS_KEY: 'home-shuffle-editors-picks',

    shouldShuffleEditorsPicks() {
        try {
            const val = localStorage.getItem(this.SHUFFLE_EDITORS_PICKS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShuffleEditorsPicks(enabled) {
        localStorage.setItem(this.SHUFFLE_EDITORS_PICKS_KEY, enabled ? 'true' : 'false');
    },
};

export const analyticsSettings = {
    ENABLED_KEY: 'analytics-enabled',

    isEnabled() {
        try {
            const val = localStorage.getItem(this.ENABLED_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.ENABLED_KEY, enabled ? 'true' : 'false');
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
    ORDER_KEY: 'sidebar-menu-order',
    DEFAULT_ORDER: [
        'sidebar-nav-home',
        'sidebar-nav-library',
        'sidebar-nav-recent',
        'sidebar-nav-unreleased',
        'sidebar-nav-donate',
        'sidebar-nav-settings',
        'sidebar-nav-account',
        'sidebar-nav-about-bottom',
        'sidebar-nav-download-bottom',
        'sidebar-nav-discordbtn',
    ],

    getBottomNavIds() {
        const ul = document.querySelector('.sidebar-nav.bottom ul');
        if (!ul) return [];
        return Array.from(ul.children).map((li) => li.id);
    },

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
        return true;
    },

    setShowSettings(enabled) {
        if (enabled) {
            localStorage.setItem(this.SHOW_SETTINGS_KEY, 'true');
        } else {
            localStorage.removeItem(this.SHOW_SETTINGS_KEY);
        }
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

    normalizeOrder(order) {
        const baseOrder = this.DEFAULT_ORDER;
        const safeOrder = Array.isArray(order) ? order.filter((id) => baseOrder.includes(id)) : [];
        const uniqueOrder = [...new Set(safeOrder)];
        const missing = baseOrder.filter((id) => !uniqueOrder.includes(id));
        return [...uniqueOrder, ...missing];
    },

    getOrder() {
        try {
            const stored = localStorage.getItem(this.ORDER_KEY);
            if (stored) {
                return this.normalizeOrder(JSON.parse(stored));
            }
        } catch {
            // ignore
        }
        return this.normalizeOrder([]);
    },

    setOrder(order) {
        const normalized = this.normalizeOrder(order);
        localStorage.setItem(this.ORDER_KEY, JSON.stringify(normalized));
    },

    applySidebarOrder() {
        const mainList = document.querySelector('.sidebar-nav.main ul');
        const bottomList = document.querySelector('.sidebar-nav.bottom ul');
        if (!mainList) return;

        const order = this.getOrder();
        const bottomIds = this.getBottomNavIds();
        const mainOrder = order.filter((id) => !bottomIds.includes(id));
        const bottomOrder = order.filter((id) => bottomIds.includes(id));

        mainOrder.forEach((id) => {
            const item = document.getElementById(id);
            if (item) mainList.appendChild(item);
        });

        if (bottomList) {
            bottomOrder.forEach((id) => {
                const item = document.getElementById(id);
                if (item) bottomList.appendChild(item);
            });
        }
    },

    applySidebarVisibility() {
        this.applySidebarOrder();
        const items = [
            { id: 'sidebar-nav-home', check: this.shouldShowHome() },
            { id: 'sidebar-nav-library', check: this.shouldShowLibrary() },
            { id: 'sidebar-nav-recent', check: this.shouldShowRecent() },
            { id: 'sidebar-nav-unreleased', check: this.shouldShowUnreleased() },
            { id: 'sidebar-nav-donate', check: this.shouldShowDonate() },
            { id: 'sidebar-nav-settings', check: this.shouldShowSettings() },
            { id: 'sidebar-nav-account', check: this.shouldShowAccount() },
            { id: 'sidebar-nav-about-bottom', check: this.shouldShowAbout() },
            { id: 'sidebar-nav-download-bottom', check: this.shouldShowDownload() },
            { id: 'sidebar-nav-discordbtn', check: this.shouldShowDiscord() },
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
            document.documentElement.setAttribute('data-theme', e.matches ? 'monochrome' : 'white');
        }
    });
}

export const fontSettings = {
    STORAGE_KEY: 'monochrome-font-config-v2',
    CUSTOM_FONTS_KEY: 'monochrome-custom-fonts',
    FONT_SIZE_KEY: 'monochrome-font-size',
    FONT_LINK_ID: 'monochrome-dynamic-font',
    FONT_FACE_ID: 'monochrome-dynamic-fontface',

    getDefaultConfig() {
        return {
            type: 'preset',
            family: 'Inter',
            fallback: 'sans-serif',
            weights: [400, 500, 600, 700, 800],
        };
    },

    getDefaultFontSize() {
        return 100; // 100% = default size
    },

    getFontSize() {
        try {
            const stored = localStorage.getItem(this.FONT_SIZE_KEY);
            if (stored) {
                const size = parseInt(stored, 10);
                if (!isNaN(size) && size >= 50 && size <= 200) {
                    return size;
                }
            }
        } catch {
            // ignore
        }
        return this.getDefaultFontSize();
    },

    setFontSize(size) {
        const validSize = Math.max(50, Math.min(200, parseInt(size, 10) || 100));
        localStorage.setItem(this.FONT_SIZE_KEY, validSize.toString());
        this.applyFontSize();
        return validSize;
    },

    applyFontSize() {
        const size = this.getFontSize();
        document.documentElement.style.setProperty('--font-size-scale', `${size}%`);
    },

    resetFontSize() {
        localStorage.removeItem(this.FONT_SIZE_KEY);
        this.applyFontSize();
        return this.getDefaultFontSize();
    },

    getConfig() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch {
            // ignore
        }
        return this.getDefaultConfig();
    },

    setConfig(config) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
    },

    parseGoogleFontsUrl(url) {
        try {
            if (url.includes('fonts.google.com/specimen/')) {
                const match = url.match(/specimen\/([^/?]+)/);
                if (match) {
                    return decodeURIComponent(match[1]).replace(/\+/g, ' ');
                }
            }
            if (url.includes('fonts.googleapis.com/css')) {
                const match = url.match(/family=([^&:]+)/);
                if (match) {
                    return decodeURIComponent(match[1]).replace(/\+/g, ' ').split(':')[0];
                }
            }
        } catch {
            // ignore
        }
        return null;
    },

    async loadGoogleFont(familyName) {
        // Validate familyName to prevent injection
        if (!familyName || typeof familyName !== 'string') {
            return;
        }
        // Only allow alphanumeric, spaces, and basic punctuation in font names
        const sanitizedFamily = familyName.replace(/[^a-zA-Z0-9\s\-_,.]/g, '');
        if (!sanitizedFamily) {
            return;
        }

        const encodedFamily = encodeURIComponent(sanitizedFamily);
        const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@100;200;300;400;500;600;700;800;900&display=swap`;

        let link = document.getElementById(this.FONT_LINK_ID);
        if (!link) {
            link = document.createElement('link');
            link.id = this.FONT_LINK_ID;
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }

        link.href = url;

        this.setConfig({
            type: 'google',
            family: familyName,
            fallback: 'sans-serif',
            weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        });

        document.documentElement.style.setProperty('--font-family', `'${familyName}', sans-serif`);
    },

    async loadFontFromUrl(url, familyName) {
        const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
        const fontFaceId = this.FONT_FACE_ID;

        let style = document.getElementById(fontFaceId);
        if (!style) {
            style = document.createElement('style');
            style.id = fontFaceId;
            document.head.appendChild(style);
        }

        const format = this.getFontFormat(url);
        const fontFamily = familyName || 'CustomFont';

        style.textContent = `
            @font-face {
                font-family: '${fontFamily}';
                src: url('${url}') format('${format}');
                font-weight: 100 900;
                font-style: normal;
                font-display: swap;
            }
        `;

        this.setConfig({
            type: 'url',
            family: fontFamily,
            url: url,
            fallback: 'sans-serif',
            weights: weights,
        });

        document.documentElement.style.setProperty('--font-family', `'${fontFamily}', sans-serif`);
    },

    getFontFormat(url) {
        const ext = url.split('.').pop().toLowerCase();
        const formats = {
            woff2: 'woff2',
            woff: 'woff',
            ttf: 'truetype',
            otf: 'opentype',
        };
        return formats[ext] || 'woff2';
    },

    async saveUploadedFont(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result;
                const fontId = 'uploaded-' + Date.now();
                const customFonts = this.getCustomFonts();

                customFonts[fontId] = {
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    base64: base64,
                    format: this.getFontFormat(file.name),
                    size: file.size,
                    uploadedAt: Date.now(),
                };

                localStorage.setItem(this.CUSTOM_FONTS_KEY, JSON.stringify(customFonts));
                resolve({ id: fontId, ...customFonts[fontId] });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    getCustomFonts() {
        try {
            const stored = localStorage.getItem(this.CUSTOM_FONTS_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    },

    async loadUploadedFont(fontId) {
        const customFonts = this.getCustomFonts();
        const font = customFonts[fontId];

        if (!font) {
            throw new Error('Font not found');
        }

        const fontFamily = font.name || 'UploadedFont';
        const fontFaceId = this.FONT_FACE_ID;

        let style = document.getElementById(fontFaceId);
        if (!style) {
            style = document.createElement('style');
            style.id = fontFaceId;
            document.head.appendChild(style);
        }

        style.textContent = `
            @font-face {
                font-family: '${fontFamily}';
                src: url('${font.base64}') format('${font.format}');
                font-weight: 100 900;
                font-style: normal;
                font-display: swap;
            }
        `;

        this.setConfig({
            type: 'uploaded',
            family: fontFamily,
            fontId: fontId,
            fallback: 'sans-serif',
            weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        });

        document.documentElement.style.setProperty('--font-family', `'${fontFamily}', sans-serif`);
    },

    deleteUploadedFont(fontId) {
        const customFonts = this.getCustomFonts();
        delete customFonts[fontId];
        localStorage.setItem(this.CUSTOM_FONTS_KEY, JSON.stringify(customFonts));
    },

    loadPresetFont(family, fallback = 'sans-serif') {
        let link = document.getElementById(this.FONT_LINK_ID);
        if (link) {
            link.remove();
        }

        let style = document.getElementById(this.FONT_FACE_ID);
        if (style) {
            style.remove();
        }

        this.setConfig({
            type: 'preset',
            family: family,
            fallback: fallback,
            weights: [400, 500, 600, 700, 800],
        });

        const fontValue = family === 'monospace' ? 'monospace' : `'${family}', ${fallback}`;
        document.documentElement.style.setProperty('--font-family', fontValue);
    },

    loadAppleMusicFont() {
        const APPLE_FONT_LINK_ID = 'monochrome-apple-font';

        // Remove any existing dynamic font links
        let existingLink = document.getElementById(this.FONT_LINK_ID);
        if (existingLink) {
            existingLink.remove();
        }

        // Remove any existing @font-face styles
        let existingStyle = document.getElementById(this.FONT_FACE_ID);
        if (existingStyle) {
            existingStyle.remove();
        }

        // Load Apple font CSS
        let link = document.getElementById(APPLE_FONT_LINK_ID);
        if (!link) {
            link = document.createElement('link');
            link.id = APPLE_FONT_LINK_ID;
            link.rel = 'stylesheet';
            link.href = '/fonts/apple/sf-pro-display.css';
            document.head.appendChild(link);
        }

        this.setConfig({
            type: 'preset',
            family: 'Apple Music',
            fallback: 'sans-serif',
            weights: [400, 500, 600, 700],
        });

        document.documentElement.style.setProperty('--font-family', "'SF Pro Display', sans-serif");
    },

    applyFont() {
        const config = this.getConfig();

        switch (config.type) {
            case 'google':
                this.loadGoogleFont(config.family);
                break;
            case 'url':
                this.loadFontFromUrl(config.url, config.family);
                break;
            case 'uploaded':
                this.loadUploadedFont(config.fontId);
                break;
            case 'preset':
            default:
                if (config.family === 'Apple Music') {
                    this.loadAppleMusicFont();
                } else {
                    this.loadPresetFont(config.family, config.fallback);
                }
                break;
        }
    },

    getUploadedFontList() {
        const fonts = this.getCustomFonts();
        return Object.entries(fonts).map(([id, font]) => ({
            id,
            name: font.name,
            size: font.size,
            uploadedAt: font.uploadedAt,
        }));
    },
};

export const pwaUpdateSettings = {
    STORAGE_KEY: 'pwa-auto-update-enabled',

    isAutoUpdateEnabled() {
        try {
            // Default to true (auto-update) if not set
            return localStorage.getItem(this.STORAGE_KEY) !== 'false';
        } catch {
            return true;
        }
    },

    setAutoUpdateEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const musicProviderSettings = {
    STORAGE_KEY: 'music-provider',

    getProvider() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'tidal';
        } catch {
            return 'tidal';
        }
    },

    setProvider(provider) {
        localStorage.setItem(this.STORAGE_KEY, provider);
    },
};

export const modalSettings = {
    STORAGE_KEY: 'close-modals-on-navigation',
    INTERCEPT_BACK_KEY: 'intercept-back-to-close-modals',

    shouldCloseOnNavigation() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved === null) {
                return false;
            }
            return saved === 'true';
        } catch {
            return false;
        }
    },

    setCloseOnNavigation(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },

    shouldInterceptBackToClose() {
        try {
            const saved = localStorage.getItem(this.INTERCEPT_BACK_KEY);
            if (saved === null) {
                return false;
            }
            return saved === 'true';
        } catch {
            return false;
        }
    },

    setInterceptBackToClose(enabled) {
        localStorage.setItem(this.INTERCEPT_BACK_KEY, enabled ? 'true' : 'false');
    },

    hasOpenModalsOrPanels() {
        const sidePanel = document.getElementById('side-panel');
        if (sidePanel && sidePanel.classList.contains('active')) {
            return true;
        }
        if (document.querySelector('.modal.active')) {
            return true;
        }
        if (document.querySelector('.modal-overlay')) {
            return true;
        }
        const modalIds = [
            'playlist-modal',
            'folder-modal',
            'playlist-select-modal',
            'shortcuts-modal',
            'missing-tracks-modal',
            'sleep-timer-modal',
            'discography-download-modal',
            'custom-db-modal',
            'tracker-modal',
            'epilepsy-warning-modal',
        ];
        for (const id of modalIds) {
            const modal = document.getElementById(id);
            if (modal && modal.classList.contains('active')) {
                return true;
            }
        }
        return false;
    },

    closeAllModals() {
        // Close all modal overlays
        document.querySelectorAll('.modal-overlay').forEach((modal) => {
            modal.remove();
        });

        // Close all modals with active class
        document.querySelectorAll('.modal.active').forEach((modal) => {
            modal.classList.remove('active');
        });

        // Close specific modals by ID
        const modalIds = [
            'playlist-modal',
            'folder-modal',
            'playlist-select-modal',
            'shortcuts-modal',
            'missing-tracks-modal',
            'sleep-timer-modal',
            'discography-download-modal',
            'custom-db-modal',
            'tracker-modal',
            'epilepsy-warning-modal',
        ];

        modalIds.forEach((id) => {
            const modal = document.getElementById(id);
            if (modal) {
                modal.classList.remove('active');
            }
        });
    },
};

export const contentBlockingSettings = {
    BLOCKED_ARTISTS_KEY: 'blocked-artists',
    BLOCKED_TRACKS_KEY: 'blocked-tracks',
    BLOCKED_ALBUMS_KEY: 'blocked-albums',

    // Blocked Artists
    getBlockedArtists() {
        try {
            const data = localStorage.getItem(this.BLOCKED_ARTISTS_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    },

    setBlockedArtists(artists) {
        localStorage.setItem(this.BLOCKED_ARTISTS_KEY, JSON.stringify(artists));
    },

    isArtistBlocked(artistId) {
        if (!artistId) return false;
        return this.getBlockedArtists().some((a) => a.id === artistId);
    },

    blockArtist(artist) {
        if (!artist || !artist.id) return;
        const blocked = this.getBlockedArtists();
        if (!blocked.some((a) => a.id === artist.id)) {
            blocked.push({
                id: artist.id,
                name: artist.name || 'Unknown Artist',
                blockedAt: Date.now(),
            });
            this.setBlockedArtists(blocked);
        }
    },

    unblockArtist(artistId) {
        const blocked = this.getBlockedArtists().filter((a) => a.id !== artistId);
        this.setBlockedArtists(blocked);
    },

    // Blocked Tracks
    getBlockedTracks() {
        try {
            const data = localStorage.getItem(this.BLOCKED_TRACKS_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    },

    setBlockedTracks(tracks) {
        localStorage.setItem(this.BLOCKED_TRACKS_KEY, JSON.stringify(tracks));
    },

    isTrackBlocked(trackId) {
        if (!trackId) return false;
        return this.getBlockedTracks().some((t) => t.id === trackId);
    },

    blockTrack(track) {
        if (!track || !track.id) return;
        const blocked = this.getBlockedTracks();
        if (!blocked.some((t) => t.id === track.id)) {
            blocked.push({
                id: track.id,
                title: track.title || 'Unknown Track',
                artist: track.artist?.name || track.artist || 'Unknown Artist',
                blockedAt: Date.now(),
            });
            this.setBlockedTracks(blocked);
        }
    },

    unblockTrack(trackId) {
        const blocked = this.getBlockedTracks().filter((t) => t.id !== trackId);
        this.setBlockedTracks(blocked);
    },

    // Blocked Albums
    getBlockedAlbums() {
        try {
            const data = localStorage.getItem(this.BLOCKED_ALBUMS_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    },

    setBlockedAlbums(albums) {
        localStorage.setItem(this.BLOCKED_ALBUMS_KEY, JSON.stringify(albums));
    },

    isAlbumBlocked(albumId) {
        if (!albumId) return false;
        return this.getBlockedAlbums().some((a) => a.id === albumId);
    },

    blockAlbum(album) {
        if (!album || !album.id) return;
        const blocked = this.getBlockedAlbums();
        if (!blocked.some((a) => a.id === album.id)) {
            blocked.push({
                id: album.id,
                title: album.title || 'Unknown Album',
                artist: album.artist?.name || album.artist || 'Unknown Artist',
                blockedAt: Date.now(),
            });
            this.setBlockedAlbums(blocked);
        }
    },

    unblockAlbum(albumId) {
        const blocked = this.getBlockedAlbums().filter((a) => a.id !== albumId);
        this.setBlockedAlbums(blocked);
    },

    // Check if track should be hidden (blocked track or by blocked artist)
    shouldHideTrack(track) {
        if (!track) return true;
        if (this.isTrackBlocked(track.id)) return true;
        if (track.artist?.id && this.isArtistBlocked(track.artist.id)) return true;
        if (track.artists?.some((a) => this.isArtistBlocked(a.id))) return true;
        if (track.album?.id && this.isAlbumBlocked(track.album.id)) return true;
        return false;
    },

    // Check if album should be hidden
    shouldHideAlbum(album) {
        if (!album) return true;
        if (this.isAlbumBlocked(album.id)) return true;
        if (album.artist?.id && this.isArtistBlocked(album.artist.id)) return true;
        if (album.artists?.some((a) => this.isArtistBlocked(a.id))) return true;
        return false;
    },

    // Check if artist should be hidden
    shouldHideArtist(artist) {
        if (!artist) return true;
        return this.isArtistBlocked(artist.id);
    },

    // Filter arrays
    filterTracks(tracks) {
        return tracks.filter((t) => !this.shouldHideTrack(t));
    },

    filterAlbums(albums) {
        return albums.filter((a) => !this.shouldHideAlbum(a));
    },

    filterArtists(artists) {
        return artists.filter((a) => !this.shouldHideArtist(a));
    },

    // Get all blocked items count
    getTotalBlockedCount() {
        return this.getBlockedArtists().length + this.getBlockedTracks().length + this.getBlockedAlbums().length;
    },

    // Clear all blocked items
    clearAllBlocked() {
        localStorage.removeItem(this.BLOCKED_ARTISTS_KEY);
        localStorage.removeItem(this.BLOCKED_TRACKS_KEY);
        localStorage.removeItem(this.BLOCKED_ALBUMS_KEY);
    },
};
