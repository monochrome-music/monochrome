"""
Audio stream downloader and post-processor using yt-dlp, FFmpeg, and Mutagen.
"""
import shutil
import tempfile
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import yt_dlp

from monochrome_cli.config import config
from monochrome_cli.core.lyrics import LyricsManager
from monochrome_cli.core.tagger import MetadataTagger
from monochrome_cli.types import AudioFormat, TrackMetadata
from monochrome_cli.utils.template import format_track_path

# Extensiones de audio que FFmpeg puede haber generado en el directorio temporal.
KNOWN_AUDIO_EXTENSIONS = ("flac", "mp3", "m4a", "opus", "ogg", "aac", "wav", "webm")


class _SilentLogger:
    """
    Silencia la salida de yt-dlp. Que un perfil de descarga falle es parte del
    flujo normal, así que el error se propaga como excepción en vez de ensuciar
    la interfaz; el mensaje llega al usuario por el progress_callback.
    """

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


class Downloader:
    # Cuántos resultados de YouTube se examinan para encontrar la versión correcta.
    SEARCH_CANDIDATES = 8
    # Margen aceptable entre la duración del catálogo y la del vídeo, en segundos.
    DURATION_TOLERANCE = 4

    # Perfiles de extracción, en orden de preferencia.
    #
    # El primero usa los clientes por defecto de yt-dlp, que ofrecen streams de
    # solo audio a ~130 kbps. Cuando YouTube los bloquea (403 por falta de PO
    # token), el segundo fuerza los clientes web/android: solo entregan el
    # formato progresivo 18, de menor calidad, pero descarga sin token.
    DOWNLOAD_PROFILES = (
        ("audio de máxima calidad disponible", None),
        (
            "stream progresivo de respaldo (menor calidad)",
            {"youtube": {"player_client": ["web", "android"]}},
        ),
    )

    @staticmethod
    def _create_yt_dlp_params(
        temp_dir: Path,
        audio_format: AudioFormat,
        progress_hook: Optional[Callable[[dict], None]] = None,
        extractor_args: Optional[Dict] = None
    ) -> dict:
        ffmpeg_info = audio_format.ffmpeg_args
        ext = ffmpeg_info["ext"]
        bitrate = ffmpeg_info.get("bitrate")

        postprocessors = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": ext,
        }]
        if bitrate:
            postprocessors[0]["preferredquality"] = bitrate.rstrip("k")

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": str(temp_dir / "%(id)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "logger": _SilentLogger(),
            "postprocessors": postprocessors,
            "prefer_ffmpeg": True,
        }

        if extractor_args:
            ydl_opts["extractor_args"] = extractor_args

        if progress_hook:
            ydl_opts["progress_hooks"] = [progress_hook]

        return ydl_opts

    @classmethod
    def _search_candidates(cls, query: str, limit: int) -> List[dict]:
        """
        Búsqueda plana (sin descargar) que devuelve título, duración y URL de cada
        resultado. Es rápida porque no resuelve los streams de cada vídeo.
        """
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": "in_playlist",
            "logger": _SilentLogger(),
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        except Exception:
            return []
        entries = (info or {}).get("entries") or []
        return [e for e in entries if e and (e.get("url") or e.get("webpage_url"))]

    @classmethod
    def _pick_best_candidate(
        cls,
        entries: List[dict],
        target_duration: int
    ) -> Tuple[Optional[dict], Optional[int], bool]:
        """
        Elige el resultado cuya duración se acerca más a la del catálogo.

        Devuelve (entry, duración_encontrada, hay_desajuste). Sin duración de
        referencia se conserva el primer resultado, como hacía la versión previa.
        """
        if not entries:
            return None, None, False

        if target_duration <= 0:
            first = entries[0]
            return first, cls._entry_duration(first), False

        timed = [(e, cls._entry_duration(e)) for e in entries]
        timed = [(e, d) for e, d in timed if d]
        if not timed:
            first = entries[0]
            return first, None, False

        best, best_duration = min(timed, key=lambda pair: abs(pair[1] - target_duration))
        mismatch = abs(best_duration - target_duration) > cls.DURATION_TOLERANCE
        return best, best_duration, mismatch

    @staticmethod
    def _entry_duration(entry: dict) -> Optional[int]:
        duration = entry.get("duration")
        try:
            return int(float(duration)) if duration else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _clear_temp_dir(temp_dir: Path) -> None:
        """Borra los restos de un intento fallido antes de reintentar."""
        for leftover in temp_dir.glob("*"):
            try:
                if leftover.is_file():
                    leftover.unlink()
            except OSError:
                pass

    @staticmethod
    def _locate_output_file(temp_dir: Path, expected_ext: str) -> Path:
        """
        Localiza el archivo convertido por FFmpeg. Solo acepta audio real: mover un
        `.part` o un contenedor sin convertir dejaría un archivo corrupto con la
        extensión equivocada.
        """
        exact = sorted(temp_dir.glob(f"*.{expected_ext}"))
        if exact:
            return exact[0]

        others = [
            p for p in sorted(temp_dir.glob("*.*"))
            if p.suffix.lower().lstrip(".") in KNOWN_AUDIO_EXTENSIONS
        ]
        if others:
            raise FileNotFoundError(
                f"FFmpeg no generó un archivo .{expected_ext} "
                f"(se encontró {others[0].name}); revisa que FFmpeg soporte ese códec"
            )

        raise FileNotFoundError(
            "No se encontró el archivo de audio procesado por FFmpeg"
        )

    @classmethod
    def download_track(
        cls,
        track: TrackMetadata,
        audio_format: Optional[AudioFormat] = None,
        output_dir: Optional[Path] = None,
        progress_callback: Optional[Callable[[float, str], None]] = None,
        overwrite: bool = False,
        include_lyrics: Optional[bool] = None,
        include_cover: Optional[bool] = None,
    ) -> Tuple[Optional[Path], bool]:
        """
        Downloads a track, converts it, embeds metadata & cover art, and writes .lrc.
        """
        fmt = audio_format or config.default_format
        dest_dir = output_dir or config.download_directory
        final_path = format_track_path(track, dest_dir, fmt, config.folder_template)

        # Duplicate check
        if not overwrite and final_path.exists() and final_path.stat().st_size > 1024:
            if progress_callback:
                progress_callback(100.0, f"Ya existe en disco: {final_path.name}")
            return final_path, False

        # Resolve cover flag
        should_embed_cover = config.embed_cover if include_cover is None else include_cover

        # Las banderas explícitas (--lyrics / --no-lyrics, o la opción "c" del TUI)
        # mandan sobre la configuración guardada.
        should_save_lrc = config.save_lrc_file if include_lyrics is None else include_lyrics
        should_embed_lyrics = config.embed_lyrics if include_lyrics is None else include_lyrics
        should_get_lyrics = should_save_lrc or should_embed_lyrics

        # Construct query for highest precision match
        query = f"{track.artist} - {track.title} audio"
        if track.album and track.album != track.title:
            query = f"{track.artist} - {track.title} {track.album} audio"

        with tempfile.TemporaryDirectory() as temp_dir_str:
            temp_dir = Path(temp_dir_str)

            def ytdl_hook(d):
                if progress_callback and d.get("status") == "downloading":
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                    downloaded = d.get("downloaded_bytes", 0)
                    percent = (downloaded / total * 100) if total > 0 else 50.0
                    speed = d.get("_speed_str", "")
                    progress_callback(percent, f"Descargando stream {speed}...")
                elif progress_callback and d.get("status") == "finished":
                    progress_callback(90.0, "Procesando audio y metadatos...")

            try:
                if progress_callback:
                    progress_callback(5.0, "Buscando la versión correcta...")

                # 1. Elegir el resultado cuya duración coincida con la del catálogo,
                #    para no acabar con un radio edit o un directo por error.
                entries = cls._search_candidates(query, cls.SEARCH_CANDIDATES)
                if not entries:
                    entries = cls._search_candidates(
                        f"{track.artist} {track.title}", cls.SEARCH_CANDIDATES
                    )

                entry, matched_duration, mismatch = cls._pick_best_candidate(
                    entries, track.duration_seconds
                )

                if entry and mismatch and progress_callback:
                    progress_callback(
                        8.0,
                        f"Aviso: sin coincidencia exacta de duración "
                        f"({matched_duration}s vs {track.duration_seconds}s)"
                    )

                # 2. Descargar el candidato elegido (o caer a la búsqueda directa).
                download_target = None
                if entry:
                    download_target = entry.get("webpage_url") or entry.get("url")
                if not download_target:
                    download_target = f"ytsearch1:{query}"
                    matched_duration = None

                if progress_callback:
                    progress_callback(10.0, "Obteniendo el stream de audio...")

                last_error = None
                for profile_index, (profile_name, extractor_args) in enumerate(cls.DOWNLOAD_PROFILES):
                    cls._clear_temp_dir(temp_dir)
                    opts = cls._create_yt_dlp_params(temp_dir, fmt, ytdl_hook, extractor_args)
                    try:
                        with yt_dlp.YoutubeDL(opts) as ydl:
                            ydl.extract_info(download_target, download=True)
                        last_error = None
                        if profile_index > 0 and progress_callback:
                            progress_callback(92.0, f"Usando {profile_name}")
                        break
                    except Exception as err:
                        last_error = err

                if last_error is not None:
                    raise last_error

                # Locate converted file in temp_dir
                source_temp_file = cls._locate_output_file(temp_dir, fmt.extension)

                # Move to final path
                final_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source_temp_file), str(final_path))

                # Fetch and embed lyrics if enabled
                if should_get_lyrics:
                    if progress_callback:
                        progress_callback(95.0, "Obteniendo letras sincronizadas...")
                    # La duración real del audio manda: es la que sincroniza el .lrc.
                    lyrics_data = LyricsManager.fetch_lyrics(
                        track, duration_hint=matched_duration
                    )
                    if lyrics_data:
                        track.lyrics = lyrics_data
                        if should_save_lrc:
                            LyricsManager.save_lrc_file(lyrics_data, final_path)

                # Tag metadata and cover art
                if progress_callback:
                    progress_callback(98.0, "Incrustando portada HD y metadatos...")
                MetadataTagger.apply_metadata(
                    final_path,
                    track,
                    fmt,
                    embed_cover=should_embed_cover,
                    embed_lyrics=should_embed_lyrics
                )

                if progress_callback:
                    progress_callback(100.0, f"Completado: {final_path.name}")

                return final_path, True

            except Exception as e:
                if progress_callback:
                    progress_callback(0.0, f"Error: {e}")
                print(f"[Error] Falló la descarga de {track.title}: {e}")
                return None, False
