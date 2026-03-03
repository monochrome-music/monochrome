import { losslessContainerSettings } from './storage';
import { getExtensionFromBlob, joinNativePath } from './utils';
import { rebuildFlacWithoutMetadata } from './metadata.flac.js';
import {
    type ProgressEvent,
    isCustomFormat,
    getCustomFormat,
    transcodeWithCustomFormat,
    getContainerFormat,
    transcodeWithContainerFormat,
} from './ffmpegFormats';
import { ffmpegNewContainer } from './ffmpeg';

/**
 * Triggers a file download for the given blob.
 * In Neutralino mode, attempts to save directly to the configured download folder.
 * Falls back to browser download if the native save fails or is unavailable.
 */
export async function triggerDownload(blob: Blob, filename: string): Promise<void> {
    // In Neutralino mode, save directly to the configured download folder
    if (window.NL_MODE || window.location.search.includes('mode=neutralino')) {
        try {
            const { downloadLocationSettings } = await import('./storage.js');
            const downloadPath = downloadLocationSettings.getPath();
            if (downloadPath) {
                const bridge = await import('./desktop/neutralino-bridge.js');
                                    const fullPath = joinNativePath(downloadPath, filename);                const arrayBuffer = await blob.arrayBuffer();
                await bridge.filesystem.writeBinaryFile(fullPath, arrayBuffer);
                console.log(`[Download] Saved to: ${fullPath}`);
                return;
            }
        } catch (e) {
            console.error('[Download] Native save failed, falling back to browser download:', e);
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Applies audio post-processing to a blob:
 * 1. Transcodes to a custom ffmpeg format if `quality` identifies one.
 * 2. Re-muxes to the user-selected lossless container when the quality is
 *    a lossless tier (quality ends with "LOSSLESS").
 *
 * Returns the (possibly transformed) blob.
 */
export async function applyAudioPostProcessing(
    blob: Blob,
    quality: string,
    onProgress: ((progress: ProgressEvent) => void) | null = null,
    signal: AbortSignal | null = null
): Promise<Blob> {
    // Transcode to custom format if requested
    if (isCustomFormat(quality)) {
        const format = getCustomFormat(quality);
        if (format) {
            try {
                blob = await transcodeWithCustomFormat(blob, format, onProgress, signal);
            } catch (encodingError) {
                if (onProgress) {
                    onProgress({
                        stage: 'error',
                        message: `Encoding failed: ${(encodingError as Error).message}`,
                    });
                }
                throw encodingError;
            }
        }
    }

    if (quality.endsWith('LOSSLESS')) {
        try {
            const containerFmt = getContainerFormat(losslessContainerSettings.getContainer());
            const extension = await getExtensionFromBlob(blob);

            if (await containerFmt?.needsTranscode(blob)) {
                blob = await transcodeWithContainerFormat(blob, containerFmt, onProgress, signal);
            } else if (extension === 'flac') {
                blob = await rebuildFlacWithoutMetadata(blob);
            } else {
                blob = await ffmpegNewContainer(
                    blob,
                    extension == 'm4a' ? 'mp4' : extension,
                    blob.type,
                    onProgress,
                    signal
                );
            }
        } catch (error) {
            if ((error as Error)?.name === 'AbortError' || signal?.aborted) {
                throw error;
            }

            console.error('Lossless container conversion failed:', error);
        }
    }

    return blob;
}
