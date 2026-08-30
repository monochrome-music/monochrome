let downloadsModulePromise = null;

function loadDownloads() {
    downloadsModulePromise ||= import('./downloads.js');
    return downloadsModulePromise;
}

export function showNotification(...args) {
    void loadDownloads()
        .then(({ showNotification: notify }) => notify(...args))
        .catch(console.error);
}

export async function downloadTracks(...args) {
    const { downloadTracks: download } = await loadDownloads();
    return download(...args);
}

export async function downloadTrackWithMetadata(...args) {
    const { downloadTrackWithMetadata: download } = await loadDownloads();
    return download(...args);
}

export async function downloadAlbum(...args) {
    const { downloadAlbum: download } = await loadDownloads();
    return download(...args);
}

export async function downloadPlaylist(...args) {
    const { downloadPlaylist: download } = await loadDownloads();
    return download(...args);
}
