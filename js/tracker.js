//js/tracker.js
import { escapeHtml, SVG_DOWNLOAD } from './utils.js';

let artistsData = [];
let globalPlayer = null;
let globalUi = null;

async function loadArtistsData() {
    try {
        const response = await fetch('/artists.ndjson');
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        artistsData = text.trim().split('\n')
            .filter(line => line.trim())
            .map(line => {
                try { return JSON.parse(line); } catch (e) { return null; }
            })
            .filter(item => item !== null);
    } catch (e) {
        console.error("Failed to load Artists LIst:", e);
    }
}

function getSheetId(url) {
    if (!url) return null;
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

async function fetchTrackerData(sheetId) {
    try {
        const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(`https://tracker.israeli.ovh/get/${sheetId}`)}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error("Failed to fetch tracker data", e);
        return null;
    }
}

function parseDuration(durationStr) {
    if (!durationStr || durationStr === 'N/A') return 0;
    const parts = durationStr.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
}

function getDirectUrl(rawUrl) {
    if (!rawUrl) return null;
    if (rawUrl.includes('pillows.su/f/')) {
        const match = rawUrl.match(/pillows\.su\/f\/([a-f0-9]+)/);
        if (match) return `https://api.pillows.su/api/download/${match[1]}`;
    } else if (rawUrl.includes('music.froste.lol/song/')) {
        const match = rawUrl.match(/music\.froste\.lol\/song\/([a-f0-9]+)/);
        if (match) return `https://music.froste.lol/song/${match[1]}/download`;
    }
    return rawUrl;
}

function renderLoadButton(container, sheetId, artistName) {
    container.innerHTML = '';
    container.style.display = 'block';
    
    const wrapper = document.createElement('div');
    wrapper.style.textAlign = 'center';
    wrapper.style.padding = '2rem';
    
    const button = document.createElement('button');
    button.className = 'btn-primary';
    button.textContent = 'Load Unreleased Projects';
    button.style.fontSize = '1.1rem';
    button.style.padding = '1rem 2rem';
    
    button.onclick = async () => {
        button.textContent = 'Loading...';
        button.disabled = true;
        
        const trackerData = await fetchTrackerData(sheetId);
        if (trackerData) {
            renderTracker(trackerData, container, artistName);
        } else {
            button.textContent = 'Failed to load';
            setTimeout(() => {
                button.disabled = false;
                button.textContent = 'Load Unreleased Projects';
            }, 2000);
        }
    };
    
    wrapper.appendChild(button);
    container.appendChild(wrapper);
}

function renderTracker(trackerData, container, artistName) {
    container.innerHTML = `
        <h2 class="section-title" style="margin-bottom: 0.5rem;">Unreleased Projects</h2>
        <p style="color: var(--muted-foreground); margin-bottom: 1.5rem; font-size: 0.9rem;">
            Unreleased Songs & Info Provided By <a href="https://artistgrid.cx" target="_blank" style="text-decoration: underline;">ArtistGrid</a>. Consider Donating to Them.
        </p>
    `;
    
    const erasContainer = document.createElement('div');
    erasContainer.className = 'card-grid';
    erasContainer.style.opacity = '0';
    erasContainer.style.transform = 'translateY(20px)';
    erasContainer.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    container.appendChild(erasContainer);

    if (!trackerData.eras) return;

    Object.values(trackerData.eras).forEach(era => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cursor = 'pointer';
        
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'card-image-wrapper';

        const img = document.createElement('img');
        img.className = 'card-image';
        img.src = era.image ? `https://corsproxy.io/?${encodeURIComponent(era.image)}` : 'assets/logo.svg';
        img.alt = era.name;
        img.loading = 'lazy';
        
        imgWrapper.appendChild(img);

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = era.name;
        
        const subtitle = document.createElement('div');
        subtitle.className = 'card-subtitle';
        subtitle.textContent = era.timeline || 'Unreleased';

        card.appendChild(imgWrapper);
        card.appendChild(title);
        card.appendChild(subtitle);
        
        card.onclick = () => showEraSongs(era, artistName);
        
        erasContainer.appendChild(card);
    });

    requestAnimationFrame(() => {
        erasContainer.style.opacity = '1';
        erasContainer.style.transform = 'translateY(0)';
    });
}

function showEraSongs(era, artistName) {
    const modal = document.getElementById('tracker-modal');
    const overlay = modal.querySelector('.modal-overlay');
    const closeBtn = document.getElementById('close-tracker-modal');
    

    const img = document.getElementById('tracker-header-image');
    const title = document.getElementById('tracker-header-title');
    const meta = document.getElementById('tracker-header-meta');

    img.src = era.image ? `https://corsproxy.io/?${encodeURIComponent(era.image)}` : 'assets/logo.svg';
    img.alt = era.name;
    title.textContent = era.name;
    meta.textContent = `${artistName} • ${era.timeline || 'Unreleased'}`;

    const trackList = document.getElementById('tracker-tracklist');
    const filterContainer = document.getElementById('tracker-filters');
    
    filterContainer.innerHTML = '';
    while (trackList.lastElementChild && !trackList.lastElementChild.classList.contains('track-list-header')) {
        trackList.removeChild(trackList.lastElementChild);
    }

    const filters = [
        { label: 'All', emoji: '' },
        { label: 'Best Of', emoji: '⭐' },
        { label: 'Special', emoji: '✨' },
        { label: 'Grails', emoji: '🏆' },
        { label: 'Wanted', emoji: '🥇' },
        { label: 'Worst Of', emoji: '🗑️' }
    ];

    let activeFilter = '';

    const applyFilter = () => {
        const items = trackList.querySelectorAll('.track-item');
        
        items.forEach(item => {
            const titleEl = item.querySelector('.title');
            if (titleEl) {
                const title = titleEl.textContent.trim();
                if (activeFilter && !title.startsWith(activeFilter)) {
                    item.style.display = 'none';
                } else {
                    item.style.display = '';
                }
            }
        });

        const categories = trackList.querySelectorAll('h4');
        categories.forEach(cat => {
            let next = cat.nextElementSibling;
            let hasVisibleItems = false;
            
            while(next && next.tagName !== 'H4') {
                if (next.classList.contains('track-item') && next.style.display !== 'none') {
                    hasVisibleItems = true;
                    break;
                }
                next = next.nextElementSibling;
            }
            
            cat.style.display = hasVisibleItems ? 'block' : 'none';
        });
    };

    filters.forEach(filter => {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.textContent = filter.emoji ? `${filter.emoji} ${filter.label}` : filter.label;
        btn.style.fontSize = '0.85rem';
        btn.style.padding = '0.4rem 0.8rem';
        btn.style.borderRadius = '2rem';
        
        if (filter.emoji === '') {
             btn.style.backgroundColor = 'var(--primary)';
             btn.style.color = 'var(--primary-foreground)';
        }

        btn.onclick = () => {
            Array.from(filterContainer.children).forEach(b => {
                b.style.backgroundColor = '';
                b.style.color = '';
            });
            btn.style.backgroundColor = 'var(--primary)';
            btn.style.color = 'var(--primary-foreground)';

            activeFilter = filter.emoji;
            applyFilter();
        };

        filterContainer.appendChild(btn);
    });

    let globalIndex = 1;

    if (era.data) {
        Object.entries(era.data).forEach(([category, songs]) => {
            if (!songs || songs.length === 0) return;
            
            const catTitle = document.createElement('h4');
            catTitle.textContent = category;
            catTitle.style.padding = '1rem 0.5rem 0.5rem';
            catTitle.style.color = 'var(--highlight)';
            catTitle.style.fontWeight = '600';
            catTitle.style.borderBottom = '1px solid var(--border)';
            catTitle.style.marginBottom = '0.5rem';
            trackList.appendChild(catTitle);

            const isValidUrl = (u) => u && typeof u === 'string' && u.trim().length > 0;

            songs.forEach(song => {
                const trackItem = document.createElement('div');
                trackItem.className = 'track-item';
                
                trackItem.innerHTML = `
                    <div class="track-number">${globalIndex++}</div>
                    <div class="track-item-info">
                        <div class="track-item-details">
                            <div class="title">${escapeHtml(song.name)}</div>
                            <div class="artist">${escapeHtml(song.extra || artistName || document.getElementById('artist-detail-name')?.textContent || 'Unknown Artist')}</div>
                        </div>
                    </div>
                    <div class="track-item-duration">${song.track_length || '--:--'}</div>
                    <div class="track-item-actions">
                        <button class="track-action-btn" title="Download">
                            ${SVG_DOWNLOAD}
                        </button>
                    </div>
                `;

                const hasValidUrl = isValidUrl(song.url) || (song.urls && song.urls.some(isValidUrl));

                trackItem.oncontextmenu = (e) => {
                    if (!hasValidUrl) return;
                    e.preventDefault();
                    const contextMenu = document.getElementById('context-menu');
                    if (contextMenu) {
                        const rawUrl = (isValidUrl(song.url) ? song.url : null) || (song.urls ? song.urls.find(isValidUrl) : null);
                        const directUrl = getDirectUrl(rawUrl);

                        const track = {
                            id: `tracker-${song.name}`,
                            title: song.name,
                            artist: { name: artistName || document.getElementById('artist-detail-name')?.textContent || 'Unknown Artist' },
                            artists: [{ name: artistName || document.getElementById('artist-detail-name')?.textContent || 'Unknown Artist' }],
                            album: {
                                title: era.name,
                                cover: era.image
                            },
                            duration: parseDuration(song.track_length),
                            isTracker: true,
                            audioUrl: directUrl,
                            remoteUrl: directUrl
                        };
                        
                        contextMenu._contextTrack = track;
                        
                        ['go-to-album', 'go-to-artist', 'toggle-like', 'download', 'track-mix'].forEach(action => {
                            const item = contextMenu.querySelector(`[data-action="${action}"]`);
                            if (item) item.style.display = 'none';
                        });

                        let left = e.pageX;
                        let top = e.pageY;
                        if (left + 160 > window.innerWidth) left = window.innerWidth - 170;
                        if (top + 200 > window.innerHeight) top = e.pageY - 200;

                        contextMenu.style.left = `${left}px`;
                        contextMenu.style.top = `${top}px`;
                        contextMenu.style.display = 'block';
                    }
                };

                if (hasValidUrl) {
                    trackItem.onclick = async () => {
                        if (song.track_length === '-') {
                            const targetUrl = (song.urls && song.urls.length > 0) ? song.urls[0] : song.url;
                            if (targetUrl) window.open(targetUrl, '_blank');
                            return;
                        }

                        if (trackItem.classList.contains('loading')) return;

                        document.body.style.cursor = 'wait';
                        trackItem.classList.add('loading');
                        const trackNumEl = trackItem.querySelector('.track-number');
                        const originalNum = trackNumEl.textContent;
                        trackNumEl.innerHTML = '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';
                        
                        let urlsToTry = [];
                        if (isValidUrl(song.url)) {
                            urlsToTry.push(song.url);
                        }
                        if (song.urls) {
                            urlsToTry.push(...song.urls.filter(isValidUrl));
                        }

                        let audioUrl = null;
                        let successfulUrl = null;
                        
                        for (let rawUrl of urlsToTry) {
                            console.log(`Trying: ${rawUrl}`);
                            
                            let downloadUrl = rawUrl;
                            
                            if (rawUrl.includes('pillows.su/f/')) {
                                const match = rawUrl.match(/pillows\.su\/f\/([a-f0-9]+)/);
                                if (match) {
                                    downloadUrl = `https://api.pillows.su/api/download/${match[1]}`;
                                }
                            } else if (rawUrl.includes('music.froste.lol/song/')) {
                                const match = rawUrl.match(/music\.froste\.lol\/song\/([a-f0-9]+)/);
                                if (match) {
                                    downloadUrl = `https://music.froste.lol/song/${match[1]}/download`;
                                }
                            }

                            try {
                                console.log(`Fetching: ${downloadUrl}`);
                                const response = await fetch(downloadUrl);
                                
                                if (response.ok) {
                                    const contentType = response.headers.get('content-type') || '';
                                    if (contentType.includes('audio/') || 
                                        contentType.includes('mpeg') ||
                                        contentType.includes('octet-stream')) {
                                        const arrayBuffer = await response.arrayBuffer();
                                        if (arrayBuffer.byteLength > 1000) {
                                            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
                                            audioUrl = URL.createObjectURL(blob);
                                            successfulUrl = downloadUrl;
                                            console.log(`✓ Success (${(arrayBuffer.byteLength / 1024).toFixed(0)}KB)`);
                                            break;
                                        }
                                    }
                                }
                            } catch (e) {
                                console.log(`Download from ${downloadUrl} failed:`, e.message);
                            }
                        }

                        document.body.style.cursor = 'default';
                        trackItem.classList.remove('loading');
                        trackNumEl.textContent = originalNum;
                        
                        if (!audioUrl) {
                            alert(`Unable to load this track! :( The source may be unavailable.\n\nTried ${urlsToTry.length} URL(s)`);
                            return;
                        }
                        
                        if (globalPlayer) {
                            const track = {
                                id: `tracker-${song.name}`,
                                title: song.name,
                                artist: { name: artistName || document.getElementById('artist-detail-name')?.textContent || 'Unknown Artist' },
                                artists: [{ name: artistName || document.getElementById('artist-detail-name')?.textContent || 'Unknown Artist' }],
                                album: {
                                    title: era.name,
                                    cover: era.image
                                },
                                duration: parseDuration(song.track_length),
                                isTracker: true,
                                audioUrl: audioUrl,
                                remoteUrl: successfulUrl || (urlsToTry.length > 0 ? getDirectUrl(urlsToTry[0]) : null) || getDirectUrl(song.url)
                            };

                            globalPlayer.setQueue([track], 0);
                            document.getElementById('shuffle-btn')?.classList.remove('active');
                            globalPlayer.playTrackFromQueue();
                        }
                    };

                    const downloadBtn = trackItem.querySelector('.track-action-btn');
                    if (downloadBtn) {
                        downloadBtn.onclick = (e) => {
                            e.stopPropagation();
                            alert('Download not available for tracker songs yet.');
                        };
                    }
                } else {
                    trackItem.classList.add('unavailable');
                    trackItem.style.opacity = '0.5';
                    trackItem.style.cursor = 'default';
                }

                trackList.appendChild(trackItem);
            });
        });
    }

    modal.classList.add('active');

    const closeModal = () => modal.classList.remove('active');
    overlay.onclick = closeModal;
    closeBtn.onclick = closeModal;
}

export async function initTracker(player, ui) {
    globalPlayer = player;
    globalUi = ui;
    await loadArtistsData();

    const checkAndRenderTracker = async () => {
        const artistNameEl = document.getElementById('artist-detail-name');
        const trackerSection = document.getElementById('artist-tracker-section');
        
        if (artistNameEl && trackerSection && artistNameEl.textContent) {
            const artistName = artistNameEl.textContent.trim();
            
            if (trackerSection.dataset.artist === artistName) return;
            
            trackerSection.dataset.artist = artistName;
            trackerSection.innerHTML = '';
            trackerSection.style.display = 'none';

            const artistEntry = artistsData.find(a => a.name.toLowerCase() === artistName.toLowerCase());
            
            if (artistEntry && artistEntry.url) {
                const sheetId = getSheetId(artistEntry.url);
                if (sheetId) {
                    renderLoadButton(trackerSection, sheetId, artistEntry.name);
                }
            }
        }
    };

    const observer = new MutationObserver(checkAndRenderTracker);

    const artistPage = document.getElementById('page-artist');
    if (artistPage) {
        observer.observe(artistPage, { attributes: true, childList: true, subtree: true });
        checkAndRenderTracker();
    }
}