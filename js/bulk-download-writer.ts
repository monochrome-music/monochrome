import { triggerDownload } from './download-utils';

/**
 * A single entry to be included in a ZIP archive or written directly to a folder.
 */
export interface WriterEntry {
    name: string;
    lastModified: Date;
    input: Blob | File | string | ArrayBuffer | Uint8Array;
}

async function loadClientZip() {
    try {
        return await import('client-zip');
    } catch (error) {
        console.error('Failed to load client-zip:', error);
        throw new Error('Failed to load ZIP library');
    }
}

/**
 * Interface for writing a collection of file entries to an output destination.
 * Each implementation handles its own output selection (save dialog, directory picker, etc.)
 * and throws a DOMException with name 'AbortError' if the user cancels.
 */
export interface IBulkDownloadWriter {
    write(files: AsyncIterable<WriterEntry>): Promise<void>;
}

/**
 * Triggers individual downloads for each file entry, one after another.
 */
class SequentialFileWriter implements IBulkDownloadWriter {
    constructor() {}

    async write(files: AsyncIterable<WriterEntry>): Promise<void> {
        for await (const file of files) {
            const name = file.name?.split('/').pop();
            const ext = name?.split('.').pop().toLowerCase();

            if (!name) {
                console.warn('No name for file entry.', file);
                continue;
            }

            if (['m3u', 'm3u8', 'cue', 'jpg', 'png', 'nfo', 'json'].includes(ext)) {
                continue;
            }

            if (file.input instanceof Blob || file.input instanceof File) {
                triggerDownload(file.input, name);
            } else {
                triggerDownload(new Blob([file.input as BlobPart]), name);
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
}

const sequentialFileWriter = new SequentialFileWriter();

export { sequentialFileWriter as SequentialFileWriter };

/**
 * Streams a ZIP archive to a file via the File System Access API.
 * Prompts the user to choose a save location with showSaveFilePicker.
 */
export class ZipStreamWriter implements IBulkDownloadWriter {
    constructor(private readonly suggestedFilename: string) {}

    async write(files: AsyncIterable<WriterEntry>): Promise<void> {
        const fileHandle = await window.showSaveFilePicker({
            suggestedName: this.suggestedFilename,
            types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
        });
        const { downloadZip } = await loadClientZip();
        const writable = await fileHandle.createWritable();
        const response = downloadZip(files);
        if (!response.body) throw new Error('ZIP response body is null');
        await response.body.pipeTo(writable);
    }
}

/**
 * Collects a ZIP archive into a Blob and triggers a browser download.
 * Works on all browsers without requiring the File System Access API.
 */
export class ZipBlobWriter implements IBulkDownloadWriter {
    constructor(private readonly filename: string) {}

    async write(files: AsyncIterable<WriterEntry>): Promise<void> {
        const { downloadZip } = await loadClientZip();
        const response = downloadZip(files);
        const blob = await response.blob();
        triggerDownload(blob, this.filename);
    }
}

/**
 * Writes files directly into a user-chosen folder using the standard browser
 * File System Access API (showDirectoryPicker). Subdirectories embedded in
 * file entry names are created automatically.
 *
 * Use the static {@link FolderPickerWriter.create} method to obtain an instance;
 * the constructor is private so the directory handle is always set before use.
 */
export class FolderPickerWriter implements IBulkDownloadWriter {
    private constructor(private readonly dirHandle: FileSystemDirectoryHandle) {}

    /** Returns the underlying directory handle (e.g. to persist it for later re-use). */
    getDirHandle(): FileSystemDirectoryHandle {
        return this.dirHandle;
    }

    /**
     * Creates a {@link FolderPickerWriter} from an already-obtained handle
     * without showing a directory picker.  Useful when re-using a stored handle
     * whose permission has already been verified by the caller.
     */
    static fromHandle(handle: FileSystemDirectoryHandle): FolderPickerWriter {
        return new FolderPickerWriter(handle);
    }

    /**
     * Prompts the user to pick a writable directory, or re-uses a previously
     * saved handle when one is supplied and write permission can be obtained.
     * Returns a new {@link FolderPickerWriter} bound to the chosen directory.
     * If the user dismisses the picker, the promise rejects with a DOMException
     * whose name is "AbortError".
     */
    static async create(savedHandle?: FileSystemDirectoryHandle | null): Promise<FolderPickerWriter> {
        // Try to re-use a saved handle first
        if (savedHandle) {
            try {
                const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    return new FolderPickerWriter(savedHandle);
                }
            } catch {
                // Fall through to show the picker
            }
        }

        // showDirectoryPicker is part of the File System Access API (not yet in all TS DOM libs)
        try {
            const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite',
            });
            return new FolderPickerWriter(dirHandle);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw error;
            }
            throw new DOMException('User cancelled directory picker', 'AbortError');
        }
    }

    async write(files: AsyncIterable<WriterEntry>): Promise<void> {
        for await (const file of files) {
            const parts = file.name.split('/').filter(Boolean);
            if (parts.length === 0) continue;

            let currentDir: FileSystemDirectoryHandle = this.dirHandle;
            for (let i = 0; i < parts.length - 1; i++) {
                currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
            }

            const filename = parts[parts.length - 1];
            const fileHandle = await currentDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();

            try {
                const { input } = file;
                if (input instanceof Blob) {
                    await writable.write(input);
                } else if (typeof input === 'string') {
                    await writable.write(new Blob([input], { type: 'text/plain' }));
                } else {
                    const buf =
                        input instanceof Uint8Array
                            ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
                            : input;
                    await writable.write(new Blob([buf as ArrayBuffer]));
                }

                await writable.close();
            } catch (error) {
                await writable.abort();
                throw error;
            }
        }
    }
}
