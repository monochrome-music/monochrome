export type TagLibWorkerMessageType = 'Add' | 'Get';

export interface TagLibWorkerMessage {
    type: TagLibWorkerMessageType;
    wasmUrl: string;
    audioData: Uint8Array;
}

export interface TagLibWorkerResponse<T> {
    type: TagLibWorkerMessageType;
    data?: T;
    error?: string;
}

export interface TagLibMetadata {
    title?: string;
    artist?: string;
    albumTitle?: string;
    albumArtist?: string;
    trackNumber?: number;
    totalTracks?: number;
    discNumber?: number;
    totalDiscs?: number;
    bpm?: number;
    replayGain?: {
        albumReplayGain?: string;
        albumPeakAmplitude?: number;
        trackReplayGain?: string;
        trackPeakAmplitude?: number;
    };
    cover?: {
        data: Uint8Array;
        type: string;
    };
    releaseDate?: string;
    copyright?: string;
    isrc?: string;
    explicit?: boolean;
    lyrics?: string;
}

export interface TagLibReadMetadata extends TagLibMetadata {
    duration: number;
}

export type TagLibFileResponse = TagLibWorkerResponse<Uint8Array>;
export type TagLibMetadataResponse = TagLibWorkerResponse<TagLibReadMetadata>;

export type AddMetadataMessage = TagLibWorkerMessage & {
    type: 'Add';
} & TagLibMetadata;

export type GetMetadataMessage = TagLibWorkerMessage & {
    type: 'Get';
};
