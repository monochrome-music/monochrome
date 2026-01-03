//js/utils.js

export const QUALITY = 'LOSSLESS';

export const REPEAT_MODE = {
    OFF: 0,
    ALL: 1,
    ONE: 2
};

export const AUDIO_QUALITIES = {
    HI_RES_LOSSLESS: 'HI_RES_LOSSLESS',
    LOSSLESS: 'LOSSLESS',
    HIGH: 'HIGH',
    LOW: 'LOW'
};

export const QUALITY_PRIORITY = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];

export const QUALITY_TOKENS = {
    HI_RES_LOSSLESS: ['HI_RES_LOSSLESS', 'HIRES_LOSSLESS', 'HIRESLOSSLESS', 'HIFI_PLUS', 'HI_RES_FLAC', 'HI_RES', 'HIRES', 'MASTER', 'MASTER_QUALITY', 'MQA'],
    LOSSLESS: ['LOSSLESS', 'HIFI'],
    HIGH: ['HIGH', 'HIGH_QUALITY'],
    LOW: ['LOW', 'LOW_QUALITY']
};

export const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';

export const SVG_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 3 21 12 7 21 7 3"></polygon></svg>';
export const SVG_PAUSE = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
export const SVG_VOLUME = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
export const SVG_MUTE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
export const SVG_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
export const SVG_MENU = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';
export const SVG_HEART = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="heart-icon"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
export const SVG_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
export const SVG_BIN = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
export const SVG_MIX = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

export const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
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

export const getExtensionForQuality = (quality) => {
    switch (quality) {
        case 'LOW':
        case 'HIGH':
            return 'm4a';
        default:
            return 'flac';
    }
};

export const buildTrackFilename = (track, quality) => {
    const template = localStorage.getItem('filename-template') || '{trackNumber} - {artist} - {title}';
    const extension = getExtensionForQuality(quality);

    const artistName = track.artist?.name || track.artists?.[0]?.name || 'Unknown Artist';

    const data = {
        trackNumber: track.trackNumber,
        artist: artistName,
        title: getTrackTitle(track),
        album: track.album?.title
    };

    return formatTemplate(template, data) + '.' + extension;
};

const sanitizeToken = (value) => {
    if (!value) return '';
    return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
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
        normalizeQualityToken(track.audioQuality)
    ];

    return pickBestQuality(candidates);
};

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const hasExplicitContent = (item) => {
    return item?.explicit === true || item?.explicitLyrics === true;
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

export const getTrackTitle = (track, { fallback = 'Unknown Title' } = {}) => {
    if (!track?.title) return fallback;
    return track?.version ? `${track.title} (${track.version})` : track.title;
};

export const getTrackArtists = (track = {}, { fallback = 'Unknown Artist' } = {}) => {
    if (track?.artists?.length) {
        return track.artists.map(artist => artist?.name).join(', ');
    }

    return fallback;
};

export const getTrackArtistsHTML = (track = {}, { fallback = 'Unknown Artist' } = {}) => {
    if (track?.artists?.length) {
        return track.artists.map(artist => 
            `<span class="artist-link" data-artist-id="${artist.id}">${artist.name}</span>`
        ).join(', ');
    }

    return fallback;
};

export const formatTemplate = (template, data) => {
    let result = template;
    result = result.replace(/\{trackNumber\}/g, data.trackNumber ? String(data.trackNumber).padStart(2, '0') : '00');
    result = result.replace(/\{artist\}/g, sanitizeForFilename(data.artist || 'Unknown Artist'));
    result = result.replace(/\{title\}/g, sanitizeForFilename(data.title || 'Unknown Title'));
    result = result.replace(/\{album\}/g, sanitizeForFilename(data.album || 'Unknown Album'));
    result = result.replace(/\{albumArtist\}/g, sanitizeForFilename(data.albumArtist || 'Unknown Artist'));
    result = result.replace(/\{albumTitle\}/g, sanitizeForFilename(data.albumTitle || 'Unknown Album'));
    result = result.replace(/\{year\}/g, data.year || 'Unknown');
    return result;
};

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

/**
 * Fetches and caches cover art as a Blob
 */
export async function getCoverBlob(api, coverId) {
    if (!coverId) return null;
    if (coverCache.has(coverId)) return coverCache.get(coverId);

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

    try {
        const url = api.getCoverUrl(coverId, '1280');
        // Try direct fetch first
        const response = await fetch(url);
        if (response.ok) {
            const blob = await response.blob();
            coverCache.set(coverId, blob);
            return blob;
        } else {
            // If direct fetch fails (e.g. 404 from SW due to CORS), try proxy
            const blob = await fetchWithProxy(url);
            if (blob) {
                coverCache.set(coverId, blob);
                return blob;
            }
        }
    } catch (e) {
        // Network error (CORS rejection not handled by SW), try proxy
        const url = api.getCoverUrl(coverId, '1280');
        const blob = await fetchWithProxy(url);
        if (blob) {
            coverCache.set(coverId, blob);
            return blob;
        }
    }
    return null;
}

