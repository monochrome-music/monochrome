import { ffmpeg } from './ffmpeg';
import { getExtensionFromBlob } from './utils';

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

/**
 * A container format definition for lossless re-muxing/re-encoding.
 * Extends CustomFormat with a callback that decides whether ffmpeg needs to run
 * at all (e.g. FLAC can skip if the source is already FLAC).
 */
export interface ContainerFormat extends Omit<CustomFormat, 'category'> {
    /**
     * Returns true when the source blob must be passed through ffmpeg to produce
     * the desired container.  Return false to skip the ffmpeg step (the caller
     * may still apply a lightweight metadata-strip pass instead).
     */
    needsTranscode: (blob: Blob) => Promise<boolean>;
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

/**
 * Container format definitions for lossless re-muxing.  Each entry describes
 * the ffmpeg arguments needed to produce that container and provides a
 * `needsTranscode` predicate so callers can skip the ffmpeg step when the
 * source is already in the correct container.
 */
export const containerFormats: ContainerFormat[] = [
    {
        displayName: 'FLAC',
        internalName: 'flac',
        ffmpegArgs: ['-vn', '-map_metadata', '-1', '-map', '0:a', '-c:a', 'flac'],
        outputFilename: 'output.flac',
        outputMime: 'audio/flac',
        extension: 'flac',
        // Only transcode when the source is NOT already a FLAC file.
        needsTranscode: async (blob) => (await getExtensionFromBlob(blob)) !== 'flac',
    },
    {
        displayName: 'Apple Lossless',
        internalName: 'alac',
        ffmpegArgs: ['-c:a', 'alac'],
        outputFilename: 'output.m4a',
        outputMime: 'audio/mp4',
        extension: 'm4a',
        needsTranscode: async () => true,
    },
    {
        displayName: "Don't change",
        internalName: 'nochange',
        ffmpegArgs: ['-c:a', 'copy', '-strict', '-2'],
        outputFilename: 'output.mp4',
        outputMime: 'audio/mp4',
        extension: 'mp4',
        needsTranscode: async (blob) => (await getExtensionFromBlob(blob)) == 'm4a',
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

/** Looks up a container format by its internal name, or returns undefined */
export function getContainerFormat(internalName: string): ContainerFormat | undefined {
    return containerFormats.find((f) => f.internalName === internalName);
}

/**
 * Transcodes an audio blob using the specified custom format via ffmpeg.
 * Throws if ffmpeg fails during transcoding.
 */
export async function transcodeWithCustomFormat(
    audioBlob: Blob,
    format: CustomFormat,
    onProgress: ((progress: ProgressEvent) => void) | null = null,
    signal: AbortSignal | null = null,
    extraFiles: any[] = []
): Promise<Blob> {
    return ffmpeg(
        audioBlob,
        { args: format.ffmpegArgs },
        format.outputFilename,
        format.outputMime,
        onProgress,
        signal,
        extraFiles
    );
}

/**
 * Re-muxes / re-encodes an audio blob into the specified container format via ffmpeg.
 * Throws if ffmpeg fails during transcoding.
 */
export async function transcodeWithContainerFormat(
    audioBlob: Blob,
    format: ContainerFormat,
    onProgress: ((progress: ProgressEvent) => void) | null = null,
    signal: AbortSignal | null = null,
    extraFiles: any[] = []
): Promise<Blob> {
    return ffmpeg(
        audioBlob,
        { args: format.ffmpegArgs },
        format.outputFilename,
        format.outputMime,
        onProgress,
        signal,
        extraFiles
    );
}
