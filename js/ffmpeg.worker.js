import { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpeg = null;
let loadingPromise = null;

// For granular progress
let totalDurationSeconds = null;
let lastProgress = 0;

function parseTimestamp(str) {
    // Expects format: 00:03:19.26
    const match = str.match(/(\d+):(\d+):(\d+\.?\d*)/);
    if (!match) return null;
    const [, h, m, s] = match;
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

function extractDurationFromLog(log) {
    // Looks for 'Duration: 00:03:19.26'
    const match = log.match(/Duration: (\d+:\d+:\d+\.?\d*)/);
    if (match) {
        return parseTimestamp(match[1]);
    }
    return null;
}

function extractTimeFromLog(log) {
    // Looks for 'time=00:01:05.53'
    const match = log.match(/time=(\d+:\d+:\d+\.?\d*)/);
    if (match) {
        return parseTimestamp(match[1]);
    }
    return null;
}

async function loadFFmpeg(loadOptions = {}) {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            self.postMessage({ type: 'log', message });

            // Try to extract total duration from input log
            if (totalDurationSeconds === null) {
                const dur = extractDurationFromLog(message);
                if (dur) {
                    totalDurationSeconds = dur;
                    self.postMessage({ type: 'progress', stage: 'parsing', message: `Detected duration: ${dur}s` });
                }
            }

            // Try to extract current time from progress log
            if (totalDurationSeconds) {
                const cur = extractTimeFromLog(message);
                if (cur !== null) {
                    let progress = Math.min(100, (cur / totalDurationSeconds) * 100);
                    // Only send if progress increased by at least 0.1%
                    if (progress - lastProgress >= 0.1 || progress === 100) {
                        lastProgress = progress;
                        self.postMessage({
                            type: 'progress',
                            stage: 'encoding',
                            progress,
                            time: cur,
                            message: `Encoding: ${progress.toFixed(1)}% (${cur.toFixed(2)}s / ${totalDurationSeconds.toFixed(2)}s)`,
                        });
                    }
                }
            }
        });

        // Optionally keep the original progress event for fallback
        ffmpeg.on('progress', ({ progress, time }) => {
            // Only send if we don't have granular progress
            if (!totalDurationSeconds) {
                self.postMessage({
                    type: 'progress',
                    stage: 'encoding',
                    progress: progress * 100,
                    time,
                });
            }
        });

        self.postMessage({ type: 'progress', stage: 'loading', message: 'Loading FFmpeg...' });

        await ffmpeg.load(loadOptions);
        // Reset progress state for each run
        totalDurationSeconds = null;
        lastProgress = 0;
    })();

    return loadingPromise;
}

self.onmessage = async (e) => {
    const {
        audioData,
        args = [],
        output = {
            name: 'output',
            mime: 'application/octet-stream',
        },
        encodeStartMessage = 'Encoding...',
        encodeEndMessage = 'Finalizing...',
        loadOptions = {},
    } = e.data;

    try {
        console.log(loadOptions);
        await loadFFmpeg(loadOptions);

        self.postMessage({ type: 'progress', stage: 'encoding', message: encodeStartMessage, progress: 0.0 });

        try {
            // Write input file to FFmpeg virtual filesystem
            await ffmpeg.writeFile('input', new Uint8Array(audioData));

            const ffmpegArgs = ['-i', 'input', ...args, output.name];

            // Log the exact FFmpeg command being run for debugging.
            self.postMessage({ type: 'log', message: `Running with args: ${ffmpegArgs.join(' ')}` });

            // Run FFMPEG with the provided arguments.
            await ffmpeg.exec(ffmpegArgs);

            self.postMessage({ type: 'progress', stage: 'finalizing', message: encodeEndMessage, progress: 100.0 });

            // Read output file - use Uint8Array directly to avoid extra bytes from ArrayBuffer
            const data = await ffmpeg.readFile(output.name);
            const outputBlob = new Blob([data], { type: output.mime });

            self.postMessage({ type: 'complete', blob: outputBlob });
        } finally {
            // Always cleanup virtual filesystem files
            try {
                await ffmpeg.deleteFile('input');
            } catch {
                // File may not exist if writeFile failed
            }
            try {
                await ffmpeg.deleteFile(output.name);
            } catch {
                // File may not exist if exec failed
            }
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
