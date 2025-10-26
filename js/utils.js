// utils.js

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

export const SVG_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
export const SVG_PAUSE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
export const SVG_VOLUME = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
export const SVG_MUTE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';

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
    
    const data = {
        trackNumber: track.trackNumber,
        artist: track.artist?.name,
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
