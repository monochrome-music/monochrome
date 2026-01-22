//js/downloads.js
import {
    buildTrackFilename,
    sanitizeForFilename,
    RATE_LIMIT_ERROR_MESSAGE,
    getTrackArtists,
    getTrackTitle,
    formatTemplate,
    SVG_CLOSE,
    getCoverBlob,
} from './utils.js';
import { lyricsSettings, bulkDownloadSettings } from './storage.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';

/**
 * Check if server upload is enabled and configured
 */
function isServerUploadEnabled() {
    return localStorage.getItem('server-upload-enabled') === 'true';
}

/**
 * Get server upload configuration
 */
function getServerUploadConfig() {
    return {
        url: localStorage.getItem('server-upload-url') || 'https://up.delilah.ink',
        apiKey: localStorage.getItem('server-upload-key') || ''
    };
}

const SERVER_UPLOAD_MAX_SIZE = 95 * 1024 * 1024; // 95MB (with safety margin)
/**
 * Get a lower quality setting for fallback when files are too large
 * @param {string} currentQuality - Current quality setting
 * @returns {string|null} - Lower quality to try, or null if already at lowest
 */
function getFallbackQuality(currentQuality) {
    const qualityLevels = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'];
    const currentIndex = qualityLevels.indexOf(currentQuality);
    
    if (currentIndex === -1 || currentIndex >= qualityLevels.length - 1) {
        return null; // Already at lowest or unknown quality
    }
    
    // Return next lower quality (skip to HIGH/AAC if coming from lossless)
    if (currentQuality === 'HI_RES_LOSSLESS' || currentQuality === 'LOSSLESS') {
        return 'HIGH'; // Jump straight to AAC 320
    }
    
    return qualityLevels[currentIndex + 1];
}

/**
 * Upload a blob to the server
 */
async function uploadToServer(blob, filename, apiKey, serverUrl, folderName = null) {
    if (!apiKey) {
        throw new Error('API key is required for server upload');
    }

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'X-Filename': encodeURIComponent(filename)
    };
    
    if (folderName) {
        headers['X-Folder-Name'] = encodeURIComponent(folderName);
    }

    const response = await fetch(serverUrl, {
        method: 'POST',
        headers: headers,
        body: blob
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

/**
 * Signal to the server that a batch upload is complete
 */
async function signalUploadComplete(folderName) {
    if (!folderName) return false;
    
    const serverUploadEnabled = isServerUploadEnabled();
    if (!serverUploadEnabled) return false;
    
    const config = getServerUploadConfig();
    if (!config.apiKey) return false;
    
    try {
        const completeUrl = config.url.replace(/\/$/, '') + '/complete';
        
        const response = await fetch(completeUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'X-Folder-Name': encodeURIComponent(folderName)
            }
        });
        
        if (!response.ok) {
            console.error(`Complete signal failed: ${response.status}`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Failed to signal upload complete:', error.message);
        return false;
    }
}

/**
 * Upload to server or show error - NO local download fallback
 * @returns {Promise<boolean>} - True if upload succeeded, false if failed
 */
async function handleDownload(blob, filename, folderName = null) {
    const serverUploadEnabled = isServerUploadEnabled();
    
    if (!serverUploadEnabled) {
        // Server upload disabled - use normal browser download
        triggerDownload(blob, filename);
        return true;
    }
    
    const config = getServerUploadConfig();
    
    if (!config.apiKey) {
        // No API key - use normal browser download
        triggerDownload(blob, filename);
        return true;
    }
    
    try {
        await uploadToServer(blob, filename, config.apiKey, config.url, folderName);
        return true;
    } catch (error) {
        console.error(`Upload failed for ${filename}:`, error.message);
        throw error; // Let caller handle the error
    }
}

const downloadTasks = new Map();
const bulkDownloadTasks = new Map();
const ongoingDownloads = new Set();
let downloadNotificationContainer = null;

async function loadClientZip() {
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/client-zip@2.4.5/+esm');
        return module;
    } catch (error) {
        console.error('Failed to load client-zip:', error);
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
        notifEl.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => notifEl.remove(), 300);
    }, 1500);
}

export function addDownloadTask(trackId, track, filename, api, abortController) {
    const container = createDownloadNotification();

    const taskEl = document.createElement('div');
    taskEl.className = 'download-task';
    taskEl.dataset.trackId = trackId;
    const trackTitle = getTrackTitle(track);
    const trackArtists = getTrackArtists(track);
    taskEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <img src="${api.getCoverUrl(track.album?.cover)}"
                 style="width: 40px; height: 40px; border-radius: 4px; flex-shrink: 0;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; font-size: 0.9rem; margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${trackTitle}</div>
                <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 0.5rem;">${trackArtists}</div>
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
        const percent = progress.totalBytes ? Math.round((progress.receivedBytes / progress.totalBytes) * 100) : 0;

        progressFill.style.width = `${percent}%`;

        const receivedMB = (progress.receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = progress.totalBytes ? (progress.totalBytes / (1024 * 1024)).toFixed(1) : '?';

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
    taskEl.style.animation = 'slide-out 0.3s ease forwards';

    setTimeout(() => {
        taskEl.remove();
        downloadTasks.delete(trackId);

        if (downloadNotificationContainer && downloadNotificationContainer.children.length === 0) {
            downloadNotificationContainer.remove();
            downloadNotificationContainer = null;
        }
    }, 300);
}

function removeBulkDownloadTask(notifEl) {
    const task = bulkDownloadTasks.get(notifEl);
    if (!task) return;

    notifEl.style.animation = 'slide-out 0.3s ease forwards';

    setTimeout(() => {
        notifEl.remove();
        bulkDownloadTasks.delete(notifEl);

        if (downloadNotificationContainer && downloadNotificationContainer.children.length === 0) {
            downloadNotificationContainer.remove();
            downloadNotificationContainer = null;
        }
    }, 300);
}

async function downloadTrackBlob(track, quality, api, lyricsManager = null, signal = null) {
    let enrichedTrack = {
        ...track,
        artist: track.artist || (track.artists && track.artists.length > 0 ? track.artists[0] : null),
    };

    if (enrichedTrack.album && (!enrichedTrack.album.title || !enrichedTrack.album.artist) && enrichedTrack.album.id) {
        try {
            const albumData = await api.getAlbum(enrichedTrack.album.id);
            if (albumData.album) {
                enrichedTrack.album = {
                    ...enrichedTrack.album,
                    ...albumData.album,
                };
            }
        } catch (error) {
            // Non-fatal - continue with partial metadata
        }
    }

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

    // Handle DASH streams (blob URLs)
    let blob;
    if (streamUrl.startsWith('blob:')) {
        try {
            const downloader = new DashDownloader();
            blob = await downloader.downloadDashStream(streamUrl, { signal });
        } catch (dashError) {
            // Fallback to lossless if hi-res fails
            if (quality !== 'LOSSLESS') {
                return downloadTrackBlob(track, 'LOSSLESS', api, lyricsManager, signal);
            }
            throw dashError;
        }
    } else {
        const response = await fetch(streamUrl, { signal });
        if (!response.ok) {
            throw new Error(`Failed to fetch track: ${response.status}`);
        }
        blob = await response.blob();
    }

    // Add metadata to the blob
    blob = await addMetadataToAudio(blob, enrichedTrack, api, quality);

    return blob;
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification, folderName = null) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    const serverUploadEnabled = isServerUploadEnabled();
    let successCount = 0;
    let failedTracks = [];
    
    for (let i = 0; i < tracks.length; i++) {
        if (signal.aborted) {
            break;
        }
        
        const track = tracks[i];
        const trackTitle = getTrackTitle(track);
        let currentQuality = quality;
        let filename = buildTrackFilename(track, currentQuality);

        updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

        try {
            // Download the track
            let blob = await downloadTrackBlob(track, currentQuality, api, null, signal);
            
            if (!blob) {
                failedTracks.push(trackTitle);
                continue;
            }
            
            // Check if file is too large for server upload
            if (serverUploadEnabled && blob.size > SERVER_UPLOAD_MAX_SIZE) {
                const fallbackQuality = getFallbackQuality(currentQuality);
                
                if (fallbackQuality) {
                    // Re-download at lower quality
                    currentQuality = fallbackQuality;
                    filename = buildTrackFilename(track, currentQuality);
                    blob = await downloadTrackBlob(track, currentQuality, api, null, signal);
                    
                    if (!blob) {
                        failedTracks.push(trackTitle);
                        continue;
                    }
                    
                    // Notify user about quality fallback
                    showNotification(`↓ ${trackTitle} - using AAC (file too large)`);
                }
            }
            
            // Upload the track
            try {
                await handleDownload(blob, filename, folderName);
            } catch (uploadError) {
                failedTracks.push(trackTitle);
                showNotification(`✗ Failed to upload: ${trackTitle}`);
                continue;
            }

            // Handle lyrics
            if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                try {
                    const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                    if (lyricsData) {
                        const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                        if (lrcContent) {
                            const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                            const lrcBlob = new Blob([lrcContent], { type: 'text/plain' });
                            try {
                                await handleDownload(lrcBlob, lrcFilename, folderName);
                            } catch (e) {
                                // Lyrics upload failed - non-fatal, don't notify
                            }
                        }
                    }
                } catch (lyricsErr) {
                    // Lyrics fetch failed - non-fatal
                }
            }
            
            successCount++;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw err;
            }
            console.error(`Failed to process ${trackTitle}:`, err.message);
            failedTracks.push(trackTitle);
        }
    }
    
    // Signal server that upload is complete
    if (folderName && serverUploadEnabled && successCount > 0) {
        await signalUploadComplete(folderName);
    }
    
    // Show summary notification
    if (failedTracks.length > 0) {
        showNotification(`⚠ ${failedTracks.length} track(s) failed to upload`);
    }
    
    return { successCount, failedCount: failedTracks.length };
}

async function startBulkDownload(tracks, defaultName, api, quality, lyricsManager, type, name, coverBlob = null) {
    const notification = createBulkDownloadNotification(type, name, tracks.length);

    try {
        const useZip = window.showSaveFilePicker && !bulkDownloadSettings.shouldForceIndividual();

        if (useZip) {
            try {
                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: `${defaultName}.zip`,
                    types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
                });
                await bulkDownloadToZipStream(
                    tracks,
                    defaultName,
                    api,
                    quality,
                    lyricsManager,
                    notification,
                    fileHandle,
                    coverBlob
                );
                completeBulkDownload(notification, true);
                showNotification(`✓ ${name} downloaded`);
            } catch (err) {
                if (err.name === 'AbortError') {
                    removeBulkDownloadTask(notification);
                    return;
                }
                throw err;
            }
        } else {
            // Sequential uploads to server
            const result = await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification, defaultName);
            
            if (result.failedCount === 0) {
                completeBulkDownload(notification, true);
                showNotification(`✓ ${name} saved to server (${result.successCount} tracks)`);
            } else if (result.successCount > 0) {
                completeBulkDownload(notification, true, `${result.successCount}/${tracks.length} uploaded`);
            } else {
                completeBulkDownload(notification, false, 'Upload failed');
            }
        }
    } catch (error) {
        console.error('Bulk download failed:', error.message);
        completeBulkDownload(notification, false, error.message);
        showNotification(`✗ ${name}: ${error.message}`);
    }
}

export async function downloadTracks(tracks, api, quality, lyricsManager = null) {
    const folderName = `Queue - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'queue', 'Queue');
}

export async function downloadAlbumAsZip(album, tracks, api, quality, lyricsManager = null) {
    const releaseDateStr =
        album.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
    const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
    const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';

    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: album.title,
        albumArtist: album.artist?.name,
        year: year,
    });

    const coverBlob = await getCoverBlob(api, album.cover || album.album?.cover || album.coverId);
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'album', album.title, coverBlob);
}

export async function downloadPlaylistAsZip(playlist, tracks, api, quality, lyricsManager = null) {
    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: playlist.title,
        albumArtist: 'Playlist',
        year: new Date().getFullYear(),
    });

    const representativeTrack = tracks.find((t) => t.album?.cover);
    const coverBlob = await getCoverBlob(api, representativeTrack?.album?.cover);
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'playlist', playlist.title, coverBlob);
}

export async function downloadDiscography(artist, selectedReleases, api, quality, lyricsManager = null) {
    const rootFolder = `${sanitizeForFilename(artist.name)} discography`;
    const notification = createBulkDownloadNotification('discography', artist.name, selectedReleases.length);
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    try {
        const useZip = window.showSaveFilePicker && !bulkDownloadSettings.shouldForceIndividual();

        if (useZip) {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: `${rootFolder}.zip`,
                types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
            });
            const writable = await fileHandle.createWritable();
            const { downloadZip } = await loadClientZip();

            async function* yieldDiscography() {
                for (let albumIndex = 0; albumIndex < selectedReleases.length; albumIndex++) {
                    if (signal.aborted) break;
                    const album = selectedReleases[albumIndex];
                    updateBulkDownloadProgress(notification, albumIndex, selectedReleases.length, album.title);

                    try {
                        const { album: fullAlbum, tracks } = await api.getAlbum(album.id);
                        const coverBlob = await getCoverBlob(api, fullAlbum.cover || album.cover);
                        const releaseDateStr =
                            fullAlbum.releaseDate ||
                            (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
                        const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
                        const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';

                        const albumFolder = formatTemplate(
                            localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}',
                            {
                                albumTitle: fullAlbum.title,
                                albumArtist: fullAlbum.artist?.name,
                                year: year,
                            }
                        );

                        const fullFolderPath = `${rootFolder}/${albumFolder}`;
                        if (coverBlob)
                            yield { name: `${fullFolderPath}/cover.jpg`, lastModified: new Date(), input: coverBlob };

                        for (const track of tracks) {
                            if (signal.aborted) break;
                            const filename = buildTrackFilename(track, quality);
                            try {
                                const blob = await downloadTrackBlob(track, quality, api, null, signal);
                                yield { name: `${fullFolderPath}/${filename}`, lastModified: new Date(), input: blob };

                                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                                    try {
                                        const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                                        if (lyricsData) {
                                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                                            if (lrcContent) {
                                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                                yield {
                                                    name: `${fullFolderPath}/${lrcFilename}`,
                                                    lastModified: new Date(),
                                                    input: lrcContent,
                                                };
                                            }
                                        }
                                    } catch {
                                        /* ignore */
                                    }
                                }
                            } catch (err) {
                                if (err.name === 'AbortError') throw err;
                                console.error(`Failed to download track ${track.title}:`, err);
                            }
                        }
                    } catch (error) {
                        if (error.name === 'AbortError') throw error;
                        console.error(`Failed to download album ${album.title}:`, error);
                    }
                }
            }

            const response = downloadZip(yieldDiscography());
            await response.body.pipeTo(writable);
            completeBulkDownload(notification, true);
        } else {
            // Sequential individual downloads for discography
            for (let albumIndex = 0; albumIndex < selectedReleases.length; albumIndex++) {
                if (signal.aborted) break;
                const album = selectedReleases[albumIndex];
                updateBulkDownloadProgress(notification, albumIndex, selectedReleases.length, album.title);
                const { album: fullAlbum, tracks } = await api.getAlbum(album.id);
                
                // Construct folder name for this album (matching ZIP path logic)
                const releaseDateStr =
                    fullAlbum.releaseDate ||
                    (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
                const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
                const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';
                
                const albumFolder = formatTemplate(
                    localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}',
                    {
                        albumTitle: fullAlbum.title,
                        albumArtist: fullAlbum.artist?.name,
                        year: year,
                    }
                );
                
                await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification, albumFolder);
                    
                if (isServerUploadEnabled()) {
                    await signalUploadComplete(albumFolder);
                }
            }
            completeBulkDownload(notification, true);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            removeBulkDownloadTask(notification);
            return;
        }
        completeBulkDownload(notification, false, error.message);
    }
}

function createBulkDownloadNotification(type, name, _totalItems) {
    const container = createDownloadNotification();

    const notifEl = document.createElement('div');
    notifEl.className = 'download-task bulk-download';
    notifEl.dataset.bulkType = type;
    notifEl.dataset.bulkName = name;

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
            <button class="download-cancel" style="background: transparent; border: none; color: var(--muted-foreground); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    `;

    container.appendChild(notifEl);

    const abortController = new AbortController();
    bulkDownloadTasks.set(notifEl, { abortController });

    notifEl.querySelector('.download-cancel').addEventListener('click', () => {
        abortController.abort();
        removeBulkDownloadTask(notifEl);
    });

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
            notifEl.style.animation = 'slide-out 0.3s ease forwards';
            setTimeout(() => notifEl.remove(), 300);
        }, 3000);
    } else {
        progressFill.style.background = '#ef4444';
        statusEl.textContent = message || '✗ Download failed';
        statusEl.style.color = '#ef4444';

        setTimeout(() => {
            notifEl.style.animation = 'slide-out 0.3s ease forwards';
            setTimeout(() => notifEl.remove(), 300);
        }, 5000);
    }
}

export async function downloadTrackWithMetadata(track, quality, api, lyricsManager = null, abortController = null) {
    if (!track) {
        alert('No track is currently playing');
        return;
    }

    const downloadKey = `track-${track.id}`;
    if (ongoingDownloads.has(downloadKey)) {
        showNotification('Track is already being downloaded');
        return;
    }

    let enrichedTrack = {
        ...track,
        artist: track.artist || (track.artists && track.artists.length > 0 ? track.artists[0] : null),
    };

    // Fetch full album data if needed
    if (enrichedTrack.album && (!enrichedTrack.album.title || !enrichedTrack.album.artist) && enrichedTrack.album.id) {
        try {
            const albumData = await api.getAlbum(enrichedTrack.album.id);
            if (albumData.album) {
                enrichedTrack.album = {
                    ...enrichedTrack.album,
                    ...albumData.album,
                };
            }
        } catch (error) {
            // Non-fatal - continue with partial metadata
        }
    }

    const controller = abortController || new AbortController();
    ongoingDownloads.add(downloadKey);
    
    // Build folder name for server upload
    const serverUploadEnabled = isServerUploadEnabled();
    let folderName = null;
    
    if (serverUploadEnabled && enrichedTrack.album) {
        const albumTitle = enrichedTrack.album.title || 'Unknown Album';
        const albumArtist = enrichedTrack.album.artist?.name || enrichedTrack.artist?.name || 'Unknown Artist';
        const releaseDateStr = enrichedTrack.album.releaseDate || enrichedTrack.streamStartDate?.split('T')[0] || '';
        const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
        const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';
        
        folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
            albumTitle: albumTitle,
            albumArtist: albumArtist,
            year: year,
        });
    }

    let currentQuality = quality;
    let filename = buildTrackFilename(enrichedTrack, currentQuality);
    const trackTitle = getTrackTitle(enrichedTrack);

    try {
        addDownloadTask(track.id, enrichedTrack, filename, api, controller);

        // Download the track
        let blob = await downloadTrackBlob(enrichedTrack, currentQuality, api, null, controller.signal);
        
        // Check if file is too large and retry at lower quality
        if (serverUploadEnabled && blob && blob.size > SERVER_UPLOAD_MAX_SIZE) {
            const fallbackQuality = getFallbackQuality(currentQuality);
            
            if (fallbackQuality) {
                showNotification(`↓ ${trackTitle} - using AAC (file too large)`);
                currentQuality = fallbackQuality;
                filename = buildTrackFilename(enrichedTrack, currentQuality);
                blob = await downloadTrackBlob(enrichedTrack, currentQuality, api, null, controller.signal);
            }
        }
        
        if (serverUploadEnabled) {
            const config = getServerUploadConfig();
            
            if (!config.apiKey) {
                triggerDownload(blob, filename);
                completeDownloadTask(track.id, true);
                return;
            }
            
            // Upload to server
            try {
                updateDownloadProgress(track.id, {
                    stage: 'downloading',
                    receivedBytes: blob.size,
                    totalBytes: blob.size
                });
                
                await uploadToServer(blob, filename, config.apiKey, config.url, folderName);
                
                // Upload lyrics to same folder
                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                const lrcBlob = new Blob([lrcContent], { type: 'text/plain' });
                                await uploadToServer(lrcBlob, lrcFilename, config.apiKey, config.url, folderName);
                            }
                        }
                    } catch (error) {
                        // Lyrics failed - non-fatal
                    }
                }
                
                // Signal completion
                if (folderName) {
                    await signalUploadComplete(folderName);
                }
                
                completeDownloadTask(track.id, true, '✓ Saved to server');
                showNotification(`✓ ${trackTitle} saved to server`);
                
            } catch (uploadError) {
                console.error('Upload failed:', uploadError.message);
                completeDownloadTask(track.id, false, '✗ Upload failed');
                showNotification(`✗ Failed to upload: ${trackTitle}`);
            }
        } else {
            // Server upload disabled - normal browser download
            triggerDownload(blob, filename);
            completeDownloadTask(track.id, true);
            
            if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                try {
                    const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                    if (lyricsData) {
                        lyricsManager.downloadLRC(lyricsData, track);
                    }
                } catch (error) {
                    // Lyrics failed - non-fatal
                }
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            const errorMsg = error.message === RATE_LIMIT_ERROR_MESSAGE 
                ? error.message 
                : 'Download failed';
            completeDownloadTask(track.id, false, errorMsg);
            showNotification(`✗ ${trackTitle}: ${errorMsg}`);
        }
    } finally {
        ongoingDownloads.delete(downloadKey);
    }
}