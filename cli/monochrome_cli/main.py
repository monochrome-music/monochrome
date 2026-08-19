"""
Main entry point and Interactive TUI for Monochrome CLI.
"""
import argparse
import sys
from pathlib import Path
from typing import Any, List, NamedTuple, Optional, Tuple

from rich.console import Console
from rich.prompt import Prompt

from monochrome_cli.config import config
from monochrome_cli.core.downloader import Downloader
from monochrome_cli.core.search import SearchEngine
from monochrome_cli.types import AudioFormat, TrackMetadata
from monochrome_cli.ui.banner import print_banner
from monochrome_cli.ui.tables import (
    display_albums_table,
    display_formats_table,
    display_settings_table,
    display_tracks_table,
)
from monochrome_cli.utils.platform import ffmpeg_install_hint, find_ffmpeg

console = Console()

AFFIRMATIVE = ("s", "si", "sí", "y", "yes")


class DownloadChoice(NamedTuple):
    """Opciones elegidas para una descarga concreta."""
    audio_format: Optional[AudioFormat]
    lyrics: Optional[bool]
    overwrite: bool


def is_yes(answer: str) -> bool:
    return answer.strip().lower() in AFFIRMATIVE


def require_ffmpeg() -> bool:
    """
    Comprueba FFmpeg antes de descargar. Sin él yt-dlp falla al convertir y el
    error que llega al usuario no dice qué falta.
    """
    if find_ffmpeg():
        return True
    console.print(
        "[bold red]✗ FFmpeg no está instalado.[/bold red] Es imprescindible para "
        "convertir el audio descargado.\n"
        f"  Instálalo con: [bold yellow]{ffmpeg_install_hint()}[/bold yellow]\n"
    )
    return False


def parse_selection(selection: str, track_count: int, album_count: int) -> Tuple[str, Any]:
    """
    Interpreta lo que el usuario escribe en la lista de resultados.

    Devuelve (acción, dato) donde acción es "quit", "search", "tracks" (dato =
    índices 0-based), "album" (dato = índice 0-based) o "error" (dato = mensaje).
    Está separada del bucle interactivo para poder probarla sin terminal.
    """
    selection = (selection or "").strip()
    if not selection:
        return "error", "No escribiste ninguna opción."

    lowered = selection.lower()
    if lowered in ("q", "quit", "exit", "salir"):
        return "quit", None
    if lowered in ("s", "search", "n", "buscar"):
        return "search", None

    if lowered == "all":
        if not track_count:
            return "error", "No hay canciones que descargar."
        return "tracks", list(range(track_count))

    # Álbum: A1, a2...
    if lowered.startswith("a") and selection[1:].strip().isdigit():
        idx = int(selection[1:].strip()) - 1
        if not album_count:
            return "error", "Esta búsqueda no devolvió álbumes."
        if not 0 <= idx < album_count:
            return "error", f"Álbum fuera de rango (A1-A{album_count})."
        return "album", idx

    def validate(numbers: List[int]) -> Tuple[str, Any]:
        valid = [n - 1 for n in numbers if 1 <= n <= track_count]
        invalid = sorted({n for n in numbers if not 1 <= n <= track_count})
        if not valid:
            return "error", f"Ningún número válido. El rango disponible es 1-{track_count}."
        if invalid:
            console.print(
                f"[yellow]Se ignoraron números fuera de rango: "
                f"{', '.join(str(n) for n in invalid)} (disponible 1-{track_count})[/yellow]"
            )
        # dict.fromkeys conserva el orden y descarta repetidos
        return "tracks", list(dict.fromkeys(valid))

    # Rango: 1-5
    if "-" in selection:
        start_str, _, end_str = selection.partition("-")
        start_str, end_str = start_str.strip(), end_str.strip()
        if start_str.isdigit() and end_str.isdigit():
            start, end = int(start_str), int(end_str)
            if start > end:
                start, end = end, start
            return validate(list(range(start, end + 1)))
        return "error", "Rango inválido. Usa un formato como 1-3."

    # Lista: 1, 3, 5
    if "," in selection:
        parts = [p.strip() for p in selection.split(",") if p.strip()]
        if not all(p.isdigit() for p in parts):
            return "error", "Lista inválida. Usa un formato como 1,3,5."
        return validate([int(p) for p in parts])

    if selection.isdigit():
        return validate([int(selection)])

    return "error", "Opción no reconocida. Escribe un número, un rango (1-3), 'all', 'A1' o 's'."


def download_single_track(
    track: TrackMetadata,
    audio_format: Optional[AudioFormat] = None,
    output_dir: Optional[Path] = None,
    overwrite: bool = False,
    include_lyrics: Optional[bool] = None,
):
    fmt = audio_format or config.default_format
    lyrics_active = config.embed_lyrics if include_lyrics is None else include_lyrics
    lyrics_str = "Con Letras (.lrc)" if lyrics_active else "Sin Letras"
    console.print(f"\n[bold green]⬇ Iniciando descarga:[/bold green] [white]{track.artist} - {track.title}[/white] [{fmt.value.upper()} | {lyrics_str}]")

    with console.status("[bold cyan]Procesando stream y metadatos...", spinner="dots") as status:
        def update_status(pct: float, msg: str):
            status.update(f"[bold cyan]{msg} ({pct:.0f}%)[/bold cyan]")

        saved_file, is_new = Downloader.download_track(
            track,
            fmt,
            output_dir=output_dir,
            progress_callback=update_status,
            overwrite=overwrite,
            include_lyrics=include_lyrics
        )

    if saved_file:
        if is_new:
            console.print(f"[bold green]✔ Guardado con éxito en:[/bold green] [yellow]{saved_file}[/yellow]\n")
        else:
            console.print(f"[bold yellow]⚡ Ya descargada (Omitida para evitar duplicados):[/bold yellow] [dim]{saved_file}[/dim]\n")
    else:
        console.print(f"[bold red]✗ No se pudo completar la descarga de {track.title}[/bold red]\n")


def download_batch_tracks(
    tracks: List[TrackMetadata],
    audio_format: Optional[AudioFormat] = None,
    output_dir: Optional[Path] = None,
    overwrite: bool = False,
    include_lyrics: Optional[bool] = None,
):
    fmt = audio_format or config.default_format
    total = len(tracks)
    lyrics_active = config.embed_lyrics if include_lyrics is None else include_lyrics
    lyrics_str = "Con Letras (.lrc)" if lyrics_active else "Sin Letras"
    console.print(f"\n[bold cyan]📦 Descargando lote de {total} canciones en formato {fmt.value.upper()} [{lyrics_str}]...[/bold cyan]\n")

    new_count = 0
    skipped_count = 0
    failed_count = 0

    for i, track in enumerate(tracks, 1):
        console.print(f"[bold yellow][{i}/{total}][/bold yellow] [white]{track.artist} - {track.title}[/white]")
        try:
            with console.status(f"[bold cyan]Descargando [{i}/{total}]...", spinner="dots") as status:
                def update_status(pct: float, msg: str):
                    status.update(f"[bold cyan]{msg} ({pct:.0f}%)[/bold cyan]")
                saved_file, is_new = Downloader.download_track(
                    track,
                    fmt,
                    output_dir=output_dir,
                    progress_callback=update_status,
                    overwrite=overwrite,
                    include_lyrics=include_lyrics
                )
        except KeyboardInterrupt:
            # Cancelar un lote no debería perder lo ya descargado.
            console.print(f"\n[yellow]Lote interrumpido en la pista {i} de {total}.[/yellow]")
            break

        if saved_file:
            if is_new:
                new_count += 1
                console.print(f"  [green]✔ Descargado:[/green] [dim]{saved_file.name}[/dim]")
            else:
                skipped_count += 1
                console.print(f"  [yellow]⚡ Ya existía (Omitido):[/yellow] [dim]{saved_file.name}[/dim]")
        else:
            failed_count += 1
            console.print(f"  [red]✗ Error al descargar pista {i}[/red]")

    summary = f"[bold green]✔ ¡Lote finalizado! Nuevas: {new_count} | Omitidas: {skipped_count}"
    if failed_count:
        summary += f" | [bold red]Fallidas: {failed_count}[/bold red]"
    console.print(f"\n{summary}[/bold green]\n")


def select_format_menu(prompt_title: str = "Selecciona Formato") -> AudioFormat:
    display_formats_table()
    choice = Prompt.ask(f"[bold yellow]{prompt_title} (1-6)[/bold yellow]", choices=["1", "2", "3", "4", "5", "6"], default="1")
    mapping = {
        "1": AudioFormat.FLAC,
        "2": AudioFormat.MP3_320,
        "3": AudioFormat.MP3_256,
        "4": AudioFormat.M4A_256,
        "5": AudioFormat.OPUS_160,
        "6": AudioFormat.MP3_128,
    }
    return mapping.get(choice, AudioFormat.MP3_320)


def change_format_interactive():
    selected_fmt = select_format_menu("Elige el nuevo formato por defecto")
    config.default_format = selected_fmt
    console.print(f"[bold green]✔ Formato predeterminado establecido a: {config.default_format.display_name}[/bold green]\n")


def configure_settings_interactive():
    while True:
        display_settings_table()
        console.print("[bold cyan]Menú de Configuración y Preferencias:[/bold cyan]")
        console.print("  [yellow]1[/yellow] - Cambiar Carpeta de Descargas Predeterminada")
        console.print("  [yellow]2[/yellow] - Cambiar Formato y Calidad de Audio Predeterminada")
        console.print("  [yellow]3[/yellow] - Activar / Desactivar Letras Sincronizadas (.lrc e incrustadas)")
        console.print("  [yellow]4[/yellow] - Activar / Desactivar Incrustación de Portadas HD")
        console.print("  [yellow]5[/yellow] - Cambiar Resolución de Portada (1280x1280, 1400x1400, 640x640)")
        console.print("  [yellow]6[/yellow] - Cambiar Plantilla de Carpetas y Nombres")
        console.print("  [yellow]7[/yellow] - Cambiar País del Catálogo (afecta a qué ediciones aparecen)")
        console.print("  [yellow]8[/yellow] - Restaurar Valores de Fábrica")
        console.print("  [yellow]q[/yellow] - Volver al Menú Principal\n")

        ans = Prompt.ask("[bold yellow]Selecciona una opción (1-8 o q)[/bold yellow]", default="q").strip()
        if ans == "1":
            new_dir = Prompt.ask("Nueva ruta de descargas", default=str(config.download_directory))
            config.download_directory = new_dir
            console.print(f"[bold green]✔ Carpeta predeterminada: {config.download_directory}[/bold green]\n")
        elif ans == "2":
            change_format_interactive()
        elif ans == "3":
            new_state = not config.embed_lyrics
            config.update({"embed_lyrics": new_state, "save_lrc_file": new_state})
            status_text = "ACTIVADA (Guardará archivo .lrc e incrustará en audio)" if new_state else "DESACTIVADA"
            console.print(f"[bold green]✔ Descarga de Letras Sincronizadas: {status_text}[/bold green]\n")
        elif ans == "4":
            new_state = not config.embed_cover
            config.set("embed_cover", new_state)
            status_text = "ACTIVADO" if new_state else "DESACTIVADO"
            console.print(f"[bold green]✔ Incrustar portadas HD: {status_text}[/bold green]\n")
        elif ans == "5":
            res_choice = Prompt.ask("Resolución de carátula", choices=["640", "1280", "1400"], default="1280")
            config.set("cover_resolution", int(res_choice))
            console.print(f"[bold green]✔ Resolución de portada establecida a: {config.cover_resolution}x{config.cover_resolution} px[/bold green]\n")
        elif ans == "6":
            console.print("[dim]Variables: {album_artist}, {artist}, {album}, {title}, {year}, {track_number:02d}[/dim]")
            new_tmpl = Prompt.ask("Nueva plantilla", default=config.folder_template)
            config.set("folder_template", new_tmpl)
            console.print(f"[bold green]✔ Plantilla actualizada: {config.folder_template}[/bold green]\n")
        elif ans == "7":
            new_country = Prompt.ask(
                "Código de país ISO de 2 letras (US, ES, MX, AR...)",
                default=config.country_code
            ).strip().upper()
            if len(new_country) == 2 and new_country.isalpha():
                config.set("country_code", new_country)
                console.print(f"[bold green]✔ País del catálogo: {config.country_code}[/bold green]\n")
            else:
                console.print("[red]Código inválido: deben ser 2 letras, por ejemplo ES.[/red]\n")
        elif ans == "8":
            confirm = Prompt.ask("[bold red]¿Restaurar toda la configuración por defecto? (s/n)[/bold red]", default="n")
            if is_yes(confirm):
                config.reset_to_defaults()
                console.print("[bold green]✔ Configuración restaurada a valores de fábrica.[/bold green]\n")
        elif ans.lower() in ("q", "quit", "exit", "volver"):
            break


def ask_download_customization() -> DownloadChoice:
    """
    Allows customizing format, lyrics and overwrite for a specific download.
    """
    lyrics_status = "Sí" if config.embed_lyrics else "No"
    console.print(f"\n[bold cyan]Opciones de Descarga Actuales:[/bold cyan] Formato=[yellow]{config.default_format.display_name}[/yellow] | Letras=[yellow]{lyrics_status}[/yellow]")
    custom_ans = Prompt.ask(
        "[bold yellow]¿Descargar con opciones actuales [Enter] o [c]ustomizar formato/letras?[/bold yellow]",
        default="d"
    ).strip().lower()

    if custom_ans == "c":
        chosen_fmt = select_format_menu("Elige el formato para esta descarga")
        lyrics_choice = is_yes(Prompt.ask("¿Descargar letras sincronizadas (.lrc)? (s/n)", default="s"))
        overwrite_choice = is_yes(Prompt.ask("¿Volver a descargar si el archivo ya existe? (s/n)", default="n"))
        make_default = is_yes(Prompt.ask("¿Guardar estas opciones como tus nuevas opciones predeterminadas? (s/n)", default="n"))
        if make_default:
            config.update({
                "default_format": chosen_fmt.value,
                "embed_lyrics": lyrics_choice,
                "save_lrc_file": lyrics_choice,
            })
            console.print("[bold green]✔ ¡Nuevos valores guardados como predeterminados![/bold green]")
        return DownloadChoice(chosen_fmt, lyrics_choice, overwrite_choice)

    return DownloadChoice(config.default_format, config.embed_lyrics, False)


def handle_album_selection(album, choice_provider=ask_download_customization):
    console.print(f"\n[bold cyan]Cargando pistas del álbum '{album.title}' - {album.artist}...[/bold cyan]")
    with console.status("[bold cyan]Obteniendo lista de canciones del álbum...", spinner="dots"):
        album_tracks = SearchEngine.get_album_tracks(album.source_id)

    if not album_tracks:
        console.print("[red]No se pudieron cargar las pistas de este álbum.[/red]")
        return

    display_tracks_table(album_tracks, title=f"Álbum: {album.title} ({len(album_tracks)} pistas)")
    if not is_yes(Prompt.ask("[bold yellow]¿Descargar álbum completo? (s/n)[/bold yellow]", default="s")):
        return

    choice = choice_provider()
    download_batch_tracks(
        album_tracks,
        audio_format=choice.audio_format,
        include_lyrics=choice.lyrics,
        overwrite=choice.overwrite,
    )


def interactive_search_loop():
    print_banner()

    while True:
        try:
            query = Prompt.ask("\n[bold cyan]🔍 Buscar canción / álbum / artista (o 'config' para ajustes, 'fmt' para formato, 'q' para salir)[/bold cyan]").strip()

            if not query or query.lower() in ("q", "quit", "exit"):
                console.print("[dim]¡Hasta luego![/dim]")
                break

            if query.lower() in ("fmt", "format", "formato"):
                change_format_interactive()
                continue

            if query.lower() in ("config", "settings", "ajustes", "opciones"):
                configure_settings_interactive()
                continue

            with console.status(f"[bold cyan]Buscando '{query}' en el catálogo...", spinner="dots"):
                res = SearchEngine.search(query)

            if not res.tracks and not res.albums:
                console.print("[bold red]No se encontraron resultados.[/bold red] Intenta con otro término.")
                continue

            # Display tracks and albums
            if res.tracks:
                display_tracks_table(res.tracks, title=f"Resultados para '{query}'")
            if res.albums:
                display_albums_table(res.albums, title=f"Álbumes para '{query}'")

            # User Selection Prompt
            while True:
                prompt_text = (
                    f"[bold yellow]Selecciona # (1-{len(res.tracks)}), 'all', rango (ej: 1-3), "
                    f"Álbum (A1) o 's' para buscar de nuevo[/bold yellow]"
                )
                selection = Prompt.ask(prompt_text, default="1")
                action, payload = parse_selection(selection, len(res.tracks), len(res.albums))

                if action == "quit":
                    return
                if action == "search":
                    break
                if action == "error":
                    console.print(f"[red]{payload}[/red]")
                    continue

                if action == "album":
                    handle_album_selection(res.albums[payload])
                    break

                if action == "tracks":
                    if not require_ffmpeg():
                        break
                    selected = [res.tracks[i] for i in payload]
                    choice = ask_download_customization()
                    if len(selected) == 1:
                        download_single_track(
                            selected[0],
                            audio_format=choice.audio_format,
                            include_lyrics=choice.lyrics,
                            overwrite=choice.overwrite,
                        )
                    else:
                        download_batch_tracks(
                            selected,
                            audio_format=choice.audio_format,
                            include_lyrics=choice.lyrics,
                            overwrite=choice.overwrite,
                        )
                    break

        except KeyboardInterrupt:
            console.print("\n[dim]Saliendo...[/dim]")
            break
        except Exception as e:
            console.print(f"[bold red]Ocurrió un error inesperado:[/bold red] {e}")


def resolve_format_argument(value: str, flag_name: str) -> AudioFormat:
    """Convierte el formato pedido por línea de comandos, o aborta explicándolo."""
    parsed = AudioFormat.parse(value)
    if parsed is None:
        console.print(
            f"[bold red]✗ Formato desconocido para {flag_name}: '{value}'[/bold red]\n"
            f"  Valores válidos: [yellow]{', '.join(AudioFormat.choices())}[/yellow]\n"
            f"  También se aceptan alias como: flac, mp3, 320k, m4a, aac, opus, ogg"
        )
        sys.exit(2)
    return parsed


def cli_entrypoint():
    parser = argparse.ArgumentParser(
        prog="monochrome",
        description="Monochrome CLI: Buscador y descargador de música para Termux y Linux."
    )
    parser.add_argument("query", nargs="?", help="Término de búsqueda: título, artista o álbum")
    parser.add_argument("-d", "--download", action="store_true", help="Descargar automáticamente el primer resultado")
    parser.add_argument("-f", "--format", help=f"Formato de audio: {', '.join(AudioFormat.choices())}")
    parser.add_argument("-o", "--output", help="Carpeta de destino de las descargas")
    parser.add_argument("-a", "--album", action="store_true", help="Buscar y descargar álbum completo")
    parser.add_argument("-w", "--overwrite", "--force", action="store_true", help="Sobrescribir si ya existe (por defecto omite duplicados)")
    parser.add_argument("--lyrics", dest="lyrics", action="store_true", default=None, help="Descargar con letras sincronizadas (.lrc)")
    parser.add_argument("--no-lyrics", dest="lyrics", action="store_false", help="Descargar sin letras sincronizadas")

    # Persistent defaults commands
    parser.add_argument("--set-default-format", help=f"Establecer formato predeterminado permanente ({', '.join(AudioFormat.choices())})")
    parser.add_argument("--set-default-lyrics", choices=["true", "false"], help="Establecer si siempre descargar letras por defecto (true/false)")
    parser.add_argument("--set-default-output", help="Establecer carpeta de descargas predeterminada permanente")
    parser.add_argument("--set-default-country", help="Establecer el país del catálogo (código ISO de 2 letras: US, ES, MX...)")
    parser.add_argument("--config", action="store_true", help="Abrir menú de configuración interactivo")

    args = parser.parse_args()

    # Handle persistent settings changes via CLI flags
    if args.set_default_format:
        config.default_format = resolve_format_argument(args.set_default_format, "--set-default-format")
        console.print(f"[bold green]✔ Formato predeterminado guardado:[/bold green] {config.default_format.display_name}")
        return

    if args.set_default_lyrics:
        val = args.set_default_lyrics.lower() == "true"
        config.update({"embed_lyrics": val, "save_lrc_file": val})
        console.print(f"[bold green]✔ Descarga de letras predeterminada guardada:[/bold green] {'Activada' if val else 'Desactivada'}")
        return

    if args.set_default_output:
        config.download_directory = args.set_default_output
        console.print(f"[bold green]✔ Directorio de descargas predeterminado guardado:[/bold green] {config.download_directory}")
        return

    if args.set_default_country:
        country = args.set_default_country.strip().upper()
        if len(country) != 2 or not country.isalpha():
            console.print(f"[bold red]✗ País inválido: '{args.set_default_country}'. Usa un código ISO de 2 letras, por ejemplo ES.[/bold red]")
            sys.exit(2)
        config.set("country_code", country)
        console.print(f"[bold green]✔ País del catálogo guardado:[/bold green] {config.country_code}")
        return

    if args.config:
        configure_settings_interactive()
        return

    # Temporary run overrides
    run_fmt = resolve_format_argument(args.format, "--format") if args.format else None
    run_out = Path(args.output).expanduser() if args.output else None
    run_lyrics = args.lyrics

    if args.query:
        query = args.query.strip()
        console.print(f"[bold cyan]Buscando '{query}'...[/bold cyan]")
        res = SearchEngine.search(query)

        if not res.tracks and not res.albums:
            console.print("[bold red]No se encontraron resultados.[/bold red]")
            sys.exit(1)

        if args.album:
            if not res.albums:
                console.print("[bold red]No se encontraron álbumes para esa búsqueda.[/bold red]")
                sys.exit(1)
            if not require_ffmpeg():
                sys.exit(1)
            album = res.albums[0]
            console.print(f"[bold green]Descargando álbum: {album.title} - {album.artist}[/bold green]")
            tracks = SearchEngine.get_album_tracks(album.source_id)
            if not tracks:
                console.print("[bold red]No se pudieron cargar las pistas del álbum.[/bold red]")
                sys.exit(1)
            download_batch_tracks(tracks, audio_format=run_fmt, output_dir=run_out, overwrite=args.overwrite, include_lyrics=run_lyrics)
            return

        if args.download and res.tracks:
            if not require_ffmpeg():
                sys.exit(1)
            download_single_track(res.tracks[0], audio_format=run_fmt, output_dir=run_out, overwrite=args.overwrite, include_lyrics=run_lyrics)
            return

        # Interactive display for CLI query
        display_tracks_table(res.tracks, title=f"Resultados para '{query}'")
        if res.albums:
            display_albums_table(res.albums, title=f"Álbumes para '{query}'")

        selection = Prompt.ask("[bold yellow]Selecciona # para descargar (o 'all')[/bold yellow]", default="1")
        action, payload = parse_selection(selection, len(res.tracks), len(res.albums))
        if action == "error":
            console.print(f"[red]{payload}[/red]")
            sys.exit(1)
        if action in ("quit", "search"):
            return
        if action == "album":
            handle_album_selection(res.albums[payload])
            return

        if not require_ffmpeg():
            sys.exit(1)
        choice = ask_download_customization()
        selected = [res.tracks[i] for i in payload]
        overwrite = args.overwrite or choice.overwrite
        if len(selected) == 1:
            download_single_track(selected[0], audio_format=choice.audio_format, output_dir=run_out, overwrite=overwrite, include_lyrics=choice.lyrics)
        else:
            download_batch_tracks(selected, audio_format=choice.audio_format, output_dir=run_out, overwrite=overwrite, include_lyrics=choice.lyrics)
        return

    # Default: Start full interactive TUI
    interactive_search_loop()


if __name__ == "__main__":
    cli_entrypoint()
