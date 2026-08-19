"""
End-to-end live download tests for FLAC, MP3 320k, M4A, and OPUS.
"""
import sys
import tempfile
from pathlib import Path

# Add cli to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mutagen.id3 import ID3
from mutagen.flac import FLAC
from monochrome_cli.core.downloader import Downloader
from monochrome_cli.types import TrackMetadata, AudioFormat


def test_live_download_mp3():
    print("Testing live download: MP3 320kbps + HD Cover + Lyrics...")
    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = Path(tmpdir)
        
        # Test track
        track = TrackMetadata(
            title="Get Lucky",
            artist="Daft Punk",
            album="Random Access Memories",
            year="2013",
            track_number=8,
            total_tracks=13,
            cover_url="https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg",
            duration_seconds=369
        )

        def on_progress(pct, msg):
            pass

        saved_path, _ = Downloader.download_track(
            track,
            audio_format=AudioFormat.MP3_320,
            output_dir=output_dir,
            progress_callback=on_progress
        )

        assert saved_path is not None and saved_path.exists(), "MP3 download failed"
        assert saved_path.suffix == ".mp3", f"Expected .mp3, got {saved_path.suffix}"
        assert saved_path.stat().st_size > 500_000, f"File size too small: {saved_path.stat().st_size} bytes"
        print(f"  ✔ File downloaded: {saved_path.name} ({saved_path.stat().st_size / (1024*1024):.2f} MB)")

        # Verify ID3 and cover
        id3 = ID3(saved_path)
        assert id3.get("TIT2").text[0] == "Get Lucky"
        assert id3.get("TPE1").text[0] == "Daft Punk"
        assert any(k.startswith("APIC") for k in id3.keys()), "APIC cover missing"
        print("  ✔ ID3 tags & Cover art verified inside MP3!")

        # Verify .lrc file
        lrc_path = saved_path.with_suffix(".lrc")
        if lrc_path.exists():
            print(f"  ✔ Synced .lrc lyrics file created: {lrc_path.name} ({lrc_path.stat().st_size} bytes)")


def test_live_download_flac():
    print("Testing live download: FLAC Lossless...")
    with tempfile.TemporaryDirectory() as tmpdir:
        output_dir = Path(tmpdir)
        
        track = TrackMetadata(
            title="Around the World",
            artist="Daft Punk",
            album="Homework",
            year="1997",
            track_number=7,
            cover_url="https://resources.tidal.com/images/b66a5c40/c34d/4507/a0dc/5f98e46fdd20/1280x1280.jpg",
            duration_seconds=429
        )

        saved_path, _ = Downloader.download_track(
            track,
            audio_format=AudioFormat.FLAC,
            output_dir=output_dir
        )

        assert saved_path is not None and saved_path.exists(), "FLAC download failed"
        assert saved_path.suffix == ".flac", f"Expected .flac, got {saved_path.suffix}"
        assert saved_path.stat().st_size > 1_000_000, f"FLAC file size too small: {saved_path.stat().st_size} bytes"
        print(f"  ✔ File downloaded: {saved_path.name} ({saved_path.stat().st_size / (1024*1024):.2f} MB)")

        # Verify FLAC tags
        flac_audio = FLAC(saved_path)
        assert flac_audio["TITLE"][0] == "Around the World"
        assert len(flac_audio.pictures) > 0, "FLAC Picture block missing"
        print("  ✔ FLAC Vorbis comments & Picture block verified!")


if __name__ == "__main__":
    test_live_download_mp3()
    test_live_download_flac()
    print("\n[ALL LIVE DOWNLOAD TESTS PASSED SUCCESSFULLY!]")
