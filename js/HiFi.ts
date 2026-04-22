import { EventEmitter } from 'events';
import type { PlaybackInfo } from './container-classes';

type Params = Record<string, string | number | undefined | null>;

class ResponseError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/**
 * A generic response interface that types the return value of `.json()` as `T`.
 *
 * Extends the standard `Response` interface with a typed `.json()` method so callers
 * can receive properly-typed data without manual casting.
 *
 * @typeParam T - The expected shape of the parsed JSON body.
 */
export interface TypedResponse<T> extends Response {
    /** Returns a promise that resolves with the response body parsed as JSON, typed as `T`. */
    json(): Promise<T>;
}

/**
 * A typed extension of the standard `Response` class returned by all TIDAL API methods.
 *
 * The generic type parameter `T` controls the type returned by `.json()`, enabling
 * full type safety on API responses without manual casts.
 *
 * @typeParam T - The expected JSON body type. Defaults to `unknown`.
 */
export class TidalResponse<T = unknown> extends Response implements TypedResponse<T> {
    /** Returns a promise that resolves with the response body parsed as JSON, typed as `T`. */
    declare json: () => Promise<T>;

    constructor(response: Response);
    constructor(body: BodyInit, init?: ResponseInit);
    constructor(body: BodyInit | Response, init?: ResponseInit) {
        if (body instanceof Response) {
            super(body.body, {
                headers: body.headers,
                status: body.status,
                statusText: body.statusText,
            });
        } else {
            super(body, init);
        }
    }
}

// ─── Route response interfaces ───────────────────────────────────────────────

/**
 * Base interface shared by all versioned TIDAL API responses.
 * Every response envelope includes a `version` string matching {@link HiFiClient.API_VERSION}.
 */
export interface VersionedResponse {
    /** The API version string, e.g. `"2.7"`. */
    version: string;
}

// ─── Shared sub-types (derived from live API samples) ────────────────────────

/**
 * Minimal artist reference as it appears inside track and album objects.
 * For the full artist profile returned by the `/artist` route, see {@link TidalArtistProfile}.
 */
export interface TidalArtistRef {
    /** Numeric TIDAL artist ID. */
    id: number;
    /** Artist display name. */
    name: string;
    /** TIDAL handle, or `null` if not set. */
    handle: string | null;
    /** Artist role in this context, e.g. `"MAIN"`. */
    type: string;
    /** Picture UUID, or `null` if no image is available. */
    picture: string | null;
}

/**
 * A single artist-role entry as returned inside {@link TidalArtistProfile}.
 */
export interface TidalArtistRole {
    /** Internal category identifier (`-1` for the primary artist role). */
    categoryId: number;
    /** Human-readable role label, e.g. `"Artist"`, `"Producer"`. */
    category: string;
}

/**
 * Full artist profile as returned by the `/artist/?id=` route.
 * Contains fields not present on the minimal {@link TidalArtistRef} seen inside tracks/albums.
 */
export interface TidalArtistProfile {
    /** Numeric TIDAL artist ID. */
    id: number;
    /** Artist display name. */
    name: string;
    /** Roles this artist holds on TIDAL, e.g. `["ARTIST", "CONTRIBUTOR"]`. */
    artistTypes: string[];
    /** Canonical TIDAL artist URL. */
    url: string;
    /** Picture UUID, or `null` if no image is available. */
    picture: string | null;
    /** Fallback album cover UUID used when no artist picture exists, or `null`. */
    selectedAlbumCoverFallback: string | null;
    /** Popularity score (0-100). */
    popularity: number;
    /** List of credited roles for this artist. */
    artistRoles: TidalArtistRole[];
    /** Map of mix type → mix ID, e.g. `{ "ARTIST_MIX": "000ff..." }`. */
    mixes: Record<string, string>;
    /** TIDAL handle, or `null` if not set. */
    handle: string | null;
    /** Associated TIDAL user ID, or `null`. */
    userId: number | null;
    /** Whether the artist is currently spotlighted. */
    spotlighted: boolean;
}

/**
 * Media metadata object attached to tracks and albums.
 */
export interface TidalMediaMetadata {
    /** Quality tags, e.g. `["LOSSLESS"]`, `["HIRES_LOSSLESS"]`. */
    tags: string[];
}

/**
 * Slim album reference embedded inside a track object.
 */
export interface TidalTrackAlbumRef {
    /** Numeric TIDAL album ID. */
    id: number;
    /** Album title. */
    title: string;
    /** Cover image UUID. */
    cover: string;
    /** Vibrant accent colour hex string derived from the cover art. */
    vibrantColor: string;
    /** Video cover UUID, or `null`. */
    videoCover: string | null;
}

/**
 * Full track object as returned by the `/info` route and embedded in albums, playlists, and mixes.
 *
 * @remarks
 * Fields `bpm`, `key`, and `keyScale` are nullable - they are absent for some tracks.
 * `version` is present in the payload but may be `null`.
 */
export interface TidalTrack {
    /** Numeric TIDAL track ID. */
    id: number;
    /** Track title. */
    title: string;
    /** Duration in seconds. */
    duration: number;
    /** Track replay-gain value in dB. */
    replayGain: number;
    /** Track peak amplitude (0-1). */
    peak: number;
    /** Whether the track is available for streaming. */
    allowStreaming: boolean;
    /** Whether the stream is ready. */
    streamReady: boolean;
    /** Whether the track requires payment to stream. */
    payToStream: boolean;
    /** Whether the track is available for ad-supported streaming. */
    adSupportedStreamReady: boolean;
    /** Whether the track is available for DJ use. */
    djReady: boolean;
    /** Whether stem files are available. */
    stemReady: boolean;
    /** ISO-8601 timestamp from which the stream became available. */
    streamStartDate: string;
    /** Whether a premium subscription is required. */
    premiumStreamingOnly: boolean;
    /** Track number within its volume. */
    trackNumber: number;
    /** Disc/volume number. */
    volumeNumber: number;
    /** Version suffix (e.g. `"Remastered"`), or `null`. */
    version: string | null;
    /** Popularity score (0-100). */
    popularity: number;
    /** Copyright notice. */
    copyright: string;
    /** Beats per minute, or `null` if unavailable. */
    bpm: number | null;
    /** Musical key (e.g. `"Bb"`), or `null` if unavailable. */
    key: string | null;
    /** Key scale (`"MAJOR"` / `"MINOR"`), or `null` if unavailable. */
    keyScale: string | null;
    /** Canonical TIDAL track URL. */
    url: string;
    /** International Standard Recording Code. */
    isrc: string;
    /** Whether the track metadata can be edited. */
    editable: boolean;
    /** Whether the track contains explicit content. */
    explicit: boolean;
    /** Highest available audio quality, e.g. `"LOSSLESS"`, `"HI_RES_LOSSLESS"`. */
    audioQuality: string;
    /** Available audio modes, e.g. `["STEREO"]`. */
    audioModes: string[];
    /** Media metadata including quality tags. */
    mediaMetadata: TidalMediaMetadata;
    /** Whether this is a user-uploaded track. */
    upload: boolean;
    /** Access type, e.g. `"PUBLIC"`. */
    accessType: string;
    /** Whether the track is currently spotlighted. */
    spotlighted: boolean;
    /** Primary artist. */
    artist: TidalArtistRef;
    /** All credited artists. */
    artists: TidalArtistRef[];
    /** Album this track belongs to. */
    album: TidalTrackAlbumRef;
    /** Map of mix type → mix ID, e.g. `{ "TRACK_MIX": "001e91..." }`. */
    mixes: Record<string, string>;
}

/**
 * A track as it appears inside a playlist, extending {@link TidalTrack} with
 * playlist-specific fields added by the TIDAL API.
 */
export interface TidalPlaylistTrack extends TidalTrack {
    /** Track description text, or `null`. */
    description: string | null;
    /** ISO-8601 timestamp when this track was added to the playlist. */
    dateAdded: string;
    /** Position index within the playlist. */
    index: number;
    /** Unique item UUID within the playlist. */
    itemUuid: string;
}

/**
 * Full album object as returned by the `/artist/?f=` discography route and
 * embedded in search results.
 *
 * @remarks
 * `artist` is present in discography responses but absent in some search results;
 * it is therefore typed as optional.
 * `version` and `videoCover` are present in the payload but may be `null`.
 */
export interface TidalAlbum {
    /** Numeric TIDAL album ID. */
    id: number;
    /** Album title. */
    title: string;
    /** Total duration in seconds. */
    duration: number;
    /** Whether the stream is ready. */
    streamReady: boolean;
    /** Whether the album requires payment to stream. */
    payToStream: boolean;
    /** Whether the album is available for ad-supported streaming. */
    adSupportedStreamReady: boolean;
    /** Whether the album is available for DJ use. */
    djReady: boolean;
    /** Whether stem files are available. */
    stemReady: boolean;
    /** ISO-8601 timestamp from which the stream became available. */
    streamStartDate: string;
    /** Whether streaming is allowed. */
    allowStreaming: boolean;
    /** Whether a premium subscription is required. */
    premiumStreamingOnly: boolean;
    /** Number of tracks on the album. */
    numberOfTracks: number;
    /** Number of videos on the album. */
    numberOfVideos: number;
    /** Number of discs/volumes. */
    numberOfVolumes: number;
    /** Release date string, e.g. `"2025-02-14"`. */
    releaseDate: string;
    /** Copyright notice. */
    copyright: string;
    /** Release type, e.g. `"ALBUM"`, `"EP"`, `"SINGLE"`. */
    type: string;
    /** Version suffix, or `null`. */
    version: string | null;
    /** Canonical TIDAL album URL. */
    url: string;
    /** Cover image UUID. */
    cover: string;
    /** Vibrant accent colour hex string. */
    vibrantColor: string;
    /** Video cover UUID, or `null`. */
    videoCover: string | null;
    /** Whether the album contains explicit content. */
    explicit: boolean;
    /** UPC barcode. */
    upc: string;
    /** Popularity score (0-100). */
    popularity: number;
    /** Highest available audio quality. */
    audioQuality: string;
    /** Available audio modes. */
    audioModes: string[];
    /** Media metadata including quality tags. */
    mediaMetadata: TidalMediaMetadata;
    /** Whether this is a user-uploaded album. */
    upload: boolean;
    /** Primary artist (present in discography responses; absent in some search results). */
    artist?: TidalArtistRef;
    /** All credited artists. */
    artists: TidalArtistRef[];
}

/**
 * A video item as returned inside search results and the topvideos page modules.
 */
export interface TidalVideoItem {
    /** Numeric TIDAL video ID. */
    id: number;
    /** Video title. */
    title: string;
    /** Duration in seconds. */
    duration: number;
    /** Version suffix, or `null`. */
    version: string | null;
    /** Canonical TIDAL video URL. */
    url: string;
    /** All credited artists. */
    artists: TidalArtistRef[];
    /** Associated album, or `null`. */
    album: TidalTrackAlbumRef | null;
    /** Whether the video contains explicit content. */
    explicit: boolean;
    /** Disc/volume number. */
    volumeNumber: number;
    /** Track number on the disc. */
    trackNumber: number;
    /** Popularity score (0-100). */
    popularity: number;
    /** Double-precision popularity score (present in topvideos). */
    doublePopularity?: number;
    /** Whether streaming is allowed. */
    allowStreaming: boolean;
    /** Whether the stream is ready. */
    streamReady: boolean;
    /** ISO-8601 timestamp from which streaming became available. */
    streamStartDate: string;
    /** Whether the video is available for ad-supported streaming. */
    adSupportedStreamReady: boolean;
    /** Whether the video is available for DJ use. */
    djReady: boolean;
    /** Whether stem files are available. */
    stemReady: boolean;
    /** Thumbnail image UUID. */
    imageId: string;
    /** Image path (present in some search results), or `null`. */
    imagePath?: string | null;
    /** Vibrant accent colour hex string. */
    vibrantColor: string;
    /** Release date string. */
    releaseDate: string;
    /** Content type, e.g. `"Music Video"`. */
    type: string;
    /** Ad tag URL, or `null`. */
    adsUrl: string | null;
    /** Whether ads are pre-paywall only. */
    adsPrePaywallOnly: boolean;
    /** Playback quality label (present in some search results), e.g. `"MP4_1080P"`. */
    quality?: string;
}

/**
 * A page module object as returned inside {@link TopVideosResponse.videos}.
 *
 * @remarks
 * The `/topvideos` route processes a TIDAL pages API response. When the page
 * contains `VIDEO_LIST`-type modules (which do not match the `VIDEO_PLAYLIST` /
 * `VIDEO_ROW` / `PAGED_LIST` extraction path) the entire module object is pushed
 * into the output array. The actual video items are nested inside `pagedList.items`.
 */
export interface TidalVideoPageModule {
    /** Base-64 encoded module identifier. */
    id: string;
    /** Module type, e.g. `"VIDEO_LIST"`. */
    type: string;
    /** Column width percentage. */
    width: number;
    /** Scroll direction, e.g. `"VERTICAL"`. */
    scroll: string;
    /** Module title. */
    title: string;
    /** Module description. */
    description: string;
    /** "Show more" link data, or `null`. */
    showMore: string | null;
    /** Paged list of video items. */
    pagedList: {
        /** Internal API path for paged data. */
        dataApiPath: string;
        /** Page size. */
        limit: number;
        /** Current offset. */
        offset: number;
        /** Total number of items available. */
        totalNumberOfItems: number;
        /** Video items on this page. */
        items: TidalVideoItem[];
    };
    /** Whether the module supports paging. */
    supportsPaging: boolean;
    /** Whether to show table headers. */
    showTableHeaders: boolean;
    /** List display format. */
    listFormat: string;
    /** Layout hint, or `null`. */
    layout: string | null;
    /** Whether quick-play is enabled. */
    quickPlay: boolean;
    /** Pre-title label, or `null`. */
    preTitle: string | null;
}

/**
 * A similar album entry as returned by the TIDAL OpenAPI `/album/similar` endpoint.
 *
 * @remarks
 * This shape differs substantially from a standard {@link TidalAlbum}: `duration` is an
 * ISO 8601 duration string (e.g. `"PT1H14M30S"`), `copyright` is an object, and several
 * fields (`barcodeId`, `mediaTags`, `availability`, `albumType`) have no equivalent in the
 * standard album object.
 */
export interface TidalSimilarAlbum {
    /** Numeric TIDAL album ID. */
    id: number;
    /** Album title. */
    title: string;
    /** UPC/EAN barcode identifier. */
    barcodeId: string;
    /** Number of discs/volumes. */
    numberOfVolumes: number;
    /** Total number of tracks (called `numberOfItems` in this endpoint). */
    numberOfItems: number;
    /** ISO 8601 duration string, e.g. `"PT1H14M30S"`. */
    duration: string;
    /** Whether the album contains explicit content. */
    explicit: boolean;
    /** Release date string, e.g. `"2015-10-09"`. */
    releaseDate: string;
    /** Copyright information. */
    copyright: { text: string };
    /** Popularity score (0-1 float). */
    popularity: number;
    /** Access type, e.g. `"PUBLIC"`. */
    accessType: string;
    /** Availability modes, e.g. `["STREAM", "DJ"]`. */
    availability: string[];
    /** Quality tags, e.g. `["LOSSLESS", "HIRES_LOSSLESS"]`. */
    mediaTags: string[];
    /** External link entries (e.g. TIDAL sharing URL). */
    externalLinks: Array<{ href: string; meta: { type: string } }>;
    /** Release type, e.g. `"ALBUM"`. */
    type: string;
    /** Album type classification, e.g. `"ALBUM"`. */
    albumType: string;
    /** ISO-8601 creation timestamp (present for some albums). */
    createdAt?: string;
    /** Cover image UUID. */
    cover: string;
    /** Abbreviated artist list for this album. */
    artists: Array<{ id: number; name: string }>;
    /** Canonical TIDAL album URL. */
    url: string;
}

// ─── Response interfaces ──────────────────────────────────────────────────────

/**
 * Response returned by the root `/` route.
 * Contains a link to the upstream HiFi API repository.
 */
export interface RootResponse extends VersionedResponse {
    /** URL of the upstream HiFi API repository. */
    Repo: string;
}

/**
 * Response returned by the `/info` route.
 * Contains full TIDAL track metadata.
 */
export interface InfoResponse extends VersionedResponse {
    /** Full metadata for the requested track. */
    data: TidalTrack;
}

/**
 * Response returned by the `/track` route.
 * Contains playback/stream information for a track.
 *
 * @remarks `data` is typed as {@link PlaybackInfo} from `container-classes`, whose
 * fields match the live API sample exactly.
 */
export interface TrackResponse extends VersionedResponse {
    /** Playback info including manifest, quality, and replay-gain data. */
    data: PlaybackInfo;
}

/**
 * Response returned by the `/recommendations` route.
 * Contains a paginated list of recommended tracks for a given track ID.
 *
 * @remarks No live API sample is available for this route.
 */
export interface RecommendationsResponse extends VersionedResponse {
    /** Raw TIDAL v1 recommendations payload. */
    data: unknown;
}

/**
 * A similar-artist entry as returned by the TIDAL OpenAPI `/artist/similar` endpoint.
 */
export interface SimilarArtist {
    /** Numeric TIDAL artist ID. */
    id: number;
    /** Artist display name. */
    name: string;
    /** Picture UUID, or `null` if no image is available. */
    picture: string | null;
    /** Canonical TIDAL artist URL. */
    url: string;
    /** Relation type, e.g. `"SIMILAR_ARTIST"`. */
    relationType: string;
    /** Popularity score (0-1 float). */
    popularity: number;
    /** External link entries (e.g. TIDAL sharing URL). */
    externalLinks: Array<{ href: string; meta: { type: string } }>;
    /** Whether the artist is spotlighted. */
    spotlighted: boolean;
    /** Whether artist contributions are enabled. */
    contributionsEnabled: boolean;
}

/**
 * Response returned by the `/artist/similar` route.
 * Contains a list of artists similar to the requested artist.
 */
export interface SimilarArtistsResponse extends VersionedResponse {
    /** List of similar artists. */
    artists: SimilarArtist[];
}

/**
 * Response returned by the `/album/similar` route.
 * Contains a list of albums similar to the requested album.
 */
export interface SimilarAlbumsResponse extends VersionedResponse {
    /** List of similar albums. */
    albums: TidalSimilarAlbum[];
}

/**
 * Artist cover image URL at 750 px resolution.
 * Returned inside {@link ArtistByIdResponse}.
 */
export interface ArtistCover {
    /** The TIDAL artist ID. */
    id: number;
    /** The artist display name. */
    name: string;
    /** 750×750 JPEG cover URL. */
    '750': string;
}

/**
 * Response returned by the `/artist` route when an `id` query parameter is supplied.
 * Contains the artist's full profile and optional cover image URL.
 */
export interface ArtistByIdResponse extends VersionedResponse {
    /** Full TIDAL artist profile data. */
    artist: TidalArtistProfile;
    /** Cover image URL at 750 px, or `null` if no picture is available. */
    cover: ArtistCover | null;
}

/**
 * Response returned by the `/artist` route when an `f` query parameter is supplied.
 * Contains the artist's discography and, when `skip_tracks` is false, their top tracks.
 */
export interface ArtistDiscographyResponse extends VersionedResponse {
    /** Paginated album list for the artist. */
    albums: { items: TidalAlbum[] };
    /**
     * Top tracks for the artist across all albums.
     * Absent when the request includes `skip_tracks=true`.
     */
    tracks?: TidalTrack[];
}

/**
 * Union of the two possible response shapes from the `/artist` route.
 * Use {@link ArtistByIdResponse} (has `artist`) when querying by `id`,
 * or {@link ArtistDiscographyResponse} (has `albums`) when querying by `f`.
 */
export type ArtistResponse = ArtistByIdResponse | ArtistDiscographyResponse;

/**
 * Artist biography as returned by the TIDAL API.
 */
export interface ArtistBiography {
    /** Provider or publication source of the biography text, e.g. `"TiVo"`. */
    source: string;
    /** ISO-8601 timestamp of the last biography update. */
    lastUpdated: string;
    /** Full biography text. */
    text: string;
    /** Short biography summary (may be an empty string). */
    summary: string;
}

/**
 * Response returned by the `/artist/bio` route.
 * Contains the biography text for the requested artist.
 */
export interface ArtistBioResponse extends VersionedResponse {
    /** Biography data for the requested artist. */
    data: ArtistBiography;
}

/**
 * A single cover-image entry with pre-built URLs at multiple resolutions.
 * Returned inside {@link CoverResponse}.
 */
export interface CoverEntry {
    /** The TIDAL track or album ID associated with this cover. */
    id: number;
    /** The track or album title associated with this cover. */
    name: string;
    /** 1280×1280 JPEG cover URL. */
    '1280': string;
    /** 640×640 JPEG cover URL. */
    '640': string;
    /** 80×80 JPEG cover URL. */
    '80': string;
}

/**
 * Response returned by the `/cover` route.
 * Contains one or more cover-image entries matching the query.
 */
export interface CoverResponse extends VersionedResponse {
    /** Resolved cover image entries. */
    covers: CoverEntry[];
}

/**
 * A paginated result bucket as returned inside {@link SearchResponse.data}.
 */
export interface TidalSearchBucket<T> {
    /** Maximum number of items per page. */
    limit: number;
    /** Current page offset. */
    offset: number;
    /** Total number of matching items. */
    totalNumberOfItems: number;
    /** Items on this page. */
    items: T[];
}

/**
 * Response returned by the `/search` route.
 *
 * @remarks
 * Two distinct query formats exist:
 * - `?q=` (general search): returns `topHit` and combined buckets for artists, albums, tracks, videos, playlists.
 * - `?v=` (video-focused search): returns `topHits` (plural), `genres`, and the same buckets.
 */
export interface SearchResponse extends VersionedResponse {
    /** Combined search result buckets. */
    data: {
        /** Matching artist results. */
        artists?: TidalSearchBucket<TidalArtistProfile>;
        /** Matching album results. */
        albums?: TidalSearchBucket<TidalAlbum>;
        /** Matching track results. */
        tracks?: TidalSearchBucket<TidalTrack>;
        /** Matching video results. */
        videos?: TidalSearchBucket<TidalVideoItem>;
        /** Matching playlist results. */
        playlists?: TidalSearchBucket<TidalPlaylist>;
        /** Genre results (present for `?v=` video searches). */
        genres?: TidalSearchBucket<TidalGenre>;
        /** Single top-hit result (present for `?q=` general searches). */
        topHit?: { value: TidalTrack | TidalArtistProfile | TidalAlbum | TidalVideoItem; type: string };
        /** Multiple top-hit results (present for `?v=` video searches). */
        topHits?: Array<TidalTrack | TidalArtistProfile | TidalAlbum | TidalVideoItem>;
    };
}

/**
 * An album with its full track listing, as returned by the `/album` route.
 *
 * @remarks
 * Each element of `items` wraps the track in an envelope `{ item, type }`.
 */
export interface TidalAlbumWithTracks extends TidalAlbum {
    /** Ordered list of track envelopes. */
    items: Array<{ item: TidalTrack; type: string }>;
}

/**
 * Response returned by the `/album` route.
 * Contains album metadata together with its full track listing.
 */
export interface AlbumResponse extends VersionedResponse {
    /** Album data including all tracks as `items`. */
    data: TidalAlbumWithTracks;
}

/**
 * A promoted artist entry as it appears inside {@link TidalPlaylist}.
 */
export interface TidalPromotedArtist {
    /** Numeric TIDAL artist ID. */
    id: number;
    /** Artist display name. */
    name: string;
    /** TIDAL handle, or `null`. */
    handle: string | null;
    /** Artist role, e.g. `"MAIN"`. */
    type: string;
    /** Picture UUID, or `null`. */
    picture: string | null;
}

/**
 * A TIDAL playlist as returned by the `/playlist` route.
 */
export interface TidalPlaylist {
    /** Unique playlist UUID. */
    uuid: string;
    /** Playlist display title. */
    title: string;
    /** Total number of tracks in the playlist. */
    numberOfTracks: number;
    /** Total number of videos in the playlist. */
    numberOfVideos: number;
    /** Playlist creator. */
    creator: { id: number };
    /** Playlist description text. */
    description: string;
    /** Total playlist duration in seconds. */
    duration: number;
    /** ISO-8601 timestamp of the last update. */
    lastUpdated: string;
    /** ISO-8601 creation timestamp. */
    created: string;
    /** Playlist type, e.g. `"EDITORIAL"`. */
    type: string;
    /** Whether the playlist is publicly accessible. */
    publicPlaylist: boolean;
    /** Canonical TIDAL URL for this playlist. */
    url: string;
    /** Rectangular cover image UUID. */
    image: string;
    /** Playlist popularity score. */
    popularity: number;
    /** Square cover image UUID, or `undefined` if not set. */
    squareImage?: string;
    /** Custom image URL override, or `null`. */
    customImageUrl: string | null;
    /** Artists featured/promoted in the playlist header. */
    promotedArtists: TidalPromotedArtist[];
    /** ISO-8601 timestamp when the most recent item was added. */
    lastItemAddedAt: string;
}

/**
 * A single item in a TIDAL playlist.
 */
export interface PlaylistItem {
    /** The track object, augmented with playlist-specific fields. */
    item: TidalPlaylistTrack;
    /** Item type string, e.g. `"track"`. */
    type: string;
    /** Cut data associated with the item, or `null`. */
    cut: string | null;
}

/**
 * Response returned by the `/playlist` route.
 * Contains the playlist metadata and its item list.
 */
export interface PlaylistResponse extends VersionedResponse {
    /** Playlist metadata. */
    playlist: TidalPlaylist;
    /** Ordered list of playlist items. */
    items: PlaylistItem[];
}

/**
 * A TIDAL mix header as parsed from a `/pages/mix` response.
 *
 * @remarks No live API sample is available for this route.
 */
export interface Mix {
    /** Mix identifier. */
    id: string;
    /** Mix display title. */
    title: string;
    /** Optional mix subtitle. */
    subTitle?: string;
}

/**
 * Response returned by the `/mix` route.
 * Contains the mix header and its constituent tracks.
 *
 * @remarks No live API sample is available for this route; the shape is inferred
 * from the TIDAL pages API structure.
 */
export interface MixResponse extends VersionedResponse {
    /** Mix metadata. */
    mix: unknown;
    /** Ordered list of tracks in this mix. */
    items: TidalTrack[];
}

/**
 * Lyrics data as returned by the TIDAL API.
 *
 * @remarks No live API sample is available for this route.
 */
export interface Lyrics {
    /** The TIDAL track ID these lyrics belong to. */
    trackId: number;
    /** Name of the lyrics provider. */
    lyricsProvider: string;
    /** Provider's common-track identifier. */
    providerCommontrackId: string;
    /** Provider's lyrics-specific identifier. */
    providerLyricsId: string;
    /** Full unsynced lyrics text. */
    lyrics: string;
    /** Time-synced subtitle text (LRC format). */
    subtitles: string;
    /** Whether the lyrics text reads right-to-left. */
    isRightToLeft: boolean;
}

/**
 * Response returned by the `/lyrics` route.
 * Contains the lyrics data for the requested track.
 *
 * @remarks No live API sample is available for this route.
 */
export interface LyricsResponse extends VersionedResponse {
    /** Lyrics data for the requested track. */
    lyrics: unknown;
}

/**
 * Video playback info as returned by the TIDAL API for the `/video` route.
 */
export interface VideoPlaybackInfo {
    /** The TIDAL video ID. */
    videoId: number;
    /** Stream type, e.g. `"ON_DEMAND"`. */
    streamType: string;
    /** Asset presentation type, e.g. `"FULL"`. */
    assetPresentation: string;
    /** Requested video quality, e.g. `"HIGH"`. */
    videoQuality: string;
    /** MIME type of the manifest, e.g. `"application/vnd.tidal.emu"`. */
    manifestMimeType: string;
    /** Hash of the manifest content. */
    manifestHash: string;
    /** Base-64 encoded manifest. */
    manifest: string;
}

/**
 * Response returned by the `/video` route.
 * Contains playback information for the requested video.
 */
export interface VideoResponse extends VersionedResponse {
    /** Video playback info. */
    video: VideoPlaybackInfo;
}

/**
 * Response returned by the `/topvideos` route.
 *
 * @remarks
 * The `videos` array contains the video items extracted from the page modules'
 * `pagedList.items` arrays. Individual video objects matching {@link TidalVideoItem}
 * are pushed into this array at runtime.
 */
export interface TopVideosResponse extends VersionedResponse {
    /** Video items extracted from the page modules. */
    videos: TidalVideoItem[];
    /** Total number of video items before pagination. */
    total: number;
}

/**
 * Audio normalisation data embedded in a track manifest attributes object.
 */
export interface TidalAudioNormData {
    /** Replay gain value in dB. */
    replayGain: number;
    /** Peak amplitude (0-1). */
    peakAmplitude: number;
}

/**
 * DRM licence data embedded in a track manifest attributes object.
 */
export interface DrmData {
    /** DRM system identifier, e.g. `"WIDEVINE"`. */
    drmSystem: string;
    /** Licence acquisition URL. */
    licenseUrl: string;
    /** Certificate URL. */
    certificateUrl: string;
    /** DRM initialisation data, or `null`. */
    initData: string | null;
}

/**
 * Attributes of a single track-manifest resource from the TIDAL OpenAPI.
 *
 * @remarks
 * The `uri` field contains the signed manifest URL (rather than an inline Base-64
 * `manifest` string). `previewReason` is only present for preview-only tracks.
 */
export interface TrackManifestAttributes {
    /** Presentation tier, e.g. `"PREVIEW"` or `"FULL"`. */
    trackPresentation: string;
    /** Reason the track is restricted to a preview (only present when `trackPresentation` is `"PREVIEW"`). */
    previewReason?: string;
    /** Signed manifest URI. */
    uri: string;
    /** Hash of the manifest content. */
    hash: string;
    /** Playback formats included in this manifest, e.g. `["HEAACV1", "AACLC", "FLAC"]`. */
    formats: string[];
    /** Album-level audio normalisation data. */
    albumAudioNormalizationData: TidalAudioNormData;
    /** Track-level audio normalisation data. */
    trackAudioNormalizationData: TidalAudioNormData;
    /** DRM data (only present when the track is DRM-protected). */
    drmData?: DrmData;
}

/**
 * A single `trackManifests` resource object from the TIDAL OpenAPI (JSON:API format).
 */
export interface TrackManifestResource {
    /** Resource identifier (track ID as a string). */
    id: string;
    /** JSON:API resource type - always `"trackManifests"`. */
    type: string;
    /** Manifest attributes. */
    attributes: TrackManifestAttributes;
}

/**
 * The raw JSON:API response envelope returned by the TIDAL OpenAPI track-manifest endpoint.
 */
export interface TrackManifestApiResponse {
    /** The primary track-manifest resource. */
    data: TrackManifestResource;
    /** JSON:API links object. */
    links: { self: string };
}

/**
 * Response returned by the `/trackManifests` route.
 * Wraps the raw JSON:API track-manifest response from the TIDAL OpenAPI.
 */
export interface TrackManifestResponse extends VersionedResponse {
    /** The full JSON:API response object from the TIDAL OpenAPI. */
    data: TrackManifestApiResponse;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A genre entry as returned inside `?v=` video search results.
 */
export interface TidalGenre {
    /** Genre identifier. */
    id: string;
    /** Genre display name. */
    name: string;
}

// ─── Private implementation types ────────────────────────────────────────────

/** A JSON:API reference item (id + type only), used in similar-artist/album payloads. */
type JsonApiRef = { id: string; type: string };

/** Attribute fields present in TIDAL OpenAPI included resources for similar-artist/album endpoints. */
interface JsonApiIncludeAttributes {
    name?: string;
    popularity?: number;
    externalLinks?: Array<{ href: string; meta: { type: string } }>;
    spotlighted?: boolean;
    contributionsEnabled?: boolean;
    selectedAlbumCoverFallback?: string | null;
    files?: Array<{ href: string }>;
    title?: string;
    barcodeId?: string;
    numberOfVolumes?: number;
    numberOfItems?: number;
    duration?: string;
    explicit?: boolean;
    releaseDate?: string;
    copyright?: { text: string };
    accessType?: string;
    availability?: string[];
    mediaTags?: string[];
    albumType?: string;
    createdAt?: string;
    type?: string;
}

/** An included resource node from a TIDAL OpenAPI JSON:API response. */
interface JsonApiInclude {
    id: string;
    type: string;
    attributes: JsonApiIncludeAttributes;
    relationships?: Record<string, { data?: JsonApiRef[] }>;
}

/** A TIDAL OpenAPI JSON:API list response (similar-artists/albums). */
interface JsonApiListResponse {
    data?: JsonApiRef[];
    included?: JsonApiInclude[];
}

/** A generic paginated list response from TIDAL v1 endpoints. */
interface TidalListResponse<T> {
    items?: T[];
    totalNumberOfItems?: number;
}

/** A module within a TIDAL pages API row. */
interface TidalPageModule {
    type: string;
    mix?: Mix;
    item?: TidalVideoItem;
    pagedList?: { items: Array<{ item?: TidalTrack | TidalVideoItem }> };
}

/** A row within a TIDAL pages API response. */
interface TidalPageRow {
    modules?: TidalPageModule[];
}

/** Response shape from TIDAL v1 pages endpoints (mix, top videos, album pages). */
interface TidalPagesApiResponse {
    rows?: TidalPageRow[];
}

/** Type guard: returns true if the given page-module item is a {@link TidalTrack}. */
function isTidalTrack(v: TidalTrack | TidalVideoItem | { item?: TidalTrack | TidalVideoItem }): v is TidalTrack {
    return 'trackNumber' in v;
}

/** Type guard: returns true if the given page-module item is a {@link TidalVideoItem}. */
function isTidalVideoItem(
    v: TidalTrack | TidalVideoItem | { item?: TidalTrack | TidalVideoItem }
): v is TidalVideoItem {
    return 'imageId' in v;
}

export enum HiFiClientEvents {
    TokenUpdate,
    TokenExpiryUpdate,
    RefreshTokenUpdate,
}

class HiFiClient {
    static readonly API_VERSION = '2.7';
    static readonly BROWSER_CLIENT_ID = 'txNoH4kkV41MfH25';
    static readonly BROWSER_CLIENT_SECRET = 'dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=';

    static #instance: HiFiClient | null = null;
    static get instance() {
        if (!HiFiClient.#instance) {
            throw new Error('HiFiClient is not initialized. Call HiFiClient.initialize(options) first.');
        }
        return HiFiClient.#instance;
    }

    /**
     * The base URL to use for adjusting widevine license URLs.
     */
    #baseUrl: string | null = null;
    #token: string | null = null;
    #refreshToken: string | null = null;
    #appTokenExpiry = 0;
    #tokenPromise: Promise<string | null> | null = null;
    #albumTracksActive = 0;
    readonly #albumTracksMax = 20;
    readonly #albumTracksQueue: Array<() => void> = [];
    readonly #countryCode: string;
    readonly #locale: string;
    readonly #clientId: string;
    readonly #clientSecret: string;
    readonly #emitter = new EventEmitter();

    on(event: HiFiClientEvents.TokenUpdate, listener: (token: string | null) => void): void;
    on(event: HiFiClientEvents.TokenExpiryUpdate, listener: (expiry: number) => void): void;
    on(event: HiFiClientEvents.RefreshTokenUpdate, listener: (refreshToken: string | null) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: HiFiClientEvents, listener: (...args: any[]) => void) {
        this.#emitter.addListener(HiFiClientEvents[event], listener);
    }

    off(event: HiFiClientEvents, listener: (...args: (string | number | null)[]) => void) {
        this.#emitter.removeListener(HiFiClientEvents[event], listener);
    }

    #emit(event: HiFiClientEvents.TokenUpdate, token: string | null): void;
    #emit(event: HiFiClientEvents.TokenExpiryUpdate, expiry: number): void;
    #emit(event: HiFiClientEvents.RefreshTokenUpdate, refreshToken: string | null): void;
    #emit(event: HiFiClientEvents, data: string | number | null) {
        this.#emitter.emit(HiFiClientEvents[event], data);
    }

    get token(): string | null {
        return this.#token;
    }

    private set token(value: string | null) {
        this.#emit(HiFiClientEvents.TokenUpdate, (this.#token = value || null));
    }

    get refreshToken(): string | null {
        return this.#refreshToken || null;
    }

    private set refreshToken(value: string | null) {
        this.#emit(HiFiClientEvents.RefreshTokenUpdate, (this.#refreshToken = value || null));
    }

    get appTokenExpiry() {
        return this.#appTokenExpiry;
    }

    private set appTokenExpiry(value: number) {
        this.#emit(HiFiClientEvents.TokenExpiryUpdate, (this.#appTokenExpiry = value));

        if (value >= 0 && value < Date.now()) {
            this.token = null;
        }
    }

    #useStorage(storage: Pick<Storage, 'setItem' | 'removeItem'>) {
        this.on(HiFiClientEvents.TokenUpdate, (token) => {
            if (token) {
                storage.setItem('hifi_token', token);
            } else {
                storage.removeItem('hifi_token');
            }
        });
        this.on(HiFiClientEvents.TokenExpiryUpdate, (expiry) => {
            if (expiry) {
                storage.setItem('hifi_token_expiry', String(expiry));
            } else {
                storage.removeItem('hifi_token_expiry');
            }
        });
    }

    static #jsonResponse<T>(data: T): TidalResponse<T> {
        return new TidalResponse<T>(JSON.stringify(data), {
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    static #buildUrl(base: string, params?: Params | URLSearchParams) {
        if (!params) return base;
        if (params instanceof URLSearchParams) {
            const u = new URL(base);
            u.search = params.toString();
            return u.toString();
        }

        const u = new URL(base);
        Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .forEach(([k, v]) => u.searchParams.set(k, String(v)));
        return u.toString();
    }

    /**
     * Manually sets the access token, expiry, and optional refresh token on this client.
     *
     * Useful when tokens have been obtained externally (e.g. from a server-side OAuth flow)
     * and need to be injected into the client.
     *
     * @param options - Token values to apply.
     */
    setToken({ token, tokenExpiry, refreshToken }: HiFiClient.TokenOptions & HiFiClient.RefreshTokenOptions) {
        this.token = token || null;
        this.appTokenExpiry = tokenExpiry || 0;
        this.refreshToken = refreshToken || null;
    }

    static #basicAuth(username: string, password: string) {
        return 'Basic ' + btoa(`${username}:${password}`);
    }

    async #fetchAppToken({
        clientId = HiFiClient.BROWSER_CLIENT_ID,
        clientSecret = HiFiClient.BROWSER_CLIENT_SECRET,
        refreshToken,
        scope = 'r_usr+w_usr+w_sub',
        signal = new AbortController().signal,
        force = false,
    }: HiFiClient.ClientOptions &
        HiFiClient.RefreshTokenOptions & {
            scope?: string;
            signal?: AbortSignal;
            force?: boolean;
        }): Promise<string | null> {
        if (!force && this.token && (this.appTokenExpiry < 0 || Date.now() < this.appTokenExpiry)) return this.token;

        return await (this.#tokenPromise ??= (async (): Promise<string | null> => {
            try {
                const params = new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                });

                if (refreshToken) {
                    params.set('refresh_token', refreshToken);
                    params.set('grant_type', 'refresh_token');
                    params.set('scope', scope);
                } else {
                    params.set('grant_type', 'client_credentials');
                }

                const res = await fetch('https://auth.tidal.com/v1/oauth2/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Authorization: HiFiClient.#basicAuth(clientId, clientSecret),
                    },
                    body: params,
                    signal,
                });

                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    throw new Error(`Failed to obtain app token: ${res.status} ${txt}`);
                }

                const json = (await res.json()) as { access_token?: string; expires_in?: number };
                const token = json.access_token;
                const expires_in = json.expires_in ?? 3600;
                this.token = token || null;
                this.appTokenExpiry = Date.now() + (expires_in - 60) * 1000;

                return token || null;
            } finally {
                this.#tokenPromise = null;
            }
        })());
    }

    static #getOptions({
        locale = 'en_US',
        countryCode = 'US',
        baseUrl = '',
        clientId = HiFiClient.BROWSER_CLIENT_ID,
        clientSecret = HiFiClient.BROWSER_CLIENT_SECRET,
        token = '',
        tokenExpiry = 0,
        refreshToken = '',
        storage = [],
    }: HiFiClient.ConstructorOptions = {}): WithRequiredKeys<HiFiClient.ConstructorOptions> {
        return {
            locale,
            countryCode,
            baseUrl,
            clientId,
            clientSecret,
            token,
            tokenExpiry,
            refreshToken,
            storage,
        };
    }

    /**
     * Obtains (or refreshes) the TIDAL application access token.
     *
     * If a non-expired token is already held and `force` is `false`, the cached
     * token is returned immediately without a network request.
     *
     * @param force - When `true`, forces a token refresh even if the current token is still valid.
     * @param signal - Optional {@link AbortSignal} to cancel the token request.
     * @returns The access token string, or `null` if one could not be obtained.
     */
    async fetchToken(force: boolean = false, signal: AbortSignal | undefined = undefined) {
        return await this.#fetchAppToken({
            clientId: this.#clientId,
            clientSecret: this.#clientSecret,
            signal,
            refreshToken: this.refreshToken || undefined,
            force: !!force,
        });
    }

    async #fetchAuthenticated(
        url: string,
        params?: Params | URLSearchParams,
        signal: AbortSignal = new AbortController().signal
    ): Promise<Response> {
        const final = HiFiClient.#buildUrl(url, params);
        let res: Response | undefined;

        while (true) {
            const unauthorized = res?.status === 401;
            const previousResponse = res;
            const token = await this.#fetchAppToken({
                clientId: this.#clientId,
                clientSecret: this.#clientSecret,
                signal,
                refreshToken: this.refreshToken || undefined,
                force: unauthorized,
            });

            const headers: Record<string, string> = {
                authorization: `Bearer ${token}`,
            };
            if (final.includes('openapi.tidal.com')) {
                // Prefer JSON:API for OpenAPI endpoints, but do not require it exclusively.
                // Some endpoints/proxies can still return compatible JSON.
                headers['Accept'] = 'application/vnd.api+json, application/json;q=0.9, */*;q=0.8';
            }

            try {
                res = await fetch(final, {
                    headers,
                    signal,
                });
            } catch (err: unknown) {
                throw new ResponseError(0, err instanceof Error ? err.message : String(err));
            }

            if (previousResponse && unauthorized && res.status === 401) {
                throw new ResponseError(401, 'Unauthorized: Invalid or expired token');
            }

            if (res.status !== 401) break;
        }

        if (!res.ok) {
            throw new ResponseError(res.status, res.statusText);
        }

        return res;
    }

    async #fetchJson<T = unknown>(
        url: string,
        params?: Params | URLSearchParams,
        signal: AbortSignal = new AbortController().signal
    ): Promise<T> {
        const res = await this.#fetchAuthenticated(url, params, signal);

        return res.json() as Promise<T>;
    }

    constructor(options: HiFiClient.ConstructorOptions = {}) {
        const { locale, countryCode, baseUrl, clientId, clientSecret, token, tokenExpiry, refreshToken, storage } =
            HiFiClient.#getOptions(options);
        this.#locale = locale;
        this.#countryCode = countryCode;
        this.#baseUrl = baseUrl || null;
        this.#clientId = clientId;
        this.#clientSecret = clientSecret;
        this.token = token || null;
        this.appTokenExpiry = tokenExpiry || 0;
        this.refreshToken = refreshToken || null;

        for (const store of !Array.isArray(storage) ? [storage] : storage) {
            this.#useStorage(store);
        }
    }

    /**
     * Creates and initialises the singleton {@link HiFiClient} instance.
     *
     * Throws if {@link HiFiClient.initialize} has already been called.  After
     * initialisation the instance can be retrieved via {@link HiFiClient.instance}.
     *
     * @param options - Constructor options including optional credentials and locale settings.
     * @returns The newly created {@link HiFiClient} instance.
     * @throws If a singleton instance already exists.
     */
    static async initialize(options: HiFiClient.ConstructorOptions & { signal?: AbortSignal } = {}) {
        if (HiFiClient.#instance) {
            throw new Error('HiFiClient is already initialized');
        }

        const instance = (HiFiClient.#instance = new HiFiClient(options));

        if (!options.token && !options.clientId && !options.clientSecret) {
            await instance.#fetchAppToken({
                ...options,
                signal: options.signal || new AbortController().signal,
            });
        }

        return (HiFiClient.#instance = instance);
    }

    static #extractUuidFromTidalUrl(href?: string | null) {
        if (!href) return null;
        const parts = href.split('/');
        return parts.length >= 9 ? parts.slice(4, 9).join('-') : null;
    }

    async #withAlbumTrackSlot<T>(fn: () => Promise<T>) {
        if (this.#albumTracksActive >= this.#albumTracksMax) {
            await new Promise<void>((res) => this.#albumTracksQueue.push(res));
        }
        this.#albumTracksActive++;
        try {
            return await fn();
        } finally {
            this.#albumTracksActive--;
            const next = this.#albumTracksQueue.shift();
            if (next) next();
        }
    }

    /**
     * Fetches full track metadata for the given track ID.
     *
     * @param id - TIDAL track ID.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to an {@link InfoResponse}.
     */
    async getInfo(id: number, signal?: AbortSignal): Promise<TidalResponse<InfoResponse>> {
        const url = `https://api.tidal.com/v1/tracks/${id}/`;
        const data = await this.#fetchJson<TidalTrack>(url, { countryCode: this.#countryCode }, signal);
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data });
    }

    /**
     * Fetches playback/stream info for the given track ID.
     *
     * @param id - TIDAL track ID.
     * @param quality - Audio quality string, e.g. `"HI_RES_LOSSLESS"` (default).
     * @param immersiveAudio - Whether to request immersive audio (Dolby Atmos / 360). Defaults to `false`.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link TrackResponse}.
     */
    async getTrack(
        id: number,
        quality = 'HI_RES_LOSSLESS',
        immersiveAudio: boolean = false,
        signal?: AbortSignal
    ): Promise<TidalResponse<TrackResponse>> {
        const url = `https://api.tidal.com/v1/tracks/${id}/playbackinfo`;
        const params = {
            audioquality: quality,
            playbackmode: 'STREAM',
            assetpresentation: 'FULL',
            countryCode: this.#countryCode,
            immersiveAudio: String(immersiveAudio),
        };
        const data = await this.#fetchJson<PlaybackInfo>(url, params, signal);
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data });
    }

    /**
     * Fetches the MPEG-DASH (or alternative) track manifest from the TIDAL OpenAPI.
     *
     * @param id - TIDAL track ID.
     * @param options - Optional manifest request options (formats, adaptive, manifestType, etc.).
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link TrackManifestResponse}.
     */
    async getTrackManifest(
        id: number,
        {
            formats = ['HEAACV1', 'AACLC', 'FLAC', 'FLAC_HIRES', 'EAC3_JOC'],
            adaptive = true,
            manifestType = 'MPEG_DASH',
            uriScheme = 'HTTPS',
            usage = 'PLAYBACK',
        }: HiFiClient.GetTrackManifestOptions = {},
        signal?: AbortSignal
    ): Promise<TidalResponse<TrackManifestResponse>> {
        const url = `https://openapi.tidal.com/v2/trackManifests/${id}`;
        const params = new URLSearchParams({
            adaptive: String(adaptive),
            manifestType,
            uriScheme,
            usage,
        });

        for (const format of formats) {
            params.append('formats', format);
        }

        const res = await this.#fetchJson<TrackManifestApiResponse>(url, params, signal);
        const drmData = res.data.attributes.drmData;

        if (drmData && this.#baseUrl) {
            const url = `${this.#baseUrl.replace(/\/+$/g, '')}/widevine`;
            drmData.licenseUrl = url;
            drmData.certificateUrl = url;
        }

        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data: res });
    }

    /**
     * Fetches a raw Widevine licence response from the TIDAL API.
     *
     * @returns The raw {@link Response} from the Widevine endpoint.
     */
    async getWidevine(): Promise<Response> {
        return await this.#fetchAuthenticated('https://api.tidal.com/v2/widevine');
    }

    /**
     * Fetches track recommendations for the given track ID.
     *
     * @param id - TIDAL track ID.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link RecommendationsResponse}.
     */
    async getRecommendations(id: number, signal?: AbortSignal): Promise<TidalResponse<RecommendationsResponse>> {
        const url = `https://api.tidal.com/v1/tracks/${id}/recommendations`;
        const data = await this.#fetchJson<{ items: TidalTrack[]; totalNumberOfItems: number }>(
            url,
            { limit: '20', countryCode: this.#countryCode },
            signal
        );
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data });
    }

    /**
     * Fetches artists similar to the given artist ID.
     *
     * @param id - TIDAL artist ID.
     * @param cursor - Optional pagination cursor from a previous response.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link SimilarArtistsResponse}.
     */
    async getSimilarArtists(
        id: number,
        cursor?: string | number | null,
        signal?: AbortSignal
    ): Promise<TidalResponse<SimilarArtistsResponse>> {
        const url = `https://openapi.tidal.com/v2/artists/${id}/relationships/similarArtists`;
        const params: Params = {
            'page[cursor]': cursor ?? undefined,
            countryCode: this.#countryCode,
            include: 'similarArtists,similarArtists.profileArt',
        };

        const payload = await this.#fetchJson<JsonApiListResponse>(url, params, signal);
        const included: JsonApiInclude[] = Array.isArray(payload?.included) ? payload.included : [];
        const artists_map: Record<string, JsonApiInclude> = {};
        const artworks_map: Record<string, JsonApiInclude> = {};
        for (const i of included) {
            if (i.type === 'artists') artists_map[i.id] = i;
            if (i.type === 'artworks') artworks_map[i.id] = i;
        }

        const resolveArtist = (entry: JsonApiRef): SimilarArtist => {
            const aid = entry.id;
            const inc = artists_map[aid] ?? ({} as JsonApiInclude);
            const attr = inc.attributes ?? ({} as JsonApiIncludeAttributes);

            let pic_id: string | null = null;
            const art_refs_artist = (() => {
                const d = inc.relationships?.profileArt?.data;
                return Array.isArray(d) ? d : d ? [d as JsonApiRef] : [];
            })();
            if (art_refs_artist.length > 0) {
                const artwork = artworks_map[art_refs_artist[0].id];
                const files = artwork?.attributes?.files;
                if (Array.isArray(files) && files[0]?.href) {
                    pic_id = HiFiClient.#extractUuidFromTidalUrl(files[0].href);
                }
            }

            return {
                ...attr,
                id: Number(aid),
                name: attr.name ?? '',
                picture: pic_id ?? attr.selectedAlbumCoverFallback ?? null,
                url: `http://www.tidal.com/artist/${aid}`,
                relationType: 'SIMILAR_ARTIST',
                popularity: attr.popularity ?? 0,
                externalLinks: attr.externalLinks ?? [],
                spotlighted: attr.spotlighted ?? false,
                contributionsEnabled: attr.contributionsEnabled ?? false,
            };
        };

        return HiFiClient.#jsonResponse({
            version: HiFiClient.API_VERSION,
            artists: (payload?.data ?? []).map(resolveArtist),
        });
    }

    /**
     * Fetches albums similar to the given album ID.
     *
     * @param id - TIDAL album ID.
     * @param cursor - Optional pagination cursor from a previous response.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link SimilarAlbumsResponse}.
     */
    async getSimilarAlbums(
        id: number,
        cursor?: string | number | null,
        signal?: AbortSignal
    ): Promise<TidalResponse<SimilarAlbumsResponse>> {
        const url = `https://openapi.tidal.com/v2/albums/${id}/relationships/similarAlbums`;
        const params: Params = {
            'page[cursor]': cursor ?? undefined,
            countryCode: this.#countryCode,
            include: 'similarAlbums,similarAlbums.coverArt,similarAlbums.artists',
        };

        const payload = await this.#fetchJson<JsonApiListResponse>(url, params, signal);
        const included: JsonApiInclude[] = Array.isArray(payload?.included) ? payload.included : [];
        const albums_map: Record<string, JsonApiInclude> = {};
        const artworks_map: Record<string, JsonApiInclude> = {};
        const artists_map: Record<string, JsonApiInclude> = {};
        for (const i of included) {
            if (i.type === 'albums') albums_map[i.id] = i;
            if (i.type === 'artworks') artworks_map[i.id] = i;
            if (i.type === 'artists') artists_map[i.id] = i;
        }

        const resolveAlbum = (entry: JsonApiRef): TidalSimilarAlbum => {
            const aid = entry.id;
            const inc = albums_map[aid] ?? ({} as JsonApiInclude);
            const attr = inc.attributes ?? ({} as JsonApiIncludeAttributes);

            let cover_id: string | null = null;
            const art_data = inc.relationships?.coverArt?.data;
            if (Array.isArray(art_data) && art_data.length > 0) {
                const artwork = artworks_map[art_data[0].id];
                const files = artwork?.attributes?.files;
                if (Array.isArray(files) && files[0]?.href) {
                    cover_id = HiFiClient.#extractUuidFromTidalUrl(files[0].href);
                }
            }

            const artist_list: Array<{ id: number; name: string }> = [];
            const artists_data = inc.relationships?.artists?.data;
            if (Array.isArray(artists_data)) {
                for (const a_entry of artists_data) {
                    const a_obj = artists_map[a_entry.id];
                    if (a_obj) {
                        artist_list.push({
                            id: Number(a_obj.id),
                            name: a_obj.attributes?.name ?? '',
                        });
                    }
                }
            }

            return {
                ...attr,
                id: Number(aid),
                title: attr.title ?? '',
                cover: cover_id ?? '',
                artists: artist_list,
                url: `http://www.tidal.com/album/${aid}`,
            } as TidalSimilarAlbum;
        };

        return HiFiClient.#jsonResponse({
            version: HiFiClient.API_VERSION,
            albums: (payload?.data ?? []).map(resolveAlbum),
        });
    }

    /**
     * Fetches artist data including profile information, discography, and/or top tracks.
     *
     * When `id` is supplied, returns the artist's profile and a cover-image entry
     * ({@link ArtistByIdResponse}).
     *
     * When `f` is supplied, returns the artist's full discography and, if `skip_tracks`
     * is `false`, the tracks from all albums ({@link ArtistDiscographyResponse}).
     *
     * @param id - TIDAL artist ID for profile lookup.
     * @param f - TIDAL artist ID for discography/tracks lookup.
     * @param skip_tracks - When `true`, fetches only top tracks instead of all album tracks.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @param options - Optional pagination options (`offset`, `limit`) for track fetching.
     * @returns A {@link TidalResponse} whose `.json()` resolves to an {@link ArtistResponse}.
     */
    async getArtist(
        id?: number | null,
        f?: number | null,
        skip_tracks = false,
        signal?: AbortSignal,
        options?: { offset?: number; limit?: number }
    ): Promise<TidalResponse<ArtistResponse>> {
        if (!id && !f) throw new ResponseError(400, 'Provide id or f query param');

        if (id) {
            const artist_url = `https://openapi.tidal.com/v2/artists/${id}`;
            const payload = await this.#fetchJson<any>(
                artist_url,
                {
                    countryCode: this.#countryCode,
                    include: 'albums,albums.coverArt,tracks,tracks.albums,biography,profileArt',
                    collapseBy: 'FINGERPRINT',
                },
                signal
            );

            const includedMap = new Map<string, any>();
            if (Array.isArray(payload?.included)) {
                for (const item of payload.included) {
                    includedMap.set(`${item.type}:${item.id}`, item);
                }
            }

            const getPic = (item: any, relName: string) => {
                if (item?.relationships?.[relName]?.data?.[0]) {
                    const picRef = item.relationships[relName].data[0];
                    const pic = includedMap.get(`artworks:${picRef.id}`);
                    return pic?.attributes?.files?.[0]?.href
                        ? HiFiClient.#extractUuidFromTidalUrl(pic.attributes.files[0].href)
                        : null;
                }
                return null;
            };

            const data = payload?.data;
            let biography: any = null;
            if (data?.relationships?.biography?.data) {
                const bioRef = data.relationships.biography.data;
                const bioItem =
                    includedMap.get(`biographies:${bioRef.id}`) || includedMap.get(`biography:${bioRef.id}`);
                if (bioItem) {
                    biography = { text: bioItem.attributes?.text, source: bioItem.attributes?.source };
                }
            }

            const artist_data: any = {
                id: Number(data?.id || id),
                name: data?.attributes?.name || '',
                picture: getPic(data, 'profileArt') || data?.attributes?.selectedAlbumCoverFallback || null,
                biography: biography,
            };

            const picture = artist_data.picture;
            let cover: ArtistCover | null = null;
            if (picture) {
                const slug = picture.replace(/-/g, '/');
                cover = {
                    id: artist_data.id,
                    name: artist_data.name,
                    '750': `https://resources.tidal.com/images/${slug}/750x750.jpg`,
                };
            }

            const albums: any[] = [];
            const tracks: any[] = [];

            if (data?.relationships?.albums?.data) {
                for (const ref of data.relationships.albums.data) {
                    const al = includedMap.get(`albums:${ref.id}`);
                    if (al) {
                        albums.push({
                            id: Number(al.id),
                            title: al.attributes?.title,
                            duration: al.attributes?.duration ? 100 : undefined,
                            numberOfTracks: al.attributes?.numberOfItems,
                            releaseDate: al.attributes?.releaseDate,
                            type: al.attributes?.albumType,
                            cover: getPic(al, 'coverArt'),
                            artist: { id: artist_data.id, name: artist_data.name },
                        });
                    }
                }
            }

            if (data?.relationships?.tracks?.data) {
                for (const ref of data.relationships.tracks.data) {
                    const tr = includedMap.get(`tracks:${ref.id}`);
                    if (tr) {
                        let albumInfo = undefined;
                        if (tr.relationships?.albums?.data?.[0]) {
                            const aRef = tr.relationships.albums.data[0];
                            const aItem = includedMap.get(`albums:${aRef.id}`);
                            if (aItem) {
                                albumInfo = {
                                    id: Number(aItem.id),
                                    title: aItem.attributes?.title,
                                    cover: getPic(aItem, 'coverArt'),
                                };
                            }
                        }
                        tracks.push({
                            id: Number(tr.id),
                            title: tr.attributes?.title,
                            duration: tr.attributes?.duration ? 100 : undefined,
                            album: albumInfo,
                            artist: { id: artist_data.id, name: artist_data.name },
                        });
                    }
                }
            }

            return HiFiClient.#jsonResponse({
                version: HiFiClient.API_VERSION,
                artist: artist_data,
                cover,
                albums: { items: albums },
                tracks,
            });
        }

        // fallback to original f logic
        const albums_url = `https://api.tidal.com/v1/artists/${f}/albums`;
        const common_params: Params = { countryCode: this.#countryCode, limit: 50 };

        const tasks: Array<Promise<TidalListResponse<TidalAlbum> | TidalListResponse<TidalTrack>>> = [
            this.#fetchJson<TidalListResponse<TidalAlbum>>(albums_url, common_params, signal),
            this.#fetchJson<TidalListResponse<TidalAlbum>>(
                albums_url,
                { ...common_params, filter: 'EPSANDSINGLES' },
                signal
            ),
        ];

        if (skip_tracks) {
            const offset = options?.offset;
            const limit = options?.limit;
            const toptracks_params: Params = { countryCode: this.#countryCode, limit: limit || 15 };
            if (offset !== undefined) {
                toptracks_params.offset = offset;
            }
            tasks.push(
                this.#fetchJson<TidalListResponse<TidalTrack>>(
                    `https://api.tidal.com/v1/artists/${f}/toptracks`,
                    toptracks_params,
                    signal
                )
            );
        }

        const results = await Promise.all(tasks.map((p) => p.catch((e: Error) => e)));

        const unique_releases: TidalAlbum[] = [];
        const seen_ids = new Set<number>();

        for (const res of results.slice(0, 2)) {
            if (res && !(res instanceof Error)) {
                const data = res as TidalListResponse<TidalAlbum>;
                const items = data?.items ?? [];
                for (const item of items) {
                    if (item && item.id && !seen_ids.has(item.id)) {
                        unique_releases.push(item);
                        seen_ids.add(item.id);
                    }
                }
            }
        }

        const album_ids: number[] = unique_releases.map((i) => i.id).filter(Boolean);
        const page_data = { items: unique_releases };

        if (skip_tracks) {
            let top_tracks: TidalTrack[] = [];
            if (results.length > 2) {
                const res = results[2];
                if (res && !(res instanceof Error)) {
                    const data = res as TidalListResponse<TidalTrack>;
                    top_tracks = data?.items ?? [];
                }
            }

            return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, albums: page_data, tracks: top_tracks });
        }

        if (!album_ids.length)
            return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, albums: page_data, tracks: [] });

        const fetchAlbumTracks = async (album_id: number): Promise<TidalTrack[]> => {
            return await this.#withAlbumTrackSlot(async () => {
                const album_data = await this.#fetchJson<TidalPagesApiResponse>(
                    'https://api.tidal.com/v1/pages/album',
                    { albumId: album_id, countryCode: this.#countryCode, deviceType: 'BROWSER' },
                    signal
                );
                const rows = Array.isArray(album_data?.rows) ? album_data.rows : [];
                if (rows.length < 2) return [];
                const modules = rows[1].modules ?? [];
                if (!modules || modules.length === 0) return [];
                const paged_list = modules[0].pagedList ?? { items: [] };
                const items = paged_list.items ?? [];
                return items.map((t) => t.item ?? t).filter((t): t is TidalTrack => isTidalTrack(t));
            });
        };

        const trackResults = await Promise.all(
            album_ids.map((aid) => fetchAlbumTracks(aid).catch((): TidalTrack[] => []))
        );
        const tracks: TidalTrack[] = [];
        for (const t of trackResults) {
            if (Array.isArray(t)) tracks.push(...t);
        }

        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, albums: page_data, tracks });
    }
    async getArtistBiography(artistId: number, signal?: AbortSignal): Promise<TidalResponse<ArtistBioResponse>> {
        const url = `https://api.tidal.com/v1/artists/${artistId}/bio`;
        const params = {
            locale: this.#locale,
            countryCode: this.#countryCode,
        };
        const data = await this.#fetchJson<ArtistBiography>(url, params, signal);

        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data: data });
    }

    #buildCoverEntry(cover_slug: string, name?: string | null, track_id?: number | null): CoverEntry {
        const slug = cover_slug.replace(/-/g, '/');
        return {
            id: track_id ?? 0,
            name: name ?? '',
            '1280': `https://resources.tidal.com/images/${slug}/1280x1280.jpg`,
            '640': `https://resources.tidal.com/images/${slug}/640x640.jpg`,
            '80': `https://resources.tidal.com/images/${slug}/80x80.jpg`,
        };
    }

    /**
     * Fetches cover-image URLs for a track (by `id`) or a search query (`q`).
     *
     * @param id - TIDAL track ID; if provided, returns the cover for that track's album.
     * @param q - Free-text search query; returns covers for matching tracks.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link CoverResponse}.
     * @throws {@link ResponseError} with status 400 if neither `id` nor `q` is provided.
     * @throws {@link ResponseError} with status 404 if no cover could be found.
     */
    async getCover(id?: number | null, q?: string | null, signal?: AbortSignal): Promise<TidalResponse<CoverResponse>> {
        if (!id && !q) throw new ResponseError(400, 'Provide id or q query param');

        if (id) {
            const track_data = await this.#fetchJson<TidalTrack>(
                `https://api.tidal.com/v1/tracks/${id}/`,
                { countryCode: this.#countryCode },
                signal
            );
            const album = track_data.album ?? ({} as TidalTrackAlbumRef);
            const cover_slug = album.cover;
            if (!cover_slug) throw new ResponseError(404, 'Cover not found');
            const entry = this.#buildCoverEntry(cover_slug, album.title || track_data.title, album.id || id);
            return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, covers: [entry] });
        }

        const search_data = await this.#fetchJson<{ items: TidalTrack[] }>(
            'https://api.tidal.com/v1/search/tracks',
            { countryCode: this.#countryCode, query: q, limit: 10 },
            signal
        );
        const items = Array.isArray(search_data?.items) ? search_data.items.slice(0, 10) : [];
        if (!items.length) throw new ResponseError(404, 'Cover not found');
        const covers: CoverEntry[] = [];
        for (const track of items) {
            const album = track.album ?? ({} as TidalTrackAlbumRef);
            const cover_slug = album.cover;
            if (!cover_slug) continue;
            covers.push(this.#buildCoverEntry(cover_slug, track.title, track.id));
        }
        if (!covers.length) throw new ResponseError(404, 'Cover not found');
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, covers });
    }

    /**
     * Performs a TIDAL search. Exactly one search option must be provided.
     *
     * | Option | Description |
     * |--------|-------------|
     * | `q`    | General search across artists, albums, tracks, videos, and playlists. |
     * | `s`    | Track-specific text search. |
     * | `a`    | Top-hits search scoped to artists and tracks. |
     * | `al`   | Top-hits search scoped to albums. |
     * | `v`    | Top-hits search scoped to videos. |
     * | `p`    | Top-hits search scoped to playlists. |
     * | `i`    | ISRC-based track lookup (falls back to text search). |
     *
     * @param options - Search parameters; at least one of `q`, `s`, `a`, `al`, `v`, `p`, or `i` is required.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link SearchResponse}.
     */
    async search(
        options: {
            /** General search query (artists, albums, tracks, videos, playlists). */
            q?: string;
            /** Track text search query. */
            s?: string;
            /** Artist/track top-hits query. */
            a?: string;
            /** Album top-hits query. */
            al?: string;
            /** Video top-hits query. */
            v?: string;
            /** Playlist top-hits query. */
            p?: string;
            /** ISRC code for exact track lookup. */
            i?: string;
            /** Result offset for pagination. */
            offset?: number;
            /** Maximum number of results to return. */
            limit?: number;
        },
        signal?: AbortSignal
    ): Promise<TidalResponse<SearchResponse>> {
        const { q, s, a, al, v, p, i, offset = 0, limit = 25 } = options;

        const parseOpenApiSearch = (jsonApi: any): SearchResponse['data'] => {
            if (!jsonApi || !jsonApi.data) return {};

            const includedMap = new Map<string, any>();
            if (Array.isArray(jsonApi.included)) {
                for (const item of jsonApi.included) {
                    includedMap.set(`${item.type}:${item.id}`, item);
                }
            }

            const resolveArtworkId = (item: any, relName: string) => {
                const ref = item?.relationships?.[relName]?.data?.[0];
                if (!ref) return null;
                const artwork = includedMap.get(`artworks:${ref.id}`);
                const href = artwork?.attributes?.files?.[0]?.href;
                return href ? HiFiClient.#extractUuidFromTidalUrl(href) : null;
            };

            const resolveArtists = (item: any) => {
                const refs = item?.relationships?.artists?.data;
                if (!Array.isArray(refs)) return [];
                return refs.map((art: any) => {
                    const aItem = includedMap.get(`artists:${art.id}`);
                    return {
                        id: Number(art.id),
                        name: aItem?.attributes?.name ?? '',
                    };
                });
            };

            const resolveItem = (ref: { id: string; type: string }) => {
                const item = includedMap.get(`${ref.type}:${ref.id}`);
                if (!item) return null;

                const attrs = item.attributes || {};
                const mapped: any = {
                    id: Number(item.id) || item.id,
                    ...attrs,
                };

                if (item.type === 'artists') {
                    mapped.type = 'artist';
                    mapped.name = attrs.name ?? '';
                    mapped.picture = resolveArtworkId(item, 'profileArt');
                } else if (item.type === 'albums') {
                    const artists = resolveArtists(item);
                    mapped.type = 'album';
                    mapped.title = attrs.title ?? '';
                    mapped.cover = resolveArtworkId(item, 'coverArt');
                    mapped.artists = artists;
                    if (artists.length > 0) mapped.artist = artists[0];
                } else if (item.type === 'tracks') {
                    const artists = resolveArtists(item);
                    mapped.type = 'track';
                    mapped.title = attrs.title ?? '';
                    mapped.artists = artists;
                    if (artists.length > 0) mapped.artist = artists[0];
                    const albumRef = item.relationships?.albums?.data?.[0];
                    if (albumRef) {
                        const albumItem = includedMap.get(`albums:${albumRef.id}`);
                        mapped.album = {
                            id: Number(albumRef.id),
                            title: albumItem?.attributes?.title ?? '',
                            cover: albumItem ? resolveArtworkId(albumItem, 'coverArt') : null,
                        };
                    }
                } else if (item.type === 'videos') {
                    const artists = resolveArtists(item);
                    mapped.type = 'video';
                    mapped.title = attrs.title ?? '';
                    mapped.artists = artists;
                    if (artists.length > 0) mapped.artist = artists[0];
                    mapped.imageId = resolveArtworkId(item, 'image');
                } else if (item.type === 'playlists') {
                    mapped.type = 'playlist';
                    mapped.title = attrs.name ?? '';
                    mapped.image = resolveArtworkId(item, 'coverArt');
                }

                return mapped;
            };

            const relationships = jsonApi.data.relationships || {};
            const mapBucket = (relName: string) => {
                const relData = relationships[relName]?.data;
                if (!Array.isArray(relData)) return undefined;
                const items = relData.map(resolveItem).filter(Boolean);
                return {
                    items,
                    totalNumberOfItems: items.length,
                    limit,
                    offset,
                };
            };

            return {
                artists: mapBucket('artists'),
                albums: mapBucket('albums'),
                tracks: mapBucket('tracks'),
                videos: mapBucket('videos'),
                playlists: mapBucket('playlists'),
            };
        };

        if (i) {
            // try filtered track search first
            try {
                const res = await this.#fetchJson<SearchResponse['data']>(
                    'https://api.tidal.com/v1/tracks',
                    {
                        'filter[isrc]': i,
                        limit,
                        offset,
                        countryCode: this.#countryCode,
                    },
                    signal
                );
                return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data: res });
            } catch (err: unknown) {
                if (err instanceof ResponseError && ![400, 404].includes(err.status)) throw err;
                // fallback to text search
            }
            const fallback = await this.#fetchJson<any>(
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(i)}`,
                {
                    limit,
                    offset,
                    include: 'tracks,tracks.artists,tracks.albums,tracks.albums.coverArt',
                    countryCode: this.#countryCode,
                },
                signal
            );
            return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data: parseOpenApiSearch(fallback) });
        }

        const includeQ =
            'albums,albums.coverArt,albums.artists,tracks,tracks.artists,tracks.albums,tracks.albums.coverArt,artists,playlists,videos';
        const includeS = 'tracks,tracks.artists,tracks.albums,tracks.albums.coverArt';
        const includeA = 'artists,artists.profileArt,tracks,tracks.artists,tracks.albums,tracks.albums.coverArt';
        const includeAl = 'albums,albums.artists,albums.coverArt';
        const includeV = 'videos,videos.artists,videos.image';
        const includeP = 'playlists,playlists.coverArt';

        const mapping: Array<[string | undefined, string, Params]> = [
            [
                q,
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(q || '')}`,
                {
                    limit,
                    offset,
                    include: includeQ,
                    countryCode: this.#countryCode,
                },
            ],
            [
                s,
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(s || '')}`,
                { limit, offset, include: includeS, countryCode: this.#countryCode },
            ],
            [
                a,
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(a || '')}`,
                { limit, offset, include: includeA, countryCode: this.#countryCode },
            ],
            [
                al,
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(al || '')}`,
                { limit, offset, include: includeAl, countryCode: this.#countryCode },
            ],
            [
                v,
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(v || '')}`,
                { limit, offset, include: includeV, countryCode: this.#countryCode },
            ],
            [
                p,
                `https://openapi.tidal.com/v2/searchResults/${encodeURIComponent(p || '')}`,
                { limit, offset, include: includeP, countryCode: this.#countryCode },
            ],
        ];

        for (const [val, url, params] of mapping) {
            if (val) {
                const data = await this.#fetchJson<any>(url, params, signal);
                return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data: parseOpenApiSearch(data) });
            }
        }

        throw new Error('Provide one of s, a, al, v, p, or i');
    }

    /**
     * Fetches album metadata together with its full track listing.
     *
     * @param id - TIDAL album ID.
     * @param limit - Maximum number of tracks to fetch. Defaults to `100`.
     * @param offset - Track list offset for pagination. Defaults to `0`.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to an {@link AlbumResponse}.
     */
    async getAlbum(id: number, limit = 100, offset = 0, signal?: AbortSignal): Promise<TidalResponse<AlbumResponse>> {
        const albumUrl = `https://api.tidal.com/v1/albums/${id}`;
        const itemsUrl = `https://api.tidal.com/v1/albums/${id}/items`;
        type ItemsPage = { items?: Array<{ item: TidalTrack; type: string }> };
        const albumTask = this.#fetchJson<TidalAlbum>(albumUrl, { countryCode: this.#countryCode }, signal);
        const itemsTasks: Array<Promise<ItemsPage>> = [];

        let remaining = limit;
        let currentOffset = offset;
        const maxChunk = 100;
        while (remaining > 0) {
            const chunk = Math.min(remaining, maxChunk);
            itemsTasks.push(
                this.#fetchJson<ItemsPage>(
                    itemsUrl,
                    { countryCode: this.#countryCode, limit: chunk, offset: currentOffset },
                    signal
                )
            );
            currentOffset += chunk;
            remaining -= chunk;
        }

        const [albumRaw, ...pages] = await Promise.all([albumTask, ...itemsTasks]);
        const allItems: Array<{ item: TidalTrack; type: string }> = [];
        for (const p of pages) {
            const pageItems = p?.items ?? [];
            if (Array.isArray(pageItems)) allItems.push(...pageItems);
        }
        const albumData: TidalAlbumWithTracks = { ...albumRaw, items: allItems };
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, data: albumData });
    }

    /**
     * Fetches the header and track list for a TIDAL mix.
     *
     * @param id - TIDAL mix ID string.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link MixResponse}.
     */
    async getMix(id: string, signal?: AbortSignal): Promise<TidalResponse<MixResponse>> {
        const url = 'https://api.tidal.com/v1/pages/mix';
        const data = await this.#fetchJson<TidalPagesApiResponse>(
            url,
            { mixId: id, countryCode: this.#countryCode, deviceType: 'BROWSER' },
            signal
        );
        let header: unknown = {};
        let items: TidalTrack[] = [];
        const rows = data.rows ?? [];

        for (const row of rows) {
            for (const module of row.modules ?? []) {
                if (module.type === 'MIX_HEADER') header = module.mix ?? {};
                if (module.type === 'TRACK_LIST') items = ((module.pagedList || {}).items as TidalTrack[]) ?? [];
            }
        }
        return HiFiClient.#jsonResponse({
            version: HiFiClient.API_VERSION,
            mix: header,
            items,
        });
    }

    /**
     * Fetches playlist metadata together with its item list.
     *
     * @param id - TIDAL playlist UUID string.
     * @param limit - Maximum number of items to fetch. Defaults to `100`.
     * @param offset - Item list offset for pagination. Defaults to `0`.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link PlaylistResponse}.
     */
    async getPlaylist(
        id: string,
        limit = 100,
        offset = 0,
        signal?: AbortSignal
    ): Promise<TidalResponse<PlaylistResponse>> {
        const playlistUrl = `https://api.tidal.com/v1/playlists/${id}`;
        const itemsUrl = `https://api.tidal.com/v1/playlists/${id}/items`;
        const [playlistData, itemsData] = await Promise.all([
            this.#fetchJson<TidalPlaylist>(playlistUrl, { countryCode: this.#countryCode }, signal),
            this.#fetchJson<{ items: PlaylistItem[] }>(
                itemsUrl,
                { countryCode: this.#countryCode, limit, offset },
                signal
            ),
        ]);
        const items = itemsData?.items ?? [];
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, playlist: playlistData, items });
    }

    // simplified artist/cover/lyrics/video/topvideos/similar methods (same pattern)
    /**
     * Fetches the lyrics for the given track ID.
     *
     * @param id - TIDAL track ID.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link LyricsResponse}.
     * @throws An error with `status = 404` if lyrics are unavailable for the track.
     */
    async getLyrics(id: number, signal?: AbortSignal): Promise<TidalResponse<LyricsResponse>> {
        const url = `https://api.tidal.com/v1/tracks/${id}/lyrics`;
        const data = await this.#fetchJson<Lyrics>(
            url,
            { countryCode: this.#countryCode, locale: 'en_US', deviceType: 'BROWSER' },
            signal
        );
        if (!data) {
            const err = Object.assign(new Error('Lyrics not found'), { status: 404 });
            throw err;
        }
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, lyrics: data });
    }

    /**
     * Fetches video playback info for the given video ID.
     *
     * @param id - TIDAL video ID.
     * @param quality - Video quality string, e.g. `"HIGH"` (default).
     * @param mode - Playback mode, e.g. `"STREAM"` (default).
     * @param presentation - Asset presentation, e.g. `"FULL"` (default).
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link VideoResponse}.
     */
    async getVideo(
        id: number,
        quality = 'HIGH',
        mode = 'STREAM',
        presentation = 'FULL',
        signal?: AbortSignal
    ): Promise<TidalResponse<VideoResponse>> {
        const url = `https://api.tidal.com/v1/videos/${id}/playbackinfo`;
        const data = await this.#fetchJson<VideoPlaybackInfo>(
            url,
            { videoquality: quality, playbackmode: mode, assetpresentation: presentation },
            signal
        );
        return HiFiClient.#jsonResponse({ version: HiFiClient.API_VERSION, video: data });
    }

    /**
     * Fetches a paginated list of recommended videos from TIDAL.
     *
     * @param options - Optional locale, device type, and pagination parameters.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} whose `.json()` resolves to a {@link TopVideosResponse}.
     */
    async getTopVideos(
        { countryCode = 'US', locale = 'en_US', deviceType = 'BROWSER', limit = 25, offset = 0 } = {},
        signal?: AbortSignal
    ): Promise<TidalResponse<TopVideosResponse>> {
        const url = 'https://api.tidal.com/v1/pages/mymusic_recommended_videos';
        const data = await this.#fetchJson<TidalPagesApiResponse>(url, { countryCode, locale, deviceType }, signal);
        const rows = data.rows ?? [];
        const videos: TidalVideoItem[] = [];
        for (const row of rows) {
            for (const module of row.modules ?? []) {
                const mt = module.type;
                if (['VIDEO_PLAYLIST', 'VIDEO_ROW', 'PAGED_LIST'].includes(mt)) {
                    const items = module.pagedList?.items ?? [];
                    for (const item of items) {
                        const v = item.item ?? item;
                        videos.push(v as TidalVideoItem);
                    }
                } else if (mt === 'VIDEO' || (mt && mt.toLowerCase().includes('video'))) {
                    const it = module.item;
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                    videos.push(it as TidalVideoItem);
                }
            }
        }
        return HiFiClient.#jsonResponse({
            version: HiFiClient.API_VERSION,
            videos: videos.slice(offset, offset + limit),
            total: videos.length,
        });
    }

    /**
     * Dispatches a local route string (e.g. `"/info/?id=123"`) to the appropriate
     * {@link HiFiClient} method and returns a {@link TidalResponse}.
     *
     * This is a convenience method that mirrors an HTTP-router interface so external
     * code can call the API with path-style strings.  Because the route is resolved
     * at runtime the response is untyped (`TidalResponse<unknown>`); prefer calling
     * the individual typed methods directly when the route is known at compile time.
     *
     * @param pathOrUrl - A local route path such as `"/track/?id=123"`, or a full URL.
     * @param signal - Optional {@link AbortSignal} to cancel the request.
     * @returns A {@link TidalResponse} wrapping the route handler's response.
     * @throws An error if the pathname does not match any known route.
     */
    async query(pathOrUrl: string, signal?: AbortSignal): Promise<TidalResponse> {
        // normalize: if starts with http use as-is, else treat as local route
        try {
            const u = new URL(pathOrUrl, 'http://localhost');
            const pathname = u.pathname.replace(/\/+$/, '') || '/';
            const qp: Record<string, string> = {};
            u.searchParams.forEach((v, k) => (qp[k] = v));
            const formats = u.searchParams.getAll('formats');

            switch (pathname) {
                case '/':
                    return new TidalResponse(
                        HiFiClient.#jsonResponse({
                            version: HiFiClient.API_VERSION,
                            Repo: 'https://github.com/binimum/hifi-api',
                        })
                    );
                case '/info':
                    return new TidalResponse(await this.getInfo(Number(qp.id)));
                case '/track':
                    return new TidalResponse(await this.getTrack(Number(qp.id), qp.quality || undefined));
                case '/recommendations':
                    return new TidalResponse(await this.getRecommendations(Number(qp.id)));
                case '/artist/similar':
                    return new TidalResponse(
                        await this.getSimilarArtists(Number(qp.id), qp.cursor ?? undefined, signal)
                    );
                case '/album/similar':
                    return new TidalResponse(
                        await this.getSimilarAlbums(Number(qp.id), qp.cursor ?? undefined, signal)
                    );
                case '/artist/bio':
                    return new TidalResponse(await this.getArtistBiography(Number(qp.id), signal));
                case '/artist':
                    return new TidalResponse(
                        await this.getArtist(
                            qp.id ? Number(qp.id) : undefined,
                            qp.f ? Number(qp.f) : undefined,
                            qp.skip_tracks === 'true' || qp.skip_tracks === '1' || qp.skip_tracks === 'True',
                            signal,
                            {
                                offset: qp.offset !== undefined ? Number(qp.offset) : undefined,
                                limit: qp.limit !== undefined ? Number(qp.limit) : undefined,
                            }
                        )
                    );
                case '/cover':
                    return new TidalResponse(
                        await this.getCover(qp.id ? Number(qp.id) : undefined, qp.q ?? undefined, signal)
                    );
                case '/search':
                    return new TidalResponse(
                        await this.search({
                            q: qp.q,
                            s: qp.s,
                            a: qp.a,
                            al: qp.al,
                            v: qp.v,
                            p: qp.p,
                            i: qp.i,
                            offset: qp.offset ? Number(qp.offset) : undefined,
                            limit: qp.limit ? Number(qp.limit) : undefined,
                        })
                    );
                case '/album':
                    return new TidalResponse(
                        await this.getAlbum(
                            Number(qp.id),
                            qp.limit ? Number(qp.limit) : undefined,
                            qp.offset ? Number(qp.offset) : undefined
                        )
                    );
                case '/playlist':
                    return new TidalResponse(
                        await this.getPlaylist(
                            qp.id || '',
                            qp.limit ? Number(qp.limit) : undefined,
                            qp.offset ? Number(qp.offset) : undefined
                        )
                    );
                case '/mix':
                    return new TidalResponse(await this.getMix(qp.id || ''));
                case '/lyrics':
                    return new TidalResponse(await this.getLyrics(Number(qp.id)));
                case '/video':
                    return new TidalResponse(
                        await this.getVideo(
                            Number(qp.id),
                            qp.quality || undefined,
                            qp.mode || undefined,
                            qp.presentation || undefined
                        )
                    );
                case '/topvideos':
                    return new TidalResponse(
                        await this.getTopVideos({
                            countryCode: qp.countryCode || undefined,
                            locale: qp.locale || undefined,
                            deviceType: qp.deviceType || undefined,
                            limit: qp.limit ? Number(qp.limit) : undefined,
                            offset: qp.offset ? Number(qp.offset) : undefined,
                        })
                    );
                case '/trackManifests':
                    return new TidalResponse(
                        await this.getTrackManifest(Number(qp.id), {
                            ...qp,
                            formats: formats.length > 0 ? formats : undefined,
                            adaptive: Boolean(qp.adaptive?.toLowerCase()) || undefined,
                        })
                    );
                case '/widevine':
                    return new TidalResponse(await this.getWidevine());
                default:
                    throw new Error(`Unknown route: ${pathname}`);
            }
        } catch (err) {
            const message = (err as { message?: string }).message ?? String(err);
            console.error(message, err);

            throw err;
        }
    }
}

namespace HiFiClient {
    export interface RefreshTokenOptions {
        refreshToken?: string;
    }

    export interface TokenOptions {
        token?: string;
        tokenExpiry?: number;
    }

    export interface ClientOptions {
        clientId?: string;
        clientSecret?: string;
    }

    export interface LocaleOptions {
        locale?: string;
        countryCode?: string;
    }

    export interface ConstructorOptions
        extends LocaleOptions, RefreshTokenOptions, ClientOptions, TokenOptions, RefreshTokenOptions {
        baseUrl?: string;
        storage?: Pick<Storage, 'setItem' | 'removeItem'>[] | Pick<Storage, 'setItem' | 'removeItem'>;
    }

    export interface GetTrackManifestOptions {
        formats?: string[];
        adaptive?: boolean;
        manifestType?: string;
        uriScheme?: 'HTTPS' | 'HTTP';
        usage?: string;
    }
}

export { HiFiClient };
