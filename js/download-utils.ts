import { losslessContainerSettings } from './storage';
import { rebuildFlacWithoutMetadata } from './metadata.flac';
import { getExtensionFromBlob } from './utils';
import {
    type ProgressEvent,
    isCustomFormat,
    getCustomFormat,
    transcodeWithCustomFormat,
    getContainerFormat,
    transcodeWithContainerFormat,
} from './ffmpegFormats';

/**
 * Triggers a browser file download for the given blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
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
            if (containerFmt) {
                if (await containerFmt.needsTranscode(blob)) {
                    blob = await transcodeWithContainerFormat(blob, containerFmt, onProgress, signal);
                } else if ((await getExtensionFromBlob(blob)) == 'flac') {
                    blob = await rebuildFlacWithoutMetadata(blob);
                }
            }
        } catch (error) {
            if ((error as Error)?.name === 'AbortError') {
                throw error;
            }

            console.error('Lossless container conversion failed:', error);
        }
    }

    return blob;
}
