//js/downloads.js
import { buildTrackFilename, sanitizeForFilename, RATE_LIMIT_ERROR_MESSAGE, getTrackArtists, getTrackTitle, formatTemplate, SVG_CLOSE, getCoverBlob } from './utils.js';
import { lyricsSettings } from './storage.js';
import { addMetadataToAudio } from './metadata.js';

const downloadTasks = new Map();
let downloadNotificationContainer = null;

async function loadZipJS() {
    try {
        // Load zip.js from CDN (ES Module)
        const module = await import('https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.34/index.js');
        return module;
    } catch (error) {
        console.error('Failed to load zip.js:', error);
        throw new Error('Failed to load ZIP library');
    }
}

async function loadStreamSaver() {
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.js');
        return module.default;
    } catch (error) {
        console.error('Failed to load StreamSaver:', error);
        throw new Error('Failed to load StreamSaver library');
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
            <img src="${api.getCoverUrl(track.album?.cover)}"
                 style="width: 40px; height: 40px; border-radius: 4px; flex-shrink: 0;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; font-size: 0.9rem; margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${trackTitle}</div>
                <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 0.5rem;">${track.artist?.name || 'Unknown'}</div>
                <div class="download-progress-bar" style="height: 4px; background: var(--secondary); border-radius: 2px; overflow: hidden;">
                    <div class="download-progress-fill" style="width: 0%; height: 100%; background: var(--highlight); transition: width 0.2s;"></div>
                </div>
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Starting...</div>
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

async function downloadTrackBlob(track, quality, api) {
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
    
    let blob = await response.blob();
    
    // Add metadata to the blob
    blob = await addMetadataToAudio(blob, track, api, quality);
    
    return blob;
}

/**
 * Initializes the download stream (using File System Access API or StreamSaver)
 * and returns a ZipWriter instance that pipes to it.
 */
async function createZipStreamWriter(filename) {
    const zip = await loadZipJS();
    let writable;
    let abortFn = null;

    // 1. Try File System Access API (Chrome/Edge/Opera)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: `${filename}.zip`,
                types: [{
                    description: 'ZIP Archive',
                    accept: { 'application/zip': ['.zip'] }
                }]
            });
            writable = await handle.createWritable();
        } catch (err) {
            if (err.name === 'AbortError') return null; // User cancelled
            throw err;
        }
    } 
    // 2. Fallback to StreamSaver.js (Firefox/Safari)
    else {
        const streamSaver = await loadStreamSaver();
        writable = streamSaver.createWriteStream(`${filename}.zip`);
        // StreamSaver doesn't support aborting via API easily in this flow,
        // but closing the writer effectively ends it.
    }

    // Create zip.js writer
    // zip.js requires a specific Writer interface for WritableStream
    const zipWriter = new zip.ZipWriter(new zip.WritableStreamWriter(writable));

    return { zipWriter, zipModule: zip };
}

async function streamTracksToZip(zipWriter, zipModule, tracks, folderName, api, quality, lyricsManager, notification, startProgressIndex = 0, totalTracks = tracks.length) {
    const { BlobReader, TextReader } = zipModule;

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const currentGlobalIndex = startProgressIndex + i;
        const filename = buildTrackFilename(track, quality);
        const trackTitle = getTrackTitle(track);

        updateBulkDownloadProgress(notification, currentGlobalIndex, totalTracks, trackTitle);

        try {
            // Download track (into memory blob)
            const blob = await downloadTrackBlob(track, quality, api);
            
            // Write to ZIP stream (and flush to disk immediately)
            await zipWriter.add(`${folderName}/${filename}`, new BlobReader(blob));
            
            // Blob is now eligible for GC (as we await the write)

            // Lyrics
            if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                try {
                    const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                    if (lyricsData) {
                        const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                        if (lrcContent) {
                            const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                            await zipWriter.add(`${folderName}/${lrcFilename}`, new TextReader(lrcContent));
                        }
                    }
                } catch (error) {
                    // Ignore lyrics error
                }
            }
        } catch (err) {
            console.error(`Failed to download track ${trackTitle}:`, err);
        }
    }
}

export async function downloadAlbumAsZip(album, tracks, api, quality, lyricsManager = null) {
    const releaseDateStr = album.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
    const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
    const year = (releaseDate && !isNaN(releaseDate.getTime())) ? releaseDate.getFullYear() : '';

    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: album.title,
        albumArtist: album.artist?.name,
        year: year
    });

    const streamResult = await createZipStreamWriter(folderName);
    if (!streamResult) return; // Cancelled
    const { zipWriter, zipModule } = streamResult;

    const notification = createBulkDownloadNotification('album', album.title, tracks.length);

    try {
        const coverBlob = await getCoverBlob(api, album.cover || album.album?.cover || album.coverId);
        if (coverBlob) {
            await zipWriter.add(`${folderName}/cover.jpg`, new zipModule.BlobReader(coverBlob));
        }

        await streamTracksToZip(zipWriter, zipModule, tracks, folderName, api, quality, lyricsManager, notification);
        
        await zipWriter.close();
        completeBulkDownload(notification, true);
    } catch (error) {
        completeBulkDownload(notification, false, error.message);
        try { await zipWriter.close(); } catch (e) {} // Try to close anyway
        throw error;
    }
}

export async function downloadPlaylistAsZip(playlist, tracks, api, quality, lyricsManager = null) {       
    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: playlist.title,
        albumArtist: 'Playlist',
        year: new Date().getFullYear()
    });

    const streamResult = await createZipStreamWriter(folderName);
    if (!streamResult) return; // Cancelled
    const { zipWriter, zipModule } = streamResult;

    const notification = createBulkDownloadNotification('playlist', playlist.title, tracks.length);       

    try {
        // Cover
        const representativeTrack = tracks.find(t => t.album?.cover);
        const coverBlob = await getCoverBlob(api, representativeTrack?.album?.cover);
        if (coverBlob) {
            await zipWriter.add(`${folderName}/cover.jpg`, new zipModule.BlobReader(coverBlob));
        }

        await streamTracksToZip(zipWriter, zipModule, tracks, folderName, api, quality, lyricsManager, notification);
        
        await zipWriter.close();
        completeBulkDownload(notification, true);
    } catch (error) {
        completeBulkDownload(notification, false, error.message);
        try { await zipWriter.close(); } catch (e) {}
        throw error;
    }
}

export async function downloadDiscography(artist, api, quality, lyricsManager = null) {
    const rootFolder = `${sanitizeForFilename(artist.name)} discography`;

    const streamResult = await createZipStreamWriter(rootFolder);
    if (!streamResult) return;
    const { zipWriter, zipModule } = streamResult;

    const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
    const notification = createBulkDownloadNotification('discography', artist.name, allReleases.length); // Total is approx tracks, but showing albums for now in text

    try {
        // Calculate total tracks for better progress? 
        // It's expensive to fetch all album details first. We'll just update text.
        
        let totalTracksDownloaded = 0;

        for (let albumIndex = 0; albumIndex < allReleases.length; albumIndex++) {
            const album = allReleases[albumIndex];
            updateBulkDownloadProgress(notification, albumIndex, allReleases.length, album.title);

            try {
                const { album: fullAlbum, tracks } = await api.getAlbum(album.id);
                
                const releaseDateStr = fullAlbum.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
                const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
                const year = (releaseDate && !isNaN(releaseDate.getTime())) ? releaseDate.getFullYear() : '';

                const albumFolder = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
                    albumTitle: fullAlbum.title,
                    albumArtist: fullAlbum.artist?.name,
                    year: year
                });

                const fullFolderPath = `${rootFolder}/${albumFolder}`;
                
                // Cover
                const coverBlob = await getCoverBlob(api, fullAlbum.cover || album.cover);
                if (coverBlob) {
                    await zipWriter.add(`${fullFolderPath}/cover.jpg`, new zipModule.BlobReader(coverBlob));
                }

                // We reuse the streamTracksToZip logic but we need to pass just this album's tracks
                // and careful with progress bar. streamTracksToZip resets progress?
                // Let's call the logic manually to control progress bar or adapt streamTracksToZip.
                
                // Actually, streamTracksToZip updates progress based on its inputs. 
                // For discography, we might want to keep the "Album X/Y" progress.
                // Let's just inline the loop here or simple helper.
                
                const { BlobReader, TextReader } = zipModule;

                for (const track of tracks) {
                     const filename = buildTrackFilename(track, quality);
                     try {
                        const blob = await downloadTrackBlob(track, quality, api);
                        await zipWriter.add(`${fullFolderPath}/${filename}`, new BlobReader(blob));

                        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                            try {
                                const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                                if (lyricsData) {
                                    const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                                    if (lrcContent) {
                                        const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                        await zipWriter.add(`${fullFolderPath}/${lrcFilename}`, new TextReader(lrcContent));
                                    }
                                }
                            } catch (e) {}
                        }
                     } catch (err) {
                         console.error(`Failed to download track ${track.title}:`, err);
                     }
                }

            } catch (error) {
                console.error(`Failed to download album ${album.title}:`, error);
            }
        }

        await zipWriter.close();
        completeBulkDownload(notification, true);
    } catch (error) {
        completeBulkDownload(notification, false, error.message);
        try { await zipWriter.close(); } catch (e) {}
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
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Starting...</div>
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
            track: track,
            onProgress: (progress) => {
                updateDownloadProgress(track.id, progress);
            }
        });

        completeDownloadTask(track.id, true);

        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
            try {
                const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
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