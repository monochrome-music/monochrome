"""
Monochrome CLI ASCII Banner and Headers using Rich.
"""
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from monochrome_cli.config import config
from monochrome_cli.utils.platform import is_termux

console = Console()

BANNER_ART = r"""
 ███▄ ▄███▓ ▒█████   ███▄    █  ▒█████   ▄████▄   ██░ ██  ██▀███   ▒█████   ███▄ ▄███▓▓█████
▓██▒▀█▀ ██▒▒██▒  ██▒ ██ ▀█   █ ▒██▒  ██▒▒██▀ ▀█  ▓██░ ██▒▓██ ▒ ██▒▒██▒  ██▒▓██▒▀█▀ ██▒▓█   ▀
▓██    ▓██░▒██░  ██▒▓██  ▀█ ██▒▒██░  ██▒▒▓█    ▄ ▒██▀▀██░▓██ ░▄█ ▒▒██░  ██▒▓██    ▓██░▒███  
▒██    ▒██ ▒██   ██░▓██▒  ▐▌██▒▒██   ██░▒▓▓▄ ▄██▒░▓█ ░██ ▒██▀▀█▄  ▒██   ██░▒██    ▒██ ▒▓█  ▄
▒██▒   ░██▒░ ████▓▒░▒██░   ▓██░░ ████▓▒░▒ ▓███▀ ░░▓█▒░██▓░██▓ ▒██▒░ ████▓▒░▒██▒   ░██▒░▒████▒
░ ▒░   ░  ░░ ▒░▒░▒░ ░ ▒░   ▒ ▒ ░ ▒░▒░▒░ ░ ░▒ ▒  ░ ▒ ░░▒░▒░ ▒▓ ░▒▓░░ ▒░▒░▒░ ░ ▒░   ░  ░░░ ▒░ ░
"""

def print_banner():
    platform_str = "[green]📱 Termux (Android)[/green]" if is_termux() else "[cyan]💻 Linux/Desktop[/cyan]"
    fmt_str = f"[bold yellow]{config.default_format.display_name}[/bold yellow]"
    dir_str = f"[dim]{config.download_directory}[/dim]"

    text = Text(BANNER_ART, style="bold white")
    subtitle = f"Versión 1.0.0 | {platform_str} | Formato: {fmt_str}\nDestino: {dir_str}"
    
    panel = Panel(
        text,
        subtitle=subtitle,
        subtitle_align="center",
        border_style="bright_blue",
        padding=(0, 1)
    )
    console.print(panel)
