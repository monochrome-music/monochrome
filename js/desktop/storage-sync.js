// js/desktop/storage-sync.js
// Transparent localStorage persistence for Neutralino (WKWebView doesn't persist localStorage for HTTP origins)
// Syncs localStorage to ~/.monochrome/localStorage.json via the shell bridge.

const isNeutralino =
    typeof window !== 'undefined' &&
    (window.NL_MODE || window.location.search.includes('mode=neutralino') || window.parent !== window);

let saveTimer = null;
let initialized = false;

// Send a request to the shell and wait for a response
function shellRequest(type, extraData = {}) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        const handler = (event) => {
            if (event.data?.type === 'NL_RESPONSE' && event.data.id === id) {
                window.removeEventListener('message', handler);
                if (event.data.error) reject(event.data.error);
                else resolve(event.data.result);
            }
        };
        window.addEventListener('message', handler);
        window.parent.postMessage({ type, id, ...extraData }, '*');
    });
}

// Gather all localStorage into a JSON string
function serializeLocalStorage() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data[key] = localStorage.getItem(key);
    }
    return JSON.stringify(data);
}

// Save localStorage to disk (debounced)
function scheduleSave() {
    if (!initialized || !isNeutralino) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            const json = serializeLocalStorage();
            await shellRequest('NL_STORAGE_SAVE', { data: json });
            console.log('[StorageSync] Saved to disk.');
        } catch (e) {
            console.error('[StorageSync] Save failed:', e);
        }
    }, 500); // Debounce 500ms
}

// Hook localStorage.setItem and removeItem to detect changes
function hookLocalStorage() {
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;

    Storage.prototype.setItem = function (key, value) {
        originalSetItem.call(this, key, value);
        if (this === localStorage) scheduleSave();
    };

    Storage.prototype.removeItem = function (key) {
        originalRemoveItem.call(this, key);
        if (this === localStorage) scheduleSave();
    };

    Storage.prototype.clear = function () {
        originalClear.call(this);
        if (this === localStorage) scheduleSave();
    };
}

// Load stored data from disk into localStorage
export async function initStorageSync() {
    if (!isNeutralino) return;

    try {
        const json = await shellRequest('NL_STORAGE_LOAD');
        const data = JSON.parse(json);
        let count = 0;
        for (const [key, value] of Object.entries(data)) {
            // Only restore if not already present (don't overwrite runtime values)
            if (localStorage.getItem(key) === null) {
                localStorage.setItem(key, value);
                count++;
            }
        }
        console.log(`[StorageSync] Restored ${count} keys from disk.`);
    } catch (e) {
        console.error('[StorageSync] Load failed:', e);
    }

    // Now hook localStorage to capture future changes
    hookLocalStorage();
    initialized = true;
    console.log('[StorageSync] Initialized — localStorage changes will be persisted to disk.');
}
