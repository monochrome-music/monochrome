//js/utils.js
import { modernSettings } from './ModernSettings.js';
import { SVG_ATMOS } from './icons.js';
import { qualityBadgeSettings, coverArtSizeSettings, trackDateSettings } from './storage.js';

export const QUALITY = 'HI_RES_LOSSLESS';

export const REPEAT_MODE = {
    OFF: 0,
    ALL: 1,
    ONE: 2,
};

export const AUDIO_QUALITIES = {
    DOLBY_ATMOS: 'DOLBY_ATMOS',
    HI_RES_LOSSLESS: 'HI_RES_LOSSLESS',
    LOSSLESS: 'LOSSLESS',
    HIGH: 'HIGH',
    LOW: 'LOW',
};

export const QUALITY_PRIORITY = ['DOLBY_ATMOS', 'HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];

export const QUALITY_TOKENS = {
    DOLBY_ATMOS: ['DOLBY_ATMOS', 'ATMOS'],
    HI_RES_LOSSLESS: [
        'HI_RES_LOSSLESS',
        'HIRES_LOSSLESS',
        'HIRESLOSSLESS',
        'HIFI_PLUS',
        'HI_RES_FLAC',
        'HI_RES',
        'HIRES',
        'MASTER',
        'MASTER_QUALITY',
        'MQA',
    ],
    LOSSLESS: ['LOSSLESS', 'HIFI'],
    HIGH: ['HIGH', 'HIGH_QUALITY'],
    LOW: ['LOW', 'LOW_QUALITY'],
};

export const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';

export const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
};

export const getTrackYearDisplay = (track) => {
    const useAlbumYear = trackDateSettings.useAlbumYear();
    const releaseDate = useAlbumYear
        ? track?.album?.releaseDate || track?.streamStartDate
        : track?.streamStartDate || track?.album?.releaseDate;
    if (!releaseDate) return '';
    const date = new Date(releaseDate);
    return isNaN(date.getTime()) ? '' : ` • ${date.getFullYear()}`;
};

export const createPlaceholder = (text, isLoading = false) => {
    return `<div class="placeholder-text ${isLoading ? 'loading' : ''}">${text}</div>`;
};

export const trackDataStore = new WeakMap();

export const sanitizeForFilename = (value) => {
    if (!value) return 'Unknown';
    return value
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Sanitizes a single path component (no slashes allowed in the output).
 * Invalid filesystem characters are replaced with underscores.
 */
export const sanitizeForPathComponent = (value) => {
    if (!value) return 'Unknown';
    return value
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Like {@link formatTemplate} but allows `/` in the template for nested
 * directory structures.  Each path component has invalid characters replaced,
 * the path is normalised to forward-slash separators, and empty components,
 * `.`, and `..` segments are stripped.
 */
export const formatPathTemplate = (template, data) => {
    let result = replaceTokens(template, {
        discNumber: String(Number(data.discNumber || 1)),
        trackNumber: data.trackNumber ? String(data.trackNumber).padStart(2, '0') : '00',
        artist: sanitizeForPathComponent(data.artist || 'Unknown Artist'),
        title: sanitizeForPathComponent(data.title || 'Unknown Title'),
        album: sanitizeForPathComponent(data.album || 'Unknown Album'),
        albumArtist: sanitizeForPathComponent(data.albumArtist || 'Unknown Artist'),
        albumTitle: sanitizeForPathComponent(data.albumTitle || 'Unknown Album'),
        year: sanitizeForPathComponent(String(data.year || 'Unknown')),
    });

    // Normalise separators, collapse duplicates, strip . and ..
    return result
        .replace(/\\/g, '/')
        .split('/')
        .map((p) => p.trim())
        .filter((p) => p !== '' && p !== '.' && p !== '..')
        .join('/');
};

/**
 * Detects audio format from DataView of first bytes
 * @param {DataView} view - DataView of first 12 bytes of audio file
 * @param {string} mimeType - MIME type from blob
 * @returns {string|null} - Format: 'flac', 'mp4', 'mp3', or null
 */
export const detectAudioFormat = (view, mimeType = '') => {
    // Check for FLAC signature: "fLaC" (0x66 0x4C 0x61 0x43)
    if (
        view.byteLength >= 4 &&
        view.getUint8(0) === 0x66 && // f
        view.getUint8(1) === 0x4c && // L
        view.getUint8(2) === 0x61 && // a
        view.getUint8(3) === 0x43 // C
    ) {
        return 'flac';
    }

    // Check for OGG signature: "OggS" (0x4F 0x67 0x67 0x53)
    if (
        view.byteLength >= 4 &&
        view.getUint8(0) === 0x4f && // O
        view.getUint8(1) === 0x67 && // g
        view.getUint8(2) === 0x67 && // g
        view.getUint8(3) === 0x53 // S
    ) {
        return 'ogg';
    }

    // Check for MP4/M4A signature: "ftyp" at offset 4
    if (
        view.byteLength >= 8 &&
        view.getUint8(4) === 0x66 && // f
        view.getUint8(5) === 0x74 && // t
        view.getUint8(6) === 0x79 && // y
        view.getUint8(7) === 0x70 // p
    ) {
        return 'mp4';
    }

    // Check for MP3 signature: ID3 tag or MPEG frame sync
    if (
        view.byteLength >= 3 &&
        view.getUint8(0) === 0x49 && // I
        view.getUint8(1) === 0x44 && // D
        view.getUint8(2) === 0x33 // 3
    ) {
        return 'mp3';
    }

    // Detect RIFF/WAVE by "RIFF" at offset 0 and "WAVE" at offset 8 (only in dev mode)
    if (
        import.meta.env.DEV &&
        view.byteLength >= 12 &&
        view.getUint8(0) === 0x52 && // R
        view.getUint8(1) === 0x49 && // I
        view.getUint8(2) === 0x46 && // F
        view.getUint8(3) === 0x46 && // F
        view.getUint8(8) === 0x57 && // W
        view.getUint8(9) === 0x41 && // A
        view.getUint8(10) === 0x56 && // V
        view.getUint8(11) === 0x45 // E
    ) {
        return 'wav';
    }

    // Check for MPEG frame sync (0xFF 0xFB or 0xFF 0xFA)
    if (view.byteLength >= 2 && view.getUint8(0) === 0xff && (view.getUint8(1) & 0xe0) === 0xe0) {
        return 'mp3';
    }

    if (
        view.byteLength >= 7 &&
        view.getUint8(0) === 0x23 &&
        view.getUint8(1) === 0x45 &&
        view.getUint8(2) === 0x58 &&
        view.getUint8(3) === 0x54 &&
        view.getUint8(4) === 0x4d &&
        view.getUint8(5) === 0x33 &&
        view.getUint8(6) === 0x55
    ) {
        return 'm3u8';
    }

    if (view.byteLength >= 188 && view.getUint8(0) === 0x47 && view.getUint8(188) === 0x47) {
        return 'ts';
    }

    // Fallback to MIME type
    if (mimeType === 'audio/flac') return 'flac';
    if (mimeType === 'audio/ogg') return 'ogg';
    if (mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') return 'mp4';
    if (mimeType === 'audio/mp3' || mimeType === 'audio/mpeg') return 'mp3';

    return null;
};

/**
 * Detects actual audio format from blob signature
 * @param {Blob} blob - Audio blob to analyze
 * @returns {Promise<string>} - Extension: 'flac', 'm4a', 'mp3', or fallback based on mime
 */
export const getExtensionFromBlob = async (blob) => {
    const buffer = await blob.slice(0, 12).arrayBuffer();
    const view = new DataView(buffer);

    const format = detectAudioFormat(view, blob.type);

    if (format === 'mp4') {
        if (blob.type.includes('video')) return 'mp4';
        return 'm4a';
    }
    if (format) return format;

    if (blob.type.includes('video')) return 'mp4';
    if (blob.type === 'audio/flac') return 'flac';
    if (blob.type === 'audio/ogg') return 'ogg';
    if (blob.type === 'audio/mp4' || blob.type === 'audio/x-m4a') return 'mp4';
    if (blob.type === 'audio/mp3' || blob.type === 'audio/mpeg') return 'mp3';

    return 'flac';
};

export const getExtensionForQuality = (quality) => {
    switch (quality) {
        case 'LOW':
        case 'HIGH':
        case 'DOLBY_ATMOS':
            return 'm4a';
        default:
            return 'flac';
    }
};

export const buildTrackFilename = (track, quality, extension = null) => {
    const template = modernSettings.filenameTemplate;
    const ext = extension || getExtensionForQuality(quality);

    const artistName = track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist';

    const data = {
        discNumber: getTrackDiscNumber(track) || 1,
        trackNumber: track.trackNumber,
        artist: artistName,
        title: getTrackTitle(track),
        album: track.album?.title,
    };

    return formatTemplate(template, data) + '.' + ext;
};

const sanitizeToken = (value) => {
    if (!value) return '';
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_');
};

export const normalizeQualityToken = (value) => {
    if (!value) return null;

    const token = sanitizeToken(value);

    for (const [quality, aliases] of Object.entries(QUALITY_TOKENS)) {
        if (aliases.includes(token)) {
            return quality;
        }
    }
    return null;
};

export const createQualityBadgeHTML = (track) => {
    if (!qualityBadgeSettings.isEnabled()) return '';

    const quality = deriveTrackQuality(track);
    if (quality === 'DOLBY_ATMOS') {
        return `<span class="quality-badge quality-atmos" title="Dolby Atmos">${SVG_ATMOS(20)}</span>`;
    } else if (quality === 'HI_RES_LOSSLESS') {
        return '<span class="quality-badge quality-hires" title="Hi-Res Lossless">HD</span>';
    }
    return '';
};

export const deriveQualityFromTags = (rawTags) => {
    if (!Array.isArray(rawTags)) return null;

    const candidates = [];
    for (const tag of rawTags) {
        if (typeof tag !== 'string') continue;
        const normalized = normalizeQualityToken(tag);
        if (normalized && !candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    }

    return pickBestQuality(candidates);
};

export const pickBestQuality = (candidates) => {
    let best = null;
    let bestRank = Infinity;

    for (const candidate of candidates) {
        if (!candidate) continue;
        const rank = QUALITY_PRIORITY.indexOf(candidate);
        const currentRank = rank === -1 ? Infinity : rank;

        if (currentRank < bestRank) {
            best = candidate;
            bestRank = currentRank;
        }
    }

    return best;
};

export const deriveTrackQuality = (track) => {
    if (!track) return null;

    const candidates = [
        deriveQualityFromTags(track.mediaMetadata?.tags),
        deriveQualityFromTags(track.album?.mediaMetadata?.tags),
        normalizeQualityToken(track.audioQuality),
    ];

    return pickBestQuality(candidates);
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const hasExplicitContent = (item) => {
    return item?.explicit === true || item?.explicitLyrics === true;
};

export const isTrackUnavailable = (track) => {
    if (!track) return true;
    if (track.isLocal) return false;
    // AllowStreaming false or StreamReady false usually mean unavailable
    // title === 'Unavailable' is also a strong indicator from the user's example
    return track.allowStreaming === false || track.streamReady === false || track.title === 'Unavailable';
};

export const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

export const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

export const decodeHtml = (html) => {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent;
};

export const getTrackTitle = (track, { fallback = 'Unknown Title' } = {}) => {
    if (!track?.title) return fallback;
    return track?.version ? `${track.title} (${track.version})` : track.title;
};

export const getTrackArtists = (track = {}, { fallback = 'Unknown Artist' } = {}) => {
    if (track?.artists?.length) {
        return track.artists.map((artist) => artist?.name).join(', ');
    }

    return fallback;
};

export const getTrackArtistsHTML = (track = {}, { fallback = 'Unknown Artist' } = {}) => {
    if (track?.artists?.length) {
        return track.artists
            .map((artist) => {
                const escapedName = escapeHtml(artist.name || 'Unknown Artist');
                const escapedId = escapeHtml(artist.id || '');
                // Check if this is a tracker/unreleased track
                const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
                if (isTracker && track.trackerInfo?.sheetId) {
                    const escapedSheetId = escapeHtml(track.trackerInfo.sheetId);
                    // For tracker tracks, link to the tracker artist page
                    return `<span class="artist-link tracker-artist-link" data-tracker-sheet-id="${escapedSheetId}">${escapedName}</span>`;
                }
                // For normal tracks, use the artist ID
                return `<span class="artist-link" data-artist-id="${escapedId}">${escapedName}</span>`;
            })
            .join(', ');
    }

    return fallback;
};

export const formatTemplate = (template, data) =>
    replaceTokens(template, {
        discNumber: String(Number(data.discNumber || 1)),
        trackNumber: data.trackNumber ? String(data.trackNumber).padStart(2, '0') : '00',
        artist: sanitizeForFilename(data.artist || 'Unknown Artist'),
        title: sanitizeForFilename(data.title || 'Unknown Title'),
        album: sanitizeForFilename(data.album || 'Unknown Album'),
        albumArtist: sanitizeForFilename(data.albumArtist || 'Unknown Artist'),
        albumTitle: sanitizeForFilename(data.albumTitle || 'Unknown Album'),
        year: data.year || 'Unknown',
    });

export const calculateTotalDuration = (tracks) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return 0;
    return tracks.reduce((total, track) => total + (track.duration || 0), 0);
};

export const formatDuration = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0 min';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours} hr ${minutes} min`;
    }
    return `${minutes} min`;
};

const coverCache = new Map();

function resizeImageBlob(blob, size) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, size, size);
            canvas.toBlob(
                (resizedBlob) => {
                    if (resizedBlob) resolve(resizedBlob);
                    else reject(new Error('Canvas toBlob failed'));
                },
                blob.type || 'image/jpeg',
                0.9
            );
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

/**
 * Fetches and caches cover art as a Blob
 * @param {Object} api - API instance with getCoverUrl method
 * @param {string} coverId - ID of the cover art to fetch
 * @returns {Promise<Blob|null>} - Cover art blob or null if not available
 */
export async function getCoverBlob(api, coverId) {
    if (!coverId) return null;

    let sizeStr = coverArtSizeSettings.getSize();

    if (sizeStr.includes('x')) {
        sizeStr = sizeStr.split('x')[0];
    }

    let requestedSize = parseInt(sizeStr, 10);
    if (isNaN(requestedSize) || requestedSize <= 0) requestedSize = 1280;

    const cacheKey = `${coverId}-${requestedSize}`;
    if (coverCache.has(cacheKey)) return coverCache.get(cacheKey);

    // Tidal seems to only support these soooo
    const supportedSizes = [80, 160, 320, 640, 1280];
    let fetchSize = 1280;

    const bestSize = supportedSizes.find((s) => s >= requestedSize);
    if (bestSize) {
        fetchSize = bestSize;
    }

    const fetchWithProxy = async (url) => {
        try {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            if (response.ok) return await response.blob();
        } catch (e) {
            console.warn('Proxy fetch failed:', e);
        }
        return null;
    };

    let blob = null;
    try {
        const url = api.getCoverUrl(coverId, fetchSize.toString());
        // Try direct fetch first
        const response = await fetch(url);
        if (response.ok) {
            blob = await response.blob();
        } else {
            // If direct fetch fails (e.g. 404 from SW due to CORS), try proxy
            blob = await fetchWithProxy(url);
        }
    } catch {
        // Network error (CORS rejection not handled by SW), try proxy
        const url = api.getCoverUrl(coverId, fetchSize.toString());
        blob = await fetchWithProxy(url);
    }

    if (blob) {
        if (fetchSize !== requestedSize) {
            try {
                blob = await resizeImageBlob(blob, requestedSize);
            } catch (e) {
                console.warn('Failed to resize cover art, using original size:', e);
            }
        }
        coverCache.set(cacheKey, blob);
        return blob;
    }
    return null;
}

/**
 * Positions a menu element relative to a point or an anchor rectangle,
 * ensuring it stays within the viewport and becomes scrollable if too tall.
 * @param {HTMLElement} menu - The menu element to position
 * @param {number} x - X coordinate (clientX)
 * @param {number} y - Y coordinate (clientY)
 * @param {DOMRect} [anchorRect] - Optional anchor element rectangle
 */
export function positionMenu(menu, x, y, anchorRect = null) {
    // Temporarily show to measure dimensions
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    menu.style.maxHeight = '';
    menu.style.overflowY = '';

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = x;
    let top = y;

    if (anchorRect) {
        // Adjust horizontal position if it overflows right
        if (left + menuWidth > windowWidth - 10) {
            left = Math.max(10, anchorRect.right - menuWidth);
        }
        // Adjust vertical position if it overflows bottom
        if (top + menuHeight > windowHeight - 10) {
            top = Math.max(10, anchorRect.top - menuHeight - 5);
        }
    } else {
        // Adjust horizontal position if it overflows right
        if (left + menuWidth > windowWidth - 10) {
            left = Math.max(10, windowWidth - menuWidth - 10);
        }
        // Adjust vertical position if it overflows bottom
        if (top + menuHeight > windowHeight - 10) {
            top = Math.max(10, y - menuHeight);
        }
    }

    // Final checks to ensure it's not off-screen at the top or left
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    // If it's still too tall for the viewport, make it scrollable
    // We measure again because max-height might be needed
    const currentMenuHeight = menu.offsetHeight;
    if (top + currentMenuHeight > windowHeight - 10) {
        menu.style.maxHeight = `${windowHeight - top - 10}px`;
        menu.style.overflowY = 'auto';
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'visible';
}

export const getShareUrl = (path) => {
    const baseUrl = window.NL_MODE ? 'https://monochrome.tf' : window.location.origin;
    const safePath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${safePath}`;
};

/**
 * Builds a full artist array by combining the track's listed artists
 * with any featured artists parsed from the title (feat./with).
 */
export function getFullArtistArray(track) {
    const knownArtists =
        Array.isArray(track.artists) && track.artists.length > 0
            ? track.artists.map((a) => (typeof a === 'string' ? a : a.name) || '').filter(Boolean)
            : track.artist?.name
              ? [track.artist.name]
              : [];

    // Parse featured artists from title, e.g. "Song (feat. A, B & C)" or "(with X & Y)"
    // Note: splitting on '&' may incorrectly fragment compound artist names like "Simon & Garfunkel".
    const featPattern = /\(\s*(?:feat\.?|ft\.?|with)\s+(.+?)\s*\)/gi;
    const allFeatArtists = [...(track.title?.matchAll(featPattern) ?? [])].flatMap((m) =>
        m[1]
            .split(/\s*[,&]\s*/)
            .map((s) => s.trim())
            .filter(Boolean)
    );
    if (allFeatArtists.length > 0) {
        const knownLower = new Set(knownArtists.map((n) => n.toLowerCase()));
        for (const feat of allFeatArtists) {
            if (!knownLower.has(feat.toLowerCase())) {
                knownArtists.push(feat);
                knownLower.add(feat.toLowerCase());
            }
        }
    }

    return knownArtists;
}

/**
 * Builds a full artist string by combining the track's listed artists
 * with any featured artists parsed from the title (feat./with).
 */
export function getFullArtistString(track) {
    const knownArtists = getFullArtistArray(track);

    return knownArtists.join('; ') || null;
}

export function fetchBlob(url) {
    return fetch(url).then((d) => d.blob());
}

export async function fetchBlobURL(url) {
    return URL.createObjectURL(await fetchBlob(url));
}

export function getMimeType(data) {
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
        return 'image/png';
    return 'image/jpeg';
}

/**
 * Retrieves the cover ID or image URL for a track
 * @param {Object} track - The track object
 * @param {Object} [track.album] - The album object associated with the track
 * @param {string} [track.album.cover] - The album cover ID or URL
 * @param {string} [track.album.coverId] - The album cover ID
 * @param {string} [track.album.image] - The album image URL
 * @param {string} [track.cover] - The track cover ID or URL
 * @param {string} [track.coverId] - The track cover ID
 * @param {string} [track.image] - The track image URL
 * @returns {string|null} The cover ID or image URL, or null if none is available
 */
export function getTrackCoverId(track) {
    return (
        track.album?.cover ||
        track.cover ||
        track.image ||
        track.album?.coverId ||
        track.coverId ||
        track.album?.image ||
        null
    );
}

/**
 * Converts a value to a positive integer.
 * @param {*} value - The value to convert to a positive integer.
 * @returns {number|null} The parsed positive integer, or null if the value is not a finite positive number.
 */
export function toPositiveInt(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Extracts the disc number from a track object by checking multiple possible property names.
 * @param {Object} track - The track object to extract the disc number from.
 * @returns {number|null} The disc number as a positive integer, or null if no valid disc number is found.
 */
export function getTrackDiscNumber(track) {
    const candidates = [
        track?.volumeNumber,
        track?.discNumber,
        track?.mediaNumber,
        track?.media_number,
        track?.volume,
        track?.disc,
        track?.volume?.number,
        track?.disc?.number,
        track?.media?.number,
        track?.disc,
        track?.disc_no,
        track?.discNo,
        track?.disc_number,
        track?.mediaMetadata?.discNumber,
    ];

    for (const candidate of candidates) {
        const parsed = toPositiveInt(candidate);
        if (parsed) return parsed;
    }
    return null;
}

/**
 * Executes a function with a fallback error handler.
 * Works with both synchronous and asynchronous callbacks.
 *
 * If the callback returns a Promise, the result will also be a Promise.
 *
 * @template T
 * @param {() => T | Promise<T>} fn Function to execute
 * @param {(error: unknown) => T | Promise<T>} onError Error handler
 * @returns {T | Promise<T>}
 */
export function tryCatch(fn, onError) {
    try {
        const result = fn();

        if (result instanceof Promise) {
            return result.catch(onError);
        }

        return result;
    } catch (err) {
        return onError(err);
    }
}

/**
 * Replace `{token}` placeholders in a template string.
 *
 * Replacement values are inserted verbatim and are NOT reprocessed,
 * preventing cascading replacements if values contain token patterns.
 *
 * @param {string} template The input string containing tokens like `{tokenName}`
 * @param {Record<string, string>} tokens An object of tokens to replace and the replacement values.
 * @returns {string} The string with valid tokens replaced
 */
export function replaceTokens(template, tokens) {
    return template.replace(/{([^{}]+)}/g, (match, key) => {
        return key in tokens ? tokens[key] : match;
    });
}

export function createModal({ title, content, className = '', onClose }) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.style.zIndex = '10000';

    modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content ${className}" style="display: flex; flex-direction: column;">
            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
                <h3 style="margin: 0;">${title}</h3>
                <button class="btn-close" style="background: none; border: none; font-size: 2rem; cursor: pointer; color: var(--foreground); padding: 0.2rem 0.5rem; line-height: 1;">&times;</button>
            </div>
            <div class="modal-body" style="max-height: 70vh; overflow-y: auto; padding-right: 0.5rem;"></div>
        </div>
    `;

    const body = modal.querySelector('.modal-body');
    if (typeof content === 'string') {
        body.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        body.appendChild(content);
    }

    document.body.appendChild(modal);

    const close = () => {
        modal.remove();
        if (onClose) onClose();
    };

    modal.querySelector('.modal-overlay').onclick = close;
    modal.querySelector('.btn-close').onclick = close;

    return { modal, close };
}
