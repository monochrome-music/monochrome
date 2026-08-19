"""
Tests for SearchEngine (Tidal & Deezer).
"""
import sys
from pathlib import Path

# Add cli to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from monochrome_cli.core.search import SearchEngine


def test_tidal_search():
    print("Testing Tidal search...")
    res = SearchEngine.search_tidal_tracks("Daft Punk Get Lucky", limit=3)
    assert len(res) > 0, "Tidal search returned no tracks"
    first = res[0]
    print(f"  ✔ Found: {first.title} by {first.artist} (Album: {first.album}, Duration: {first.duration_formatted})")
    assert first.title, "Track title is empty"
    assert first.artist, "Artist is empty"
    assert first.cover_url, "Cover URL is empty"
    print(f"  ✔ Cover URL: {first.cover_url}")


def test_deezer_search():
    print("Testing Deezer fallback search...")
    res = SearchEngine.search_deezer_tracks("Queen Bohemian Rhapsody", limit=3)
    assert len(res) > 0, "Deezer search returned no tracks"
    first = res[0]
    print(f"  ✔ Found: {first.title} by {first.artist} (Album: {first.album})")
    assert first.title, "Track title is empty"
    assert first.cover_url, "Cover URL is empty"


def test_album_search_and_tracks():
    print("Testing Album search and track retrieval...")
    res = SearchEngine.search_tidal_albums("Random Access Memories", limit=2)
    assert len(res) > 0, "Album search returned no albums"
    first_album = res[0]
    print(f"  ✔ Found Album: {first_album.title} by {first_album.artist} (ID: {first_album.source_id})")

    tracks = SearchEngine.get_album_tracks(first_album.source_id)
    assert len(tracks) > 0, "Failed to retrieve tracks for album"
    print(f"  ✔ Retrieved {len(tracks)} tracks from album:")
    for t in tracks[:3]:
        print(f"    - [{t.track_number:02d}] {t.title} ({t.duration_formatted})")


if __name__ == "__main__":
    test_tidal_search()
    test_deezer_search()
    test_album_search_and_tracks()
    print("\n[ALL SEARCH TESTS PASSED SUCCESSFULLY!]")
