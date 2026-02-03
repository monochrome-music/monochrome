import { getCoverBlob } from './utils.js';

const VENDOR_STRING = 'Monochrome';
const DEFAULT_TITLE = 'Unknown Title';
const DEFAULT_ARTIST = 'Unknown Artist';
const DEFAULT_ALBUM = 'Unknown Album';

/**
 * Adds metadata tags to audio files (FLAC or M4A)
 * @param {Blob} audioBlob - The audio file blob
 * @param {Object} track - Track metadata
 * @param {Object} api - API instance for fetching album art
 * @param {string} quality - Audio quality
 * @returns {Promise<Blob>} - Audio blob with embedded metadata
 */
export async function addMetadataToAudio(audioBlob, track, api, _quality) {
    // Always check actual file signature, not just quality setting
    // DASH Hi-Res streams may return fragmented MP4 instead of raw FLAC
    const buffer = await audioBlob.slice(0, 12).arrayBuffer();
    const view = new DataView(buffer);

    // Check for FLAC signature: "fLaC" (0x66 0x4C 0x61 0x43)
    const isFlac =
        view.byteLength >= 4 &&
        view.getUint8(0) === 0x66 && // f
        view.getUint8(1) === 0x4c && // L
        view.getUint8(2) === 0x61 && // a
        view.getUint8(3) === 0x43; // C

    if (isFlac) {
        return await addFlacMetadata(audioBlob, track, api);
    }

    // Check for MP4/M4A signature: "ftyp" at offset 4
    const isMp4 =
        view.byteLength >= 8 &&
        view.getUint8(4) === 0x66 && // f
        view.getUint8(5) === 0x74 && // t
        view.getUint8(6) === 0x79 && // y
        view.getUint8(7) === 0x70; // p

    if (isMp4) {
        return await addM4aMetadata(audioBlob, track, api);
    }

    // Fallback: check MIME type from blob
    const mime = audioBlob.type;
    if (mime === 'audio/flac') {
        return await addFlacMetadata(audioBlob, track, api);
    }
    if (mime === 'audio/mp4' || mime === 'audio/x-m4a') {
        return await addM4aMetadata(audioBlob, track, api);
    }

    // Unknown format - return original without modification
    console.warn(`Unknown audio format (mime: ${mime}), returning original blob`);
    return audioBlob;
}

/**
 * Reads metadata from a file
 * @param {File} file
 * @returns {Promise<Object>} Track metadata
 */
export async function readTrackMetadata(file) {
    const metadata = {
        title: file.name.replace(/\.[^/.]+$/, ''),
        artists: [],
        artist: { name: 'Unknown Artist' }, // For fallback/compatibility
        album: { title: 'Unknown Album', cover: 'assets/appicon.png', releaseDate: null },
        duration: 0,
        isLocal: true,
        file: file,
        id: `local-${file.name}-${file.lastModified}`,
    };

    try {
        if (file.type === 'audio/flac' || file.name.endsWith('.flac')) {
            await readFlacMetadata(file, metadata);
        } else if (file.type === 'audio/mp4' || file.name.endsWith('.m4a')) {
            await readM4aMetadata(file, metadata);
        } else if (file.type === 'audio/mpeg' || file.name.endsWith('.mp3')) {
            await readMp3Metadata(file, metadata);
        }
    } catch (e) {
        console.warn('Error reading metadata for', file.name, e);
    }

    if (metadata.artists.length > 0) {
        metadata.artist = metadata.artists[0];
    }

    return metadata;
}

async function readFlacMetadata(file, metadata) {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    if (!isFlacFile(dataView)) return;

    const blocks = parseFlacBlocks(dataView);
    const vorbisBlock = blocks.find((b) => b.type === 4);

    const artists = [];
    if (vorbisBlock) {
        const offset = vorbisBlock.offset;
        const vendorLen = dataView.getUint32(offset, true);
        let pos = offset + 4 + vendorLen;
        const commentListLen = dataView.getUint32(pos, true);
        pos += 4;

        for (let i = 0; i < commentListLen; i++) {
            const len = dataView.getUint32(pos, true);
            pos += 4;
            const comment = new TextDecoder().decode(new Uint8Array(arrayBuffer, pos, len));
            pos += len;

            const eqIdx = comment.indexOf('=');
            if (eqIdx > -1) {
                const key = comment.substring(0, eqIdx);
                const value = comment.substring(eqIdx + 1);
                const upperKey = key.toUpperCase();
                if (upperKey === 'TITLE') metadata.title = value;
                if (upperKey === 'ARTIST' || upperKey === 'ALBUMARTIST') {
                    artists.push(value);
                }
                if (upperKey === 'ALBUM') metadata.album.title = value;
            }
        }
    }

    if (artists.length > 0) {
        metadata.artists = artists.flatMap((a) => a.split(/; |\/|\\/)).map((name) => ({ name: name.trim() }));
    }
}

async function readM4aMetadata(file, metadata) {
    try {
        const chunkSize = Math.min(file.size, 5 * 1024 * 1024);
        const buffer = await file.slice(0, chunkSize).arrayBuffer();
        const view = new DataView(buffer);

        const atoms = parseMp4Atoms(view);

        const moov = atoms.find((a) => a.type === 'moov');
        if (!moov) return;

        const moovStart = moov.offset + 8;
        const moovLen = moov.size - 8;
        const moovData = new DataView(view.buffer, moovStart, moovLen);
        const moovAtoms = parseMp4Atoms(moovData);

        const udta = moovAtoms.find((a) => a.type === 'udta');
        if (!udta) return;

        const udtaStart = moovStart + udta.offset + 8;
        const udtaLen = udta.size - 8;
        const udtaData = new DataView(view.buffer, udtaStart, udtaLen);
        const udtaAtoms = parseMp4Atoms(udtaData);

        const meta = udtaAtoms.find((a) => a.type === 'meta');
        if (!meta) return;

        const metaStart = udtaStart + meta.offset + 12;
        const metaLen = meta.size - 12;
        const metaData = new DataView(view.buffer, metaStart, metaLen);
        const metaAtoms = parseMp4Atoms(metaData);

        const ilst = metaAtoms.find((a) => a.type === 'ilst');
        if (!ilst) return;

        const ilstStart = metaStart + ilst.offset + 8;
        const ilstLen = ilst.size - 8;
        const ilstData = new DataView(view.buffer, ilstStart, ilstLen);
        const items = parseMp4Atoms(ilstData);

        let artistStr = null;

        for (const item of items) {
            const itemStart = ilstStart + item.offset + 8;
            const itemLen = item.size - 8;
            const itemData = new DataView(view.buffer, itemStart, itemLen);
            const dataAtom = parseMp4Atoms(itemData).find((a) => a.type === 'data');
            if (dataAtom) {
                const contentLen = dataAtom.size - 16;
                const contentOffset = itemStart + dataAtom.offset + 16;

                if (item.type === '©nam') {
                    metadata.title = new TextDecoder().decode(new Uint8Array(view.buffer, contentOffset, contentLen));
                } else if (item.type === '©ART') {
                    artistStr = new TextDecoder().decode(new Uint8Array(view.buffer, contentOffset, contentLen));
                } else if (item.type === '©alb') {
                    metadata.album.title = new TextDecoder().decode(
                        new Uint8Array(view.buffer, contentOffset, contentLen)
                    );
                }
            }
        }

        if (artistStr) {
            metadata.artists = artistStr.split(/; |\/|\\/).map((name) => ({ name: name.trim() }));
        }
    } catch (e) {
        console.warn('Error parsing M4A:', e);
    }
}

async function readMp3Metadata(file, metadata) {
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
            if (frameId === 'TYER' || frameId === 'TDRC') {
                const year = readID3Text(frameData);
                if (year) metadata.album.releaseDate = year;
            }

            offset += frameSize;
        }

        const artistStr = tpe1 || tpe2;
        if (artistStr) {
            metadata.artists = artistStr.split('/').map((name) => ({ name: name.trim() }));
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

function readSynchsafeInteger32(view, offset) {
    return (
        ((view.getUint8(offset) & 0x7f) << 21) |
        ((view.getUint8(offset + 1) & 0x7f) << 14) |
        ((view.getUint8(offset + 2) & 0x7f) << 7) |
        (view.getUint8(offset + 3) & 0x7f)
    );
}

function readID3Text(view) {
    const encoding = view.getUint8(0);
    const buffer = view.buffer.slice(view.byteOffset + 1, view.byteOffset + view.byteLength);
    let decoder;
    if (encoding === 0) decoder = new TextDecoder('iso-8859-1');
    else if (encoding === 1) decoder = new TextDecoder('utf-16');
    else if (encoding === 2) decoder = new TextDecoder('utf-16be');
    else decoder = new TextDecoder('utf-8');

    return decoder.decode(buffer).replace(/\0/g, '');
}

/**
 * Adds Vorbis comment metadata to FLAC files
 */
async function addFlacMetadata(flacBlob, track, api) {
    try {
        const arrayBuffer = await flacBlob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        // Verify FLAC signature
        if (!isFlacFile(dataView)) {
            console.warn('Not a valid FLAC file, returning original');
            return flacBlob;
        }

        // Parse FLAC structure
        const blocks = parseFlacBlocks(dataView);

        // If parsing failed or no audio data found, return original
        if (!blocks || blocks.length === 0 || blocks.audioDataOffset === undefined) {
            console.warn('Failed to parse FLAC blocks, returning original');
            return flacBlob;
        }

        // Check for STREAMINFO block (must be first, type 0)
        if (blocks[0].type !== 0) {
            console.warn('FLAC file missing STREAMINFO block, returning original');
            return flacBlob;
        }

        // Create or update Vorbis comment block
        const vorbisCommentBlock = createVorbisCommentBlock(track);

        // Fetch album artwork if available
        let pictureBlock = null;
        if (track.album?.cover) {
            try {
                pictureBlock = await createFlacPictureBlock(track.album.cover, api);
            } catch (error) {
                console.warn('Failed to embed album art:', error);
            }
        }

        // Rebuild FLAC file with new metadata
        let newFlacData;
        try {
            newFlacData = rebuildFlacWithMetadata(dataView, blocks, vorbisCommentBlock, pictureBlock);
        } catch (rebuildError) {
            console.error('Failed to rebuild FLAC structure:', rebuildError);
            return flacBlob;
        }

        // Validate the rebuilt file
        const validationView = new DataView(newFlacData.buffer);
        if (!isFlacFile(validationView)) {
            console.error('Rebuilt FLAC has invalid signature, returning original');
            return flacBlob;
        }

        // Validate new file has proper block structure
        const newBlocks = parseFlacBlocks(validationView);
        if (!newBlocks || newBlocks.length === 0 || newBlocks.audioDataOffset === undefined) {
            console.error('Rebuilt FLAC has invalid block structure, returning original');
            return flacBlob;
        }

        return new Blob([newFlacData], { type: 'audio/flac' });
    } catch (error) {
        console.error('Failed to add FLAC metadata:', error);
        return flacBlob;
    }
}

function isFlacFile(dataView) {
    // Check for "fLaC" signature at the beginning
    return (
        dataView.byteLength >= 4 &&
        dataView.getUint8(0) === 0x66 && // 'f'
        dataView.getUint8(1) === 0x4c && // 'L'
        dataView.getUint8(2) === 0x61 && // 'a'
        dataView.getUint8(3) === 0x43
    ); // 'C'
}

function parseFlacBlocks(dataView) {
    const blocks = [];
    let offset = 4; // Skip "fLaC" signature

    while (offset + 4 <= dataView.byteLength) {
        const header = dataView.getUint8(offset);
        const isLast = (header & 0x80) !== 0;
        const blockType = header & 0x7f;

        // Block type 127 is invalid, types > 6 are reserved (except 127)
        // Valid types: 0=STREAMINFO, 1=PADDING, 2=APPLICATION, 3=SEEKTABLE, 4=VORBIS_COMMENT, 5=CUESHEET, 6=PICTURE
        if (blockType === 127) {
            console.warn('Encountered invalid block type 127, stopping parse');
            break;
        }

        const blockSize =
            (dataView.getUint8(offset + 1) << 16) |
            (dataView.getUint8(offset + 2) << 8) |
            dataView.getUint8(offset + 3);

        // Validate block size
        if (blockSize < 0 || offset + 4 + blockSize > dataView.byteLength) {
            console.warn(`Invalid block size ${blockSize} at offset ${offset}, stopping parse`);
            break;
        }

        blocks.push({
            type: blockType,
            isLast: isLast,
            size: blockSize,
            offset: offset + 4,
            headerOffset: offset,
        });

        offset += 4 + blockSize;

        if (isLast) {
            // Save the audio data offset
            blocks.audioDataOffset = offset;
            break;
        }
    }

    // If we didn't find the last block marker, estimate audio offset
    if (blocks.audioDataOffset === undefined && blocks.length > 0) {
        const lastBlock = blocks[blocks.length - 1];
        blocks.audioDataOffset = lastBlock.headerOffset + 4 + lastBlock.size;
        console.warn('No last-block marker found, estimated audio offset:', blocks.audioDataOffset);
    }

    return blocks;
}

function createVorbisCommentBlock(track) {
    // Vorbis comment structure
    const comments = [];

    // Add standard tags
    if (track.title) {
        comments.push(['TITLE', track.title]);
    }
    if (track.artist?.name) {
        comments.push(['ARTIST', track.artist.name]);
    }
    if (track.album?.title) {
        comments.push(['ALBUM', track.album.title]);
    }
    const albumArtist = track.album?.artist?.name || track.artist?.name;
    if (albumArtist) {
        comments.push(['ALBUMARTIST', albumArtist]);
    }
    if (track.trackNumber) {
        comments.push(['TRACKNUMBER', String(track.trackNumber)]);
    }
    if (track.album?.numberOfTracks) {
        comments.push(['TRACKTOTAL', String(track.album.numberOfTracks)]);
    }

    const releaseDateStr =
        track.album?.releaseDate || (track.streamStartDate ? track.streamStartDate.split('T')[0] : '');
    if (releaseDateStr) {
        try {
            const year = new Date(releaseDateStr).getFullYear();
            if (!isNaN(year)) {
                comments.push(['DATE', String(year)]);
            }
        } catch {
            // Invalid date, skip
        }
    }

    if (track.copyright) {
        comments.push(['COPYRIGHT', track.copyright]);
    }
    if (track.isrc) {
        comments.push(['ISRC', track.isrc]);
    }

    // Calculate total size
    const vendor = VENDOR_STRING;
    const vendorBytes = new TextEncoder().encode(vendor);

    let totalSize = 4 + vendorBytes.length + 4; // vendor length + vendor + comment count

    const encodedComments = comments.map(([key, value]) => {
        const text = `${key}=${value}`;
        const bytes = new TextEncoder().encode(text);
        totalSize += 4 + bytes.length;
        return bytes;
    });

    // Create buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8Array = new Uint8Array(buffer);

    let offset = 0;

    // Vendor length (little-endian)
    view.setUint32(offset, vendorBytes.length, true);
    offset += 4;

    // Vendor string
    uint8Array.set(vendorBytes, offset);
    offset += vendorBytes.length;

    // Comment count (little-endian)
    view.setUint32(offset, comments.length, true);
    offset += 4;

    // Comments
    for (const commentBytes of encodedComments) {
        view.setUint32(offset, commentBytes.length, true);
        offset += 4;
        uint8Array.set(commentBytes, offset);
        offset += commentBytes.length;
    }

    return uint8Array;
}

async function createFlacPictureBlock(coverId, api) {
    try {
        // Fetch album art
        const imageBlob = await getCoverBlob(api, coverId);
        if (!imageBlob) {
            throw new Error('Failed to fetch album art');
        }

        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());

        // Detect MIME type from blob or use default
        const mimeType = imageBlob.type || 'image/jpeg';
        const mimeBytes = new TextEncoder().encode(mimeType);
        const description = '';
        const descBytes = new TextEncoder().encode(description);

        // Calculate total size
        const totalSize =
            4 + // picture type
            4 +
            mimeBytes.length + // mime length + mime
            4 +
            descBytes.length + // desc length + desc
            4 + // width
            4 + // height
            4 + // color depth
            4 + // indexed colors
            4 +
            imageBytes.length; // image length + image

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        const uint8Array = new Uint8Array(buffer);

        let offset = 0;

        // Picture type (3 = front cover)
        view.setUint32(offset, 3, false);
        offset += 4;

        // MIME type length
        view.setUint32(offset, mimeBytes.length, false);
        offset += 4;

        // MIME type
        uint8Array.set(mimeBytes, offset);
        offset += mimeBytes.length;

        // Description length
        view.setUint32(offset, descBytes.length, false);
        offset += 4;

        // Description (empty)
        if (descBytes.length > 0) {
            uint8Array.set(descBytes, offset);
            offset += descBytes.length;
        }

        // Width (0 = unknown)
        view.setUint32(offset, 0, false);
        offset += 4;

        // Height (0 = unknown)
        view.setUint32(offset, 0, false);
        offset += 4;

        // Color depth (0 = unknown)
        view.setUint32(offset, 0, false);
        offset += 4;

        // Indexed colors (0 = not indexed)
        view.setUint32(offset, 0, false);
        offset += 4;

        // Image data length
        view.setUint32(offset, imageBytes.length, false);
        offset += 4;

        // Image data
        uint8Array.set(imageBytes, offset);

        return uint8Array;
    } catch (error) {
        console.error('Failed to create FLAC picture block:', error);
        return null;
    }
}

function rebuildFlacWithMetadata(dataView, blocks, vorbisCommentBlock, pictureBlock) {
    const originalArray = new Uint8Array(dataView.buffer);

    // Remove old Vorbis comment and picture blocks
    const filteredBlocks = blocks.filter((b) => b.type !== 4 && b.type !== 6); // 4 = Vorbis, 6 = Picture

    // Calculate new file size
    let newSize = 4; // "fLaC" signature

    // Add STREAMINFO and other essential blocks
    for (const block of filteredBlocks) {
        newSize += 4 + block.size; // header + data
    }

    // Add new Vorbis comment block
    newSize += 4 + vorbisCommentBlock.length;

    // Add picture block if available
    if (pictureBlock) {
        newSize += 4 + pictureBlock.length;
    }

    // Add audio data
    const audioDataOffset = blocks.audioDataOffset;
    if (audioDataOffset === undefined) {
        throw new Error('Invalid FLAC file structure: unable to locate audio data stream');
    }
    const audioDataSize = dataView.byteLength - audioDataOffset;
    newSize += audioDataSize;

    // Build new file
    const newFile = new Uint8Array(newSize);
    let offset = 0;

    // Write "fLaC" signature
    newFile[offset++] = 0x66; // 'f'
    newFile[offset++] = 0x4c; // 'L'
    newFile[offset++] = 0x61; // 'a'
    newFile[offset++] = 0x43; // 'C'

    // Write existing blocks (except Vorbis and Picture)
    for (let i = 0; i < filteredBlocks.length; i++) {
        const block = filteredBlocks[i];
        const isLast = false; // We'll add more blocks

        // Write block header
        const header = (isLast ? 0x80 : 0x00) | block.type;
        newFile[offset++] = header;
        newFile[offset++] = (block.size >> 16) & 0xff;
        newFile[offset++] = (block.size >> 8) & 0xff;
        newFile[offset++] = block.size & 0xff;

        // Write block data
        newFile.set(originalArray.subarray(block.offset, block.offset + block.size), offset);
        offset += block.size;
    }

    // Write new Vorbis comment block
    const vorbisHeaderOffset = offset;
    const vorbisHeader = 0x04; // Vorbis comment type
    newFile[offset++] = vorbisHeader;
    newFile[offset++] = (vorbisCommentBlock.length >> 16) & 0xff;
    newFile[offset++] = (vorbisCommentBlock.length >> 8) & 0xff;
    newFile[offset++] = vorbisCommentBlock.length & 0xff;
    newFile.set(vorbisCommentBlock, offset);
    offset += vorbisCommentBlock.length;

    let lastBlockHeaderOffset = vorbisHeaderOffset;

    // Write picture block if available
    if (pictureBlock) {
        const pictureHeaderOffset = offset;
        const pictureHeader = 0x06; // Picture type
        newFile[offset++] = pictureHeader;
        newFile[offset++] = (pictureBlock.length >> 16) & 0xff;
        newFile[offset++] = (pictureBlock.length >> 8) & 0xff;
        newFile[offset++] = pictureBlock.length & 0xff;
        newFile.set(pictureBlock, offset);
        offset += pictureBlock.length;
        lastBlockHeaderOffset = pictureHeaderOffset;
    }

    // Mark the last metadata block with the 0x80 flag
    newFile[lastBlockHeaderOffset] |= 0x80;

    // Write audio data
    if (audioDataSize > 0) {
        newFile.set(originalArray.subarray(audioDataOffset, audioDataOffset + audioDataSize), offset);
    }

    return newFile;
}

/**
 * Adds metadata to M4A files using MP4 atoms
 */
async function addM4aMetadata(m4aBlob, track, api) {
    try {
        const arrayBuffer = await m4aBlob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        // Parse MP4 atoms
        const atoms = parseMp4Atoms(dataView);

        // Create metadata atoms
        const metadataAtoms = createMp4MetadataAtoms(track);

        // Fetch album artwork if available
        if (track.album?.cover) {
            try {
                const imageBlob = await getCoverBlob(api, track.album.cover);
                if (imageBlob) {
                    const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
                    metadataAtoms.cover = {
                        type: 'covr',
                        data: imageBytes,
                    };
                }
            } catch (error) {
                console.warn('Failed to embed album art in M4A:', error);
            }
        }

        // Rebuild MP4 file with metadata
        const newMp4Data = rebuildMp4WithMetadata(dataView, atoms, metadataAtoms);

        return new Blob([newMp4Data], { type: 'audio/mp4' });
    } catch (error) {
        console.error('Failed to add M4A metadata:', error);
        return m4aBlob;
    }
}

function parseMp4Atoms(dataView) {
    const atoms = [];
    let offset = 0;

    while (offset + 8 <= dataView.byteLength) {
        // MP4 atoms use big-endian byte order
        let size = dataView.getUint32(offset, false);

        // Handle special size values
        if (size === 0) {
            // Size 0 means the atom extends to the end of the file
            size = dataView.byteLength - offset;
        } else if (size === 1) {
            // Size 1 means 64-bit extended size follows (after the type field)
            if (offset + 16 > dataView.byteLength) {
                break;
            }
            // Read 64-bit size from offset+8 (big-endian)
            const sizeHigh = dataView.getUint32(offset + 8, false);
            const sizeLow = dataView.getUint32(offset + 12, false);
            if (sizeHigh !== 0) {
                console.warn('64-bit MP4 atoms larger than 4GB are not supported - file may be processed incompletely');
                break;
            }
            size = sizeLow;
        }

        if (size < 8 || offset + size > dataView.byteLength) {
            break;
        }

        const type = String.fromCharCode(
            dataView.getUint8(offset + 4),
            dataView.getUint8(offset + 5),
            dataView.getUint8(offset + 6),
            dataView.getUint8(offset + 7)
        );

        atoms.push({
            type: type,
            offset: offset,
            size: size,
        });

        offset += size;
    }

    return atoms;
}

function createMp4MetadataAtoms(track) {
    // MP4 metadata atoms are more complex than FLAC
    // We'll create basic iTunes-style metadata

    const tags = {
        '©nam': track.title || DEFAULT_TITLE,
        '©ART': track.artist?.name || DEFAULT_ARTIST,
        '©alb': track.album?.title || DEFAULT_ALBUM,
        aART: track.album?.artist?.name || track.artist?.name || DEFAULT_ARTIST,
    };

    if (track.trackNumber) {
        tags['trkn'] = track.trackNumber;
    }

    const releaseDateStr =
        track.album?.releaseDate || (track.streamStartDate ? track.streamStartDate.split('T')[0] : '');
    if (releaseDateStr) {
        try {
            const year = new Date(releaseDateStr).getFullYear();
            if (!isNaN(year)) {
                tags['©day'] = String(year);
            }
        } catch {
            // Invalid date, skip
        }
    }

    return { tags };
}

function rebuildMp4WithMetadata(dataView, atoms, metadataAtoms) {
    const originalArray = new Uint8Array(dataView.buffer);

    // Find moov atom
    const moovAtom = atoms.find((a) => a.type === 'moov');
    if (!moovAtom) {
        console.warn('No moov atom found in M4A file');
        return originalArray;
    }

    // Construct the new metadata block (udta -> meta -> ilst)
    const newMetadataBytes = createMetadataBlock(metadataAtoms);

    // We need to insert this into the moov atom.
    // If udta exists, we merge/replace. For simplicity, we'll append/create.
    // Ideally, we should parse moov children to find udta.

    // 1. Calculate new sizes
    // New file size = Original size + Metadata block size
    // Note: If we are replacing existing metadata, this calculation would be different,
    // but here we are assuming we are adding fresh or appending.
    // A robust implementation would parse moov children, remove existing udta, and add new one.

    // Let's try to do it right: parse moov children
    const moovChildren = parseMp4Atoms(new DataView(originalArray.buffer, moovAtom.offset + 8, moovAtom.size - 8));

    // Filter out existing udta to replace it
    const filteredMoovChildren = moovChildren.filter((a) => a.type !== 'udta');

    // Calculate new moov size
    // Header (8) + Sum of other children sizes + New Metadata Block Size
    let newMoovSize = 8;
    for (const child of filteredMoovChildren) {
        newMoovSize += child.size;
    }
    newMoovSize += newMetadataBytes.length;

    const sizeDiff = newMoovSize - moovAtom.size;
    const newFileSize = originalArray.length + sizeDiff;

    const newFile = new Uint8Array(newFileSize);
    let offset = 0;
    let originalOffset = 0;

    // Copy atoms before moov
    const atomsBeforeMoov = atoms.filter((a) => a.offset < moovAtom.offset);
    for (const atom of atomsBeforeMoov) {
        newFile.set(originalArray.subarray(atom.offset, atom.offset + atom.size), offset);
        offset += atom.size;
        originalOffset += atom.size;
    }

    // Write new moov atom
    // Size
    newFile[offset++] = (newMoovSize >> 24) & 0xff;
    newFile[offset++] = (newMoovSize >> 16) & 0xff;
    newFile[offset++] = (newMoovSize >> 8) & 0xff;
    newFile[offset++] = newMoovSize & 0xff;

    // Type 'moov'
    newFile[offset++] = 0x6d;
    newFile[offset++] = 0x6f;
    newFile[offset++] = 0x6f;
    newFile[offset++] = 0x76;

    // Write preserved children of moov
    for (const child of filteredMoovChildren) {
        const absoluteChildStart = moovAtom.offset + 8 + child.offset;
        newFile.set(originalArray.subarray(absoluteChildStart, absoluteChildStart + child.size), offset);
        offset += child.size;
    }

    // Write new metadata block (udta)
    newFile.set(newMetadataBytes, offset);
    offset += newMetadataBytes.length;

    // Update originalOffset to skip old moov
    originalOffset = moovAtom.offset + moovAtom.size;

    // Copy atoms after moov
    // Adjust offsets in stco/co64 atoms if necessary?
    // Changing the size of moov (or atoms before mdat) shifts the mdat offsets.
    // If moov comes before mdat, we MUST update the Chunk Offset Atom (stco or co64).
    // This is complex.

    // Safe strategy: If moov is AFTER mdat, we don't need to update offsets.
    // If moov is BEFORE mdat, we need to shift offsets.
    // Most streaming optimized files have moov before mdat.

    const mdatAtom = atoms.find((a) => a.type === 'mdat');
    const moovBeforeMdat = mdatAtom && moovAtom.offset < mdatAtom.offset;

    if (moovBeforeMdat) {
        // We need to update stco/co64 atoms inside the copied moov children content in newFile.
        // This is getting very complicated for a simple "add metadata" feature without a proper library.
        // However, we can try to find 'stco' or 'co64' in the new buffer we just wrote and offset values.

        // Let's assume we need to shift by sizeDiff.
        updateChunkOffsets(newFile, offset - newMoovSize, newMoovSize, sizeDiff);
    }

    // Copy remaining data (mdat etc.)
    if (originalOffset < originalArray.length) {
        newFile.set(originalArray.subarray(originalOffset), offset);
    }

    return newFile;
}

function createMetadataBlock(metadataAtoms) {
    const { tags, cover } = metadataAtoms;

    const ilstChildren = [];

    // Text tags
    for (const [key, value] of Object.entries(tags)) {
        if (key === 'trkn') {
            ilstChildren.push(createIntAtom(key, value));
        } else {
            ilstChildren.push(createStringAtom(key, value));
        }
    }

    // Cover art
    if (cover) {
        ilstChildren.push(createCoverAtom(cover.data));
    }

    // Construct ilst atom
    const ilstSize = 8 + ilstChildren.reduce((acc, buf) => acc + buf.length, 0);
    const ilst = new Uint8Array(ilstSize);
    let offset = 0;

    writeAtomHeader(ilst, offset, ilstSize, 'ilst');
    offset += 8;

    for (const child of ilstChildren) {
        ilst.set(child, offset);
        offset += child.length;
    }

    // Construct meta atom (FullAtom, version+flags = 4 bytes)
    const metaSize = 12 + ilstSize;
    const meta = new Uint8Array(metaSize);
    offset = 0;

    writeAtomHeader(meta, offset, metaSize, 'meta');
    offset += 8;

    meta[offset++] = 0; // Version
    meta[offset++] = 0; // Flags
    meta[offset++] = 0;
    meta[offset++] = 0;

    meta.set(ilst, offset);

    // Construct hdlr atom (required for meta)
    // "mdir" subtype, "appl" manufacturer, 0 flags/masks, empty name
    // hdlr size: 4 (size) + 4 (type) + 4 (ver/flags) + 4 (pre_defined) + 4 (handler_type) + 12 (reserved) + name (string)
    // Minimal valid hdlr for iTunes metadata:
    const hdlrContent = new Uint8Array([
        0,
        0,
        0,
        0, // Version/Flags
        0,
        0,
        0,
        0, // Pre-defined
        0x6d,
        0x64,
        0x69,
        0x72, // 'mdir'
        0x61,
        0x70,
        0x70,
        0x6c, // 'appl'
        0,
        0,
        0,
        0, // Reserved
        0,
        0,
        0,
        0,
        0,
        0, // Name (empty null-term) check spec? usually simple 0 is enough
    ]);
    const hdlrSize = 8 + hdlrContent.length;
    const hdlr = new Uint8Array(hdlrSize);
    writeAtomHeader(hdlr, 0, hdlrSize, 'hdlr');
    hdlr.set(hdlrContent, 8);

    // Construct udta atom
    // udta contains meta. meta usually should contain hdlr before ilst?
    // Actually, QuickTime spec says meta contains hdlr then ilst.

    const finalMetaSize = 12 + hdlrSize + ilstSize;
    const finalMeta = new Uint8Array(finalMetaSize);
    offset = 0;
    writeAtomHeader(finalMeta, offset, finalMetaSize, 'meta');
    offset += 8;
    finalMeta[offset++] = 0; // Version
    finalMeta[offset++] = 0; // Flags
    finalMeta[offset++] = 0;
    finalMeta[offset++] = 0;

    finalMeta.set(hdlr, offset);
    offset += hdlrSize;
    finalMeta.set(ilst, offset);

    const udtaSize = 8 + finalMetaSize;
    const udta = new Uint8Array(udtaSize);
    writeAtomHeader(udta, 0, udtaSize, 'udta');
    udta.set(finalMeta, 8);

    return udta;
}

function createStringAtom(type, value) {
    const textBytes = new TextEncoder().encode(value);
    const dataSize = 16 + textBytes.length; // 8 (data atom header) + 8 (flags/null) + text
    const atomSize = 8 + dataSize;

    const buf = new Uint8Array(atomSize);
    let offset = 0;

    // Wrapper atom (e.g., ©nam)
    writeAtomHeader(buf, offset, atomSize, type);
    offset += 8;

    // Data atom
    writeAtomHeader(buf, offset, dataSize, 'data');
    offset += 8;

    // Data Type (1 = UTF-8 text) + Locale (0)
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 1; // Type 1
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;

    buf.set(textBytes, offset);

    return buf;
}

function createIntAtom(type, value) {
    // trkn is special: data is 8 bytes.
    // reserved(2) + track(2) + total(2) + reserved(2)
    const dataSize = 16 + 8;
    const atomSize = 8 + dataSize;

    const buf = new Uint8Array(atomSize);
    let offset = 0;

    writeAtomHeader(buf, offset, atomSize, type);
    offset += 8;

    writeAtomHeader(buf, offset, dataSize, 'data');
    offset += 8;

    // Data Type (0 = implicit/int) + Locale
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0; // Type 0
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;

    // Track data
    buf[offset++] = 0;
    buf[offset++] = 0;
    // Track num
    const trk = parseInt(value) || 0;
    buf[offset++] = (trk >> 8) & 0xff;
    buf[offset++] = trk & 0xff;
    // Total (0 for now)
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;

    return buf;
}

function createCoverAtom(imageBytes) {
    const dataSize = 16 + imageBytes.length;
    const atomSize = 8 + dataSize;

    const buf = new Uint8Array(atomSize);
    let offset = 0;

    writeAtomHeader(buf, offset, atomSize, 'covr');
    offset += 8;

    writeAtomHeader(buf, offset, dataSize, 'data');
    offset += 8;

    // Data Type (13 = JPEG, 14 = PNG)
    // We try to detect or default to JPEG (13)
    let type = 13;
    if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
        // PNG signature
        type = 14;
    }

    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = type;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;

    buf.set(imageBytes, offset);

    return buf;
}

function writeAtomHeader(buf, offset, size, type) {
    buf[offset++] = (size >> 24) & 0xff;
    buf[offset++] = (size >> 16) & 0xff;
    buf[offset++] = (size >> 8) & 0xff;
    buf[offset++] = size & 0xff;

    for (let i = 0; i < 4; i++) {
        buf[offset++] = type.charCodeAt(i);
    }
}

function updateChunkOffsets(buffer, moovOffset, moovSize, shift) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Scan moov for stco/co64
    // This is a naive recursive search restricted to the known moov range

    // We parse atoms starting from moov content
    let offset = moovOffset + 8; // Skip moov header
    const end = moovOffset + moovSize;

    findAndShiftOffsets(view, offset, end, shift);
}

function findAndShiftOffsets(view, start, end, shift) {
    let offset = start;

    while (offset + 8 <= end) {
        const size = view.getUint32(offset, false);
        const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7)
        );

        if (size < 8) break;

        if (type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
            // Container atoms, recurse
            findAndShiftOffsets(view, offset + 8, offset + size, shift);
        } else if (type === 'stco') {
            // Chunk Offset Atom (32-bit)
            // Header (8) + Version(1) + Flags(3) + Count(4) + Entries(Count * 4)
            const count = view.getUint32(offset + 12, false);
            for (let i = 0; i < count; i++) {
                const entryOffset = offset + 16 + i * 4;
                const oldVal = view.getUint32(entryOffset, false);
                view.setUint32(entryOffset, oldVal + shift, false);
            }
        } else if (type === 'co64') {
            // Chunk Offset Atom (64-bit)
            // Header (8) + Version(1) + Flags(3) + Count(4) + Entries(Count * 8)
            const count = view.getUint32(offset + 12, false);
            for (let i = 0; i < count; i++) {
                const entryOffset = offset + 16 + i * 8;
                // Read 64-bit int
                const oldHigh = view.getUint32(entryOffset, false);
                const oldLow = view.getUint32(entryOffset + 4, false);

                // Add shift (assuming shift is small enough not to overflow low 32 in a way that affects high simply?)
                // Shift is Javascript number (double), up to 9007199254740991.
                // 32-bit uint max is 4294967295.

                // Proper 64-bit addition
                // Construct BigInt
                // Note: BigInt might not be available in all older environments, but modern browsers support it.
                // Fallback: simpler logic

                let newLow = oldLow + shift;
                let carry = 0;
                if (newLow > 0xffffffff) {
                    carry = Math.floor(newLow / 0x100000000);
                    newLow = newLow >>> 0;
                }
                const newHigh = oldHigh + carry;

                view.setUint32(entryOffset, newHigh, false);
                view.setUint32(entryOffset + 4, newLow, false);
            }
        }

        offset += size;
    }
}
