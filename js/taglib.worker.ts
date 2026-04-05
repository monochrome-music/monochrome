// filepath: /workspaces/monochrome/js/taglib.worker.ts
declare let self: DedicatedWorkerGlobalScope;

import { ByteVector } from '!/@dantheman827/taglib-ts/src/byteVector.js';
import { Mp4Item } from '!/@dantheman827/taglib-ts/src/mp4/mp4Tag.js';
import { Variant } from '!/@dantheman827/taglib-ts/src/toolkit/variant.js';
import { doTimed, doTimedAsync } from './doTimed';
import {
    Mp4Stik,
    type _AddMetadataMessage,
    type _GetMetadataMessage,
    type AddMetadataMessage,
    type TagLibFileResponse,
    type TagLibMetadata,
    type TagLibMetadataResponse,
    type TagLibReadMetadata,
    type TagLibWorkerMessage,
    type TagLibWorkerResponse,
} from './taglib.types';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { File as TagLibFile } from '!/@dantheman827/taglib-ts/src/file.js';
import { FileRef } from '!/@dantheman827/taglib-ts/src/fileRef.js';
import { ChunkedByteVectorStream } from '!/@dantheman827/taglib-ts/src/toolkit/chunkedByteVectorStream.js';
import { ReadStyle } from '!/@dantheman827/taglib-ts/src/toolkit/types';
import { BlobStream } from '!/@dantheman827/taglib-ts/src/toolkit/blobStream.js';
import { FileSystemFileHandleStream } from '!/@dantheman827/taglib-ts/src/toolkit/fileSystemFileHandleStream.js';

// Imported to ensure support is bundled in this chunk, even if not directly used
import { FlacFile } from '!/@dantheman827/taglib-ts/src/flac/flacFile.js';
import { MpegFile } from '!/@dantheman827/taglib-ts/src/mpeg/mpegFile.js';
import { Mp4File } from '!/@dantheman827/taglib-ts/src/mp4/mp4File.js';
import { OggVorbisFile } from '!/@dantheman827/taglib-ts/src/ogg/vorbis/vorbisFile.js';
import { WavFile } from '!/@dantheman827/taglib-ts/src/riff/wav/wavFile';

export const isWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

export async function addMetadataToAudio(message: _AddMetadataMessage): Promise<Uint8Array | Blob> {
    const {
        audioData,
        audioRef,
        filename: _filename,
        title,
        artist,
        writeArtistsSeparately = false,
        albumTitle,
        albumArtist,
        trackNumber,
        totalTracks,
        discNumber,
        totalDiscs,
        bpm,
        replayGain,
        cover,
        releaseDate,
        copyright,
        isrc,
        upc,
        explicit,
        lyrics,
        stik = Mp4Stik.Normal,
        extra,
        returnType = 'uint8array',
    } = message;

    const ref =
        audioRef ??
        (await doTimedAsync(
            `Opening file (${audioData.constructor.name})`,
            async () => await getFileRefFromAudioData(audioData)
        ));

    if (!ref || !ref.isValid) {
        console.warn('taglib-ts: failed to open file');
        return audioData;
    }

    const underlying = ref.file();
    const isFlac = underlying instanceof FlacFile;
    const isMp4 = underlying instanceof Mp4File;
    const isMpeg = underlying instanceof MpegFile;
    const isOgg = underlying instanceof OggVorbisFile;
    const _isWav = underlying instanceof WavFile;

    const needsCombinedTrackDisc = isMp4 || isMpeg;

    const artistArray = Array.isArray(artist) ? artist : artist ? [artist] : [];
    const supportsMultiValuedArtist = writeArtistsSeparately && (isFlac || isOgg || isMp4);

    doTimed('Tagging file', () => {
        const props = ref.properties();

        if (title) props.replace('TITLE', [title]);
        if (artistArray.length)
            props.replace('ARTIST', supportsMultiValuedArtist ? artistArray : [artistArray.join('; ')]);
        if (albumTitle) props.replace('ALBUM', [albumTitle]);
        if (albumArtist || artistArray.length)
            props.replace('ALBUMARTIST', albumArtist ? [albumArtist] : [artistArray.join('; ')]);

        if (trackNumber) {
            const trackStr =
                needsCombinedTrackDisc && totalTracks ? `${trackNumber}/${totalTracks}` : String(trackNumber);
            props.replace('TRACKNUMBER', [trackStr]);
        }
        if (!needsCombinedTrackDisc && totalTracks) {
            props.replace('TRACKTOTAL', [String(totalTracks)]);
        }

        if (discNumber) {
            const discStr = needsCombinedTrackDisc && totalDiscs ? `${discNumber}/${totalDiscs}` : String(discNumber);
            props.replace('DISCNUMBER', [discStr]);
        }
        if (!needsCombinedTrackDisc && totalDiscs) {
            props.replace('DISCTOTAL', [String(totalDiscs)]);
        }

        if (bpm != null && Number.isFinite(bpm)) {
            props.replace('BPM', [String(Math.round(bpm))]);
        }

        if (replayGain) {
            const { albumReplayGain, albumPeakAmplitude, trackReplayGain, trackPeakAmplitude } = replayGain;
            if (albumReplayGain != null) props.replace('REPLAYGAIN_ALBUM_GAIN', [String(albumReplayGain)]);
            if (albumPeakAmplitude != null) props.replace('REPLAYGAIN_ALBUM_PEAK', [String(albumPeakAmplitude)]);
            if (trackReplayGain != null) props.replace('REPLAYGAIN_TRACK_GAIN', [String(trackReplayGain)]);
            if (trackPeakAmplitude != null) props.replace('REPLAYGAIN_TRACK_PEAK', [String(trackPeakAmplitude)]);
        }

        if (releaseDate) {
            try {
                const year = Number(releaseDate.split('-')[0]);
                if (!isNaN(year)) props.replace('DATE', [String(year)]);
            } catch {
                // Invalid date, skip
            }
        }

        if (copyright) props.replace('COPYRIGHT', [copyright]);
        if (isrc) props.replace('ISRC', [isrc]);
        if (isrc && isMp4) {
            const mp4Tag = underlying.tag();
            mp4Tag.setItem('xid ', Mp4Item.fromStringList([`:isrc:${isrc}`]));
        }
        if (upc) props.replace('UPC', [upc]);
        if (lyrics) props.replace('LYRICS', [lyrics.replace(/\r/g, '').replace(/\n/g, '\r\n')]);

        if (explicit !== undefined) {
            if (isMp4) {
                // rtng is a byte item - must be set directly on the Mp4Tag
                const mp4Tag = underlying.tag();
                mp4Tag.setItem('rtng', Mp4Item.fromByte(explicit ? 1 : 0));
            } else {
                props.replace('ITUNESADVISORY', [explicit ? '1' : '0']);
            }
        }

        if (stik != null && isMp4) {
            const mp4Tag = underlying.tag();
            mp4Tag.setItem('stik', Mp4Item.fromByte(stik));
        }

        for (const [key, value] of Object.entries(extra || {})) {
            if (value) props.replace(key, [value]);
        }

        ref.setProperties(props);

        if (cover) {
            const pictureMap = new Map<string, Variant>();
            pictureMap.set('data', Variant.fromByteVector(ByteVector.fromByteArray(cover.data)));
            pictureMap.set('mimeType', Variant.fromString(cover.type));
            pictureMap.set('pictureType', Variant.fromInt(3)); // FrontCover
            ref.setComplexProperties('PICTURE', [pictureMap]);
        }
    });

    await doTimedAsync('Saving in-memory buffer', async () => {
        await ref.save();
    });

    const file = ref.file();
    if (!file) return audioData;
    const stream = file.stream();

    if (stream instanceof ChunkedByteVectorStream) {
        const data = doTimed(
            'Converting saved file to ' + (returnType == 'blob' ? 'Blob' : 'Uint8Array'),
            () => stream.data().data
        );
        if (returnType === 'blob') {
            const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
            return blob;
        }
        return data;
    } else if (stream instanceof BlobStream) {
        const blob = doTimed('Converting saved file to ' + (returnType == 'blob' ? 'Blob' : 'Uint8Array'), () =>
            stream.toBlob()
        );
        if (returnType === 'blob') {
            return blob;
        }
        const arrayBuffer = await doTimed('Reading Blob as ArrayBuffer', async () => await blob.arrayBuffer());
        return new Uint8Array(arrayBuffer);
    }

    console.warn('taglib-ts: unexpected stream type after saving file', stream);
    return audioData;
}

export async function getMetadataFromAudio(message: _GetMetadataMessage): Promise<TagLibReadMetadata> {
    const { audioData, audioRef } = message;
    const data: TagLibReadMetadata = { duration: 0 };

    const ref =
        audioRef ??
        (await doTimedAsync(
            `Opening file (${audioData.constructor.name})`,
            async () => await getFileRefFromAudioData(audioData)
        ));

    if (!ref || !ref.isValid) return data;

    const underlying = ref.file();
    const isMp4 = underlying instanceof Mp4File;
    const ap = ref.audioProperties();

    if (ap) data.duration = ap.lengthInSeconds;

    const props = ref.properties();

    data.title = props.get('TITLE')?.[0] || undefined;
    data.artist = props.get('ARTIST')?.[0] || undefined;
    data.albumTitle = props.get('ALBUM')?.[0] || undefined;
    data.albumArtist = props.get('ALBUMARTIST')?.[0] || undefined;

    const trackStr = props.get('TRACKNUMBER')?.[0] ?? '';
    const [trackNum, trackTotal] = trackStr.split('/').map((t) => Number(t.trim() || 0) || undefined);
    data.trackNumber = trackNum || undefined;
    data.totalTracks = trackTotal ?? (Number(props.get('TRACKTOTAL')?.[0] || 0) || undefined);

    const discStr = props.get('DISCNUMBER')?.[0] ?? '';
    const [discNum, discTotal] = discStr.split('/').map((t) => Number(t.trim() || 0) || undefined);
    data.discNumber = discNum || undefined;
    if (!data.totalDiscs) {
        data.totalDiscs = discTotal ?? (Number(props.get('DISCTOTAL')?.[0] || 0) || undefined);
    }

    data.bpm = Number(props.get('BPM')?.[0] || 0) || undefined;
    data.copyright = props.get('COPYRIGHT')?.[0] || undefined;
    data.lyrics = props.get('LYRICS')?.[0] || undefined;
    data.releaseDate = props.get('DATE')?.[0] || undefined;

    const replayGain: TagLibMetadata['replayGain'] = {};
    const albumGain = props.get('REPLAYGAIN_ALBUM_GAIN')?.[0];
    const albumPeak = props.get('REPLAYGAIN_ALBUM_PEAK')?.[0];
    const trackGain = props.get('REPLAYGAIN_TRACK_GAIN')?.[0];
    const trackPeak = props.get('REPLAYGAIN_TRACK_PEAK')?.[0];
    if (albumGain) replayGain.albumReplayGain = albumGain;
    if (albumPeak) replayGain.albumPeakAmplitude = Number(albumPeak);
    if (trackGain) replayGain.trackReplayGain = trackGain;
    if (trackPeak) replayGain.trackPeakAmplitude = Number(trackPeak);
    if (Object.keys(replayGain).length > 0) data.replayGain = replayGain;

    data.isrc = props.get('ISRC')?.[0] || undefined;

    if (isMp4) {
        const mp4Tag = underlying.tag();
        data.explicit = mp4Tag.item('rtng')?.toByte() === 1;
    } else {
        data.explicit = props.get('ITUNESADVISORY')?.[0] === '1';
    }

    const pictures = ref.complexProperties('PICTURE');
    if (pictures.length > 0) {
        const pic = pictures[0];
        const picData = pic.get('data')?.toByteVector();
        const mimeType = pic.get('mimeType')?.toString() ?? '';
        if (picData && picData.length > 0) {
            data.cover = { data: picData.data, type: mimeType };
        }
    }

    return data;
}

async function getFileRefFromAudioData(
    audioData: Uint8Array | Blob | File | FileSystemFileHandle | FileSystemFileEntry
): Promise<FileRef | null> {
    if (audioData instanceof Blob || audioData instanceof File) {
        const stream = new BlobStream(audioData);
        return await FileRef.open(stream, true, ReadStyle.Average);
    } else if (audioData instanceof FileSystemFileHandle) {
        const stream = await FileSystemFileHandleStream.open(audioData, true);
        return await FileRef.open(stream, true, ReadStyle.Average);
    } else if ('FileSystemFileEntry' in globalThis && audioData instanceof FileSystemFileEntry) {
        const file = await new Promise<File>((resolve) => audioData.file((f) => resolve(f)));
        const stream = new BlobStream(file);
        return await FileRef.open(stream, true, ReadStyle.Average);
    } else if (audioData instanceof Uint8Array) {
        const stream = new ChunkedByteVectorStream(audioData);
        return await FileRef.open(stream, true, ReadStyle.Average);
    }

    throw new Error('Unsupported audio data type');
}

if (isWorker) {
    self.onmessage = async (event: MessageEvent<TagLibWorkerMessage>) => {
        const transfer: Transferable[] = [];
        if (event.data.audioData?.buffer instanceof ArrayBuffer) {
            transfer.push(event.data.audioData.buffer);
        }

        switch (event.data.type) {
            case 'Add':
                if ((event.data as AddMetadataMessage).cover?.data?.buffer instanceof ArrayBuffer) {
                    transfer.push((event.data as AddMetadataMessage).cover.data.buffer);
                }

                try {
                    const result = (await addMetadataToAudio({
                        ...event.data,
                        returnType: 'uint8array',
                    } as _AddMetadataMessage)) as Uint8Array;

                    if (result.buffer !== event.data.audioData.buffer) {
                        transfer.push(result.buffer);
                    }

                    self.postMessage(
                        {
                            type: event.data.type,
                            data: result,
                        } satisfies TagLibFileResponse,
                        transfer
                    );
                } catch (error) {
                    self.postMessage(
                        {
                            type: event.data.type,
                            error: error instanceof Error ? error.message : String(error),
                        } satisfies TagLibWorkerResponse<undefined>,
                        transfer
                    );
                }
                break;

            case 'Get':
                try {
                    const result = await getMetadataFromAudio({
                        ...event.data,
                    } as _GetMetadataMessage);
                    self.postMessage(
                        {
                            type: event.data.type,
                            data: result,
                        } satisfies TagLibMetadataResponse,
                        transfer
                    );
                } catch (error) {
                    self.postMessage(
                        {
                            type: event.data.type,
                            error: error instanceof Error ? error.message : String(error),
                        } satisfies TagLibWorkerResponse<undefined>,
                        transfer
                    );
                }
                break;
        }
    };
}
