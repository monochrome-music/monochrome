import { expect, test } from 'vitest';
import { HiFiClient, TidalResponse } from './HiFi';
import type { Album, PlaybackInfo, Track } from './container-classes';

const ARTIST_ID = 3523908; // deadmau5
const ALBUM_ID = 433360012; // deadmau5 - 4x4=12
const _ALBUM_ATMOS = 463900719; // Taylor Swift - The Life of a Showgirl
const TRACK_ATMOS = 463900720; // Taylor Swift - The Fate of Ophelia
const _TRACK_NO_LOSSLESS = 31097959; // deadmau5 - while(1<2)
const TRACK_VIDEO = 466464180; // Taylow Swift - The Fate of Ophelia
const TRACK_LOSSLESS = 31097949; // deadmau5 - Avaritia
const PLAYLIST_ID = '36ea71a8-445e-41a4-82ab-6628c581535d'; // Pop Hits

const instance = new HiFiClient();
await instance.fetchToken();

function checkVersion({ version }: { version?: string }) {
    expect(version).toBeTypeOf('string');
    expect(version).not.equals('');
    expect(version).equals(HiFiClient.API_VERSION);
}

async function _getJson(res: Response | Promise<Response>) {
    res = await res;
    expect(res).toBeInstanceOf(Response);
    expect(res.ok).toBeTruthy();
    return (await res.json()) as object;
}

async function checkRoute(
    route: string,
    routeResult: () => Promise<Response>,
    checks: (data: object) => Promise<void>,
    mainKey: string | null = 'data'
) {
    const routeData = await instance.query(route);
    const routeRes = (await routeResult()) as unknown;
    expect(routeData).toBeInstanceOf(TidalResponse);
    expect(routeData).toEqual(routeRes);

    const json = (await routeData.json()) as object;
    checkVersion(json);

    if (mainKey != null) {
        expect(json).toHaveProperty(mainKey);
        expect(json[mainKey]).not.toBeUndefined();
    }

    await checks(json);
}

test('Get token', async () => {
    const instance = new HiFiClient();

    const token = await instance.fetchToken();
    expect(token).toBeTypeOf('string');
    expect(token).not.toBeUndefined();
    expect(token).not.length(0);
    expect(token).equals(instance.token);

    const token2 = await instance.fetchToken(true);
    expect(token2).toBeTypeOf('string');
    expect(token2).not.toBeUndefined();
    expect(token2).not.length(0);
    expect(token2).equals(instance.token);
    expect(token2).not.equals(token);

    expect(instance.appTokenExpiry).toBeGreaterThan(Date.now());
});

test('Fetch atmos track info', async () => {
    await checkRoute(
        `/info/?id=${TRACK_ATMOS}`,
        () => instance.getInfo(TRACK_ATMOS),
        async (info: { data: Track }) => {
            expect(info.data.audioModes).toContain('DOLBY_ATMOS');
        }
    );
});

test('Fetch track', async () => {
    await checkRoute(
        `/track/?id=${TRACK_LOSSLESS}`,
        () => instance.getTrack(TRACK_LOSSLESS),
        async (track: { data: PlaybackInfo }) => {
            expect(track?.data?.trackId).toBe(TRACK_LOSSLESS);
            expect(track.data.assetPresentation).toBeTypeOf('string');
            expect(track.data.audioQuality).toBeTypeOf('string');
            expect(track.data.manifestMimeType).toBeTypeOf('string');
            expect(track.data.manifestHash).toBeTypeOf('string');
            expect(track.data.manifest).toBeTypeOf('string');
            expect(track.data.albumReplayGain).toBeTypeOf('number');
            expect(track.data.albumPeakAmplitude).toBeTypeOf('number');
            expect(track.data.trackReplayGain).toBeTypeOf('number');
            expect(track.data.trackPeakAmplitude).toBeTypeOf('number');
            expect(track.data.bitDepth).toBeTypeOf('number');
            expect(track.data.sampleRate).toBeTypeOf('number');
        }
    );
});

test.skipIf(!instance.refreshToken)('Fetch recommendations', async () => {
    await checkRoute(
        `/recommendations/?id=${ARTIST_ID}`,
        () => instance.getRecommendations(ARTIST_ID),
        async (_data) => {}
    );
});

test('Fetch similar artists', async () => {
    await checkRoute(
        `/artist/similar/?id=${ARTIST_ID}`,
        () => instance.getSimilarArtists(ARTIST_ID),
        async (_data) => {},
        'artists'
    );
});

test('Fetch similar albums', async () => {
    await checkRoute(
        `/album/similar/?id=${ALBUM_ID}`,
        () => instance.getSimilarAlbums(ALBUM_ID),
        async (_data) => {},
        'albums'
    );
});

test('Fetch artist info', async () => {
    await checkRoute(
        `/artist/?id=${ARTIST_ID}`,
        () => instance.getArtist(ARTIST_ID),
        async (info: { cover: string }) => {
            expect(info).toHaveProperty('cover');
            expect(info.cover).not.toBeUndefined();
        },
        'artist'
    );
});

test('Search', async () => {
    const query = 'deadmau5';
    await checkRoute(
        `/search/?q=${encodeURIComponent(query)}`,
        () =>
            instance.search({
                q: query,
            }),
        async (_res) => {}
    );
});

test('Fetch album info', async () => {
    await checkRoute(
        `/album/?id=${ALBUM_ID}`,
        () => instance.getAlbum(ALBUM_ID),
        async (info: { data: Album }) => {
            expect(info.data).toHaveProperty('cover');
            expect(info.data.cover).not.toBeUndefined();
        }
    );
});

test('Fetch playlist info', async () => {
    await checkRoute(
        `/playlist/?id=${PLAYLIST_ID}`,
        () => instance.getPlaylist(PLAYLIST_ID),
        async (info: { playlist: { image: string } }) => {
            expect(info.playlist).toHaveProperty('image');
            expect(info.playlist.image).not.toBeUndefined();
        },
        'playlist'
    );
});

test.skipIf(!instance.refreshToken)('Fetch lyrics ', async () => {
    await checkRoute(
        `/lyrics/?id=${TRACK_ATMOS}`,
        () => instance.getLyrics(TRACK_ATMOS),
        async (_info) => {},
        'lyrics'
    );
});

test('Fetch video ', async () => {
    await checkRoute(
        `/video/?id=${TRACK_VIDEO}`,
        () => instance.getVideo(TRACK_VIDEO),
        async (_info) => {},
        'video'
    );
});

test('Fetch track manifests ', async () => {
    await checkRoute(
        `/trackManifests/?id=${TRACK_LOSSLESS}`,
        () => instance.getTrackManifest(TRACK_LOSSLESS),
        async (_info) => {},
        'data'
    );
});
