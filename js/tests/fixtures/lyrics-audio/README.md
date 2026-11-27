# Generated audio fixtures

These files are an 80 ms, 440 Hz mono sine wave generated locally with FFmpeg.
They contain no copyrighted recording. FLAC, MP3, AAC and ALAC fixtures include
`title=Original` and `album=Existing`; WAV tests the unsupported TTML tag path.

To regenerate (FFmpeg with libmp3lame):

```sh
ffmpeg -f lavfi -i sine=frequency=440:duration=0.08 -metadata title=Original -metadata album=Existing -c:a flac sample.flac
ffmpeg -f lavfi -i sine=frequency=440:duration=0.08 -metadata title=Original -metadata album=Existing -c:a libmp3lame sample.mp3
ffmpeg -f lavfi -i sine=frequency=440:duration=0.08 -metadata title=Original -metadata album=Existing -c:a aac sample.m4a
ffmpeg -f lavfi -i sine=frequency=440:duration=0.08 -metadata title=Original -metadata album=Existing -c:a alac sample-alac.m4a
ffmpeg -f lavfi -i sine=frequency=440:duration=0.08 -c:a pcm_s16le sample.wav
```
