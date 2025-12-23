//js/ui.js
import { formatTime, createPlaceholder, trackDataStore, hasExplicitContent, getTrackArtists, getTrackTitle, calculateTotalDuration, formatDuration } from './utils.js';
import { recentActivityManager } from './storage.js';

export class UIRenderer {
    constructor(api) {
        this.api = api;
    }

    createExplicitBadge() {
        return '<span class="explicit-badge" title="Explicit">E</span>';
    }

    createTrackMenuButton() {
        return `
            <button class="track-menu-btn" onclick="event.stopPropagation();" title="More options">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
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
        const playIconSmall = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
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

        let yearDisplay = '';
        const releaseDate = track.album?.releaseDate || track.streamStartDate;
        if (releaseDate) {
            const date = new Date(releaseDate);
            if (!isNaN(date.getTime())) {
                yearDisplay = ` • ${date.getFullYear()}`;
            }
        }

        return `
            <div class="track-item" data-track-id="${track.id}">
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
                <button class="track-menu-btn" type="button" title="More options">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                </button>
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
        return `
            <a href="#album/${album.id}" class="card">
                <div class="card-image-wrapper">
                    <img src="${this.api.getCoverUrl(album.cover, '320')}" alt="${album.title}" class="card-image" loading="lazy">
                </div>
                <h3 class="card-title">${album.title} ${explicitBadge}</h3>
                <p class="card-subtitle">${album.artist?.name ?? ''}</p>
                <p class="card-subtitle">${yearDisplay}</p>
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

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.toggle('active', link.hash === `#${pageId}`);
        });

        document.querySelector('.main-content').scrollTop = 0;

        if (pageId === 'settings') {
            this.renderApiSettings();
        }
    }

    async renderHomePage() {
        this.showPage('home');
        const recents = recentActivityManager.getRecents();

        const albumsContainer = document.getElementById('home-recent-albums');
        const artistsContainer = document.getElementById('home-recent-artists');

        albumsContainer.innerHTML = recents.albums.length
            ? recents.albums.map(album => this.createAlbumCardHTML(album)).join('')
            : createPlaceholder("You haven't viewed any albums yet. Search for music to get started!");

        artistsContainer.innerHTML = recents.artists.length
            ? recents.artists.map(artist => this.createArtistCardHTML(artist)).join('')
            : createPlaceholder("You haven't viewed any artists yet. Search for music to get started!");
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

        try {
            const [tracksResult, artistsResult, albumsResult, playlistsResult] = await Promise.all([
                this.api.searchTracks(query),
                this.api.searchArtists(query),
                this.api.searchAlbums(query),
                this.api.searchPlaylists(query)
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

            imageEl.src = this.api.getCoverUrl(album.cover, '1280');
            imageEl.style.backgroundColor = '';

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

        document.title = `${playlist.title} - Monochrome`;
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

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        nameEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 150px;"></div>';
        tracksContainer.innerHTML = this.createSkeletonTracks(5, true);
        albumsContainer.innerHTML = this.createSkeletonCards(6, false);

        try {
            const artist = await this.api.getArtist(artistId);

            imageEl.src = this.api.getArtistPictureUrl(artist.picture, '750');
            imageEl.style.backgroundColor = '';
            nameEl.textContent = artist.name;

            this.adjustTitleFontSize(nameEl, artist.name);

            metaEl.textContent = `${artist.popularity} popularity`;

            this.renderListWithTracks(tracksContainer, artist.tracks, true);
            albumsContainer.innerHTML = artist.albums.map(album =>
                this.createAlbumCardHTML(album)
            ).join('');

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
                    ? (speedInfo.speed === Infinity
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
