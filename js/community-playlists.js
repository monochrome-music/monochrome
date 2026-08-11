const PANORA_INSTANCES = ['https://panora-api-us.dyamuh.dev', 'https://panora-api-de.dyamuh.dev'];

const REQUEST_TIMEOUT_MS = 5000;
const MAX_CACHE_ENTRIES = 50;

async function getPanora(path, signal) {
    const requests = PANORA_INSTANCES.map(async (base) => {
        const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        const response = await fetch(`${base}${path}`, { signal: combinedSignal });

        if (!response.ok) {
            throw new Error(`${response.status}`);
        }

        return response;
    });

    return Promise.any(requests);
}

const COMMUNITY_PLAYLIST_CACHE_KEY = 'community-playlist-cache';

function getCommunityPlaylistCache() {
    try {
        return JSON.parse(localStorage.getItem(COMMUNITY_PLAYLIST_CACHE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveCommunityPlaylist(playlist) {
    try {
        const cache = getCommunityPlaylistCache();

        delete cache[playlist.uuid];
        cache[playlist.uuid] = playlist;

        const keys = Object.keys(cache);
        if (keys.length > MAX_CACHE_ENTRIES) {
            const keysToRemove = keys.slice(0, keys.length - MAX_CACHE_ENTRIES);
            for (const key of keysToRemove) {
                delete cache[key];
            }
        }

        localStorage.setItem(COMMUNITY_PLAYLIST_CACHE_KEY, JSON.stringify(cache));
    } catch {}
}

export async function searchCommunityPlaylists(query, signal) {
    const response = await getPanora(`/playlists/?source=ytm&query=${encodeURIComponent(query)}`, signal);

    const data = await response.json();

    return (data.playlists || []).map((p) => {
        const playlist = {
            uuid: p['playlist-id'],
            title: p.name,
            squareImage: p['playlist-image'],
            numberOfTracks: p.count || 0,
            creator: {
                name: p.user || '',
            },
            provider: 'community',
        };

        saveCommunityPlaylist(playlist);

        return playlist;
    });
}

export async function getCommunityPlaylist(id, signal) {
    const cache = getCommunityPlaylistCache();
    const cachedPlaylist = cache[id];

    const playlist = {
        id,
        uuid: id,
        title: 'Fetching...',
        image: cachedPlaylist?.squareImage || null,
        squareImage: cachedPlaylist?.squareImage || null,
        creator: cachedPlaylist?.creator || { name: '' },
        numberOfTracks: 0,
    };

    const response = await getPanora(`/tracklist/?source=ytm&query=${encodeURIComponent(id)}`, signal);

    const data = await response.json();

    playlist.title = cachedPlaylist?.title || 'Community Playlist';
    playlist.numberOfTracks = data.count || data.tracks?.length || 0;

    return {
        playlist,
        tracks: data.tracks || [],
    };
}
