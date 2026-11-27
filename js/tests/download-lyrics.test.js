import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { fetchNativeTTML, getNativeTTML } from '../native-ttml.js';
import {
    createLyricsEntries,
    fetchDownloadLyrics,
    getDownloadLyricsOptions,
    recordDownloadLyrics,
} from '../download-lyrics.js';
import { lyricsSettings } from '../storage.js';
import { nativeTTML, lyricsTrack as track } from './ttml-fixture.js';

let fetchSpy;
const collect = async (entries) => {
    const result = [];
    for await (const entry of entries) result.push(entry);
    return result;
};
const manager = () => ({
    fetchLyrics: vi.fn(async () => ({ subtitles: '[00:01.00] Hello' })),
    generateLRCContent: (data) => data?.subtitles || null,
});
const nativeResponse = () => new Response(JSON.stringify({ source: nativeTTML }));

beforeEach(() => {
    localStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
});
afterEach(() => vi.restoreAllMocks());

describe('native retrieval', () => {
    test('retrieves original TTML by ISRC from the playback provider', async () => {
        fetchSpy.mockImplementation(async () => nativeResponse());
        expect(await fetchNativeTTML(track)).toEqual({ originalTTML: nativeTTML, lyricsProvider: 'lrc.red' });
        expect(fetchSpy.mock.calls[0][0]).toBe('https://lrc.red/s/USAAA1234567.song.json');
    });
    test('uses title/artist matching when ISRC is unavailable', async () => {
        fetchSpy.mockImplementation(async (url) =>
            url.includes('match.json') ? new Response(JSON.stringify({ hits: [{ isrc: 'MATCH' }] })) : nativeResponse()
        );
        expect((await fetchNativeTTML({ ...track, isrc: '' })).originalTTML).toBe(nativeTTML);
        expect(fetchSpy.mock.calls[0][0]).toContain('track=Song.Name&artist=Singer');
    });
    test('falls through malformed lrc.red data to BiniLyrics and its original XML URL', async () => {
        fetchSpy.mockImplementation(async (url) => {
            if (url.includes('lyrics-api.binimum.org'))
                return new Response(JSON.stringify({ results: [{ lyricsUrl: 'https://lyrics.example/song.ttml' }] }));
            if (url === 'https://lyrics.example/song.ttml') return new Response(nativeTTML);
            return new Response(JSON.stringify({ source: '<tt>' }));
        });
        expect((await fetchNativeTTML(track)).lyricsProvider).toBe('BiniLyrics');
    });
    test('rejects malformed timing while accepting TTML offset times', () => {
        expect(getNativeTTML(nativeTTML.replace('00:00:01.123', 'not-a-time'))).toBeNull();
        expect(getNativeTTML(nativeTTML.replaceAll('00:00:01.123', '1.123s'))).toContain('1.123s');
    });
    test('handles API errors and respects cancellation', async () => {
        fetchSpy.mockRejectedValue(new TypeError('offline'));
        expect(await fetchNativeTTML(track)).toBeNull();
        const controller = new AbortController();
        controller.abort();
        await expect(fetchNativeTTML(track, { signal: controller.signal })).rejects.toThrow();
    });
    test('rejects entity declarations, empty XML, wrong namespaces and oversized XML', () => {
        for (const xml of [
            '',
            '<tt xmlns="http://www.w3.org/ns/ttml"><body/></tt>',
            '<!DOCTYPE tt>' + nativeTTML,
            '<tt xmlns="bad"><p>Hello</p></tt>',
            'x'.repeat(4 * 1024 * 1024 + 1),
        ]) {
            expect(getNativeTTML(xml)).toBeNull();
        }
    });
});

describe('format selection and sidecars', () => {
    test('LRC remains the default and makes no TTML API requests', async () => {
        const result = await fetchDownloadLyrics(manager(), track);
        expect(result.format).toBe('lrc');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    test('TTML preserves XML and coalesces concurrent requests', async () => {
        fetchSpy.mockImplementation(async () => nativeResponse());
        const m = manager();
        const options = { format: 'ttml', fallback: false, mode: 'both' };
        const [a, b] = await Promise.all([
            fetchDownloadLyrics(m, track, options),
            fetchDownloadLyrics(m, track, options),
        ]);
        expect(a.content).toBe(nativeTTML);
        expect(b).toEqual(a);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(m.fetchLyrics).not.toHaveBeenCalled();
    });
    test('strict TTML skips unavailable lyrics, optional fallback and Auto use LRC', async () => {
        expect(await fetchDownloadLyrics(manager(), track, { format: 'ttml', fallback: false })).toBeNull();
        expect((await fetchDownloadLyrics(manager(), track, { format: 'ttml', fallback: true })).format).toBe('lrc');
        expect((await fetchDownloadLyrics(manager(), track, { format: 'auto', fallback: false })).format).toBe('lrc');
    });
    test('missing LRC does not produce an empty or mislabeled file', async () => {
        lyricsSettings.setDownloadMode('separate');
        const m = manager();
        m.fetchLyrics.mockResolvedValue(null);
        expect(await collect(createLyricsEntries(new Blob(), 'a.flac', m, track))).toEqual([]);
    });
    test.each(['separate', 'both'])('%s generates matching filenames with original TTML', async (mode) => {
        const blob = new Blob();
        recordDownloadLyrics(blob, { format: 'ttml', content: nativeTTML }, true, { mode });
        const entries = await collect(createLyricsEntries(blob, 'Album.v1/Disc 2/01 Song.Name.m4a', manager(), track));
        expect(entries[0].name).toBe('Album.v1/Disc 2/01 Song.Name.ttml');
        expect(entries[0].input).toBe(nativeTTML);
    });
    test('embedded mode suppresses TTML sidecar only after verified embedding', async () => {
        for (const embedded of [true, false]) {
            const blob = new Blob();
            recordDownloadLyrics(blob, { format: 'ttml', content: nativeTTML }, embedded, { mode: 'embedded' });
            expect((await collect(createLyricsEntries(blob, 'Song.mp3', manager(), track))).length).toBe(
                embedded ? 0 : 1
            );
        }
    });
    test('an unsupported/untagged output still receives TTML in embedded mode', async () => {
        fetchSpy.mockImplementation(async () => nativeResponse());
        lyricsSettings.setPreferredFormat('ttml');
        const entries = await collect(createLyricsEntries(new Blob(), 'Song.wav', manager(), track));
        expect(entries[0].name).toBe('Song.ttml');
    });
});

describe('settings persistence and compatibility', () => {
    test('derives legacy behavior without rewriting stored settings', () => {
        expect(getDownloadLyricsOptions()).toEqual({ format: 'lrc', fallback: true, mode: 'embedded' });
        localStorage.setItem(lyricsSettings.DOWNLOAD_WITH_TRACKS, 'true');
        expect(getDownloadLyricsOptions().mode).toBe('both');
        expect(localStorage.getItem(lyricsSettings.DOWNLOAD_MODE)).toBeNull();
    });
    test('stores selections, validates invalid values, and retains independent preferences', () => {
        lyricsSettings.setPreferredFormat('ttml');
        lyricsSettings.setFallbackToLRC(false);
        lyricsSettings.setDownloadMode('separate');
        expect(getDownloadLyricsOptions()).toEqual({ format: 'ttml', fallback: false, mode: 'separate' });
        expect(localStorage.getItem(lyricsSettings.PREFERRED_FORMAT)).toBe('ttml');
        lyricsSettings.setPreferredFormat('bad');
        lyricsSettings.setDownloadMode('bad');
        expect(lyricsSettings.getPreferredFormat()).toBe('ttml');
        expect(lyricsSettings.getDownloadMode()).toBe('separate');
        lyricsSettings.setDownloadLyrics(false);
        expect(lyricsSettings.getDownloadMode()).toBe('embedded');
        expect(lyricsSettings.shouldFallbackToLRC()).toBe(false);
    });
});
