import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Dialog } from '@capacitor/dialog';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { MediaSession as CapacitorMediaSession } from '@jofr/capacitor-media-session';
import { CapacitorMediaStore } from '@odion-cloud/capacitor-mediastore';

const hasWindow = typeof window !== 'undefined';

export const isCapacitorRuntime =
    hasWindow &&
    (Boolean(window.Capacitor?.isNativePlatform?.()) ||
        Boolean(Capacitor?.isNativePlatform?.()) ||
        window.location.search.includes('mode=capacitor'));

if (hasWindow) {
    window.CAP_MODE = isCapacitorRuntime;
}
const listeners = new Map();

function emit(eventName, detail) {
    if (!listeners.has(eventName)) return;
    listeners.get(eventName).forEach((handler) => {
        try {
            handler(detail);
        } catch (error) {
            console.error('[CapacitorBridge] Error in event handler:', error);
        }
    });
}

function normalizePath(path) {
    return String(path || '').replace(/^[\\/]+/, '');
}

function bufferFrom(input) {
    if (input instanceof ArrayBuffer) return input;
    if (ArrayBuffer.isView(input)) {
        return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    return new ArrayBuffer(0);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const normalized = String(base64 || '').includes(',')
        ? String(base64).split(',').pop() || ''
        : String(base64 || '');
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function sanitizeRelativePath(relativePath) {
    return String(relativePath || 'Music/Monochrome')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

async function blobToBase64(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return arrayBufferToBase64(arrayBuffer);
}

export const init = async () => {
    if (!isCapacitorRuntime) return;
    try {
        App.addListener('backButton', () => emit('backButton'));
        App.addListener('appStateChange', ({ isActive }) => {
            emit(isActive ? 'windowFocus' : 'windowBlur');
        });
    } catch (error) {
        console.warn('[CapacitorBridge] Native listener registration failed:', error);
    }
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
        emit(eventName, data);
    },
};

export const extensions = {
    dispatch: async (extensionId, eventName, data) => {
        emit(`${extensionId}:${eventName}`, data);
    },
};

export const app = {
    exit: async () => {
        if (!isCapacitorRuntime) return;
        await App.exitApp();
    },
};

export const os = {
    open: async (url) => {
        if (isCapacitorRuntime) {
            await Browser.open({ url });
            return;
        }
        window.open(url, '_blank', 'noopener');
    },
    showSaveDialog: async (title, options) => {
        const defaultPath = options?.defaultPath || 'monochrome.zip';
        if (!isCapacitorRuntime) return defaultPath;

        try {
            const result = await Dialog.prompt({
                title: title || 'Save file',
                message: 'Choose a filename in app storage',
                inputText: defaultPath,
            });
            if (result.cancelled) return null;
            const value = result.value?.trim();
            return value || defaultPath;
        } catch {
            return defaultPath;
        }
    },
    showFolderDialog: async (title = 'Folder selection unavailable') => {
        if (isCapacitorRuntime) {
            try {
                await Dialog.alert({
                    title,
                    message: 'Folder selection is not available in the Capacitor runtime.',
                });
            } catch {
                // no-op
            }
        }
        return null;
    },
};

export const filesystem = {
    readBinaryFile: async (path) => {
        const result = await Filesystem.readFile({
            path: normalizePath(path),
            directory: Directory.Documents,
        });
        return base64ToArrayBuffer(result.data);
    },
    readDirectory: async (path) => {
        const result = await Filesystem.readdir({
            path: normalizePath(path),
            directory: Directory.Documents,
        });
        return (result.files || []).map((entry) => {
            if (typeof entry === 'string') {
                return { entry, type: 'FILE' };
            }

            const kind = entry.type === 'directory' ? 'DIRECTORY' : 'FILE';
            return { entry: entry.name || '', type: kind };
        });
    },
    getStats: async (path) => {
        const result = await Filesystem.stat({
            path: normalizePath(path),
            directory: Directory.Documents,
        });

        return {
            mtime: result.mtime || Date.now(),
            size: result.size || 0,
            type: result.type || 'file',
        };
    },
    writeBinaryFile: async (path, buffer) => {
        const binary = bufferFrom(buffer);
        await Filesystem.writeFile({
            path: normalizePath(path),
            directory: Directory.Documents,
            data: arrayBufferToBase64(binary),
            recursive: true,
        });
    },
    appendBinaryFile: async (path, buffer) => {
        const existing = await filesystem.readBinaryFile(path).catch(() => new ArrayBuffer(0));
        const next = bufferFrom(buffer);
        const merged = new Uint8Array(existing.byteLength + next.byteLength);
        merged.set(new Uint8Array(existing), 0);
        merged.set(new Uint8Array(next), existing.byteLength);
        await filesystem.writeBinaryFile(path, merged.buffer);
    },
};

export const media = {
    setMetadata: async (options) => {
        await CapacitorMediaSession.setMetadata(options);
    },
    setPlaybackState: async (options) => {
        await CapacitorMediaSession.setPlaybackState(options);
    },
    setPositionState: async (options) => {
        await CapacitorMediaSession.setPositionState(options);
    },
    setActionHandler: async (options, handler) => {
        await CapacitorMediaSession.setActionHandler(options, handler);
    },
};

export const downloads = {
    saveAudioToMusic: async ({ blob, fileName, albumName = null, relativePath = 'Music/Monochrome' } = {}) => {
        if (!isCapacitorRuntime || Capacitor.getPlatform() !== 'android') {
            return { success: false, skipped: true, error: 'Not running on Android native platform' };
        }

        if (!blob || !fileName) {
            throw new Error('Missing blob or fileName for MediaStore save');
        }

        try {
            await CapacitorMediaStore.requestPermissions({ types: ['audio'] });

            const result = await CapacitorMediaStore.saveMedia({
                data: await blobToBase64(blob),
                fileName: String(fileName),
                mediaType: 'audio',
                albumName: albumName || undefined,
                relativePath: sanitizeRelativePath(relativePath),
            });

            if (!result?.success) {
                throw new Error(result?.error || 'Unknown MediaStore save error');
            }

            return result;
        } catch (error) {
            throw new Error(`MediaStore save failed: ${error?.message || String(error)}`);
        }
    },
};

export const nativeWindow = {
    minimize: async () => {},
    maximize: async () => {},
    show: async () => {},
    hide: async () => {},
    isVisible: async () => true,
    setTitle: async (title) => {
        if (typeof document !== 'undefined' && title) {
            document.title = title;
        }
    },
};

export { nativeWindow as window };

export default {
    init,
    events,
    extensions,
    app,
    os,
    filesystem,
    media,
    downloads,
    window: nativeWindow,
};
