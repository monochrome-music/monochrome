import { losslessContainerSettings } from './storage';
import { getExtensionFromBlob } from './utils';
import { rebuildFlacWithoutMetadata } from './metadata.flac.js';
import {
    type ProgressEvent,
    isCustomFormat,
    getCustomFormat,
    transcodeWithCustomFormat,
    getContainerFormat,
    transcodeWithContainerFormat,
} from './ffmpegFormats';
import { ffmpegInfo, ffmpegNewContainer } from './ffmpeg';

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
 * Apply post-processing to an audio Blob according to the requested quality.
 *
 * This function:
 * - Detects the source container/extension via getExtensionFromBlob.
 * - Determines whether the source is lossless:
 *   - FLAC is always lossless.
 *   - M4A is treated as lossless only when trackAudioQuality is "LOSSLESS" or "HI_RES_LOSSLESS".
 * - If a custom lossy format is requested (isCustomFormat(quality)):
 *   - If the source is already lossy, returns the original Blob to avoid quality degradation.
 *   - Otherwise, obtains the custom format via getCustomFormat and transcodes using
 *     transcodeWithCustomFormat(...). Progress events are reported via onProgress.
 *   - If encoding fails, onProgress is notified with an error stage and the original error is rethrown.
 * - If a lossless output is requested (quality ends with "LOSSLESS"):
 *   - Retrieves the configured lossless container and its format handler.
 *   - If the source is not lossless, logs a warning and returns the original Blob.
 *   - Otherwise:
 *     - If containerFmt.needsTranscode(blob) is true, transcodes via transcodeWithContainerFormat(...).
 *     - Else if the source is FLAC, calls rebuildFlacWithoutMetadata to strip/rebuild metadata safely.
 *     - Else remuxes into the desired container via ffmpegNewContainer (maps m4a -> mp4 where appropriate).
 *   - Any non-abort errors during lossless container conversion are caught and logged (conversion is best-effort).
 *
 * Progress and cancellation:
 * - onProgress, if provided, will be called with progress/update/error events from the underlying encoding/transcode helpers.
 * - An AbortSignal may be provided to cancel long-running transcode operations; abort-related errors (AbortError)
 *   are propagated.
 *
 * @param blob - The source audio Blob to process.
 * @param quality - Requested output quality identifier (may indicate custom lossy format or lossless output).
 * @param onProgress - Optional callback invoked with progress/update events (or error notifications).
 * @param signal - Optional AbortSignal used to cancel asynchronous transcode operations.
 * @param trackAudioQuality - Optional track audio quality information from the API (e.g. "LOSSLESS", "HI_RES_LOSSLESS")
 *                            used to determine whether an m4a source should be treated as lossless.
 * @returns A Promise that resolves to the resulting audio Blob (may be the original blob if no processing was needed
 *          or if processing was skipped due to source/quality constraints).
 * @throws Throws underlying encoding/transcoding errors (including AbortError when aborted). Encoding errors during
 *         custom-format transcode are rethrown after reporting via onProgress. Non-abort errors during lossless
 *         container conversion are logged and do not necessarily propagate.
 */
export async function applyAudioPostProcessing(
    blob: Blob,
    quality: string,
    onProgress: ((progress: ProgressEvent) => void) | null = null,
    signal: AbortSignal | null = null,
    trackAudioQuality: string | null = null
): Promise<Blob> {
    const extension = await getExtensionFromBlob(blob);
    const statedLossless = (trackAudioQuality || quality).endsWith('LOSSLESS');

    // Determine whether the downloaded source is lossless.
    // FLAC is always lossless. m4a is lossless only when the track's
    // audio quality from the API is LOSSLESS or HI_RES_LOSSLESS; otherwise
    // it is AAC (lossy).
    let sourceIsLossless =
        extension === 'flac' ||
        (extension === 'm4a' && (trackAudioQuality === 'LOSSLESS' || trackAudioQuality === 'HI_RES_LOSSLESS'));

    if (statedLossless && !sourceIsLossless) {
        // Basic checks say the file isn't lossless, but we'll use ffmpegInfo to check the codec.
        const ffmpegLog: string[] = await ffmpegInfo(blob);
        sourceIsLossless = ffmpegLog.some((line) => line.match(/Stream #\d:\d -> #\d:\d \(flac/));
    }

    // Transcode to custom lossy format if requested
    if (isCustomFormat(quality)) {
        // If the source is already lossy, transcoding would degrade quality
        // further (lossy → lossy).  Return the blob as-is instead.
        if (!sourceIsLossless) {
            return blob;
        }
        const format = getCustomFormat(quality);
        if (format) {
            try {
                blob = await transcodeWithCustomFormat(blob, format, onProgress, signal);

                return blob;
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

    if (statedLossless) {
        try {
            const containerName = losslessContainerSettings.getContainer();
            const containerFmt = getContainerFormat(containerName);

            if (!sourceIsLossless) {
                console.warn(
                    `Requested lossless output but source is not lossless (quality: ${quality}, trackAudioQuality: ${trackAudioQuality}, extension: ${extension}).`
                );
                return blob;
            }

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
