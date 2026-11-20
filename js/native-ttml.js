// Keep the provider contract aligned with am-lyrics' lrc.red and BiniLyrics sources.
const TTML_NS = 'http://www.w3.org/ns/ttml';
const MAX_TTML_LENGTH = 4 * 1024 * 1024;

/** Validate without serializing: the original XML, whitespace and timing must survive unchanged. */
export function getNativeTTML(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_TTML_LENGTH) return null;
    // Lyrics do not need DTDs or entities. Never resolve externally supplied declarations.
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) return null;
    const doc = new DOMParser().parseFromString(value, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    if (doc.documentElement.localName !== 'tt' || doc.documentElement.namespaceURI !== TTML_NS) return null;
    if (!doc.getElementsByTagNameNS(TTML_NS, 'body').length) return null;
    const paragraphs = [...doc.getElementsByTagNameNS(TTML_NS, 'p')];
    if (!paragraphs.some((p) => p.textContent.trim())) return null;
    // Check lexical timing syntax (clock, frame-clock or offset time). Frame/tick
    // rates and inherited timing remain in the original document for its reader.
    const timing = /^(?:\d{2,}:[0-5]\d:[0-5]\d(?:\.\d+|:\d{2,}(?:\.\d+)?)?|(?:\d+(?:\.\d+)?|\.\d+)(?:h|m|s|ms|f|t))$/;
    for (const element of doc.getElementsByTagNameNS(TTML_NS, '*')) {
        for (const attr of ['begin', 'end', 'dur']) {
            if (element.hasAttribute(attr) && !timing.test(element.getAttribute(attr).trim())) return null;
        }
    }
    return value;
}

async function request(url, signal, json = true) {
    const response = await fetch(url, { signal, credentials: 'omit' });
    if (!response.ok) return null;
    return json ? response.json() : response.text();
}

/** Fetch original XML from the same providers used for playback; never synthesize word timing. */
export async function fetchNativeTTML(track, { signal } = {}) {
    const title = track?.title?.trim() || '';
    const artist = (
        Array.isArray(track?.artists) ? track.artists.map((a) => a.name || a).join(', ') : track?.artist?.name || ''
    ).trim();
    const isrc = (track?.isrc || track?.mediaMetadata?.isrc || '').trim();
    if (!isrc && (!title || !artist)) return null;
    const params = new URLSearchParams({ track: title, artist });
    if (track?.album?.title) params.set('album', track.album.title);
    if (Number.isFinite(track?.duration) && track.duration > 0) {
        params.set('duration', String(Math.round(track.duration)));
    }

    const readSong = async (code, providerSignal) => {
        const song = await request(`https://lrc.red/s/${encodeURIComponent(code)}.song.json`, providerSignal);
        return getNativeTTML(song?.source);
    };
    const providers = [
        async (providerSignal) => {
            if (isrc) {
                try {
                    const xml = await readSong(isrc, providerSignal);
                    if (xml) return xml;
                } catch {
                    /* Try metadata matching unless the request was cancelled. */
                }
            }
            providerSignal.throwIfAborted();
            if (!title || !artist) return null;
            const match = await request(`https://lrc.red/match.json?${params}`, providerSignal);
            const code = match?.hits?.[0]?.isrc;
            return typeof code === 'string' && code.trim() ? readSong(code.trim(), providerSignal) : null;
        },
        async (providerSignal) => {
            const queries = [];
            if (isrc) queries.push(new URLSearchParams({ isrc }));
            if (title && artist) queries.push(params);
            for (const query of queries) {
                try {
                    const data = await request(`https://lyrics-api.binimum.org/?${query}`, providerSignal);
                    const url = data?.results?.[0]?.lyricsUrl;
                    // Only fetch web resources, without credentials, from provider responses.
                    if (typeof url !== 'string') continue;
                    const parsed = new URL(url);
                    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
                    const xml = getNativeTTML(await request(parsed.href, providerSignal, false));
                    if (xml) return xml;
                } catch {
                    /* Try the next match/provider. */
                }
                providerSignal.throwIfAborted();
            }
            return null;
        },
    ];

    for (const provider of providers) {
        signal?.throwIfAborted();
        const providerSignal = signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000);
        try {
            const xml = await provider(providerSignal);
            if (xml) return { originalTTML: xml, lyricsProvider: provider === providers[0] ? 'lrc.red' : 'BiniLyrics' };
        } catch {
            /* Missing, malformed or unavailable lyrics must not fail an audio download. */
        }
        signal?.throwIfAborted();
    }
    return null;
}
