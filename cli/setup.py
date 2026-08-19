from setuptools import setup, find_packages

setup(
    name="monochrome-cli",
    version="1.0.0",
    description="Monochrome Music CLI & Downloader for Termux and Linux",
    author="Monochrome Music Community",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "yt-dlp>=2024.0.0",
        "mutagen>=1.47.0",
        "rich>=13.0.0",
        "requests>=2.28.0",
    ],
    entry_points={
        "console_scripts": [
            "mono = monochrome_cli.main:cli_entrypoint",
            "monochrome = monochrome_cli.main:cli_entrypoint",
        ],
    },
)
