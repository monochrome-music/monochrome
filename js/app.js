import { LosslessAPI } from './api.js';
import { apiSettings, themeManager, lastFMStorage } from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { LastFMScrobbler } from './lastfm.js';
import { 
    REPEAT_MODE, SVG_PLAY, SVG_PAUSE, 
    SVG_VOLUME, SVG_MUTE, formatTime, trackDataStore,
    buildTrackFilename, RATE_LIMIT_ERROR_MESSAGE, debounce,
    sanitizeForFilename,
    getTrackTitle
} from './utils.js';

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

function addDownloadTask(trackId, track, filename, api) {
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

function updateDownloadProgress(trackId, progress) {
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

function completeDownloadTask(trackId, success = true, message = null) {
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
    
    const blob = await response.blob();
    return blob;
}

async function downloadAlbumAsZip(album, tracks, api, quality) {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    
    const artistName = sanitizeForFilename(album.artist?.name || 'Unknown Artist');
    const albumTitle = sanitizeForFilename(album.title || 'Unknown Album');
    const folderName = `${albumTitle} - ${artistName} - monochrome.tf`;
    
    const notification = createBulkDownloadNotification('album', album.title, tracks.length);
    
    try {
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const filename = buildTrackFilename(track, quality);
            const trackTitle = getTrackTitle(track);
            
            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);
            
            const blob = await downloadTrackBlob(track, quality, api);
            zip.file(`${folderName}/${filename}`, blob);
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

async function downloadDiscography(artist, api, quality) {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    
    const artistName = sanitizeForFilename(artist.name || 'Unknown Artist');
    const rootFolder = `${artistName} discography - monochrome.tf`;
    
    const totalAlbums = artist.albums.length;
    const notification = createBulkDownloadNotification('discography', artist.name, totalAlbums);
    
    try {
        for (let albumIndex = 0; albumIndex < artist.albums.length; albumIndex++) {
            const album = artist.albums[albumIndex];
            
            updateBulkDownloadProgress(notification, albumIndex, totalAlbums, album.title);
            
            try {
                const { album: fullAlbum, tracks } = await api.getAlbum(album.id);
                const albumTitle = sanitizeForFilename(fullAlbum.title || 'Unknown Album');
                const albumFolder = `${rootFolder}/${albumTitle}`;
                
                for (const track of tracks) {
                    const filename = buildTrackFilename(track, quality);
                    const blob = await downloadTrackBlob(track, quality, api);
                    zip.file(`${albumFolder}/${filename}`, blob);
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

async function loadHomeFeed(api) {
    try {
        const response = await api.fetchWithRetry('/home/');
        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) return null;
        
        const homeData = data[0];
        return homeData;
    } catch (error) {
        console.error('Failed to load home feed:', error);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const api = new LosslessAPI(apiSettings);
    const ui = new UIRenderer(api);
    
    const audioPlayer = document.getElementById('audio-player');
    const currentQuality = localStorage.getItem('playback-quality') || 'LOSSLESS';
    const player = new Player(audioPlayer, api, currentQuality);
    
    const scrobbler = new LastFMScrobbler();
    
    const savedCrossfade = localStorage.getItem('crossfade-enabled') === 'true';
    const savedCrossfadeDuration = parseInt(localStorage.getItem('crossfade-duration') || '5');
    player.setCrossfade(savedCrossfade, savedCrossfadeDuration);
    
    const currentTheme = themeManager.getTheme();
    themeManager.setTheme(currentTheme);
    
    const mainContent = document.querySelector('.main-content');
    const playPauseBtn = document.querySelector('.play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const currentTimeEl = document.getElementById('current-time');
    const totalDurationEl = document.getElementById('total-duration');
    const volumeBar = document.getElementById('volume-bar');
    const volumeFill = document.getElementById('volume-fill');
    const volumeBtn = document.getElementById('volume-btn');
    const contextMenu = document.getElementById('context-menu');
    const queueBtn = document.getElementById('queue-btn');
    const queueModalOverlay = document.getElementById('queue-modal-overlay');
    const closeQueueBtn = document.getElementById('close-queue-btn');
    const queueList = document.getElementById('queue-list');
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const hamburgerBtn = document.getElementById('hamburger-btn');

    let contextTrack = null;
    let draggedQueueIndex = null;

    const lastfmConnectBtn = document.getElementById('lastfm-connect-btn');
    const lastfmStatus = document.getElementById('lastfm-status');
    const lastfmToggle = document.getElementById('lastfm-toggle');
    const lastfmToggleSetting = document.getElementById('lastfm-toggle-setting');

    window.loadHomeFeed = loadHomeFeed;

    function updateLastFMUI() {
        if (scrobbler.isAuthenticated()) {
            lastfmStatus.textContent = `Connected as ${scrobbler.username}`;
            lastfmConnectBtn.textContent = 'Disconnect';
            lastfmConnectBtn.classList.add('danger');
            lastfmToggleSetting.style.display = 'flex';
            lastfmToggle.checked = lastFMStorage.isEnabled();
        } else {
            lastfmStatus.textContent = 'Connect your Last.fm account to scrobble tracks';
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.classList.remove('danger');
            lastfmToggleSetting.style.display = 'none';
        }
    }

    updateLastFMUI();

    lastfmConnectBtn?.addEventListener('click', async () => {
        if (scrobbler.isAuthenticated()) {
            if (confirm('Disconnect from Last.fm?')) {
                scrobbler.disconnect();
                updateLastFMUI();
            }
            return;
        }

        const authWindow = window.open('', '_blank');

        lastfmConnectBtn.disabled = true;
        lastfmConnectBtn.textContent = 'Opening Last.fm...';

        try {
            const { token, url } = await scrobbler.getAuthUrl();

            if (authWindow) {
                authWindow.location.href = url;
            } else {
                alert('Popup blocked! Please allow popups.');
                lastfmConnectBtn.textContent = 'Connect Last.fm';
                lastfmConnectBtn.disabled = false;
                return;
            }

            lastfmConnectBtn.textContent = 'Waiting for authorization...';

            let attempts = 0;
            const maxAttempts = 30;

            const checkAuth = setInterval(async () => {
                attempts++;

                if (attempts > maxAttempts) {
                    clearInterval(checkAuth);
                    lastfmConnectBtn.textContent = 'Connect Last.fm';
                    lastfmConnectBtn.disabled = false;
                    if (authWindow && !authWindow.closed) authWindow.close();
                    alert('Authorization timed out. Please try again.');
                    return;
                }

                try {
                    const result = await scrobbler.completeAuthentication(token);

                    if (result.success) {
                        clearInterval(checkAuth);
                        if (authWindow && !authWindow.closed) authWindow.close();
                        updateLastFMUI();
                        lastfmConnectBtn.disabled = false;
                        lastFMStorage.setEnabled(true);
                        lastfmToggle.checked = true;
                        alert(`Successfully connected to Last.fm as ${result.username}!`);
                    }
                } catch (e) {
                }
            }, 2000);

        } catch (error) {
            console.error('Last.fm connection failed:', error);
            alert('Failed to connect to Last.fm: ' + error.message);
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.disabled = false;
            if (authWindow && !authWindow.closed) authWindow.close();
        }
    });

    lastfmToggle?.addEventListener('change', (e) => {
        lastFMStorage.setEnabled(e.target.checked);
    });

    const themePicker = document.getElementById('theme-picker');
    themePicker.querySelectorAll('.theme-option').forEach(option => {
        if (option.dataset.theme === currentTheme) {
            option.classList.add('active');
        }
        
        option.addEventListener('click', () => {
            const theme = option.dataset.theme;
            
            themePicker.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            if (theme === 'custom') {
                document.getElementById('custom-theme-editor').classList.add('show');
                renderCustomThemeEditor();
            } else {
                document.getElementById('custom-theme-editor').classList.remove('show');
                themeManager.setTheme(theme);
            }
        });
    });

    document.getElementById('refresh-speed-test-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('refresh-speed-test-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Testing...';
        btn.disabled = true;
        
        try {
            await apiSettings.refreshSpeedTests();
            ui.renderApiSettings();
            btn.textContent = 'Done!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        } catch (error) {
            console.error('Failed to refresh speed tests:', error);
            btn.textContent = 'Error';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        }
    });

    function renderCustomThemeEditor() {
        const grid = document.getElementById('theme-color-grid');
        const customTheme = themeManager.getCustomTheme() || {
            background: '#000000',
            foreground: '#fafafa',
            primary: '#ffffff',
            secondary: '#27272a',
            muted: '#27272a',
            border: '#27272a',
            highlight: '#ffffff'
        };
        
        grid.innerHTML = Object.entries(customTheme).map(([key, value]) => `
            <div class="theme-color-input">
                <label>${key}</label>
                <input type="color" data-color="${key}" value="${value}">
            </div>
        `).join('');
    }

    document.getElementById('apply-custom-theme')?.addEventListener('click', () => {
        const colors = {};
        document.querySelectorAll('#theme-color-grid input[type="color"]').forEach(input => {
            colors[input.dataset.color] = input.value;
        });
        themeManager.setCustomTheme(colors);
    });

    document.getElementById('reset-custom-theme')?.addEventListener('click', () => {
        renderCustomThemeEditor();
    });

    const crossfadeToggle = document.getElementById('crossfade-toggle');
    const crossfadeDurationSetting = document.getElementById('crossfade-duration-setting');
    const crossfadeDurationInput = document.getElementById('crossfade-duration');
    
    crossfadeToggle.checked = savedCrossfade;
    crossfadeDurationSetting.style.display = savedCrossfade ? 'flex' : 'none';
    crossfadeDurationInput.value = savedCrossfadeDuration;
    
    crossfadeToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        localStorage.setItem('crossfade-enabled', enabled);
        crossfadeDurationSetting.style.display = enabled ? 'flex' : 'none';
        player.setCrossfade(enabled, parseInt(crossfadeDurationInput.value));
    });
    
    crossfadeDurationInput.addEventListener('change', (e) => {
        const duration = parseInt(e.target.value);
        localStorage.setItem('crossfade-duration', duration);
        player.setCrossfade(crossfadeToggle.checked, duration);
    });

    const qualitySetting = document.getElementById('quality-setting');
    if (qualitySetting) {
        const savedQuality = localStorage.getItem('playback-quality') || 'LOSSLESS';
        qualitySetting.value = savedQuality;
        player.setQuality(savedQuality);
        
        qualitySetting.addEventListener('change', (e) => {
            const newQuality = e.target.value;
            player.setQuality(newQuality);
            localStorage.setItem('playback-quality', newQuality);
        });
    }

    const normalizeToggle = document.querySelectorAll('.setting-item').forEach(item => {
        const label = item.querySelector('.label');
        if (label && label.textContent.includes('Normalize Volume')) {
            const toggle = item.querySelector('input[type="checkbox"]');
            if (toggle) {
                toggle.checked = localStorage.getItem('normalize-volume') === 'true';
                toggle.addEventListener('change', (e) => {
                    localStorage.setItem('normalize-volume', e.target.checked ? 'true' : 'false');
                });
            }
        }
    });

    document.querySelector('.now-playing-bar .title').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.album?.id) {
            window.location.hash = `#album/${track.album.id}`;
        }
    });

    document.querySelector('.now-playing-bar .artist').addEventListener('click', () => {
        const track = player.currentTrack;
        if (track?.artist?.id) {
            window.location.hash = `#artist/${track.artist.id}`;
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#play-album-btn')) {
            const btn = e.target.closest('#play-album-btn');
            if (btn.disabled) return;
            
            const albumId = window.location.hash.split('/')[1];
            if (!albumId) return;
            
            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks.length > 0) {
                    player.setQueue(tracks, 0);
                    shuffleBtn.classList.remove('active');
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play album:', error);
                alert('Failed to play album: ' + error.message);
            }
        }
        
        if (e.target.closest('#download-album-btn')) {
            const btn = e.target.closest('#download-album-btn');
            if (btn.disabled) return;
            
            const albumId = window.location.hash.split('/')[1];
            if (!albumId) return;
            
            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';
            
            try {
                const { album, tracks } = await api.getAlbum(albumId);
                await downloadAlbumAsZip(album, tracks, api, player.quality);
            } catch (error) {
                console.error('Album download failed:', error);
                alert('Failed to download album: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }
        
        if (e.target.closest('#download-discography-btn')) {
            const btn = e.target.closest('#download-discography-btn');
            if (btn.disabled) return;
            
            const artistId = window.location.hash.split('/')[1];
            if (!artistId) return;
            
            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';
            
            try {
                const artist = await api.getArtist(artistId);
                await downloadDiscography(artist, api, player.quality);
            } catch (error) {
                console.error('Discography download failed:', error);
                alert('Failed to download discography: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }
    });

    document.querySelectorAll('.search-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.search-tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`search-tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    const router = () => {
        const path = window.location.hash.substring(1) || "home";
        const [page, param] = path.split('/');
        
        switch (page) {
            case 'search':
                ui.renderSearchPage(decodeURIComponent(param));
                break;
            case 'album':
                ui.renderAlbumPage(param);
                break;
            case 'artist':
                ui.renderArtistPage(param);
                break;
            case 'home':
                ui.renderHomePage();
                break;
            default:
                ui.showPage(page);
                break;
        }
    };

    const renderQueue = () => {
        const currentQueue = player.getCurrentQueue();
        
        if (currentQueue.length === 0) {
            queueList.innerHTML = '<div class="placeholder-text">Queue is empty.</div>';
            return;
        }
        
        const html = currentQueue.map((track, index) => {
            const isPlaying = index === player.currentQueueIndex;
            const trackTitle = getTrackTitle(track);
            
            return `
                <div class="queue-track-item ${isPlaying ? 'playing' : ''}" data-queue-index="${index}" data-track-id="${track.id}" draggable="true">
                    <div class="drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="8" x2="19" y2="8"></line>
                            <line x1="5" y1="16" x2="19" y2="16"></line>
                        </svg>
                    </div>
                    <div class="track-item-info">
                        <img src="${api.getCoverUrl(track.album?.cover, '80')}" 
                             class="track-item-cover" loading="lazy">
                        <div class="track-item-details">
                            <div class="title">${trackTitle}</div>
                            <div class="artist">${track.artist?.name || 'Unknown'}</div>
                        </div>
                    </div>
                    <div class="track-item-duration">${formatTime(track.duration)}</div>
                    <button class="track-menu-btn" data-track-index="${index}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="12" cy="5" r="1"></circle>
                            <circle cx="12" cy="19" r="1"></circle>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
        
        queueList.innerHTML = html;
        
        queueList.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);
            
            item.addEventListener('click', (e) => {
                if (e.target.closest('.track-menu-btn')) return;
                player.playAtIndex(index);
                renderQueue();
            });
            
            item.addEventListener('dragstart', (e) => {
                draggedQueueIndex = index;
                item.style.opacity = '0.5';
            });
            
            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedQueueIndex !== null && draggedQueueIndex !== index) {
                    player.moveInQueue(draggedQueueIndex, index);
                    renderQueue();
                }
            });
        });
        
        queueList.querySelectorAll('.track-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.trackIndex);
                showQueueTrackMenu(e, index);
            });
        });
    };

    function showQueueTrackMenu(e, trackIndex) {
        const menu = document.getElementById('queue-track-menu');
        menu.style.top = `${e.pageY}px`;
        menu.style.left = `${e.pageX}px`;
        menu.classList.add('show');
        menu.dataset.trackIndex = trackIndex;
        
        document.addEventListener('click', hideQueueTrackMenu);
    }

    function hideQueueTrackMenu() {
        const menu = document.getElementById('queue-track-menu');
        menu.classList.remove('show');
        document.removeEventListener('click', hideQueueTrackMenu);
    }

    document.getElementById('queue-track-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        const menu = document.getElementById('queue-track-menu');
        const trackIndex = parseInt(menu.dataset.trackIndex);
        
        if (action === 'remove') {
            player.removeFromQueue(trackIndex);
            renderQueue();
        }
        
        hideQueueTrackMenu();
    });

    mainContent.addEventListener('click', e => {
        const menuBtn = e.target.closest('.track-menu-btn');
        if (menuBtn) {
            e.stopPropagation();
            const trackItem = menuBtn.closest('.track-item');
            if (trackItem && !trackItem.dataset.queueIndex) {
                contextTrack = trackDataStore.get(trackItem);
                if (contextTrack) {
                    const rect = menuBtn.getBoundingClientRect();
                    contextMenu.style.top = `${rect.bottom + 5}px`;
                    contextMenu.style.left = `${rect.left}px`;
                    contextMenu.style.display = 'block';
                }
            }
            return;
        }
        
        const trackItem = e.target.closest('.track-item');
        if (trackItem && !trackItem.dataset.queueIndex) {
            const parentList = trackItem.closest('.track-list');
            const allTrackElements = Array.from(parentList.querySelectorAll('.track-item'));
            const trackList = allTrackElements.map(el => trackDataStore.get(el)).filter(Boolean);
            
            if (trackList.length > 0) {
                const clickedTrackId = trackItem.dataset.trackId;
                const startIndex = trackList.findIndex(t => t.id == clickedTrackId);
                
                player.setQueue(trackList, startIndex);
                shuffleBtn.classList.remove('active');
                player.playTrackFromQueue();
            }
        }
    });

    mainContent.addEventListener('contextmenu', e => {
        const trackItem = e.target.closest('.track-item');
        if (trackItem && !trackItem.dataset.queueIndex) {
            e.preventDefault();
            contextTrack = trackDataStore.get(trackItem);
            
            if (contextTrack) {
                contextMenu.style.top = `${e.pageY}px`;
                contextMenu.style.left = `${e.pageX}px`;
                contextMenu.style.display = 'block';
            }
        }
    });

    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });

    contextMenu.addEventListener('click', async e => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        
        if (action === 'add-to-queue' && contextTrack) {
            player.addToQueue(contextTrack);
            renderQueue();
        } else if (action === 'download' && contextTrack) {
            const quality = player.quality;
            const filename = buildTrackFilename(contextTrack, quality);
            
            try {
                const { taskEl, abortController } = addDownloadTask(
                    contextTrack.id,
                    contextTrack,
                    filename,
                    api
                );
                
                await api.downloadTrack(contextTrack.id, quality, filename, {
                    signal: abortController.signal,
                    onProgress: (progress) => {
                        updateDownloadProgress(contextTrack.id, progress);
                    }
                });
                
                completeDownloadTask(contextTrack.id, true);
            } catch (error) {
                if (error.name !== 'AbortError') {
                    const errorMsg = error.message === RATE_LIMIT_ERROR_MESSAGE 
                        ? error.message 
                        : 'Download failed. Please try again.';
                    completeDownloadTask(contextTrack.id, false, errorMsg);
                }
            }
        }
        
        contextMenu.style.display = 'none';
    });

    const performSearch = debounce((query) => {
        if (query) {
            window.location.hash = `#search/${encodeURIComponent(query)}`;
        }
    }, 300);

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 2) {
            performSearch(query);
        }
    });

    searchForm.addEventListener('submit', e => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            window.location.hash = `#search/${encodeURIComponent(query)}`;
        }
    });

    audioPlayer.addEventListener('play', () => {
        if (scrobbler.isAuthenticated() && lastFMStorage.isEnabled() && player.currentTrack) {
            scrobbler.updateNowPlaying(player.currentTrack);
        }
        playPauseBtn.innerHTML = SVG_PAUSE;
        player.updateMediaSessionPlaybackState();
    });

    audioPlayer.addEventListener('pause', () => {
        playPauseBtn.innerHTML = SVG_PLAY;
        player.updateMediaSessionPlaybackState();
    });

    audioPlayer.addEventListener('ended', () => {
        player.playNext();
    });

    audioPlayer.addEventListener('timeupdate', () => {
        const { currentTime, duration } = audioPlayer;
        if (duration) {
            progressFill.style.width = `${(currentTime / duration) * 100}%`;
            currentTimeEl.textContent = formatTime(currentTime);
            player.updateMediaSessionPositionState();
        }
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        totalDurationEl.textContent = formatTime(audioPlayer.duration);
        player.updateMediaSessionPositionState();
    });

    audioPlayer.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        document.querySelector('.now-playing-bar .artist').textContent = 'Playback error. Try another track.';
        playPauseBtn.innerHTML = SVG_PLAY;
    });

    let isSeeking = false;
    let wasPlaying = false;

    const seek = (bar, fill, event, setter) => {
        const rect = bar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        setter(position);
    };

    progressBar.addEventListener('mousedown', () => {
        isSeeking = true;
        wasPlaying = !audioPlayer.paused;
        if (wasPlaying) audioPlayer.pause();
    });

    document.addEventListener('mouseup', (e) => {
        if (isSeeking) {
            seek(progressBar, progressFill, e, position => {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    player.updateMediaSessionPositionState();
                    if (wasPlaying) audioPlayer.play();
                }
            });
            isSeeking = false;
        }
    });

    progressBar.addEventListener('click', e => {
        if (!isSeeking) {
            seek(progressBar, progressFill, e, position => {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = position * audioPlayer.duration;
                    player.updateMediaSessionPositionState();
                }
            });
        }
    });

    volumeBar.addEventListener('click', e => {
        seek(volumeBar, volumeFill, e, position => {
            audioPlayer.volume = position;
        });
    });

    const updateVolumeUI = () => {
        const { volume, muted } = audioPlayer;
        volumeBtn.innerHTML = (muted || volume === 0) ? SVG_MUTE : SVG_VOLUME;

        const effectiveVolume = muted ? 0 : volume * 100;

        volumeFill.style.setProperty('--volume-level', `${effectiveVolume}%`);
    };

    volumeBtn.addEventListener('click', () => {
        audioPlayer.muted = !audioPlayer.muted;
    });

    audioPlayer.addEventListener('volumechange', updateVolumeUI);

    playPauseBtn.addEventListener('click', () => player.handlePlayPause());
    nextBtn.addEventListener('click', () => player.playNext());
    prevBtn.addEventListener('click', () => player.playPrev());

    shuffleBtn.addEventListener('click', () => {
        player.toggleShuffle();
        shuffleBtn.classList.toggle('active', player.shuffleActive);
        renderQueue();
    });

    repeatBtn.addEventListener('click', () => {
        const mode = player.toggleRepeat();
        repeatBtn.classList.toggle('active', mode !== REPEAT_MODE.OFF);
        repeatBtn.classList.toggle('repeat-one', mode === REPEAT_MODE.ONE);
        repeatBtn.title = mode === REPEAT_MODE.OFF 
            ? 'Repeat' 
            : (mode === REPEAT_MODE.ALL ? 'Repeat Queue' : 'Repeat One');
    });

    queueBtn.addEventListener('click', () => {
        renderQueue();
        queueModalOverlay.style.display = 'flex';
    });

    closeQueueBtn.addEventListener('click', () => {
        queueModalOverlay.style.display = 'none';
    });

    queueModalOverlay.addEventListener('click', e => {
        if (e.target === queueModalOverlay) {
            queueModalOverlay.style.display = 'none';
        }
    });

    hamburgerBtn.addEventListener('click', () => {
        sidebar.classList.add('is-open');
        sidebarOverlay.classList.add('is-visible');
    });

    const closeSidebar = () => {
        sidebar.classList.remove('is-open');
        sidebarOverlay.classList.remove('is-visible');
    };

    sidebarOverlay.addEventListener('click', closeSidebar);
    
    sidebar.addEventListener('click', e => {
        if (e.target.closest('a')) {
            closeSidebar();
        }
    });

    document.getElementById('api-instance-list').addEventListener('click', async e => {
        const button = e.target.closest('button');
        if (!button) return;
        
        const li = button.closest('li');
        const index = parseInt(li.dataset.index, 10);
        const instances = await apiSettings.getInstances();
        
        if (button.classList.contains('move-up') && index > 0) {
            [instances[index], instances[index - 1]] = [instances[index - 1], instances[index]];
        } else if (button.classList.contains('move-down') && index < instances.length - 1) {
            [instances[index], instances[index + 1]] = [instances[index + 1], instances[index]];
        }
        
        apiSettings.saveInstances(instances);
        ui.renderApiSettings();
    });

    document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('clear-cache-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Clearing...';
        btn.disabled = true;
        
        try {
            await api.clearCache();
            btn.textContent = 'Cleared!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
                if (window.location.hash.includes('settings')) {
                    ui.renderApiSettings();
                }
            }, 1500);
        } catch (error) {
            console.error('Failed to clear cache:', error);
            btn.textContent = 'Error';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        }
    });

    playPauseBtn.innerHTML = SVG_PLAY;
    updateVolumeUI();
    router();
    window.addEventListener('hashchange', router);

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service worker registered'))
                .catch(err => console.log('Service worker not registered', err));
        });
    }

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });
});
