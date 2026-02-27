import { ffmpeg } from './ffmpeg';

class MP3EncodingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MP3EncodingError';
        this.code = 'MP3_ENCODING_FAILED';
    }
}

export async function encodeToMp3(audioBlob, onProgress = null, signal = null) {
    try {
        // Use Web Worker for non-blocking FFmpeg encoding
        if (typeof Worker !== 'undefined') {
            const args = ['-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100'];

            return await ffmpeg(audioBlob, { args }, 'output.mp3', 'audio/mpeg', onProgress, signal);
        }

        throw new MP3EncodingError('Web Workers are required for MP3 encoding');
    } catch (error) {
        console.error('MP3 encoding failed:', error);

        throw new MP3EncodingError(error?.message ?? error);
    }
}

export { MP3EncodingError };
