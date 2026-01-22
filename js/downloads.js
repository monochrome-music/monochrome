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

/**
 * Upload a blob to the server
 * @param {Blob} blob - The file blob to upload
 * @param {string} filename - Original filename
 * @param {string} apiKey - API key for authentication
 * @param {string} serverUrl - Server URL
 * @param {string|null} folderName - Optional folder name for organizing uploads (album/playlist name)
 * @returns {Promise<object>} - Server response
 */
async function uploadToServer(blob, filename, apiKey, serverUrl, folderName = null) {
    if (!apiKey) {
        throw new Error('API key is required for server upload');
    }

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'X-Filename': filename
    };
    
    // Add folder name header if provided (for album/playlist organization)
    // URL-encode to handle non-ASCII characters (smart quotes, accents, etc.)
    if (folderName) {
        headers['X-Folder-Name'] = encodeURIComponent(folderName);
    }

    console.log(`[UploadToServer] POST ${serverUrl} - File: ${filename}, Folder: ${folderName || '(none)'}, Size: ${blob.size}`);

    const response = await fetch(serverUrl, {
        method: 'POST',
        headers: headers,
        body: blob
    });

    console.log(`[UploadToServer] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[UploadToServer] Error response body:`, errorText);
        throw new Error(`Server upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[UploadToServer] Success response:`, result);
    return result;
}

/**
 * Signal to the server that a batch upload is complete and ready for organization
 * @param {string} folderName - The folder name to organize
 * @returns {Promise<boolean>} - True if signal was sent successfully
 */
async function signalUploadComplete(folderName) {
    if (!folderName) return false;
    
    const serverUploadEnabled = isServerUploadEnabled();
    if (!serverUploadEnabled) return false;
    
    const config = getServerUploadConfig();
    if (!config.apiKey) return false;
    
    try {
        const completeUrl = config.url.replace(/\/$/, '') + '/complete';
        
        console.log(`[Upload] Signaling upload complete for folder: ${folderName}`);
        
        const response = await fetch(completeUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'X-Folder-Name': encodeURIComponent(folderName)
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Upload] Complete signal failed: ${response.status} - ${errorText}`);
            return false;
        }
        
        const result = await response.json();
        console.log(`[Upload] Complete signal successful:`, result);
        return true;
    } catch (error) {
        console.error(`[Upload] Failed to signal upload complete:`, error);
        return false;
    }
}

/**
 * Either upload to server or trigger browser download based on settings
 * @param {Blob} blob - The file blob
 * @param {string} filename - The filename
 * @param {string|null} folderName - Optional folder name for server organization
 */
async function handleDownload(blob, filename, folderName = null) {
    const serverUploadEnabled = isServerUploadEnabled();
    
    if (serverUploadEnabled) {
        const config = getServerUploadConfig();
        
        if (config.apiKey) {
            try {
                console.log(`[Upload] Attempting server upload: ${filename} (${blob.size} bytes) to folder: ${folderName || '(root)'}`);
                const result = await uploadToServer(blob, filename, config.apiKey, config.url, folderName);
                console.log(`[Upload] Server upload successful:`, result);
                return true; // Upload successful
            } catch (error) {
                console.error(`[Upload] Server upload failed for ${filename}:`, error);
                console.error(`[Upload] Error details:`, error.message, error.stack);
                // Fall back to local download
                console.log(`[Upload] Falling back to local download for ${filename}`);
                triggerDownload(blob, filename);
                return false;
            }
        } else {
            console.log(`[Upload] No API key configured, using local download for ${filename}`);
        }
    } else {
        console.log(`[Upload] Server upload disabled, using local download for ${filename}`);
    }
    
    // Server upload disabled or no API key - use normal download
    triggerDownload(blob, filename);
    return false;
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
    const trackId = track.id;
    const trackTitle = track.title || 'Unknown';
    console.log(`[DownloadBlob] Starting for track ${trackId}: "${trackTitle}" at quality ${quality}`);
    
    let enrichedTrack = {
        ...track,
        artist: track.artist || (track.artists && track.artists.length > 0 ? track.artists[0] : null),
    };

    if (enrichedTrack.album && (!enrichedTrack.album.title || !enrichedTrack.album.artist) && enrichedTrack.album.id) {
        try {
            console.log(`[DownloadBlob] Fetching album metadata for album ${enrichedTrack.album.id}`);
            const albumData = await api.getAlbum(enrichedTrack.album.id);
            if (albumData.album) {
                enrichedTrack.album = {
                    ...enrichedTrack.album,
                    ...albumData.album,
                };
            }
        } catch (error) {
            console.warn(`[DownloadBlob] Failed to fetch album data for metadata:`, error);
        }
    }

    console.log(`[DownloadBlob] Getting track stream URL from API...`);
    const lookup = await api.getTrack(track.id, quality);
    let streamUrl;

    if (lookup.originalTrackUrl) {
        streamUrl = lookup.originalTrackUrl;
        console.log(`[DownloadBlob] Using originalTrackUrl`);
    } else {
        streamUrl = api.extractStreamUrlFromManifest(lookup.info.manifest);
        if (!streamUrl) {
            console.error(`[DownloadBlob] Could not resolve stream URL from manifest`);
            throw new Error('Could not resolve stream URL');
        }
        console.log(`[DownloadBlob] Extracted stream URL from manifest`);
    }

    // Handle DASH streams (blob URLs)
    let blob;
    if (streamUrl.startsWith('blob:')) {
        console.log(`[DownloadBlob] Downloading DASH stream...`);
        try {
            const downloader = new DashDownloader();
            blob = await downloader.downloadDashStream(streamUrl, { signal });
            console.log(`[DownloadBlob] DASH download complete: ${blob?.size || 0} bytes`);
        } catch (dashError) {
            console.error(`[DownloadBlob] DASH download failed:`, dashError);
            // Fallback
            if (quality !== 'LOSSLESS') {
                console.warn(`[DownloadBlob] Falling back to LOSSLESS (16-bit) download.`);
                return downloadTrackBlob(track, 'LOSSLESS', api, lyricsManager, signal);
            }
            throw dashError;
        }
    } else {
        console.log(`[DownloadBlob] Fetching standard stream...`);
        const response = await fetch(streamUrl, { signal });
        if (!response.ok) {
            console.error(`[DownloadBlob] Fetch failed with status ${response.status}`);
            throw new Error(`Failed to fetch track: ${response.status}`);
        }
        blob = await response.blob();
        console.log(`[DownloadBlob] Standard download complete: ${blob?.size || 0} bytes`);
    }

    // Add metadata to the blob
    console.log(`[DownloadBlob] Adding metadata to blob...`);
    blob = await addMetadataToAudio(blob, enrichedTrack, api, quality);
    console.log(`[DownloadBlob] Metadata added, final blob size: ${blob?.size || 0} bytes`);

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

    console.log(`[BulkDownload] Starting download of ${tracks.length} tracks to folder: ${folderName || '(none)'}`);

    let successCount = 0;
    
    for (let i = 0; i < tracks.length; i++) {
        if (signal.aborted) {
            console.log(`[BulkDownload] Aborted at track ${i + 1}/${tracks.length}`);
            break;
        }
        const track = tracks[i];
        const trackTitle = getTrackTitle(track);
        const filename = buildTrackFilename(track, quality);

        updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

        try {
            const blob = await downloadTrackBlob(track, quality, api, null, signal);
            
            if (!blob) {
                console.error(`[BulkDownload] [${i + 1}/${tracks.length}] ERROR: downloadTrackBlob returned null/undefined for ${trackTitle}`);
                continue;
            }
            
            const uploadResult = await handleDownload(blob, filename, folderName);

            if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                try {
                    const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                    if (lyricsData) {
                        const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                        if (lrcContent) {
                            const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                            const lrcBlob = new Blob([lrcContent], { type: 'text/plain' });
                            await handleDownload(lrcBlob, lrcFilename, folderName);
                        }
                    }
                } catch (lyricsErr) {
                    // Lyrics fetch failed, non-fatal
                }
            }
            
            successCount++;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw err;
            }
            console.error(`[BulkDownload] [${i + 1}/${tracks.length}] FAILED: ${trackTitle}`, err);
        }
    }
    
    console.log(`[BulkDownload] Finished: ${successCount}/${tracks.length} tracks uploaded`);
    
    // Signal server that upload is complete and ready for organization
    if (folderName && isServerUploadEnabled() && successCount > 0) {
        await signalUploadComplete(folderName);
    }
}

async function bulkDownloadToZipStream(
    tracks,
    folderName,
    api,
    quality,
    lyricsManager,
    notification,
    fileHandle,
    coverBlob = null
) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;
    
    if (isServerUploadEnabled()) {
        return await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification, folderName);
    }

    const { downloadZip } = await loadClientZip();

    const writable = await fileHandle.createWritable();

    async function* yieldFiles() {
        if (coverBlob) {
            yield { name: `${folderName}/cover.jpg`, lastModified: new Date(), input: coverBlob };
        }

        for (let i = 0; i < tracks.length; i++) {
            if (signal.aborted) break;
            const track = tracks[i];
            const trackTitle = getTrackTitle(track);
            const filename = buildTrackFilename(track, quality);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const blob = await downloadTrackBlob(track, quality, api, null, signal);
                yield { name: `${folderName}/${filename}`, lastModified: new Date(), input: blob };

                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                yield {
                                    name: `${folderName}/${lrcFilename}`,
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
                console.error(`Failed to download track ${trackTitle}:`, err);
            }
        }
    }

    try {
        const response = downloadZip(yieldFiles());
        await response.body.pipeTo(writable);
    } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
    }
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
            } catch (err) {
                if (err.name === 'AbortError') {
                    removeBulkDownloadTask(notification);
                    return;
                }
                throw err;
            }
        } else {
            // Fallback or Forced: Individual sequential downloads
            await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification, defaultName);
            completeBulkDownload(notification, true);
        }
    } catch (error) {
        console.error('Bulk download failed:', error);
        completeBulkDownload(notification, false, error.message);
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
        showNotification('This track is already being downloaded');
        return;
    }

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
            console.warn('Failed to fetch album data for metadata:', error);
        }
    }

    const filename = buildTrackFilename(enrichedTrack, quality);
    const controller = abortController || new AbortController();
    ongoingDownloads.add(downloadKey);

    try {
        addDownloadTask(track.id, enrichedTrack, filename, api, controller);

        // Download the track blob (with metadata embedded)
        const blob = await downloadTrackBlob(enrichedTrack, quality, api, null, controller.signal);
        
        // Check if server upload is enabled
        const serverUploadEnabled = isServerUploadEnabled();
        
        if (serverUploadEnabled) {
            const config = getServerUploadConfig();
            
            if (!config.apiKey) {
                console.warn('Server upload enabled but no API key configured, falling back to local download');
                triggerDownload(blob, filename);
                completeDownloadTask(track.id, true);
            } else {
                // Try to upload to server with retry logic
                let uploadSuccess = false;
                let lastError = null;
                
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        updateDownloadProgress(track.id, {
                            stage: 'downloading',
                            receivedBytes: blob.size,
                            totalBytes: blob.size
                        });
                        
                        await uploadToServer(blob, filename, config.apiKey, config.url);
                        uploadSuccess = true;
                        break;
                    } catch (error) {
                        console.error(`Server upload attempt ${attempt} failed:`, error);
                        lastError = error;
                        if (attempt < 2) {
                            // Wait 1 second before retry
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }
                
                if (uploadSuccess) {
                    completeDownloadTask(track.id, true, '✓ Saved to server');
                    showNotification('✓ Track saved to server');
                } else {
                    // After 2 failed attempts, fall back to local download
                    console.warn('Server upload failed after 2 attempts, falling back to local download');
                    triggerDownload(blob, filename);
                    completeDownloadTask(track.id, true, '✓ Downloaded locally');
                }
            }
        } else {
            // Server upload disabled, use normal download
            triggerDownload(blob, filename);
            completeDownloadTask(track.id, true);
        }

        // Handle lyrics if enabled
        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
            try {
                const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                if (lyricsData) {
                    if (serverUploadEnabled) {
                        const config = getServerUploadConfig();
                        if (config.apiKey) {
                            // Upload lyrics to server
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                const lrcBlob = new Blob([lrcContent], { type: 'text/plain' });
                                
                                try {
                                    await uploadToServer(lrcBlob, lrcFilename, config.apiKey, config.url);
                                } catch (error) {
                                    console.error('Failed to upload lyrics:', error);
                                    // Fall back to local download for lyrics
                                    lyricsManager.downloadLRC(lyricsData, track);
                                }
                            }
                        }
                    } else {
                        // Normal lyrics download
                        lyricsManager.downloadLRC(lyricsData, track);
                    }
                }
            } catch (error) {
                console.log('Could not download lyrics for track');
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            const errorMsg =
                error.message === RATE_LIMIT_ERROR_MESSAGE ? error.message : 'Download failed. Please try again.';
            completeDownloadTask(track.id, false, errorMsg);
        }
    } finally {
        ongoingDownloads.delete(downloadKey);
    }
}