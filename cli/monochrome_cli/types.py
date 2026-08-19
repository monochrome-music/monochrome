"""
Data types and models for Monochrome CLI.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any


class AudioFormat(str, Enum):
    """
    Formato de salida. El audio se obtiene de YouTube (Opus/AAC de ~48-130 kbps
    según los formatos accesibles), así que ninguna opción supera esa calidad:
    FLAC solo evita una recompresión adicional a costa de multiplicar el tamaño,
    y OPUS es el único que puede conservar el códec original sin pérdidas extra.
    """

    FLAC = "flac"
    MP3_320 = "mp3_320"
    MP3_256 = "mp3_256"
    MP3_128 = "mp3_128"
    M4A_256 = "m4a_256"
    OPUS_160 = "opus_160"
    OGG = "ogg"

    @classmethod
    def aliases(cls) -> Dict[str, "AudioFormat"]:
        return {
            "flac": cls.FLAC, "lossless": cls.FLAC, "hi_res": cls.FLAC, "hires": cls.FLAC,
            "mp3_320": cls.MP3_320, "320": cls.MP3_320, "320k": cls.MP3_320,
            "320kbps": cls.MP3_320, "mp3": cls.MP3_320,
            "mp3_256": cls.MP3_256, "256": cls.MP3_256, "256k": cls.MP3_256, "256kbps": cls.MP3_256,
            "mp3_128": cls.MP3_128, "128": cls.MP3_128, "128k": cls.MP3_128, "128kbps": cls.MP3_128,
            "m4a": cls.M4A_256, "m4a_256": cls.M4A_256, "aac": cls.M4A_256,
            "aac_256": cls.M4A_256, "m4a_hq": cls.M4A_256,
            "opus": cls.OPUS_160, "opus_160": cls.OPUS_160,
            "160k": cls.OPUS_160, "opus_hq": cls.OPUS_160,
            "ogg": cls.OGG, "vorbis": cls.OGG,
        }

    @classmethod
    def parse(cls, val: str) -> Optional["AudioFormat"]:
        """Devuelve el formato, o None si el texto no corresponde a ninguno."""
        key = str(val).strip().lower().replace("-", "_").replace(" ", "_")
        return cls.aliases().get(key)

    @classmethod
    def from_string(cls, val: str) -> "AudioFormat":
        """
        Versión tolerante para valores ya guardados: si no se reconoce, cae al
        formato por defecto. Para validar lo que escribe el usuario usa `parse`,
        que distingue un valor inválido de uno válido.
        """
        return cls.parse(val) or cls.MP3_320

    @classmethod
    def choices(cls) -> List[str]:
        """Valores canónicos aceptados por la línea de comandos."""
        return [fmt.value for fmt in cls]

    @property
    def extension(self) -> str:
        if self in (AudioFormat.MP3_320, AudioFormat.MP3_256, AudioFormat.MP3_128):
            return "mp3"
        if self == AudioFormat.FLAC:
            return "flac"
        if self == AudioFormat.M4A_256:
            return "m4a"
        if self == AudioFormat.OPUS_160:
            return "opus"
        if self == AudioFormat.OGG:
            return "ogg"
        return "mp3"

    @property
    def display_name(self) -> str:
        names = {
            AudioFormat.FLAC: "FLAC (sin recompresión; archivo grande)",
            AudioFormat.MP3_320: "MP3 320 kbps (máxima compatibilidad)",
            AudioFormat.MP3_256: "MP3 256 kbps (equilibrado)",
            AudioFormat.MP3_128: "MP3 128 kbps (ahorro de espacio)",
            AudioFormat.M4A_256: "M4A / AAC 256 kbps (Apple)",
            AudioFormat.OPUS_160: "OPUS 160 kbps (recomendado: mismo códec que la fuente)",
            AudioFormat.OGG: "OGG Vorbis 192 kbps",
        }
        return names.get(self, self.value)

    @property
    def ffmpeg_args(self) -> Dict[str, Any]:
        if self == AudioFormat.FLAC:
            return {"codec": "flac", "bitrate": None, "ext": "flac"}
        if self == AudioFormat.MP3_320:
            return {"codec": "libmp3lame", "bitrate": "320k", "ext": "mp3"}
        if self == AudioFormat.MP3_256:
            return {"codec": "libmp3lame", "bitrate": "256k", "ext": "mp3"}
        if self == AudioFormat.MP3_128:
            return {"codec": "libmp3lame", "bitrate": "128k", "ext": "mp3"}
        if self == AudioFormat.M4A_256:
            return {"codec": "aac", "bitrate": "256k", "ext": "m4a"}
        if self == AudioFormat.OPUS_160:
            return {"codec": "libopus", "bitrate": "160k", "ext": "opus"}
        if self == AudioFormat.OGG:
            return {"codec": "libvorbis", "bitrate": "192k", "ext": "ogg"}
        return {"codec": "libmp3lame", "bitrate": "320k", "ext": "mp3"}


@dataclass
class LyricsData:
    plain_lyrics: Optional[str] = None
    synced_lyrics: Optional[str] = None
    instrumental: bool = False
    source: str = "lrclib"


@dataclass
class TrackMetadata:
    title: str
    artist: str
    album: str
    duration_seconds: int = 0
    track_number: int = 1
    total_tracks: int = 1
    disc_number: int = 1
    total_discs: int = 1
    year: Optional[str] = None
    release_date: Optional[str] = None
    genre: Optional[str] = None
    isrc: Optional[str] = None
    album_artist: Optional[str] = None
    cover_url: Optional[str] = None
    explicit: bool = False
    source: str = "tidal"
    source_id: Optional[str] = None
    stream_url: Optional[str] = None
    lyrics: Optional[LyricsData] = None

    @property
    def duration_formatted(self) -> str:
        if not self.duration_seconds:
            return "--:--"
        mins = self.duration_seconds // 60
        secs = self.duration_seconds % 60
        return f"{mins:02d}:{secs:02d}"


@dataclass
class AlbumMetadata:
    title: str
    artist: str
    release_date: Optional[str] = None
    year: Optional[str] = None
    cover_url: Optional[str] = None
    total_tracks: int = 0
    tracks: List[TrackMetadata] = field(default_factory=list)
    source: str = "tidal"
    source_id: Optional[str] = None


@dataclass
class SearchResult:
    tracks: List[TrackMetadata] = field(default_factory=list)
    albums: List[AlbumMetadata] = field(default_factory=list)
    query: str = ""
