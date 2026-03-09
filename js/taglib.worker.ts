// filepath: /workspaces/monochrome/js/taglib.worker.ts
declare var self: DedicatedWorkerGlobalScope;

import { TagLib, type PictureType } from 'taglib-wasm';
import { doTimed, doTimedAsync } from './doTimed';

const PICTURE_TYPE_VALUES = {
    FrontCover: 3,
};

export type TagLibWorkerMessageType = 'Add' | 'Get';

export interface TagLibWorkerMessage {
    type: TagLibWorkerMessageType;
    wasmUrl: string;
    audioData: Uint8Array;
}

interface TagLibWorkerResponse<T> {
    type: TagLibWorkerMessageType;
    data?: T;
    error?: string;
}

export interface TagLibMetadata {
    title?: string;
    artist?: string;
    albumTitle?: string;
    albumArtist?: string;
    trackNumber?: number;
    totalTracks?: number;
    discNumber?: number;
    totalDiscs?: number;
    bpm?: number;
    replayGain?: {
        albumReplayGain?: string;
        albumPeakAmplitude?: number;
        trackReplayGain?: string;
        trackPeakAmplitude?: number;
    };
    cover?: {
        data: Uint8Array;
        type: string;
    };
    releaseDate?: string;
    copyright?: string;
    isrc?: string;
    explicit?: boolean;
    lyrics?: string;
}

export interface TagLibReadMetadata extends TagLibMetadata {
    duration: number;
}

export type TagLibFileResponse = TagLibWorkerResponse<Uint8Array>;
export type TagLibMetadataResponse = TagLibWorkerResponse<TagLibReadMetadata>;

export type AddMetadataMessage = TagLibWorkerMessage & {
    type: 'Add';
} & TagLibMetadata;

export type GetMetadataMessage = TagLibWorkerMessage & {
    type: 'Get';
};

async function addMetadataToAudio(message: AddMetadataMessage): Promise<Uint8Array> {
    const {
        wasmUrl,
        audioData,
        title,
        artist,
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
        explicit,
        lyrics,
    } = message;

    const file = await doTimedAsync('Open file with taglib', async () => {
        const tagLib = await TagLib.initialize({
            wasmUrl: wasmUrl,
        });
        return await tagLib.open(audioData);
    });

    try {
        doTimed('Tagging file', () => {
            const isMp4 = file.isMP4();
            const media = file.audioProperties();
            const needsCombinedTrackDisc = isMp4 || media.containerFormat.toLowerCase() === 'mp3';

            if (title) {
                file.setProperty('TITLE', title);
            }

            if (artist) {
                file.setProperty('ARTIST', artist);
            }

            if (albumTitle) {
                file.setProperty('ALBUM', albumTitle);
            }

            const _albumArtist = albumArtist || artist;
            if (_albumArtist) {
                file.setProperty('ALBUMARTIST', _albumArtist);
            }

            if (trackNumber) {
                let trackString = String(trackNumber);

                if (needsCombinedTrackDisc && trackNumber && totalTracks) {
                    trackString = `${trackNumber}/${totalTracks}`;
                }

                if (needsCombinedTrackDisc) {
                    file.setProperty('TRACKNUMBER', trackString);
                } else {
                    file.setProperty('TRACKNUMBER', String(trackNumber));
                }
            }

            if (!needsCombinedTrackDisc && totalTracks) {
                file.setProperty('TRACKTOTAL', String(totalTracks));
            }

            if (discNumber) {
                let discString = String(discNumber);

                if (needsCombinedTrackDisc && discNumber && totalDiscs) {
                    discString = `${discNumber}/${totalDiscs}`;
                }

                if (needsCombinedTrackDisc) {
                    file.setProperty('DISCNUMBER', discString);
                } else {
                    file.setProperty('DISCNUMBER', String(discNumber));
                }
            }

            if (!needsCombinedTrackDisc && totalDiscs) {
                file.setProperty('DISCTOTAL', String(totalDiscs));
            }

            if (bpm != null && Number.isFinite(bpm)) {
                file.setProperty('BPM', String(Math.round(bpm)));
            }

            if (replayGain) {
                const { albumReplayGain, albumPeakAmplitude, trackReplayGain, trackPeakAmplitude } = replayGain;
                if (albumReplayGain) file.setProperty('REPLAYGAIN_ALBUM_GAIN', String(albumReplayGain));
                if (albumPeakAmplitude) file.setProperty('REPLAYGAIN_ALBUM_PEAK', String(albumPeakAmplitude));
                if (trackReplayGain) file.setProperty('REPLAYGAIN_TRACK_GAIN', String(trackReplayGain));
                if (trackPeakAmplitude) file.setProperty('REPLAYGAIN_TRACK_PEAK', String(trackPeakAmplitude));
            }

            if (releaseDate) {
                try {
                    const year = Number(releaseDate.split('-')[0]);
                    if (!isNaN(year)) {
                        file.setProperty('DATE', String(year));
                    }
                } catch {
                    // Invalid date, skip
                }
            }

            if (copyright) {
                file.setProperty('COPYRIGHT', copyright);
            }

            if (isrc) {
                file.setProperty('ISRC', isrc);

                if (isMp4) {
                    file.setMP4Item('xid ', `:isrc:${isrc}`);
                }
            }

            if (explicit) {
                if (isMp4) {
                    file.setMP4Item('rtng', '1');
                } else {
                    file.setProperty('ITUNESADVISORY', '1');
                }
            }

            if (lyrics) {
                file.setProperty('LYRICS', lyrics.replace(/\r/g, '').replace(/\n/g, '\r\n'));
            }

            if (cover) {
                file.setPictures([
                    {
                        mimeType: cover.type,
                        data: cover.data,
                        type: 'FrontCover',
                        description: 'Cover Art',
                    },
                ]);
            }
        });

        await doTimedAsync('Saving in-memory buffer', () => file.save());

        return file.getFileBuffer();
    } catch (err) {
        console.error(err);
    } finally {
        file.dispose();
    }

    return audioData;
}

async function getMetadataFromAudio(message: GetMetadataMessage): Promise<TagLibReadMetadata> {
    const { wasmUrl, audioData } = message;
    const data: TagLibReadMetadata = {
        duration: 0,
    };

    const file = await doTimedAsync('Open file with taglib', async () => {
        const tagLib = await TagLib.initialize({
            wasmUrl: wasmUrl,
        });
        return await tagLib.open(audioData);
    });

    try {
        const pictures = file.getPictures();
        const isMp4 = file.isMP4();
        const media = file.audioProperties();

        data.duration = media.duration;

        data.title = file.getProperty('TITLE') || undefined;
        data.artist = file.getProperty('ARTIST') || undefined;
        data.albumTitle = file.getProperty('ALBUM') || undefined;
        data.albumArtist = file.getProperty('ALBUMARTIST') || undefined;
        const [trackNumber, trackTotal] = file
            .getProperty('TRACKNUMBER')
            ?.split('/')
            .map((t) => Number(t.trim() || 0) || undefined);
        data.trackNumber = trackNumber || undefined;
        data.totalTracks = trackTotal ? trackTotal : Number(file.getProperty('TRACKTOTAL') || 0) || undefined;

        const [discNumber, discTotal] = file
            .getProperty('DISCNUMBER')
            ?.split('/')
            .map((t) => Number(t.trim() || 0) || undefined);
        data.discNumber = Number(file.getProperty('DISCNUMBER') || 0) || undefined;

        data.bpm = Number(file.getProperty('BPM') || 0) || undefined;
        data.copyright = file.getProperty('COPYRIGHT') || undefined;
        data.lyrics = file.getProperty('LYRICS') || undefined;
        data.releaseDate = file.getProperty('DATE') || undefined;

        const [replayGainAlbumGain, replayGainAlbumPeak, replayGainTrackGain, replayGainTrackPeak] = [
            file.getProperty('REPLAYGAIN_ALBUM_GAIN'),
            file.getProperty('REPLAYGAIN_ALBUM_PEAK'),
            file.getProperty('REPLAYGAIN_TRACK_GAIN'),
            file.getProperty('REPLAYGAIN_TRACK_PEAK'),
        ];

        const replayGain: TagLibMetadata['replayGain'] = {};
        if (replayGainAlbumGain) replayGain.albumReplayGain = replayGainAlbumGain;
        if (replayGainAlbumPeak) replayGain.albumPeakAmplitude = Number(replayGainAlbumPeak);
        if (replayGainTrackGain) replayGain.trackReplayGain = replayGainTrackGain;
        if (replayGainTrackPeak) replayGain.trackPeakAmplitude = Number(replayGainTrackPeak);
        if (Object.keys(replayGain).length > 0) {
            data.replayGain = replayGain;
        }

        data.isrc = (isMp4 && file.getMP4Item('xid ')?.split(':').at(-1)) || file.getProperty('ISRC') || undefined;
        data.explicit = (isMp4 && file.getMP4Item('rtng') === '1') || file.getProperty('ITUNESADVISORY') === '1';

        if (pictures.length > 0) {
            const picture = pictures.filter((p) => p.type === 'FrontCover')[0];
            if (picture) {
                data.cover = {
                    data: picture.data,
                    type: picture.mimeType,
                };
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        file.dispose();
    }

    return data;
}

self.onmessage = async (event: MessageEvent<TagLibWorkerMessage>) => {
    switch (event.data.type) {
        case 'Add':
            try {
                const result = await addMetadataToAudio(event.data as AddMetadataMessage);
                self.postMessage(
                    {
                        type: event.data.type,
                        data: result,
                    } satisfies TagLibFileResponse,
                    [result.buffer, event.data.audioData.buffer]
                );
            } catch (error) {
                self.postMessage({
                    type: event.data.type,
                    error: error instanceof Error ? error.message : String(error),
                } satisfies TagLibWorkerResponse<undefined>);
            }
            break;

        case 'Get':
            try {
                const result = await getMetadataFromAudio(event.data as GetMetadataMessage);
                self.postMessage(
                    {
                        type: event.data.type,
                        data: result,
                    } satisfies TagLibMetadataResponse,
                    [event.data.audioData.buffer]
                );
            } catch (error) {
                self.postMessage({
                    type: event.data.type,
                    error: error instanceof Error ? error.message : String(error),
                } satisfies TagLibWorkerResponse<undefined>);
            }
            break;
    }
};
