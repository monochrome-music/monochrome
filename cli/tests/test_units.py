"""
Pruebas unitarias sin red ni descargas: plantillas, formatos, configuracion y
el parseo de la seleccion del menu interactivo.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from monochrome_cli.config import Config, DEFAULT_TIDAL_CLIENT_ID, DEFAULT_TIDAL_CLIENT_SECRET
from monochrome_cli.core.tagger import image_dimensions, is_png
from monochrome_cli.main import parse_selection
from monochrome_cli.types import AudioFormat, TrackMetadata
from monochrome_cli.utils.template import format_track_path, sanitize_filename


def test_sanitize_filename():
    print("Testing sanitize_filename...")
    assert sanitize_filename('AC/DC') == 'AC_DC'
    assert sanitize_filename('a:b*c?d"e<f>g|h') == 'a_b_c_d_e_f_g_h'
    assert sanitize_filename('  espacios   dobles  ') == 'espacios dobles'
    assert sanitize_filename('') == 'Unknown'
    assert sanitize_filename('///') == '___'  # separadores -> guiones bajos, no se pierde el nombre
    assert sanitize_filename(None) == 'Unknown'
    print("  OK nombres saneados correctamente")


def test_format_track_path():
    print("Testing format_track_path...")
    track = TrackMetadata(
        title="Get Lucky", artist="Daft Punk", album="Random Access Memories",
        album_artist="Daft Punk", track_number=8, year="2013",
    )
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        path = format_track_path(track, base, AudioFormat.MP3_320,
                                 "{album_artist}/{album}/{track_number:02d} - {title}")
        assert path == base / "Daft Punk" / "Random Access Memories" / "08 - Get Lucky.mp3", path
        # Por defecto no debe tocar el disco.
        assert not path.parent.exists(), "format_track_path no debe crear carpetas por defecto"

        format_track_path(track, base, AudioFormat.MP3_320,
                          "{album_artist}/{album}/{track_number:02d} - {title}",
                          create_dirs=True)
        assert path.parent.exists(), "create_dirs=True debe crear la carpeta"

        # Una plantilla rota cae al nombre plano en vez de reventar.
        fallback = format_track_path(track, base, AudioFormat.FLAC, "{no_existe}/{title}")
        assert fallback == base / "Daft Punk - Get Lucky.flac", fallback

        # La extension sigue al formato elegido.
        assert format_track_path(track, base, AudioFormat.OPUS_160, "{title}").suffix == ".opus"
    print("  OK rutas, extensiones y fallback de plantilla verificados")


def test_audio_format_parsing():
    print("Testing AudioFormat parsing...")
    assert AudioFormat.parse("flac") is AudioFormat.FLAC
    assert AudioFormat.parse("320k") is AudioFormat.MP3_320
    assert AudioFormat.parse("  M4A  ") is AudioFormat.M4A_256
    assert AudioFormat.parse("mp3-320") is AudioFormat.MP3_320
    assert AudioFormat.parse("basura") is None, "un valor invalido debe devolver None"
    assert AudioFormat.parse("") is None
    # from_string sigue siendo tolerante para valores ya guardados en disco.
    assert AudioFormat.from_string("basura") is AudioFormat.MP3_320
    assert AudioFormat.FLAC.extension == "flac"
    assert AudioFormat.MP3_128.extension == "mp3"
    assert "mp3_320" in AudioFormat.choices()
    print("  OK parse estricto y from_string tolerante")


def test_parse_selection():
    print("Testing parse_selection...")
    assert parse_selection("q", 5, 2) == ("quit", None)
    assert parse_selection("s", 5, 2) == ("search", None)
    assert parse_selection("3", 5, 2) == ("tracks", [2])
    assert parse_selection("all", 3, 0) == ("tracks", [0, 1, 2])
    assert parse_selection("1-3", 5, 0) == ("tracks", [0, 1, 2])
    assert parse_selection("3-1", 5, 0) == ("tracks", [0, 1, 2]), "rango invertido debe ordenarse"
    assert parse_selection("1,3,5", 5, 0) == ("tracks", [0, 2, 4])
    assert parse_selection("1,1,2", 5, 0) == ("tracks", [0, 1]), "debe descartar repetidos"
    assert parse_selection("A2", 5, 3) == ("album", 1)

    # Casos que antes caian en "Opcion no reconocida" sin explicar nada.
    action, msg = parse_selection("9-20", 5, 0)
    assert action == "error" and "1-5" in msg, (action, msg)
    action, msg = parse_selection("A9", 5, 3)
    assert action == "error" and "A1-A3" in msg, (action, msg)
    action, msg = parse_selection("", 5, 0)
    assert action == "error"
    action, msg = parse_selection("1-x", 5, 0)
    assert action == "error" and "1-3" in msg
    action, msg = parse_selection("hola", 5, 0)
    assert action == "error"
    action, msg = parse_selection("all", 0, 0)
    assert action == "error"

    # Un rango parcialmente valido conserva lo que si existe.
    assert parse_selection("4-8", 5, 0) == ("tracks", [3, 4])
    print("  OK seleccion, rangos, listas y errores explicados")


def test_config_has_no_import_side_effects():
    print("Testing Config side effects and defaults...")
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = Path(tmp) / "sub" / "config.json"
        cfg = Config(config_path=cfg_path)
        # Construir la configuracion no debe escribir nada todavia.
        assert not cfg_path.exists(), "Config() no debe crear el archivo al arrancar"
        assert not cfg_path.parent.exists(), "Config() no debe crear directorios al arrancar"

        # Consultar la carpeta de descargas tampoco crea nada.
        _ = cfg.download_directory

        # Las credenciales no se escriben en el archivo del usuario.
        cfg.set("embed_cover", False)
        assert cfg_path.exists()
        saved = json.loads(cfg_path.read_text(encoding="utf-8"))
        assert "tidal_client_secret" not in saved, "el secreto no debe guardarse en el config"
        assert saved["embed_cover"] is False
        # Pero siguen disponibles al leerlas.
        assert cfg.tidal_client_id == DEFAULT_TIDAL_CLIENT_ID
        assert cfg.tidal_client_secret == DEFAULT_TIDAL_CLIENT_SECRET
    print("  OK sin escrituras al importar y sin secretos en el config")


def test_config_migrates_legacy_credentials():
    print("Testing migration of legacy credentials...")
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = Path(tmp) / "config.json"
        cfg_path.write_text(json.dumps({
            "embed_cover": True,
            "tidal_client_id": DEFAULT_TIDAL_CLIENT_ID,
            "tidal_client_secret": DEFAULT_TIDAL_CLIENT_SECRET,
        }), encoding="utf-8")

        cfg = Config(config_path=cfg_path)
        saved = json.loads(cfg_path.read_text(encoding="utf-8"))
        assert "tidal_client_id" not in saved, "las credenciales por defecto deben limpiarse"
        assert cfg.tidal_client_id == DEFAULT_TIDAL_CLIENT_ID

        # Una credencial personalizada del usuario si se respeta.
        cfg_path.write_text(json.dumps({"tidal_client_id": "MI_CLAVE"}), encoding="utf-8")
        cfg2 = Config(config_path=cfg_path)
        assert cfg2.tidal_client_id == "MI_CLAVE"
        assert "tidal_client_id" in json.loads(cfg_path.read_text(encoding="utf-8"))
    print("  OK credenciales por defecto limpiadas y personalizadas respetadas")


def test_config_validates_values():
    print("Testing config value validation...")
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = Path(tmp) / "config.json"
        cfg_path.write_text(json.dumps({
            "country_code": "espana", "cover_resolution": "no-es-un-numero",
            "search_limit": None, "default_format": "inventado",
        }), encoding="utf-8")
        cfg = Config(config_path=cfg_path)
        assert cfg.country_code == "US", cfg.country_code
        assert cfg.cover_resolution == 1280
        assert cfg.search_limit == 10
        assert cfg.default_format is AudioFormat.MP3_320

        cfg_path.write_text(json.dumps({"country_code": "es"}), encoding="utf-8")
        assert Config(config_path=cfg_path).country_code == "ES"

        # Un archivo corrupto no debe tumbar la aplicacion.
        cfg_path.write_text("{esto no es json", encoding="utf-8")
        assert Config(config_path=cfg_path).default_format is AudioFormat.MP3_320
    print("  OK valores invalidos y archivo corrupto tolerados")


def test_image_dimensions():
    print("Testing image header parsing...")
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR"
           + (640).to_bytes(4, "big") + (480).to_bytes(4, "big"))
    assert is_png(png)
    assert image_dimensions(png) == (640, 480)

    jpeg = (b"\xff\xd8" + b"\xff\xe0" + (16).to_bytes(2, "big") + b"\x00" * 14
            + b"\xff\xc0" + (17).to_bytes(2, "big") + b"\x08"
            + (300).to_bytes(2, "big") + (200).to_bytes(2, "big") + b"\x00" * 10)
    assert not is_png(jpeg)
    assert image_dimensions(jpeg) == (200, 300)

    # Datos ilegibles no deben lanzar excepcion.
    assert image_dimensions(b"basura") == (0, 0)
    print("  OK dimensiones de PNG y JPEG leidas de la cabecera")


TESTS = [
    test_sanitize_filename,
    test_format_track_path,
    test_audio_format_parsing,
    test_parse_selection,
    test_config_has_no_import_side_effects,
    test_config_migrates_legacy_credentials,
    test_config_validates_values,
    test_image_dimensions,
]


if __name__ == "__main__":
    for test in TESTS:
        test()
    print("\n[ALL UNIT TESTS PASSED SUCCESSFULLY!]")
