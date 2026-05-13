import { sanitizeForFilename } from './utils.js';

/**
 * Generates M3U playlist content
 * @param {Object} playlist - Playlist metadata (title, artist, etc.)
 * @param {Array} tracks - Array of track objects
 * @param {boolean} _useRelativePaths - Unused; kept for API compatibility
 * @param {Function|null} pathResolver - Optional resolver for per-track relative path (used when trackPaths is null)
 * @param {string} audioExtension - Audio file extension for generated paths (used when trackPaths is null)
 * @param {Array|null} trackPaths - Actual per-track resolved paths; when provided, overrides pathResolver/audioExtension
 * @returns {string} M3U content
 */
export function generateM3U(
    playlist,
    tracks,
    _useRelativePaths = true,
    pathResolver = null,
    audioExtension = 'flac',
    trackPaths = null
) {
    let content = '#EXTM3U\n';

    if (playlist.title) {
        content += `#PLAYLIST:${sanitizeForFilename(playlist.title)}\n`;
    }

    if (playlist.artist) {
        content += `#ARTIST:${playlist.artist?.name || playlist.artist}\n`;
    }

    const date = new Date().toISOString().split('T')[0];
    content += `#DATE:${date}\n\n`;

    tracks.forEach((track, index) => {
        const resolvedPath = trackPaths ? trackPaths[index] : null;
        if (trackPaths && !resolvedPath) return;

        const duration = Math.round(track.duration || 0);
        const artists = getTrackArtists(track);
        const title = track.title || 'Unknown Title';
        const displayName = `${artists} - ${title}`;

        content += `#EXTINF:${duration},${displayName}\n`;

        const path =
            resolvedPath ??
            (() => {
                const filename = getTrackFilename(track, index + 1, audioExtension);
                return typeof pathResolver === 'function' ? pathResolver(track, filename, index) : filename;
            })();

        content += `${path}\n\n`;
    });

    return content;
}

/**
 * Generates M3U8 playlist content (UTF-8 extended)
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @param {boolean} _useRelativePaths - Unused; kept for API compatibility
 * @param {Function|null} pathResolver - Optional resolver for per-track relative path (used when trackPaths is null)
 * @param {string} audioExtension - Audio file extension for generated paths (used when trackPaths is null)
 * @param {Array|null} trackPaths - Actual per-track resolved paths; when provided, overrides pathResolver/audioExtension
 * @returns {string} M3U8 content
 */
export function generateM3U8(
    playlist,
    tracks,
    _useRelativePaths = true,
    pathResolver = null,
    audioExtension = 'flac',
    trackPaths = null
) {
    let content = '#EXTM3U\n';
    content += '#EXT-X-VERSION:3\n';
    content += '#EXT-X-PLAYLIST-TYPE:VOD\n';

    const maxDuration = Math.max(...tracks.map((track) => Math.round(track.duration || 0)));
    content += `#EXT-X-TARGETDURATION:${maxDuration}\n`;

    if (playlist.title) {
        content += `#PLAYLIST:${sanitizeForFilename(playlist.title)}\n`;
    }

    if (playlist.artist) {
        content += `#ARTIST:${playlist.artist?.name || playlist.artist}\n`;
    }

    const date = new Date().toISOString().split('T')[0];
    content += `#DATE:${date}\n\n`;

    tracks.forEach((track, index) => {
        const resolvedPath = trackPaths ? trackPaths[index] : null;
        if (trackPaths && !resolvedPath) return;

        const duration = Math.round(track.duration || 0);
        const artists = getTrackArtists(track);
        const title = track.title || 'Unknown Title';
        const displayName = `${artists} - ${title}`;

        content += `#EXTINF:${duration}.000,${displayName}\n`;

        const path =
            resolvedPath ??
            (() => {
                const filename = getTrackFilename(track, index + 1, audioExtension);
                return typeof pathResolver === 'function' ? pathResolver(track, filename, index) : filename;
            })();

        content += `${path}\n\n`;
    });

    content += '#EXT-X-ENDLIST\n';
    return content;
}

/**
 * Generates CUE sheet content for albums
 * @param {Object} album - Album metadata
 * @param {Array} tracks - Array of track objects
 * @param {string} _audioFilenameBase - Unused; kept for API compatibility
 * @param {Array|null} trackPaths - Actual per-track resolved paths; when provided, each track gets its own FILE entry
 * @param {string} audioExtension - Audio file extension for generated paths (used when trackPaths is null)
 * @returns {string} CUE content
 */
export function generateCUE(album, tracks, _audioFilenameBase, trackPaths = null, audioExtension = 'flac') {
    const performer = album.artist?.name || album.artist || 'Unknown Artist';
    const title = album.title || 'Unknown Album';

    let content = `PERFORMER "${performer}"\n`;
    content += `TITLE "${title}"\n`;

    tracks.forEach((track, index) => {
        const resolvedPath = trackPaths ? trackPaths[index] : null;
        if (trackPaths && !resolvedPath) return;

        const trackNumber = String(track.trackNumber || index + 1).padStart(2, '0');
        const trackTitle = track.title || 'Unknown Track';
        const trackPerformer = track.artist?.name || getTrackArtists(track) || performer;

        const path =
            resolvedPath ??
            (() => {
                const filename = getTrackFilename(track, index + 1, audioExtension);
                return filename;
            })();

        const fileExtension = path.split('.').pop().toUpperCase();
        content += `FILE "${path}" ${fileExtension}\n`;
        content += `  TRACK ${trackNumber} AUDIO\n`;
        content += `    TITLE "${trackTitle}"\n`;
        content += `    PERFORMER "${trackPerformer}"\n`;
        content += `    INDEX 01 00:00:00\n`;
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

export function generateFullCSV(_playlist, tracks) {
    const headers = [
        'Position',
        'Track Name',
        'Artist Name(s)',
        'Album',
        'Album Artist',
        'Track Number',
        'Duration (seconds)',
        'Duration',
        'ISRC',
        'Release Date',
        'Explicit',
        'Copyright',
        'Track ID',
        'Album ID',
        'Version',
        'Added At',
    ];

    const lines = [headers.map(csvEscape).join(',')];

    tracks.forEach((track, index) => {
        const row = [
            String(index + 1),
            track.title || '',
            getTrackArtists(track),
            track.album?.title || '',
            track.album?.artist?.name || '',
            track.trackNumber != null ? String(track.trackNumber) : '',
            track.duration != null ? String(Math.round(track.duration)) : '',
            track.duration != null ? formatDurationMMSS(track.duration) : '',
            track.isrc || '',
            track.album?.releaseDate || track.streamStartDate || '',
            track.explicit ? 'true' : 'false',
            track.copyright || '',
            track.id != null ? String(track.id) : '',
            track.album?.id != null ? String(track.album.id) : '',
            track.version || '',
            track.addedAt ? new Date(track.addedAt).toISOString() : '',
        ];
        lines.push(row.map(csvEscape).join(','));
    });

    return lines.join('\n') + '\n';
}

export function generateFullJSON(playlist, tracks) {
    const data = {
        format: 'monochrome-playlist-full',
        version: '1.0',
        type: 'playlist',
        generated: new Date().toISOString(),
        playlist: {
            id: playlist.id || playlist.uuid || null,
            name: playlist.name || playlist.title || null,
            description: playlist.description || null,
            cover: playlist.cover || null,
            isPublic: !!playlist.isPublic,
            createdAt: playlist.createdAt
                ? typeof playlist.createdAt === 'number'
                    ? new Date(playlist.createdAt).toISOString()
                    : playlist.createdAt
                : null,
            updatedAt: playlist.updatedAt
                ? typeof playlist.updatedAt === 'number'
                    ? new Date(playlist.updatedAt).toISOString()
                    : playlist.updatedAt
                : null,
            numberOfTracks: tracks.length,
        },
        tracks: tracks.map((track, index) => ({
            position: index + 1,
            id: track.id || null,
            title: track.title || null,
            artist: getTrackArtists(track),
            artists: track.artists?.map((a) => ({ id: a.id || null, name: a.name || null })) || [],
            album: track.album
                ? {
                      id: track.album.id || null,
                      title: track.album.title || null,
                      artist: track.album.artist?.name || null,
                      releaseDate: track.album.releaseDate || null,
                      cover: track.album.cover || null,
                      numberOfTracks: track.album.numberOfTracks || null,
                  }
                : null,
            trackNumber: track.trackNumber || null,
            duration: track.duration != null ? Math.round(track.duration) : null,
            isrc: track.isrc || null,
            explicit: !!track.explicit,
            copyright: track.copyright || null,
            version: track.version || null,
            streamStartDate: track.streamStartDate || null,
            addedAt: track.addedAt
                ? typeof track.addedAt === 'number'
                    ? new Date(track.addedAt).toISOString()
                    : track.addedAt
                : null,
        })),
    };

    return JSON.stringify(data, null, 2);
}

function csvEscape(value) {
    const str = value == null ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function formatDurationMMSS(seconds) {
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
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
