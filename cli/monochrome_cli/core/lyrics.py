"""
Lyrics fetcher and .lrc file manager for Monochrome CLI.
"""
import urllib.error
import urllib.parse
import urllib.request
import json
from pathlib import Path
from typing import List, Optional
from monochrome_cli.types import LyricsData, TrackMetadata


class LyricsManager:
    LRCLIB_API = "https://lrclib.net/api"
    # Margen para dar por buena la duración de un resultado de búsqueda.
    DURATION_TOLERANCE = 4

    @classmethod
    def fetch_lyrics(
        cls,
        track: TrackMetadata,
        duration_hint: Optional[int] = None
    ) -> Optional[LyricsData]:
        """
        Fetches synced (.lrc) and plain lyrics from LRCLIB.

        `duration_hint` es la duración real del audio descargado. Si se indica,
        manda sobre la del catálogo: es la que garantiza que los tiempos del .lrc
        encajen con el archivo que el usuario acaba de guardar.
        """
        duration = duration_hint or track.duration_seconds

        try:
            # 1. Try exact match by track_name, artist_name, album_name, duration
            params = {
                "track_name": track.title,
                "artist_name": track.artist,
            }
            if track.album:
                params["album_name"] = track.album
            if duration and duration > 0:
                params["duration"] = str(duration)

            url = f"{cls.LRCLIB_API}/get?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(url, headers={"User-Agent": "MonochromeCLI/1.0"})

            try:
                with urllib.request.urlopen(req, timeout=6) as response:
                    if response.status == 200:
                        data = json.loads(response.read().decode("utf-8"))
                        return LyricsData(
                            plain_lyrics=data.get("plainLyrics"),
                            synced_lyrics=data.get("syncedLyrics"),
                            instrumental=bool(data.get("instrumental", False)),
                            source="lrclib_exact"
                        )
            except urllib.error.HTTPError:
                # 404 = sin coincidencia exacta; cualquier otro error también cae
                # al buscador libre de abajo.
                pass

            # 2. Fallback: Search by free-form query
            search_query = f"{track.artist} {track.title}"
            search_url = f"{cls.LRCLIB_API}/search?{urllib.parse.urlencode({'q': search_query})}"
            sreq = urllib.request.Request(search_url, headers={"User-Agent": "MonochromeCLI/1.0"})

            with urllib.request.urlopen(sreq, timeout=6) as sresponse:
                if sresponse.status == 200:
                    results = json.loads(sresponse.read().decode("utf-8"))
                    if isinstance(results, list) and results:
                        best = cls._pick_closest(results, duration)
                        return LyricsData(
                            plain_lyrics=best.get("plainLyrics"),
                            synced_lyrics=best.get("syncedLyrics"),
                            instrumental=bool(best.get("instrumental", False)),
                            source="lrclib_search"
                        )
        except Exception:
            pass

        return None

    @classmethod
    def _pick_closest(cls, results: List[dict], duration: Optional[int]) -> dict:
        """
        Elige el resultado con la duración más parecida a la del audio real. Sin
        duración de referencia se conserva el primero, que es el mejor ranqueado.
        """
        if not duration or duration <= 0:
            return results[0]

        timed = []
        for item in results:
            try:
                item_duration = int(float(item.get("duration") or 0))
            except (TypeError, ValueError):
                continue
            if item_duration > 0:
                timed.append((item, abs(item_duration - duration)))

        if not timed:
            return results[0]

        # Una letra cuya duración se aleja mucho es casi seguro de otra versión;
        # aun así es mejor que nada, así que se devuelve la más cercana.
        best, _ = min(timed, key=lambda pair: pair[1])
        return best

    @classmethod
    def save_lrc_file(cls, lyrics: LyricsData, audio_file_path: Path) -> Optional[Path]:
        """
        Saves a .lrc file alongside the audio file if synced lyrics exist.
        """
        content = lyrics.synced_lyrics or lyrics.plain_lyrics
        if not content:
            return None

        lrc_path = audio_file_path.with_suffix(".lrc")
        try:
            with open(lrc_path, "w", encoding="utf-8") as f:
                f.write(content.strip() + "\n")
            return lrc_path
        except Exception:
            return None
