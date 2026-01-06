//js/lyrics.js
import { getTrackTitle, getTrackArtists, buildTrackFilename, SVG_DOWNLOAD, SVG_CLOSE } from './utils.js';
import { sidePanelManager } from './side-panel.js';

export class LyricsManager {
    constructor(api) {
        this.api = api;
        this.currentLyrics = null;
        this.syncedLyrics = [];
        this.lyricsCache = new Map();
        this.componentLoaded = false;
        this.amLyricsElement = null;
        this.animationFrameId = null;
    }

    async ensureComponentLoaded() {
        if (this.componentLoaded) return;
        
        if (typeof customElements !== 'undefined' && customElements.get('am-lyrics')) {
            this.componentLoaded = true;
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics@0.6.2/dist/src/am-lyrics.min.js';
            
            script.onload = () => {
                if (typeof customElements !== 'undefined') {
                    customElements.whenDefined('am-lyrics')
                        .then(() => {
                            this.componentLoaded = true;
                            resolve();
                        })
                        .catch(reject);
                } else {
                    resolve();
                }
            };
            
            script.onerror = () => reject(new Error('Failed to load lyrics component'));
            document.head.appendChild(script);
        });
    }

    async fetchLyrics(trackId, track = null) {
        // LRCLIB
        if (track) {
            if (this.lyricsCache.has(trackId)) {
                return this.lyricsCache.get(trackId);
            }

            try {
                const artist = Array.isArray(track.artists) 
                    ? track.artists.map(a => a.name || a).join(', ')
                    : track.artist?.name || '';
                const title = track.title || '';
                const album = track.album?.title || '';
                const duration = track.duration ? Math.round(track.duration) : null;

                if (!title || !artist) {
                    console.warn('Missing required fields for LRCLIB');
                    return null;
                }

                const params = new URLSearchParams({
                    track_name: title,
                    artist_name: artist
                });
                
                if (album) params.append('album_name', album);
                if (duration) params.append('duration', duration.toString());

                const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.syncedLyrics) {
                        const lyricsData = {
                            subtitles: data.syncedLyrics,
                            lyricsProvider: 'LRCLIB'
                        };
                        
                        this.lyricsCache.set(trackId, lyricsData);
                        return lyricsData;
                    }
                }
            } catch (error) {
                console.warn('LRCLIB fetch failed:', error);
            }
        }

        return null;
    }

    parseSyncedLyrics(subtitles) {
        if (!subtitles) return [];
        const lines = subtitles.split('\n').filter(line => line.trim());
        return lines.map(line => {
            const match = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.+)/);
            if (match) {
                const [, minutes, seconds, centiseconds, text] = match;
                const timeInSeconds = parseInt(minutes) * 60 + parseInt(seconds) + parseInt(centiseconds) / 100;
                return { time: timeInSeconds, text: text.trim() };
            }
            return null;
        }).filter(Boolean);
    }

    generateLRCContent(lyricsData, track) {
        if (!lyricsData || !lyricsData.subtitles) return null;

        const trackTitle = getTrackTitle(track);
        const trackArtist = getTrackArtists(track);

        let lrc = `[ti:${trackTitle}]\n`;
        lrc += `[ar:${trackArtist}]\n`;
        lrc += `[al:${track.album?.title || 'Unknown Album'}]\n`;
        lrc += `[by:${lyricsData.lyricsProvider || 'Unknown'}]\n`;
        lrc += '\n';
        lrc += lyricsData.subtitles;

        return lrc;
    }

    downloadLRC(lyricsData, track) {
        const lrcContent = this.generateLRCContent(lyricsData, track);
        if (!lrcContent) {
            alert('No synced lyrics available for this track');
            return;
        }

        const blob = new Blob([lrcContent], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildTrackFilename(track, 'LOSSLESS').replace(/\.flac$/, '.lrc');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getCurrentLine(currentTime) {
        if (!this.syncedLyrics || this.syncedLyrics.length === 0) return -1;
        let currentIndex = -1;
        for (let i = 0; i < this.syncedLyrics.length; i++) {
            if (currentTime >= this.syncedLyrics[i].time) {
                currentIndex = i;
            } else {
                break;
            }
        }
        return currentIndex;
    }
}

export async function openLyricsPanel(track, audioPlayer, lyricsManager) {
    // If no manager provided, create a temp one
    const manager = lyricsManager || new LyricsManager();

    const renderControls = (container) => {
        container.innerHTML = `
            <button id="close-side-panel-btn" class="btn-icon" title="Close">
                ${SVG_CLOSE}
            </button>
        `;

        container.querySelector('#close-side-panel-btn').addEventListener('click', () => {
            sidePanelManager.close();
            clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        });
    };

    const renderContent = async (container) => {
        // Clean up any previous sync (though sidePanelManager might handle cleanup, we ensure it here)
        clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        
        await renderLyricsComponent(container, track, audioPlayer, manager);
    };

    sidePanelManager.open('lyrics', 'Lyrics', renderControls, renderContent);
}

async function renderLyricsComponent(container, track, audioPlayer, lyricsManager) {
    container.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';

    try {
        await lyricsManager.ensureComponentLoaded();

        const title = track.title;
        const artist = getTrackArtists(track);
        const album = track.album?.title;
        const durationMs = track.duration ? Math.round(track.duration * 1000) : undefined;
        const isrc = track.isrc || '';

        container.innerHTML = '';
        const amLyrics = document.createElement('am-lyrics');
        amLyrics.setAttribute('song-title', title);
        amLyrics.setAttribute('song-artist', artist);
        if (album) amLyrics.setAttribute('song-album', album);
        if (durationMs) amLyrics.setAttribute('song-duration', durationMs);
        amLyrics.setAttribute('query', `${title} ${artist}`.trim());
        if (isrc) amLyrics.setAttribute('isrc', isrc);

        amLyrics.setAttribute('highlight-color', '#93c5fd');
        amLyrics.setAttribute('hover-background-color', 'rgba(59, 130, 246, 0.14)');
        amLyrics.setAttribute('autoscroll', '');
        amLyrics.setAttribute('interpolate', '');
        amLyrics.style.height = '100%';
        amLyrics.style.width = '100%';

        container.appendChild(amLyrics);
        
        const cleanup = setupSync(track, audioPlayer, amLyrics);
        
        // Attach cleanup to container for easy access
        container.lyricsCleanup = cleanup;
        
        return amLyrics;
    } catch (error) {
        console.error('Failed to load lyrics:', error);
        container.innerHTML = '<div class="lyrics-error">Failed to load lyrics</div>';
        return null;
    }
}

function setupSync(track, audioPlayer, amLyrics) {
    let baseTimeMs = 0;
    let lastTimestamp = performance.now();
    let animationFrameId = null;
    
    const updateTime = () => {
        const currentMs = audioPlayer.currentTime * 1000;
        baseTimeMs = currentMs;
        lastTimestamp = performance.now();
        amLyrics.currentTime = currentMs;
    };

    const tick = () => {
        if (!audioPlayer.paused) {
            const now = performance.now();
            const elapsed = now - lastTimestamp;
            const nextMs = baseTimeMs + elapsed;
            amLyrics.currentTime = nextMs;
            animationFrameId = requestAnimationFrame(tick);
        }
    };

    const onPlay = () => {
        baseTimeMs = audioPlayer.currentTime * 1000;
        lastTimestamp = performance.now();
        tick();
    };

    const onPause = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    };

    const onLineClick = (e) => {
        if (e.detail && e.detail.timestamp) {
            audioPlayer.currentTime = e.detail.timestamp / 1000;
            audioPlayer.play();
        }
    };

    audioPlayer.addEventListener('timeupdate', updateTime);
    audioPlayer.addEventListener('play', onPlay);
    audioPlayer.addEventListener('pause', onPause);
    audioPlayer.addEventListener('seeked', updateTime);
    amLyrics.addEventListener('line-click', onLineClick);
    
    if (!audioPlayer.paused) {
        tick();
    }
    
    return () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        audioPlayer.removeEventListener('timeupdate', updateTime);
        audioPlayer.removeEventListener('play', onPlay);
        audioPlayer.removeEventListener('pause', onPause);
        audioPlayer.removeEventListener('seeked', updateTime);
        amLyrics.removeEventListener('line-click', onLineClick);
    };
}

export async function renderLyricsInFullscreen(track, audioPlayer, lyricsManager, container) {
    return renderLyricsComponent(container, track, audioPlayer, lyricsManager);
}

export function clearFullscreenLyricsSync(container) {
    if (container && container.lyricsCleanup) {
        container.lyricsCleanup();
        container.lyricsCleanup = null;
    }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
    if (panel && panel.lyricsCleanup) {
        panel.lyricsCleanup();
        panel.lyricsCleanup = null;
    }
}
