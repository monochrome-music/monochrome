import {
    getCoverBlob,
    getTrackTitle,
    getFullArtistString,
    getMimeType,
    getTrackCoverId,
    getTrackDiscNumber,
} from './utils.js';
import { fetchTagLib, addMetadataWithTagLib, getMetadataWithTagLib } from './taglib.ts';
import { doTimed, doTimedAsync } from './doTimed.ts';
import { managers } from './app.js';

export const METADATA_STRINGS = {
    VENDOR_STRING: 'Monochrome',
    DEFAULT_TITLE: 'Unknown Title',
    DEFAULT_ARTIST: 'Unknown Artist',
    DEFAULT_ALBUM: 'Unknown Album',
};

export function prefetchMetadataObjects(track, api, coverBlob = null) {
    const _tagLib = fetchTagLib().catch(console.error);
    const coverId = getTrackCoverId(track);
    const coverFetch = coverBlob
        ? Promise.resolve(coverBlob)
        : coverId
          ? getCoverBlob(api, coverId).catch(console.error)
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
    const { coverFetch, lyricsFetch } = prefetchPromises;

    /**
     * @type {import("./taglib.types.ts").TagLibMetadata}
     */
    const data = {};

    const audioBuffer = await doTimedAsync('Get audio array buffer', () => audioBlob.arrayBuffer());

    try {
        data.title = getTrackTitle(track);
        data.artist = getFullArtistString(track);
        data.albumTitle = track.album.title;
        data.albumArtist = track.album?.artist?.name || track.artist?.name;
        data.trackNumber = track.trackNumber;
        data.discNumber = track.volumeNumber ?? track.discNumber;
        data.totalTracks = track.album.numberOfTracksOnDisc ?? track.album.numberOfTracks;
        data.totalDiscs = track.album.totalDiscs;
        data.copyright = track.copyright;
        data.isrc = track.isrc;
        data.explicit = Boolean(track.explicit);

        if (track.bpm != null) {
            const bpm = Number(track.bpm);
            if (Number.isFinite(bpm)) {
                data.bpm = Math.round(bpm);
            }
        }

        if (track.replayGain) {
            const { albumReplayGain, albumPeakAmplitude, trackReplayGain, trackPeakAmplitude } = track.replayGain;
            data.replayGain = {
                albumReplayGain: `${Number(albumReplayGain)} dB`,
                trackReplayGain: `${Number(trackReplayGain)} dB`,
                albumPeakAmplitude: albumPeakAmplitude ? Number(albumPeakAmplitude) : undefined,
                trackPeakAmplitude: trackPeakAmplitude ? Number(trackPeakAmplitude) : undefined,
            };
        }

        const releaseDateStr =
            track.album?.releaseDate?.trim() || track?.streamStartDate?.split('T')?.[0]?.trim() || undefined;

        if (releaseDateStr) {
            try {
                const year = Number(releaseDateStr.split('-')[0]);
                if (!isNaN(year)) {
                    data.releaseDate = String(releaseDateStr);
                }
            } catch {
                // Invalid date, skip
                console.warn('Invalid date', releaseDateStr);
            }
        }

        try {
            if (track.album?.cover) {
                const coverBlob = await coverFetch;
                const coverBuffer = new Uint8Array(await coverBlob.arrayBuffer());

                if (coverBlob) {
                    data.cover = {
                        data: coverBuffer,
                        type: getMimeType(coverBuffer),
                    };
                }
            }
        } catch (e) {
            console.warn('Error setting cover metadata.', track, e);
        }

        try {
            const lyrics = await lyricsFetch;
            data.lyrics = lyrics?.subtitles || lyrics?.plainLyrics;
        } catch (e) {
            console.warn('Error setting lyrics metadata', track, e);
        }

        const newAudioBuffer = await addMetadataWithTagLib(audioBuffer, {
            ...data,
        });

        return doTimed(
            'Create new audio blob',
            () =>
                new Blob([newAudioBuffer], {
                    type: audioBlob.type,
                })
        );
    } catch (err) {
        console.error(err);
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
        explicit: false,
        isLocal: true,
        file: file,
        id: `local-${file.name}-${file.lastModified}`,
    };

    try {
        const data = await getMetadataWithTagLib(await file.arrayBuffer());

        if (data) {
            metadata.title = data.title || metadata.title;
            metadata.artists.push(
                ...(data.artist || '')
                    .split(';')
                    .map((a) => a.trim())
                    .filter((a) => a)
            );
            metadata.artist = data.artist || metadata.artist;
            metadata.album.title = data.albumTitle || metadata.album.title;
            metadata.album.releaseDate = data.releaseDate || metadata.album.releaseDate;

            if (data.cover) {
                const blob = new Blob([data.cover.data], { type: data.cover.type });
                metadata.album.cover = URL.createObjectURL(blob);
            }

            metadata.duration = data.duration;
            metadata.isrc = data.isrc || metadata.isrc;
            metadata.copyright = data.copyright || metadata.copyright;
            metadata.explicit = !!data.explicit;
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
