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
                const imageBlob = await getCoverBlob(api, track.album.cover);
                if (imageBlob) {
                    const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
                    metadataAtoms.cover = {
                        type: 'covr',
                        data: imageBytes
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

function rebuildMp4WithMetadata(dataView, atoms, metadataAtoms) {
    const originalArray = new Uint8Array(dataView.buffer);
    
    // Find moov atom
    const moovAtom = atoms.find(a => a.type === 'moov');
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
    const filteredMoovChildren = moovChildren.filter(a => a.type !== 'udta');
    
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
    const atomsBeforeMoov = atoms.filter(a => a.offset < moovAtom.offset);
    for (const atom of atomsBeforeMoov) {
        newFile.set(originalArray.subarray(atom.offset, atom.offset + atom.size), offset);
        offset += atom.size;
        originalOffset += atom.size;
    }
    
    // Write new moov atom
    // Size
    newFile[offset++] = (newMoovSize >> 24) & 0xFF;
    newFile[offset++] = (newMoovSize >> 16) & 0xFF;
    newFile[offset++] = (newMoovSize >> 8) & 0xFF;
    newFile[offset++] = newMoovSize & 0xFF;
    
    // Type 'moov'
    newFile[offset++] = 0x6D;
    newFile[offset++] = 0x6F;
    newFile[offset++] = 0x6F;
    newFile[offset++] = 0x76;
    
    // Write preserved children of moov
    for (const child of filteredMoovChildren) {
        const childStart = moovAtom.offset + 8 + child.offset; // child.offset is relative to moov body start in our parseMp4Atoms helper usage? 
        // Wait, parseMp4Atoms returns absolute offsets usually?
        // Let's verify parseMp4Atoms usage.
        // When we passed a slice DataView, the offsets returned by parseMp4Atoms 
        // are relative to the start of that DataView (which is moov body start).
        
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
    
    const mdatAtom = atoms.find(a => a.type === 'mdat');
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
        0, 0, 0, 0, // Version/Flags
        0, 0, 0, 0, // Pre-defined
        0x6D, 0x64, 0x69, 0x72, // 'mdir'
        0x61, 0x70, 0x70, 0x6C, // 'appl'
        0, 0, 0, 0, // Reserved
        0, 0, 0, 0,
        0, 0 // Name (empty null-term) check spec? usually simple 0 is enough
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
    buf[offset++] = (trk >> 8) & 0xFF;
    buf[offset++] = trk & 0xFF;
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
    if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) { // PNG signature
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
    buf[offset++] = (size >> 24) & 0xFF;
    buf[offset++] = (size >> 16) & 0xFF;
    buf[offset++] = (size >> 8) & 0xFF;
    buf[offset++] = size & 0xFF;
    
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
                const entryOffset = offset + 16 + (i * 4);
                const oldVal = view.getUint32(entryOffset, false);
                view.setUint32(entryOffset, oldVal + shift, false);
            }
        } else if (type === 'co64') {
            // Chunk Offset Atom (64-bit)
            // Header (8) + Version(1) + Flags(3) + Count(4) + Entries(Count * 8)
            const count = view.getUint32(offset + 12, false);
            for (let i = 0; i < count; i++) {
                const entryOffset = offset + 16 + (i * 8);
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
                if (newLow > 0xFFFFFFFF) {
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
