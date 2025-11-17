//js/lyrics.js
import { getTrackTitle, getTrackArtists } from './utils.js';

export class LyricsManager {
    constructor(api) {
        this.api = api;
        this.currentLyrics = null;
        this.syncedLyrics = [];
        this.lyricsCache = new Map();
    }

    async fetchLyrics(trackId) {
        if (this.lyricsCache.has(trackId)) {
            return this.lyricsCache.get(trackId);
        }

        try {
            const response = await this.api.fetchWithRetry(`/lyrics/?id=${trackId}`);
            const data = await response.json();

            if (Array.isArray(data) && data.length > 0) {
                const lyricsData = data[0];
                this.lyricsCache.set(trackId, lyricsData);
                return lyricsData;
            }

            return null;
        } catch (error) {
            console.error('Failed to fetch lyrics:', error);
            return null;
        }
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
                <button id="close-lyrics-btn" class="btn-icon" title="Close">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
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

export function showSyncedLyricsPanel(lyricsData, audioPlayer, panel) {
    const content = panel.querySelector('.lyrics-content');

    const syncedLyrics = lyricsData.subtitles
        ? parseSyncedLyricsSimple(lyricsData.subtitles)
        : null;

    if (syncedLyrics && syncedLyrics.length > 0) {
        // Render synced lyrics
        content.innerHTML = '';
        syncedLyrics.forEach((line, index) => {
            const lineEl = document.createElement('p');
            lineEl.className = 'lyrics-line synced-line';
            lineEl.textContent = line.text || '♪';
            lineEl.dataset.index = index;
            lineEl.dataset.time = line.time;
            content.appendChild(lineEl);
        });

        let currentLineIndex = -1;

        const updateLyrics = () => {
            const currentTime = audioPlayer.currentTime;
            const newIndex = getCurrentLineIndex(syncedLyrics, currentTime);

            if (newIndex !== currentLineIndex) {
                currentLineIndex = newIndex;

                content.querySelectorAll('.synced-line').forEach((line, index) => {
                    line.classList.remove('active', 'upcoming', 'past');

                    if (index === currentLineIndex) {
                        line.classList.add('active');
                        // Smooth scroll to active line
                        line.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (index === currentLineIndex + 1) {
                        line.classList.add('upcoming');
                    } else if (index < currentLineIndex) {
                        line.classList.add('past');
                    }
                });
            }
        };

        // Store the update function so we can remove it later
        panel.lyricsUpdateHandler = updateLyrics;
        audioPlayer.addEventListener('timeupdate', updateLyrics);

        // Initial update
        updateLyrics();
    } else if (lyricsData.lyrics) {
        // Fallback to static lyrics
        const lines = lyricsData.lyrics.split('\n');
        content.innerHTML = lines.map(line =>
            `<p class="lyrics-line">${line || '&nbsp;'}</p>`
        ).join('');
    } else {
        content.innerHTML = '<div class="lyrics-error">No lyrics available</div>';
    }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
    if (panel.lyricsUpdateHandler) {
        audioPlayer.removeEventListener('timeupdate', panel.lyricsUpdateHandler);
        panel.lyricsUpdateHandler = null;
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
