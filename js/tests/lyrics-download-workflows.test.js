import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest';
import {
    downloadAlbum,
    downloadPlaylist,
    downloadTracks,
    downloadLikedTracks,
    downloadTrackWithMetadata,
    downloadDiscography,
} from '../downloads.js';
import { LyricsManager } from '../lyrics.js';
import { modernSettings, BulkDownloadMethod } from '../ModernSettings.js';
import { lyricsSettings, playlistSettings } from '../storage.js';
import { recordDownloadLyrics } from '../download-lyrics.js';
import { SequentialFileWriter, FolderPickerWriter } from '../bulk-download-writer.ts';
import { downloadZip } from 'client-zip';
import { nativeTTML, lyricsTrack } from './ttml-fixture.js';

const tracks = [1, 2].map((i) => ({
    ...lyricsTrack,
    id: 'workflow-' + i,
    title: 'Song.' + i,
    trackNumber: i,
    volumeNumber: i,
}));
let output;
let api;
async function collect(entries) {
    for await (const entry of entries) output.push(entry);
}

beforeAll(async () => {
    try {
        void LyricsManager.instance;
    } catch {
        await LyricsManager.initialize(null);
    }
    await modernSettings.waitPending();
});
beforeEach(() => {
    localStorage.clear();
    output = [];
    modernSettings.bulkDownloadMethod = BulkDownloadMethod.Individual;
    modernSettings.folderTemplate = '{albumTitle}';
    modernSettings.filenameTemplate = '{trackNumber} {title}';
    modernSettings.downloadSinglesToFolder = false;
    lyricsSettings.setPreferredFormat('ttml');
    lyricsSettings.setDownloadMode('both');
    localStorage.setItem(playlistSettings.SEPARATE_DISCS_KEY, 'true');
    api = {
        downloadTrack: vi.fn(async () => {
            const blob = new Blob(['fLaC' + '\0'.repeat(40)]);
            recordDownloadLyrics(blob, { format: 'ttml', content: nativeTTML }, true, { mode: 'both' });
            return blob;
        }),
        getTrackMetadata: vi.fn(async (id) => tracks.find((t) => t.id === id)),
        enrichTrack: vi.fn(async (track) => ({ enrichedTrack: track })),
        getCoverUrl: () => '',
    };
    vi.spyOn(SequentialFileWriter, 'write').mockImplementation(collect);
});
afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.download-task').forEach((el) => el.remove());
});

function expectPairs() {
    const audio = output.filter((f) => f.name.endsWith('.flac'));
    const lyrics = output.filter((f) => f.name.endsWith('.ttml'));
    expect(audio).toHaveLength(2);
    expect(lyrics).toHaveLength(2);
    for (const entry of audio)
        expect(lyrics.find((l) => l.name === entry.name.replace(/\.flac$/, '.ttml'))?.input).toBe(nativeTTML);
    expect(output.some((f) => f.name.endsWith('.lrc'))).toBe(false);
}

test('album downloads keep matching names and disc folders', async () => {
    await downloadAlbum({ title: 'Album', artist: { name: 'Singer' } }, tracks, api, 'LOSSLESS');
    expectPairs();
    expect(output.some((f) => f.name.includes('Disc 2/'))).toBe(true);
});
test('playlist downloads use playlist sequence numbers with matching TTML', async () => {
    await downloadPlaylist({ title: 'Playlist' }, [tracks[1], tracks[0]], api, 'LOSSLESS');
    expectPairs();
    expect(output.find((f) => f.name.endsWith('.flac')).name).toContain('01 Song.2');
});
test.each([
    ['queue', downloadTracks],
    ['liked', downloadLikedTracks],
])('%s bulk downloads include original TTML', async (_name, download) => {
    await download(tracks, api, 'LOSSLESS');
    expectPairs();
});
test('discography downloads use the shared sidecar policy', async () => {
    api.getAlbum = vi.fn(async () => ({ album: { title: 'Album', artist: { name: 'Singer' } }, tracks }));
    await downloadDiscography({ name: 'Singer' }, [{ id: 'album', title: 'Album' }], api, 'LOSSLESS');
    expectPairs();
});
test('single-track downloads write sidecars even without an explicit lyrics manager', async () => {
    await downloadTrackWithMetadata(tracks[0], 'LOSSLESS', api);
    const audio = output.find((f) => f.name.endsWith('.flac'));
    expect(audio).toBeDefined();
    expect(output.find((f) => f.name === audio.name.replace(/\.flac$/, '.ttml'))?.input).toBe(nativeTTML);
});
test('failed audio downloads do not emit orphan lyrics and the next track succeeds', async () => {
    api.downloadTrack.mockRejectedValueOnce(new Error('network failure'));
    await downloadPlaylist({ title: 'Playlist' }, tracks, api, 'LOSSLESS');
    expect(output.filter((f) => f.name.endsWith('.flac'))).toHaveLength(1);
    expect(output.filter((f) => f.name.endsWith('.ttml'))).toHaveLength(1);
});

// client-zip writes stored entries. Inspect its central directory and actual payload bytes.
async function zipFiles(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const files = new Map();
    for (let p = 0; p + 46 < bytes.length; p++) {
        if (view.getUint32(p, true) !== 0x02014b50) continue;
        const size = view.getUint32(p + 24, true),
            nameLength = view.getUint16(p + 28, true),
            offset = view.getUint32(p + 42, true);
        const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLength));
        files.set(name, new TextDecoder().decode(bytes.slice(start, start + size)));
    }
    return files;
}
test('ZIP archive contains original UTF-8 TTML and matching audio paths', async () => {
    await downloadAlbum({ title: 'Album' }, tracks, api, 'LOSSLESS');
    const archive = await downloadZip(output).blob();
    const files = await zipFiles(archive);
    for (const entry of output.filter((f) => f.name.endsWith('.ttml'))) expect(files.get(entry.name)).toBe(nativeTTML);
    expect([...files.keys()].filter((name) => name.endsWith('.ttml'))).toHaveLength(2);
});
test('actual ZIP download writer includes the selected TTML files', async () => {
    modernSettings.bulkDownloadMethod = BulkDownloadMethod.Zip;
    modernSettings.forceZipBlob = true;
    let href;
    let zipBlob;
    const createURL = URL.createObjectURL.bind(URL);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        zipBlob = blob;
        return createURL(blob);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        href = this.href;
    });
    await downloadPlaylist({ title: 'ZIP Playlist' }, tracks, api, 'LOSSLESS');
    expect(href).toMatch(/^blob:/);
    const files = await zipFiles(zipBlob);
    expect([...files.values()].filter((content) => content === nativeTTML)).toHaveLength(2);
});
test('folder writer saves UTF-8 TTML beside audio without modifying the XML', async () => {
    const saved = new Map();
    const dir = (path = '') => ({
        getDirectoryHandle: async (name) => dir(path + name + '/'),
        getFileHandle: async (name) => ({
            createWritable: async () => ({
                write: async (blob) => saved.set(path + name, await blob.text()),
                close: async () => {},
                abort: async () => {},
            }),
        }),
    });
    const writer = FolderPickerWriter.fromHandle(dir());
    vi.spyOn(FolderPickerWriter, 'create').mockResolvedValue(writer);
    vi.stubGlobal('showDirectoryPicker', async () => dir());
    modernSettings.bulkDownloadMethod = BulkDownloadMethod.Folder;
    modernSettings.rememberBulkDownloadFolder = false;
    try {
        await downloadAlbum({ title: 'Folder Album' }, tracks, api, 'LOSSLESS');
        expect([...saved.keys()].filter((name) => name.endsWith('.ttml'))).toHaveLength(2);
        for (const [name, content] of saved)
            if (name.endsWith('.ttml')) {
                expect(content).toBe(nativeTTML);
                expect(saved.has(name.replace(/\.ttml$/, '.flac'))).toBe(true);
            }
    } finally {
        vi.unstubAllGlobals();
    }
});
