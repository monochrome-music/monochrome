[<img src="https://github.com/SamidyFR/monochrome/blob/main/assets/512.png?raw=true" alt="Monochrome Logo">](https://monochrome.samidy.com)


# Monochrome

**Monochrome** is an open-source, privacy-respecting, ad-free [TIDAL](https://tidal.com) web UI, built on top of [Hi-Fi](https://github.com/sachinsenal0x64/hifi).


[<img src="https://files.catbox.moe/94f3pq.png" alt="Monochrome UI" width="800">](https://monochrome.samidy.com/#album/378149557)
  
Check it out live at: [**monochrome.samidy.com**](https://monochrome.samidy.com)  

[![GitHub stars](https://img.shields.io/github/stars/SamidyFR/monochrome?style=for-the-badge&color=ffffff&labelColor=000000)](https://github.com/SamidyFR/monochrome/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/SamidyFR/monochrome?style=for-the-badge&color=ffffff&labelColor=000000)](https://github.com/SamidyFR/monochrome/forks)
[![GitHub issues](https://img.shields.io/github/issues/SamidyFR/monochrome?style=for-the-badge&color=ffffff&labelColor=000000)](https://github.com/SamidyFR/monochrome/issues)

[<img src="https://github.com/monochrome-music/monochrome/blob/main/assets/asseenonfmhy880x310.png?raw=true" alt="As seen on FMHY" height="50">](https://fmhy.net/audio#streaming-sites)

## Warning
This is not the official repository or instance. It is an actively maintained fork. The official one can be found here: https://github.com/eduardprigoana/monochrome. This fork was created because the original project was shut down (as you can see in the repository).


## **I am Not Affiliated with the original Owner.**

## Development

Monochrome is built with Vanilla JavaScript, HTML, and CSS. No build step is required (no Webpack, Vite, etc.), but because it uses ES Modules, you must run it over HTTP(S).

### Prerequisites

- A modern web browser
- A way to serve static files (e.g., Python, VS Code Live Server, Node.js `http-server`)

### Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/SamidyFR/monochrome.git
    cd monochrome
    ```

2.  **Run locally**
    You can use any static file server. For example:

    **Using Python 3:**
    ```bash
    python3 -m http.server 8000
    ```

    **Using Node.js `http-server`:**
    ```bash
    npx http-server .
    ```

3.  **Open in Browser**
    Navigate to `http://localhost:8000` (or whatever port your server uses).

### Contributing

1.  Fork the project
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request
