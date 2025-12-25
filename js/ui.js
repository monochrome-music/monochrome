//js/ui.js
import { SVG_PLAY, SVG_DOWNLOAD, SVG_MENU, formatTime, createPlaceholder, trackDataStore, hasExplicitContent, getTrackArtists, getTrackTitle, calculateTotalDuration, formatDuration } from './utils.js';
import { recentActivityManager, backgroundSettings, trackListSettings } from './storage.js';

export class UIRenderer {
    constructor(api, player) {
        this.api = api;
        this.player = player;
        this.currentTrack = null;
        this.searchAbortController = null;
    }

    setCurrentTrack(track) {
        this.currentTrack = track;
        this.updateGlobalTheme();
    }

    updateGlobalTheme() {
        // If the album background setting is disabled, we don't do global coloring
        // except possibly for the album page which handles its own check.
        // But here we are handling the "not on album page" case or general updates.
        
        // Check if we are currently viewing an album page
        const isAlbumPage = document.getElementById('page-album').classList.contains('active');

        if (isAlbumPage) {
            // The album page render logic handles its own coloring.
            // We shouldn't override it here.
            return;
        }

        if (backgroundSettings.isEnabled() && this.currentTrack?.album?.vibrantColor) {
            this.setVibrantColor(this.currentTrack.album.vibrantColor);
        } else {
            this.resetVibrantColor();
        }
    }

    createExplicitBadge() {
        return '<span class="explicit-badge" title="Explicit">E</span>';
    }

    createTrackMenuButton() {
        return `
            <button class="track-menu-btn" onclick="event.stopPropagation();" title="More options">
                ${SVG_MENU}
            </button>
        `;
    }

    adjustTitleFontSize(element, text) {
        element.classList.remove('long-title', 'very-long-title');
        if (text.length > 40) {
            element.classList.add('very-long-title');
        } else if (text.length > 25) {
            element.classList.add('long-title');
        }
    }

    createTrackItemHTML(track, index, showCover = false, hasMultipleDiscs = false) {
        const playIconSmall = SVG_PLAY;
        const trackImageHTML = showCover ? `<img src="${this.api.getCoverUrl(track.album?.cover, '80')}" alt="Track Cover" class="track-item-cover" loading="lazy">` : '';

        let displayIndex;
        if (hasMultipleDiscs && !showCover) {
            const discNum = track.volumeNumber ?? track.discNumber ?? 1;
            displayIndex = `${discNum}-${track.trackNumber}`;
        } else {
            displayIndex = index + 1;
        }

        const trackNumberHTML = `<div class="track-number">${showCover ? trackImageHTML : displayIndex}</div>`;
        const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
        const trackArtists = getTrackArtists(track);
        const trackTitle = getTrackTitle(track);
        const isCurrentTrack = this.player?.currentTrack?.id === track.id;

        let yearDisplay = '';
        const releaseDate = track.album?.releaseDate || track.streamStartDate;
        if (releaseDate) {
            const date = new Date(releaseDate);
            if (!isNaN(date.getTime())) {
                yearDisplay = ` • ${date.getFullYear()}`;
            }
        }

        const actionsHTML = `
            <div class="track-actions-inline">
                <button class="track-action-btn" data-action="play-next" title="Play Next">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 6h6" />
                        <path d="M5 3v6" />
                        <path d="M11 6h10" />
                        <path d="M3 12h18" />
                        <path d="M3 18h18" />
                    </svg>
                </button>
                <button class="track-action-btn" data-action="add-to-queue" title="Add to Queue">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18" />
                        <path d="M3 12h18" />
                        <path d="M3 18h10" />
                        <path d="M16 18h6" />
                        <path d="M19 15v6" />
                    </svg>
                </button>
                <button class="track-action-btn" data-action="download" title="Download">
                    ${SVG_DOWNLOAD}
                </button>
            </div>
            <button class="track-menu-btn" type="button" title="More options">
                ${SVG_MENU}
            </button>
        `;

        return `
            <div class="track-item ${isCurrentTrack ? 'playing' : ''}" data-track-id="${track.id}">
                ${trackNumberHTML}
                <div class="track-item-info">
                    <div class="track-item-details">
                        <div class="title">
                            ${trackTitle}
                            ${explicitBadge}
                        </div>
                        <div class="artist">${trackArtists}${yearDisplay}</div>
                    </div>
                </div>
                <div class="track-item-duration">${formatTime(track.duration)}</div>
                <div class="track-item-actions">
                    ${actionsHTML}
                </div>
            </div>
        `;
    }

    createAlbumCardHTML(album) {
        const explicitBadge = hasExplicitContent(album) ? this.createExplicitBadge() : '';
        let yearDisplay = '';
        if (album.releaseDate) {
            const date = new Date(album.releaseDate);
            if (!isNaN(date.getTime())) {
                yearDisplay = `${date.getFullYear()}`;
            }
        }

        let typeLabel = '';
        if (album.type === 'EP') {
            typeLabel = ' • EP';
        } else if (album.type === 'SINGLE') {
            typeLabel = ' • Single';
        } else if (!album.type && album.numberOfTracks) {
            if (album.numberOfTracks <= 3) typeLabel = ' • Single';
            else if (album.numberOfTracks <= 6) typeLabel = ' • EP';
        }

        return `
            <a href="#album/${album.id}" class="card">
                <div class="card-image-wrapper">
                    <img src="${this.api.getCoverUrl(album.cover, '320')}" alt="${album.title}" class="card-image" loading="lazy">
                </div>
                <h3 class="card-title">${album.title} ${explicitBadge}</h3>
                <p class="card-subtitle">${album.artist?.name ?? ''}</p>
                <p class="card-subtitle">${yearDisplay}${typeLabel}</p>
            </a>
        `;
    }

    createPlaylistCardHTML(playlist) {
        const imageId = playlist.squareImage || playlist.image || playlist.uuid; // Fallback or use a specific cover getter if needed
        return `
            <a href="#playlist/${playlist.uuid}" class="card">
                <div class="card-image-wrapper">
                    <img src="${this.api.getCoverUrl(imageId, '320')}" alt="${playlist.title}" class="card-image" loading="lazy">
                </div>
                <h3 class="card-title">${playlist.title}</h3>
                <p class="card-subtitle">${playlist.numberOfTracks || 0} tracks</p>
            </a>
        `;
    }

    createArtistCardHTML(artist) {
        return `
            <a href="#artist/${artist.id}" class="card artist">
                <div class="card-image-wrapper">
                    <img src="${this.api.getArtistPictureUrl(artist.picture, '320')}" alt="${artist.name}" class="card-image" loading="lazy">
                </div>
                <h3 class="card-title">${artist.name}</h3>
            </a>
        `;
    }

    createSkeletonTrack(showCover = false) {
        return `
            <div class="skeleton-track">
                ${showCover ? '<div class="skeleton skeleton-track-cover"></div>' : '<div class="skeleton skeleton-track-number"></div>'}
                <div class="skeleton-track-info">
                    <div class="skeleton-track-details">
                        <div class="skeleton skeleton-track-title"></div>
                        <div class="skeleton skeleton-track-artist"></div>
                    </div>
                </div>
                <div class="skeleton skeleton-track-duration"></div>
            </div>
        `;
    }

    createSkeletonCard(isArtist = false) {
        return `
            <div class="skeleton-card ${isArtist ? 'artist' : ''}">
                <div class="skeleton skeleton-card-image"></div>
                <div class="skeleton skeleton-card-title"></div>
                ${!isArtist ? '<div class="skeleton skeleton-card-subtitle"></div>' : ''}
            </div>
        `;
    }

    createSkeletonTracks(count = 5, showCover = false) {
        return `<div class="skeleton-container">${Array(count).fill(0).map(() => this.createSkeletonTrack(showCover)).join('')}</div>`;
    }

    createSkeletonCards(count = 6, isArtist = false) {
        return `<div class="card-grid">${Array(count).fill(0).map(() => this.createSkeletonCard(isArtist)).join('')}</div>`;
    }

    renderListWithTracks(container, tracks, showCover) {
        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');

        // Check if there are multiple discs in the tracks array
        const hasMultipleDiscs = tracks.some(t => (t.volumeNumber || t.discNumber || 1) > 1);

        tempDiv.innerHTML = tracks.map((track, i) =>
            this.createTrackItemHTML(track, i, showCover, hasMultipleDiscs)
        ).join('');

        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        container.innerHTML = '';
        container.appendChild(fragment);

        tracks.forEach(track => {
            const element = container.querySelector(`[data-track-id="${track.id}"]`);
            if (element) trackDataStore.set(element, track);
        });
    }

    setPageBackground(imageUrl) {
        const bgElement = document.getElementById('page-background');
        if (backgroundSettings.isEnabled() && imageUrl) {
            bgElement.style.backgroundImage = `url('${imageUrl}')`;
            bgElement.classList.add('active');
            document.body.classList.add('has-page-background');
        } else {
            bgElement.classList.remove('active');
            document.body.classList.remove('has-page-background');
            // Delay clearing the image to allow transition
            setTimeout(() => {
                if (!bgElement.classList.contains('active')) {
                    bgElement.style.backgroundImage = '';
                }
            }, 500);
        }
    }

    setVibrantColor(color) {
        if (!color) return;
        
        const root = document.documentElement;
        const theme = root.getAttribute('data-theme');
        const isLightMode = theme === 'light';

        let hex = color.replace('#', '');
        // Handle shorthand hex
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }

        let r = parseInt(hex.substr(0, 2), 16);
        let g = parseInt(hex.substr(2, 2), 16);
        let b = parseInt(hex.substr(4, 2), 16);

        // Calculate perceived brightness
        let brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;

        if (isLightMode) {
            // In light mode, the background is white.
            // We need the color (used for text/highlights) to be dark enough.
            // If brightness is too high (> 150), darken it.
            while (brightness > 150) {
                r = Math.floor(r * 0.9);
                g = Math.floor(g * 0.9);
                b = Math.floor(b * 0.9);
                brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            }
        } else {
            // In dark mode, the background is dark.
            // We need the color to be light enough.
            // If brightness is too low (< 80), lighten it.
            while (brightness < 80) {
                r = Math.min(255, Math.floor(r * 1.15));
                g = Math.min(255, Math.floor(g * 1.15));
                b = Math.min(255, Math.floor(b * 1.15));
                brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
                // Break if we hit white or can't get brighter to avoid infinite loop
                if (r >= 255 && g >= 255 && b >= 255) break;
            }
        }

        const adjustedColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        
        // Calculate contrast text color for buttons (text on top of the vibrant color)
        const foreground = brightness > 128 ? '#000000' : '#ffffff';

        // Set global CSS variables
        root.style.setProperty('--primary', adjustedColor);
        root.style.setProperty('--primary-foreground', foreground);
        root.style.setProperty('--highlight', adjustedColor);
        root.style.setProperty('--highlight-rgb', `${r}, ${g}, ${b}`);
        root.style.setProperty('--active-highlight', adjustedColor);
        root.style.setProperty('--ring', adjustedColor);

        // Calculate a safe hover color
        let hoverColor;
        if (brightness > 200) {
             const dr = Math.floor(r * 0.85);
             const dg = Math.floor(g * 0.85);
             const db = Math.floor(b * 0.85);
             hoverColor = `rgba(${dr}, ${dg}, ${db}, 0.25)`;
        } else {
             hoverColor = `rgba(${r}, ${g}, ${b}, 0.15)`;
        }
        root.style.setProperty('--track-hover-bg', hoverColor);
    }

    resetVibrantColor() {
        const root = document.documentElement;
        root.style.removeProperty('--primary');
        root.style.removeProperty('--primary-foreground');
        root.style.removeProperty('--highlight');
        root.style.removeProperty('--highlight-rgb');
        root.style.removeProperty('--active-highlight');
        root.style.removeProperty('--ring');
        root.style.removeProperty('--track-hover-bg');
    }

    showFullscreenCover(track, nextTrack) {
        if (!track) return;

        const overlay = document.getElementById('fullscreen-cover-overlay');
        const image = document.getElementById('fullscreen-cover-image');
        const title = document.getElementById('fullscreen-track-title');
        const artist = document.getElementById('fullscreen-track-artist');
        const nextTrackEl = document.getElementById('fullscreen-next-track');
        
        const coverUrl = this.api.getCoverUrl(track.album?.cover, '1280');

        image.src = coverUrl;
        title.textContent = track.title;
        artist.textContent = track.artist?.name || 'Unknown Artist';

        if (nextTrack) {
            nextTrackEl.style.display = 'flex';
            nextTrackEl.querySelector('.value').textContent = `${nextTrack.title} • ${nextTrack.artist?.name || 'Unknown'}`;
            
            // Replay animation
            nextTrackEl.classList.remove('animate-in');
            void nextTrackEl.offsetWidth; // Trigger reflow
            nextTrackEl.classList.add('animate-in');
        } else {
            nextTrackEl.style.display = 'none';
            nextTrackEl.classList.remove('animate-in');
        }

        // Set the background image via CSS variable for the pseudo-element to use
        overlay.style.setProperty('--bg-image', `url('${coverUrl}')`);
        
        overlay.style.display = 'flex';
    }

    closeFullscreenCover() {
        document.getElementById('fullscreen-cover-overlay').style.display = 'none';
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.toggle('active', link.hash === `#${pageId}`);
        });

        document.querySelector('.main-content').scrollTop = 0;

        // Clear background and color if not on album page
        if (pageId !== 'album') {
             this.setPageBackground(null);
             this.updateGlobalTheme();
        }

        if (pageId === 'settings') {
            this.renderApiSettings();
        }
    }

    async renderHomePage() {
        this.showPage('home');
        const recents = recentActivityManager.getRecents();

        const albumsContainer = document.getElementById('home-recent-albums');
        const artistsContainer = document.getElementById('home-recent-artists');
        const playlistsContainer = document.getElementById('home-recent-playlists');

        albumsContainer.innerHTML = recents.albums.length
            ? recents.albums.map(album => this.createAlbumCardHTML(album)).join('')
            : createPlaceholder("You haven't viewed any albums yet. Search for music to get started!");

        artistsContainer.innerHTML = recents.artists.length
            ? recents.artists.map(artist => this.createArtistCardHTML(artist)).join('')
            : createPlaceholder("You haven't viewed any artists yet. Search for music to get started!");

        if (playlistsContainer) {
            playlistsContainer.innerHTML = recents.playlists && recents.playlists.length
                ? recents.playlists.map(playlist => this.createPlaylistCardHTML(playlist)).join('')
                : createPlaceholder("You haven't viewed any playlists yet. Search for music to get started!");
        }
    }

    async renderSearchPage(query) {
        this.showPage('search');
        document.getElementById('search-results-title').textContent = `Search Results for "${query}"`;

        const tracksContainer = document.getElementById('search-tracks-container');
        const artistsContainer = document.getElementById('search-artists-container');
        const albumsContainer = document.getElementById('search-albums-container');
        const playlistsContainer = document.getElementById('search-playlists-container');

        tracksContainer.innerHTML = this.createSkeletonTracks(8, true);
        artistsContainer.innerHTML = this.createSkeletonCards(6, true);
        albumsContainer.innerHTML = this.createSkeletonCards(6, false);
        playlistsContainer.innerHTML = this.createSkeletonCards(6, false);

        if (this.searchAbortController) {
            this.searchAbortController.abort();
        }
        this.searchAbortController = new AbortController();
        const signal = this.searchAbortController.signal;

        try {
            const [tracksResult, artistsResult, albumsResult, playlistsResult] = await Promise.all([
                this.api.searchTracks(query, { signal }),
                this.api.searchArtists(query, { signal }),
                this.api.searchAlbums(query, { signal }),
                this.api.searchPlaylists(query, { signal })
            ]);

            let finalTracks = tracksResult.items;
            let finalArtists = artistsResult.items;
            let finalAlbums = albumsResult.items;
            let finalPlaylists = playlistsResult.items;

            if (finalArtists.length === 0 && finalTracks.length > 0) {
                const artistMap = new Map();
                finalTracks.forEach(track => {
                    if (track.artist && !artistMap.has(track.artist.id)) {
                        artistMap.set(track.artist.id, track.artist);
                    }
                    if (track.artists) {
                        track.artists.forEach(artist => {
                            if (!artistMap.has(artist.id)) {
                                artistMap.set(artist.id, artist);
                            }
                        });
                    }
                });
                finalArtists = Array.from(artistMap.values());
            }

            if (finalAlbums.length === 0 && finalTracks.length > 0) {
                const albumMap = new Map();
                finalTracks.forEach(track => {
                    if (track.album && !albumMap.has(track.album.id)) {
                        albumMap.set(track.album.id, track.album);
                    }
                });
                finalAlbums = Array.from(albumMap.values());
            }

            if (finalTracks.length) {
                this.renderListWithTracks(tracksContainer, finalTracks, true);
            } else {
                tracksContainer.innerHTML = createPlaceholder('No tracks found.');
            }

            artistsContainer.innerHTML = finalArtists.length
                ? finalArtists.map(artist => this.createArtistCardHTML(artist)).join('')
                : createPlaceholder('No artists found.');

            albumsContainer.innerHTML = finalAlbums.length
                ? finalAlbums.map(album => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            playlistsContainer.innerHTML = finalPlaylists.length
                ? finalPlaylists.map(playlist => this.createPlaylistCardHTML(playlist)).join('')
                : createPlaceholder('No playlists found.');

        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error("Search failed:", error);
            const errorMsg = createPlaceholder(`Error during search. ${error.message}`);
            tracksContainer.innerHTML = errorMsg;
            artistsContainer.innerHTML = errorMsg;
            albumsContainer.innerHTML = errorMsg;
            playlistsContainer.innerHTML = errorMsg;
        }
    }

    async renderAlbumPage(albumId) {
        this.showPage('album');

        const imageEl = document.getElementById('album-detail-image');
        const titleEl = document.getElementById('album-detail-title');
        const metaEl = document.getElementById('album-detail-meta');
        const prodEl = document.getElementById('album-detail-producer');
        const tracklistContainer = document.getElementById('album-detail-tracklist');
        const playBtn = document.getElementById('play-album-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play Album</span>`;
        const dlBtn = document.getElementById('download-album-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download Album</span>`;

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        prodEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        tracklistContainer.innerHTML = `
            <div class="track-list-header">
                <span style="width: 40px; text-align: center;">#</span>
                <span>Title</span>
                <span class="duration-header">Duration</span>
            </div>
            ${this.createSkeletonTracks(10, false)}
        `;

        try {
            const { album, tracks } = await this.api.getAlbum(albumId);

            const coverUrl = this.api.getCoverUrl(album.cover, '1280');
            imageEl.src = coverUrl;
            imageEl.style.backgroundColor = '';

            // Set background and vibrant color
            this.setPageBackground(coverUrl);
            if (backgroundSettings.isEnabled() && album.vibrantColor) {
                this.setVibrantColor(album.vibrantColor);
            } else {
                this.resetVibrantColor();
            }

            const explicitBadge = hasExplicitContent(album) ? this.createExplicitBadge() : '';
            titleEl.innerHTML = `${album.title} ${explicitBadge}`;

            this.adjustTitleFontSize(titleEl, album.title);

            const totalDuration = calculateTotalDuration(tracks);
            let dateDisplay = '';
            if (album.releaseDate) {
                const releaseDate = new Date(album.releaseDate);
                if (!isNaN(releaseDate.getTime())) {
                    const year = releaseDate.getFullYear();
                    dateDisplay = window.innerWidth > 768
                        ? releaseDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                        : year;
                }
            }

            const firstCopyright = tracks.find(track => track.copyright)?.copyright;

            metaEl.innerHTML =
                (dateDisplay ? `${dateDisplay} • ` : '') +
                `${tracks.length} tracks • ${formatDuration(totalDuration)}`;

            prodEl.innerHTML =
                `By <a href="#artist/${album.artist.id}">${album.artist.name}</a>` +
                (firstCopyright ? ` • ${firstCopyright}` : '');

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                </div>
            `;

            tracks.sort((a, b) => {
                const discA = a.volumeNumber ?? a.discNumber ?? 1;
                const discB = b.volumeNumber ?? b.discNumber ?? 1;
                if (discA !== discB) return discA - discB;
                return a.trackNumber - b.trackNumber;
            });
            this.renderListWithTracks(tracklistContainer, tracks, false);

            recentActivityManager.addAlbum(album);

            document.title = `${album.title} - ${album.artist.name} - Monochrome`;

            // "More from Artist" Sections
            try {
                // Remove any existing "More from" sections if re-rendering
                document.querySelectorAll('.album-more-section').forEach(el => el.remove());
                document.getElementById('album-more-from-artist')?.remove(); // Legacy cleanup

                // Create placeholder section while loading
                const placeholderSection = document.createElement('section');
                placeholderSection.className = 'content-section album-more-section';
                placeholderSection.style.marginTop = '3rem';
                placeholderSection.innerHTML = `
                    <h2 class="section-title">More from ${album.artist.name}</h2>
                    <div class="card-grid">
                        ${this.createSkeletonCards(6, false)}
                    </div>
                `;
                document.getElementById('page-album').appendChild(placeholderSection);

                const artistData = await this.api.getArtist(album.artist.id);
                
                // Remove placeholder
                placeholderSection.remove();

                const renderSection = (title, items) => {
                    const filtered = (items || [])
                        .filter(a => a.id != album.id)
                        .filter((a, index, self) => 
                            index === self.findIndex((t) => t.title === a.title) // Dedup by title
                        )
                        .slice(0, 12);
                    
                    if (filtered.length === 0) return;

                    const section = document.createElement('section');
                    section.className = 'content-section album-more-section';
                    section.style.marginTop = '3rem';
                    section.innerHTML = `
                        <h2 class="section-title">${title}</h2>
                        <div class="card-grid">
                            ${filtered.map(a => this.createAlbumCardHTML(a)).join('')}
                        </div>
                    `;
                    document.getElementById('page-album').appendChild(section);
                };

                renderSection(`More albums from ${album.artist.name}`, artistData.albums);
                renderSection(`EPs and Singles from ${album.artist.name}`, artistData.eps);

            } catch (err) {
                console.warn('Failed to load "More from artist":', err);
                document.querySelectorAll('.album-more-section').forEach(el => el.remove());
            }

        } catch (error) {
            console.error("Failed to load album:", error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load album details. ${error.message}`);
        }
    }

    async renderPlaylistPage(playlistId) {
        this.showPage('playlist');

        const imageEl = document.getElementById('playlist-detail-image');
        const titleEl = document.getElementById('playlist-detail-title');
        const metaEl = document.getElementById('playlist-detail-meta');
        const descEl = document.getElementById('playlist-detail-description');
        const tracklistContainer = document.getElementById('playlist-detail-tracklist');
        const playBtn = document.getElementById('play-playlist-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play</span>`;
        const dlBtn = document.getElementById('download-playlist-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download</span>`;

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        descEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100%;"></div>';
        tracklistContainer.innerHTML = `
            <div class="track-list-header">
                <span style="width: 40px; text-align: center;">#</span>
                <span>Title</span>
                <span class="duration-header">Duration</span>
            </div>
            ${this.createSkeletonTracks(10, true)}
        `;

        try {
            const { playlist, tracks } = await this.api.getPlaylist(playlistId);

            const imageId = playlist.squareImage || playlist.image;
            imageEl.src = this.api.getCoverUrl(imageId, '1080');
            imageEl.style.backgroundColor = '';

            titleEl.textContent = playlist.title;
            this.adjustTitleFontSize(titleEl, playlist.title);

            const totalDuration = calculateTotalDuration(tracks);

            metaEl.textContent = `${playlist.numberOfTracks} tracks • ${formatDuration(totalDuration)}`;
            descEl.textContent = playlist.description || '';

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                </div>
            `;

            this.renderListWithTracks(tracklistContainer, tracks, true);
            recentActivityManager.addPlaylist(playlist);

            document.title = `${playlist.title || 'Artist Mix'} - Monochrome`;
        } catch (error) {
            console.error("Failed to load playlist:", error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load playlist details. ${error.message}`);
        }
    }

    async renderArtistPage(artistId) {
        this.showPage('artist');

        const imageEl = document.getElementById('artist-detail-image');
        const nameEl = document.getElementById('artist-detail-name');
        const metaEl = document.getElementById('artist-detail-meta');
        const tracksContainer = document.getElementById('artist-detail-tracks');
        const albumsContainer = document.getElementById('artist-detail-albums');
        const epsContainer = document.getElementById('artist-detail-eps');
        const epsSection = document.getElementById('artist-section-eps');
        const dlBtn = document.getElementById('download-discography-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download Discography</span>`;

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        nameEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 150px;"></div>';
        tracksContainer.innerHTML = this.createSkeletonTracks(5, true);
        albumsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (epsContainer) epsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (epsSection) epsSection.style.display = 'none';

        try {
            const artist = await this.api.getArtist(artistId);

            imageEl.src = this.api.getArtistPictureUrl(artist.picture, '750');
            imageEl.style.backgroundColor = '';
            nameEl.textContent = artist.name;

            this.adjustTitleFontSize(nameEl, artist.name);

            metaEl.innerHTML = `
                <span>${artist.popularity} popularity</span>
                <div class="artist-tags">
                    ${(artist.artistRoles || [])
                        .filter(role => role.category)
                        .map(role => `<span class="artist-tag">${role.category}</span>`)
                        .join('')}
                </div>
            `;

            this.renderListWithTracks(tracksContainer, artist.tracks, true);
            
            // Render Albums
            albumsContainer.innerHTML = artist.albums.length 
                ? artist.albums.map(album => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            // Render EPs and Singles
            if (epsContainer && epsSection) {
                if (artist.eps && artist.eps.length > 0) {
                    epsContainer.innerHTML = artist.eps.map(album => this.createAlbumCardHTML(album)).join('');
                    epsSection.style.display = 'block';
                } else {
                    epsSection.style.display = 'none';
                }
            }

            recentActivityManager.addArtist(artist);

            document.title = `${artist.name} - Monochrome`;
        } catch (error) {
            console.error("Failed to load artist:", error);
            tracksContainer.innerHTML = albumsContainer.innerHTML =
                createPlaceholder(`Could not load artist details. ${error.message}`);
        }
    }

    renderApiSettings() {
        const container = document.getElementById('api-instance-list');
        this.api.settings.getInstances().then(instances => {
            const cachedData = this.api.settings.getCachedSpeedTests();
            const speeds = cachedData?.speeds || {};

            container.innerHTML = instances.map((url, index) => {
                const speedInfo = speeds[url];
                const speedText = speedInfo
                    ? (speedInfo.speed === Infinity || typeof speedInfo.speed !== 'number'
                        ? `<span style="color: var(--muted-foreground); font-size: 0.8rem;">Failed</span>`
                        : `<span style="color: var(--muted-foreground); font-size: 0.8rem;">${speedInfo.speed.toFixed(0)}ms</span>`)
                    : '';

                return `
                    <li data-index="${index}">
                        <div style="flex: 1; min-width: 0;">
                            <div class="instance-url">${url}</div>
                            ${speedText}
                        </div>
                        <div class="controls">
                            <button class="move-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 19V5M5 12l7-7 7 7"/>
                                </svg>
                            </button>
                            <button class="move-down" title="Move Down" ${index === instances.length - 1 ? 'disabled' : ''}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 5v14M19 12l-7 7-7-7"/>
                                </svg>
                            </button>
                        </div>
                    </li>
                `;
            }).join('');

            const stats = this.api.getCacheStats();
            const cacheInfo = document.getElementById('cache-info');
            if (cacheInfo) {
                cacheInfo.textContent = `Cache: ${stats.memoryEntries}/${stats.maxSize} entries`;
            }
        });
    }
}
