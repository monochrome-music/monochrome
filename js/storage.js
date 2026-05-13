//storage.js

import { SVG_RIGHT_ARROW } from './icons';

export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances-v9',
    INSTANCES_URLS: ['https://tidal-uptime.geeked.wtf'],
    defaultInstances: { api: [], streaming: [], qobuz: [] },
    userInstances: null,
    instancesLoaded: false,
    _loadPromise: null,

    _loadUserInstances() {
        if (this.userInstances) return this.userInstances;
        try {
            const stored = localStorage.getItem('monochrome-user-api-instances-v1');
            const parsed = stored ? JSON.parse(stored) : { api: [], streaming: [], qobuz: [] };
            if (!parsed.qobuz) parsed.qobuz = [];
            this.userInstances = parsed;
        } catch {
            this.userInstances = { api: [], streaming: [], qobuz: [] };
        }
        return this.userInstances;
    },

    _saveUserInstances() {
        localStorage.setItem('monochrome-user-api-instances-v1', JSON.stringify(this.userInstances));
    },

    async loadInstancesFromGitHub() {
        if (this.instancesLoaded) {
            return this.defaultInstances;
        }

        if (this._loadPromise) {
            return this._loadPromise;
        }

        this._loadPromise = (async () => {
            const cachedData = localStorage.getItem(this.STORAGE_KEY);
            if (cachedData) {
                try {
                    const parsed = JSON.parse(cachedData);
                    const now = Date.now();
                    // Check if cached data is less than 15 minutes old
                    if (parsed.timestamp && now - parsed.timestamp < 15 * 60 * 1000) {
                        this.defaultInstances = parsed.data;
                        this.instancesLoaded = true;
                        this._loadPromise = null;
                        return this.defaultInstances;
                    }
                } catch (e) {
                    console.warn('Failed to parse cached instances:', e);
                }
            }

            let data = null;
            let fetchError = null;

            // Prefer first URL, only try others as fallback
            const urls = [...this.INSTANCES_URLS];

            for (const url of urls) {
                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    data = await response.json();
                    break; // Success, exit loop
                } catch (error) {
                    console.warn(`Failed to fetch from ${url}:`, error);
                    fetchError = error;
                }
            }

            if (!data) {
                console.error('Failed to load instances from all uptime APIs:', fetchError);
                this.defaultInstances = {
                    api: [
                        { url: 'https://hifi.geeked.wtf', version: '2.7' },
                        { url: 'https://eu-central.monochrome.tf', version: '2.7' },
                        { url: 'https://us-west.monochrome.tf', version: '2.7' },
                        { url: 'https://api.monochrome.tf', version: '2.5' },
                        { url: 'https://monochrome-api.samidy.com', version: '2.3' },
                        { url: 'https://maus.qqdl.site', version: '2.6' },
                        { url: 'https://vogel.qqdl.site', version: '2.6' },
                        { url: 'https://katze.qqdl.site', version: '2.6' },
                        { url: 'https://hund.qqdl.site', version: '2.6' },
                        { url: 'https://tidal.kinoplus.online', version: '2.2' },
                        { url: 'https://wolf.qqdl.site', version: '2.2' },
                    ],
                    streaming: [
                        { url: 'https://hifi.geeked.wtf', version: '2.7' },
                        { url: 'https://maus.qqdl.site', version: '2.6' },
                        { url: 'https://vogel.qqdl.site', version: '2.6' },
                        { url: 'https://katze.qqdl.site', version: '2.6' },
                        { url: 'https://hund.qqdl.site', version: '2.6' },
                        { url: 'https://wolf.qqdl.site', version: '2.6' },
                    ],
                    qobuz: [
                        { url: 'https://qdl-api.monochrome.tf', version: '1.0' },
                        { url: 'https://qobuz.kennyy.com.br', version: '1.0' },
                    ],
                };
                this.instancesLoaded = true;
                this._loadPromise = null;
                return this.defaultInstances;
            }

            let groupedInstances = { api: [], streaming: [], qobuz: [] };

            const isBlockedInstance = (item) => {
                const url = typeof item === 'string' ? item : item.url;
                return url && /\.squid\.wtf/i.test(url);
            };

            if (data.api && Array.isArray(data.api)) {
                groupedInstances.api = data.api.filter((item) => !isBlockedInstance(item));
            }

            if (data.streaming && Array.isArray(data.streaming)) {
                groupedInstances.streaming = data.streaming.filter((item) => !isBlockedInstance(item));
            } else if (groupedInstances.api.length > 0) {
                groupedInstances.streaming = [...groupedInstances.api];
            }

            if (data.qobuz && Array.isArray(data.qobuz)) {
                groupedInstances.qobuz = data.qobuz;
            }

            // Ensure default Qobuz instance is always available
            if (groupedInstances.qobuz.length === 0) {
                groupedInstances.qobuz = [{ url: 'https://qdl-api.monochrome.tf', version: '1.0' }];
            }

            this.defaultInstances = groupedInstances;
            this.instancesLoaded = true;

            try {
                localStorage.setItem(
                    this.STORAGE_KEY,
                    JSON.stringify({
                        timestamp: Date.now(),
                        data: groupedInstances,
                    })
                );
            } catch (e) {
                console.warn('Failed to cache instances:', e);
            }

            this._loadPromise = null;
            return groupedInstances;
        })();

        return this._loadPromise;
    },

    async getInstances(type = 'api', _sortBySpeed = false) {
        let instancesObj;

        instancesObj = await this.loadInstancesFromGitHub();
        const userInst = this._loadUserInstances();

        const defaultUrls = instancesObj[type] || instancesObj.api || [];
        const userUrls = userInst[type] || [];

        const combined = [
            ...userUrls.map((u) => (typeof u === 'string' ? { url: u, isUser: true } : { ...u, isUser: true })),
            ...defaultUrls,
        ];

        if (combined.length === 0) return [];

        return combined;
    },

    addUserInstance(type, url) {
        const userInst = this._loadUserInstances();
        if (!userInst[type]) userInst[type] = [];

        if (!userInst[type].some((u) => (typeof u === 'string' ? u === url : u.url === url))) {
            userInst[type].push({ url, isUser: true, version: 'custom' });
            this._saveUserInstances();
            return true;
        }
        return false;
    },

    removeUserInstance(type, url) {
        const userInst = this._loadUserInstances();
        if (!userInst[type]) return false;

        const initialLength = userInst[type].length;
        userInst[type] = userInst[type].filter((u) => (typeof u === 'string' ? u !== url : u.url !== url));

        if (userInst[type].length !== initialLength) {
            this._saveUserInstances();
            return true;
        }
        return false;
    },

    async refreshInstances() {
        this.instancesLoaded = false;
        this._loadPromise = null;
        localStorage.removeItem(this.STORAGE_KEY);

        const instances = await this.loadInstancesFromGitHub();

        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        const prioritySort = (array) => {
            const getUrl = (item) => (typeof item === 'string' ? item : item.url || '');
            const top = [];
            const middle = [];
            const bottom = [];
            for (const item of array) {
                const url = getUrl(item);
                if (url.includes('hifi.geeked.wtf')) top.push(item);
                else if (url.includes('.qqdl.site')) bottom.push(item);
                else middle.push(item);
            }
            return [...top, ...shuffle(middle), ...shuffle(bottom)];
        };

        if (instances.api && instances.api.length) {
            instances.api = prioritySort([...instances.api]);
        }

        if (instances.streaming && instances.streaming.length) {
            instances.streaming = prioritySort([...instances.streaming]);
        }

        if (instances.qobuz && instances.qobuz.length) {
            instances.qobuz = shuffle([...instances.qobuz]);
        }

        this.saveInstances(instances);

        // Return API instances for the UI to render (default view)
        return this.getInstances('api');
    },
    saveInstances(instances, type) {
        if (type) {
            try {
                this._loadUserInstances();
                const userInst = instances.filter((i) => i.isUser);
                const defaultInst = instances.filter((i) => !i.isUser);

                this.userInstances[type] = userInst;
                this._saveUserInstances();

                const stored = localStorage.getItem(this.STORAGE_KEY);
                let fullObj = stored ? JSON.parse(stored) : { api: [], streaming: [] };

                if (fullObj && fullObj.data) {
                    fullObj.data[type] = defaultInst;
                } else {
                    if (!fullObj) fullObj = { api: [], streaming: [] };
                    fullObj[type] = defaultInst;
                }

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

        window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
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
        const parsed = parseInt(percentage, 10);
        const validPercentage = Math.max(1, Math.min(100, isNaN(parsed) ? 75 : parsed));
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

export const gaplessPlaybackSettings = {
    STORAGE_KEY: 'gapless-playback-enabled',

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

export const fullscreenCoverClickSettings = {
    STORAGE_KEY: 'fullscreen-cover-click-action',

    getAction() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'exit';
        } catch {
            return 'exit';
        }
    },

    setAction(action) {
        localStorage.setItem(this.STORAGE_KEY, action);
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

export const fullscreenCoverNoRoundSettings = {
    STORAGE_KEY: 'fullscreen-cover-no-round',

    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) !== 'false';
        } catch {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const fullscreenCoverVanillaTiltSettings = {
    STORAGE_KEY: 'fullscreen-cover-vanilla-tilt',

    isEnabled() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) !== 'false';
        } catch {
            return true;
        }
    },

    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const fullscreenCoverTiltDistanceSettings = {
    STORAGE_KEY: 'fullscreen-cover-tilt-distance',

    getValue() {
        try {
            const val = parseInt(localStorage.getItem(this.STORAGE_KEY));
            return val !== null && !isNaN(val) ? val : 10;
        } catch {
            return 10;
        }
    },

    setValue(value) {
        localStorage.setItem(this.STORAGE_KEY, value);
    },
};

export const fullscreenCoverTiltSpeedSettings = {
    STORAGE_KEY: 'fullscreen-cover-tilt-speed',

    getValue() {
        try {
            const val = parseInt(localStorage.getItem(this.STORAGE_KEY));
            return val !== null && !isNaN(val) ? val : 240;
        } catch {
            return 240;
        }
    },

    setValue(value) {
        localStorage.setItem(this.STORAGE_KEY, value);
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

export const artistBannerSettings = {
    STORAGE_KEY: 'artist-banners-enabled',

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
            const stored = localStorage.getItem(this.STORAGE_KEY) || 'HI_RES_LOSSLESS';
            // Migrate legacy value to renamed format
            if (stored === 'MP3_320') {
                this.setQuality('FFMPEG_MP3_320');
                return 'FFMPEG_MP3_320';
            }

            // Migrate legacy atmos value
            if (stored === 'DOLBY_ATMOS') {
                this.setQuality('HI_RES_LOSSLESS');
                preferDolbyAtmosSettings.setEnabled(true);
                return 'HI_RES_LOSSLESS';
            }

            return stored;
        } catch {
            return 'HI_RES_LOSSLESS';
        }
    },
    setQuality(quality) {
        localStorage.setItem(this.STORAGE_KEY, quality);
    },
};

export const preferDolbyAtmosSettings = {
    STORAGE_KEY: 'prefer-dolby-atmos',
    isEnabled() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY) || 'false';
            return stored === 'true';
        } catch {
            return false;
        }
    },
    setEnabled(enabled) {
        localStorage.setItem(this.STORAGE_KEY, enabled ? 'true' : 'false');
    },
};

export const losslessContainerSettings = {
    STORAGE_KEY: 'lossless-container',
    getContainer() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY) || 'flac';
            return stored;
        } catch {
            return 'flac';
        }
    },
    setContainer(container) {
        localStorage.setItem(this.STORAGE_KEY, container);
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

export const playlistSettings = {
    M3U_KEY: 'playlist-generate-m3u',
    M3U8_KEY: 'playlist-generate-m3u8',
    CUE_KEY: 'playlist-generate-cue',
    NFO_KEY: 'playlist-generate-nfo',
    JSON_KEY: 'playlist-generate-json',
    RELATIVE_PATHS_KEY: 'playlist-relative-paths',
    SEPARATE_DISCS_KEY: 'playlist-separate-discs-in-zip',
    INCLUDE_COVER_KEY: 'playlist-include-cover',

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

    shouldSeparateDiscsInZip() {
        try {
            const val = localStorage.getItem(this.SEPARATE_DISCS_KEY);
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

    setSeparateDiscsInZip(enabled) {
        localStorage.setItem(this.SEPARATE_DISCS_KEY, enabled ? 'true' : 'false');
    },

    shouldIncludeCover() {
        try {
            const val = localStorage.getItem(this.INCLUDE_COVER_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setIncludeCover(enabled) {
        localStorage.setItem(this.INCLUDE_COVER_KEY, enabled ? 'true' : 'false');
    },
};

export const visualizerSettings = {
    SENSITIVITY_KEY: 'visualizer-sensitivity',
    SMART_INTENSITY_KEY: 'visualizer-smart-intensity',
    ENABLED_KEY: 'visualizer-enabled',
    MODE_KEY: 'visualizer-mode', // 'solid' or 'blended'
    PRESET_KEY: 'visualizer-preset',
    BUTTERCHURN_CYCLE_KEY: 'butterchurn-cycle-duration',
    DIM_AMOUNT_KEY: 'visualizer-dim-amount',
    CD_ALBUM_COVER_KEY: 'cd-album-cover-enabled',

    getPreset() {
        try {
            return localStorage.getItem(this.PRESET_KEY) || 'kawarp';
        } catch {
            return 'kawarp';
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

    getDimAmount() {
        try {
            const val = localStorage.getItem(this.DIM_AMOUNT_KEY);
            if (val === null) return 1.0;
            return parseFloat(val);
        } catch {
            return 1.0;
        }
    },

    setDimAmount(value) {
        localStorage.setItem(this.DIM_AMOUNT_KEY, value);
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

    // Spin album cover and add hole in fullscreen
    isCdAlbumCoverEnabled() {
        try {
            return localStorage.getItem(this.CD_ALBUM_COVER_KEY) !== 'false';
        } catch {
            return true;
        }
    },

    setCdAlbumCoverEnabled(enabled) {
        localStorage.setItem(this.CD_ALBUM_COVER_KEY, enabled ? 'true' : 'false');
    },
};

export const equalizerSettings = {
    ENABLED_KEY: 'equalizer-enabled',
    GAINS_KEY: 'equalizer-gains',
    BAND_TYPES_KEY: 'equalizer-band-types',
    BAND_QS_KEY: 'equalizer-band-qs',
    BAND_CHANNELS_KEY: 'equalizer-band-channels',
    PRESET_KEY: 'equalizer-preset',
    CUSTOM_PRESETS_KEY: 'equalizer-custom-presets',
    BAND_COUNT_KEY: 'equalizer-band-count',
    RANGE_MIN_KEY: 'equalizer-range-min',
    RANGE_MAX_KEY: 'equalizer-range-max',
    FREQ_MIN_KEY: 'equalizer-freq-min',
    FREQ_MAX_KEY: 'equalizer-freq-max',
    PREAMP_KEY: 'equalizer-preamp',
    CUSTOM_FREQUENCIES_KEY: 'equalizer-custom-frequencies',
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
        const parsedCount = parseInt(count, 10);
        const validCount = Math.max(
            this.MIN_BANDS,
            Math.min(this.MAX_BANDS, isNaN(parsedCount) ? this.DEFAULT_BAND_COUNT : parsedCount)
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
                        return this.interpolateGains(gains, count);
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

    getCustomFrequencies(bandCount) {
        const count = bandCount || this.getBandCount();
        try {
            const stored = localStorage.getItem(this.CUSTOM_FREQUENCIES_KEY);
            if (stored) {
                const freqs = JSON.parse(stored);
                if (Array.isArray(freqs) && freqs.length === count) {
                    return freqs;
                }
            }
        } catch {
            /* ignore */
        }
        return null;
    },

    setCustomFrequencies(frequencies) {
        try {
            if (
                Array.isArray(frequencies) &&
                frequencies.length >= this.MIN_BANDS &&
                frequencies.length <= this.MAX_BANDS
            ) {
                localStorage.setItem(this.CUSTOM_FREQUENCIES_KEY, JSON.stringify(frequencies));
            }
        } catch (e) {
            console.warn('[EQ] Failed to save custom frequencies:', e);
        }
    },

    clearCustomFrequencies() {
        try {
            localStorage.removeItem(this.CUSTOM_FREQUENCIES_KEY);
        } catch {
            /* ignore */
        }
    },

    getBandTypes(bandCount) {
        const count = bandCount || this.getBandCount();
        try {
            const stored = localStorage.getItem(this.BAND_TYPES_KEY);
            if (stored) {
                const types = JSON.parse(stored);
                if (Array.isArray(types) && types.length === count) {
                    return types;
                }
            }
        } catch {
            /* ignore */
        }
        return new Array(count).fill('peaking');
    },

    setBandTypes(types) {
        try {
            if (Array.isArray(types) && types.length >= this.MIN_BANDS && types.length <= this.MAX_BANDS) {
                localStorage.setItem(this.BAND_TYPES_KEY, JSON.stringify(types));
            }
        } catch (e) {
            console.warn('[EQ] Failed to save band types:', e);
        }
    },

    getBandQs(bandCount) {
        const count = bandCount || this.getBandCount();
        try {
            const stored = localStorage.getItem(this.BAND_QS_KEY);
            if (stored) {
                const qs = JSON.parse(stored);
                if (Array.isArray(qs) && qs.length === count) {
                    return qs;
                }
                // Interpolate stored Qs to match requested band count instead of discarding
                if (Array.isArray(qs) && qs.length >= this.MIN_BANDS) {
                    return this.interpolateGains(qs, count);
                }
            }
        } catch {
            /* ignore */
        }
        return null;
    },

    setBandQs(qs) {
        try {
            if (Array.isArray(qs) && qs.length >= this.MIN_BANDS && qs.length <= this.MAX_BANDS) {
                localStorage.setItem(this.BAND_QS_KEY, JSON.stringify(qs));
            }
        } catch (e) {
            console.warn('[EQ] Failed to save band Qs:', e);
        }
    },

    getBandChannels(bandCount) {
        const count = bandCount || this.getBandCount();
        try {
            const stored = localStorage.getItem(this.BAND_CHANNELS_KEY);
            if (stored) {
                const channels = JSON.parse(stored);
                if (Array.isArray(channels) && channels.length === count) {
                    return channels;
                }
            }
        } catch {
            /* ignore */
        }
        return new Array(count).fill('stereo');
    },

    setBandChannels(channels) {
        try {
            if (Array.isArray(channels) && channels.length >= this.MIN_BANDS && channels.length <= this.MAX_BANDS) {
                localStorage.setItem(this.BAND_CHANNELS_KEY, JSON.stringify(channels));
            }
        } catch (e) {
            console.warn('[EQ] Failed to save band channels:', e);
        }
    },

    /**
     * Interpolate gains array to match target band count
     */
    interpolateGains(sourceGains, targetCount) {
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

    // ========================================
    // AutoEQ Profile Storage
    // ========================================
    AUTOEQ_PROFILES_KEY: 'autoeq-saved-profiles',
    AUTOEQ_ACTIVE_PROFILE_KEY: 'autoeq-active-profile',
    AUTOEQ_SAMPLE_RATE_KEY: 'autoeq-sample-rate',

    getAutoEQProfiles() {
        try {
            const stored = localStorage.getItem(this.AUTOEQ_PROFILES_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    },

    saveAutoEQProfile(profile) {
        try {
            const profiles = this.getAutoEQProfiles();
            const id = profile.id || 'autoeq_' + Date.now();
            const profileCopy = { ...profile, id };
            profiles[id] = profileCopy;
            localStorage.setItem(this.AUTOEQ_PROFILES_KEY, JSON.stringify(profiles));
            return id;
        } catch (e) {
            console.warn('[AutoEQ] Failed to save profile:', e);
            return false;
        }
    },

    deleteAutoEQProfile(profileId) {
        try {
            const profiles = this.getAutoEQProfiles();
            if (profiles[profileId]) {
                delete profiles[profileId];
                localStorage.setItem(this.AUTOEQ_PROFILES_KEY, JSON.stringify(profiles));
                if (this.getActiveAutoEQProfile() === profileId) {
                    localStorage.removeItem(this.AUTOEQ_ACTIVE_PROFILE_KEY);
                }
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[AutoEQ] Failed to delete profile:', e);
            return false;
        }
    },

    getActiveAutoEQProfile() {
        try {
            return localStorage.getItem(this.AUTOEQ_ACTIVE_PROFILE_KEY) || null;
        } catch {
            return null;
        }
    },

    setActiveAutoEQProfile(profileId) {
        if (profileId) {
            localStorage.setItem(this.AUTOEQ_ACTIVE_PROFILE_KEY, profileId);
        } else {
            localStorage.removeItem(this.AUTOEQ_ACTIVE_PROFILE_KEY);
        }
    },

    getSampleRate() {
        try {
            const stored = localStorage.getItem(this.AUTOEQ_SAMPLE_RATE_KEY);
            const val = parseInt(stored, 10);
            return [44100, 48000, 96000].includes(val) ? val : 48000;
        } catch {
            return 48000;
        }
    },

    setSampleRate(rate) {
        localStorage.setItem(this.AUTOEQ_SAMPLE_RATE_KEY, rate.toString());
    },

    // ========================================
    // Last Selected Headphone Persistence
    // ========================================
    AUTOEQ_LAST_HEADPHONE_KEY: 'autoeq-last-headphone',

    /**
     * Save the last selected headphone entry + its measurement data
     * so it persists across page reloads without re-fetching from GitHub
     * @param {object} entry - {name, type, path, fileName}
     * @param {Array} measurementData - [{freq, gain}, ...]
     */
    setLastHeadphone(entry, measurementData) {
        try {
            localStorage.setItem(
                this.AUTOEQ_LAST_HEADPHONE_KEY,
                JSON.stringify({
                    entry,
                    measurementData,
                    savedAt: Date.now(),
                })
            );
        } catch (e) {
            console.warn('[AutoEQ] Failed to save last headphone:', e);
        }
    },

    /**
     * Retrieve the last selected headphone entry + cached measurement data
     * @returns {{entry: object, measurementData: Array}|null}
     */
    getLastHeadphone() {
        try {
            const stored = localStorage.getItem(this.AUTOEQ_LAST_HEADPHONE_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            if (parsed && parsed.entry && parsed.measurementData) return parsed;
            return null;
        } catch {
            return null;
        }
    },

    clearLastHeadphone() {
        localStorage.removeItem(this.AUTOEQ_LAST_HEADPHONE_KEY);
    },

    // --- Graphic EQ separate storage ---
    GEQ_ENABLED_KEY: 'graphic-eq-enabled',
    GEQ_GAINS_KEY: 'graphic-eq-gains',
    GEQ_PREAMP_KEY: 'graphic-eq-preamp',
    GEQ_BAND_COUNT_KEY: 'graphic-eq-band-count',
    GEQ_FREQ_RANGE_KEY: 'graphic-eq-freq-range',

    isGraphicEqEnabled() {
        try {
            return localStorage.getItem(this.GEQ_ENABLED_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setGraphicEqEnabled(enabled) {
        try {
            localStorage.setItem(this.GEQ_ENABLED_KEY, String(!!enabled));
        } catch {
            /* ignore */
        }
    },

    getGraphicEqBandCount() {
        try {
            const val = localStorage.getItem(this.GEQ_BAND_COUNT_KEY);
            if (val !== null) {
                const num = parseInt(val, 10);
                if (num >= 3 && num <= 32) return num;
            }
        } catch {
            /* ignore */
        }
        return 16;
    },

    setGraphicEqBandCount(count) {
        const clamped = Math.max(3, Math.min(32, parseInt(count, 10) || 16));
        try {
            localStorage.setItem(this.GEQ_BAND_COUNT_KEY, String(clamped));
        } catch {
            /* ignore */
        }
    },

    getGraphicEqFreqRange() {
        try {
            const stored = localStorage.getItem(this.GEQ_FREQ_RANGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && Number.isFinite(parsed.min) && Number.isFinite(parsed.max)) {
                    return parsed;
                }
            }
        } catch {
            /* ignore */
        }
        return { min: 25, max: 20000 };
    },

    setGraphicEqFreqRange(min, max) {
        const clampedMin = Math.max(10, Math.min(96000, parseInt(min, 10) || 25));
        const clampedMax = Math.max(10, Math.min(96000, parseInt(max, 10) || 20000));
        if (clampedMin >= clampedMax) return;
        try {
            localStorage.setItem(this.GEQ_FREQ_RANGE_KEY, JSON.stringify({ min: clampedMin, max: clampedMax }));
        } catch {
            /* ignore */
        }
    },

    getGraphicEqGains(bandCount) {
        try {
            const stored = localStorage.getItem(this.GEQ_GAINS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                const expectedCount = bandCount || this.getGraphicEqBandCount();
                if (Array.isArray(parsed) && parsed.length === expectedCount) {
                    return parsed.map((v) => (Number.isFinite(v) ? v : 0));
                }
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return this.interpolateGains(parsed, expectedCount);
                }
            }
        } catch {
            /* ignore */
        }
        return new Array(bandCount || this.getGraphicEqBandCount()).fill(0);
    },

    setGraphicEqGains(gains) {
        if (!Array.isArray(gains)) return;
        const sanitized = gains.map((v) => (Number.isFinite(v) ? v : 0));
        try {
            localStorage.setItem(this.GEQ_GAINS_KEY, JSON.stringify(sanitized));
        } catch {
            /* ignore */
        }
    },

    getGraphicEqPreamp() {
        try {
            const val = localStorage.getItem(this.GEQ_PREAMP_KEY);
            if (val !== null) {
                const num = parseFloat(val);
                return Number.isFinite(num) ? num : 0;
            }
            return 0;
        } catch {
            return 0;
        }
    },

    setGraphicEqPreamp(db) {
        const clamped = Math.max(-20, Math.min(20, parseFloat(db) || 0));
        try {
            localStorage.setItem(this.GEQ_PREAMP_KEY, String(clamped));
        } catch {
            /* ignore */
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

export const binauralDspSettings = {
    STORAGE_KEY: 'binaural-dsp',

    _getAll() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
        } catch {
            return {};
        }
    },

    _setAll(obj) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(obj));
        } catch {
            // QuotaExceededError - storage full
        }
    },

    isEnabled() {
        return this._getAll().enabled === true;
    },

    setEnabled(enabled) {
        const all = this._getAll();
        all.enabled = !!enabled;
        this._setAll(all);
    },

    getCrossfeedEnabled() {
        const val = this._getAll().crossfeedEnabled;
        return val === undefined ? true : val;
    },

    setCrossfeedEnabled(enabled) {
        const all = this._getAll();
        all.crossfeedEnabled = !!enabled;
        this._setAll(all);
    },

    getCrossfeedLevel() {
        return this._getAll().crossfeedLevel || 'medium';
    },

    setCrossfeedLevel(level) {
        const all = this._getAll();
        all.crossfeedLevel = level;
        this._setAll(all);
    },

    getHrtfPreset() {
        return this._getAll().hrtfPreset || 'studio';
    },

    setHrtfPreset(preset) {
        const all = this._getAll();
        all.hrtfPreset = preset;
        this._setAll(all);
    },

    getWideningEnabled() {
        const val = this._getAll().wideningEnabled;
        return val === undefined ? true : val;
    },

    setWideningEnabled(enabled) {
        const all = this._getAll();
        all.wideningEnabled = !!enabled;
        this._setAll(all);
    },

    getWideningAmount() {
        const val = this._getAll().wideningAmount;
        return val === undefined ? 1.0 : val;
    },

    setWideningAmount(amount) {
        const all = this._getAll();
        const n = Number(amount);
        all.wideningAmount = Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 1.0;
        this._setAll(all);
    },

    getAutoEnableForSpatial() {
        const val = this._getAll().autoEnableForSpatial;
        return val === undefined ? true : val;
    },

    setAutoEnableForSpatial(enabled) {
        const all = this._getAll();
        all.autoEnableForSpatial = !!enabled;
        this._setAll(all);
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
    PITCH_PRESERVE_KEY: 'audio-effects-pitch-preserve',

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
        const parsed = parseFloat(speed);
        const validSpeed = Math.max(0.01, Math.min(100, isNaN(parsed) ? 1.0 : parsed));
        localStorage.setItem(this.SPEED_KEY, validSpeed.toString());
    },

    resetSpeed() {
        this.setSpeed(1.0);
        return 1.0;
    },

    // Preserve pitch when changing speed (default true)
    isPreservePitchEnabled() {
        try {
            const val = localStorage.getItem(this.PITCH_PRESERVE_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setPreservePitch(enabled) {
        localStorage.setItem(this.PITCH_PRESERVE_KEY, enabled ? 'true' : 'false');
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
                toggleBtn.innerHTML = SVG_RIGHT_ARROW(20);
            }
        }
    },
};

export const listenBrainzSettings = {
    ENABLED_KEY: 'listenbrainz-enabled',
    TOKEN_KEY: 'listenbrainz-token',
    CUSTOM_URL_KEY: 'listenbrainz-custom-url',
    LOVE_ON_LIKE_KEY: 'listenbrainz-love-on-like',

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

    EDITORS_PICKS_SOURCE_KEY: 'home-editors-picks-source',

    getEditorsPicksSource() {
        try {
            return localStorage.getItem(this.EDITORS_PICKS_SOURCE_KEY) || 'current';
        } catch {
            return 'current';
        }
    },

    setEditorsPicksSource(source) {
        localStorage.setItem(this.EDITORS_PICKS_SOURCE_KEY, source);
    },
};

export const radioSettings = {
    ENABLED_KEY: 'radio-enabled',

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
};

export const autoplaySettings = {
    ENABLED_KEY: 'autoplay-enabled',
    SMART_RECS_KEY: 'smart-recommendations-enabled',

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

    isSmartRecsEnabled() {
        try {
            const val = localStorage.getItem(this.SMART_RECS_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setSmartRecsEnabled(enabled) {
        localStorage.setItem(this.SMART_RECS_KEY, enabled ? 'true' : 'false');
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
    SHOW_ABOUT_KEY: 'sidebar-show-about',
    SHOW_DISCORD_KEY: 'sidebar-show-discord',
    SHOW_GITHUB_KEY: 'sidebar-show-github',
    SHOW_PARTY_KEY: 'sidebar-show-party',
    ORDER_KEY: 'sidebar-menu-order',
    DEFAULT_ORDER: [
        'sidebar-nav-home',
        'sidebar-nav-library',
        'sidebar-nav-recent',
        'sidebar-nav-unreleased',
        'sidebar-nav-donate',
        'sidebar-nav-settings',
        'sidebar-nav-about-bottom',
        'sidebar-nav-discordbtn',
        'sidebar-nav-party',
        'sidebar-nav-githubbtn',
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

    shouldShowGithub() {
        try {
            const val = localStorage.getItem(this.SHOW_GITHUB_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowGithub(enabled) {
        localStorage.setItem(this.SHOW_GITHUB_KEY, enabled ? 'true' : 'false');
    },

    shouldShowParty() {
        try {
            const val = localStorage.getItem(this.SHOW_PARTY_KEY);
            return val === null ? true : val === 'true';
        } catch {
            return true;
        }
    },

    setShowParty(enabled) {
        localStorage.setItem(this.SHOW_PARTY_KEY, enabled ? 'true' : 'false');
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
            { id: 'sidebar-nav-about-bottom', check: this.shouldShowAbout() },
            { id: 'sidebar-nav-discordbtn', check: this.shouldShowDiscord() },
            { id: 'sidebar-nav-party', check: this.shouldShowParty() },
            { id: 'sidebar-nav-githubbtn', check: this.shouldShowGithub() },
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
    NOTO_FALLBACK:
        "'Noto Sans', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans HK', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans Hebrew', 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Thai', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Gujarati', 'Noto Sans Kannada', 'Noto Sans Malayalam', 'Noto Sans Sinhala', 'Noto Sans Khmer', 'Noto Sans Lao', 'Noto Sans Myanmar', 'Noto Sans Georgian', 'Noto Sans Armenian', 'Noto Sans Ethiopic', system-ui, sans-serif",

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
        const parsed = parseInt(size, 10);
        const validSize = Math.max(50, Math.min(200, isNaN(parsed) ? 100 : parsed));
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

        document.documentElement.style.setProperty('--font-family', `'${familyName}', ${this.NOTO_FALLBACK}`);
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

        document.documentElement.style.setProperty('--font-family', `'${fontFamily}', ${this.NOTO_FALLBACK}`);
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

        document.documentElement.style.setProperty('--font-family', `'${fontFamily}', ${this.NOTO_FALLBACK}`);
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

        const fontValue = family === 'monospace' ? 'monospace' : `'${family}', ${this.NOTO_FALLBACK}`;
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

        document.documentElement.style.setProperty('--font-family', `'SF Pro Display', ${this.NOTO_FALLBACK}`);
    },

    async applyFont() {
        const config = this.getConfig();

        switch (config.type) {
            case 'google':
                await this.loadGoogleFont(config.family);
                break;
            case 'url':
                await this.loadFontFromUrl(config.url, config.family);
                break;
            case 'uploaded':
                await this.loadUploadedFont(config.fontId);
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

export const devModeSettings = {
    STORAGE_KEY: 'dev-mode-enabled',
    URL_KEY: 'dev-mode-url',

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

    getUrl() {
        try {
            return localStorage.getItem(this.URL_KEY) || 'http://127.0.0.1:8000';
        } catch {
            return 'http://127.0.0.1:8000';
        }
    },

    setUrl(url) {
        localStorage.setItem(this.URL_KEY, url);
    },
};

export const serverDisruptionSettings = {
    STORAGE_KEY: 'server-disruption-dismissed',

    isDismissed() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    dismiss() {
        localStorage.setItem(this.STORAGE_KEY, 'true');
    },

    reset() {
        localStorage.removeItem(this.STORAGE_KEY);
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
        return this.getBlockedArtists().some((a) => String(a.id) === String(artistId));
    },

    blockArtist(artist) {
        if (!artist || !artist.id) return;
        const blocked = this.getBlockedArtists();
        if (!blocked.some((a) => String(a.id) === String(artist.id))) {
            blocked.push({
                id: artist.id,
                name: artist.name || 'Unknown Artist',
                blockedAt: Date.now(),
            });
            this.setBlockedArtists(blocked);
        }
    },

    unblockArtist(artistId) {
        const blocked = this.getBlockedArtists().filter((a) => String(a.id) !== String(artistId));
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
        return this.getBlockedTracks().some((t) => String(t.id) === String(trackId));
    },

    blockTrack(track) {
        if (!track || !track.id) return;
        const blocked = this.getBlockedTracks();
        if (!blocked.some((t) => String(t.id) === String(track.id))) {
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
        const blocked = this.getBlockedTracks().filter((t) => String(t.id) !== String(trackId));
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
        return this.getBlockedAlbums().some((a) => String(a.id) === String(albumId));
    },

    blockAlbum(album) {
        if (!album || !album.id) return;
        const blocked = this.getBlockedAlbums();
        if (!blocked.some((a) => String(a.id) === String(album.id))) {
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
        const blocked = this.getBlockedAlbums().filter((a) => String(a.id) !== String(albumId));
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

export const keyboardShortcuts = {
    STORAGE_KEY: 'keyboard-shortcuts',

    DEFAULT_SHORTCUTS: {
        playPause: { key: ' ', shift: false, ctrl: false, alt: false, description: 'Play / Pause' },
        seekForward: { key: 'arrowright', shift: false, ctrl: false, alt: false, description: 'Seek forward 10s' },
        seekBackward: { key: 'arrowleft', shift: false, ctrl: false, alt: false, description: 'Seek backward 10s' },
        nextTrack: { key: 'arrowright', shift: true, ctrl: false, alt: false, description: 'Next track' },
        previousTrack: { key: 'arrowleft', shift: true, ctrl: false, alt: false, description: 'Previous track' },
        volumeUp: { key: 'arrowup', shift: false, ctrl: false, alt: false, description: 'Volume up' },
        volumeDown: { key: 'arrowdown', shift: false, ctrl: false, alt: false, description: 'Volume down' },
        mute: { key: 'm', shift: false, ctrl: false, alt: false, description: 'Mute / Unmute' },
        shuffle: { key: 's', shift: false, ctrl: false, alt: false, description: 'Toggle shuffle' },
        repeat: { key: 'r', shift: false, ctrl: false, alt: false, description: 'Toggle repeat' },
        queue: { key: 'q', shift: false, ctrl: false, alt: false, description: 'Open queue' },
        lyrics: { key: 'l', shift: false, ctrl: false, alt: false, description: 'Toggle lyrics' },
        search: { key: '/', shift: false, ctrl: false, alt: false, description: 'Focus search' },
        escape: { key: 'escape', shift: false, ctrl: false, alt: false, description: 'Close modals' },
        visualizerNext: { key: ']', shift: false, ctrl: false, alt: false, description: 'Next visualizer preset' },
        visualizerPrev: { key: '[', shift: false, ctrl: false, alt: false, description: 'Previous visualizer preset' },
        visualizerCycle: {
            key: '\\',
            shift: false,
            ctrl: false,
            alt: false,
            description: 'Toggle visualizer auto-cycle',
        },
        multiSelectToggle: {
            key: 'control',
            shift: false,
            ctrl: true,
            alt: false,
            description: 'Toggle track selection (individual)',
        },
        multiSelectRange: { key: 'shift', shift: true, ctrl: false, alt: false, description: 'Select track range' },
    },

    getShortcuts() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('Failed to load keyboard shortcuts:', e);
        }
        return this.getDefaultShortcuts();
    },

    getDefaultShortcuts() {
        return { ...this.DEFAULT_SHORTCUTS };
    },

    setShortcut(action, shortcut) {
        const shortcuts = this.getShortcuts();
        const defaults = this.DEFAULT_SHORTCUTS;
        shortcuts[action] = {
            ...(defaults[action] || {}),
            ...shortcut,
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(shortcuts));
    },

    resetShortcuts() {
        localStorage.removeItem(this.STORAGE_KEY);
    },

    getShortcutForAction(action) {
        const shortcuts = this.getShortcuts();
        return shortcuts[action] || this.DEFAULT_SHORTCUTS[action];
    },
};
