"""
Configuración de pytest para esta carpeta.

La mayoría de los archivos de aquí son pruebas en vivo: buscan en Tidal y
descargan audio real de YouTube. Recolectarlas sin querer (por ejemplo con un
`pytest` a secas en CI) dispara descargas de varios minutos, así que solo se
ejecutan cuando se piden explícitamente:

    MONOCHROME_LIVE_TESTS=1 pytest tests/

Sin esa variable se ejecutan únicamente las pruebas unitarias, que no tocan red.
Todos los archivos siguen siendo ejecutables a mano: `python3 tests/test_search.py`.
"""
import os
from pathlib import Path

import pytest

LIVE_TEST_FILES = {
    "test_search.py",
    "test_lyrics.py",
    "test_tagger.py",
    "test_downloader.py",
    "test_full_pipeline.py",
    "test_artist_downloads.py",
}


def pytest_collection_modifyitems(config, items):
    if os.environ.get("MONOCHROME_LIVE_TESTS") == "1":
        return
    skip_live = pytest.mark.skip(
        reason="prueba en vivo (red/descargas); ejecuta con MONOCHROME_LIVE_TESTS=1"
    )
    for item in items:
        if Path(str(item.fspath)).name in LIVE_TEST_FILES:
            item.add_marker(skip_live)
