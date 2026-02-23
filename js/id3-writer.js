import { getCoverBlob } from './utils.js';

async function writeID3v2Tag(mp3Blob, metadata, coverBlob = null) {
    const frames = [];

    if (metadata.title) {
        frames.push(createTextFrame('TIT2', metadata.title));
    }

    const artistName = metadata.artist?.name || metadata.artists?.[0]?.name;
    if (artistName) {
        frames.push(createTextFrame('TPE1', artistName));
    }

    if (metadata.album?.title) {
        frames.push(createTextFrame('TALB', metadata.album.title));
    }

    const albumArtistName = metadata.album?.artist?.name || metadata.artist?.name || metadata.artists?.[0]?.name;
    if (albumArtistName) {
        frames.push(createTextFrame('TPE2', albumArtistName));
    }

    if (metadata.trackNumber) {
        frames.push(createTextFrame('TRCK', metadata.trackNumber.toString()));
    }

    if (metadata.album?.releaseDate) {
        const year = new Date(metadata.album.releaseDate).getFullYear();
        if (!Number.isNaN(year) && Number.isFinite(year)) {
            frames.push(createTextFrame('TYER', year.toString()));
        }
    }

    if (metadata.isrc) {
        frames.push(createTextFrame('TSRC', metadata.isrc));
    }

    if (metadata.copyright) {
        frames.push(createTextFrame('TCOP', metadata.copyright));
    }

    frames.push(createTextFrame('TENC', 'Monochrome'));

    if (coverBlob) {
        frames.push(await createAPICFrame(coverBlob));
    }

    return buildID3v2Tag(mp3Blob, frames);
}

function createTextFrame(frameId, text) {
    // ID3v2.3 UTF-16 encoding with BOM
    const bom = new Uint8Array([0xff, 0xfe]); // UTF-16LE BOM
    const utf16Bytes = new Uint8Array(text.length * 2);
    
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        utf16Bytes[i * 2] = charCode & 0xff;
        utf16Bytes[i * 2 + 1] = (charCode >> 8) & 0xff;
    }
    
    const frameSize = 1 + bom.length + utf16Bytes.length;
    const frame = new Uint8Array(10 + frameSize);
    const view = new DataView(frame.buffer);

    for (let i = 0; i < 4; i++) {
        frame[i] = frameId.charCodeAt(i);
    }

    view.setUint32(4, frameSize, false);

    frame[10] = 0x01; // UTF-16 with BOM

    frame.set(bom, 11);
    frame.set(utf16Bytes, 11 + bom.length);

    return frame;
}

async function createAPICFrame(coverBlob) {
    const imageBytes = new Uint8Array(await coverBlob.arrayBuffer());
    const mimeType = coverBlob.type || 'image/jpeg';
    const mimeBytes = new TextEncoder().encode(mimeType);

    const frameSize = 1 + mimeBytes.length + 1 + 1 + 1 + imageBytes.length;

    const frame = new Uint8Array(10 + frameSize);
    const view = new DataView(frame.buffer);

    for (let i = 0; i < 4; i++) {
        frame[i] = 'APIC'.charCodeAt(i);
    }

    view.setUint32(4, frameSize, false);

    let offset = 10;
    frame[offset++] = 0x00;

    frame.set(mimeBytes, offset);
    offset += mimeBytes.length;
    frame[offset++] = 0x00;

    frame[offset++] = 0x03;

    frame[offset++] = 0x00;

    frame.set(imageBytes, offset);

    return frame;
}

function buildID3v2Tag(mp3Blob, frames) {
    const framesData = new Uint8Array(frames.reduce((acc, f) => acc + f.length, 0));
    let offset = 0;
    for (const frame of frames) {
        framesData.set(frame, offset);
        offset += frame.length;
    }

    const tagSize = framesData.length;

    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 0x03;
    header[4] = 0x00;
    header[5] = 0x00;

    header[6] = (tagSize >> 21) & 0x7f;
    header[7] = (tagSize >> 14) & 0x7f;
    header[8] = (tagSize >> 7) & 0x7f;
    header[9] = tagSize & 0x7f;

    return new Blob([header, framesData, mp3Blob], { type: 'audio/mpeg' });
}

export async function addMp3Metadata(mp3Blob, track, api) {
    try {
        let coverBlob = null;

        if (track.album?.cover) {
            try {
                coverBlob = await getCoverBlob(api, track.album.cover);
            } catch (error) {
                console.warn('Failed to fetch album art for MP3:', error);
            }
        }

        return await writeID3v2Tag(mp3Blob, track, coverBlob);
    } catch (error) {
        console.error('Failed to add MP3 metadata:', error);
        return mp3Blob;
    }
}
