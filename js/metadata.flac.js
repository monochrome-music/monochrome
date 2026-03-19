import { getCoverBlob, getTrackTitle } from './utils.js';
import { getFullArtistString } from './utils.js';
import { METADATA_STRINGS } from './METADATA_STRINGS.js';

export const FLAC_MIME_TYPE = 'audio/flac';
const FLAC_BLOCK_TYPES = {
    /** This block has information about the whole stream, like sample rate, number of channels, total number of samples, etc. It must be present as the first metadata block in the stream. Other metadata blocks may follow, and ones that the decoder doesn't understand, it will skip. */
    StreamInfo: 0,

    /** This block allows for an arbitrary amount of padding. The contents of a PADDING block have no meaning. This block is useful when it is known that metadata will be edited after encoding; the user can instruct the encoder to reserve a PADDING block of sufficient size so that when metadata is added, it will simply overwrite the padding (which is relatively quick) instead of having to insert it into the right place in the existing file (which would normally require rewriting the entire file). */
    Padding: 1,

    /** This block is for use by third-party applications. The only mandatory field is a 32-bit identifier. This ID is granted upon request to an application by the FLAC maintainers. The remainder is of the block is defined by the registered application. Visit the registration page if you would like to register an ID for your application with FLAC. */
    Application: 2,

    /** This is an optional block for storing seek points. It is possible to seek to any given sample in a FLAC stream without a seek table, but the delay can be unpredictable since the bitrate may vary widely within a stream. By adding seek points to a stream, this delay can be significantly reduced. Each seek point takes 18 bytes, so 1% resolution within a stream adds less than 2k. There can be only one SEEKTABLE in a stream, but the table can have any number of seek points. There is also a special 'placeholder' seekpoint which will be ignored by decoders but which can be used to reserve space for future seek point insertion. */
    SeekTable: 3,

    /** This block is for storing a list of human-readable name/value pairs. Values are encoded using UTF-8. It is an implementation of the Vorbis comment specification (without the framing bit). This is the only officially supported tagging mechanism in FLAC. There may be only one VORBIS_COMMENT block in a stream. In some external documentation, Vorbis comments are called FLAC tags to lessen confusion. */
    VorbisComment: 4,

    /** This block is for storing various information that can be used in a cue sheet. It supports track and index points, compatible with Red Book CD digital audio discs, as well as other CD-DA metadata such as media catalog number and track ISRCs. The CUESHEET block is especially useful for backing up CD-DA discs, but it can be used as a general purpose cueing mechanism for playback. */
    CueSheet: 5,

    /** This block is for storing pictures associated with the file, most commonly cover art from CDs. There may be more than one PICTURE block in a file. The picture format is similar to the APIC frame in ID3v2. The PICTURE block has a type, MIME type, and UTF-8 description like ID3v2, and supports external linking via URL (though this is discouraged). The differences are that there is no uniqueness constraint on the description field, and the MIME type is mandatory. The FLAC PICTURE block also includes the resolution, color depth, and palette size so that the client can search for a suitable picture without having to scan them all. */
    Picture: 6,
};

export async function readFlacMetadata(file, metadata) {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    if (!isFlacFile(dataView)) return;

    const blocks = parseFlacBlocks(dataView);
    const vorbisBlock = blocks.find((b) => b.type === FLAC_BLOCK_TYPES.VorbisComment);
    const pictureBlock = blocks.find((b) => b.type === FLAC_BLOCK_TYPES.Picture);
    const streamInfo = blocks.find((b) => b.type === FLAC_BLOCK_TYPES.StreamInfo);

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
                if (upperKey === 'ISRC') metadata.isrc = value;
                if (upperKey === 'COPYRIGHT') metadata.copyright = value;
                if (upperKey === 'ITUNESADVISORY') metadata.explicit = value === '1';
            }
        }
    }

    if (streamInfo) {
        const offset = streamInfo.offset;

        // Sample Rate is 20 bits spanning bytes 10, 11, and the first 4 bits of 12
        const byte10 = dataView.getUint8(offset + 10);
        const byte11 = dataView.getUint8(offset + 11);
        const byte12 = dataView.getUint8(offset + 12);

        // since data for some reason spans across multiple bytes, we need to combine them into one int
        const sampleRate = (byte10 << 12) | (byte11 << 4) | (byte12 >> 4);

        const byte13 = dataView.getUint8(offset + 13);
        const tsHigh = byte13 & 0x0f;
        const tsLow = dataView.getUint32(offset + 14, false);

        // same thing for total samples
        const totalSamples = tsHigh * 0x100000000 + tsLow;

        if (sampleRate > 0) {
            // beatiful
            metadata.duration = totalSamples / sampleRate;
        }
    }

    if (artists.length > 0) {
        metadata.artists = artists.flatMap((a) => a.split(/; |\/|\\/)).map((name) => ({ name: name.trim() }));
    }

    if (pictureBlock) {
        try {
            let pos = pictureBlock.offset;
            pos += 4;
            const mimeLen = dataView.getUint32(pos, false);
            pos += 4;
            const mime = new TextDecoder().decode(new Uint8Array(arrayBuffer, pos, mimeLen));
            pos += mimeLen;
            const descLen = dataView.getUint32(pos, false);
            pos += 4;
            pos += descLen;
            pos += 16;
            const dataLen = dataView.getUint32(pos, false);
            pos += 4;
            const pictureData = new Uint8Array(arrayBuffer, pos, dataLen);
            const blob = new Blob([pictureData], { type: mime });
            metadata.album.cover = URL.createObjectURL(blob);
        } catch (e) {
            console.warn('Error parsing FLAC picture:', e);
        }
    }
}

/**
 * Adds Vorbis comment metadata to FLAC files
 */
export async function addFlacMetadata(flacBlob, track, api) {
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

export function isFlacFile(dataView) {
    // Check for "fLaC" signature at the beginning
    return (
        dataView.byteLength >= 4 &&
        dataView.getUint8(0) === 0x66 && // 'f'
        dataView.getUint8(1) === 0x4c && // 'L'
        dataView.getUint8(2) === 0x61 && // 'a'
        dataView.getUint8(3) === 0x43
    ); // 'C'
}

export function parseFlacBlocks(dataView) {
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

export function createVorbisComments(track) {
    // Vorbis comment structure
    const comments = [];
    const discNumber = track.volumeNumber ?? track.discNumber;

    // Add standard tags
    if (track.title) {
        comments.push(['TITLE', getTrackTitle(track)]);
    }
    const artistStr = getFullArtistString(track);
    if (artistStr) {
        comments.push(['ARTIST', artistStr]);
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
    if (discNumber) {
        comments.push(['DISCNUMBER', String(discNumber)]);
    }
    if (track.album?.numberOfTracks) {
        comments.push(['TRACKTOTAL', String(track.album.numberOfTracks)]);
    }
    if (track.bpm != null) {
        const bpm = Number(track.bpm);
        if (Number.isFinite(bpm)) {
            comments.push(['TEMPO', String(Math.round(bpm))]);
        }
    }
    if (track.replayGain) {
        const { albumReplayGain, albumPeakAmplitude, trackReplayGain, trackPeakAmplitude } = track.replayGain;
        if (albumReplayGain) comments.push(['REPLAYGAIN_ALBUM_GAIN', String(albumReplayGain)]);
        if (albumPeakAmplitude) comments.push(['REPLAYGAIN_ALBUM_PEAK', String(albumPeakAmplitude)]);
        if (trackReplayGain) comments.push(['REPLAYGAIN_TRACK_GAIN', String(trackReplayGain)]);
        if (trackPeakAmplitude) comments.push(['REPLAYGAIN_TRACK_PEAK', String(trackPeakAmplitude)]);
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
    if (track.explicit) {
        comments.push(['ITUNESADVISORY', '1']);
    }

    return comments;
}

export function createVorbisCommentBlock(comments = []) {
    // Calculate total size
    const vendor = METADATA_STRINGS.VENDOR_STRING;
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

    // Pad to at least 1024 bytes for future metadata edits without needing to rewrite the whole file
    if (uint8Array.length < 1024) {
        const newArray = new Uint8Array(1024);
        newArray.set(uint8Array);
        return newArray;
    }

    return uint8Array;
}

export async function createFlacPictureBlock(coverId, api) {
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

export function rebuildFlacWithMetadata(
    dataView,
    blocks,
    vorbisCommentBlock = createVorbisCommentBlock(),
    pictureBlock
) {
    const originalArray = new Uint8Array(dataView.buffer);

    // Remove seek table, old Vorbis comment, and picture blocks
    const filteredBlocks = blocks.filter(
        (b) => ![FLAC_BLOCK_TYPES.SeekTable, FLAC_BLOCK_TYPES.VorbisComment, FLAC_BLOCK_TYPES.Picture].includes(b.type)
    );

    // Calculate new file size
    let newSize = 4; // "fLaC" signature

    // Add STREAMINFO and other essential blocks
    for (const block of filteredBlocks) {
        newSize += 4 + block.size; // header + data
    }

    if (vorbisCommentBlock) {
        // Add new Vorbis comment block
        newSize += 4 + vorbisCommentBlock.length;
    }

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

    let lastBlockHeaderOffset = offset;

    if (vorbisCommentBlock) {
        // Write new Vorbis comment block
        const vorbisHeaderOffset = offset;
        const vorbisHeader = FLAC_BLOCK_TYPES.VorbisComment; // Vorbis comment type
        newFile[offset++] = vorbisHeader;
        newFile[offset++] = (vorbisCommentBlock.length >> 16) & 0xff;
        newFile[offset++] = (vorbisCommentBlock.length >> 8) & 0xff;
        newFile[offset++] = vorbisCommentBlock.length & 0xff;
        newFile.set(vorbisCommentBlock, offset);
        offset += vorbisCommentBlock.length;
        lastBlockHeaderOffset = vorbisHeaderOffset;
    }

    // Write picture block if available
    if (pictureBlock) {
        const pictureHeaderOffset = offset;
        const pictureHeader = FLAC_BLOCK_TYPES.Picture; // Picture type
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

export function getFlacBlocks(dataView) {
    // Verify FLAC signature
    if (!isFlacFile(dataView)) {
        throw new Error('Not a valid FLAC file');
    }

    // Parse FLAC structure
    const blocks = parseFlacBlocks(dataView);

    // If parsing failed or no audio data found, return original
    if (!blocks || blocks.length === 0 || blocks.audioDataOffset === undefined) {
        throw new Error('Failed to parse FLAC blocks');
    }

    // Check for STREAMINFO block (must be first, type 0)
    if (blocks[0].type !== 0) {
        throw new Error('FLAC file missing STREAMINFO block');
    }

    return blocks;
}

/**
 * Removes all metadata from a FLAC file blob and returns the rebuilt FLAC data.
 *
 * @async
 * @param {Blob} flacBlob - The FLAC audio file as a Blob object
 * @returns {Promise<Blob>} A Promise that resolves to a new Blob containing the FLAC file without metadata,
 *                          or the original flacBlob if an error occurs during processing
 * @throws {Error} Logs errors to console but catches and returns original blob instead of throwing
 *
 * @example
 * const flacFile = new Blob([arrayBuffer], { type: 'audio/flac' });
 * const cleanFlac = await rebuildFlacWithoutMetadata(flacFile);
 */
export async function rebuildFlacWithoutMetadata(flacBlob) {
    try {
        const arrayBuffer = await flacBlob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        const blocks = getFlacBlocks(dataView);
        return new Blob([rebuildFlacWithMetadata(dataView, blocks, createVorbisCommentBlock(), null)], {
            type: FLAC_MIME_TYPE,
        });
    } catch (err) {
        console.error('Error rebuilding FLAC file:', err);
        return flacBlob;
    }
}
