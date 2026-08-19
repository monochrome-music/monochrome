"""
Live download and verification test for Tainy and David Guetta songs.
"""
import sys
import tempfile
from pathlib import Path

# Add cli to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mutagen.id3 import ID3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4

from monochrome_cli.core.search import SearchEngine
from monochrome_cli.core.downloader import Downloader
from monochrome_cli.types import AudioFormat


def inspect_mp3(file_path):
    audio = ID3(file_path)
    title = audio.get("TIT2")
    artist = audio.get("TPE1")
    album = audio.get("TALB")
    print("   [ID3v2] Titulo: {}".format(title))
    print("   [ID3v2] Artista: {}".format(artist))
    print("   [ID3v2] Album: {}".format(album))

    apic = [v for k, v in audio.items() if k.startswith("APIC")]
    if apic:
        print("   [Portada HD] Incrustada: {} bytes ({})".format(len(apic[0].data), apic[0].mime))
    uslt = [v for k, v in audio.items() if k.startswith("USLT")]
    if uslt:
        snippet = uslt[0].text[:80].replace("\n", " ")
        print('   [Letras ID3] Incrustadas: "{}..."'.format(snippet))


def inspect_flac(file_path):
    audio = FLAC(file_path)
    print("   [FLAC] Titulo: {}".format(audio.get("TITLE", [None])[0]))
    print("   [FLAC] Artista: {}".format(audio.get("ARTIST", [None])[0]))
    print("   [FLAC] Album: {}".format(audio.get("ALBUM", [None])[0]))
    if audio.pictures:
        pic = audio.pictures[0]
        print("   [Portada HD] Incrustada: {} bytes ({})".format(len(pic.data), pic.mime))
    if "LYRICS" in audio:
        snippet = audio["LYRICS"][0][:80].replace("\n", " ")
        print('   [Letras FLAC] Incrustadas: "{}..."'.format(snippet))


def inspect_m4a(file_path):
    audio = MP4(file_path)
    print("   [MP4] Titulo: {}".format(audio.get("\xa9nam", [None])[0]))
    print("   [MP4] Artista: {}".format(audio.get("\xa9ART", [None])[0]))
    print("   [MP4] Album: {}".format(audio.get("\xa9alb", [None])[0]))
    if "covr" in audio:
        print("   [Portada HD] Incrustada: {} bytes".format(len(audio["covr"][0])))
    if "\xa9lyr" in audio:
        snippet = audio["\xa9lyr"][0][:80].replace("\n", " ")
        print('   [Letras MP4] Incrustadas: "{}..."'.format(snippet))


INSPECTORS = {
    ".mp3": inspect_mp3,
    ".flac": inspect_flac,
    ".m4a": inspect_m4a,
}


def run_artist_tests(output_base=None):
    temp_holder = None
    if output_base is None:
        temp_holder = tempfile.TemporaryDirectory()
        output_base = Path(temp_holder.name)
    else:
        output_base = Path(output_base)
        output_base.mkdir(parents=True, exist_ok=True)

    test_cases = [
        {
            "query": "Tainy Bad Bunny MOJABI GHOST",
            "format": AudioFormat.MP3_320,
            "artist_label": "Tainy / Bad Bunny",
            "expected_ext": ".mp3",
        },
        {
            "query": "David Guetta Sia Titanium",
            "format": AudioFormat.FLAC,
            "artist_label": "David Guetta (Titanium)",
            "expected_ext": ".flac",
        },
        {
            "query": "David Guetta Bebe Rexha I'm Good Blue",
            "format": AudioFormat.M4A_256,
            "artist_label": "David Guetta (I'm Good)",
            "expected_ext": ".m4a",
        },
    ]

    downloaded_files = []

    try:
        for case in test_cases:
            query = case["query"]
            fmt = case["format"]
            expected_ext = case["expected_ext"]
            print("\n==================================================")
            print("Buscando {} para prueba [{}]...".format(query, fmt.value.upper()))
            print("==================================================")

            res = SearchEngine.search(query, limit=1)
            assert len(res.tracks) > 0, "No tracks found for {}".format(query)
            track = res.tracks[0]

            print("OK Pista encontrada: {} - {} (Album: {})".format(track.artist, track.title, track.album))
            print("  Portada URL: {}".format(track.cover_url))

            print("Descargando en {}...".format(fmt.display_name))
            saved_file, is_new = Downloader.download_track(
                track, audio_format=fmt, output_dir=output_base
            )
            assert saved_file is not None and saved_file.exists(), \
                "Failed to download {}".format(track.title)
            assert saved_file.suffix == expected_ext, \
                "Expected {}, got {}".format(expected_ext, saved_file.suffix)

            size_mb = saved_file.stat().st_size / (1024 * 1024)
            print("OK Archivo generado: {} ({:.2f} MB, nuevo={})".format(saved_file, size_mb, is_new))
            downloaded_files.append((saved_file, track, fmt))

        print("\n==================================================")
        print("INSPECCIONANDO METADATOS, PORTADAS Y LETRAS")
        print("==================================================")

        for file_path, track, fmt in downloaded_files:
            print("\nArchivo: {}".format(file_path.name))
            print("   Ruta completa: {}".format(file_path))
            print("   Tamano: {:.2f} MB".format(file_path.stat().st_size / (1024 * 1024)))

            inspector = INSPECTORS.get(file_path.suffix.lower())
            if inspector:
                inspector(file_path)

            # Comprobar archivo companero .lrc
            lrc_file = file_path.with_suffix(".lrc")
            if lrc_file.exists():
                print("   [Letras .lrc] Archivo generado: {} ({} bytes)".format(
                    lrc_file.name, lrc_file.stat().st_size))
                with open(lrc_file, "r", encoding="utf-8") as f:
                    first_lines = [f.readline().strip() for _ in range(2)]
                print("   [Letras .lrc Muestra] {}".format(" | ".join(first_lines)))

        print("\n>>> TODAS LAS PRUEBAS DE DESCARGA E INSPECCION FINALIZARON CON EXITO <<<")
    finally:
        if temp_holder is not None:
            temp_holder.cleanup()


if __name__ == "__main__":
    run_artist_tests(sys.argv[1] if len(sys.argv) > 1 else None)
