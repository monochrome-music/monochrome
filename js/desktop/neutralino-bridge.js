// js/desktop/neutralino-bridge.js

import { isNeutralinoDesktop } from '../utils.js';

const isNeutralino = isNeutralinoDesktop();
const REQUEST_TIMEOUT_MS = 30000;

const listeners = new Map();

function toError(value, fallbackMessage) {
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    if (value && typeof value.message === 'string') return new Error(value.message);
    return new Error(fallbackMessage);
}

function sendRequest(type, payload = {}, transferList = [], timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!isNeutralino) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        let settled = false;
        let timeoutId;
        let handler;

        const cleanup = () => {
            clearTimeout(timeoutId);
            window.removeEventListener('message', handler);
        };

        const settle = (callback) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };

        handler = (event) => {
            if (event.source !== window.parent) return;
            if (event.data?.type !== 'NL_RESPONSE' || event.data.id !== id) return;

            settle(() => {
                if (event.data.error) {
                    reject(toError(event.data.error, `Request ${type} failed`));
                } else {
                    resolve(event.data.result);
                }
            });
        };

        timeoutId = setTimeout(() => {
            settle(() => {
                reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
            });
        }, timeoutMs);

        window.addEventListener('message', handler);

        try {
            const message = { type, id, ...payload };
            if (transferList.length > 0) {
                window.parent.postMessage(message, '*', transferList);
            } else {
                window.parent.postMessage(message, '*');
            }
        } catch (error) {
            settle(() => {
                reject(toError(error, `Failed to send request: ${type}`));
            });
        }
    });
}

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
        try {
            return await sendRequest('NL_OS_SHOW_SAVE_DIALOG', { title, options });
        } catch (error) {
            console.error('[Bridge] Show save dialog failed:', error);
            return null;
        }
    },
    showFolderDialog: async (title, options) => {
        if (!isNeutralino) return;
        try {
            return await sendRequest('NL_OS_SHOW_FOLDER_DIALOG', { title, options });
        } catch (error) {
            console.error('[Bridge] Show folder dialog failed:', error);
            return null;
        }
    },
};

export const filesystem = {
    readBinaryFile: async (path) => {
        if (!isNeutralino) return;
        return sendRequest('NL_FS_READ_BINARY', { path });
    },
    readDirectory: async (path) => {
        if (!isNeutralino) return;
        return sendRequest('NL_FS_READ_DIR', { path });
    },
    getStats: async (path) => {
        if (!isNeutralino) return;
        return sendRequest('NL_FS_STATS', { path });
    },
    writeBinaryFile: async (path, buffer) => {
        if (!isNeutralino) return;
        const transferList = buffer instanceof ArrayBuffer ? [buffer] : [];
        return sendRequest('NL_FS_WRITE_BINARY', { path, buffer }, transferList);
    },
    appendBinaryFile: async (path, buffer) => {
        if (!isNeutralino) return;
        const transferList = buffer instanceof ArrayBuffer ? [buffer] : [];
        return sendRequest('NL_FS_APPEND_BINARY', { path, buffer }, transferList);
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
