import { buildTrackFilename, sanitizeForFilename, RATE_LIMIT_ERROR_MESSAGE, getTrackArtists, getTrackTitle, formatTemplate } from './utils.js';
import { lyricsSettings } from './storage.js';

const downloadTasks = new Map();
let downloadNotificationContainer = null;

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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
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
    
    const template = localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist} - monochrome.tf';
    const folderName = formatTemplate(template, {
        albumTitle: album.title,
        albumArtist: album.artist?.name,
        year: new Date(album.releaseDate).getFullYear()
    });
    
    const notification = createBulkDownloadNotification('album', album.title, tracks.length);
    
    try {
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const filename = buildTrackFilename(track, quality);
            const trackTitle = getTrackTitle(track);
            
            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);
            
            const blob = await downloadTrackBlob(track, quality, api);
            zip.file(`${folderName}/${filename}`, blob);
            
            // Add LRC to zip if enabled
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
    
    const template = localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist} - monochrome.tf';
    const rootFolder = `${sanitizeForFilename(artist.name)} discography - monochrome.tf`;
    
    const totalAlbums = artist.albums.length;
    const notification = createBulkDownloadNotification('discography', artist.name, totalAlbums);
    
    try {
        for (let albumIndex = 0; albumIndex < artist.albums.length; albumIndex++) {
            const album = artist.albums[albumIndex];
            
            updateBulkDownloadProgress(notification, albumIndex, totalAlbums, album.title);
            
            try {
                const { album: fullAlbum, tracks } = await api.getAlbum(album.id);
                const albumFolder = formatTemplate(template, {
                    albumTitle: fullAlbum.title,
                    albumArtist: fullAlbum.artist?.name,
                    year: new Date(fullAlbum.releaseDate).getFullYear()
                });
                
                for (const track of tracks) {
                    const filename = buildTrackFilename(track, quality);
                    const blob = await downloadTrackBlob(track, quality, api);
                    zip.file(`${rootFolder}/${albumFolder}/${filename}`, blob);
                    
                    // Add LRC to zip if enabled
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
    
    notifEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem;">
                    Downloading ${type === 'album' ? 'Album' : 'Discography'}
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

export async function downloadCurrentTrack(track, quality, api, lyricsManager = null) {
    if (!track) {
        alert('No track is currently playing');
        return;
    }
    
    const filename = buildTrackFilename(track, quality);
    
    try {
        const { taskEl, abortController } = addDownloadTask(
            track.id,
            track,
            filename,
            api
        );
        
        await api.downloadTrack(track.id, quality, filename, {
            signal: abortController.signal,
            onProgress: (progress) => {
                updateDownloadProgress(track.id, progress);
            }
        });
        
        completeDownloadTask(track.id, true);
        
        // Download LRC if enabled
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