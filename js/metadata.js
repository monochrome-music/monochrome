import { getCoverBlob, getTrackTitle } from './utils.js';
import { initTagLib } from './taglib.js';
import { PICTURE_TYPE_VALUES } from 'taglib-wasm';
import { managers } from './app.js';

const VENDOR_STRING = 'Monochrome';
const DEFAULT_TITLE = 'Unknown Title';
const DEFAULT_ARTIST = 'Unknown Artist';
const DEFAULT_ALBUM = 'Unknown Album';

/**
 * Builds a full artist string by combining the track's listed artists
 * with any featured artists parsed from the title (feat./with).
 */
function getFullArtistString(track) {
    const knownArtists =
        Array.isArray(track.artists) && track.artists.length > 0
            ? track.artists.map((a) => (typeof a === 'string' ? a : a.name) || '').filter(Boolean)
            : track.artist?.name
              ? [track.artist.name]
              : [];

    // Parse featured artists from title, e.g. "Song (feat. A, B & C)" or "(with X & Y)"
    // Note: splitting on '&' may incorrectly fragment compound artist names like "Simon & Garfunkel".
    const featPattern = /\(\s*(?:feat\.?|ft\.?|with)\s+(.+?)\s*\)/gi;
    const allFeatArtists = [...(track.title?.matchAll(featPattern) ?? [])].flatMap((m) =>
        m[1]
            .split(/\s*[,&]\s*/)
            .map((s) => s.trim())
            .filter(Boolean)
    );
    if (allFeatArtists.length > 0) {
        const knownLower = new Set(knownArtists.map((n) => n.toLowerCase()));
        for (const feat of allFeatArtists) {
            if (!knownLower.has(feat.toLowerCase())) {
                knownArtists.push(feat);
                knownLower.add(feat.toLowerCase());
            }
        }
    }

    return knownArtists.join('; ') || null;
}

export function prefetchMetadataObjects(track, api) {
    const _tagLib = initTagLib().catch(console.error);
    const coverFetch = track?.album?.cover
        ? getCoverBlob(api, track.album.cover).catch(console.error)
        : Promise.resolve(null);
    const lyricsFetch = managers?.lyricsManager?.fetchLyrics?.(track.id, track)?.catch(console.error);

    return { _tagLib, coverFetch, lyricsFetch };
}

/**
 * Adds metadata tags to audio files (FLAC, M4A or MP3)
 * @param {Blob} audioBlob - The audio file blob
 * @param {Object} track - Track metadata
 * @param {Object} api - API instance for fetching album art
 * @param {string} quality - Audio quality
 * @returns {Promise<Blob>} - Audio blob with embedded metadata
 */
export async function addMetadataToAudio(audioBlob, track, api, _quality, prefetchPromises) {
    const { _tagLib, coverFetch, lyricsFetch } = prefetchPromises;

    console.time('Get audio array buffer');
    const audioBuffer = await audioBlob.arrayBuffer();
    console.timeEnd('Get audio array buffer');

    console.time('Open file with taglib');
    const tagLib = await _tagLib;
    const file = await tagLib.open(audioBuffer);
    console.timeEnd('Open file with taglib');

    console.time('Tagging file');
    try {
        const isMp4 = file.isMP4();
        const discNumber = track.volumeNumber ?? track.discNumber;

        // Add standard tags
        if (track.title) {
            file.setProperty('TITLE', getTrackTitle(track));
        }

        const artistStr = getFullArtistString(track);
        if (artistStr) {
            file.setProperty('ARTIST', artistStr);
        }

        if (track.album?.title) {
            file.setProperty('ALBUM', track.album.title);
        }

        const albumArtist = track.album?.artist?.name || track.artist?.name;
        if (albumArtist) {
            file.setProperty('ALBUMARTIST', albumArtist);
        }

        if (track.trackNumber) {
            let trackString = String(track.trackNumber);

            if (isMp4 && track.trackNumber && track.album?.numberOfTracks) {
                trackString = `${track.trackNumber}/${track.album.numberOfTracks}`;
            }

            if (isMp4) {
                file.setProperty('TRACKNUMBER', trackString);
            } else {
                file.setProperty('TRACKNUMBER', String(track.trackNumber));
            }
        }

        if (!isMp4 && track.album?.numberOfTracks) {
            file.setProperty('TRACKTOTAL', String(track.album.numberOfTracks));
        }

        if (discNumber) {
            file.setProperty('DISCNUMBER', String(discNumber));
        }

        if (track.bpm != null) {
            const bpm = Number(track.bpm);
            if (Number.isFinite(bpm)) {
                file.setProperty('BPM', String(Math.round(bpm)));
            }
        }

        if (track.replayGain) {
            const { albumReplayGain, albumPeakAmplitude, trackReplayGain, trackPeakAmplitude } = track.replayGain;
            if (albumReplayGain) file.setProperty('REPLAYGAIN_ALBUM_GAIN', String(albumReplayGain));
            if (albumPeakAmplitude) file.setProperty('REPLAYGAIN_ALBUM_PEAK', String(albumPeakAmplitude));
            if (trackReplayGain) file.setProperty('REPLAYGAIN_TRACK_GAIN', String(trackReplayGain));
            if (trackPeakAmplitude) file.setProperty('REPLAYGAIN_TRACK_PEAK', String(trackPeakAmplitude));
        }

        const releaseDateStr =
            track.album?.releaseDate || (track.streamStartDate ? track.streamStartDate.split('T')[0] : '');

        if (releaseDateStr) {
            try {
                const year = new Date(releaseDateStr).getFullYear();
                if (!isNaN(year)) {
                    file.setProperty('DATE', String(year));
                }
            } catch {
                // Invalid date, skip
            }
        }

        if (track.copyright) {
            file.setProperty('COPYRIGHT', track.copyright);
        }

        if (track.isrc) {
            file.setProperty('ISRC', track.isrc);

            if (isMp4) {
                file.setMP4Item('xid ', `:isrc:${track.isrc}`);
            }
        }

        if (track.explicit) {
            if (isMp4) {
                file.setMP4Item('rtng', '1');
            } else {
                file.setProperty('ITUNESADVISORY', '1');
            }
        }

        try {
            if (track.album?.cover) {
                const coverBlob = await coverFetch;
                const coverBuffer = new Uint8Array(await coverBlob.arrayBuffer());

                if (coverBlob) {
                    file.setPictures([
                        {
                            mimeType: coverBlob.type,
                            data: coverBuffer,
                            type: PICTURE_TYPE_VALUES.FrontCover,
                            description: 'Cover Art',
                        },
                    ]);
                }
            }
        } catch (e) {
            console.warn('Error setting cover metadata.', track, e);
        }

        try {
            const lyrics = await lyricsFetch;
            const lyricsString = lyrics?.subtitles || lyrics?.plainLyrics;

            if (lyricsString) {
                //if (isMp4) {
                //    file.setMP4Item('@lyr', String(lyricsString));
                //} else {
                file.setProperty('LYRICS', String(lyricsString).replace(/\r/g, '').replace(/\n/g, '\r\n'));
                //}
            }
        } catch (e) {
            console.warn('Error setting lyrics metadata', track, e);
        }

        console.timeEnd('Tagging file');

        console.time('Saving in-memory buffer');
        await file.save();
        console.timeEnd('Saving in-memory buffer');

        console.time('Saving blob');
        const blob = new Blob([file.getFileBuffer()], { type: audioBlob.type, name: audioBlob.name });
        console.timeEnd('Saving blob');

        return blob;
    } catch (err) {
        console.error(err);
    } finally {
        // Always dispose, even if there was an error.
        file.dispose();
    }

    return audioBlob;
}

/**
 * Reads metadata from a file
 * @param {File} file
 * @returns {Promise<Object>} Track metadata
 */
export async function readTrackMetadata(file, siblings = []) {
    const metadata = {
        title: file.name.replace(/\.[^/.]+$/, ''),
        artists: [],
        artist: { name: 'Unknown Artist' }, // For fallback/compatibility
        album: { title: 'Unknown Album', cover: 'assets/appicon.png', releaseDate: null },
        duration: 0,
        isrc: null,
        copyright: null,
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

    if (metadata.album.cover === 'assets/appicon.png' && siblings.length > 0) {
        const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
        const coverFile = siblings.find((f) => {
            const fName = f.name;
            const lastDot = fName.lastIndexOf('.');
            if (lastDot === -1) return false;
            const fBase = fName.substring(0, lastDot);
            const fExt = fName.substring(lastDot).toLowerCase();
            return fBase === baseName && imageExtensions.includes(fExt);
        });

        if (coverFile) {
            metadata.album.cover = URL.createObjectURL(coverFile);
        }
    }

    return metadata;
}

async function readFlacMetadata(file, metadata) {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    if (!isFlacFile(dataView)) return;

    const blocks = parseFlacBlocks(dataView);
    const vorbisBlock = blocks.find((b) => b.type === 4);
    const pictureBlock = blocks.find((b) => b.type === 6);
    const streamInfo = blocks.find((b) => b.type === 0);

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

        // mvhd metadata tag
        const mvhd = moovAtoms.find((a) => a.type === 'mvhd');
        if (mvhd) {
            const mvhdStart = moovStart + mvhd.offset + 8;
            const version = view.getUint8(mvhdStart);

            // resolution and length, basically
            let timeScale, duration;

            if (version === 0) {
                // 32-bit format
                timeScale = view.getUint32(mvhdStart + 12, false);
                duration = view.getUint32(mvhdStart + 16, false);
            } else if (version === 1) {
                // 64-bit format
                timeScale = view.getUint32(mvhdStart + 20, false);
                const durHigh = view.getUint32(mvhdStart + 24, false);
                const durLow = view.getUint32(mvhdStart + 28, false);
                duration = durHigh * 0x100000000 + durLow;
            }

            if (timeScale > 0) {
                metadata.duration = duration / timeScale;
            }
        }

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
                } else if (item.type === 'ISRC') {
                    metadata.isrc = new TextDecoder().decode(new Uint8Array(view.buffer, contentOffset, contentLen));
                } else if (item.type === 'cprt') {
                    metadata.copyright = new TextDecoder().decode(
                        new Uint8Array(view.buffer, contentOffset, contentLen)
                    );
                } else if (item.type === 'covr') {
                    const pictureData = new Uint8Array(view.buffer, contentOffset, contentLen);
                    const mime = getMimeType(pictureData);
                    const blob = new Blob([pictureData], { type: mime });
                    metadata.album.cover = URL.createObjectURL(blob);
                } else if (item.type === 'rtng') {
                    metadata.explicit =
                        contentLen > 0 && new Uint8Array(view.buffer, contentOffset, contentLen)[0] === 1;
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
async function calculateMp3Duration(file, startOffset) {
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

function getMimeType(data) {
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
        return 'image/png';
    return 'image/jpeg';
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
