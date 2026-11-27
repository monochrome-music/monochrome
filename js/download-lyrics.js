import { lyricsSettings } from './storage.js';
import { fetchNativeTTML, getNativeTTML } from './native-ttml.js';

// Share a download's selection and verified embedding result with every output writer.
const downloads = new WeakMap();
const selections = new WeakMap();

export function getDownloadLyricsOptions() {
    return {
        format: lyricsSettings.getPreferredFormat(),
        fallback: lyricsSettings.shouldFallbackToLRC(),
        mode: lyricsSettings.getDownloadMode(),
    };
}

/** Cache successful selections briefly and coalesce metadata/sidecar requests for a track. */
export async function fetchDownloadLyrics(manager, track, options = getDownloadLyricsOptions(), signal) {
    signal?.throwIfAborted();
    let cache = selections.get(manager);
    if (!cache) selections.set(manager, (cache = new Map()));
    const key = JSON.stringify([
        track.id,
        track.title,
        track.artists || track.artist,
        track.album?.title,
        track.isrc,
        track.duration,
        options.format,
        options.fallback,
    ]);
    const cached = cache.get(key);
    if (cached && cached.signal === signal && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
        if (options.format !== 'lrc') {
            const native = await fetchNativeTTML(track, { signal });
            if (native) return { format: 'ttml', content: native.originalTTML };
            if (options.format === 'ttml' && !options.fallback) return null;
        }
        const lyrics = await manager.fetchLyrics(track.id, track, { signal });
        signal?.throwIfAborted();
        const content = manager.generateLRCContent(lyrics, track);
        return content ? { format: 'lrc', content, embeddedText: lyrics.subtitles || lyrics.plainLyrics } : null;
    })();
    const entry = { promise, signal, expires: Date.now() + 5 * 60 * 1000 };
    cache.set(key, entry);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    try {
        const result = await promise;
        if (!result && cache.get(key) === entry) cache.delete(key);
        return result;
    } catch (error) {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
    }
}

export function recordDownloadLyrics(blob, selection, embedded, options) {
    downloads.set(blob, { selection, embedded, options });
}

/** Output entries work with ZIP, folder and sequential writers and keep the exact audio basename. */
export async function* createLyricsEntries(blob, audioName, manager, track, signal) {
    try {
        const state = downloads.get(blob);
        const options = state?.options || getDownloadLyricsOptions();
        // Legacy embedded-only LRC downloads need no extra request if tagging was skipped.
        if (!state && options.mode === 'embedded' && options.format === 'lrc') return;
        const selection = state ? state.selection : await fetchDownloadLyrics(manager, track, options, signal);
        if (!selection) return;
        const needsSidecar = options.mode !== 'embedded' || (selection.format === 'ttml' && !state?.embedded);
        if (!needsSidecar) return;
        // Defend the boundary even when a caller supplies its own lyrics manager.
        if (selection.format === 'ttml' && !getNativeTTML(selection.content)) return;
        signal?.throwIfAborted();
        yield {
            name: audioName.replace(/\.[^/.]+$/, '') + `.${selection.format}`,
            lastModified: new Date(),
            input: selection.content,
        };
    } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        console.warn('Could not download lyrics for track', track.id, error);
    }
}
