//js/downloads.js
import {
    buildTrackFilename,
    sanitizeForFilename,
    RATE_LIMIT_ERROR_MESSAGE,
    getTrackArtists,
    getTrackTitle,
    formatPathTemplate,
    getCoverBlob,
    getExtensionFromBlob,
    escapeHtml,
    getTrackDiscNumber,
} from './utils.js';
import { lyricsSettings, playlistSettings } from './storage.js';
import { generateM3U, generateM3U8, generateCUE, generateNFO, generateJSON } from './playlist-generator.js';
import { ZipStreamWriter, ZipBlobWriter, FolderPickerWriter, SequentialFileWriter } from './bulk-download-writer.ts';
import { FfmpegProgress } from './ffmpeg.types.js';
import { DownloadProgress, ProgressMessage, SegmentedDownloadProgress } from './progressEvents.js';
import { db } from './db.js';
import { BulkDownloadMethod, modernSettings } from './ModernSettings.js';
import { SVG_CLOSE } from './icons.ts';
import { MusicAPI } from './music-api.js';
import { LyricsManager } from './lyrics.js';

const downloadTasks = new Map();
const bulkDownloadTasks = new Map();
const ongoingDownloads = new Set();
let downloadNotificationContainer = null;

/** Wraps a single {@link WriterEntry}-like object as an AsyncIterable for use with IBulkDownloadWriter.write(). */
async function* singleWriterEntry(entry) {
    yield entry;
}

async function createDiscLayoutContext(tracks, api) {
    if (!playlistSettings.shouldSeparateDiscsInZip()) {
        return { separateByDisc: false, resolveDiscNumber: () => 1 };
    }

    const explicitDiscNumbers = tracks.map((track) => getTrackDiscNumber(track));
    const explicitDistinct = new Set(explicitDiscNumbers.filter(Boolean));

    if (explicitDistinct.size > 1) {
        return {
            separateByDisc: true,
            resolveDiscNumber: (index) => explicitDiscNumbers[index] || 1,
        };
    }

    // Some providers omit disc fields in album payload but include them in full track metadata.
    const hydratedDiscNumbers = await Promise.all(
        tracks.map(async (track, index) => {
            if (explicitDiscNumbers[index]) return explicitDiscNumbers[index];
            try {
                const fullTrack = await api.getTrackMetadata(track.id);
                return getTrackDiscNumber(fullTrack);
            } catch {
                return null;
            }
        })
    );

    const hydratedDistinct = new Set(hydratedDiscNumbers.filter(Boolean));
    if (hydratedDistinct.size > 1) {
        return {
            separateByDisc: true,
            resolveDiscNumber: (index) => hydratedDiscNumbers[index] || explicitDiscNumbers[index] || 1,
        };
    }

    return { separateByDisc: false, resolveDiscNumber: () => 1 };
}

async function computeDiscInfo(tracks, api = null) {
    // First pass: collect explicit disc numbers from the raw track objects.
    const explicitDiscNumbers = tracks.map((track) => getTrackDiscNumber(track));
    const explicitDistinct = new Set(explicitDiscNumbers.filter(Boolean));

    let resolvedDiscNumbers = explicitDiscNumbers;

    // Some providers omit disc fields in the album payload. When we can't
    // distinguish discs from the raw data and an API instance is provided,
    // hydrate missing disc numbers via full-track metadata (mirrors the logic
    // in createDiscLayoutContext).
    if (explicitDistinct.size <= 1 && api) {
        const hydratedDiscNumbers = await Promise.all(
            tracks.map(async (track, index) => {
                if (explicitDiscNumbers[index]) return explicitDiscNumbers[index];
                try {
                    const fullTrack = await api.getTrackMetadata(track.id);
                    return getTrackDiscNumber(fullTrack);
                } catch {
                    return null;
                }
            })
        );
        const hydratedDistinct = new Set(hydratedDiscNumbers.filter(Boolean));
        if (hydratedDistinct.size > 1) {
            resolvedDiscNumbers = hydratedDiscNumbers;
        }
    }

    const tracksPerDisc = new Map();
    let maxDiscNumber = 0;
    for (let i = 0; i < tracks.length; i++) {
        const discNumber = resolvedDiscNumbers[i] || 1;
        tracksPerDisc.set(discNumber, (tracksPerDisc.get(discNumber) || 0) + 1);
        if (discNumber > maxDiscNumber) {
            maxDiscNumber = discNumber;
        }
    }

    return { totalDiscs: maxDiscNumber || 1, tracksPerDisc, resolvedDiscNumbers };
}

async function annotateTracksWithDiscInfo(tracks, api = null) {
    const { totalDiscs, tracksPerDisc, resolvedDiscNumbers } = await computeDiscInfo(tracks, api);
    return tracks.map((track, index) => {
        const discNumber = resolvedDiscNumbers[index] || 1;
        return {
            ...track,
            album: {
                ...(track.album || {}),
                totalDiscs,
                numberOfTracksOnDisc: tracksPerDisc.get(discNumber),
            },
        };
    });
}

function getDiscFolderName(discNumber) {
    return `Disc ${discNumber}`;
}

function buildZipTrackPath(rootFolder, filename, separateByDisc, discNumber = 1) {
    if (!separateByDisc) return `${rootFolder}/${filename}`;
    return `${rootFolder}/${getDiscFolderName(discNumber)}/${filename}`;
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

    const innerDiv = document.createElement('div');
    innerDiv.style.display = 'flex';
    innerDiv.style.alignItems = 'start';
    innerDiv.textContent = message;
    notifEl.appendChild(innerDiv);

    container.appendChild(notifEl);

    // Auto remove
    setTimeout(() => {
        notifEl.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => notifEl.remove(), 300);
    }, 1500);
}

export function addDownloadTask(trackId, track, _filename, api, abortController) {
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
                ${SVG_CLOSE(20)}
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

    if (progress instanceof DownloadProgress && progress.receivedBytes && progress.totalBytes) {
        const percent = progress.totalBytes ? Math.round((progress.receivedBytes / progress.totalBytes) * 100) : 0;

        progressFill.style.width = `${percent}%`;
        progressFill.style.background = 'var(--highlight)';

        const receivedMB = (progress.receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = progress.totalBytes ? (progress.totalBytes / (1024 * 1024)).toFixed(1) : '?';

        statusEl.textContent = `Downloading: ${receivedMB}MB / ${totalMB}MB (${percent}%)`;
    } else if (progress instanceof SegmentedDownloadProgress && progress.currentSegment && progress.totalSegments) {
        const percent = progress.totalBytes ? Math.round((progress.currentSegment / progress.totalSegments) * 100) : 0;

        progressFill.style.width = `${percent}%`;
        progressFill.style.background = 'var(--highlight)';

        const receivedMB = (progress.receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = progress.totalBytes ? (progress.totalBytes / (1024 * 1024)).toFixed(1) : '?';

        statusEl.textContent = `Downloading: ${receivedMB}MB / ${totalMB}MB (${percent}%)`;
    } else if (progress instanceof FfmpegProgress && progress.stage == 'encoding') {
        const percent = progress.progress ? Math.round(progress.progress) : 0;
        progressFill.style.width = `${percent}%`;
        progressFill.style.background = '#3b82f6'; // Blue for encoding
        statusEl.textContent = `Converting: ${percent}%`;
    } else if (progress instanceof ProgressMessage || progress.message) {
        if (progress instanceof FfmpegProgress && (progress.stage == 'parsing' || progress.stage == 'stdout')) {
            return;
        }

        progressFill.style.width = '100%';
        progressFill.style.background = '#3b82f6';
        statusEl.textContent = progress.message;
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
            ${SVG_CLOSE(20)}
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

async function downloadTrackBlob(track, quality, api, signal = null, onProgress = null) {
    const blob = await api.downloadTrack(track.id, quality, undefined, {
        track,
        signal,
        onProgress,
        triggerDownload: false,
        calculateDashBytes: false,
    });

    // Detect actual format from blob signature BEFORE adding metadata
    const extension = await getExtensionFromBlob(blob);

    return { blob, extension };
}

async function bulkDownload({
    tracks,
    folderName,
    api,
    quality,
    lyricsManager,
    notification,
    writer,
    coverBlob = null,
    type = 'playlist',
    metadata = null,
}) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    async function* yieldFiles() {
        // Add cover if available and enabled
        if (coverBlob && playlistSettings.shouldIncludeCover()) {
            yield { name: `${folderName}/cover.jpg`, lastModified: new Date(), input: coverBlob };
        }

        const useRelativePaths = playlistSettings.shouldUseRelativePaths();
        const discLayout = await createDiscLayoutContext(tracks, api);
        const separateByDisc = discLayout.separateByDisc;

        // Download tracks, yielding each immediately and collecting actual paths for playlist generation
        const trackPaths = [];
        for (let i = 0; i < tracks.length; i++) {
            if (signal.aborted) break;
            const track = tracks[i];
            const trackTitle = getTrackTitle(track);
            let fileFraction = 0;

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const { blob, extension } = await downloadTrackBlob(track, quality, api, signal, (p) => {
                    if (p instanceof DownloadProgress && p.totalBytes && p.receivedBytes) {
                        fileFraction = p.receivedBytes / p.totalBytes;
                    } else if (p instanceof SegmentedDownloadProgress && p.currentSegment && p.totalSegments) {
                        fileFraction = p.currentSegment / p.totalSegments;
                    }

                    fileFraction = Math.min(fileFraction, 0.99); // Cap at 99% to avoid showing 100% before finalization
                    updateBulkDownloadProgress(notification, i + fileFraction, tracks.length, trackTitle, p);
                });
                const filename = buildTrackFilename(track, quality, extension);
                const discNumber = discLayout.resolveDiscNumber(i);
                const discPath = separateByDisc ? `${getDiscFolderName(discNumber)}/${filename}` : filename;

                trackPaths.push(discPath);

                yield {
                    name: buildZipTrackPath(folderName, filename, separateByDisc, discNumber),
                    lastModified: new Date(),
                    input: blob,
                };

                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                yield {
                                    name: buildZipTrackPath(folderName, lrcFilename, separateByDisc, discNumber),
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
                trackPaths.push(null);
            }
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

        // For albums, generate CUE file (one per disc if multi-disc)
        if (type === 'album' && playlistSettings.shouldGenerateCUE()) {
            const tracksByVolume = tracks.reduce((acc, track, index) => {
                const discNumber = String(getTrackDiscNumber(track) || 1);
                if (!acc[discNumber]) acc[discNumber] = [];
                acc[discNumber].push({ ...track, trackPath: trackPaths[index] });
                return acc;
            }, {});

            const multiDisc = Object.keys(tracksByVolume).length > 1;

            for (const [volumeNumber, volumeTracks] of Object.entries(tracksByVolume)) {
                const volumeTrackPaths = volumeTracks.map((track) => track.trackPath);
                const cueContent = generateCUE(
                    metadata,
                    volumeTracks,
                    sanitizeForFilename(folderName),
                    volumeTrackPaths
                );
                yield {
                    name: `${folderName}/${sanitizeForFilename(folderName)}${multiDisc ? ` - Disc ${volumeNumber}` : ''}.cue`,
                    lastModified: new Date(),
                    input: cueContent,
                };
            }
        }

        // Generate m3u/m3u8 last, using actual track paths collected during download
        if (playlistSettings.shouldGenerateM3U()) {
            const m3uContent = generateM3U(
                metadata || { title: folderName },
                tracks,
                useRelativePaths,
                null,
                'flac',
                trackPaths
            );
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u`,
                lastModified: new Date(),
                input: m3uContent,
            };
        }

        if (playlistSettings.shouldGenerateM3U8()) {
            const m3u8Content = generateM3U8(
                metadata || { title: folderName },
                tracks,
                useRelativePaths,
                null,
                'flac',
                trackPaths
            );
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u8`,
                lastModified: new Date(),
                input: m3u8Content,
            };
        }
    }

    await writer.write(yieldFiles());
}

/**
 * Returns a writer that can be used to save a single-track download directly
 * to the configured folder (Local Media Folder or saved Folder Picker handle),
 * or `null` if the feature is not active / no folder is configured.
 *
 * In contrast to {@link createBulkWriter}, this never prompts the user - it
 * only succeeds when the folder is already known.
 */
async function createSingleTrackFolderWriter() {
    if (!modernSettings.downloadSinglesToFolder) return null;

    const method = modernSettings.bulkDownloadMethod;
    const hasFolderPicker = 'showDirectoryPicker' in window;

    if (method === BulkDownloadMethod.LocalMedia) {
        const localHandle = await db.getSetting('local_folder_handle');
        if (hasFolderPicker && localHandle && typeof localHandle.requestPermission === 'function') {
            try {
                const permission = await localHandle.requestPermission({ mode: 'readwrite' });
                if (permission === 'granted') return FolderPickerWriter.fromHandle(localHandle);
            } catch {
                // no permission
            }
        }
        return null;
    }

    if (method === BulkDownloadMethod.Folder && hasFolderPicker) {
        const rememberFolder = modernSettings.rememberBulkDownloadFolder;
        const savedHandle = rememberFolder ? await db.getSetting('bulk_download_folder_handle') : null;
        // Try to reuse the saved handle silently first.
        if (savedHandle && typeof savedHandle.requestPermission === 'function') {
            try {
                const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
                if (permission === 'granted') return FolderPickerWriter.fromHandle(savedHandle);
            } catch {
                // fall through to picker
            }
        }
        // No usable saved handle - open the picker so the user can choose a folder.
        try {
            const writer = await FolderPickerWriter.create();
            if (rememberFolder) {
                await db.saveSetting('bulk_download_folder_handle', writer.getDirHandle());
            }
            return writer;
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                // User cancelled the picker - return null so we fall back to the
                // normal browser download instead of erroring out.
                return null;
            }
            return null;
        }
    }

    return null;
}

/**
 * Returns the appropriate bulk download writer for the current settings and environment,
 * or null when individual sequential downloads should be used.
 */
async function createBulkWriter(folderName) {
    const method = modernSettings.bulkDownloadMethod;
    const forceZipBlob = modernSettings.forceZipBlob;
    const hasFileSystemAccess = 'showSaveFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype;
    const hasFolderPicker = 'showDirectoryPicker' in window;

    // ── Local Media Folder method ────────────────────────────────────────────
    if (method === BulkDownloadMethod.LocalMedia) {
        const localHandle = await db.getSetting('local_folder_handle');
        if (hasFolderPicker) {
            // Browser mode: try to reuse the stored handle with write permission
            if (localHandle && typeof localHandle.requestPermission === 'function') {
                try {
                    const permission = await localHandle.requestPermission({ mode: 'readwrite' });
                    if (permission === 'granted') {
                        return FolderPickerWriter.fromHandle(localHandle);
                    }
                } catch {
                    // fall through to picker
                }
            }
            // No usable handle - prompt and persist
            try {
                const writer = await FolderPickerWriter.create();
                await db.saveSetting('local_folder_handle', writer.getDirHandle());
                return writer;
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    throw error;
                }
                return null;
            }
        }
        // Browser without File System Access API - fall through to ZIP
    }

    // ── Folder Picker method ─────────────────────────────────────────────────
    if (method === BulkDownloadMethod.Folder && hasFolderPicker) {
        const rememberFolder = modernSettings.rememberBulkDownloadFolder;
        const savedHandle = rememberFolder ? await db.getSetting('bulk_download_folder_handle') : null;
        try {
            const writer = await FolderPickerWriter.create(savedHandle);
            if (rememberFolder) {
                await db.saveSetting('bulk_download_folder_handle', writer.getDirHandle());
            } else {
                await db.saveSetting('bulk_download_folder_handle', null);
            }

            return writer;
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw error;
            }
            return null;
        }
    }

    if (method === BulkDownloadMethod.Individual) {
        return SequentialFileWriter;
    }
    // method === 'zip' (or folder picker unavailable as fallback)
    if (!forceZipBlob && hasFileSystemAccess) {
        return new ZipStreamWriter(`${folderName}.zip`);
    }
    return new ZipBlobWriter(`${folderName}.zip`);
}

async function startBulkDownload({
    tracks,
    folderName = '',
    api,
    quality,
    lyricsManager = LyricsManager.instance,
    type,
    name,
    coverBlob = null,
    metadata = null,
    single = false,
}) {
    const notification = createBulkDownloadNotification(type, name, tracks.length);

    try {
        const writer = single ? await createSingleTrackFolderWriter() : await createBulkWriter(folderName);

        if (writer) {
            await bulkDownload({
                tracks,
                folderName,
                api,
                quality,
                lyricsManager,
                notification,
                writer,
                coverBlob,
                type,
                metadata,
            });
        }

        completeBulkDownload(notification, true);

        // If the download went to the local media folder, refresh the local library.
        if (modernSettings.bulkDownloadMethod === BulkDownloadMethod.LocalMedia) {
            window.refreshLocalMediaFolder?.();
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            removeBulkDownloadTask(notification);
            return;
        }
        console.error('Bulk download failed:', error);
        completeBulkDownload(notification, false, error.message);
    }
}

export async function downloadTracks(tracks, api, quality, _lyricsManager = null) {
    const folderName = `Queue - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload({
        tracks,
        folderName,
        quality,
        type: 'queue',
        name: 'Queue',
        metadata: {
            title: 'Queue',
        },
        api,
    });
}

export async function downloadAlbum(album, tracks, api, quality, _lyricsManager = null) {
    const releaseDateStr =
        album.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
    const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
    const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';

    const folderName = formatPathTemplate(modernSettings.folderTemplate, {
        albumTitle: album.title,
        albumArtist: album.artist?.name,
        year: year,
    });

    const coverBlob = await getCoverBlob(api, album.cover || album.album?.cover || album.coverId);
    await startBulkDownload({
        tracks: await annotateTracksWithDiscInfo(tracks, api),
        folderName,
        quality,
        type: 'album',
        name: album.title,
        coverBlob,
        metadata: album,
        api,
    });
}

export async function downloadPlaylist(playlist, tracks, api, quality, _lyricsManager = null) {
    const folderName = formatPathTemplate(modernSettings.folderTemplate, {
        albumTitle: playlist.title,
        albumArtist: 'Playlist',
        year: new Date().getFullYear(),
    });

    const representativeTrack = tracks.find((t) => t.album?.cover);
    const coverBlob = await getCoverBlob(api, representativeTrack?.album?.cover);
    await startBulkDownload({
        tracks,
        folderName,
        quality,
        type: 'playlist',
        name: playlist.title,
        coverBlob,
        metadata: playlist,
        api,
    });
}

export async function downloadDiscography(artist, selectedReleases, api, quality, lyricsManager = null) {
    const rootFolder = `${sanitizeForFilename(artist.name)} discography`;
    const notification = createBulkDownloadNotification('discography', artist.name, selectedReleases.length);
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    async function* yieldDiscography() {
        for (let albumIndex = 0; albumIndex < selectedReleases.length; albumIndex++) {
            if (signal.aborted) break;
            const album = selectedReleases[albumIndex];
            updateBulkDownloadProgress(notification, albumIndex, selectedReleases.length, album.title);

            try {
                const { album: fullAlbum, tracks: rawTracks } = await api.getAlbum(album.id);
                const tracks = await annotateTracksWithDiscInfo(rawTracks, api);
                const coverBlob = await getCoverBlob(api, fullAlbum.cover || album.cover);
                const releaseDateStr =
                    fullAlbum.releaseDate ||
                    (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
                const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
                const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';

                const albumFolder = formatPathTemplate(modernSettings.folderTemplate, {
                    albumTitle: fullAlbum.title,
                    albumArtist: fullAlbum.artist?.name,
                    year: year,
                });

                const fullFolderPath = `${rootFolder}/${albumFolder}`;
                if (coverBlob && playlistSettings.shouldIncludeCover())
                    yield { name: `${fullFolderPath}/cover.jpg`, lastModified: new Date(), input: coverBlob };

                // Generate playlist files for each album
                const useRelativePaths = playlistSettings.shouldUseRelativePaths();
                const discLayout = await createDiscLayoutContext(tracks, api);
                const separateByDisc = discLayout.separateByDisc;

                // Download tracks, yielding each immediately and collecting actual paths for playlist generation
                const trackPaths = [];
                for (let i = 0; i < tracks.length; i++) {
                    const track = tracks[i];
                    if (signal.aborted) break;
                    try {
                        const { blob, extension } = await downloadTrackBlob(track, quality, api, signal, null);
                        const filename = buildTrackFilename(track, quality, extension);
                        const discNumber = discLayout.resolveDiscNumber(i);
                        const discPath = separateByDisc ? `${getDiscFolderName(discNumber)}/${filename}` : filename;

                        trackPaths.push(discPath);

                        yield {
                            name: buildZipTrackPath(fullFolderPath, filename, separateByDisc, discNumber),
                            lastModified: new Date(),
                            input: blob,
                        };

                        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                            try {
                                const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                                if (lyricsData) {
                                    const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                                    if (lrcContent) {
                                        const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                        yield {
                                            name: buildZipTrackPath(
                                                fullFolderPath,
                                                lrcFilename,
                                                separateByDisc,
                                                discNumber
                                            ),
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
                        trackPaths.push(null);
                    }
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
                    const cueContent = generateCUE(fullAlbum, tracks, sanitizeForFilename(fullAlbum.title), trackPaths);
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.cue`,
                        lastModified: new Date(),
                        input: cueContent,
                    };
                }

                // Generate m3u/m3u8 last, using actual track paths collected during download
                if (playlistSettings.shouldGenerateM3U()) {
                    const m3uContent = generateM3U(fullAlbum, tracks, useRelativePaths, null, 'flac', trackPaths);
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.m3u`,
                        lastModified: new Date(),
                        input: m3uContent,
                    };
                }

                if (playlistSettings.shouldGenerateM3U8()) {
                    const m3u8Content = generateM3U8(fullAlbum, tracks, useRelativePaths, null, 'flac', trackPaths);
                    yield {
                        name: `${fullFolderPath}/${sanitizeForFilename(fullAlbum.title)}.m3u8`,
                        lastModified: new Date(),
                        input: m3u8Content,
                    };
                }
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                console.error(`Failed to download album ${album.title}:`, error);
            }
        }
    }

    try {
        const writer = await createBulkWriter(rootFolder);

        if (writer) {
            await writer.write(yieldDiscography());
        }

        completeBulkDownload(notification, true);
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

    const typeLabel = (() => {
        switch (type) {
            case 'album':
                return 'Album';
            case 'playlist':
                return 'Playlist';
            case 'liked':
                return 'Liked Tracks';
            case 'queue':
                return 'Queue';
            case 'discography':
                return 'Discography';
            default:
                return '';
        }
    })();

    notifEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem;">
                    Downloading ${typeLabel}
                </div>
                <div style="font-size: 0.85rem; color: var(--muted-foreground); margin-bottom: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</div>
                <div class="download-progress-bar" style="height: 4px; background: var(--secondary); border-radius: 2px; overflow: hidden;">
                    <div class="download-progress-fill" style="width: 0%; height: 100%; background: var(--highlight); transition: width 0.2s;"></div>
                </div>
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Starting...</div>
            </div>
            <button class="download-cancel" style="background: transparent; border: none; color: var(--muted-foreground); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                ${SVG_CLOSE(20)}
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

/**
 *
 * @param {HTMLElement} notifEl
 * @param {number} current
 * @param {number} total
 * @param {string} currentItem
 * @param {FfmpegProgress | ProgressMessage | null} progress
 * @returns
 */
function updateBulkDownloadProgress(notifEl, current, total, currentItem, progress = null) {
    /** @type {HTMLElement | null} */
    const progressFill = notifEl.querySelector('.download-progress-fill');

    /** @type {HTMLElement | null} */
    const statusEl = notifEl.querySelector('.download-status');

    if (!progressFill || !statusEl) {
        console.log('Progress elements not found in notification');
        return;
    }

    if (progress instanceof FfmpegProgress) {
        if (progress.stage == 'stdout' || progress.stage == 'parsing') {
            return;
        }

        const percent = progress.progress || 0;
        progressFill.style.width = `${percent}%`;
        progressFill.style.background = '#3b82f6'; // Blue for encoding
        statusEl.textContent = `Converting ${Math.floor(current + 1)}/${total}: ${Math.round(percent)}%`;
        return;
    }

    if (progress instanceof ProgressMessage) {
        statusEl.textContent = progress.message;
    }

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    progressFill.style.background = 'var(--highlight)';
    statusEl.textContent = `${Math.floor(current + 1)}/${total} - ${currentItem}`;
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

/**
 * Downloads a track with metadata and optionally lyrics.
 * @async
 * @param {Object} track - The track object to download
 * @param {string} quality - The desired audio quality for download
 * @param {MusicAPI | LosslessAPI} [api=MusicAPI.instance] - The API instance to use for downloading
 * @param {Object} [lyricsManager=null] - Optional manager for fetching and processing lyrics
 * @param {AbortController} [abortController=null] - Optional abort controller for cancelling the download
 * @returns {Promise<void>}
 * @throws {Error} If the download fails (except for AbortError)
 * @description
 * This function:
 * - Validates that a track is provided
 * - Prevents duplicate downloads of the same track
 * - Enriches track metadata via the API
 * - Downloads the audio blob with progress tracking
 * - Organizes the file into subfolders based on the folder template
 * - Optionally downloads and saves lyrics in LRC format
 * - Updates the local media folder cache if using LocalMedia download method
 * - Handles errors gracefully and updates download task status
 */
export async function downloadTrackWithMetadata(
    track,
    quality,
    api = MusicAPI.instance,
    lyricsManager = null,
    abortController = null
) {
    if (!track) {
        alert('No track is currently playing');
        return;
    }

    /** @type {LosslessAPI} */
    const tidalAPI = api.tidalAPI || api;

    const downloadKey = `track-${track.id}`;
    if (ongoingDownloads.has(downloadKey)) {
        showNotification('This track is already being downloaded');
        return;
    }

    const { enrichedTrack } = await tidalAPI.enrichTrack(track, { downloadQuality: quality });
    const filename = buildTrackFilename(enrichedTrack, quality);

    const controller = abortController || new AbortController();
    ongoingDownloads.add(downloadKey);

    try {
        // Resolve the folder writer before registering the download task so that
        // any permission prompt (requestPermission) shows before the UI task appears.
        const folderWriter = (await createSingleTrackFolderWriter()) || SequentialFileWriter;

        addDownloadTask(track.id, enrichedTrack, filename, api, controller);

        // Download the blob (metadata already applied inside downloadTrack)
        const blob = await api.downloadTrack(track.id, quality, filename, {
            signal: controller.signal,
            track: enrichedTrack,
            onProgress: (progress) => {
                updateDownloadProgress(track.id, progress);
            },
            calculateDashBytes: true,
            triggerDownload: false,
        });

        const finalFilename = buildTrackFilename(track, quality, await getExtensionFromBlob(blob))
            .split('/')
            .pop();

        // Compute a subfolder path using the same template as bulk downloads so
        // the track lands in e.g. "Album Title - Artist/" instead of the folder root.
        const releaseDateStr =
            enrichedTrack.album?.releaseDate ||
            (enrichedTrack.streamStartDate ? enrichedTrack.streamStartDate.split('T')[0] : '');
        const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
        const releaseYear = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';
        const subFolder = formatPathTemplate(modernSettings.folderTemplate, {
            albumTitle: enrichedTrack.album?.title,
            albumArtist: enrichedTrack.album?.artist?.name || enrichedTrack.artist?.name,
            year: releaseYear,
        });
        const entryName = subFolder ? `${subFolder}/${finalFilename}` : finalFilename;

        // Write to folder using IBulkDownloadWriter.write() via singleWriterEntry().
        await folderWriter.write(singleWriterEntry({ name: entryName, lastModified: new Date(), input: blob }));

        if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
            try {
                const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                if (lyricsData) {
                    await folderWriter.write(
                        singleWriterEntry({
                            name: [...entryName.split('.').slice(0, -1), 'lrc'].join('.'),
                            lastModified: new Date(),
                            input: lyricsManager.getLRC(lyricsData, track),
                        })
                    );
                }
            } catch {
                console.log('Could not download lyrics for track');
            }
        }

        // If the target is the local media folder, do a cheap partial update:
        // pass the downloaded blob and base filename so only this one track's metadata
        // is read and inserted into localFilesCache instead of re-walking the whole folder.
        if (modernSettings.bulkDownloadMethod === BulkDownloadMethod.LocalMedia) {
            window.refreshLocalMediaFolder?.(blob, finalFilename);
        }

        completeDownloadTask(track.id, true);
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

export async function downloadLikedTracks(tracks, api, quality, _lyricsManager = null) {
    const folderName = `Liked Tracks - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload({
        tracks,
        folderName,
        quality,
        type: 'liked',
        name: 'Liked Tracks',
        api,
    });
}
