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

    async getInstances(type = 'api', sortBySpeed = false) {
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
            return localStorage.getItem(this.CUSTOM_API_KEY) || '';
        } catch {
            return '';
        }
    },

    setCustomApiKey(key) {
        localStorage.setItem(this.CUSTOM_API_KEY, key);
    },

    getCustomApiSecret() {
        try {
            return localStorage.getItem(this.CUSTOM_API_SECRET) || '';
        } catch {
            return '';
        }
    },

    setCustomApiSecret(secret) {
        localStorage.setItem(this.CUSTOM_API_SECRET, secret);
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
    PITCH_KEY: 'audio-effects-pitch',
    PRESERVE_PITCH_KEY: 'audio-effects-preserve-pitch',

    // Playback speed (0.5 to 2.0, default 1.0)
    getSpeed() {
        try {
            const val = parseFloat(localStorage.getItem(this.SPEED_KEY));
            return isNaN(val) ? 1.0 : Math.max(0.5, Math.min(2.0, val));
        } catch {
            return 1.0;
        }
    },

    setSpeed(speed) {
        const validSpeed = Math.max(0.5, Math.min(2.0, parseFloat(speed) || 1.0));
        localStorage.setItem(this.SPEED_KEY, validSpeed.toString());
    },

    // Pitch shift (-12 to +12 semitones, default 0)
    getPitch() {
        try {
            const val = parseInt(localStorage.getItem(this.PITCH_KEY), 10);
            return isNaN(val) ? 0 : Math.max(-12, Math.min(12, val));
        } catch {
            return 0;
        }
    },

    setPitch(pitch) {
        const validPitch = Math.max(-12, Math.min(12, parseInt(pitch, 10) || 0));
        localStorage.setItem(this.PITCH_KEY, validPitch.toString());
    },

    // Preserve pitch when changing speed (default true)
    getPreservePitch() {
        try {
            return localStorage.getItem(this.PRESERVE_PITCH_KEY) !== 'false';
        } catch {
            return true;
        }
    },

    setPreservePitch(enabled) {
        localStorage.setItem(this.PRESERVE_PITCH_KEY, enabled ? 'true' : 'false');
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
            document.documentElement.setAttribute('data-theme', e.matches ? 'monochrome' : 'white');
        }
    });
}

export const fontSettings = {
    STORAGE_KEY: 'monochrome-font-config-v2',
    CUSTOM_FONTS_KEY: 'monochrome-custom-fonts',
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
        const encodedFamily = familyName.replace(/\s+/g, '+');
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
                this.loadPresetFont(config.family, config.fallback);
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
