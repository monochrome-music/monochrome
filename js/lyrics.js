//js/lyrics.js
import { getTrackTitle, getTrackArtists, SVG_DOWNLOAD, SVG_CLOSE } from './utils.js';

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
            script.src = 'https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics@0.5.4/dist/src/am-lyrics.min.js';
            
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

        const blob = new Blob([lrcContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getTrackArtists(track)} - ${getTrackTitle(track)}.lrc`;
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

export function createLyricsPanel() {
    const panel = document.createElement('div');
    panel.id = 'lyrics-panel';
    panel.className = 'lyrics-panel hidden';
    panel.innerHTML = `
        <div class="lyrics-header">
            <h3>Lyrics</h3>
            <div class="lyrics-controls">
                <button id="download-lrc-btn" class="btn-icon" title="Download LRC">
                    ${SVG_DOWNLOAD}
                </button>
                <button id="close-lyrics-btn" class="btn-icon" title="Close">
                    ${SVG_CLOSE}
                </button>
            </div>
        </div>
        <div class="lyrics-content">
            <div class="lyrics-loading">Loading lyrics...</div>
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

export async function showSyncedLyricsPanel(track, audioPlayer, panel) {
    const content = panel.querySelector('.lyrics-content');
    content.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';
    
    const lyricsManager = new LyricsManager();
    
    try {
        await lyricsManager.ensureComponentLoaded();
        
        const title = track.title;
        const artist = getTrackArtists(track);
        const album = track.album?.title;
        const durationMs = track.duration ? Math.round(track.duration * 1000) : undefined;
        const isrc = track.isrc || '';
        
        content.innerHTML = '';
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
        
        content.appendChild(amLyrics);
        lyricsManager.amLyricsElement = amLyrics;
        
        let baseTimeMs = 0;
        let lastTimestamp = performance.now();
        
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
                lyricsManager.animationFrameId = requestAnimationFrame(tick);
            }
        };
        
        audioPlayer.addEventListener('timeupdate', updateTime);
        audioPlayer.addEventListener('play', () => {
            baseTimeMs = audioPlayer.currentTime * 1000;
            lastTimestamp = performance.now();
            tick();
        });
        audioPlayer.addEventListener('pause', () => {
            if (lyricsManager.animationFrameId) {
                cancelAnimationFrame(lyricsManager.animationFrameId);
            }
        });
        audioPlayer.addEventListener('seeked', updateTime);
        
        amLyrics.addEventListener('line-click', (e) => {
            if (e.detail && e.detail.timestamp) {
                audioPlayer.currentTime = e.detail.timestamp / 1000;
                audioPlayer.play();
            }
        });
        
        if (!audioPlayer.paused) {
            tick();
        }
        
        panel.lyricsCleanup = () => {
            if (lyricsManager.animationFrameId) {
                cancelAnimationFrame(lyricsManager.animationFrameId);
            }
        };
        
    } catch (error) {
        console.error('Failed to load lyrics:', error);
        content.innerHTML = '<div class="lyrics-error">Failed to load lyrics! :(</div>';
    }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
    if (panel.lyricsUpdateHandler) {
        audioPlayer.removeEventListener('timeupdate', panel.lyricsUpdateHandler);
        panel.lyricsUpdateHandler = null;
    }
    if (panel.lyricsCleanup) {
        panel.lyricsCleanup();
        panel.lyricsCleanup = null;
    }
}

export function showKaraokeView(track, lyricsData, audioPlayer) {
    const view = document.createElement('div');
    view.id = 'karaoke-view';
    view.className = 'karaoke-view';

    const syncedLyrics = lyricsData.subtitles
        ? parseSyncedLyricsSimple(lyricsData.subtitles)
        : [];

    view.innerHTML = `
        <div class="karaoke-header">
            <button id="close-karaoke-btn" class="btn-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="karaoke-track-info">
            <div class="karaoke-title">${getTrackTitle(track)}</div>
            <div class="karaoke-artist">${getTrackArtists(track)}</div>
        </div>
        <div class="karaoke-lyrics-container" id="karaoke-lyrics"></div>
    `;

    document.body.appendChild(view);

    const lyricsContainer = view.querySelector('#karaoke-lyrics');
    syncedLyrics.forEach((line, index) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'karaoke-line';
        lineEl.textContent = line.text;
        lineEl.dataset.index = index;
        lineEl.dataset.time = line.time;
        lyricsContainer.appendChild(lineEl);
    });

    let currentLineIndex = -1;

    const updateLyrics = () => {
        const currentTime = audioPlayer.currentTime;
        const newIndex = getCurrentLineIndex(syncedLyrics, currentTime);

        if (newIndex !== currentLineIndex) {
            currentLineIndex = newIndex;

            document.querySelectorAll('.karaoke-line').forEach((line, index) => {
                line.classList.remove('active', 'upcoming', 'past');

                if (index === currentLineIndex) {
                    line.classList.add('active');
                } else if (index === currentLineIndex + 1) {
                    line.classList.add('upcoming');
                } else if (index < currentLineIndex) {
                    line.classList.add('past');
                }
            });

            if (currentLineIndex >= 0) {
                const activeLine = lyricsContainer.children[currentLineIndex];
                if (activeLine) {
                    activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    };

    // Use timeupdate event for better sync
    audioPlayer.addEventListener('timeupdate', updateLyrics);

    // Initial update
    updateLyrics();

    view.querySelector('#close-karaoke-btn').addEventListener('click', () => {
        audioPlayer.removeEventListener('timeupdate', updateLyrics);
        view.remove();
    });

    return view;
}

function parseSyncedLyricsSimple(subtitles) {
    const lines = subtitles.split('\n').filter(line => line.trim());
    return lines.map(line => {
        const match = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.+)/);
        if (match) {
            const [, minutes, seconds, centiseconds, text] = match;
            const timeInSeconds = parseInt(minutes) * 60 + parseInt(seconds) + parseInt(centiseconds) / 100;
            return { time: timeInSeconds, text };
        }
        return null;
    }).filter(Boolean);
}

function getCurrentLineIndex(syncedLyrics, currentTime) {
    let currentIndex = -1;
    for (let i = 0; i < syncedLyrics.length; i++) {
        if (currentTime >= syncedLyrics[i].time) {
            currentIndex = i;
        } else {
            break;
        }
    }
    return currentIndex;
}
