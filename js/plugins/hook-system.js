class HookSystem {
    constructor() {
        this._actions = new Map();
        this._filters = new Map();
    }

    // --- Actions (notifications) ---

    addAction(hookName, callback, priority = 10, pluginId = null) {
        if (!this._actions.has(hookName)) {
            this._actions.set(hookName, []);
        }
        this._actions.get(hookName).push({ callback, priority, pluginId });
        this._actions.get(hookName).sort((a, b) => a.priority - b.priority);
    }

    doAction(hookName, ...args) {
        const handlers = this._actions.get(hookName);
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                handler.callback(...args);
            } catch (err) {
                console.error(`[HookSystem] Error in action "${hookName}" (plugin: ${handler.pluginId}):`, err);
            }
        }
    }

    removeAction(hookName, callback) {
        const handlers = this._actions.get(hookName);
        if (!handlers) return;
        const idx = handlers.findIndex((h) => h.callback === callback);
        if (idx !== -1) handlers.splice(idx, 1);
    }

    removeAllActionsForPlugin(pluginId) {
        for (const [hookName, handlers] of this._actions) {
            this._actions.set(
                hookName,
                handlers.filter((h) => h.pluginId !== pluginId)
            );
        }
    }

    // --- Filters (pipeline transformatif) ---

    addFilter(hookName, callback, priority = 10, pluginId = null) {
        if (!this._filters.has(hookName)) {
            this._filters.set(hookName, []);
        }
        this._filters.get(hookName).push({ callback, priority, pluginId });
        this._filters.get(hookName).sort((a, b) => a.priority - b.priority);
    }

    applyFilters(hookName, value, ...extraArgs) {
        const handlers = this._filters.get(hookName);
        if (!handlers) return value;
        let result = value;
        for (const handler of handlers) {
            try {
                result = handler.callback(result, ...extraArgs);
            } catch (err) {
                console.error(`[HookSystem] Error in filter "${hookName}" (plugin: ${handler.pluginId}):`, err);
                // On error, value passes through unchanged
            }
        }
        return result;
    }

    removeFilter(hookName, callback) {
        const handlers = this._filters.get(hookName);
        if (!handlers) return;
        const idx = handlers.findIndex((h) => h.callback === callback);
        if (idx !== -1) handlers.splice(idx, 1);
    }

    removeAllFiltersForPlugin(pluginId) {
        for (const [hookName, handlers] of this._filters) {
            this._filters.set(
                hookName,
                handlers.filter((h) => h.pluginId !== pluginId)
            );
        }
    }

    // --- Cleanup ---

    removeAllForPlugin(pluginId) {
        this.removeAllActionsForPlugin(pluginId);
        this.removeAllFiltersForPlugin(pluginId);
    }
}

export const hooks = new HookSystem();
