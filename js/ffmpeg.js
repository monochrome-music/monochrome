class FfmpegError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FfmpegError';
        this.code = 'FFMPEG_FAILED';
    }
}

async function ffmpegWorker(
    audioBlob,
    args = {},
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null
) {
    const audioData = await audioBlob.arrayBuffer();

    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./ffmpeg.worker.js', import.meta.url), { type: 'module' });

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

        // Transfer audio data to worker
        worker.postMessage(
            {
                audioData,
                ...args,
                output: {
                    name: outputName,
                    mime: outputMime,
                },
            },
            [audioData]
        );
    });
}

export async function ffmpeg(
    audioBlob,
    args = {},
    outputName = 'output',
    outputMime = 'application/octet-stream',
    onProgress = null,
    signal = null
) {
    try {
        // Use Web Worker for non-blocking FFmpeg encoding
        if (typeof Worker !== 'undefined') {
            return await ffmpegWorker(audioBlob, args, outputName, outputMime, onProgress, signal);
        }

        throw new FfmpegError('Web Workers are required for FFMPEG');
    } catch (error) {
        console.error('FFMPEG failed:', error);
        throw error;
    }
}

export { FfmpegError };
