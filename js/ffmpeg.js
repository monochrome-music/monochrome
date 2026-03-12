import { fetchBlobURL } from './utils';
import FfmpegWorker from './ffmpeg.worker.js?worker';
import coreJs from '!/@ffmpeg/core/dist/esm/ffmpeg-core.js?url';
import coreWasm from '!/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url';

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
                coreURL: await fetchBlobURL(coreJs),
                wasmURL: await fetchBlobURL(coreWasm),
            };

            return data;
        })())
    );
}

async function ffmpegWorker(
    audioBlob,
    args = [],
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null,
    extraFiles = []
) {
    const audioData = audioBlob ? await audioBlob.arrayBuffer() : null;
    const assets = loadFfmpeg();

    return new Promise((resolve, reject) => {
        const worker = new FfmpegWorker();

        // Handle abort signal
        const abortHandler = () => {
            worker.terminate();
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
            const { type, blob, message, stage, progress } = e.data;

            if (type === 'complete') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                resolve(blob);
            } else if (type === 'error') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                reject(new FfmpegError(message));
            } else if (type === 'progress' && onProgress) {
                onProgress({ stage, message, progress });
            } else if (type === 'log') {
                console.log('[FFmpeg]', message);
            }
        };

        worker.onerror = (error) => {
            if (signal) signal.removeEventListener('abort', abortHandler);
            worker.terminate();
            reject(new FfmpegError('Worker failed: ' + error.message));
        };

        (async () => {
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
                    args,
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

export async function ffmpeg(
    audioBlob,
    args = [],
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null,
    extraFiles = []
) {
    try {
        // Use Web Worker for non-blocking FFmpeg encoding
        if (typeof Worker !== 'undefined') {
            return await ffmpegWorker(audioBlob, args, outputName, outputMime, onProgress, signal, extraFiles);
        }

        throw new FfmpegError('Web Workers are required for FFMPEG');
    } catch (error) {
        console.error('FFMPEG failed:', error);
        throw error;
    }
}

/**
 * Creates a new FFmpeg container with copied codec and stripped metadata.
 * @param {Blob} audioBlob - The audio blob to process
 * @param {string} outputExtension - The extension for the output file
 * @param {string} outputMime - The MIME type for the output blob
 * @param {Function} onProgress - Callback function to track conversion progress
 * @param {AbortSignal} signal - AbortSignal for cancelling the operation
 * @returns {Promise<Blob>} A promise that resolves to the processed data blob
 */
export async function ffmpegNewContainer(audioBlob, outputExtension, outputMime, onProgress, signal) {
    return await ffmpeg(
        audioBlob,
        ['-map_metadata', '-1', '-c', 'copy', '-strict', '-2'],
        `output.${outputExtension}`,
        outputMime,
        onProgress,
        signal
    );
}

export { FfmpegError };
