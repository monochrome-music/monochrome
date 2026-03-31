import { FFmpeg } from '!/@ffmpeg/ffmpeg/dist/esm/classes.js';

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
            self.postMessage({ type: 'log', stage: 'stdout', message });

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
        extraFiles = [],
        rawArgs,
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
        await loadFFmpeg(loadOptions);

        self.postMessage({ type: 'progress', stage: 'encoding', message: encodeStartMessage, progress: 0.0 });

        try {
            if (audioData) {
                await ffmpeg.writeFile('input', new Uint8Array(audioData));
            }

            for (const file of extraFiles) {
                await ffmpeg.writeFile(file.name, new Uint8Array(file.data));
            }

            const ffmpegArgs = rawArgs || ['-i', 'input', ...args, ...(output.name ? [output.name] : [])];
            self.postMessage({ type: 'command', command: ffmpegArgs });

            const exitCode = await ffmpeg.exec(ffmpegArgs);

            if (exitCode !== 0) {
                throw new Error(`FFmpeg failed with exit code ${exitCode}.`);
            }

            self.postMessage({ type: 'progress', stage: 'finalizing', message: encodeEndMessage, progress: 100.0 });

            const data = output.name ? await ffmpeg.readFile(output.name) : [];
            const outputBlob = new Blob([data], { type: output.mime });

            self.postMessage({ type: 'complete', blob: outputBlob });
        } finally {
            try {
                if (audioData) await ffmpeg.deleteFile('input');
            } catch {
                self.postMessage({ type: 'log', message: 'Failed to delete input file from FFmpeg FS.' });
            }
            for (const file of extraFiles) {
                try {
                    await ffmpeg.deleteFile(file.name);
                } catch {
                    self.postMessage({ type: 'log', message: `Failed to delete ${file.name} from FFmpeg FS.` });
                }
            }
            try {
                if (output.name) {
                    await ffmpeg.deleteFile(output.name);
                }
            } catch {
                self.postMessage({ type: 'log', message: `Failed to delete ${output.name} from FFmpeg FS.` });
            }
        }
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
