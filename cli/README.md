# 🎵 Monochrome CLI (Terminal & Termux)

Versión CLI y TUI (Text User Interface) inspirada en **Monochrome**, diseñada específicamente para terminales **Linux**, **macOS** y **Termux en Android**.

Permite buscar canciones, álbumes y artistas con metadatos de alta fidelidad, descargar en varios formatos de salida (FLAC, MP3, M4A/AAC, OPUS), elegir si incluir o no letras sincronizadas (`.lrc`), incrustar carátulas en HD (1280x1280) y configurar preferencias fijas por defecto.

## ⚙️ Cómo funciona (importante)

Monochrome CLI combina dos fuentes distintas:

- **Metadatos y carátulas**: catálogo de **Tidal** (con Deezer como respaldo). De ahí salen el título, artista, álbum, año, ISRC, número de pista y la portada en HD.
- **Audio**: se localiza en **YouTube** mediante `yt-dlp`, eligiendo el resultado cuya duración coincide con la del catálogo. Se intenta primero el stream de solo audio (**~130 kbps** Opus/AAC) y, si YouTube lo bloquea, se cae automáticamente al stream progresivo (**~48-96 kbps**).

Esto significa que **ninguna opción de salida produce audio sin pérdida real**: el formato solo decide cómo se guarda ese stream. `FLAC` evita una recompresión adicional pero multiplica el tamaño sin ganar calidad, y `opus` es el que menos degrada porque suele coincidir con el códec de origen.

> Si ves calidades bajas de forma sistemática, es porque YouTube exige un *PO token* para los streams de solo audio en tu conexión. Mantén `yt-dlp` actualizado (`pip install -U yt-dlp`); es lo que más influye en qué formatos siguen accesibles.

---

## 🚀 Instalación en Termux (Android)

### Método 1: Instalador Automático de 1 Comando
En Termux, ejecuta:
```bash
bash install_termux.sh
```

### Método 2: Instalación Manual
```bash
# 1. Instalar paquetes base
pkg update -y
pkg install -y python ffmpeg git

# 2. Habilitar permisos de almacenamiento en Android
termux-setup-storage

# 3. Instalar dependencias de Python
pip install yt-dlp mutagen rich requests

# 4. Instalar Monochrome CLI
pip install -e ./cli
```

---

## 💻 Instalación en Linux / macOS

```bash
# Dependencias del sistema (FFmpeg)
sudo apt install ffmpeg python3-pip   # Debian / Ubuntu
sudo pacman -S ffmpeg python-pip     # Arch Linux
brew install ffmpeg python           # macOS

# Instalar dependencias
pip install yt-dlp mutagen rich requests

# Instalar comando global `mono`
pip install -e ./cli
```

---

## 🎮 Guía de Uso

### 1. Modo Interactivo TUI (Recomendado)
Simplemente ejecuta:
```bash
mono
```
- Escribe el nombre de cualquier canción, álbum o artista.
- Selecciona el número `#` de la canción que quieres descargar (o escribe `all` o un rango como `1-5`).
- Al seleccionar una canción, puedes **presionar Enter** para descargar con tus opciones por defecto, o escribir **`c`** para elegir al momento el formato y si quieres incluir letras o no.
- Escribe **`fmt`** para cambiar el formato de audio activo.
- Escribe **`config`** para abrir el menú completo de opciones predeterminadas.

---

### 2. Modo Comando Directo (CLI)

```bash
# Descargar eligiendo formato en el momento
mono "daft punk get lucky" -d -f flac
mono "the weeknd starboy" -d -f mp3_320
mono "dua lipa levitating" -d -f m4a

# Descargar con o sin letras sincronizadas
mono "queen bohemian rhapsody" -d --no-lyrics   # Sin archivo .lrc
mono "queen bohemian rhapsody" -d --lyrics      # Con archivo .lrc

# Descargar un álbum completo
mono "tainy data" -a -f mp3_320

# Forzar re-descarga si ya existe
mono "daft punk get lucky" -d -w
```

---

### ⚙️ Establecer Opciones Predeterminadas Fijas

Puedes guardar tus preferencias permanentes con comandos rápidos o en el menú `config`:

```bash
# Establecer formato preferido para siempre (flac, mp3_320, mp3_256, m4a, opus)
mono --set-default-format flac
mono --set-default-format mp3_320

# Establecer si siempre descargar letras (.lrc) por defecto
mono --set-default-lyrics true
mono --set-default-lyrics false

# Establecer carpeta de descargas predeterminada permanente
mono --set-default-output /sdcard/Music/Monochrome

# Establecer el país del catálogo (afecta a qué ediciones y lanzamientos aparecen)
mono --set-default-country ES

# Abrir el menú interactivo de configuración
mono --config
```

---

## 🎛️ Formatos y Calidades Soportadas

Todos parten del mismo stream de origen (~130-160 kbps), así que la diferencia
está en el tamaño y la compatibilidad, no en la fidelidad.

| Formato | Código | Contenedor | Cuándo usarlo |
| :--- | :--- | :--- | :--- |
| **OPUS** | `opus` | 160 kbps | **Recomendado**: mismo códec que la fuente, sin recodificar |
| **MP3 320k** | `mp3_320` | 320 kbps CBR | Máxima compatibilidad con cualquier reproductor o coche |
| **MP3 256k** | `mp3_256` | 256 kbps | Equilibrio entre tamaño y compatibilidad |
| **M4A** | `m4a` | 256 kbps AAC | Ecosistema Apple |
| **FLAC** | `flac` | Sin recompresión | Evita una recodificación extra; ocupa 4-5x más sin ganar calidad |
| **MP3 128k** | `mp3_128` | 128 kbps | Ahorro máximo de espacio |

---

## 🔧 Configuración avanzada

El archivo de configuración vive en `~/.config/monochrome-cli/config.json` y solo
se escribe cuando cambias algo (arrancar `mono` no lo toca).

### Credenciales de Tidal

Las credenciales **no se guardan** en tu configuración. Se pueden sobreescribir
por entorno:

```bash
export MONOCHROME_TIDAL_CLIENT_ID="tu_id"
export MONOCHROME_TIDAL_CLIENT_SECRET="tu_secreto"
```

**Importante antes de intentar conseguir las tuyas:** existen dos APIs de Tidal
distintas y no son intercambiables.

| | API interna (la que usa este proyecto) | API oficial |
| :--- | :--- | :--- |
| Base | `api.tidal.com/v1` | `openapi.tidal.com/v2` |
| Credenciales | Client ID interno de las apps de Tidal | [developer.tidal.com](https://developer.tidal.com) → crear una App |
| ¿Se pueden pedir? | No; no hay proceso público para obtenerlas | Sí, registrándote |
| Formato de respuesta | JSON propio | JSON:API |

Las credenciales del portal oficial **no funcionan** con los endpoints `v1` que
usa `core/search.py` (devuelven `400`), así que registrarte en el portal no basta
para sustituir el valor por defecto: haría falta portar `search.py` a
`openapi.tidal.com/v2`, que tiene rutas y formato de respuesta diferentes.

Ten en cuenta que Tidal considera que `api.tidal.com` no está destinada a uso
externo. Si buscas una fuente de metadatos sin credenciales, **Deezer**
(`api.deezer.com`) ya está integrada como respaldo y su API de búsqueda es
pública y no requiere ningún token.

---

## 🧪 Tests

```bash
# Solo pruebas unitarias (sin red, menos de un segundo)
python3 tests/test_units.py
pytest tests/

# Incluir las pruebas en vivo, que descargan audio real
MONOCHROME_LIVE_TESTS=1 pytest tests/
```

---

## 🛡️ Sistema Antiduplicados

- Si una canción ya existe en disco, el sistema la detecta en **0.1 segundos** y la omite automáticamente para no gastar ancho de banda ni duplicar archivos.
- Para forzar la re-descarga (por ejemplo al cambiar de calidad), añade la bandera `-w` o `--force`.
