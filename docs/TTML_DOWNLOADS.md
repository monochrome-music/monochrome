# Lyrics downloads

Downloads previously used LRCLIB even when the playback component had a native
TTML source. Its TTML exporter reconstructed line timing from LRC, losing the
original word timing. Downloads now retrieve original TTML using the lrc.red and
BiniLyrics provider contracts used by `am-lyrics`.

In **Settings → Downloads**:

- **Preferred Download Lyrics Format**: LRC (the upgrade default), TTML, or Auto.
  Auto prefers original TTML and falls back to LRC. LRC remains line synchronized.
- **Fall Back to LRC**: optional for strict TTML selection. Auto always falls back.
  Missing, invalid or unavailable TTML is never replaced with generated XML.
- **Lyrics Download Mode**: embedded, separate, or both. The existing Separate
  Lyrics Files toggle is synchronized with this setting.

No existing setting is rewritten on upgrade. Previously, lyrics were always
embedded; the old Download Lyrics toggle enabled extra files. An unset mode is
therefore derived as embedded, or both when that old toggle is enabled.

## Containers

| Container            | Original TTML storage                                   |
| -------------------- | ------------------------------------------------------- |
| FLAC                 | UTF-8 Vorbis comment `LYRICS_TTML`                      |
| MP3                  | ID3v2 user text frame (TXXX), description `LYRICS_TTML` |
| M4A (AAC or ALAC)    | Freeform MP4 item `----:com.apple.iTunes:LYRICS_TTML`   |
| Other output formats | Separate `.ttml` file                                   |

These are custom preservation fields, **not standardized karaoke playback
tracks**. Most players will not display embedded TTML. Select Both to retain an
interoperable sidecar for players that support loading TTML files.

The ordinary LRC/plain lyrics field is not replaced with XML. Existing audio,
artwork and unrelated tags follow the existing metadata pipeline; embedding itself
does not transcode audio. TTML is read back from the saved file and compared with
the original XML before considering embedding successful. Failed or unsupported
embedding produces a sidecar even in Embedded mode.

## Implementation

`native-ttml.js` validates XML and retrieves original documents, first by ISRC and
then by title/artist matching. It rejects DTD/entity declarations, oversized XML,
invalid structure and malformed timing syntax. Requests have per-provider timeouts
and honor download cancellation. The original XML is never serialized or rebuilt.
The providers may not have TTML for every song. Metadata matches depend on the
provider; ISRC is preferred. Network/CORS/provider failures are treated as missing
lyrics, with fallback controlled by the user's preferences.

`download-lyrics.js` selects the format once, coalesces requests within a download,
and shares selection/verified embedding state through a WeakMap keyed by the
output audio Blob. Short-lived, bounded caches avoid repeated provider calls.
A shared entry generator supplies matching basenames to individual, queue, liked,
album, playlist and discography downloads. The existing ZIP, folder, local-media
folder and sequential writers consume the same entries. Audio failures do not
produce orphan lyrics.

Native TTML export no longer synthesizes XML from LRC. Existing LRC export and
playback rendering are retained. Settings use the project's existing English-only
settings markup; there is no translation catalog to update.

## Tests

Browser tests cover retrieval, raw XML/word timing, invalid documents, fallback,
legacy settings, LRC exports, every download entry point, ZIP payloads and folder
writes. Small generated audio fixtures exercise actual TagLib writes and readback
for FLAC, MP3, AAC and ALAC, including unchanged encoded audio payloads, artwork
and pre-existing tags. WAV verifies the unsupported-container sidecar fallback.
See `js/tests/fixtures/lyrics-audio/README.md` for fixture provenance.

## Optional Genius annotations

The upstream client contained hardcoded Genius credentials. Those values were
removed so this change can be published without embedding credentials in source
or sending them through a public CORS relay. Optional Genius annotations now use
`/api/genius`, a Cloudflare Pages Function with a server-only `GENIUS_ACCESS_TOKEN`
environment secret. Configure that secret on your own deployment to enable
annotations. It must not be a `VITE_` variable or be included in client builds.
Without that deployment configuration, Genius annotations show an unavailable
message; TTML playback, native TTML downloads and LRC downloads remain usable.
The proxy only permits search and numeric song-reference queries to the fixed
Genius API host, and does not pass upstream error bodies back to the client.
