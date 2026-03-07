import { hooks } from './hook-system.js';

export function createPluginAPI(pluginId, coreRefs) {
    const { player, api, db, sidePanelManager, router } = coreRefs;

    // Track resources for cleanup
    const injectedStyles = [];
    const contextMenuItems = [];
    let settingsRenderer = null;

    const pluginAPI = {
        // --- Hooks API ---
        hooks: {
            on(hookName, callback, priority = 10) {
                hooks.addAction(hookName, callback, priority, pluginId);
            },
            off(hookName, callback) {
                hooks.removeAction(hookName, callback);
            },
            filter(hookName, callback, priority = 10) {
                hooks.addFilter(hookName, callback, priority, pluginId);
            },
            removeFilter(hookName, callback) {
                hooks.removeFilter(hookName, callback);
            },
        },

        // --- Player API ---
        player: {
            play() {
                player.handlePlayPause();
            },
            pause() {
                player.audio.pause();
            },
            playNext() {
                player.playNext();
            },
            playPrev() {
                player.playPrev();
            },
            seek(time) {
                player.audio.currentTime = Math.max(0, time);
            },
            setVolume(value) {
                player.setVolume(value);
            },
            getVolume() {
                return player.userVolume;
            },
            getCurrentTrack() {
                return player.currentTrack ? structuredClone(player.currentTrack) : null;
            },
            getQueue() {
                return structuredClone(player.getCurrentQueue());
            },
            setQueue(tracks, startIndex = 0) {
                player.setQueue(tracks, startIndex);
            },
            addToQueue(trackOrTracks) {
                player.addToQueue(trackOrTracks);
            },
            isPlaying() {
                return !player.audio.paused;
            },
            getDuration() {
                return player.audio.duration || 0;
            },
            getCurrentTime() {
                return player.audio.currentTime || 0;
            },
            getAudioElement() {
                return player.audio;
            },
        },

        // --- Music API ---
        music: {
            async searchTracks(query, options) {
                return api.searchTracks(query, options);
            },
            async getTrack(id, quality) {
                return api.getTrack(id, quality);
            },
            async getAlbum(id) {
                return api.getAlbum(id);
            },
            async getArtist(id) {
                return api.getArtist(id);
            },
            async getStreamUrl(id, quality) {
                return api.getStreamUrl(id, quality);
            },
            getCoverUrl(id, size) {
                return api.getCoverUrl(id, size);
            },
        },

        // --- Library API ---
        library: {
            async getFavorites(type) {
                return db.getFavorites(type);
            },
            async addFavorite(type, item) {
                return db.toggleFavorite(type, item);
            },
            async removeFavorite(type, item) {
                return db.toggleFavorite(type, item);
            },
            async getHistory() {
                return db.getHistory();
            },
            async getPlaylists() {
                return db.getPlaylists();
            },
        },

        // --- UI API ---
        ui: {
            notify(msg) {
                // Use the app's notification system
                import('../downloads.js').then(({ showNotification }) => {
                    showNotification(msg);
                });
            },
            openSidePanel(view, title, controlsCb, contentCb) {
                sidePanelManager.open(view, title, controlsCb, contentCb);
            },
            closeSidePanel() {
                sidePanelManager.close();
            },
            addContextMenuItem({ label, action, handler, typeFilter }) {
                const item = { label, action: `plugin:${pluginId}:${action}`, handler, typeFilter, pluginId };
                contextMenuItems.push(item);
                return () => {
                    const idx = contextMenuItems.indexOf(item);
                    if (idx !== -1) contextMenuItems.splice(idx, 1);
                };
            },
            registerSettings(renderFn) {
                settingsRenderer = renderFn;
            },
            navigate(path) {
                router.navigate(path);
            },
            injectCSS(css) {
                const style = document.createElement('style');
                style.dataset.pluginId = pluginId;
                style.textContent = css;
                document.head.appendChild(style);
                injectedStyles.push(style);
                return () => {
                    style.remove();
                    const idx = injectedStyles.indexOf(style);
                    if (idx !== -1) injectedStyles.splice(idx, 1);
                };
            },
        },

        // --- Theme API ---
        theme: {
            setVariables(vars) {
                const root = document.documentElement;
                const originals = {};
                for (const [key, value] of Object.entries(vars)) {
                    const prop = key.startsWith('--') ? key : `--${key}`;
                    originals[prop] = root.style.getPropertyValue(prop);
                    root.style.setProperty(prop, value);
                }
                return () => {
                    for (const [prop, original] of Object.entries(originals)) {
                        if (original) {
                            root.style.setProperty(prop, original);
                        } else {
                            root.style.removeProperty(prop);
                        }
                    }
                };
            },
            injectCSS(css) {
                return pluginAPI.ui.injectCSS(css);
            },
        },

        // --- Storage API ---
        storage: {
            get(key, defaultValue = null) {
                const val = localStorage.getItem(`plugin:${pluginId}:${key}`);
                if (val === null) return defaultValue;
                try {
                    return JSON.parse(val);
                } catch {
                    return val;
                }
            },
            set(key, value) {
                localStorage.setItem(`plugin:${pluginId}:${key}`, JSON.stringify(value));
            },
            remove(key) {
                localStorage.removeItem(`plugin:${pluginId}:${key}`);
            },
            keys() {
                const prefix = `plugin:${pluginId}:`;
                const result = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k.startsWith(prefix)) {
                        result.push(k.slice(prefix.length));
                    }
                }
                return result;
            },
            clear() {
                const prefix = `plugin:${pluginId}:`;
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k.startsWith(prefix)) keysToRemove.push(k);
                }
                keysToRemove.forEach((k) => localStorage.removeItem(k));
            },
        },

    };

    // Internal methods for plugin manager
    pluginAPI._getContextMenuItems = () => contextMenuItems;
    pluginAPI._getSettingsRenderer = () => settingsRenderer;
    pluginAPI._cleanup = () => {
        injectedStyles.forEach((style) => style.remove());
        injectedStyles.length = 0;
        contextMenuItems.length = 0;
        settingsRenderer = null;
        hooks.removeAllForPlugin(pluginId);
    };

    return pluginAPI;
}
