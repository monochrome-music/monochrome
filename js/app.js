//js/app.js
import { LosslessAPI } from './api.js';
import { apiSettings } from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { 
    QUALITY, REPEAT_MODE, SVG_PLAY, SVG_PAUSE, 
    SVG_VOLUME, SVG_MUTE, formatTime, trackDataStore,
    buildTrackFilename, RATE_LIMIT_ERROR_MESSAGE
} from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const api = new LosslessAPI(apiSettings);
    const ui = new UIRenderer(api);
    
    const audioPlayer = document.getElementById('audio-player');
    const player = new Player(audioPlayer, api, QUALITY);
    
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
        if (!queueModalOverlay.style.display || queueModalOverlay.style.display === "none") {
            return;
        }
        
        const currentQueue = player.getCurrentQueue();
        
        if (currentQueue.length === 0) {
            queueList.innerHTML = '<div class="placeholder-text">Queue is empty.</div>';
            return;
        }
        
        const html = currentQueue.map((track, index) => {
            const isPlaying = index === player.currentQueueIndex && 
                              track.id === (currentQueue[player.currentQueueIndex] || {}).id;
            
            return `
                <div class="track-item ${isPlaying ? 'playing' : ''}" data-queue-index="${index}">
                    <div class="track-number">${index + 1}</div>
                    <div class="track-item-info">
                        <img src="${api.getCoverUrl(track.album?.cover, '40')}" 
                             class="track-item-cover" loading="lazy">
                        <div class="track-item-details">
                            <div class="title">${track.title}</div>
                            <div class="artist">${track.artist?.name || 'Unknown'}</div>
                        </div>
                    </div>
                    <div class="track-item-duration">${formatTime(track.duration)}</div>
                </div>
            `;
        }).join('');
        
        queueList.innerHTML = html;
        player.updatePlayingTrackIndicator();
    };

    mainContent.addEventListener('click', e => {
        const trackItem = e.target.closest('.track-item');
        if (trackItem) {
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
        if (trackItem) {
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
            const filename = buildTrackFilename(contextTrack, QUALITY);
            
            try {
                const tempEl = document.createElement('div');
                tempEl.textContent = `Downloading: ${contextTrack.title}...`;
                tempEl.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--card);padding:1rem;border-radius:var(--radius);border:1px solid var(--border);z-index:9999;';
                document.body.appendChild(tempEl);
                
                await api.downloadTrack(contextTrack.id, QUALITY, filename);
                
                tempEl.textContent = `Downloaded: ${contextTrack.title}`;
                setTimeout(() => tempEl.remove(), 3000);
            } catch (error) {
                const errorMsg = error.message === RATE_LIMIT_ERROR_MESSAGE 
                    ? error.message 
                    : 'Download failed. Please try again.';
                alert(errorMsg);
            }
        }
        
        contextMenu.style.display = 'none';
    });

    searchForm.addEventListener('submit', e => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            window.location.hash = `#search/${encodeURIComponent(query)}`;
        }
    });

    audioPlayer.addEventListener('play', () => {
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

    const seek = (bar, fill, event, setter) => {
        const rect = bar.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        setter(position);
    };

    progressBar.addEventListener('click', e => {
        seek(progressBar, progressFill, e, position => {
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = position * audioPlayer.duration;
            }
        });
    });

    volumeBar.addEventListener('click', e => {
        seek(volumeBar, volumeFill, e, position => {
            audioPlayer.volume = position;
        });
    });

    const updateVolumeUI = () => {
        const { volume, muted } = audioPlayer;
        volumeBtn.innerHTML = (muted || volume === 0) ? SVG_MUTE : SVG_VOLUME;
        volumeFill.style.width = `${muted ? 0 : volume * 100}%`;
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

    document.getElementById('api-instance-list').addEventListener('click', e => {
        const button = e.target.closest('button');
        if (!button) return;
        
        const li = button.closest('li');
        const index = parseInt(li.dataset.index, 10);
        const instances = apiSettings.getInstances();
        
        if (button.classList.contains('move-up') && index > 0) {
            [instances[index], instances[index - 1]] = [instances[index - 1], instances[index]];
        } else if (button.classList.contains('move-down') && index < instances.length - 1) {
            [instances[index], instances[index + 1]] = [instances[index + 1], instances[index]];
        } else if (button.classList.contains('delete-instance')) {
            instances.splice(index, 1);
        }
        
        apiSettings.saveInstances(instances);
        ui.renderApiSettings();
    });

    document.getElementById('add-instance-form').addEventListener('submit', e => {
        e.preventDefault();
        const input = document.getElementById('custom-instance-input');
        const newUrl = input.value.trim();
        
        if (newUrl) {
            try {
                const url = new URL(newUrl);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                    throw new Error('Invalid protocol');
                }
                
                const instances = apiSettings.getInstances();
                const formattedUrl = newUrl.endsWith('/') ? newUrl.slice(0, -1) : newUrl;
                
                if (!instances.includes(formattedUrl)) {
                    instances.push(formattedUrl);
                    apiSettings.saveInstances(instances);
                    ui.renderApiSettings();
                    input.value = '';
                } else {
                    alert('This instance is already in the list.');
                }
            } catch (error) {
                alert('Please enter a valid URL (e.g., https://example.com)');
            }
        }
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

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
            player.handlePlayPause();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            player.handlePlayPause();
        });
        
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            player.playPrev();
        });
        
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            player.playNext();
        });
        
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            player.seekBackward(skipTime);
        });
        
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            player.seekForward(skipTime);
        });
        
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.fastSeek && 'fastSeek' in audioPlayer) {
                audioPlayer.fastSeek(details.seekTime);
            } else {
                audioPlayer.currentTime = details.seekTime;
            }
            player.updateMediaSessionPositionState();
        });
        
        navigator.mediaSession.setActionHandler('stop', () => {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
        });
    }

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