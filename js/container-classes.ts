export class ReplayGain {
    trackReplayGain: number;
    albumReplayGain: number;
    trackPeakAmplitude: number;
    albumPeakAmplitude: number;
}

export class Track {
    accessType: string;
    adSupportedStreamReady: boolean;
    album: TrackAlbum;
    allowStreaming: true;
    artist: Artist;
    artists: Artist[];
    audioModes: string[];
    audioQuality: string;
    bpm: number;
    copyright: string;
    djReady: boolean;
    duration: number;
    explicit: boolean;
    id: number;
    isrc: string;
    key: string;
    keyScale?: string;
    mediaMetadata: MediaMetadata;
    mixes: Record<string, string>;
    payToStream: boolean;
    peak: number;
    popularity: number;
    premiumStreamingOnly: boolean;
    replayGain: number;
    spotlighted: boolean;
    stemReady: boolean;
    streamStartDate: string;
    title: string;
    trackNumber: number;
    type?: string;
    upload: boolean;
    url: string;
    version?: string;
    volumeNumber: number;
}

export class PlaybackInfo extends ReplayGain {
    trackId: number;
    assetPresentation: string;
    audioMode: string;
    audioQuality: string;
    manifestMimeType: string;
    manifestHash: string;
    manifest: string;
    bitDepth: number;
    sampleRate: number;
}

export class MediaMetadata {
    tags: string[];
}

export class Artist {
    handle: unknown;
    id: number;
    name: string;
    picture: string;
    type: string;
}

export class EnrichedTrack extends Track {
    declare album: TrackAlbum | EnrichedAlbum;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents
    declare replayGain: any | ReplayGain;
}

export class TrackAlbum {
    cover: string;
    id: number;
    title: string;
    vibrantColor: string;
    videoCover?: string;
}

export class Album extends TrackAlbum {
    adSupportedStreamReady: boolean;
    allowStreaming: boolean;
    artist: Artist;
    artists: Artist[];
    audioModes: string[];
    audioQuality: string;
    copyright: string;
    djReady: boolean;
    duration: number;
    explicit: boolean;
    mediaMetadata: MediaMetadata;
    numberOfTracks: number;
    numberOfVideos: number;
    numberOfVolumes: number;
    popularity: number;
    premiumStreamingOnly: boolean;
    releaseDate?: string;
    stemReady: boolean;
    streamReady: boolean;
    streamStartDate: string;
    type: string;
    upc: string;
    upload: boolean;
    url: string;
    version?: string;
}

export class EnrichedAlbum extends Album {
    totalDiscs?: number;
    numberOfTracksOnDisc?: number;
}
