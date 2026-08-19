"""
Platform detection and path utilities for Termux and Linux.
"""
import os
import shutil
import sys
from pathlib import Path
from typing import Optional


def is_termux() -> bool:
    return (
        'TERMUX_VERSION' in os.environ
        or os.path.exists('/data/data/com.termux')
        or 'com.termux' in os.environ.get('PREFIX', '')
    )


def is_android() -> bool:
    return is_termux() or os.path.exists('/sdcard')


def get_default_music_dir() -> Path:
    # 1. Check Termux shared storage
    termux_shared = Path(os.path.expanduser('~/storage/shared/Music'))
    if termux_shared.exists() and os.access(termux_shared, os.W_OK):
        return termux_shared

    # 2. Check direct /sdcard/Music
    sdcard_music = Path('/sdcard/Music')
    if sdcard_music.exists() and os.access(sdcard_music, os.W_OK):
        return sdcard_music

    # 3. Standard Linux / macOS ~/Music
    user_music = Path(os.path.expanduser('~/Music/Monochrome'))
    return user_music


def get_config_dir() -> Path:
    """
    Devuelve la ruta de configuración sin crearla: quien escriba el archivo se
    encarga del mkdir, para que arrancar la CLI no toque el disco.
    """
    if sys.platform == 'win32' and not is_termux():
        appdata = os.environ.get('APPDATA', os.path.expanduser('~'))
        return Path(appdata) / 'monochrome-cli'
    return Path(os.path.expanduser('~/.config/monochrome-cli'))


def find_ffmpeg() -> Optional[str]:
    """Ruta del ejecutable de FFmpeg, o None si no está instalado."""
    return shutil.which('ffmpeg') or shutil.which('ffmpeg.exe')


def ffmpeg_install_hint() -> str:
    """Instrucción de instalación de FFmpeg adaptada a la plataforma actual."""
    if is_termux():
        return "pkg install ffmpeg"
    if sys.platform == 'darwin':
        return "brew install ffmpeg"
    if sys.platform == 'win32':
        return "winget install Gyan.FFmpeg"
    return "sudo apt install ffmpeg   (o: sudo pacman -S ffmpeg / sudo dnf install ffmpeg)"
