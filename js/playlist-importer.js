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
 * Generates CSV playlist export
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @returns {string} CSV content
 */
export function generateCSV(playlist, tracks) {
    const headers = ['Track Name', 'Artist Name(s)', 'Album', 'Duration'];
    let content = headers.map((h) => `"${h}"`).join(',') + '\n';

    tracks.forEach((track) => {
        const title = (track.title || '').replace(/"/g, '""');
        const artist = getTrackArtists(track).replace(/"/g, '""');
        const album = (track.album?.title || '').replace(/"/g, '""');
        const duration = formatDuration(track.duration || 0);

        content += `"${title}","${artist}","${album}","${duration}"\n`;
    });

    return content;
}

/**
 * Generates XSPF (XML Shareable Playlist Format) export
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @returns {string} XSPF XML content
 */
export function generateXSPF(playlist, tracks) {
    const date = new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<playlist xmlns="http://xspf.org/ns/0/" version="1">\n';
    xml += `  <title>${escapeXml(playlist.title || 'Unknown Playlist')}</title>\n`;
    xml += `  <creator>${escapeXml(playlist.artist || 'Various Artists')}</creator>\n`;
    xml += `  <date>${date}</date>\n`;
    xml += '  <trackList>\n';

    tracks.forEach((track) => {
        xml += '    <track>\n';
        xml += `      <title>${escapeXml(track.title || 'Unknown Title')}</title>\n`;
        xml += `      <creator>${escapeXml(getTrackArtists(track))}</creator>\n`;
        if (track.album?.title) {
            xml += `      <album>${escapeXml(track.album.title)}</album>\n`;
        }
        if (track.duration) {
            xml += `      <duration>${Math.round(track.duration * 1000)}</duration>\n`;
        }
        xml += '    </track>\n';
    });

    xml += '  </trackList>\n';
    xml += '</playlist>\n';

    return xml;
}

/**
 * Generates generic XML playlist export
 * @param {Object} playlist - Playlist metadata
 * @param {Array} tracks - Array of track objects
 * @returns {string} XML content
 */
export function generateXML(playlist, tracks) {
    const date = new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<playlist>\n';
    xml += `  <name>${escapeXml(playlist.title || 'Unknown Playlist')}</name>\n`;
    xml += `  <creator>${escapeXml(playlist.artist || 'Various Artists')}</creator>\n`;
    xml += `  <created>${date}</created>\n`;
    xml += `  <trackCount>${tracks.length}</trackCount>\n`;
    xml += '  <tracks>\n';

    tracks.forEach((track, index) => {
        xml += '    <track>\n';
        xml += `      <position>${index + 1}</position>\n`;
        xml += `      <title>${escapeXml(track.title || '')}</title>\n`;
        xml += `      <artist>${escapeXml(getTrackArtists(track) || '')}</artist>\n`;
        xml += `      <album>${escapeXml(track.album?.title || '')}</album>\n`;
        xml += `      <duration>${Math.round(track.duration || 0)}</duration>\n`;
        xml += '    </track>\n';
    });

    xml += '  </tracks>\n';
    xml += '</playlist>\n';

    return xml;
}

/**
 * Parses CSV playlist format
 * @param {string} csvText - CSV content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
const HEADER_MAPPINGS = {
    track: ['track name', 'title', 'song', 'name', 'track', 'track title'],
    artist: ['artist name(s)', 'artist name', 'artist', 'artists', 'creator', 'artist names'],
    album: ['album', 'album name'],
    type: ['type', 'category', 'kind'],
    isrc: ['isrc', 'isrc code'],
    spotifyId: ['spotify - id', 'spotify id', 'spotify_id', 'spotifyid'],
    playlistName: ['playlist name', 'playlist', 'playlist title'],
    duration: ['duration', 'length', 'time'],
};

function normalizeHeader(header) {
    return header
        .toLowerCase()
        .trim()
        .replace(/[_\s]+/g, ' ');
}

function mapHeaders(rawHeaders) {
    const mapped = {};
    rawHeaders.forEach((header, index) => {
        const normalized = normalizeHeader(header);
        for (const [key, aliases] of Object.entries(HEADER_MAPPINGS)) {
            if (aliases.includes(normalized)) {
                mapped[key] = index;
                break;
            }
        }
    });
    return mapped;
}

function detectCSVFormat(mappedHeaders) {
    const hasType = mappedHeaders.type !== undefined;
    const hasTrack = mappedHeaders.track !== undefined;
    const hasArtist = mappedHeaders.artist !== undefined;
    const hasAlbum = mappedHeaders.album !== undefined;

    if (hasTrack && hasArtist) {
        return {
            format: 'library',
            hasMultipleTypes: hasType,
            supportsTracks: true,
            supportsAlbums: hasAlbum,
            supportsArtists: hasArtist && !hasTrack,
        };
    }

    if (hasArtist && !hasTrack) {
        return {
            format: 'artists',
            hasMultipleTypes: false,
            supportsTracks: false,
            supportsAlbums: false,
            supportsArtists: true,
        };
    }

    return {
        format: 'playlist',
        hasMultipleTypes: false,
        supportsTracks: true,
        supportsAlbums: false,
        supportsArtists: false,
    };
}

export async function parseDynamicCSV(csvText, api, onProgress) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
        return {
            format: 'unknown',
            tracks: [],
            albums: [],
            artists: [],
            missingItems: [],
            playlists: {},
        };
    }

    const parseLine = (text) => {
        const values = [];
        let current = '';
        let inQuote = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === ',' && !inQuote) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values.map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    };

    const rawHeaders = parseLine(lines[0]);
    const mappedHeaders = mapHeaders(rawHeaders);
    const formatInfo = detectCSVFormat(mappedHeaders);
    const rows = lines.slice(1);

    const tracks = [];
    const albums = [];
    const artists = [];
    const missingItems = [];
    const playlists = {};
    const totalItems = rows.length;

    const getItemType = (values) => {
        if (mappedHeaders.type !== undefined) {
            const typeValue = values[mappedHeaders.type]?.toLowerCase().trim();
            if (typeValue === 'album' || typeValue === 'favorite album') return 'album';
            if (typeValue === 'artist' || typeValue === 'favorite artist') return 'artist';
            if (typeValue === 'track' || typeValue === 'favorite' || typeValue === 'favorite track') return 'track';
        }

        const hasTrackName = mappedHeaders.track !== undefined && values[mappedHeaders.track];
        const hasArtistName = mappedHeaders.artist !== undefined && values[mappedHeaders.artist];
        const hasAlbumName = mappedHeaders.album !== undefined && values[mappedHeaders.album];

        if (hasTrackName && hasArtistName) return 'track';
        if (hasAlbumName && hasArtistName && !hasTrackName) return 'album';
        if (hasArtistName && !hasTrackName && !hasAlbumName) return 'artist';

        return 'track';
    };

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.trim()) continue;

        const values = parseLine(row);
        const itemType = getItemType(values);

        const trackName = mappedHeaders.track !== undefined ? values[mappedHeaders.track] : '';
        const artistName = mappedHeaders.artist !== undefined ? values[mappedHeaders.artist] : '';
        const albumName = mappedHeaders.album !== undefined ? values[mappedHeaders.album] : '';
        const isrc = mappedHeaders.isrc !== undefined ? values[mappedHeaders.isrc] : '';
        const playlistName = mappedHeaders.playlistName !== undefined ? values[mappedHeaders.playlistName] : '';

        if (onProgress) {
            onProgress({
                current: i,
                total: totalItems,
                currentItem: trackName || artistName || albumName || 'Unknown item',
                type: itemType,
            });
        }

        await new Promise((resolve) => setTimeout(resolve, 300));

        try {
            if (itemType === 'track') {
                let foundTrack = null;

                if (isrc) {
                    const searchResult = await api.searchTracks(`isrc:${isrc}`);
                    if (searchResult.items && searchResult.items.length > 0) {
                        foundTrack = searchResult.items.find((t) => t.isrc === isrc) || searchResult.items[0];
                    }
                }

                if (!foundTrack && trackName && artistName) {
                    const searchQuery = `"${trackName}" ${artistName}`.trim();
                    const searchResult = await api.searchTracks(searchQuery);
                    if (searchResult.items && searchResult.items.length > 0) {
                        foundTrack = searchResult.items[0];
                    }
                }

                if (foundTrack) {
                    tracks.push(foundTrack);
                    if (playlistName) {
                        if (!playlists[playlistName]) {
                            playlists[playlistName] = [];
                        }
                        playlists[playlistName].push(foundTrack);
                    }
                } else {
                    missingItems.push({
                        type: 'track',
                        title: trackName,
                        artist: artistName,
                        album: albumName,
                        isrc: isrc,
                    });
                }
            } else if (itemType === 'album') {
                let foundAlbum = null;

                if (artistName && albumName) {
                    const searchQuery = `"${albumName}" ${artistName}`.trim();
                    const searchResult = await api.searchAlbums(searchQuery);
                    if (searchResult.items && searchResult.items.length > 0) {
                        foundAlbum = searchResult.items[0];
                    }
                }

                if (foundAlbum) {
                    albums.push(foundAlbum);
                } else {
                    missingItems.push({
                        type: 'album',
                        title: albumName,
                        artist: artistName,
                    });
                }
            } else if (itemType === 'artist') {
                let foundArtist = null;

                if (artistName) {
                    const searchResult = await api.searchArtists(artistName);
                    if (searchResult.items && searchResult.items.length > 0) {
                        foundArtist = searchResult.items[0];
                    }
                }

                if (foundArtist) {
                    artists.push(foundArtist);
                } else {
                    missingItems.push({
                        type: 'artist',
                        name: artistName,
                    });
                }
            }
        } catch {
            missingItems.push({
                type: itemType,
                title: trackName || albumName,
                artist: artistName,
            });
        }
    }

    return {
        format: formatInfo.format,
        tracks,
        albums,
        artists,
        missingItems,
        playlists,
        stats: {
            totalItems,
            tracksFound: tracks.length,
            albumsFound: albums.length,
            artistsFound: artists.length,
            missingCount: missingItems.length,
            playlistCount: Object.keys(playlists).length,
        },
    };
}

export async function importToLibrary(csvResult, db, onProgress) {
    const results = {
        tracks: { added: 0, failed: 0 },
        albums: { added: 0, failed: 0 },
        artists: { added: 0, failed: 0 },
        playlists: { created: 0, tracksAdded: 0 },
    };

    const addedTrackIds = new Set();
    const addedAlbumIds = new Set();
    const addedArtistIds = new Set();

    for (const track of csvResult.tracks) {
        if (!addedTrackIds.has(track.id)) {
            try {
                await db.toggleFavorite('track', track);
                addedTrackIds.add(track.id);
                results.tracks.added++;
            } catch {
                results.tracks.failed++;
            }
        }
        if (onProgress) onProgress({ action: 'track', item: track.title });
    }

    for (const album of csvResult.albums) {
        if (!addedAlbumIds.has(album.id)) {
            try {
                await db.toggleFavorite('album', album);
                addedAlbumIds.add(album.id);
                results.albums.added++;
            } catch {
                results.albums.failed++;
            }
        }
        if (onProgress) onProgress({ action: 'album', item: album.title });
    }

    for (const artist of csvResult.artists) {
        if (!addedArtistIds.has(artist.id)) {
            try {
                await db.toggleFavorite('artist', artist);
                addedArtistIds.add(artist.id);
                results.artists.added++;
            } catch {
                results.artists.failed++;
            }
        }
        if (onProgress) onProgress({ action: 'artist', item: artist.name });
    }

    for (const [playlistName, playlistTracks] of Object.entries(csvResult.playlists)) {
        if (playlistTracks.length > 0) {
            try {
                await db.createPlaylist(playlistName, playlistTracks);
                results.playlists.created++;
                results.playlists.tracksAdded += playlistTracks.length;
            } catch {
                console.warn(`Failed to create playlist: ${playlistName}`);
            }
        }
        if (onProgress) onProgress({ action: 'playlist', item: playlistName });
    }

    return results;
}

export async function parseCSV(csvText, api, onProgress) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return { tracks: [], missingTracks: [] };

    const parseLine = (text) => {
        const values = [];
        let current = '';
        let inQuote = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === ',' && !inQuote) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values.map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1);

    const tracks = [];
    const missingTracks = [];
    const totalTracks = rows.length;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.trim()) continue;

        const values = parseLine(row);

        if (values.length >= headers.length) {
            let trackTitle = '';
            let artistNames = '';
            let albumName = '';

            headers.forEach((header, index) => {
                const value = values[index];
                if (!value) return;

                switch (header.toLowerCase()) {
                    case 'track name':
                    case 'title':
                    case 'song':
                    case 'name':
                        trackTitle = value;
                        break;
                    case 'artist name(s)':
                    case 'artist name':
                    case 'artist':
                    case 'artists':
                    case 'creator':
                        artistNames = value;
                        break;
                    case 'album':
                    case 'album name':
                        albumName = value;
                        break;
                }
            });

            if (onProgress) {
                onProgress({
                    current: i,
                    total: totalTracks,
                    currentTrack: trackTitle || 'Unknown track',
                    currentArtist: artistNames || '',
                });
            }

            if (trackTitle && artistNames) {
                await new Promise((resolve) => setTimeout(resolve, 300));

                try {
                    const searchQuery = `"${trackTitle}" ${artistNames}`.trim();
                    const searchResult = await api.searchTracks(searchQuery);

                    if (searchResult.items && searchResult.items.length > 0) {
                        tracks.push(searchResult.items[0]);
                    } else {
                        missingTracks.push({ title: trackTitle, artist: artistNames, album: albumName });
                    }
                } catch {
                    missingTracks.push({ title: trackTitle, artist: artistNames, album: albumName });
                }
            }
        }
    }

    return { tracks, missingTracks };
}

/**
 * Parses JSPF (JSON Shareable Playlist Format)
 * @param {string} jspfText - JSPF JSON content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseJSPF(jspfText, api, onProgress) {
    try {
        const jspfData = JSON.parse(jspfText);

        if (!jspfData.playlist || !Array.isArray(jspfData.playlist.track)) {
            throw new Error('Invalid JSPF format: missing playlist or track array');
        }

        const playlist = jspfData.playlist;
        const tracks = [];
        const missingTracks = [];
        const totalTracks = playlist.track.length;

        for (let i = 0; i < playlist.track.length; i++) {
            const jspfTrack = playlist.track[i];
            const trackTitle = jspfTrack.title;
            const trackCreator = jspfTrack.creator;
            const trackAlbum = jspfTrack.album;

            if (onProgress) {
                onProgress({
                    current: i,
                    total: totalTracks,
                    currentTrack: trackTitle || 'Unknown track',
                    currentArtist: trackCreator || '',
                });
            }

            if (trackTitle && trackCreator) {
                await new Promise((resolve) => setTimeout(resolve, 300));

                try {
                    const searchQuery = `${trackTitle} ${trackCreator}`;
                    const searchResults = await api.searchTracks(searchQuery);

                    if (searchResults.items && searchResults.items.length > 0) {
                        tracks.push(searchResults.items[0]);
                    } else {
                        missingTracks.push({ title: trackTitle, artist: trackCreator, album: trackAlbum });
                    }
                } catch {
                    missingTracks.push({ title: trackTitle, artist: trackCreator, album: trackAlbum });
                }
            }
        }

        return { tracks, missingTracks };
    } catch (error) {
        throw new Error('Failed to parse JSPF: ' + error.message);
    }
}

/**
 * Parses XSPF (XML Shareable Playlist Format)
 * @param {string} xspfText - XSPF XML content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseXSPF(xspfText, api, onProgress) {
    // Validate input to prevent potential XXE attacks
    if (!xspfText || typeof xspfText !== 'string' || xspfText.length > 10 * 1024 * 1024) {
        throw new Error('Invalid XSPF content');
    }
    // Reject potential XXE payloads
    if (xspfText.includes('<!ENTITY') || xspfText.includes('<!DOCTYPE')) {
        throw new Error('XSPF content contains potentially dangerous declarations');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xspfText, 'application/xml');

    const trackList = xmlDoc.getElementsByTagName('track');
    const tracks = [];
    const missingTracks = [];
    const totalTracks = trackList.length;

    for (let i = 0; i < trackList.length; i++) {
        const trackEl = trackList[i];
        const title = trackEl.getElementsByTagName('title')[0]?.textContent || '';
        const creator = trackEl.getElementsByTagName('creator')[0]?.textContent || '';
        const album = trackEl.getElementsByTagName('album')[0]?.textContent || '';

        if (onProgress) {
            onProgress({
                current: i,
                total: totalTracks,
                currentTrack: title || 'Unknown track',
                currentArtist: creator || '',
            });
        }

        if (title && creator) {
            await new Promise((resolve) => setTimeout(resolve, 300));

            try {
                const searchQuery = `${title} ${creator}`;
                const searchResults = await api.searchTracks(searchQuery);

                if (searchResults.items && searchResults.items.length > 0) {
                    tracks.push(searchResults.items[0]);
                } else {
                    missingTracks.push({ title, artist: creator, album });
                }
            } catch {
                missingTracks.push({ title, artist: creator, album });
            }
        }
    }

    return { tracks, missingTracks };
}

/**
 * Parses generic XML playlist format
 * @param {string} xmlText - XML content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseXML(xmlText, api, onProgress) {
    // Validate input to prevent potential XXE attacks
    if (!xmlText || typeof xmlText !== 'string' || xmlText.length > 10 * 1024 * 1024) {
        throw new Error('Invalid XML content');
    }
    // Reject potential XXE payloads
    if (xmlText.includes('<!ENTITY') || xmlText.includes('<!DOCTYPE')) {
        throw new Error('XML content contains potentially dangerous declarations');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    // Try different track element names
    let trackElements = xmlDoc.getElementsByTagName('track');
    if (trackElements.length === 0) {
        trackElements = xmlDoc.getElementsByTagName('song');
    }
    if (trackElements.length === 0) {
        trackElements = xmlDoc.getElementsByTagName('item');
    }

    const tracks = [];
    const missingTracks = [];
    const totalTracks = trackElements.length;

    for (let i = 0; i < trackElements.length; i++) {
        const trackEl = trackElements[i];

        // Try different element names for title/artist
        const title =
            trackEl.getElementsByTagName('title')[0]?.textContent ||
            trackEl.getElementsByTagName('name')[0]?.textContent ||
            '';
        const artist =
            trackEl.getElementsByTagName('artist')[0]?.textContent ||
            trackEl.getElementsByTagName('creator')[0]?.textContent ||
            trackEl.getElementsByTagName('performer')[0]?.textContent ||
            '';
        const album = trackEl.getElementsByTagName('album')[0]?.textContent || '';

        if (onProgress) {
            onProgress({
                current: i,
                total: totalTracks,
                currentTrack: title || 'Unknown track',
                currentArtist: artist || '',
            });
        }

        if (title && artist) {
            await new Promise((resolve) => setTimeout(resolve, 300));

            try {
                const searchQuery = `${title} ${artist}`;
                const searchResults = await api.searchTracks(searchQuery);

                if (searchResults.items && searchResults.items.length > 0) {
                    tracks.push(searchResults.items[0]);
                } else {
                    missingTracks.push({ title, artist, album });
                }
            } catch {
                missingTracks.push({ title, artist, album });
            }
        }
    }

    return { tracks, missingTracks };
}

/**
 * Parses M3U/M3U8 playlist format
 * @param {string} m3uText - M3U content
 * @param {Function} api - API instance for searching tracks
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{tracks: Array, missingTracks: Array}>}
 */
export async function parseM3U(m3uText, api, onProgress) {
    const lines = m3uText.trim().split('\n');
    const tracks = [];
    const missingTracks = [];

    const trackInfo = [];
    let currentInfo = null;

    // Parse M3U format
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#EXTM3U')) continue;

        if (trimmed.startsWith('#EXTINF:')) {
            // Parse EXTINF line: #EXTINF:duration,Artist - Title
            const match = trimmed.match(/#EXTINF:(-?\d+)?,(.+)/);
            if (match) {
                const displayName = match[2];
                const parts = displayName.split(' - ');
                currentInfo = {
                    title: parts.length > 1 ? parts.slice(1).join(' - ') : displayName,
                    artist: parts.length > 1 ? parts[0] : '',
                };
            }
        } else if (!trimmed.startsWith('#')) {
            // This is a file path line
            if (currentInfo) {
                trackInfo.push(currentInfo);
                currentInfo = null;
            }
        }
    }

    const totalTracks = trackInfo.length;

    for (let i = 0; i < trackInfo.length; i++) {
        const info = trackInfo[i];

        if (onProgress) {
            onProgress({
                current: i,
                total: totalTracks,
                currentTrack: info.title || 'Unknown track',
                currentArtist: info.artist || '',
            });
        }

        if (info.title) {
            await new Promise((resolve) => setTimeout(resolve, 300));

            try {
                const searchQuery = info.artist ? `${info.title} ${info.artist}` : info.title;
                const searchResults = await api.searchTracks(searchQuery);

                if (searchResults.items && searchResults.items.length > 0) {
                    tracks.push(searchResults.items[0]);
                } else {
                    missingTracks.push({ title: info.title, artist: info.artist, album: '' });
                }
            } catch {
                missingTracks.push({ title: info.title, artist: info.artist, album: '' });
            }
        }
    }

    return { tracks, missingTracks };
}

/**
 * Formats duration in MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

// Export all functions
export { getTrackArtists };
