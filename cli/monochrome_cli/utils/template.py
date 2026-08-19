"""
Filename and folder template formatting utilities.
"""
import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from monochrome_cli.types import TrackMetadata, AudioFormat


def sanitize_filename(name: str) -> str:
    """Removes invalid filesystem characters."""
    if not name:
        return "Unknown"
    sanitized = re.sub(r'[\\/*?:"<>|]', '_', name)
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    return sanitized or "Unknown"


def format_track_path(
    track: "TrackMetadata",
    output_dir: Path,
    audio_format: "AudioFormat",
    folder_template: str = "{album_artist}/{album}/{track_number:02d} - {title}",
    create_dirs: bool = False
) -> Path:
    """
    Builds the full destination path based on template and metadata.

    Por defecto solo calcula la ruta. Crear las carpetas es responsabilidad de
    quien va a escribir el archivo: así consultar el destino de una pista que se
    va a omitir por duplicada no deja directorios vacíos por el disco.
    """
    artist = sanitize_filename(track.artist or "Unknown Artist")
    album_artist = sanitize_filename(track.album_artist or track.artist or "Unknown Artist")
    album = sanitize_filename(track.album or "Unknown Album")
    title = sanitize_filename(track.title or "Unknown Title")
    year = sanitize_filename(track.year or "")
    genre = sanitize_filename(track.genre or "")
    track_number = track.track_number or 1
    disc_number = track.disc_number or 1
    ext = audio_format.extension

    context = {
        "artist": artist,
        "album_artist": album_artist,
        "album": album,
        "title": title,
        "year": year,
        "genre": genre,
        "track_number": track_number,
        "disc_number": disc_number,
    }

    try:
        relative_path_str = folder_template.format(**context)
    except Exception:
        relative_path_str = f"{artist} - {title}"

    parts = [sanitize_filename(p) for p in relative_path_str.replace("\\", "/").split("/") if p.strip()]
    if not parts:
        parts = [f"{artist} - {title}"]

    file_name = f"{parts[-1]}.{ext}"
    if len(parts) > 1:
        folder_path = output_dir.joinpath(*parts[:-1])
    else:
        folder_path = output_dir

    if create_dirs:
        folder_path.mkdir(parents=True, exist_ok=True)
    return folder_path / file_name
