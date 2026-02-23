import { sanitizeForFilename } from './utils.js';

/**
 * Generates M3U playlist content
 * @param {Object} playlist - Playlist metadata (title, artist, etc.)
 * @param {Array} tracks - Array of track objects
 * @param {boolean} useRelativePaths - Whether to use relative paths
 * @param {Function|null} pathResolver - Optional resolver for per-track relative path
 * @param {string} audioExtension - Audio file extension used in generated paths
 * @returns {string} M3U content
 */
export function generateM3U(playlist, tracks, useRelativePaths = true, pathResolver = null, audioExtension = 'flac') {
    let content = '#EXTM3U\n';

    if (playlist.title) {
        content += `#PLAYLIST:${sanitizeForFilename(playlist.title)}\n`;
    }

    if (playlist.artist) {
        content += `#ARTIST:${playlist.artist}\n`;
    }

    const date = new Date().toISOString().split('T')[0];
    content += `#DATE:${date}\n\n`;

    tracks.forEach((track, index) => {
        const duration = Math.round(track.duration || 0);
        const artists = getTrackArtists(track);
        const title = track.title || 'Unknown Title';
        const displayName = `${artists} - ${title}`;

        content += `#EXTINF:${duration},${displayName}\n`;

        const filename = getTrackFilename(track, index + 1, audioExtension);
        const relativePath = typeof pathResolver === 'function' ? pathResolver(track, filename, index) : filename;
        const path = useRelativePaths ? relativePath : relativePath;

        content += `${path}\n\n`;
    });

    return content;
}

/**
 * Generates M3U8 playlist content (UTF-8 extended)
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @param {boolean} useRelativePaths - Whether to use relative paths
 * @param {Function|null} pathResolver - Optional resolver for per-track relative path
 * @param {string} audioExtension - Audio file extension used in generated paths
 * @returns {string} M3U8 content
 */
export function generateM3U8(playlist, tracks, useRelativePaths = true, pathResolver = null, audioExtension = 'flac') {
    let content = '#EXTM3U\n';
    content += '#EXT-X-VERSION:3\n';
    content += '#EXT-X-PLAYLIST-TYPE:VOD\n';

    const maxDuration = Math.max(...tracks.map((track) => Math.round(track.duration || 0)));
    content += `#EXT-X-TARGETDURATION:${maxDuration}\n`;

    if (playlist.title) {
        content += `#PLAYLIST:${sanitizeForFilename(playlist.title)}\n`;
    }

    if (playlist.artist) {
        content += `#ARTIST:${playlist.artist}\n`;
    }

    const date = new Date().toISOString().split('T')[0];
    content += `#DATE:${date}\n\n`;

    tracks.forEach((track, index) => {
        const duration = Math.round(track.duration || 0);
        const artists = getTrackArtists(track);
        const title = track.title || 'Unknown Title';
        const displayName = `${artists} - ${title}`;

        content += `#EXTINF:${duration}.000,${displayName}\n`;

        const filename = getTrackFilename(track, index + 1, audioExtension);
        const relativePath = typeof pathResolver === 'function' ? pathResolver(track, filename, index) : filename;
        const path = useRelativePaths ? relativePath : relativePath;

        content += `${path}\n\n`;
    });

    content += '#EXT-X-ENDLIST\n';
    return content;
}

/**
 * Generates CUE sheet content for albums
 * @param {Object} album - Album metadata
 * @param {Array} tracks - Array of track objects
 * @param {string} audioFilename - The main audio file name
 * @returns {string} CUE content
 */
export function generateCUE(album, tracks, audioFilename) {
    const performer = album.artist?.name || album.artist || 'Unknown Artist';
    const title = album.title || 'Unknown Album';

    let content = `PERFORMER "${performer}"\n`;
    content += `TITLE "${title}"\n`;

    // Add file reference
    const fileExtension = audioFilename.split('.').pop().toUpperCase();
    content += `FILE "${audioFilename}" ${fileExtension}\n`;

    let currentTime = 0;

    tracks.forEach((track, index) => {
        const trackNumber = String(track.trackNumber || index + 1).padStart(2, '0');
        const trackTitle = track.title || 'Unknown Track';
        const trackPerformer = track.artist?.name || getTrackArtists(track) || performer;
        const duration = track.duration || 0;

        content += `  TRACK ${trackNumber} AUDIO\n`;
        content += `    TITLE "${trackTitle}"\n`;
        content += `    PERFORMER "${trackPerformer}"\n`;

        // Calculate time in MM:SS:FF format (Frames = 75 per second)
        const minutes = Math.floor(currentTime / 60);
        const seconds = Math.floor(currentTime % 60);
        const frames = Math.floor((currentTime % 1) * 75);

        content += `    INDEX 01 ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}\n`;

        currentTime += duration;
    });

    return content;
}

/**
 * Generates NFO file content for Kodi/media center compatibility
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @param {string} type - 'playlist' or 'album'
 * @returns {string} NFO XML content
 */
export function generateNFO(playlist, tracks, type = 'playlist') {
    const date = new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

    if (type === 'album') {
        xml += '<album>\n';
        xml += `  <title>${escapeXml(playlist.title || 'Unknown Album')}</title>\n`;
        xml += `  <artist>${escapeXml(playlist.artist?.name || playlist.artist || 'Unknown Artist')}</artist>\n`;

        if (playlist.releaseDate) {
            xml += `  <year>${new Date(playlist.releaseDate).getFullYear()}</year>\n`;
        }

        xml += `  <musicbrainzalbumid>${playlist.id || ''}</musicbrainzalbumid>\n`;
        xml += `  <dateadded>${date}</dateadded>\n`;

        tracks.forEach((track, index) => {
            xml += '  <track>\n';
            xml += `    <position>${index + 1}</position>\n`;
            xml += `    <title>${escapeXml(track.title || '')}</title>\n`;
            xml += `    <artist>${escapeXml(getTrackArtists(track) || '')}</artist>\n`;
            xml += `    <duration>${Math.round(track.duration || 0)}</duration>\n`;

            if (track.trackNumber) {
                xml += `    <track>${track.trackNumber}</track>\n`;
            }

            xml += `    <musicbrainztrackid>${track.id || ''}</musicbrainztrackid>\n`;
            xml += '  </track>\n';
        });

        xml += '</album>\n';
    } else {
        xml += '<musicplaylist>\n';
        xml += `  <title>${escapeXml(playlist.title || 'Unknown Playlist')}</title>\n`;
        xml += `  <artist>${escapeXml(playlist.artist || 'Various Artists')}</artist>\n`;
        xml += `  <dateadded>${date}</dateadded>\n`;

        tracks.forEach((track, index) => {
            xml += '  <track>\n';
            xml += `    <position>${index + 1}</position>\n`;
            xml += `    <title>${escapeXml(track.title || '')}</title>\n`;
            xml += `    <artist>${escapeXml(getTrackArtists(track) || '')}</artist>\n`;
            xml += `    <album>${escapeXml(track.album?.title || '')}</album>\n`;
            xml += `    <duration>${Math.round(track.duration || 0)}</duration>\n`;
            xml += `    <musicbrainztrackid>${track.id || ''}</musicbrainztrackid>\n`;
            xml += '  </track>\n';
        });

        xml += '</musicplaylist>\n';
    }

    return xml;
}

/**
 * Generates JSON playlist with rich metadata
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @param {string} type - 'playlist' or 'album'
 * @returns {string} JSON content
 */
export function generateJSON(playlist, tracks, type = 'playlist') {
    const data = {
        format: 'monochrome-playlist',
        version: '1.0',
        type: type,
        generated: new Date().toISOString(),
        playlist: {
            title: playlist.title || 'Unknown',
            artist: playlist.artist || 'Various Artists',
            id: playlist.id || playlist.uuid || null,
        },
        tracks: tracks.map((track, index) => ({
            position: index + 1,
            id: track.id || null,
            title: track.title || 'Unknown Title',
            artist: getTrackArtists(track) || 'Unknown Artist',
            album: track.album?.title || null,
            albumArtist: track.album?.artist?.name || null,
            trackNumber: track.trackNumber || null,
            duration: Math.round(track.duration || 0),
            isrc: track.isrc || null,
            releaseDate: track.album?.releaseDate || null,
        })),
    };

    if (type === 'album') {
        data.playlist.releaseDate = playlist.releaseDate || null;
        data.playlist.numberOfTracks = tracks.length;
        data.playlist.cover = playlist.cover || null;
    }

    return JSON.stringify(data, null, 2);
}

/**
 * Helper function to get track artists string
 */
function getTrackArtists(track) {
    if (track.artists && track.artists.length > 0) {
        return track.artists.map((artist) => artist.name).join(', ');
    }
    return track.artist?.name || 'Unknown Artist';
}

/**
 * Helper function to get track filename
 */
function getTrackFilename(track, trackNumber = 1, audioExtension = 'flac') {
    const paddedNumber = String(trackNumber).padStart(2, '0');
    const artists = getTrackArtists(track);
    const title = track.title || 'Unknown Title';

    const sanitizedArtists = sanitizeForFilename(artists);
    const sanitizedTitle = sanitizeForFilename(title);

    return `${paddedNumber} - ${sanitizedArtists} - ${sanitizedTitle}.${audioExtension}`;
}

/**
 * Helper function to escape XML special characters
 */
function escapeXml(text) {
    if (!text) return '';
    return text
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
