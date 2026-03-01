import { hooks } from './hook-system.js';
import { createPluginAPI } from './plugin-api.js';

const PLUGINS_STATE_KEY = 'monochrome-plugins';
const PLUGINS_URLS_KEY = 'monochrome-plugin-urls';

export class PluginManager {
    constructor(coreRefs) {
        this._coreRefs = coreRefs;
        this._plugins = new Map(); // id -> { manifest, api, state, cleanups }
        this._onChangeCallbacks = [];
    }

    onChange(callback) {
        this._onChangeCallbacks.push(callback);
        return () => {
            const idx = this._onChangeCallbacks.indexOf(callback);
            if (idx !== -1) this._onChangeCallbacks.splice(idx, 1);
        };
    }

    _notifyChange() {
        for (const cb of this._onChangeCallbacks) {
            try {
                cb();
            } catch (err) {
                console.error('[PluginManager] onChange callback error:', err);
            }
        }
    }

    register(manifest) {
        if (!manifest || !manifest.id) {
            console.error('[PluginManager] Invalid manifest: missing id');
            return false;
        }

        if (this._plugins.has(manifest.id)) {
            console.warn(`[PluginManager] Plugin "${manifest.id}" already registered`);
            return false;
        }

        const api = createPluginAPI(manifest.id, this._coreRefs);

        this._plugins.set(manifest.id, {
            manifest,
            api,
            state: 'registered',
            cleanups: [],
        });

        this._notifyChange();
        return true;
    }

    async loadFromUrl(url) {
        try {
            const module = await import(/* @vite-ignore */ url);
            const manifest = module.default || module;

            if (!manifest || !manifest.id) {
                console.error(`[PluginManager] Module at ${url} has no valid manifest`);
                return null;
            }

            if (!this.register(manifest)) {
                return null;
            }

            // Save the URL for persistence
            const urls = this._getSavedUrls();
            if (!urls.includes(url)) {
                urls.push(url);
                localStorage.setItem(PLUGINS_URLS_KEY, JSON.stringify(urls));
            }

            // Mark source URL on the plugin entry
            const plugin = this._plugins.get(manifest.id);
            if (plugin) plugin._sourceUrl = url;

            return manifest.id;
        } catch (err) {
            console.error(`[PluginManager] Failed to load plugin from ${url}:`, err);
            return null;
        }
    }

    enable(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) {
            console.error(`[PluginManager] Plugin "${pluginId}" not found`);
            return false;
        }

        if (plugin.state === 'enabled') return true;

        try {
            if (typeof plugin.manifest.init === 'function') {
                const cleanups = plugin.manifest.init(plugin.api);
                if (Array.isArray(cleanups)) {
                    plugin.cleanups = cleanups;
                }
            }
            plugin.state = 'enabled';
            this._saveState();
            this._notifyChange();
            return true;
        } catch (err) {
            console.error(`[PluginManager] Error enabling plugin "${pluginId}":`, err);
            return false;
        }
    }

    disable(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) return false;
        if (plugin.state !== 'enabled') return true;

        try {
            if (typeof plugin.manifest.destroy === 'function') {
                plugin.manifest.destroy(plugin.api);
            }
        } catch (err) {
            console.error(`[PluginManager] Error in destroy for plugin "${pluginId}":`, err);
        }

        // Execute cleanups
        for (const cleanup of plugin.cleanups) {
            try {
                if (typeof cleanup === 'function') cleanup();
            } catch (err) {
                console.error(`[PluginManager] Cleanup error for plugin "${pluginId}":`, err);
            }
        }
        plugin.cleanups = [];

        // Full cleanup via API internals
        plugin.api._cleanup();

        plugin.state = 'disabled';
        this._saveState();
        this._notifyChange();
        return true;
    }

    uninstall(pluginId) {
        this.disable(pluginId);

        const plugin = this._plugins.get(pluginId);
        if (!plugin) return false;

        // Clear plugin storage namespace
        plugin.api.storage.clear();

        // Remove source URL
        if (plugin._sourceUrl) {
            const urls = this._getSavedUrls().filter((u) => u !== plugin._sourceUrl);
            localStorage.setItem(PLUGINS_URLS_KEY, JSON.stringify(urls));
        }

        this._plugins.delete(pluginId);
        this._saveState();
        this._notifyChange();
        return true;
    }

    async boot() {
        const urls = this._getSavedUrls();
        const enabledIds = this._getSavedState();

        // Load all saved plugin URLs
        for (const url of urls) {
            await this.loadFromUrl(url);
        }

        // Enable previously enabled plugins
        for (const id of enabledIds) {
            if (this._plugins.has(id)) {
                this.enable(id);
            }
        }

        hooks.doAction('app:ready');
    }

    getAll() {
        const result = [];
        for (const [id, plugin] of this._plugins) {
            result.push({
                id,
                name: plugin.manifest.name || id,
                version: plugin.manifest.version || '0.0.0',
                description: plugin.manifest.description || '',
                author: plugin.manifest.author || '',
                state: plugin.state,
            });
        }
        return result;
    }

    getPlugin(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) return null;
        return {
            id: pluginId,
            name: plugin.manifest.name || pluginId,
            version: plugin.manifest.version || '0.0.0',
            description: plugin.manifest.description || '',
            author: plugin.manifest.author || '',
            state: plugin.state,
        };
    }

    getPluginSettingsRenderer(pluginId) {
        const plugin = this._plugins.get(pluginId);
        if (!plugin) return null;
        return plugin.api._getSettingsRenderer();
    }

    getContextMenuItems() {
        const items = [];
        for (const [, plugin] of this._plugins) {
            if (plugin.state === 'enabled') {
                items.push(...plugin.api._getContextMenuItems());
            }
        }
        return items;
    }

    // --- Persistence ---

    _getSavedUrls() {
        try {
            return JSON.parse(localStorage.getItem(PLUGINS_URLS_KEY) || '[]');
        } catch {
            return [];
        }
    }

    _getSavedState() {
        try {
            return JSON.parse(localStorage.getItem(PLUGINS_STATE_KEY) || '[]');
        } catch {
            return [];
        }
    }

    _saveState() {
        const enabledIds = [];
        for (const [id, plugin] of this._plugins) {
            if (plugin.state === 'enabled') {
                enabledIds.push(id);
            }
        }
        localStorage.setItem(PLUGINS_STATE_KEY, JSON.stringify(enabledIds));
    }
}
