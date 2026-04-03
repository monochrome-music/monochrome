import { expect, test, suite, vi } from 'vitest';
import { apiSettings, preferDolbyAtmosSettings, losslessContainerSettings } from './storage.js';
import { MusicAPI } from './music-api.js';
import { LyricsManager } from './lyrics.js';
import { HiFiClient } from './HiFi.js';
import { FileRef } from '!/@dantheman827/taglib-ts/src/fileRef.js';
import { Mp4File } from '!/@dantheman827/taglib-ts/src/mp4/mp4File.js';
import { MpegFile } from '!/@dantheman827/taglib-ts/src/mpeg/mpegFile.js';
import { FlacFile } from '!/@dantheman827/taglib-ts/src/flac/flacFile.js';
import { Mp4Atom, Mp4Atoms } from '!/@dantheman827/taglib-ts/src/mp4/mp4Atoms.js';
import { ByteVector, StringType } from '!/@dantheman827/taglib-ts/src/byteVector.js';
import { Mp4Codec } from '!/@dantheman827/taglib-ts/src/mp4/mp4Properties.js';
import { OggFile } from '!/@dantheman827/taglib-ts/src/ogg/oggFile.js';
import { ffmpeg } from './ffmpeg.js';
import type { Track } from './container-classes.js';

vi.mock(import('./storage.js'), async (importOriginal) => {
    const mod = await importOriginal();

    return {
        ...mod,
        preferDolbyAtmosSettings: {
            ...mod.preferDolbyAtmosSettings,
            isEnabled: vi.fn(),
            setEnabled: vi.fn(),
        },
        losslessContainerSettings: {
            ...mod.losslessContainerSettings,
            getContainer: vi.fn(),
            setContainer: vi.fn(),
        },
    };
});

vi.mock(import('./ffmpeg.js'), async (importOriginal) => {
    const mod = await importOriginal();

    return {
        ...mod,
        ffmpeg: vi.fn(mod.ffmpeg),
    };
});

vi.mock(import('./doTimed.js'), async (importOriginal) => {
    const mod = await importOriginal();

    return {
        ...mod,
        doTimed: function <T>(_label: string, fn: () => T): T {
            return fn();
        },
        doTimedAsync<T, R = T extends Promise<T> ? Promise<T> : T>(
            _message: string,
            callback: () => R,
            throwError: boolean = false
        ): R {
            return new Promise<R>((resolve, reject) => {
                Promise.resolve()
                    .then(callback)
                    .then(resolve)
                    .catch((err) => {
                        if (throwError) {
                            reject(err as Error);
                        } else {
                            resolve(undefined);
                        }
                    });
            }) as R;
        },
    } satisfies typeof import('./doTimed.js');
});

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

enum Detection {
    DolbyAtmos,
    FlacHD,
    FlacLossless,
    AlacHD,
    AlacLossless,
    Mp4Flac,
    AacLow,
    AacReallyLow,
    AacHigh,
    AAC_256,
    MP3_320,
    MP3_256,
    MP3_128,
    OGG_320,
    OGG_256,
    OGG_128,
}

suite('Track Downloads', async () => {
    const SILENCE_TRACK = 46022548;
    const TRACK_ATMOS = 463900720; // Taylor Swift - The Fate of Ophelia
    const TRACK_NO_LOSSLESS = 31097959; // deadmau5 - while(1<2)

    await MusicAPI.initialize(apiSettings);
    await LyricsManager.initialize(apiSettings);
    await HiFiClient.initialize();

    const api = MusicAPI.instance.tidalAPI;

    async function downloadTrack(trackId: number, quality: string) {
        const track = (await (await HiFiClient.instance.getInfo(trackId)).json()) as { data: Track };
        return await api.downloadTrack(trackId.toString(), quality, undefined, {
            track: track.data,
            triggerDownload: false,
        });
    }

    test.beforeEach(() => {
        vi.clearAllMocks();
    });

    test.each([
        {
            display_quality: 'Dolby Atmos',
            quality: 'HI_RES_LOSSLESS',
            container: 'flac',
            preferDolbyAtmos: true,
            trackId: TRACK_ATMOS,
            detection: Detection.DolbyAtmos,
            ffmpegCalls: 0,
        },
        {
            display_quality: 'HD Lossless (FLAC)',
            quality: 'HI_RES_LOSSLESS',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.FlacHD,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'Lossless (FLAC)',
            quality: 'LOSSLESS',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.FlacLossless,
            ffmpegCalls: 0,
        },
        {
            display_quality: 'HD Lossless (ALAC)',
            quality: 'HI_RES_LOSSLESS',
            container: 'alac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.AlacHD,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'Lossless (ALAC)',
            quality: 'LOSSLESS',
            container: 'alac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.AlacLossless,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'HD Lossless (Unchanged)',
            quality: 'HI_RES_LOSSLESS',
            container: 'nochange',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.Mp4Flac,
            ffmpegCalls: 0,
        },
        {
            display_quality: 'Lossless (Unchanged)',
            quality: 'LOSSLESS',
            container: 'nochange',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.FlacLossless,
            ffmpegCalls: 0,
        },
        {
            display_quality: 'Lossless, but not really',
            quality: 'HI_RES_LOSSLESS',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: TRACK_NO_LOSSLESS,
            detection: Detection.AacReallyLow,
            ffmpegCalls: 0,
        },
        {
            display_quality: 'High',
            quality: 'HIGH',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.AacHigh,
            ffmpegCalls: 0,
        },
        {
            display_quality: 'Low',
            quality: 'LOW',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.AacLow,
            ffmpegCalls: 0,
        },

        {
            display_quality: 'AAC 256',
            quality: 'FFMPEG_AAC_256',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: TRACK_ATMOS,
            detection: Detection.AAC_256,
            ffmpegCalls: 1,
        },

        {
            display_quality: 'MP3 320',
            quality: 'FFMPEG_MP3_320',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.MP3_320,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'MP3 256',
            quality: 'FFMPEG_MP3_256',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.MP3_256,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'MP3 128',
            quality: 'FFMPEG_MP3_128',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.MP3_128,
            ffmpegCalls: 1,
        },

        {
            display_quality: 'OGG 320',
            quality: 'FFMPEG_OGG_320',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.OGG_320,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'OGG 256',
            quality: 'FFMPEG_OGG_256',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.OGG_256,
            ffmpegCalls: 1,
        },
        {
            display_quality: 'OGG 128',
            quality: 'FFMPEG_OGG_128',
            container: 'flac',
            preferDolbyAtmos: false,
            trackId: SILENCE_TRACK,
            detection: Detection.OGG_128,
            ffmpegCalls: 1,
        },
    ])('$display_quality', async ({ quality, container, preferDolbyAtmos, trackId, detection, ffmpegCalls }) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        vi.mocked(preferDolbyAtmosSettings.isEnabled).mockReturnValue(preferDolbyAtmos);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        vi.mocked(losslessContainerSettings.getContainer).mockReturnValue(container);

        const blob = await downloadTrack(trackId, quality);
        expect(ffmpeg).toHaveBeenCalledTimes(ffmpegCalls);
        const file = await FileRef.fromBlob(blob);
        const stream = file.file().stream();

        expect(file.isValid).toBe(true);

        let stsd: Mp4Atom | null = null;
        let stsdData: ByteVector | null = null;

        const streamPosition = await stream.tell();

        if (file.file() instanceof Mp4File) {
            const atoms = await Mp4Atoms.create(stream);
            const moov = atoms.find('moov');
            expect(moov).not.toBeNull();

            let trak: Mp4Atom | null = null;
            let data: ByteVector;

            const trakList = moov.findAll('trak');
            for (const track of trakList) {
                const hdlr = track.find('mdia', 'hdlr');
                if (!hdlr) continue;
                trak = track;
                await stream.seek(hdlr.offset);
                data = await stream.readBlock(hdlr.length);
                if (data.containsAt(ByteVector.fromString('soun', StringType.Latin1), 16)) {
                    break;
                }
                trak = null;
            }
            expect(trak).toBeInstanceOf(Mp4Atom);
            stsd = trak.find('mdia', 'minf', 'stbl', 'stsd');
            expect(stsd).toBeInstanceOf(Mp4Atom);
            await stream.seek(stsd.offset);
            stsdData = await stream.readBlock(stsd.length);
        }

        await stream.seek(streamPosition);

        switch (detection) {
            case Detection.DolbyAtmos: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const codec = stsdData.toString().substring(20, 24);
                expect(codec).toBe('ec-3');
                break;
            }
            case Detection.FlacHD: {
                expect(file.file()).toBeInstanceOf(FlacFile);
                const flac = file.file() as FlacFile;
                expect(flac.audioProperties().bitsPerSample).toBe(24);
                expect(flac.audioProperties().sampleRate).toBe(176400);
                break;
            }
            case Detection.FlacLossless: {
                expect(file.file()).toBeInstanceOf(FlacFile);
                const flac = file.file() as FlacFile;
                expect(flac.audioProperties().bitsPerSample).toBe(16);
                expect(flac.audioProperties().sampleRate).toBe(44100);
                break;
            }
            case Detection.Mp4Flac: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const codec = stsdData.toString().substring(20, 24);
                expect(codec).toBe('fLaC');
                break;
            }
            case Detection.AlacHD: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const mp4 = file.file() as Mp4File;
                expect(mp4.audioProperties().codec).toBe(Mp4Codec.ALAC);
                expect(mp4.audioProperties().bitsPerSample).toBe(24);
                expect(mp4.audioProperties().sampleRate).toBe(176400);
                break;
            }
            case Detection.AlacLossless: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const mp4 = file.file() as Mp4File;
                expect(mp4.audioProperties().codec).toBe(Mp4Codec.ALAC);
                expect(mp4.audioProperties().bitsPerSample).toBe(16);
                expect(mp4.audioProperties().sampleRate).toBe(44100);
                break;
            }
            case Detection.AacLow: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const mp4 = file.file() as Mp4File;
                expect(mp4.audioProperties().codec).toBe(Mp4Codec.AAC);
                expect(mp4.audioProperties().bitsPerSample).toBe(16);
                expect(mp4.audioProperties().sampleRate).toBe(44100);
                expect(mp4.audioProperties().bitrate).toBe(97);
                break;
            }
            case Detection.AacReallyLow: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const mp4 = file.file() as Mp4File;
                expect(mp4.audioProperties().codec).toBe(Mp4Codec.AAC);
                expect(mp4.audioProperties().bitsPerSample).toBe(16);
                expect(mp4.audioProperties().sampleRate).toBe(22050);
                expect(mp4.audioProperties().bitrate).toBe(97);
                break;
            }
            case Detection.AacHigh: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const mp4 = file.file() as Mp4File;
                expect(mp4.audioProperties().codec).toBe(Mp4Codec.AAC);
                expect(mp4.audioProperties().bitsPerSample).toBe(16);
                expect(mp4.audioProperties().sampleRate).toBe(44100);
                expect(mp4.audioProperties().bitrate).toBe(322);
                break;
            }

            case Detection.AAC_256: {
                expect(file.file()).toBeInstanceOf(Mp4File);
                const mp4 = file.file() as Mp4File;
                expect(mp4.audioProperties().codec).toBe(Mp4Codec.AAC);
                expect(mp4.audioProperties().bitsPerSample).toBe(16);
                expect(mp4.audioProperties().sampleRate).toBe(44100);
                expect(mp4.audioProperties().bitrate).toBe(263);
                break;
            }

            case Detection.MP3_320: {
                expect(file.file()).toBeInstanceOf(MpegFile);
                const mp3 = file.file() as MpegFile;
                expect(mp3.audioProperties().sampleRate).toBe(44100);
                expect(mp3.audioProperties().bitrate).toBe(322);
                break;
            }

            case Detection.MP3_256: {
                expect(file.file()).toBeInstanceOf(MpegFile);
                const mp3 = file.file() as MpegFile;
                expect(mp3.audioProperties().sampleRate).toBe(44100);
                expect(mp3.audioProperties().bitrate).toBe(258);
                break;
            }

            case Detection.MP3_128: {
                expect(file.file()).toBeInstanceOf(MpegFile);
                const mp3 = file.file() as MpegFile;
                expect(mp3.audioProperties().sampleRate).toBe(44100);
                expect(mp3.audioProperties().bitrate).toBe(129);
                break;
            }

            case Detection.OGG_320: {
                expect(file.file()).toBeInstanceOf(OggFile);
                const ogg = file.file() as OggFile;
                expect(ogg.audioProperties().sampleRate).toBe(44100);
                expect(ogg.audioProperties().bitrate).toBe(314);
                break;
            }

            case Detection.OGG_256: {
                expect(file.file()).toBeInstanceOf(OggFile);
                const ogg = file.file() as OggFile;
                expect(ogg.audioProperties().sampleRate).toBe(44100);
                expect(ogg.audioProperties().bitrate).toBe(253);
                break;
            }

            case Detection.OGG_128: {
                expect(file.file()).toBeInstanceOf(OggFile);
                const ogg = file.file() as OggFile;
                expect(ogg.audioProperties().sampleRate).toBe(44100);
                expect(ogg.audioProperties().bitrate).toBe(130);
                break;
            }

            default:
                throw new Error('Unknown detection type');
        }
    });
});
