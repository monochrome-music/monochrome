//js/tracker.js
import { escapeHtml, SVG_MENU, SVG_PLAY, trackDataStore, formatTime, SVG_HEART } from './utils.js';
import { navigate } from './router.js';

let artistsData = [];
let artistsPopularity = new Map(); // name -> popularity score
let globalPlayer = null;

// Map to store artist info keyed by sheetId for quick lookup
const artistBySheetId = new Map();

// Store all songs for search functionality
let allSongsCache = new Map(); // sheetId -> {era, songs}

// Normalize artist name for image URL (no spaces, no special chars, all lowercase)
function normalizeArtistName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Clean song title for scrobbling (remove producer credits)
function cleanSongTitle(title) {
    if (!title) return '';
    // Remove (prod. ...), (produced by ...), [prod. ...], etc.
    return title
        .replace(/\s*[([]\s*prod\.?\s+[^)\]]+[)\]]/gi, '')
        .replace(/\s*[([]\s*produced\s+by\s+[^)\]]+[)\]]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function loadArtistsPopularity() {
    try {
        const response = await fetch('https://trends.artistgrid.cx');
        if (!response.ok) return;
        const data = await response.json();
        if (data.results) {
            data.results.forEach((artist, index) => {
                // Store popularity score based on visitors and position
                const score = artist.visitors * (1 - index / data.results.length);
                artistsPopularity.set(artist.name, score);
            });
        }
    } catch (e) {
        console.log('Could not load popularity data:', e);
    }
}

async function loadArtistsData() {
    try {
        const response = await fetch('https://sheets.artistgrid.cx/artists.ndjson');
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        artistsData = text
            .trim()
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter((item) => item !== null);

        // Sort by popularity if available
        artistsData.sort((a, b) => {
            const popA = artistsPopularity.get(a.name) || 0;
            const popB = artistsPopularity.get(b.name) || 0;
            return popB - popA;
        });

        // Build sheetId lookup map
        artistBySheetId.clear();
        artistsData.forEach((artist) => {
            const sheetId = getSheetId(artist.url);
            if (sheetId) {
                artistBySheetId.set(sheetId, artist);
            }
        });
    } catch (e) {
        console.error('Failed to load Artists List:', e);
    }
}

function getSheetId(url) {
    if (!url) return null;
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

async function fetchTrackerData(sheetId) {
    try {
        const response = await fetch(`https://tracker.israeli.ovh/get/${sheetId}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch tracker data', e);
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

    // Only return URLs that are known to be direct audio links
    if (rawUrl.includes('pillows.su/f/')) {
        const match = rawUrl.match(/pillows\.su\/f\/([a-f0-9]+)/);
        if (match) return `https://api.pillows.su/api/download/${match[1]}`;
    } else if (rawUrl.includes('music.froste.lol/song/')) {
        const match = rawUrl.match(/music\.froste\.lol\/song\/([a-f0-9]+)/);
        if (match) return `https://music.froste.lol/song/${match[1]}/download`;
    }

    // For other URLs, check if they look like direct audio files
    const audioExtensions = ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.aac'];
    const hasAudioExt = audioExtensions.some((ext) => rawUrl.toLowerCase().includes(ext));

    if (hasAudioExt) {
        return rawUrl;
    }

    // Return null for URLs that don't look like direct audio files
    return null;
}

// Convert tracker song to standard track format
export function createTrackFromSong(song, era, artistName, index, sheetId = '') {
    const isValidUrl = (u) => u && typeof u === 'string' && u.trim().length > 0;
    const rawUrl = (isValidUrl(song.url) ? song.url : null) || (song.urls ? song.urls.find(isValidUrl) : null);
    const directUrl = getDirectUrl(rawUrl);
    const duration = parseDuration(song.track_length);
    const cleanTitle = cleanSongTitle(song.name);

    return {
        id: `tracker-${sheetId}-${era.name}-${index}`,
        title: song.name,
        cleanTitle: cleanTitle,
        artist: {
            name: artistName,
        },
        artists: [
            {
                name: artistName,
            },
        ],
        album: {
            title: era.name,
            cover: era.image,
        },
        duration: duration,
        trackNumber: index + 1,
        isTracker: true,
        audioUrl: directUrl,
        remoteUrl: directUrl,
        explicit: false,
        unavailable: !directUrl,
        // Additional tracker-specific data for context menu
        trackerInfo: {
            sheetId: sheetId,
            timeline: era.timeline,
            description: song.desc || song.description || '',
            sourceUrl: rawUrl,
            category: song.category || '',
        },
    };
}

// Create track item HTML for tracker songs - EXACTLY like normal tracks
function createTrackerTrackItemHTML(track, index) {
    const isUnavailable = track.unavailable;
    const trackNumberHTML = `<div class="track-number">${index + 1}</div>`;

    const actionsHTML = isUnavailable
        ? ''
        : `
        <button class="track-menu-btn" type="button" title="More options">
            ${SVG_MENU}
        </button>
    `;

    return `
        <div class="track-item ${isUnavailable ? 'unavailable' : ''}" 
             data-track-id="${track.id}"
             ${isUnavailable ? 'title="This track is currently unavailable"' : ''}>
            ${trackNumberHTML}
            <div class="track-item-info">
                <div class="track-item-details">
                    <div class="title">${escapeHtml(track.title)}</div>
                    <div class="artist">${escapeHtml(track.artist.name)}</div>
                </div>
            </div>
            <div class="track-item-duration">${isUnavailable ? '--:--' : formatTime(track.duration)}</div>
            <div class="track-item-actions">
                ${actionsHTML}
            </div>
        </div>
    `;
}

// Render tracks for a tracker era - EXACTLY like normal album track list
function renderTrackerTracks(container, tracks) {
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');

    // Add header like normal albums
    tempDiv.innerHTML = `
        <div class="track-list-header">
            <span style="width: 40px; text-align: center;">#</span>
            <span>Title</span>
            <span class="duration-header">Duration</span>
            <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
        </div>
    `;

    // Add tracks
    const tracksHTML = tracks.map((track, i) => createTrackerTrackItemHTML(track, i)).join('');

    tempDiv.insertAdjacentHTML('beforeend', tracksHTML);

    // Bind data to elements
    Array.from(tempDiv.children).forEach((element, index) => {
        if (index === 0) return; // Skip header
        const track = tracks[index - 1];
        if (element && track) {
            trackDataStore.set(element, track);
        }
    });

    while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
}

// Create project card HTML - EXACTLY like album cards
export function createProjectCardHTML(era, artist, sheetId, trackCount) {
    const playBtnHTML = `
        <button class="play-btn card-play-btn" data-action="play-card" data-type="tracker-project" data-id="${encodeURIComponent(era.name)}" title="Play">
            ${SVG_PLAY}
        </button>
        <button class="card-menu-btn" data-action="card-menu" data-type="tracker-project" data-id="${encodeURIComponent(era.name)}" title="Menu">
            ${SVG_MENU}
        </button>
    `;

    return `
        <div class="card" data-tracker-project-id="${encodeURIComponent(era.name)}" data-sheet-id="${sheetId}" style="cursor: pointer;">
            <div class="card-image-wrapper">
                <img src="${era.image || 'assets/logo.svg'}" 
                     alt="${escapeHtml(era.name)}" 
                     class="card-image" 
                     loading="lazy"
                     onerror="this.src='assets/logo.svg'">
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="tracker-project" title="Add to Liked">
                    ${SVG_HEART}
                </button>
                ${playBtnHTML}
            </div>
            <div class="card-info">
                <h4 class="card-title">${escapeHtml(era.name)}</h4>
                <p class="card-subtitle">${era.timeline || 'Unreleased'} • ${trackCount} tracks</p>
            </div>
        </div>
    `;
}

// Render tracker artist page (grid of projects)
export async function renderTrackerArtistPage(sheetId, container) {
    if (!artistsData.length) {
        await loadArtistsData();
    }

    // Find artist by sheetId
    const artist = artistBySheetId.get(sheetId);
    if (!artist) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Artist not found.</p>';
        return;
    }

    // Fetch tracker data
    const trackerData = await fetchTrackerData(sheetId);
    if (!trackerData || !trackerData.eras) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Failed to load tracker data.</p>';
        return;
    }

    // Cache songs for search
    allSongsCache.set(sheetId, { artist, eras: trackerData.eras });

    const eras = Object.values(trackerData.eras);

    // Set up header
    const imageEl = document.getElementById('tracker-artist-detail-image');
    const nameEl = document.getElementById('tracker-artist-detail-name');
    const metaEl = document.getElementById('tracker-artist-detail-meta');
    const projectsContainer = document.getElementById('tracker-artist-projects-container');
    const playBtn = document.getElementById('play-tracker-artist-btn');
    const downloadBtn = document.getElementById('download-tracker-artist-btn');

    const normalizedName = normalizeArtistName(artist.name);
    imageEl.src = `https://assets.artistgrid.cx/${normalizedName}.webp`;
    imageEl.onerror = function () {
        this.src = 'assets/logo.svg';
    };
    nameEl.textContent = artist.name;
    metaEl.innerHTML = `<span>${eras.length} unreleased projects</span>`;

    // Set up shuffle play button
    if (playBtn) {
        playBtn.onclick = async () => {
            let allTracks = [];
            eras.forEach((era) => {
                if (era.data) {
                    Object.values(era.data).forEach((songs) => {
                        if (songs && songs.length) {
                            songs.forEach((song) => {
                                const track = createTrackFromSong(song, era, artist.name, allTracks.length, sheetId);
                                allTracks.push(track);
                            });
                        }
                    });
                }
            });

            const availableTracks = allTracks.filter((t) => !t.unavailable);
            if (availableTracks.length > 0) {
                const shuffled = [...availableTracks].sort(() => Math.random() - 0.5);
                globalPlayer.setQueue(shuffled, 0);
                globalPlayer.playTrackFromQueue();
            }
        };
    }

    // Set up download button
    if (downloadBtn) {
        downloadBtn.onclick = () => {
            alert('Bulk download coming soon! You can download individual tracks from the project pages.');
        };
    }

    // Add search bar (only if not already present)
    let searchContainer = document.getElementById('unreleased-search-container');
    if (!searchContainer) {
        searchContainer = document.createElement('div');
        searchContainer.id = 'unreleased-search-container';
        searchContainer.style.cssText = 'margin: 1rem 0; padding: 0 1rem;';
        searchContainer.innerHTML = `
            <input type="text" 
                   id="unreleased-search-input" 
                   placeholder="Search all unreleased songs..." 
                   style="width: 100%; 
                          padding: 0.75rem 1rem; 
                          border-radius: var(--radius); 
                          border: 1px solid var(--border); 
                          background: var(--background); 
                          color: var(--foreground);
                          font-size: 1rem;
                          outline: none;
                          transition: border-color 0.2s;"
                   onfocus="this.style.borderColor='var(--primary)'" 
                   onblur="this.style.borderColor='var(--border)'">
        `;
        projectsContainer.parentNode.insertBefore(searchContainer, projectsContainer);
    }

    // Render projects as cards
    projectsContainer.innerHTML = '';
    projectsContainer.className = 'card-grid';

    eras.forEach((era) => {
        let trackCount = 0;
        if (era.data) {
            Object.values(era.data).forEach((songs) => {
                if (songs && songs.length) {
                    trackCount += songs.length;
                }
            });
        }

        if (trackCount === 0) return;

        const cardHTML = createProjectCardHTML(era, artist, sheetId, trackCount);
        projectsContainer.insertAdjacentHTML('beforeend', cardHTML);

        const card = projectsContainer.lastElementChild;
        card._eraData = era;
        card._artistName = artist.name;
        card._sheetId = sheetId;

        card.onclick = (e) => {
            if (e.target.closest('.card-play-btn')) {
                e.stopPropagation();
                let eraTracks = [];
                if (era.data) {
                    Object.values(era.data).forEach((songs) => {
                        if (songs && songs.length) {
                            songs.forEach((song) => {
                                const track = createTrackFromSong(song, era, artist.name, eraTracks.length, sheetId);
                                eraTracks.push(track);
                            });
                        }
                    });
                }
                const availableTracks = eraTracks.filter((t) => !t.unavailable);
                if (availableTracks.length > 0) {
                    globalPlayer.setQueue(availableTracks, 0);
                    globalPlayer.playTrackFromQueue();
                }
            } else if (e.target.closest('.card-menu-btn')) {
                e.stopPropagation();
            } else {
                navigate(`/unreleased/${sheetId}/${encodeURIComponent(era.name)}`);
            }
        };
    });

    // Add search functionality
    const searchInput = document.getElementById('unreleased-search-input');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            // Reset view
            projectsContainer.style.display = '';
            document.getElementById('unreleased-search-results')?.remove();
            return;
        }

        // Search through all songs
        let matches = [];
        eras.forEach((era) => {
            if (era.data) {
                Object.values(era.data).forEach((songs) => {
                    if (songs && songs.length) {
                        songs.forEach((song, index) => {
                            if (song.name.toLowerCase().includes(query)) {
                                matches.push({ song, era, index });
                            }
                        });
                    }
                });
            }
        });

        // Show results
        projectsContainer.style.display = 'none';
        let resultsContainer = document.getElementById('unreleased-search-results');
        if (!resultsContainer) {
            resultsContainer = document.createElement('div');
            resultsContainer.id = 'unreleased-search-results';
            projectsContainer.parentNode.insertBefore(resultsContainer, projectsContainer.nextSibling);
        }

        if (matches.length === 0) {
            resultsContainer.innerHTML =
                '<p style="text-align: center; padding: 2rem; color: var(--muted-foreground);">No songs found.</p>';
        } else {
            resultsContainer.innerHTML = `
                <h3 style="padding: 0 1rem; margin-bottom: 1rem;">Search Results (${matches.length} songs)</h3>
                <div class="track-list" id="unreleased-search-tracklist"></div>
            `;

            const tracklist = document.getElementById('unreleased-search-tracklist');
            const searchTracks = matches.map((m, i) => createTrackFromSong(m.song, m.era, artist.name, i, sheetId));
            renderTrackerTracks(tracklist, searchTracks);

            // Add click handlers
            tracklist.querySelectorAll('.track-item').forEach((item) => {
                const track = trackDataStore.get(item);
                if (!track || track.unavailable) return;

                item.onclick = (e) => {
                    if (e.target.closest('.track-menu-btn')) return;

                    const availableTracks = searchTracks.filter((t) => !t.unavailable);
                    const trackIndex = availableTracks.findIndex((t) => t.id === track.id);
                    if (trackIndex >= 0 && availableTracks.length > 0) {
                        globalPlayer.setQueue(availableTracks, trackIndex);
                        globalPlayer.playTrackFromQueue();
                    }
                };
            });
        }
    });

    document.title = `${artist.name} - Unreleased`;
}

// Render individual tracker project page
export async function renderTrackerProjectPage(sheetId, projectName, container, _ui) {
    if (!artistsData.length) {
        await loadArtistsData();
    }

    const artist = artistBySheetId.get(sheetId);
    if (!artist) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Project not found.</p>';
        return;
    }

    const trackerData = await fetchTrackerData(sheetId);
    if (!trackerData || !trackerData.eras) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Failed to load project data.</p>';
        return;
    }

    const era = Object.values(trackerData.eras).find((e) => e.name === projectName);
    if (!era) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Project not found.</p>';
        return;
    }

    // Collect all tracks for this era
    let eraTracks = [];
    if (era.data) {
        Object.values(era.data).forEach((songs) => {
            if (songs && songs.length) {
                songs.forEach((song) => {
                    const track = createTrackFromSong(song, era, artist.name, eraTracks.length, sheetId);
                    eraTracks.push(track);
                });
            }
        });
    }

    const availableCount = eraTracks.filter((t) => !t.unavailable).length;

    // Use the album page template structure
    const imageEl = document.getElementById('album-detail-image');
    const titleEl = document.getElementById('album-detail-title');
    const metaEl = document.getElementById('album-detail-meta');
    const prodEl = document.getElementById('album-detail-producer');
    const tracklistContainer = document.getElementById('album-detail-tracklist');
    const playBtn = document.getElementById('play-album-btn');
    const shuffleBtn = document.getElementById('shuffle-album-btn');
    const downloadBtn = document.getElementById('download-album-btn');
    const likeBtn = document.getElementById('like-album-btn');
    const mixBtn = document.getElementById('album-mix-btn');
    const addToPlaylistBtn = document.getElementById('add-album-to-playlist-btn');

    // Set album page content
    imageEl.src = era.image || 'assets/logo.svg';
    imageEl.style.backgroundColor = '';
    imageEl.onerror = function () {
        this.src = 'assets/logo.svg';
    };

    titleEl.textContent = era.name;
    metaEl.innerHTML = `${era.timeline || 'Unreleased'} • ${eraTracks.length} tracks • ${availableCount} available`;
    prodEl.innerHTML = `By <a href="/unreleased/${sheetId}">${artist.name}</a>`;

    // Setup buttons
    if (playBtn) {
        playBtn.innerHTML = `${SVG_PLAY}<span>Play Project</span>`;
        playBtn.onclick = () => {
            const availableTracks = eraTracks.filter((t) => !t.unavailable);
            if (availableTracks.length > 0) {
                globalPlayer.setQueue(availableTracks, 0);
                globalPlayer.playTrackFromQueue();
            }
        };
    }

    if (shuffleBtn) {
        shuffleBtn.onclick = () => {
            const availableTracks = eraTracks.filter((t) => !t.unavailable);
            if (availableTracks.length > 0) {
                const shuffled = [...availableTracks].sort(() => Math.random() - 0.5);
                globalPlayer.setQueue(shuffled, 0);
                globalPlayer.playTrackFromQueue();
            }
        };
    }

    if (downloadBtn) {
        downloadBtn.innerHTML = `<span>Download</span>`;
        downloadBtn.onclick = () => {
            alert('Project download coming soon! You can download individual tracks from the menu.');
        };
    }

    if (likeBtn) likeBtn.style.display = 'none';
    if (mixBtn) mixBtn.style.display = 'none';
    if (addToPlaylistBtn) addToPlaylistBtn.style.display = 'none';

    // Render tracks
    renderTrackerTracks(tracklistContainer, eraTracks);

    // Add click handlers for tracks
    tracklistContainer.querySelectorAll('.track-item').forEach((item) => {
        const track = trackDataStore.get(item);
        if (!track || track.unavailable) return;

        item.onclick = (e) => {
            if (e.target.closest('.track-menu-btn')) return;

            const availableTracks = eraTracks.filter((t) => !t.unavailable);
            const trackIndex = availableTracks.findIndex((t) => t.id === track.id);
            if (trackIndex >= 0 && availableTracks.length > 0) {
                globalPlayer.setQueue(availableTracks, trackIndex);
                globalPlayer.playTrackFromQueue();
            }
        };
    });

    // Show other projects as recommendations
    const moreAlbumsSection = document.getElementById('album-section-more-albums');
    const moreAlbumsContainer = document.getElementById('album-detail-more-albums');
    const moreAlbumsTitle = document.getElementById('album-title-more-albums');

    if (moreAlbumsSection && moreAlbumsContainer) {
        const otherEras = Object.values(trackerData.eras).filter((e) => e.name !== projectName);
        if (otherEras.length > 0) {
            moreAlbumsContainer.innerHTML = otherEras
                .map((e) => {
                    let trackCount = 0;
                    if (e.data) {
                        Object.values(e.data).forEach((songs) => {
                            if (songs && songs.length) trackCount += songs.length;
                        });
                    }
                    return createProjectCardHTML(e, artist, sheetId, trackCount);
                })
                .join('');

            if (moreAlbumsTitle) {
                moreAlbumsTitle.textContent = `More unreleased from ${artist.name}`;
            }
            moreAlbumsSection.style.display = 'block';

            // Add click handlers for recommendation cards
            moreAlbumsContainer.querySelectorAll('.card').forEach((card) => {
                const eraName = decodeURIComponent(card.dataset.trackerProjectId);
                const era = trackerData.eras[eraName];
                if (!era) return;

                card.onclick = (e) => {
                    if (e.target.closest('.card-play-btn')) {
                        e.stopPropagation();
                        let otherEraTracks = [];
                        if (era.data) {
                            Object.values(era.data).forEach((songs) => {
                                if (songs && songs.length) {
                                    songs.forEach((song) => {
                                        const track = createTrackFromSong(
                                            song,
                                            era,
                                            artist.name,
                                            otherEraTracks.length,
                                            sheetId
                                        );
                                        otherEraTracks.push(track);
                                    });
                                }
                            });
                        }
                        const availableTracks = otherEraTracks.filter((t) => !t.unavailable);
                        if (availableTracks.length > 0) {
                            globalPlayer.setQueue(availableTracks, 0);
                            globalPlayer.playTrackFromQueue();
                        }
                    } else if (e.target.closest('.card-menu-btn')) {
                        e.stopPropagation();
                    } else {
                        navigate(`/unreleased/${sheetId}/${encodeURIComponent(era.name)}`);
                    }
                };
            });
        } else {
            moreAlbumsSection.style.display = 'none';
        }
    }

    // Hide other sections that don't apply
    const epsSection = document.getElementById('album-section-eps');
    const similarArtistsSection = document.getElementById('album-section-similar-artists');
    const similarAlbumsSection = document.getElementById('album-section-similar-albums');

    if (epsSection) epsSection.style.display = 'none';
    if (similarArtistsSection) similarArtistsSection.style.display = 'none';
    if (similarAlbumsSection) similarAlbumsSection.style.display = 'none';

    document.title = `${era.name} - ${artist.name}`;
}

// Render the unreleased page with all artists
export async function renderUnreleasedPage(container) {
    container.innerHTML = `
        <h2 class="section-title">Unreleased Music</h2>
        <p style="color: var(--muted-foreground); margin-bottom: 1.5rem; font-size: 0.9rem;">
            Unreleased Songs & Info Provided By <a href="https://artistgrid.cx" target="_blank" style="text-decoration: underline;">ArtistGrid</a>. Consider Donating to Them.
        </p>
        <div style="margin-bottom: 1.5rem;">
            <input 
                type="text" 
                id="unreleased-search-input" 
                placeholder="Search artists..." 
                style="width: 100%; max-width: 400px; padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border); background: var(--background); color: var(--foreground); font-size: 0.95rem;"
            />
        </div>
        <div id="unreleased-artists-grid" class="card-grid"></div>
        <div id="unreleased-no-results" style="display: none; text-align: center; padding: 2rem; color: var(--muted-foreground);">
            No artists found matching your search.
        </div>
    `;

    const gridContainer = document.getElementById('unreleased-artists-grid');
    const searchInput = document.getElementById('unreleased-search-input');
    const noResults = document.getElementById('unreleased-no-results');

    // Store all artist cards for filtering
    let allArtistCards = [];

    if (artistsData.length === 0) {
        await loadArtistsPopularity();
        await loadArtistsData();
    }

    gridContainer.innerHTML = '';
    allArtistCards = [];

    artistsData.forEach((artist) => {
        const sheetId = getSheetId(artist.url);
        if (!sheetId) return;

        const artistCard = document.createElement('div');
        artistCard.className = 'card';
        artistCard.style.cursor = 'pointer';
        artistCard.dataset.artistName = artist.name.toLowerCase();

        const normalizedName = normalizeArtistName(artist.name);
        const coverImage = `https://assets.artistgrid.cx/${normalizedName}.webp`;

        artistCard.innerHTML = `
            <div class="card-image-wrapper">
                <img class="card-image" src="${coverImage}" alt="${artist.name}" loading="lazy" onerror="this.src='assets/logo.svg'">
            </div>
            <div class="card-info">
                <h4 class="card-title">${artist.name}</h4>
                <p class="card-subtitle">Unreleased Music</p>
            </div>
        `;

        artistCard.onclick = () => {
            navigate(`/unreleased/${sheetId}`);
        };

        gridContainer.appendChild(artistCard);
        allArtistCards.push(artistCard);
    });

    if (artistsData.length === 0) {
        gridContainer.innerHTML =
            '<p style="text-align: center; color: var(--muted-foreground);">No unreleased music data available.</p>';
    }

    // Setup search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            let visibleCount = 0;

            allArtistCards.forEach((card) => {
                const artistName = card.dataset.artistName;
                if (artistName.includes(query)) {
                    card.style.display = '';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            // Show/hide no results message
            if (noResults) {
                noResults.style.display = visibleCount === 0 && query ? 'block' : 'none';
            }
        });
    }
}

// Render track page for unreleased songs
export async function renderTrackerTrackPage(trackId, container, _ui) {
    // Parse track ID: tracker-{sheetId}-{eraName}-{index}
    const parts = trackId.split('-');
    if (parts.length < 4) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Invalid track ID.</p>';
        return;
    }

    // Reconstruct sheetId (might contain hyphens)
    const sheetId = parts[1];
    const eraName = decodeURIComponent(parts.slice(2, -1).join('-'));
    const trackIndex = parseInt(parts[parts.length - 1]);

    if (!artistsData.length) {
        await loadArtistsData();
    }

    const artist = artistBySheetId.get(sheetId);
    if (!artist) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Artist not found.</p>';
        return;
    }

    const trackerData = await fetchTrackerData(sheetId);
    if (!trackerData || !trackerData.eras) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Failed to load track data.</p>';
        return;
    }

    const era = trackerData.eras[eraName];
    if (!era || !era.data) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Track not found.</p>';
        return;
    }

    // Find the specific track
    let currentTrack = null;
    let allTracks = [];

    Object.values(era.data).forEach((songs) => {
        if (songs && songs.length) {
            songs.forEach((song) => {
                const track = createTrackFromSong(song, era, artist.name, allTracks.length, sheetId);
                allTracks.push(track);
                if (allTracks.length - 1 === trackIndex) {
                    currentTrack = track;
                }
            });
        }
    });

    if (!currentTrack) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">Track not found.</p>';
        return;
    }

    // Show track page using album template
    const imageEl = document.getElementById('album-detail-image');
    const titleEl = document.getElementById('album-detail-title');
    const metaEl = document.getElementById('album-detail-meta');
    const prodEl = document.getElementById('album-detail-producer');
    const tracklistContainer = document.getElementById('album-detail-tracklist');
    const playBtn = document.getElementById('play-album-btn');

    imageEl.src = era.image || 'assets/logo.svg';
    imageEl.style.backgroundColor = '';
    imageEl.onerror = function () {
        this.src = 'assets/logo.svg';
    };

    titleEl.textContent = currentTrack.title;
    metaEl.innerHTML = `${era.timeline || 'Unreleased'} • ${formatTime(currentTrack.duration)}`;
    prodEl.innerHTML = `By <a href="/unreleased/${sheetId}">${artist.name}</a> • From <a href="/unreleased/${sheetId}/${encodeURIComponent(era.name)}">${era.name}</a>`;

    if (playBtn) {
        playBtn.innerHTML = `${SVG_PLAY}<span>Play Track</span>`;
        playBtn.onclick = () => {
            const availableTracks = allTracks.filter((t) => !t.unavailable);
            const trackPos = availableTracks.findIndex((t) => t.id === currentTrack.id);
            if (trackPos >= 0 && availableTracks.length > 0) {
                globalPlayer.setQueue(availableTracks, trackPos);
                globalPlayer.playTrackFromQueue();
            }
        };
    }

    // Hide unnecessary buttons
    const shuffleBtn = document.getElementById('shuffle-album-btn');
    const downloadBtn = document.getElementById('download-album-btn');
    const likeBtn = document.getElementById('like-album-btn');
    const mixBtn = document.getElementById('album-mix-btn');
    const addToPlaylistBtn = document.getElementById('add-album-to-playlist-btn');

    if (shuffleBtn) shuffleBtn.style.display = 'none';
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (likeBtn) likeBtn.style.display = 'none';
    if (mixBtn) mixBtn.style.display = 'none';
    if (addToPlaylistBtn) addToPlaylistBtn.style.display = 'none';

    // Render just this track
    renderTrackerTracks(tracklistContainer, [currentTrack]);

    // Add click handler
    const trackItem = tracklistContainer.querySelector('.track-item');
    if (trackItem && !currentTrack.unavailable) {
        trackItem.onclick = (e) => {
            if (e.target.closest('.track-menu-btn')) return;

            const availableTracks = allTracks.filter((t) => !t.unavailable);
            const trackPos = availableTracks.findIndex((t) => t.id === currentTrack.id);
            if (trackPos >= 0 && availableTracks.length > 0) {
                globalPlayer.setQueue(availableTracks, trackPos);
                globalPlayer.playTrackFromQueue();
            }
        };
    }

    // Show other projects
    const moreAlbumsSection = document.getElementById('album-section-more-albums');
    const moreAlbumsContainer = document.getElementById('album-detail-more-albums');
    const moreAlbumsTitle = document.getElementById('album-title-more-albums');

    if (moreAlbumsSection && moreAlbumsContainer) {
        const otherEras = Object.values(trackerData.eras).filter((e) => e.name !== eraName);
        if (otherEras.length > 0) {
            moreAlbumsContainer.innerHTML = otherEras
                .map((e) => {
                    let trackCount = 0;
                    if (e.data) {
                        Object.values(e.data).forEach((songs) => {
                            if (songs && songs.length) trackCount += songs.length;
                        });
                    }
                    return createProjectCardHTML(e, artist, sheetId, trackCount);
                })
                .join('');

            if (moreAlbumsTitle) moreAlbumsTitle.textContent = `More unreleased from ${artist.name}`;
            moreAlbumsSection.style.display = 'block';
        } else {
            moreAlbumsSection.style.display = 'none';
        }
    }

    const epsSection = document.getElementById('album-section-eps');
    const similarArtistsSection = document.getElementById('album-section-similar-artists');
    const similarAlbumsSection = document.getElementById('album-section-similar-albums');

    if (epsSection) epsSection.style.display = 'none';
    if (similarArtistsSection) similarArtistsSection.style.display = 'none';
    if (similarAlbumsSection) similarAlbumsSection.style.display = 'none';

    document.title = `${currentTrack.title} - ${artist.name}`;
}

export async function initTracker(player) {
    globalPlayer = player;
    await Promise.all([loadArtistsPopularity(), loadArtistsData()]);
}

// Helper function to find a tracker artist by name (for use in normal artist pages)
export function findTrackerArtistByName(artistName) {
    // First try exact match
    let match = artistsData.find((a) => a.name.toLowerCase() === artistName.toLowerCase());
    if (match) return match;

    // Try fuzzy match (remove special chars and spaces)
    const normalized = artistName.toLowerCase().replace(/[^a-z0-9]/g, '');
    match = artistsData.find((a) => {
        const aNormalized = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return aNormalized === normalized || aNormalized.includes(normalized) || normalized.includes(aNormalized);
    });

    return match || null;
}

// Helper function to get artist's unreleased projects (for use in normal artist pages)
export async function getArtistUnreleasedProjects(artistName) {
    const artist = findTrackerArtistByName(artistName);
    if (!artist) return null;

    const sheetId = getSheetId(artist.url);
    if (!sheetId) return null;

    const trackerData = await fetchTrackerData(sheetId);
    if (!trackerData || !trackerData.eras) return null;

    return {
        artist,
        sheetId,
        eras: Object.values(trackerData.eras),
    };
}
