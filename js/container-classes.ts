export class BaseContainer<T extends object = object> {
    constructor(data: T) {
        Object.assign(this, data);
    }
}

export class ReplayGain extends BaseContainer {
    trackReplayGain: number;
    albumReplayGain: number;
    trackPeakAmplitude: number;
    albumPeakAmplitude: number;

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class Track extends BaseContainer {
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

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
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

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class MediaMetadata extends BaseContainer {
    tags: string[];

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class Artist extends BaseContainer {
    handle: unknown;
    id: number;
    name: string;
    picture: string;
    type: string;

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class EnrichedTrack extends Track {
    declare album: TrackAlbum | EnrichedAlbum;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents
    declare replayGain: any | ReplayGain;

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class TrackAlbum extends BaseContainer {
    cover: string;
    id: number;
    title: string;
    vibrantColor: string;
    videoCover?: string;

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
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

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class EnrichedAlbum extends Album {
    totalDiscs?: number;
    numberOfTracksOnDisc?: number;

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}

export class PreparedItem extends BaseContainer {
    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}
export class PreparedTrack extends PreparedItem {
    type: 'track';

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}
export class PreparedAlbum extends PreparedItem {
    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}
export class PreparedVideo extends PreparedItem {
    type: 'video';

    constructor(data: object) {
        super(data);
        Object.assign(this, data);
    }
}
