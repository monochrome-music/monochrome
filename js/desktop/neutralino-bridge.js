// js/desktop/neutralino-bridge.js

const isNeutralino =
    typeof window !== 'undefined' &&
    (window.NL_MODE || window.location.search.includes('mode=neutralino') || window.parent !== window);

const listeners = new Map();

// Listen for events from the Shell (Parent)
if (isNeutralino) {
    window.addEventListener('message', (event) => {
        if (event.data?.type === 'NL_EVENT') {
            const { eventName, detail } = event.data;
            if (listeners.has(eventName)) {
                listeners.get(eventName).forEach((handler) => {
                    try {
                        handler(detail);
                    } catch (e) {
                        console.error('[Bridge] Error in event handler:', e);
                    }
                });
            }
        }
    });
}

export const init = async () => {
    if (!isNeutralino) return;
    // Notify Shell we are ready
    window.parent.postMessage({ type: 'NL_INIT' }, '*');
};

export const events = {
    on: (eventName, handler) => {
        if (!isNeutralino) return;
        if (!listeners.has(eventName)) {
            listeners.set(eventName, []);
        }
        listeners.get(eventName).push(handler);
    },
    off: (eventName, handler) => {
        if (!isNeutralino) return;
        if (!listeners.has(eventName)) return;
        const handlers = listeners.get(eventName);
        const index = handlers.indexOf(handler);
        if (index > -1) handlers.splice(index, 1);
    },
    broadcast: async (eventName, data) => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_BROADCAST', eventName, data }, '*');
    },
};

export const extensions = {
    dispatch: async (extensionId, eventName, data) => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_EXTENSION', extensionId, eventName, data }, '*');
    },
};

export const app = {
    exit: async () => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_APP_EXIT' }, '*');
    },
};

export const os = {
    open: async (url) => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_OS_OPEN', url }, '*');
    },
    showSaveDialog: async (title, options) => {
        if (!isNeutralino) return;
        return new Promise((resolve) => {
            const id = Math.random().toString(36).substring(7);
            const handler = (event) => {
                if (event.data?.type === 'NL_RESPONSE' && event.data.id === id) {
                    window.removeEventListener('message', handler);
                    resolve(event.data.result);
                }
            };
            window.addEventListener('message', handler);
            window.parent.postMessage({ type: 'NL_OS_SHOW_SAVE_DIALOG', id, title, options }, '*');
        });
    },
    showFolderDialog: async (title, options) => {
        if (!isNeutralino) return;
        return new Promise((resolve) => {
            const id = Math.random().toString(36).substring(7);
            const handler = (event) => {
                if (event.data?.type === 'NL_RESPONSE' && event.data.id === id) {
                    window.removeEventListener('message', handler);
                    resolve(event.data.result);
                }
            };
            window.addEventListener('message', handler);
            window.parent.postMessage({ type: 'NL_OS_SHOW_FOLDER_DIALOG', id, title, options }, '*');
        });
    },
};

export const filesystem = {
    readBinaryFile: async (path) => {
        if (!isNeutralino) return;
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
            window.parent.postMessage({ type: 'NL_FS_READ_BINARY', id, path }, '*');
        });
    },
    readDirectory: async (path) => {
        if (!isNeutralino) return;
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
            window.parent.postMessage({ type: 'NL_FS_READ_DIR', id, path }, '*');
        });
    },
    getStats: async (path) => {
        if (!isNeutralino) return;
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
            window.parent.postMessage({ type: 'NL_FS_STATS', id, path }, '*');
        });
    },
    writeBinaryFile: async (path, buffer) => {
        if (!isNeutralino) return;
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
            window.parent.postMessage({ type: 'NL_FS_WRITE_BINARY', id, path, buffer }, '*', [buffer]);
        });
    },
    appendBinaryFile: async (path, buffer) => {
        if (!isNeutralino) return;
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
            // Transfer buffer if possible to save memory
            window.parent.postMessage({ type: 'NL_FS_APPEND_BINARY', id, path, buffer }, '*', [buffer]);
        });
    },
};

export const _window = {
    minimize: async () => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_WINDOW_MIN' }, '*');
    },
    maximize: async () => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_WINDOW_MAX' }, '*');
    },
    show: async () => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_WINDOW_SHOW' }, '*');
    },
    hide: async () => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_WINDOW_HIDE' }, '*');
    },
    isVisible: async () => {
        return true; // Mock response
    },
    setTitle: async (title) => {
        if (!isNeutralino) return;
        window.parent.postMessage({ type: 'NL_WINDOW_SET_TITLE', title }, '*');
    },
};

// Expose generically for other modules
export { _window as window };
export default {
    init,
    events,
    extensions,
    app,
    os,
    filesystem,
    window: _window,
};
