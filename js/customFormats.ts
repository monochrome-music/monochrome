import { ffmpeg } from './ffmpeg';

export interface ProgressEvent {
    stage?: string;
    message?: string;
    progress?: number;
    receivedBytes?: number;
    totalBytes?: number;
}

export interface CustomFormat {
    /** Human-readable label shown in the UI */
    displayName: string;
    /** Internal identifier, must start with `FFMPEG_` */
    internalName: string;
    /** Arguments passed to ffmpeg (excluding input/output file args) */
    ffmpegArgs: string[];
    /** Output filename used when calling ffmpeg */
    outputFilename: string;
    /** MIME type of the encoded output */
    outputMime: string;
    /** File extension of the encoded output */
    extension: string;
    /** Category label used for grouping in the UI (e.g. 'MP3', 'OGG', 'AAC') */
    category: string;
}

export const customFormats: CustomFormat[] = [
    {
        displayName: 'MP3 320kbps',
        internalName: 'FFMPEG_MP3_320',
        ffmpegArgs: ['-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100'],
        outputFilename: 'output.mp3',
        outputMime: 'audio/mpeg',
        extension: 'mp3',
        category: 'MP3',
    },
    {
        displayName: 'MP3 256kbps',
        internalName: 'FFMPEG_MP3_256',
        ffmpegArgs: ['-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '256k', '-ar', '44100'],
        outputFilename: 'output.mp3',
        outputMime: 'audio/mpeg',
        extension: 'mp3',
        category: 'MP3',
    },
    {
        displayName: 'MP3 128kbps',
        internalName: 'FFMPEG_MP3_128',
        ffmpegArgs: ['-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100'],
        outputFilename: 'output.mp3',
        outputMime: 'audio/mpeg',
        extension: 'mp3',
        category: 'MP3',
    },
    {
        displayName: 'OGG 320kbps',
        internalName: 'FFMPEG_OGG_320',
        ffmpegArgs: [
            '-map_metadata',
            '-1',
            '-c:a',
            'libvorbis',
            '-b:a',
            '320k',
            '-minrate',
            '320k',
            '-maxrate',
            '320k',
        ],
        outputFilename: 'output.ogg',
        outputMime: 'audio/ogg',
        extension: 'ogg',
        category: 'OGG',
    },
    {
        displayName: 'OGG 256kbps',
        internalName: 'FFMPEG_OGG_256',
        ffmpegArgs: [
            '-map_metadata',
            '-1',
            '-c:a',
            'libvorbis',
            '-b:a',
            '256k',
            '-minrate',
            '256k',
            '-maxrate',
            '256k',
        ],
        outputFilename: 'output.ogg',
        outputMime: 'audio/ogg',
        extension: 'ogg',
        category: 'OGG',
    },
    {
        displayName: 'OGG 128kbps',
        internalName: 'FFMPEG_OGG_128',
        ffmpegArgs: [
            '-map_metadata',
            '-1',
            '-c:a',
            'libvorbis',
            '-b:a',
            '128k',
            '-minrate',
            '128k',
            '-maxrate',
            '128k',
        ],
        outputFilename: 'output.ogg',
        outputMime: 'audio/ogg',
        extension: 'ogg',
        category: 'OGG',
    },
    {
        displayName: 'AAC 256kbps',
        internalName: 'FFMPEG_AAC_256',
        ffmpegArgs: ['-map_metadata', '-1', '-c:a', 'aac', '-b:a', '256k'],
        outputFilename: 'output.m4a',
        outputMime: 'audio/mp4',
        extension: 'm4a',
        category: 'AAC',
    },
];

/** Returns true if the quality string identifies a known custom ffmpeg-transcoded format */
export function isCustomFormat(quality: string): boolean {
    return getCustomFormat(quality) !== undefined;
}

/** Looks up a custom format by its internal name, or returns undefined */
export function getCustomFormat(internalName: string): CustomFormat | undefined {
    return customFormats.find((f) => f.internalName === internalName);
}

/**
 * Transcodes an audio blob using the specified custom format via ffmpeg.
 * Throws if ffmpeg fails during transcoding.
 */
export async function transcodeWithCustomFormat(
    audioBlob: Blob,
    format: CustomFormat,
    onProgress: ((progress: ProgressEvent) => void) | null = null,
    signal: AbortSignal | null = null
): Promise<Blob> {
    return ffmpeg(audioBlob, { args: format.ffmpegArgs }, format.outputFilename, format.outputMime, onProgress, signal);
}
