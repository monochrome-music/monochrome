//js/downloads.js
import { buildTrackFilename, sanitizeForFilename, RATE_LIMIT_ERROR_MESSAGE, getTrackArtists, getTrackTitle, formatTemplate, SVG_CLOSE } from './utils.js';
import { lyricsSettings } from './storage.js';

const downloadTasks = new Map();
let downloadNotificationContainer = null;
const coverCache = new Map();

/**
 * Fetches and caches cover art as a Blob
 */
async function getCoverBlob(api, coverId) {
    if (!coverId) return null;
    if (coverCache.has(coverId)) return coverCache.get(coverId);

    try {
        const url = api.getCoverUrl(coverId, '1280');
        const response = await fetch(url);
        if (response.ok) {
            const blob = await response.blob();
            coverCache.set(coverId, blob);
            return blob;
        }
    } catch (error) {
        console.warn('Cover fetch failed:', error);
    }
    return null;
}

/**
 * Adds a cover blob to a JSZip instance
 */
function addCoverBlobToZip(zip, folderPath, blob) {
    if (!blob) return;
    const path = folderPath ? `${folderPath}/cover.jpg` : 'cover.jpg';
    if (!zip.file(path)) {
        zip.file(path, blob);
    }
}

async function loadJSZip() {
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
        return module.default;
    } catch (error) {
        console.error('Failed to load JSZip:', error);
        throw new Error('Failed to load ZIP library');
    }
}

function createDownloadNotification() {
    if (!downloadNotificationContainer) {
        downloadNotificationContainer = document.createElement('div');
        downloadNotificationContainer.id = 'download-notifications';
        document.body.appendChild(downloadNotificationContainer);
    }
    return downloadNotificationContainer;
}

export function showNotification(message) {
    const container = createDownloadNotification();

    const notifEl = document.createElement('div');
    notifEl.className = 'download-task';

    notifEl.innerHTML = `
        <div style="display: flex; align-items: start;">
            ${message}
        </div>
    `;

    container.appendChild(notifEl);

    // Auto remove
    setTimeout(() => {
        notifEl.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notifEl.remove(), 300);
    }, 1500);
}

export function addDownloadTask(trackId, track, filename, api) {
    const container = createDownloadNotification();

    const taskEl = document.createElement('div');
    taskEl.className = 'download-task';
    taskEl.dataset.trackId = trackId;
    const trackTitle = getTrackTitle(track);
    taskEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <img src="${api.getCoverUrl(track.album?.cover, '80')}"
                 style="width: 40px; height: 40px; border-radius: 4px; flex-shrink: 0;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; font-size: 0.9rem; margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${trackTitle}</div>
                <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 0.5rem;">${track.artist?.name || 'Unknown'}</div>
                <div class="download-progress-bar" style="height: 4px; background: var(--secondary); border-radius: 2px; overflow: hidden;">
                    <div class="download-progress-fill" style="width: 0%; height: 100%; background: var(--highlight); transition: width 0.2s;"></div>
                </div>
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem;">Starting...</div>
            </div>
            <button class="download-cancel" style="background: transparent; border: none; color: var(--muted-foreground); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                ${SVG_CLOSE}
            </button>
        </div>
    `;

    container.appendChild(taskEl);

    const abortController = new AbortController();
    downloadTasks.set(trackId, { taskEl, abortController });

    taskEl.querySelector('.download-cancel').addEventListener('click', () => {
        abortController.abort();
        removeDownloadTask(trackId);
    });

    return { taskEl, abortController };
}

export function updateDownloadProgress(trackId, progress) {
    const task = downloadTasks.get(trackId);
    if (!task) return;

    const { taskEl } = task;
    const progressFill = taskEl.querySelector('.download-progress-fill');
    const statusEl = taskEl.querySelector('.download-status');

    if (progress.stage === 'downloading') {
        const percent = progress.totalBytes
            ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
            : 0;

        progressFill.style.width = `${percent}%`;

        const receivedMB = (progress.receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = progress.totalBytes
            ? (progress.totalBytes / (1024 * 1024)).toFixed(1)
            : '?';

        statusEl.textContent = `Downloading: ${receivedMB}MB / ${totalMB}MB (${percent}%)`;
    }
}

export function completeDownloadTask(trackId, success = true, message = null) {
    const task = downloadTasks.get(trackId);
    if (!task) return;

    const { taskEl } = task;
    const progressFill = taskEl.querySelector('.download-progress-fill');
    const statusEl = taskEl.querySelector('.download-status');
    const cancelBtn = taskEl.querySelector('.download-cancel');

    if (success) {
        progressFill.style.width = '100%';
        progressFill.style.background = '#10b981';
        statusEl.textContent = '✓ Downloaded';
        statusEl.style.color = '#10b981';
        cancelBtn.remove();

        setTimeout(() => removeDownloadTask(trackId), 3000);
    } else {
        progressFill.style.background = '#ef4444';
        statusEl.textContent = message || '✗ Download failed';
        statusEl.style.color = '#ef4444';
        cancelBtn.innerHTML = `
            ${SVG_CLOSE}
        `;
        cancelBtn.onclick = () => removeDownloadTask(trackId);

        setTimeout(() => removeDownloadTask(trackId), 5000);
    }
}

function removeDownloadTask(trackId) {
    const task = downloadTasks.get(trackId);
    if (!task) return;

    const { taskEl } = task;
    taskEl.style.animation = 'slideOut 0.3s ease';

    setTimeout(() => {
        taskEl.remove();
        downloadTasks.delete(trackId);

        if (downloadNotificationContainer && downloadNotificationContainer.children.length === 0) {       
            downloadNotificationContainer.remove();
            downloadNotificationContainer = null;
        }
    }, 300);
}

async function downloadTrackBlob(track, quality, api, lyricsManager = null) {
    const lookup = await api.getTrack(track.id, quality);
    let streamUrl;

    if (lookup.originalTrackUrl) {
        streamUrl = lookup.originalTrackUrl;
    } else {
        streamUrl = api.extractStreamUrlFromManifest(lookup.info.manifest);
        if (!streamUrl) {
            throw new Error('Could not resolve stream URL');
        }
    }

    const response = await fetch(streamUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch track: ${response.status}`);
    }

    const blob = await response.blob();
    return blob;
}

export async function downloadAlbumAsZip(album, tracks, api, quality, lyricsManager = null) {
    const JSZip = await loadJSZip();
    const zip = new JSZip();

    const coverBlob = await getCoverBlob(api, album.cover || album.album?.cover || album.coverId);
    const releaseDateStr = album.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
    const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
    const year = (releaseDate && !isNaN(releaseDate.getTime())) ? releaseDate.getFullYear() : '';

    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: album.title,
        albumArtist: album.artist?.name,
        year: year
    });

    const notification = createBulkDownloadNotification('album', album.title, tracks.length);

    try {
        addCoverBlobToZip(zip, folderName, coverBlob);

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const filename = buildTrackFilename(track, quality);
            const trackTitle = getTrackTitle(track);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const blob = await downloadTrackBlob(track, quality, api);
                zip.file(`${folderName}/${filename}`, blob);
                
                try {
                    const meta = buildTrackMetadata(track, api);
                    const metaFilename = filename.replace(/\.[^.]+$/, '.json');
                    zip.file(`${folderName}/${metaFilename}`, JSON.stringify(meta, null, 2));
                } catch (e) {
                    console.warn('Could not attach metadata for', trackTitle, e);
                }

                try {
                    await addCoverToZipIfMissing(zip, folderName, albumCoverId || track.album?.cover, api);
                } catch (e) {
                    
                }

                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                zip.file(`${folderName}/${lrcFilename}`, lrcContent);
                            }
                        }
                    } catch (error) {
                        console.log('Could not add lyrics for:', trackTitle);
                    }
                }
            } catch (err) {
                console.error(`Failed to download track ${trackTitle}:`, err);
            }
        }

        updateBulkDownloadProgress(notification, tracks.length, tracks.length, 'Creating ZIP...');        

        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        completeBulkDownload(notification, true);
    } catch (error) {
        completeBulkDownload(notification, false, error.message);
        throw error;
    }
}

export async function downloadPlaylistAsZip(playlist, tracks, api, quality, lyricsManager = null) {       
    const JSZip = await loadJSZip();
    const zip = new JSZip();

    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: playlist.title,
        albumArtist: 'Playlist',
        year: new Date().getFullYear()
    });

    const notification = createBulkDownloadNotification('playlist', playlist.title, tracks.length);       

    try {
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const filename = buildTrackFilename(track, quality);
            const trackTitle = getTrackTitle(track);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const coverBlob = await getCoverBlob(api, track.album?.cover);
                const blob = await downloadTrackBlob(track, quality, api);
                zip.file(`${folderName}/${filename}`, blob);
            
                addCoverBlobToZip(zip, folderName, coverBlob);
                try {
                    const meta = buildTrackMetadata(track, api);
                    const metaFilename = filename.replace(/\.[^.]+$/, '.json');
                    zip.file(`${folderName}/${metaFilename}`, JSON.stringify(meta, null, 2));
                } catch (e) {
                    console.warn('Could not attach metadata for', trackTitle, e);
                }

                // add cover per track/playlist (attempt once per track)
                try {
                    await addCoverToZipIfMissing(zip, folderName, track.album?.cover, api);
                } catch (e) {}

                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                zip.file(`${folderName}/${lrcFilename}`, lrcContent);
                            }
                        }
                    } catch (error) {
                        console.log('Could not add lyrics for:', trackTitle);
                    }
                }
            } catch (err) {
                console.error(`Failed to download track ${trackTitle}:`, err);
            }
        }

        updateBulkDownloadProgress(notification, tracks.length, tracks.length, 'Creating ZIP...');        

        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        completeBulkDownload(notification, true);
    } catch (error) {
        completeBulkDownload(notification, false, error.message);
        throw error;
    }
}

export async function downloadDiscography(artist, api, quality, lyricsManager = null) {
    const JSZip = await loadJSZip();
    const zip = new JSZip();

    const rootFolder = `${sanitizeForFilename(artist.name)} discography`;

    const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
    const totalAlbums = allReleases.length;
    const notification = createBulkDownloadNotification('discography', artist.name, totalAlbums);

    try {
        for (let albumIndex = 0; albumIndex < allReleases.length; albumIndex++) {
            const album = allReleases[albumIndex];

            updateBulkDownloadProgress(notification, albumIndex, totalAlbums, album.title);

            try {
                const { album: fullAlbum, tracks } = await api.getAlbum(album.id);
                const coverBlob = await getCoverBlob(api, fullAlbum.cover || album.cover);
                
                const releaseDateStr = fullAlbum.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
                const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
                const year = (releaseDate && !isNaN(releaseDate.getTime())) ? releaseDate.getFullYear() : '';

                const albumFolder = formatTemplate(template, {
                    albumTitle: fullAlbum.title,
                    albumArtist: fullAlbum.artist?.name,
                    year: year
                });

                addCoverBlobToZip(zip, `${rootFolder}/${albumFolder}`, coverBlob);

                for (const track of tracks) {
                    const filename = buildTrackFilename(track, quality);
                    
                    try {
                        const blob = await downloadTrackBlob(track, quality, api);
                        zip.file(`${rootFolder}/${albumFolder}/${filename}`, blob);

                        

                        try {
                            await addCoverToZipIfMissing(zip, `${rootFolder}/${albumFolder}`, track.album?.cover || album.cover, api);
                        } catch (e) {}

                        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                            try {
                                const lyricsData = await lyricsManager.fetchLyrics(track.id);
                                if (lyricsData) {
                                    const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                                    if (lrcContent) {
                                        const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                        zip.file(`${rootFolder}/${albumFolder}/${lrcFilename}`, lrcContent);
                                    }
                                }
                            } catch (error) {
                                console.log('Could not add lyrics for:', track.title);
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to download track ${track.title} in album ${album.title}:`, err);
                    }
                }
            } catch (error) {
                console.error(`Failed to download album ${album.title}:`, error);
            }
        }

        updateBulkDownloadProgress(notification, totalAlbums, totalAlbums, 'Creating ZIP...');

        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${rootFolder}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        completeBulkDownload(notification, true);
    } catch (error) {
        completeBulkDownload(notification, false, error.message);
        throw error;
    }
}

function createBulkDownloadNotification(type, name, totalItems) {
    const container = createDownloadNotification();

    const notifEl = document.createElement('div');
    notifEl.className = 'download-task bulk-download';

    const typeLabel = type === 'album' ? 'Album' : type === 'playlist' ? 'Playlist' : 'Discography';      

    notifEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem;">
                    Downloading ${typeLabel}
                </div>
                <div style="font-size: 0.85rem; color: var(--muted-foreground); margin-bottom: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
                <div class="download-progress-bar" style="height: 4px; background: var(--secondary); border-radius: 2px; overflow: hidden;">
                    <div class="download-progress-fill" style="width: 0%; height: 100%; background: var(--highlight); transition: width 0.2s;"></div>
                </div>
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem;">Starting...</div>
            </div>
        </div>
    `;

    container.appendChild(notifEl);
    return notifEl;
}

function updateBulkDownloadProgress(notifEl, current, total, currentItem) {
    const progressFill = notifEl.querySelector('.download-progress-fill');
    const statusEl = notifEl.querySelector('.download-status');

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    statusEl.textContent = `${current}/${total} - ${currentItem}`;
}

function completeBulkDownload(notifEl, success = true, message = null) {
    const progressFill = notifEl.querySelector('.download-progress-fill');
    const statusEl = notifEl.querySelector('.download-status');

    if (success) {
        progressFill.style.width = '100%';
        progressFill.style.background = '#10b981';
        statusEl.textContent = '✓ Download complete';
        statusEl.style.color = '#10b981';

        setTimeout(() => {
            notifEl.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notifEl.remove(), 300);
        }, 3000);
    } else {
        progressFill.style.background = '#ef4444';
        statusEl.textContent = message || '✗ Download failed';
        statusEl.style.color = '#ef4444';

        setTimeout(() => {
            notifEl.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notifEl.remove(), 300);
        }, 5000);
    }
}

export async function downloadTrackWithMetadata(track, quality, api, lyricsManager = null, abortController = null) {

    if (!track) {
        alert('No track is currently playing');
        return;
    }

    const filename = buildTrackFilename(track, quality);

    const controller = abortController || new AbortController();

    try {
        const { taskEl, taskAbortController } = addDownloadTask(
            track.id,
            track,
            filename,
            api
        );

        await api.downloadTrack(track.id, quality, filename, {
            signal: controller.signal,
            onProgress: (progress) => {
                updateDownloadProgress(track.id, progress);
            }
        });

        completeDownloadTask(track.id, true);

        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
            try {
                const lyricsData = await lyricsManager.fetchLyrics(track.id);
                if (lyricsData) {
                    lyricsManager.downloadLRC(lyricsData, track);
                }
            } catch (error) {
                console.log('Could not download lyrics for track');
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            const errorMsg = error.message === RATE_LIMIT_ERROR_MESSAGE
                ? error.message
                : 'Download failed. Please try again.';
            completeDownloadTask(track.id, false, errorMsg);
        }
    }
}