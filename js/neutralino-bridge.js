// js/neutralino-bridge.js

const listeners = new Map();

// Listen for events from the Shell (Parent)
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

export const init = async () => {
    console.log('[Bridge] Initialized. Mode: Iframe Shell.');
    // Notify Shell we are ready
    window.parent.postMessage({ type: 'NL_INIT' }, '*');
};

export const events = {
    on: (eventName, handler) => {
        if (!listeners.has(eventName)) {
            listeners.set(eventName, []);
        }
        listeners.get(eventName).push(handler);
    },
    off: (eventName, handler) => {
        if (!listeners.has(eventName)) return;
        const handlers = listeners.get(eventName);
        const index = handlers.indexOf(handler);
        if (index > -1) handlers.splice(index, 1);
    },
    broadcast: async (eventName, data) => {
        window.parent.postMessage({ type: 'NL_BROADCAST', eventName, data }, '*');
    },
};

export const extensions = {
    dispatch: async (extensionId, eventName, data) => {
        window.parent.postMessage({ type: 'NL_EXTENSION', extensionId, eventName, data }, '*');
    },
};

export const app = {
    exit: async () => {
        window.parent.postMessage({ type: 'NL_APP_EXIT' }, '*');
    },
};

const _window = {
    minimize: async () => {
        window.parent.postMessage({ type: 'NL_WINDOW_MIN' }, '*');
    },
    maximize: async () => {
        window.parent.postMessage({ type: 'NL_WINDOW_MAX' }, '*');
    },
    isVisible: async () => {
        return true; // Mock response
    },
    setTitle: async (title) => {
        window.parent.postMessage({ type: 'NL_WINDOW_SET_TITLE', title }, '*');
    }
};

// Expose generically for other modules
export { _window as window };
export default {
    init,
    events,
    extensions,
    app,
    window: _window
};
