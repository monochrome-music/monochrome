#!/usr/bin/env python3
"""
Monochrome CLI launcher script.
"""
import sys
from pathlib import Path

# Add cli directory to sys.path
cli_dir = Path(__file__).resolve().parent / "cli"
if str(cli_dir) not in sys.path:
    sys.path.insert(0, str(cli_dir))

from monochrome_cli.main import cli_entrypoint

if __name__ == "__main__":
    cli_entrypoint()
