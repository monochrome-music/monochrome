import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let loadingPromise = null;

async function loadFFmpeg() {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            self.postMessage({ type: 'log', message });
        });

        ffmpeg.on('progress', ({ progress, time }) => {
            self.postMessage({
                type: 'progress',
                stage: 'encoding',
                progress: progress * 100,
                time,
            });
        });

        self.postMessage({ type: 'progress', stage: 'loading', message: 'Loading FFmpeg...' });

        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
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
    } = e.data;

    try {
        await loadFFmpeg();

        self.postMessage({ type: 'progress', stage: 'encoding', message: encodeStartMessage });

        try {
            // Write input file to FFmpeg virtual filesystem
            await ffmpeg.writeFile('input', new Uint8Array(audioData));

            const ffmpegArgs = ['-i', 'input', ...args, output.name];

            // Log the exact FFmpeg command being run for debugging.
            self.postMessage({ type: 'log', message: `Running with args: ${ffmpegArgs.join(' ')}` });

            // Run FFMPEG with the provided arguments.
            await ffmpeg.exec(ffmpegArgs);

            self.postMessage({ type: 'progress', stage: 'finalizing', message: encodeEndMessage });

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
