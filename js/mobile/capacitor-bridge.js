import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Dialog } from '@capacitor/dialog';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { MediaSession as CapacitorMediaSession } from '@jofr/capacitor-media-session';
import { CapacitorMediaStore } from '@odion-cloud/capacitor-mediastore';
import { AppInstallPlugin } from '@m430/capacitor-app-install';

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

async function blobToBase64(blob) {
    return await new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error || new Error('Failed to read blob as base64'));
            reader.onloadend = () => {
                const result = String(reader.result || '');
                const commaIndex = result.indexOf(',');
                resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
            };
            reader.readAsDataURL(blob);
        } catch (error) {
            reject(error);
        }
    });
}

const mediaPermissionGranted = {
    audio: false,
    video: false,
};

async function ensureMediaStorePermission(type = 'audio') {
    if (mediaPermissionGranted[type]) return;

    const status = await CapacitorMediaStore.requestPermissions({ types: [type] });
    const permissionState =
        (type === 'video' ? status?.readMediaVideo : status?.readMediaAudio) ||
        status?.readExternalStorage ||
        status?.writeExternalStorage;

    if (permissionState && permissionState !== 'granted') {
        throw new Error(`MediaStore ${type} permission was not granted`);
    }

    mediaPermissionGranted[type] = true;
}

function pickMimeType(blob, fallback) {
    const raw = String(blob?.type || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    if (!raw || raw === 'application/octet-stream' || raw === 'audio/*' || raw === 'video/*') {
        return fallback;
    }
    return raw;
}

async function saveToMediaStore({
    blob,
    fileName,
    mediaType,
    albumName = null,
    relativePath,
    fallbackMimeType,
} = {}) {
    if (!blob || !fileName) {
        throw new Error('Missing blob or fileName for MediaStore save');
    }

    await ensureMediaStorePermission(mediaType);

    const result = await CapacitorMediaStore.saveMedia({
        data: await blobToBase64(blob),
        fileName: String(fileName),
        mediaType,
        mimeType: pickMimeType(blob, fallbackMimeType),
        albumName: mediaType === 'audio' ? albumName || undefined : undefined,
        relativePath,
    });

    if (!result?.success) {
        throw new Error(result?.error || 'Unknown MediaStore save error');
    }

    return result;
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
    setMetadata: async (options = {}) => {
        await CapacitorMediaSession.setMetadata({
            ...options,
            artwork: Array.isArray(options.artwork) ? options.artwork : [],
        });
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
    saveAudioToMusic: async ({ blob, fileName, albumName = null } = {}) => {
        if (!isCapacitorRuntime || Capacitor.getPlatform() !== 'android') {
            return { success: false, skipped: true, error: 'Not running on Android native platform' };
        }
        try {
            return await saveToMediaStore({
                blob,
                fileName,
                mediaType: 'audio',
                albumName: albumName || undefined,
                fallbackMimeType: 'audio/mpeg',
            });
        } catch (error) {
            throw new Error(`MediaStore save failed: ${error?.message || String(error)}`);
        }
    },

    saveVideoToMovies: async ({ blob, fileName } = {}) => {
        if (!isCapacitorRuntime || Capacitor.getPlatform() !== 'android') {
            return { success: false, skipped: true, error: 'Not running on Android native platform' };
        }

        try {
            return await saveToMediaStore({
                blob,
                fileName,
                mediaType: 'video',
                relativePath: 'Movies/Monochrome',
                fallbackMimeType: 'video/mp4',
            });
        } catch (error) {
            throw new Error(`MediaStore save failed: ${error?.message || String(error)}`);
        }
    },
};
// updater functionality
let pendingUpdate = null;

function compareVersions(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const length = Math.max(pa.length, pb.length);

    for (let i = 0; i < length; i += 1) {
        const av = pa[i] || 0;
        const bv = pb[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }

    return 0;
}


async function downloadApkToCache(apkUrl) {
    const response = await fetch(apkUrl);
    if (!response.ok) {
        throw new Error(`Failed to download APK: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    const path = `update-${Date.now()}.apk`;

    await Filesystem.writeFile({
        path, 
        directory: Directory.Cache,
        data: base64,
        recursive: true,
    });

    const result = await Filesystem.getUri({
        path,
        directory: Directory.Cache,
    });

    if (!result?.uri) {
        throw new Error('i hate my life. guess it\' no updates for you');
    }

    return result.uri;
}

export const updater = {
    checkForUpdates : async () => {
        if (!isCapacitorRuntime) return;
        const appInfo = await App.getInfo();
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to check for updates: ${response.status} ${response.statusText}`);
        }
        const update = await response.json();
        const remoteVersion = update?.version;
        const apkUrl = update?.apkUrl;
        const available = compareVersions(remoteVersion, appInfo.version) > 0;
        pendingUpdate = available ? { ...update, apk: apkUrl } : null;
        return { ...update, apk: apkUrl, currentVersion: appInfo.version, available,};
    },

    install : async () => {
        const permission = await AppInstallPlugin.canInstallUnknownApps();

        if (!permission?.granted) {
            await AppInstallPlugin.openInstallUnknownAppsSettings();
            throw new Error('Permission to install unknown apps is required to update the application.');
        }

        const filePath = await downloadApkToCache (
            pendingUpdate.apk,
            pendingUpdate.version,
        );
            

        const result = await AppInstallPlugin.installApk({
            filePath,
        });

        if (!result?.completed) {
            throw new Error(result?.error || 'Failed to install update');
        }

        return result;
    }
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

export const orientation = {
    lockLandscape: async () => {
        if (!isCapacitorRuntime) return;
        try {
            await ScreenOrientation.lock({ orientation: 'landscape-primary' });
        } catch (error) {
            try {
                await ScreenOrientation.lock({ orientation: 'landscape' });
            } catch (fallbackError) {
                console.warn('[CapacitorBridge] Failed to lock orientation:', fallbackError);
            }
        }
    },
    unlock: async () => {
        if (!isCapacitorRuntime) return;
        try {
            await ScreenOrientation.unlock();
        } catch (error) {
            console.warn('[CapacitorBridge] Failed to unlock orientation:', error);
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
    updater,
    orientation,
    window: nativeWindow,
};
