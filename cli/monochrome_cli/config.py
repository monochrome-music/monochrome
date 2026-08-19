"""
Configuration management for Monochrome CLI.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
from monochrome_cli.types import AudioFormat
from monochrome_cli.utils.platform import get_config_dir, get_default_music_dir

# Credenciales de la API interna de Tidal (api.tidal.com/v1). Son un client id
# filtrado de las aplicaciones oficiales, no algo que se pueda solicitar: el
# portal developer.tidal.com emite credenciales para otra API distinta
# (openapi.tidal.com/v2), que estos endpoints rechazan con un 400. Ver el
# apartado "Credenciales de Tidal" del README.
#
# Viven aquí y no en DEFAULT_CONFIG para no acabar copiadas en el config.json de
# cada usuario; se pueden sobreescribir con las variables de entorno
# MONOCHROME_TIDAL_CLIENT_ID / _SECRET o añadiendo las claves a mano al archivo
# de configuración.
DEFAULT_TIDAL_CLIENT_ID = "txNoH4kkV41MfH25"
DEFAULT_TIDAL_CLIENT_SECRET = "dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98="

# Claves que versiones anteriores escribían en el config.json del usuario.
LEGACY_KEYS = {
    "tidal_client_id": DEFAULT_TIDAL_CLIENT_ID,
    "tidal_client_secret": DEFAULT_TIDAL_CLIENT_SECRET,
}


class Config:
    # Solo valores estáticos: nada que toque el disco al importar el módulo.
    DEFAULT_CONFIG: Dict[str, Any] = {
        "default_format": AudioFormat.MP3_320.value,
        "embed_cover": True,
        "cover_resolution": 1280,
        "embed_lyrics": True,
        "save_lrc_file": True,
        "folder_template": "{album_artist}/{album}/{track_number:02d} - {title}",
        "search_limit": 10,
        "country_code": "US",
    }

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path or (get_config_dir() / "config.json")
        self._data = dict(self.DEFAULT_CONFIG)
        self.load()

    def load(self) -> None:
        if not self.config_path.exists():
            # Sin archivo se usan los valores por defecto; se escribirá en el
            # primer cambio real, no por arrancar la aplicación.
            return
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
        except Exception as e:
            print(f"[Aviso] No se pudo leer la configuración existente: {e}")
            return

        if not isinstance(loaded, dict):
            print("[Aviso] La configuración existente no es válida; se ignoró.")
            return

        # Limpia las credenciales que se escribían por defecto, conservando las
        # que el usuario haya cambiado a propósito.
        removed_legacy = False
        for key, default_value in LEGACY_KEYS.items():
            if loaded.get(key) == default_value:
                loaded.pop(key)
                removed_legacy = True

        self._data.update(loaded)
        if removed_legacy:
            self.save()

    def save(self) -> None:
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"[Error] No se pudo guardar la configuración: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self.save()

    def update(self, values: Dict[str, Any]) -> None:
        """Aplica varios cambios con una sola escritura en disco."""
        self._data.update(values)
        self.save()

    def reset_to_defaults(self) -> None:
        self._data = dict(self.DEFAULT_CONFIG)
        self.save()

    @property
    def download_directory(self) -> Path:
        """
        Carpeta de descargas. Es una consulta, no crea nada en disco: el
        directorio se crea al guardar la primera pista.
        """
        stored = self.get("download_directory")
        if stored:
            return Path(stored).expanduser()
        return get_default_music_dir()

    @download_directory.setter
    def download_directory(self, val: str) -> None:
        self.set("download_directory", str(Path(val).expanduser()))

    @property
    def default_format(self) -> AudioFormat:
        val = self.get("default_format", AudioFormat.MP3_320.value)
        return AudioFormat.from_string(val)

    @default_format.setter
    def default_format(self, fmt: AudioFormat) -> None:
        self.set("default_format", fmt.value)

    @property
    def embed_cover(self) -> bool:
        return bool(self.get("embed_cover", True))

    @property
    def cover_resolution(self) -> int:
        try:
            return int(self.get("cover_resolution", 1280))
        except (TypeError, ValueError):
            return 1280

    @property
    def embed_lyrics(self) -> bool:
        return bool(self.get("embed_lyrics", True))

    @property
    def save_lrc_file(self) -> bool:
        return bool(self.get("save_lrc_file", True))

    @property
    def folder_template(self) -> str:
        return str(self.get("folder_template", self.DEFAULT_CONFIG["folder_template"]))

    @property
    def search_limit(self) -> int:
        try:
            return int(self.get("search_limit", 10))
        except (TypeError, ValueError):
            return 10

    @property
    def country_code(self) -> str:
        """Región del catálogo de Tidal; cambia qué lanzamientos son visibles."""
        code = str(self.get("country_code", "US") or "US").strip().upper()
        return code if len(code) == 2 and code.isalpha() else "US"

    @property
    def tidal_client_id(self) -> str:
        return (
            os.environ.get("MONOCHROME_TIDAL_CLIENT_ID")
            or self.get("tidal_client_id")
            or DEFAULT_TIDAL_CLIENT_ID
        )

    @property
    def tidal_client_secret(self) -> str:
        return (
            os.environ.get("MONOCHROME_TIDAL_CLIENT_SECRET")
            or self.get("tidal_client_secret")
            or DEFAULT_TIDAL_CLIENT_SECRET
        )


# Global singleton instance
config = Config()
