import { getExtensionForQuality, getCoverBlob } from './utils.js';

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
export async function addMetadataToAudio(audioBlob, track, api, quality) {
    const extension = getExtensionForQuality(quality);
    
    if (extension === 'flac') {
        return await addFlacMetadata(audioBlob, track, api);
    } else if (extension === 'm4a') {
        return await addM4aMetadata(audioBlob, track, api);
    }
    
    // If unsupported format, return original blob
    return audioBlob;
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
        const newFlacData = rebuildFlacWithMetadata(dataView, blocks, vorbisCommentBlock, pictureBlock);
        
        return new Blob([newFlacData], { type: 'audio/flac' });
    } catch (error) {
        console.error('Failed to add FLAC metadata:', error);
        return flacBlob;
    }
}

function isFlacFile(dataView) {
    // Check for "fLaC" signature at the beginning
    return dataView.byteLength >= 4 &&
           dataView.getUint8(0) === 0x66 && // 'f'
           dataView.getUint8(1) === 0x4C && // 'L'
           dataView.getUint8(2) === 0x61 && // 'a'
           dataView.getUint8(3) === 0x43;   // 'C'
}

function parseFlacBlocks(dataView) {
    const blocks = [];
    let offset = 4; // Skip "fLaC" signature
    
    while (offset + 4 <= dataView.byteLength) {
        const header = dataView.getUint8(offset);
        const isLast = (header & 0x80) !== 0;
        const blockType = header & 0x7F;
        
        const blockSize = (dataView.getUint8(offset + 1) << 16) |
                         (dataView.getUint8(offset + 2) << 8) |
                         dataView.getUint8(offset + 3);
        
        // Validate block size
        if (offset + 4 + blockSize > dataView.byteLength) {
            console.warn('Invalid block size detected, stopping parse');
            break;
        }
        
        blocks.push({
            type: blockType,
            isLast: isLast,
            size: blockSize,
            offset: offset + 4,
            headerOffset: offset
        });
        
        offset += 4 + blockSize;
        
        if (isLast) {
            // Save the audio data offset
            blocks.audioDataOffset = offset;
            break;
        }
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
    if (track.album?.artist?.name) {
        comments.push(['ALBUMARTIST', track.album.artist.name]);
    }
    if (track.trackNumber) {
        comments.push(['TRACKNUMBER', String(track.trackNumber)]);
    }
    if (track.album?.numberOfTracks) {
        comments.push(['TRACKTOTAL', String(track.album.numberOfTracks)]);
    }
    
    const releaseDateStr = track.album?.releaseDate || (track.streamStartDate ? track.streamStartDate.split('T')[0] : '');
    if (releaseDateStr) {
        try {
            const year = new Date(releaseDateStr).getFullYear();
            if (!isNaN(year)) {
                comments.push(['DATE', String(year)]);
            }
        } catch (error) {
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
        const totalSize = 4 + // picture type
                         4 + mimeBytes.length + // mime length + mime
                         4 + descBytes.length + // desc length + desc
                         4 + // width
                         4 + // height
                         4 + // color depth
                         4 + // indexed colors
                         4 + imageBytes.length; // image length + image
        
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
    const filteredBlocks = blocks.filter(b => b.type !== 4 && b.type !== 6); // 4 = Vorbis, 6 = Picture
    
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
    newFile[offset++] = 0x4C; // 'L'
    newFile[offset++] = 0x61; // 'a'
    newFile[offset++] = 0x43; // 'C'
    
    // Write existing blocks (except Vorbis and Picture)
    for (let i = 0; i < filteredBlocks.length; i++) {
        const block = filteredBlocks[i];
        const isLast = false; // We'll add more blocks
        
        // Write block header
        const header = (isLast ? 0x80 : 0x00) | block.type;
        newFile[offset++] = header;
        newFile[offset++] = (block.size >> 16) & 0xFF;
        newFile[offset++] = (block.size >> 8) & 0xFF;
        newFile[offset++] = block.size & 0xFF;
        
        // Write block data
        newFile.set(originalArray.subarray(block.offset, block.offset + block.size), offset);
        offset += block.size;
    }
    
    // Write new Vorbis comment block
    const vorbisHeaderOffset = offset;
    const vorbisHeader = 0x04; // Vorbis comment type
    newFile[offset++] = vorbisHeader;
    newFile[offset++] = (vorbisCommentBlock.length >> 16) & 0xFF;
    newFile[offset++] = (vorbisCommentBlock.length >> 8) & 0xFF;
    newFile[offset++] = vorbisCommentBlock.length & 0xFF;
    newFile.set(vorbisCommentBlock, offset);
    offset += vorbisCommentBlock.length;
    
    let lastBlockHeaderOffset = vorbisHeaderOffset;
    
    // Write picture block if available
    if (pictureBlock) {
        const pictureHeaderOffset = offset;
        const pictureHeader = 0x06; // Picture type
        newFile[offset++] = pictureHeader;
        newFile[offset++] = (pictureBlock.length >> 16) & 0xFF;
        newFile[offset++] = (pictureBlock.length >> 8) & 0xFF;
        newFile[offset++] = pictureBlock.length & 0xFF;
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
                const coverData = await fetchAlbumArtForMp4(track.album.cover, api);
                if (coverData) {
                    metadataAtoms.cover = coverData;
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
            size: size
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
        'aART': track.album?.artist?.name || DEFAULT_ARTIST,
    };
    
    if (track.trackNumber) {
        tags['trkn'] = track.trackNumber;
    }
    
    const releaseDateStr = track.album?.releaseDate || (track.streamStartDate ? track.streamStartDate.split('T')[0] : '');
    if (releaseDateStr) {
        try {
            const year = new Date(releaseDateStr).getFullYear();
            if (!isNaN(year)) {
                tags['©day'] = String(year);
            }
        } catch (error) {
            // Invalid date, skip
        }
    }
    
    return { tags };
}

async function fetchAlbumArtForMp4(coverId, api) {
    try {
        const imageBlob = await getCoverBlob(api, coverId);
        if (!imageBlob) {
            return null;
        }
        
        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        
        return {
            type: 'covr',
            data: imageBytes
        };
    } catch (error) {
        console.error('Failed to fetch album art for MP4:', error);
        return null;
    }
}

function rebuildMp4WithMetadata(dataView, atoms, metadataAtoms) {
    // M4A metadata injection is complex and requires:
    // 1. Finding the moov atom
    // 2. Finding or creating the udta atom inside moov
    // 3. Creating a meta atom with ilst containing all metadata
    // 4. Rebuilding the file with updated atom sizes
    
    // For now, return the original file to avoid potential corruption
    // TODO: Implement full MP4 metadata injection
    const originalArray = new Uint8Array(dataView.buffer);
    console.warn('M4A metadata embedding is not yet supported - downloaded file will not contain metadata tags');
    return originalArray;
}
