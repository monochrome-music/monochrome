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
    getExtensionFromBlob,
} from './utils.js';
import { lyricsSettings, bulkDownloadSettings, playlistSettings } from './storage.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';
import { generateM3U, generateM3U8, generateCUE, generateNFO, generateJSON } from './playlist-generator.js';

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
            console.warn('Failed to fetch album data for metadata:', error);
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
            console.error('DASH download failed:', dashError);
            // Fallback
            if (quality !== 'LOSSLESS') {
                console.warn('Falling back to LOSSLESS (16-bit) download.');
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

    // Detect actual format from blob signature BEFORE adding metadata
    const extension = await getExtensionFromBlob(blob);

    // Add metadata to the blob
    blob = await addMetadataToAudio(blob, enrichedTrack, api, quality);

    return { blob, extension };
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

async function bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    for (let i = 0; i < tracks.length; i++) {
        if (signal.aborted) break;
        const track = tracks[i];
        const trackTitle = getTrackTitle(track);

        updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

        try {
            const { blob, extension } = await downloadTrackBlob(track, quality, api, null, signal);
            const filename = buildTrackFilename(track, quality, extension);
            triggerDownload(blob, filename);

            if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                try {
                    const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                    if (lyricsData) {
                        const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                        if (lrcContent) {
                            const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                            const lrcBlob = new Blob([lrcContent], { type: 'text/plain' });
                            triggerDownload(lrcBlob, lrcFilename);
                        }
                    }
                } catch {
                    // Silent fail for lyrics
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.error(`Failed to download track ${trackTitle}:`, err);
        }
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
    coverBlob = null,
    type = 'playlist',
    metadata = null
) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;
    const { downloadZip } = await loadClientZip();

    const writable = await fileHandle.createWritable();

    async function* yieldFiles() {
        // Add cover if available
        if (coverBlob) {
            yield { name: `${folderName}/cover.jpg`, lastModified: new Date(), input: coverBlob };
        }

        // Generate playlist files first
        const useRelativePaths = playlistSettings.shouldUseRelativePaths();

        if (playlistSettings.shouldGenerateM3U()) {
            const m3uContent = generateM3U(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u`,
                lastModified: new Date(),
                input: m3uContent,
            };
        }

        if (playlistSettings.shouldGenerateM3U8()) {
            const m3u8Content = generateM3U8(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u8`,
                lastModified: new Date(),
                input: m3u8Content,
            };
        }

        if (playlistSettings.shouldGenerateNFO()) {
            const nfoContent = generateNFO(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.nfo`,
                lastModified: new Date(),
                input: nfoContent,
            };
        }

        if (playlistSettings.shouldGenerateJSON()) {
            const jsonContent = generateJSON(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.json`,
                lastModified: new Date(),
                input: jsonContent,
            };
        }

        // For albums, generate CUE file
        if (type === 'album' && playlistSettings.shouldGenerateCUE()) {
            const audioFilename = `${sanitizeForFilename(folderName)}.flac`; // Assume FLAC for CUE
            const cueContent = generateCUE(metadata, tracks, audioFilename);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.cue`,
                lastModified: new Date(),
                input: cueContent,
            };
        }

        // Download tracks
        for (let i = 0; i < tracks.length; i++) {
            if (signal.aborted) break;
            const track = tracks[i];
            const trackTitle = getTrackTitle(track);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const { blob, extension } = await downloadTrackBlob(track, quality, api, null, signal);
                const filename = buildTrackFilename(track, quality, extension);
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

// Generate ZIP as blob for browsers without File System Access API (iOS, etc.)
async function bulkDownloadToZipBlob(
    tracks,
    folderName,
    api,
    quality,
    lyricsManager,
    notification,
    coverBlob = null,
    type = 'playlist',
    metadata = null
) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;
    const { downloadZip } = await loadClientZip();

    async function* yieldFiles() {
        // Add cover if available
        if (coverBlob) {
            yield { name: `${folderName}/cover.jpg`, lastModified: new Date(), input: coverBlob };
        }

        // Generate playlist files first
        const useRelativePaths = playlistSettings.shouldUseRelativePaths();

        if (playlistSettings.shouldGenerateM3U()) {
            const m3uContent = generateM3U(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u`,
                lastModified: new Date(),
                input: m3uContent,
            };
        }

        if (playlistSettings.shouldGenerateM3U8()) {
            const m3u8Content = generateM3U8(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u8`,
                lastModified: new Date(),
                input: m3u8Content,
            };
        }

        if (playlistSettings.shouldGenerateNFO()) {
            const nfoContent = generateNFO(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.nfo`,
                lastModified: new Date(),
                input: nfoContent,
            };
        }

        if (playlistSettings.shouldGenerateJSON()) {
            const jsonContent = generateJSON(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.json`,
                lastModified: new Date(),
                input: jsonContent,
            };
        }

        // For albums, generate CUE file
        if (type === 'album' && playlistSettings.shouldGenerateCUE()) {
            const audioFilename = `${sanitizeForFilename(folderName)}.flac`; // Assume FLAC for CUE
            const cueContent = generateCUE(metadata, tracks, audioFilename);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.cue`,
                lastModified: new Date(),
                input: cueContent,
            };
        }

        // Download tracks
        for (let i = 0; i < tracks.length; i++) {
            if (signal.aborted) break;
            const track = tracks[i];
            const trackTitle = getTrackTitle(track);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const { blob, extension } = await downloadTrackBlob(track, quality, api, null, signal);
                const filename = buildTrackFilename(track, quality, extension);
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
        const blob = await response.blob();
        triggerDownload(blob, `${folderName}.zip`);
    } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
    }
}

async function startBulkDownload(
    tracks,
    defaultName,
    api,
    quality,
    lyricsManager,
    type,
    name,
    coverBlob = null,
    metadata = null
) {
    const notification = createBulkDownloadNotification(type, name, tracks.length);

    try {
        const hasFileSystemAccess =
            'showSaveFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype;
        const useZip = hasFileSystemAccess && !bulkDownloadSettings.shouldForceIndividual();
        const useZipBlob = !hasFileSystemAccess && !bulkDownloadSettings.shouldForceIndividual();

        if (useZip) {
            // File System Access API available - use streaming
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
                    coverBlob,
                    type,
                    metadata
                );
                completeBulkDownload(notification, true);
            } catch (err) {
                if (err.name === 'AbortError') {
                    removeBulkDownloadTask(notification);
                    return;
                }
                throw err;
            }
        } else if (useZipBlob) {
            // No File System Access API (iOS, etc.) - use blob-based ZIP
            await bulkDownloadToZipBlob(
                tracks,
                defaultName,
                api,
                quality,
                lyricsManager,
                notification,
                coverBlob,
                type,
                metadata
            );
            completeBulkDownload(notification, true);
        } else {
            // Fallback or Forced: Individual sequential downloads
            await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification);
            completeBulkDownload(notification, true);
        }
    } catch (error) {
        console.error('Bulk download failed:', error);
        completeBulkDownload(notification, false, error.message);
    }
}

export async function downloadTracks(tracks, api, quality, lyricsManager = null) {
    const folderName = `Queue - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'queue', 'Queue', null, {
        title: 'Queue',
    });
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
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'album', album.title, coverBlob, album);
}

export async function downloadPlaylistAsZip(playlist, tracks, api, quality, lyricsManager = null) {
    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: playlist.title,
        albumArtist: 'Playlist',
        year: new Date().getFullYear(),
    });

    const representativeTrack = tracks.find((t) => t.album?.cover);
    const coverBlob = await getCoverBlob(api, representativeTrack?.album?.cover);
    await startBulkDownload(
        tracks,
        folderName,
        api,
        quality,
        lyricsManager,
        'playlist',
        playlist.title,
        coverBlob,
        playlist
    );
}

export async function downloadDiscography(artist, selectedReleases, api, quality, lyricsManager = null) {
    const rootFolder = `${sanitizeForFilename(artist.name)} discography`;
    const notification = createBulkDownloadNotification('discography', artist.name, selectedReleases.length);
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    const hasFileSystemAccess = 'showSaveFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype;
    const useZip = hasFileSystemAccess && !bulkDownloadSettings.shouldForceIndividual();
    const useZipBlob = !hasFileSystemAccess && !bulkDownloadSettings.shouldForceIndividual();

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

                // Generate playlist files for each album
                const useRelativePaths = playlistSettings.shouldUseRelativePaths();

                if (playlistSettings.shouldGenerateM3U()) {
                    const m3uContent = generateM3U(fullAlbum, tracks, useRelativePaths);
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.m3u`,
                        lastModified: new Date(),
                        input: m3uContent,
                    };
                }

                if (playlistSettings.shouldGenerateM3U8()) {
                    const m3u8Content = generateM3U8(fullAlbum, tracks, useRelativePaths);
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.m3u8`,
                        lastModified: new Date(),
                        input: m3u8Content,
                    };
                }

                if (playlistSettings.shouldGenerateNFO()) {
                    const nfoContent = generateNFO(fullAlbum, tracks, 'album');
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.nfo`,
                        lastModified: new Date(),
                        input: nfoContent,
                    };
                }

                if (playlistSettings.shouldGenerateJSON()) {
                    const jsonContent = generateJSON(fullAlbum, tracks, 'album');
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.json`,
                        lastModified: new Date(),
                        input: jsonContent,
                    };
                }

                if (playlistSettings.shouldGenerateCUE()) {
                    const audioFilename = `${sanitizeForFilename(fullAlbum.title)}.flac`;
                    const cueContent = generateCUE(fullAlbum, tracks, audioFilename);
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.cue`,
                        lastModified: new Date(),
                        input: cueContent,
                    };
                }

                for (const track of tracks) {
                    if (signal.aborted) break;
                    try {
                        const { blob, extension } = await downloadTrackBlob(track, quality, api, null, signal);
                        const filename = buildTrackFilename(track, quality, extension);
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

    try {
        if (useZip) {
            // File System Access API available - use streaming
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: `${rootFolder}.zip`,
                types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
            });
            const writable = await fileHandle.createWritable();
            const { downloadZip } = await loadClientZip();

            const response = downloadZip(yieldDiscography());
            await response.body.pipeTo(writable);
            completeBulkDownload(notification, true);
        } else if (useZipBlob) {
            // No File System Access API (iOS, etc.) - use blob-based ZIP
            const { downloadZip } = await loadClientZip();
            const response = downloadZip(yieldDiscography());
            const blob = await response.blob();
            triggerDownload(blob, `${rootFolder}.zip`);
            completeBulkDownload(notification, true);
        } else {
            // Sequential individual downloads for discography
            for (let albumIndex = 0; albumIndex < selectedReleases.length; albumIndex++) {
                if (signal.aborted) break;
                const album = selectedReleases[albumIndex];
                updateBulkDownloadProgress(notification, albumIndex, selectedReleases.length, album.title);
                const { tracks } = await api.getAlbum(album.id);
                await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification);
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

    const typeLabel =
        type === 'album'
            ? 'Album'
            : type === 'playlist'
              ? 'Playlist'
              : type === 'liked'
                ? 'Liked Tracks'
                : type === 'queue'
                  ? 'Queue'
                  : 'Discography';

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

        await api.downloadTrack(track.id, quality, filename, {
            signal: controller.signal,
            track: enrichedTrack,
            onProgress: (progress) => {
                updateDownloadProgress(track.id, progress);
            },
        });

        completeDownloadTask(track.id, true);

        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
            try {
                const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                if (lyricsData) {
                    lyricsManager.downloadLRC(lyricsData, track);
                }
            } catch {
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

export async function downloadLikedTracks(tracks, api, quality, lyricsManager = null) {
    const folderName = `Liked Tracks - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'liked', 'Liked Tracks');
}
