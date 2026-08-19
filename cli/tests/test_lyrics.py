"""
Tests for LyricsManager and .lrc file generation.
"""
import sys
import tempfile
from pathlib import Path

# Add cli to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from monochrome_cli.core.lyrics import LyricsManager
from monochrome_cli.types import TrackMetadata


def test_lyrics_fetching():
    print("Testing LRCLIB lyrics fetching...")
    track = TrackMetadata(
        title="Bohemian Rhapsody",
        artist="Queen",
        album="A Night At The Opera",
        duration_seconds=354
    )

    lyrics = LyricsManager.fetch_lyrics(track)
    assert lyrics is not None, "Failed to fetch lyrics for Bohemian Rhapsody"
    print(f"  ✔ Lyrics fetched from source: {lyrics.source}")
    assert lyrics.synced_lyrics or lyrics.plain_lyrics, "No lyrics text found"

    if lyrics.synced_lyrics:
        print("  ✔ Synced lyrics found! Sample line:")
        first_lines = lyrics.synced_lyrics.strip().splitlines()[:3]
        for line in first_lines:
            print(f"    {line}")
        assert "[" in lyrics.synced_lyrics and "]" in lyrics.synced_lyrics, "Synced lyrics missing timestamps"

    with tempfile.TemporaryDirectory() as tmpdir:
        dummy_audio = Path(tmpdir) / "Queen - Bohemian Rhapsody.mp3"
        dummy_audio.touch()
        lrc_file = LyricsManager.save_lrc_file(lyrics, dummy_audio)
        assert lrc_file is not None and lrc_file.exists(), "LRC file was not created"
        print(f"  ✔ .lrc file written successfully: {lrc_file.name} ({lrc_file.stat().st_size} bytes)")

if __name__ == "__main__":
    test_lyrics_fetching()
    print("\n[ALL LYRICS TESTS PASSED SUCCESSFULLY!]")
