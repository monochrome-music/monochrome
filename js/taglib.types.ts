import type { FileRef } from '!/@dantheman827/taglib-ts/src/fileRef';

export type TagLibWorkerMessageType = 'Add' | 'Get';

export interface TagLibWorkerMessage<T = Uint8Array> {
    type: TagLibWorkerMessageType;
    audioData: T;
    filename?: string;
}

export interface TagLibWorkerResponse<T> {
    type: TagLibWorkerMessageType;
    data?: T;
    error?: string;
}

export interface TagLibMetadata {
    title?: string;
    artist?: string | string[];
    writeArtistsSeparately?: boolean;
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
    upc?: string;
    stik?: Mp4Stik;
    extra?: Record<string, string>;
}

export enum Mp4Stik {
    HomeVideo = 0,
    Normal = 1,
    Audiobook = 2,
    WhackedBookmark = 5,
    MusicVideo = 6,
    Movie = 9,
    TVShow = 10,
    Booklet = 11,
}

export interface TagLibReadMetadata extends TagLibMetadata {
    duration: number;
}

export type TagLibFileResponse = TagLibWorkerResponse<Uint8Array>;
export type TagLibMetadataResponse = TagLibWorkerResponse<TagLibReadMetadata>;

export type AddMetadataMessage = TagLibWorkerMessage & {
    type: 'Add';
} & TagLibMetadata;

export type GetMetadataMessage = TagLibWorkerMessage<TagLibReadTypes> & {
    type: 'Get';
};

export type TagLibReadTypes = Uint8Array | Blob | File | FileSystemFileHandle | FileSystemFileEntry;
export type TagLibWriteTypes = Uint8Array;

export type _AddMetadataMessage = Omit<AddMetadataMessage, 'audioData' | 'type'> & {
    audioRef?: FileRef | null;
    audioData?: Uint8Array;
    returnType?: 'blob' | 'uint8array';
};
export type _GetMetadataMessage = Omit<GetMetadataMessage, 'audioData' | 'type'> & {
    audioRef?: FileRef | null;
    audioData?: TagLibReadTypes;
};
