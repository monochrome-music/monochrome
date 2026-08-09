const PANORA_INSTANCES = [
    'https://panora-api-us.dyamuh.dev',
    'https://panora-api-de.dyamuh.dev',
];

async function getPanora(path) {
    const requests = PANORA_INSTANCES.map(async (base) => {
        const response = await fetch(`${base}${path}`);

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
    const cache = getCommunityPlaylistCache();
    cache[playlist.uuid] = playlist;
    localStorage.setItem(COMMUNITY_PLAYLIST_CACHE_KEY, JSON.stringify(cache));
}

export async function searchCommunityPlaylists(query) {
    const response = await getPanora(
        `/playlists/?source=ytm&query=${encodeURIComponent(query)}`
    );

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

export async function getCommunityPlaylist(id) {
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

    const response = await getPanora(
        `/tracklist/?source=ytm&query=${encodeURIComponent(id)}`
    );

    const data = await response.json();

    playlist.title = cachedPlaylist?.title || 'Community Playlist';
    playlist.numberOfTracks = data.count || data.tracks?.length || 0;

    return {
        playlist,
        tracks: data.tracks || [],
    };
}