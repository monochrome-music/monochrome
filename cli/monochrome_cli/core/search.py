"""
Unified search engine for Monochrome CLI.
Queries Tidal API and Deezer API for metadata, HD covers, and tracks.
"""
import base64
import json
import time
import urllib.parse
import urllib.request
from typing import List, Optional

from monochrome_cli.config import config
from monochrome_cli.types import AlbumMetadata, SearchResult, TrackMetadata


class SearchEngine:
    _tidal_token: Optional[str] = None
    _token_expiry: float = 0

    @classmethod
    def get_tidal_token(cls) -> Optional[str]:
        if cls._tidal_token and time.time() < cls._token_expiry:
            return cls._tidal_token

        client_id = config.tidal_client_id
        client_secret = config.tidal_client_secret

        try:
            auth_header = "Basic " + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
            data = urllib.parse.urlencode({
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials"
            }).encode()

            req = urllib.request.Request(
                "https://auth.tidal.com/v1/oauth2/token",
                data=data,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": auth_header
                }
            )
            with urllib.request.urlopen(req, timeout=8) as res:
                if res.status == 200:
                    token_data = json.loads(res.read().decode("utf-8"))
                    cls._tidal_token = token_data.get("access_token")
                    expires_in = token_data.get("expires_in", 3600)
                    cls._token_expiry = time.time() + expires_in - 60
                    return cls._tidal_token
        except Exception:
            pass
        return None

    @classmethod
    def format_tidal_cover(cls, cover_id: Optional[str], size: int = 1280) -> Optional[str]:
        if not cover_id:
            return None
        formatted = str(cover_id).replace("-", "/")
        return f"https://resources.tidal.com/images/{formatted}/{size}x{size}.jpg"

    @classmethod
    def search_tidal_tracks(cls, query: str, limit: int = 15) -> List[TrackMetadata]:
        token = cls.get_tidal_token()
        if not token:
            return []

        try:
            params = urllib.parse.urlencode({
                "query": query,
                "countryCode": config.country_code,
                "limit": limit
            })
            url = f"https://api.tidal.com/v1/search/tracks?{params}"
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})

            with urllib.request.urlopen(req, timeout=8) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    items = data.get("items", [])
                    tracks = []
                    for item in items:
                        artists = ", ".join([a.get("name", "") for a in item.get("artists", [])]) or item.get("artist", {}).get("name", "Unknown Artist")
                        album_data = item.get("album", {})
                        cover_id = album_data.get("cover") or item.get("cover")
                        cover_url = cls.format_tidal_cover(cover_id, config.cover_resolution)
                        release_date = album_data.get("releaseDate") or item.get("streamStartDate") or ""
                        year = release_date.split("-")[0] if release_date else ""

                        tracks.append(TrackMetadata(
                            title=item.get("title", ""),
                            artist=artists,
                            album=album_data.get("title", ""),
                            album_artist=album_data.get("artist", {}).get("name") or artists,
                            duration_seconds=int(item.get("duration", 0)),
                            track_number=int(item.get("trackNumber", 1)),
                            disc_number=int(item.get("volumeNumber", 1)),
                            year=year,
                            release_date=release_date,
                            isrc=item.get("isrc"),
                            explicit=bool(item.get("explicit", False)),
                            cover_url=cover_url,
                            source="tidal",
                            source_id=str(item.get("id"))
                        ))
                    return tracks
        except Exception:
            pass
        return []

    @classmethod
    def search_deezer_tracks(cls, query: str, limit: int = 15) -> List[TrackMetadata]:
        try:
            params = urllib.parse.urlencode({"q": query, "limit": limit})
            url = f"https://api.deezer.com/search?{params}"
            req = urllib.request.Request(url, headers={"User-Agent": "MonochromeCLI/1.0"})

            with urllib.request.urlopen(req, timeout=8) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    items = data.get("data", [])
                    tracks = []
                    for item in items:
                        album_data = item.get("album", {})
                        artist_data = item.get("artist", {})
                        cover_url = album_data.get("cover_xl") or album_data.get("cover_big") or album_data.get("cover_medium")

                        tracks.append(TrackMetadata(
                            title=item.get("title", ""),
                            artist=artist_data.get("name", "Unknown Artist"),
                            album=album_data.get("title", ""),
                            album_artist=artist_data.get("name", "Unknown Artist"),
                            duration_seconds=int(item.get("duration", 0)),
                            track_number=int(item.get("track_position", 1) or 1),
                            disc_number=int(item.get("disk_number", 1) or 1),
                            cover_url=cover_url,
                            explicit=bool(item.get("explicit_lyrics", False)),
                            source="deezer",
                            source_id=str(item.get("id"))
                        ))
                    return tracks
        except Exception:
            pass
        return []

    @classmethod
    def search_tidal_albums(cls, query: str, limit: int = 10) -> List[AlbumMetadata]:
        token = cls.get_tidal_token()
        if not token:
            return []

        try:
            params = urllib.parse.urlencode({
                "query": query,
                "countryCode": config.country_code,
                "limit": limit
            })
            url = f"https://api.tidal.com/v1/search/albums?{params}"
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})

            with urllib.request.urlopen(req, timeout=8) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    items = data.get("items", [])
                    albums = []
                    for item in items:
                        artists = ", ".join([a.get("name", "") for a in item.get("artists", [])]) or item.get("artist", {}).get("name", "Unknown Artist")
                        cover_id = item.get("cover")
                        cover_url = cls.format_tidal_cover(cover_id, config.cover_resolution)
                        release_date = item.get("releaseDate") or ""
                        year = release_date.split("-")[0] if release_date else ""

                        albums.append(AlbumMetadata(
                            title=item.get("title", ""),
                            artist=artists,
                            release_date=release_date,
                            year=year,
                            cover_url=cover_url,
                            total_tracks=int(item.get("numberOfTracks", 0)),
                            source="tidal",
                            source_id=str(item.get("id"))
                        ))
                    return albums
        except Exception:
            pass
        return []

    @classmethod
    def get_album_tracks(cls, album_id: str) -> List[TrackMetadata]:
        """Fetches all tracks belonging to an album."""
        token = cls.get_tidal_token()
        if not token:
            return []

        try:
            url = (
                f"https://api.tidal.com/v1/albums/{album_id}/items"
                f"?countryCode={config.country_code}&limit=100"
            )
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})

            with urllib.request.urlopen(req, timeout=8) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode("utf-8"))
                    items = data.get("items", [])
                    tracks = []
                    for entry in items:
                        item = entry.get("item", {})
                        if not item:
                            continue
                        artists = ", ".join([a.get("name", "") for a in item.get("artists", [])]) or item.get("artist", {}).get("name", "Unknown Artist")
                        album_data = item.get("album", {})
                        cover_id = album_data.get("cover") or item.get("cover")
                        cover_url = cls.format_tidal_cover(cover_id, config.cover_resolution)
                        release_date = album_data.get("releaseDate") or item.get("streamStartDate") or ""
                        year = release_date.split("-")[0] if release_date else ""

                        tracks.append(TrackMetadata(
                            title=item.get("title", ""),
                            artist=artists,
                            album=album_data.get("title", ""),
                            album_artist=album_data.get("artist", {}).get("name") or artists,
                            duration_seconds=int(item.get("duration", 0)),
                            track_number=int(item.get("trackNumber", 1)),
                            total_tracks=int(album_data.get("numberOfTracks", len(items))),
                            disc_number=int(item.get("volumeNumber", 1)),
                            year=year,
                            release_date=release_date,
                            isrc=item.get("isrc"),
                            explicit=bool(item.get("explicit", False)),
                            cover_url=cover_url,
                            source="tidal",
                            source_id=str(item.get("id"))
                        ))
                    return tracks
        except Exception:
            pass
        return []

    @classmethod
    def search(cls, query: str, limit: Optional[int] = None) -> SearchResult:
        lim = limit or config.search_limit

        # 1. Search tracks on Tidal
        tidal_tracks = cls.search_tidal_tracks(query, limit=lim)
        if not tidal_tracks:
            # Fallback to Deezer
            tracks = cls.search_deezer_tracks(query, limit=lim)
        else:
            tracks = tidal_tracks

        # 2. Search albums on Tidal
        albums = cls.search_tidal_albums(query, limit=5)

        return SearchResult(tracks=tracks, albums=albums, query=query)
