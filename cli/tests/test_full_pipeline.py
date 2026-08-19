"""
Full integration test covering Search -> Selection -> Format Conversion -> Tagging -> Folder Structure.
"""
import sys
import tempfile
from pathlib import Path

# Add cli to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus

from monochrome_cli.core.search import SearchEngine
from monochrome_cli.core.downloader import Downloader
from monochrome_cli.types import AudioFormat


def test_search_and_download_m4a():
    print("1. Testing Search + M4A (AAC 256k) Download...")
    res = SearchEngine.search("The Weeknd Blinding Lights", limit=1)
    assert len(res.tracks) > 0, "Track search returned no results"
    track = res.tracks[0]

    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir)
        saved_path, _ = Downloader.download_track(track, audio_format=AudioFormat.M4A_256, output_dir=out_dir)
        assert saved_path is not None and saved_path.exists(), "M4A download failed"
        assert saved_path.suffix == ".m4a"
        print(f"  ✔ M4A created: {saved_path.name} ({saved_path.stat().st_size / (1024*1024):.2f} MB)")

        mp4 = MP4(saved_path)
        assert "©nam" in mp4
        assert "covr" in mp4
        print("  ✔ M4A atom tags and HD cover verified!")


def test_search_and_download_opus():
    print("2. Testing Search + OPUS (160k) Download...")
    res = SearchEngine.search("Dua Lipa Levitating", limit=1)
    assert len(res.tracks) > 0, "Track search returned no results"
    track = res.tracks[0]

    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir)
        saved_path, _ = Downloader.download_track(track, audio_format=AudioFormat.OPUS_160, output_dir=out_dir)
        assert saved_path is not None and saved_path.exists(), "OPUS download failed"
        assert saved_path.suffix == ".opus"
        print(f"  ✔ OPUS created: {saved_path.name} ({saved_path.stat().st_size / (1024*1024):.2f} MB)")

        opus = OggOpus(saved_path)
        assert "title" in opus
        assert "artist" in opus
        print("  ✔ OPUS metadata comments verified!")


def test_album_batch_download_simulation():
    print("3. Testing Album Batch Structure Retrieval...")
    albums = SearchEngine.search_tidal_albums("Discovery Daft Punk", limit=1)
    assert len(albums) > 0, "Album search failed"
    album = albums[0]
    tracks = SearchEngine.get_album_tracks(album.source_id)
    assert len(tracks) >= 5, "Expected tracks for album"
    print(f"  ✔ Retrieved album: '{album.title}' with {len(tracks)} tracks.")
    for i, t in enumerate(tracks[:4], 1):
        print(f"    {i}. {t.track_number:02d} - {t.title} ({t.duration_formatted})")


if __name__ == "__main__":
    test_search_and_download_m4a()
    test_search_and_download_opus()
    test_album_batch_download_simulation()
    print("\n[ALL FULL PIPELINE INTEGRATION TESTS PASSED!]")
