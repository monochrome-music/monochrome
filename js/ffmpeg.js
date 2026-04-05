import FfmpegWorker from './ffmpeg.worker.js?worker';
import coreJs from '!/@ffmpeg/core/dist/esm/ffmpeg-core.js?blob-url';
import coreWasm from '!/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?blob-url';
import { FfmpegProgress } from './ffmpeg.types';

/**
 * @typedef {import('./ffmpeg.types.ts').FfmpegProgress} FfmpegProgress
 */

class FfmpegError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FfmpegError';
        this.code = 'FFMPEG_FAILED';
    }
}

export function loadFfmpeg() {
    return (
        loadFfmpeg.promise ||
        (loadFfmpeg.promise = (async () => {
            const data = {
                coreURL: await coreJs(),
                wasmURL: await coreWasm(),
            };

            return data;
        })())
    );
}

/**
 *
 * @param {Blob} audioBlob
 * @param {string[]} args
 * @param {string} outputName
 * @param {string} outputMime
 * @param {(progress: FfmpegProgress) => void} onProgress
 * @param {AbortSignal|null} signal
 * @param {Array<{name: string, data: ArrayBuffer | Uint8Array}>} extraFiles
 * @param {Boolean} logConsole - Whether to log FFmpeg output to the console
 * @returns {Promise<Blob>} Encoded audio blob
 */
async function ffmpegWorker(
    audioBlob,
    args = [],
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null,
    extraFiles = [],
    logConsole = true,
    rawArgs = false
) {
    const audioData = audioBlob ? await audioBlob.arrayBuffer() : null;
    const assets = loadFfmpeg();

    return new Promise((resolve, reject) => {
        let endCategory = null;
        const worker = new FfmpegWorker();

        // Handle abort signal
        const abortHandler = () => {
            worker.terminate();
            endCategory?.();
            reject(new FfmpegError('FFMPEG aborted'));
        };

        if (signal) {
            if (signal.aborted) {
                abortHandler();
                return;
            }
            signal.addEventListener('abort', abortHandler);
        }

        worker.onmessage = (e) => {
            const { type, blob, message, stage, progress, command } = e.data;

            if (type === 'complete') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                endCategory?.();
                resolve(blob);
            } else if (type === 'error') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                endCategory?.();
                reject(new FfmpegError(message));
            } else if (type === 'progress' && message) {
                onProgress?.(new FfmpegProgress(stage, progress || 0, message));
            } else if (type === 'progress' && stage != 'loading' && progress !== null) {
                onProgress?.(new FfmpegProgress(stage, progress || 0, message));
            } else if (type === 'command') {
                if (logConsole) {
                    const consoleCategory = `ffmpeg ${command?.join(' ')}`;
                    // eslint-disable-next-line no-console
                    console.groupCollapsed(consoleCategory);
                    // eslint-disable-next-line no-console
                    endCategory = () => console.groupEnd();
                }
            } else if (type === 'log') {
                onProgress?.(new FfmpegProgress('stdout', 0, message));
                if (logConsole) {
                    console.log('[FFmpeg]', message);
                }
            }
        };

        worker.onerror = (error) => {
            if (signal) signal.removeEventListener('abort', abortHandler);
            worker.terminate();
            endCategory?.();
            reject(new FfmpegError('Worker failed: ' + error.message));
        };

        void (async () => {
            const transferables = [];
            if (audioData) transferables.push(audioData);
            for (const f of extraFiles) {
                if (f.data instanceof ArrayBuffer) {
                    transferables.push(f.data);
                } else if (f.data.buffer instanceof ArrayBuffer) {
                    transferables.push(f.data.buffer);
                }
            }

            worker.postMessage(
                {
                    audioData,
                    extraFiles,
                    ...(rawArgs ? { rawArgs: args } : { args }),
                    output: {
                        name: outputName,
                        mime: outputMime,
                    },
                    loadOptions: await assets,
                },
                transferables
            );
        })();
    });
}

/**
 * Encodes audio using FFmpeg via Web Worker
 * @async
 * @param {Blob} audioBlob - The audio blob to encode
 * @param {Object} [opts] - Options for FFmpeg encoding
 * @param {string[]} [opts.args=[]] - FFmpeg command-line arguments
 * @param {string} [opts.outputName='output'] - Name of the output file
 * @param {string} [opts.outputMime='application/octet-stream'] - MIME type of the output
 * @param {(progress: FfmpegProgress) => void} [opts.onProgress=null] - Optional callback for progress updates
 * @param {AbortSignal|null} [opts.signal=null] - Optional abort signal to cancel encoding
 * @param {Array} [opts.extraFiles=[]] - Additional files to provide to FFmpeg
 * @param {Boolean} [opts.logConsole=true] - Whether to log FFmpeg output to the console
 * @param {string[]} [opts.rawArgs=[]] - Whether to pass args as raw command line (without default input/output)
 * @returns {Promise<Blob>} Encoded audio blob
 * @throws {FfmpegError} If Web Workers are not available
 * @throws {Error} If FFmpeg encoding fails
 */
export async function ffmpeg(
    audioBlob,
    {
        args = [],
        outputName = 'output',
        outputMime = 'application/octet-stream',
        onProgress = null,
        signal = null,
        extraFiles = [],
        logConsole = true,
        rawArgs = null,
    } = {}
) {
    try {
        // Use Web Worker for non-blocking FFmpeg encoding
        if (typeof Worker !== 'undefined') {
            return await ffmpegWorker(
                audioBlob,
                rawArgs || args,
                outputName,
                outputMime,
                onProgress,
                signal,
                extraFiles,
                logConsole,
                !!rawArgs
            );
        }

        throw new FfmpegError('Web Workers are required for FFMPEG');
    } catch (error) {
        console.error('FFMPEG failed:', error);
        throw error;
    }
}

/**
 * Retrieves information about an audio blob using FFmpeg
 * @param {Blob} audioBlob - The audio blob to analyze
 * @param {Object} [options] - Options for FFmpeg info extraction
 * @param {((progress: FfmpegProgress) => void) | null} [options.onProgress] - Callback function to track conversion progress
 * @param {AbortSignal|null} [options.signal] - AbortSignal for cancelling the operation
 * @returns {Promise<string[]>} A promise that resolves to an array of output lines
 */
export async function ffmpegInfo(audioBlob, { onProgress = null, signal = null } = {}) {
    const outputLines = [];
    try {
        await ffmpeg(audioBlob, {
            args: ['-t', '0.01'],
            outputName: 'output.wav',
            onProgress: (progress) => {
                if (progress.stage === 'stdout' && progress.message) {
                    outputLines.push(progress.message);
                }

                onProgress?.(progress);
            },
            signal,
            logConsole: false,
        });
    } catch (err) {
        if (err instanceof FfmpegError && !err.message.startsWith('Failed to delete')) {
            console.warn('FFmpeg info extraction failed:', err);
        }
    }

    return outputLines;
}

/**
 * Creates a new FFmpeg container with copied codec and stripped metadata.
 * @param {Blob} audioBlob - The audio blob to process
 * @param {string} outputExtension - The extension for the output file
 * @param {string} outputMime - The MIME type for the output blob
 * @param {((progress: FfmpegProgress) => void) | null} onProgress - Callback function to track conversion progress
 * @param {AbortSignal} signal - AbortSignal for cancelling the operation
 * @returns {Promise<Blob>} A promise that resolves to the processed data blob
 */
export async function ffmpegNewContainer(audioBlob, outputExtension, outputMime, onProgress, signal) {
    return await ffmpeg(audioBlob, {
        args: ['-map_metadata', '-1', '-c', 'copy', '-strict', '-2'],
        outputName: `output.${outputExtension}`,
        outputMime: outputMime,
        onProgress,
        signal: signal,
    });
}

export { FfmpegError };
