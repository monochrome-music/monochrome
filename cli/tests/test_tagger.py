"""
Tests for MetadataTagger and cover art embedding across MP3, FLAC, M4A, OPUS.
"""
import base64
import subprocess
import sys
import tempfile
from pathlib import Path

# Add cli to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mutagen.flac import FLAC, Picture
from mutagen.id3 import ID3
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus

from monochrome_cli.core.tagger import MetadataTagger
from monochrome_cli.types import AudioFormat, LyricsData, TrackMetadata


def create_dummy_audio(path: Path, codec: str = "libmp3lame", duration: int = 1):
    # Generate 1 sec of silent audio using ffmpeg
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", str(duration), "-acodec", codec, str(path)
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def test_cover_fetching():
    print("Testing cover art fetching...")
    # Tidal cover image
    test_cover_url = "https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg"
    data = MetadataTagger.fetch_cover_bytes(test_cover_url)
    assert data is not None, "Failed to download cover bytes"
    assert len(data) > 5000, f"Cover image too small: {len(data)} bytes"
    print(f"  ✔ Cover fetched successfully ({len(data)} bytes, JPEG/PNG)")


def test_mp3_tagging():
    print("Testing MP3 ID3v2.4 tagging & cover art...")
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / "test.mp3"
        create_dummy_audio(file_path, codec="libmp3lame")

        track = TrackMetadata(
            title="Get Lucky",
            artist="Daft Punk",
            album="Random Access Memories",
            album_artist="Daft Punk",
            track_number=8,
            total_tracks=13,
            disc_number=1,
            total_discs=1,
            year="2013",
            genre="Disco",
            isrc="USQX91300105",
            cover_url="https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg",
            lyrics=LyricsData(plain_lyrics="Like the legend of the phoenix...", synced_lyrics="[00:05.00] Like the legend...")
        )

        ok = MetadataTagger.apply_metadata(file_path, track, AudioFormat.MP3_320, embed_cover=True, embed_lyrics=True)
        assert ok, "Metadata application failed"

        # Verify with Mutagen ID3
        audio = ID3(file_path)
        assert audio.get("TIT2").text[0] == "Get Lucky"
        assert audio.get("TPE1").text[0] == "Daft Punk"
        assert audio.get("TALB").text[0] == "Random Access Memories"
        assert audio.get("TRCK").text[0] == "8/13"
        assert str(audio.get("TDRC").text[0]) == "2013"
        assert audio.get("TSRC").text[0] == "USQX91300105"
        assert "APIC:Cover" in audio or any(k.startswith("APIC") for k in audio.keys()), "APIC cover not found"
        assert "USLT:Lyrics:eng" in audio or any(k.startswith("USLT") for k in audio.keys()), "USLT lyrics not found"
        print("  ✔ MP3 tags (TIT2, TPE1, TALB, TRCK, TDRC, TSRC, APIC, USLT) verified!")


def test_flac_tagging():
    print("Testing FLAC Vorbis comment tagging & Picture block...")
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / "test.flac"
        create_dummy_audio(file_path, codec="flac")

        track = TrackMetadata(
            title="Get Lucky",
            artist="Daft Punk",
            album="Random Access Memories",
            track_number=8,
            year="2013",
            cover_url="https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg"
        )

        ok = MetadataTagger.apply_metadata(file_path, track, AudioFormat.FLAC, embed_cover=True)
        assert ok, "FLAC tagging failed"

        audio = FLAC(file_path)
        assert audio["TITLE"][0] == "Get Lucky"
        assert audio["ARTIST"][0] == "Daft Punk"
        assert audio["ALBUM"][0] == "Random Access Memories"
        assert audio["TRACKNUMBER"][0] == "8"
        assert len(audio.pictures) > 0, "FLAC pictures empty"
        print(f"  ✔ FLAC tags & Picture block ({audio.pictures[0].mime}) verified!")


def test_m4a_tagging():
    print("Testing M4A MP4 atoms & cover art...")
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / "test.m4a"
        create_dummy_audio(file_path, codec="aac")

        track = TrackMetadata(
            title="Get Lucky",
            artist="Daft Punk",
            album="Random Access Memories",
            track_number=8,
            total_tracks=13,
            year="2013",
            cover_url="https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg"
        )

        ok = MetadataTagger.apply_metadata(file_path, track, AudioFormat.M4A_256, embed_cover=True)
        assert ok, "M4A tagging failed"

        audio = MP4(file_path)
        assert audio["©nam"][0] == "Get Lucky"
        assert audio["©ART"][0] == "Daft Punk"
        assert audio["©alb"][0] == "Random Access Memories"
        assert audio["trkn"][0] == (8, 13)
        assert "covr" in audio and len(audio["covr"]) > 0, "covr atom not found"
        print("  ✔ M4A MP4 atoms (©nam, ©ART, ©alb, trkn, covr) verified!")


def test_opus_tagging():
    print("Testing OPUS Vorbis comments & METADATA_BLOCK_PICTURE cover...")
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / "test.opus"
        create_dummy_audio(file_path, codec="libopus")

        track = TrackMetadata(
            title="Get Lucky",
            artist="Daft Punk",
            album="Random Access Memories",
            album_artist="Daft Punk",
            track_number=8,
            total_tracks=13,
            year="2013",
            cover_url="https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg",
            lyrics=LyricsData(synced_lyrics="[00:05.00] Like the legend..."),
        )

        ok = MetadataTagger.apply_metadata(file_path, track, AudioFormat.OPUS_160,
                                           embed_cover=True, embed_lyrics=True)
        assert ok, "OPUS tagging failed"

        audio = OggOpus(file_path)
        assert audio["title"][0] == "Get Lucky"
        assert audio["artist"][0] == "Daft Punk"
        assert audio["albumartist"][0] == "Daft Punk"
        assert audio["tracknumber"][0] == "8"
        assert "lyrics" in audio, "OPUS lyrics missing"

        assert "metadata_block_picture" in audio, "OPUS cover missing"
        pic = Picture(base64.b64decode(audio["metadata_block_picture"][0]))
        assert pic.type == 3, "Cover is not marked as Front Cover"
        assert len(pic.data) > 5000, "Cover data too small"
        assert pic.width > 0 and pic.height > 0, "Cover dimensions not written"
        print("  OK OPUS comments & cover verified ({}x{}, {}, {} bytes)!".format(
            pic.width, pic.height, pic.mime, len(pic.data)))


def test_unknown_extension_is_reported():
    print("Testing that an unsupported container is not reported as success...")
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = Path(tmpdir) / "test.wma"
        file_path.write_bytes(b"not really audio")
        track = TrackMetadata(title="X", artist="Y", album="Z")
        ok = MetadataTagger.apply_metadata(file_path, track, AudioFormat.MP3_320)
        assert ok is False, "Unknown extension must not report success"
        print("  OK unsupported extension correctly returns False!")


if __name__ == "__main__":
    test_cover_fetching()
    test_mp3_tagging()
    test_flac_tagging()
    test_m4a_tagging()
    test_opus_tagging()
    test_unknown_extension_is_reported()
    print("\n[ALL TAGGER AND METADATA TESTS PASSED SUCCESSFULLY!]")
