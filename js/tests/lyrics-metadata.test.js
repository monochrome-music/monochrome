import { describe, expect, test } from 'vitest';
import { addMetadataWithTagLib, getMetadataWithTagLib } from '../taglib.ts';
import { addMetadataToAudio } from '../metadata.js';
import { createLyricsEntries } from '../download-lyrics.js';
import { nativeTTML, lyricsTrack as track } from './ttml-fixture.js';

const fixtures = import.meta.glob('./fixtures/lyrics-audio/*.{flac,mp3,m4a,wav}', {
    query: '?url',
    import: 'default',
    eager: true,
});
async function fixture(name) {
    return (await fetch(fixtures[`./fixtures/lyrics-audio/${name}`])).blob();
}
async function collect(entries) {
    const all = [];
    for await (const entry of entries) all.push(entry);
    return all;
}
const cover = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sYQAAAAASUVORK5CYII='),
    (c) => c.charCodeAt(0)
);

// Compare the encoded audio, rather than file hashes that necessarily change when tags change.
function audioPayload(bytes, name) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    if (name.endsWith('.flac')) {
        let offset = 4;
        let last = false;
        while (!last) {
            last = Boolean(bytes[offset] & 128);
            const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
            offset += 4 + length;
        }
        return bytes.slice(offset);
    }
    if (name.endsWith('.mp3')) {
        const start =
            bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51
                ? 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127)
                : 0;
        const end = String.fromCharCode(...bytes.slice(-128, -125)) === 'TAG' ? bytes.length - 128 : bytes.length;
        return bytes.slice(start, end);
    }
    let offset = 0;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
        if (type === 'mdat') return bytes.slice(offset + 8, offset + length);
        if (length < 8) break;
        offset += length;
    }
    throw new Error('Missing audio payload');
}

for (const name of ['sample.flac', 'sample.mp3', 'sample.m4a', 'sample-alac.m4a']) {
    describe(`TTML metadata: ${name}`, () => {
        test('round-trips XML exactly while preserving artwork, existing tags and encoded audio', async () => {
            const original = await fixture(name);
            const initial = await addMetadataWithTagLib(
                original,
                {
                    cover: { data: cover, type: 'image/png' },
                    extra: { TIDAL_TRACK_ID: 'existing-id' },
                },
                name,
                true,
                true
            );
            const written = await addMetadataWithTagLib(initial, { lyricsTTML: nativeTTML }, name, true, true);
            const data = await getMetadataWithTagLib(written, name, true);
            expect(data.lyricsTTML).toBe(nativeTTML);
            expect(data.title).toBe('Original');
            expect(data.albumTitle).toBe('Existing');
            expect(data.cover.data).toEqual(cover);
            expect(data.extra.TIDAL_TRACK_ID).toBe('existing-id');
            expect(audioPayload(new Uint8Array(await written.arrayBuffer()), name)).toEqual(
                audioPayload(new Uint8Array(await original.arrayBuffer()), name)
            );
        });
        test('metadata pipeline verifies embedding and respects separate-only mode', async () => {
            for (const mode of ['embedded', 'separate', 'both']) {
                const original = await fixture(name);
                const result = await addMetadataToAudio(original, track, null, 'LOSSLESS', {
                    coverFetch: Promise.resolve(null),
                    lyricsFetch: Promise.resolve({ format: 'ttml', content: nativeTTML }),
                    lyricsOptions: { format: 'ttml', fallback: false, mode },
                });
                const data = await getMetadataWithTagLib(result, name, true);
                expect(data.lyricsTTML).toBe(mode === 'separate' ? undefined : nativeTTML);
                expect(data.title).toBe(track.title);
                expect(data.albumTitle).toBe(track.album.title);
                const entries = await collect(
                    createLyricsEntries(result, 'Folder/Song.' + name.split('.').pop(), null, track)
                );
                expect(entries.length).toBe(mode === 'embedded' ? 0 : 1);
                if (entries.length) expect(entries[0].input).toBe(nativeTTML);
            }
        });
    });
}

test('unsupported WAV TTML embedding falls back to a separate original XML file', async () => {
    const original = await fixture('sample.wav');
    const result = await addMetadataToAudio(original, track, null, 'LOSSLESS', {
        coverFetch: Promise.resolve(null),
        lyricsFetch: Promise.resolve({ format: 'ttml', content: nativeTTML }),
        lyricsOptions: { format: 'ttml', fallback: false, mode: 'embedded' },
    });
    expect((await getMetadataWithTagLib(result, 'sample.wav', true)).lyricsTTML).toBeUndefined();
    const entries = await collect(createLyricsEntries(result, 'Song.wav', null, track));
    expect(entries[0].name).toBe('Song.ttml');
    expect(entries[0].input).toBe(nativeTTML);
});

test('existing LRC embedding still writes the ordinary lyrics field', async () => {
    const result = await addMetadataToAudio(await fixture('sample.flac'), track, null, 'LOSSLESS', {
        coverFetch: Promise.resolve(null),
        lyricsFetch: Promise.resolve({ format: 'lrc', content: '[00:01.00] Hello', embeddedText: '[00:01.00] Hello' }),
        lyricsOptions: { format: 'lrc', mode: 'both' },
    });
    const bytes = new TextDecoder().decode(await result.arrayBuffer());
    expect(bytes).toContain('LYRICS=[00:01.00] Hello');
    expect(bytes).not.toContain('LYRICS_TTML=');
});

test('failed metadata writes preserve the original blob and retain the TTML safety sidecar', async () => {
    const original = new Blob(['invalid audio'], { type: 'application/octet-stream' });
    const result = await addMetadataToAudio(original, track, null, 'LOSSLESS', {
        coverFetch: Promise.resolve(null),
        lyricsFetch: Promise.resolve({ format: 'ttml', content: nativeTTML }),
        lyricsOptions: { format: 'ttml', fallback: false, mode: 'embedded' },
    });
    expect(result).toBe(original);
    const entries = await collect(createLyricsEntries(result, 'Song.flac', null, track));
    expect(entries[0].input).toBe(nativeTTML);
});
