import { getCoverBlob, getTrackTitle, getTrackCoverId } from './utils.js';

export async function writeID3v2Tag(mp3Blob, metadata, coverBlob = null) {
    const frames = [];

    if (metadata.title) {
        frames.push(createTextFrame('TIT2', getTrackTitle(metadata)));
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

export function createTextFrame(frameId, text) {
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

export async function createAPICFrame(coverBlob) {
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

export function buildID3v2Tag(mp3Blob, frames) {
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

export async function addMp3Metadata(mp3Blob, track, api, coverBlob = null) {
    try {
        if (!coverBlob) {
            const coverId = getTrackCoverId(track);
            if (coverId) {
                try {
                    coverBlob = await getCoverBlob(api, coverId);
                } catch (error) {
                    console.warn('Failed to fetch album art for MP3:', error);
                }
            }
        }

        return await writeID3v2Tag(mp3Blob, track, coverBlob);
    } catch (error) {
        console.error('Failed to add MP3 metadata:', error);
        return mp3Blob;
    }
}

export async function readMp3Metadata(file, metadata) {
    let buffer = await file.slice(0, 10).arrayBuffer();
    let view = new DataView(buffer);

    if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
        const majorVer = view.getUint8(3);
        const size = readSynchsafeInteger32(view, 6);
        const tagSize = size + 10;

        buffer = await file.slice(0, tagSize).arrayBuffer();
        view = new DataView(buffer);

        let offset = 10;
        if ((view.getUint8(5) & 0x40) !== 0) {
            const extSize = readSynchsafeInteger32(view, offset);
            offset += extSize;
        }

        let tpe1 = null;
        let tpe2 = null;
        while (offset < view.byteLength) {
            let frameId, frameSize;

            if (majorVer === 3) {
                frameId = new TextDecoder().decode(new Uint8Array(buffer, offset, 4));
                frameSize = view.getUint32(offset + 4, false);
                offset += 10;
            } else if (majorVer === 4) {
                frameId = new TextDecoder().decode(new Uint8Array(buffer, offset, 4));
                frameSize = readSynchsafeInteger32(view, offset + 4);
                offset += 10;
            } else {
                break;
            }

            if (frameId.charCodeAt(0) === 0) break;
            if (offset + frameSize > view.byteLength) break;

            const frameData = new DataView(buffer, offset, frameSize);
            if (frameId === 'TIT2') metadata.title = readID3Text(frameData);
            if (frameId === 'TPE1') tpe1 = readID3Text(frameData);
            if (frameId === 'TPE2') tpe2 = readID3Text(frameData);
            if (frameId === 'TALB') metadata.album.title = readID3Text(frameData);
            if (frameId === 'TSRC') metadata.isrc = readID3Text(frameData);
            if (frameId === 'TCOP') metadata.copyright = readID3Text(frameData);
            if (frameId === 'TLEN') metadata.duration = parseInt(readID3Text(frameData)) / 1000; // usually not present
            if (frameId === 'TYER' || frameId === 'TDRC') {
                const year = readID3Text(frameData);
                if (year) metadata.album.releaseDate = year;
            }
            if (frameId === 'APIC') {
                try {
                    const encoding = frameData.getUint8(0);
                    let mimeType = '';
                    let pos = 1;
                    while (pos < frameData.byteLength && frameData.getUint8(pos) !== 0) {
                        mimeType += String.fromCharCode(frameData.getUint8(pos));
                        pos++;
                    }
                    pos++;
                    pos++;
                    let terminator = encoding === 1 || encoding === 2 ? 2 : 1;
                    while (pos < frameData.byteLength) {
                        if (frameData.getUint8(pos) === 0) {
                            if (terminator === 1) {
                                pos++;
                                break;
                            } else if (pos + 1 < frameData.byteLength && frameData.getUint8(pos + 1) === 0) {
                                pos += 2;
                                break;
                            }
                        }
                        pos++;
                    }
                    const pictureData = new Uint8Array(buffer, offset + pos, frameSize - pos);
                    const blob = new Blob([pictureData], { type: mimeType || 'image/jpeg' });
                    metadata.album.cover = URL.createObjectURL(blob);
                } catch (e) {
                    console.warn('Error parsing APIC:', e);
                }
            }

            offset += frameSize;
        }

        const artistStr = tpe1 || tpe2;
        if (artistStr) {
            metadata.artists = artistStr.split('/').map((name) => ({ name: name.trim() }));
        }

        if (!metadata.duration || metadata.duration === 0) {
            metadata.duration = await calculateMp3Duration(file, tagSize);
        }
    }

    if (file.size > 128) {
        const tailBuffer = await file.slice(file.size - 128).arrayBuffer();
        const tag = new TextDecoder().decode(new Uint8Array(tailBuffer, 0, 3));
        if (tag === 'TAG') {
            const title = new TextDecoder()
                .decode(new Uint8Array(tailBuffer, 3, 30))
                .replace(/\0/g, '')
                .trim();
            const artist = new TextDecoder()
                .decode(new Uint8Array(tailBuffer, 33, 30))
                .replace(/\0/g, '')
                .trim();
            const album = new TextDecoder()
                .decode(new Uint8Array(tailBuffer, 63, 30))
                .replace(/\0/g, '')
                .trim();
            if (title) metadata.title = title;
            if (artist && metadata.artists.length === 0) {
                metadata.artists = [{ name: artist }];
            }
            if (album) metadata.album.title = album;
        }
    }
}

// since mp3 file don't have metadata about duration, estimating it
// uses evil bitwise magic
export async function calculateMp3Duration(file, startOffset) {
    const buffer = await file.slice(startOffset, startOffset + 32768).arrayBuffer();
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    let offset = 0;

    // finding sync word
    while (offset < view.byteLength - 4 && !(uint8[offset] === 0xff && (uint8[offset + 1] & 0xe0) === 0xe0)) {
        offset++;
    }
    if (offset >= view.byteLength - 4) return 0;

    const header = view.getUint32(offset, false);

    // header info
    const mpegVer = (header >> 19) & 3;
    const brIdx = (header >> 12) & 15;
    const srIdx = (header >> 10) & 3;

    // Reject invalid headers
    if (mpegVer === 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return 0;

    const sampleRates = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]];
    const brMpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const brMpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

    const sampleRate = sampleRates[mpegVer][srIdx];
    const bitrate = mpegVer === 3 ? brMpeg1[brIdx] : brMpeg2[brIdx];

    // this xing header is present in many mp3 files and contains total frame count, which allows for accurate duration calculation
    const channelMode = (header >> 6) & 3; // mono or stereo
    const xingOffset = offset + 4 + (mpegVer === 3 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17); // the position of xing header

    if (xingOffset + 8 <= view.byteLength) {
        const sig = view.getUint32(xingOffset, false);
        if ((sig === 0x58696e67 || sig === 0x496e666f) && view.getUint32(xingOffset + 4, false) & 1) {
            const frames = view.getUint32(xingOffset + 8, false);
            // basically, duration = frames * samples per frame / sample rate
            return (frames * (mpegVer === 3 ? 1152 : 576)) / sampleRate;
        }
    }

    // if no Xing header, estimate duration from file size and bitrate
    return ((file.size - startOffset) * 8) / (bitrate * 1000);
}

export function readSynchsafeInteger32(view, offset) {
    return (
        ((view.getUint8(offset) & 0x7f) << 21) |
        ((view.getUint8(offset + 1) & 0x7f) << 14) |
        ((view.getUint8(offset + 2) & 0x7f) << 7) |
        (view.getUint8(offset + 3) & 0x7f)
    );
}

export function readID3Text(view) {
    const encoding = view.getUint8(0);
    const buffer = view.buffer.slice(view.byteOffset + 1, view.byteOffset + view.byteLength);
    let decoder;
    if (encoding === 0) decoder = new TextDecoder('iso-8859-1');
    else if (encoding === 1) decoder = new TextDecoder('utf-16');
    else if (encoding === 2) decoder = new TextDecoder('utf-16be');
    else decoder = new TextDecoder('utf-8');

    return decoder.decode(buffer).replace(/\0/g, '');
}
