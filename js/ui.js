//js/ui.js
import { SVG_PLAY, SVG_DOWNLOAD, SVG_MENU, SVG_HEART, formatTime, createPlaceholder, trackDataStore, hasExplicitContent, getTrackArtists, getTrackTitle, calculateTotalDuration, formatDuration } from './utils.js';
import { openLyricsPanel } from './lyrics.js';
import { recentActivityManager, backgroundSettings, trackListSettings, cardSettings } from './storage.js';
import { db } from './db.js';
import { getVibrantColorFromImage } from './vibrant-color.js';

export class UIRenderer {
    constructor(api, player) {
        this.api = api;
        this.player = player;
        this.currentTrack = null;
        this.searchAbortController = null;
        this.vibrantColorCache = new Map();
    }

    // Helper for Heart Icon
    createHeartIcon(filled = false) {
        if (filled) {
            return SVG_HEART.replace('class="heart-icon"', 'class="heart-icon filled"');
        }
        return SVG_HEART;
    }

    async extractAndApplyColor(url) {
        if (!backgroundSettings.isEnabled() || !url) {
            this.resetVibrantColor();
            return;
        }

        // Check cache first
        if (this.vibrantColorCache.has(url)) {
            const cachedColor = this.vibrantColorCache.get(url);
            if (cachedColor) {
                this.setVibrantColor(cachedColor);
                return;
            }
        }

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        // Add cache buster to bypass opaque response in cache
        const separator = url.includes('?') ? '&' : '?';
        img.src = `${url}${separator}not-from-cache-please`;

        img.onload = () => {
            try {
                const color = getVibrantColorFromImage(img);
                if (color) {
                    this.vibrantColorCache.set(url, color);
                    this.setVibrantColor(color);
                } else {
                    this.vibrantColorCache.set(url, null);
                    this.resetVibrantColor();
                }
            } catch (e) {
                this.vibrantColorCache.set(url, null);
                this.resetVibrantColor();
            }
        };

        img.onerror = () => {
            this.vibrantColorCache.set(url, null);
            this.resetVibrantColor();
        };
    }

    async updateLikeState(element, type, id) {
        const isLiked = await db.isFavorite(type, id);
        const btn = element.querySelector('.like-btn');
        if (btn) {
            btn.innerHTML = this.createHeartIcon(isLiked);
            btn.classList.toggle('active', isLiked);
            btn.title = isLiked ? 'Remove from Liked' : 'Add to Liked';
        }
    }

    setCurrentTrack(track) {
        this.currentTrack = track;
        this.updateGlobalTheme();
        
        const likeBtn = document.getElementById('now-playing-like-btn');
        if (likeBtn) {
            if (track) {
                likeBtn.style.display = 'flex';
                // Use the centralized update logic if possible, or manual here
                this.updateLikeState(likeBtn.parentElement, 'track', track.id);
            } else {
                likeBtn.style.display = 'none';
            }
        }
    }

    updateGlobalTheme() {
        // Check if we are currently viewing an album page
        const isAlbumPage = document.getElementById('page-album').classList.contains('active');

        if (isAlbumPage) {
            // The album page render logic handles its own coloring.
            // We shouldn't override it here.
            return;
        }

        if (backgroundSettings.isEnabled() && this.currentTrack?.album?.cover) {
            this.extractAndApplyColor(this.api.getCoverUrl(this.currentTrack.album.cover, '80'));
        } else {
            this.resetVibrantColor();
        }
    }

    createExplicitBadge() {
        return '<span class="explicit-badge" title="Explicit">E</span>';
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
        const trackImageHTML = showCover ? `<img src="${this.api.getCoverUrl(track.album?.cover)}" alt="Track Cover" class="track-item-cover" loading="lazy">` : '';

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
                <button class="track-action-btn like-btn" data-action="toggle-like" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
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

    createPlaylistCardHTML(playlist) {
        const imageId = playlist.squareImage || playlist.image || playlist.uuid; // Fallback or use a specific cover getter if needed
        const isCompact = cardSettings.isCompactAlbum();
        return `
            <div class="card ${isCompact ? 'compact' : ''}" data-playlist-id="${playlist.uuid}" data-href="#playlist/${playlist.uuid}" style="cursor: pointer;">
                <div class="card-image-wrapper">
                    <img src="${this.api.getCoverUrl(imageId)}" alt="${playlist.title}" class="card-image" loading="lazy">
                    <button class="like-btn card-like-btn" data-action="toggle-like" data-type="playlist" title="Add to Liked">
                        ${this.createHeartIcon(false)}
                    </button>
                    <button class="play-btn card-play-btn" data-action="play-card" data-type="playlist" data-id="${playlist.uuid}" title="Play">
                        ${SVG_PLAY}
                    </button>
                </div>
                <div class="card-info">
                    <h4 class="card-title">${playlist.title}</h4>
                    <p class="card-subtitle">${playlist.numberOfTracks || 0} tracks</p>
                </div>
            </div>
        `;
    }

    createMixCardHTML(mix) {
        const imageSrc = mix.cover || 'assets/appicon.png';
        const description = mix.subTitle || mix.description || '';
        const isCompact = cardSettings.isCompactAlbum();
        
        return `
            <div class="card ${isCompact ? 'compact' : ''}" data-mix-id="${mix.id}" data-href="#mix/${mix.id}" style="cursor: pointer;">
                <div class="card-image-wrapper">
                    <img src="${imageSrc}" alt="${mix.title}" class="card-image" loading="lazy">
                    <button class="like-btn card-like-btn" data-action="toggle-like" data-type="mix" title="Add to Liked">
                        ${this.createHeartIcon(false)}
                    </button>
                    <button class="play-btn card-play-btn" data-action="play-card" data-type="mix" data-id="${mix.id}" title="Play">
                        ${SVG_PLAY}
                    </button>
                </div>
                <div class="card-info">
                    <h4 class="card-title">${mix.title}</h4>
                    <p class="card-subtitle">${description}</p>
                </div>
            </div>
        `;
    }

    createUserPlaylistCardHTML(playlist) {
        let imageHTML = '';
        
        if (playlist.cover) {
             imageHTML = `<img src="${playlist.cover}" alt="${playlist.name}" class="card-image" loading="lazy">`;
        } else {
            const tracks = playlist.tracks || [];
            let uniqueCovers = playlist.images || [];
            const seenCovers = new Set(uniqueCovers);

            if (uniqueCovers.length === 0) {
                for (const track of tracks) {
                    const cover = track.album?.cover;
                    if (cover && !seenCovers.has(cover)) {
                        seenCovers.add(cover);
                        uniqueCovers.push(cover);
                        if (uniqueCovers.length >= 4) break;
                    }
                }
            }

            if (uniqueCovers.length >= 2) {
                const count = Math.min(uniqueCovers.length, 4);
                const itemsClass = count < 4 ? `items-${count}` : '';
                const covers = uniqueCovers.slice(0, 4);
                
                imageHTML = `
                    <div class="card-image card-collage ${itemsClass}">
                        ${covers.map(cover => `<img src="${this.api.getCoverUrl(cover)}" alt="" loading="lazy">`).join('')}
                    </div>
                `;
            } else if (uniqueCovers.length > 0) {
                imageHTML = `<img src="${this.api.getCoverUrl(uniqueCovers[0])}" alt="${playlist.name}" class="card-image" loading="lazy">`;
            } else {
                imageHTML = `<img src="assets/appicon.png" alt="${playlist.name}" class="card-image" loading="lazy">`;
            }
        }

        const isCompact = cardSettings.isCompactAlbum();

        return `
            <div class="card user-playlist ${isCompact ? 'compact' : ''}" data-playlist-id="${playlist.id}" data-href="#userplaylist/${playlist.id}" style="cursor: pointer;">
                <div class="card-image-wrapper">
                    ${imageHTML}
                    <button class="edit-playlist-btn" data-action="edit-playlist" title="Edit Playlist">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="delete-playlist-btn" data-action="delete-playlist" title="Delete Playlist">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18"/>
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>
                    <button class="play-btn card-play-btn" data-action="play-card" data-type="user-playlist" data-id="${playlist.id}" title="Play">
                        ${SVG_PLAY}
                    </button>
                </div>
                <div class="card-info">
                    <h4 class="card-title">${playlist.name}</h4>
                    <p class="card-subtitle">${playlist.tracks ? playlist.tracks.length : (playlist.numberOfTracks || 0)} tracks</p>
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
        }

        const isCompact = cardSettings.isCompactAlbum();

        return `
            <div class="card ${isCompact ? 'compact' : ''}" data-album-id="${album.id}" data-href="#album/${album.id}" style="cursor: pointer;">
                <div class="card-image-wrapper">
                    <img src="${this.api.getCoverUrl(album.cover)}" alt="${album.title}" class="card-image" loading="lazy">
                    <button class="like-btn card-like-btn" data-action="toggle-like" data-type="album" title="Add to Liked">
                        ${this.createHeartIcon(false)}
                    </button>
                    <button class="play-btn card-play-btn" data-action="play-card" data-type="album" data-id="${album.id}" title="Play">
                        ${SVG_PLAY}
                    </button>
                </div>
                <div class="card-info">
                    <h4 class="card-title">${album.title} ${explicitBadge}</h4>
                    <p class="card-subtitle">${album.artist?.name ?? ''}</p>
                    <p class="card-subtitle">${yearDisplay}${typeLabel}</p>
                </div>
            </div>
        `;
    }

    createArtistCardHTML(artist) {
        const isCompact = cardSettings.isCompactArtist();
        return `
            <div class="card artist ${isCompact ? 'compact' : ''}" data-artist-id="${artist.id}" data-href="#artist/${artist.id}" style="cursor: pointer;">
                <div class="card-image-wrapper">
                    <img src="${this.api.getArtistPictureUrl(artist.picture)}" alt="${artist.name}" class="card-image" loading="lazy">
                    <button class="like-btn card-like-btn" data-action="toggle-like" data-type="artist" title="Add to Liked">
                        ${this.createHeartIcon(false)}
                    </button>
                </div>
                <h4 class="card-title">${artist.name}</h4>
            </div>
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
            if (element) {
                trackDataStore.set(element, track);
                // Async update for like button
                this.updateLikeState(element, 'track', track.id);
            }
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
                r = Math.min(255, Math.max(r + 1, Math.floor(r * 1.15)));
                g = Math.min(255, Math.max(g + 1, Math.floor(g * 1.15)));
                b = Math.min(255, Math.max(b + 1, Math.floor(b * 1.15)));
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

async showFullscreenCover(track, nextTrack, lyricsManager, audioPlayer) {
    if (!track) return;
    const overlay = document.getElementById('fullscreen-cover-overlay');
    const image = document.getElementById('fullscreen-cover-image');
    const title = document.getElementById('fullscreen-track-title');
    const artist = document.getElementById('fullscreen-track-artist');
    const nextTrackEl = document.getElementById('fullscreen-next-track');
    const lyricsContainer = document.getElementById('fullscreen-lyrics-container');
    const lyricsToggleBtn = document.getElementById('toggle-fullscreen-lyrics-btn');
    
    const coverUrl = this.api.getCoverUrl(track.album?.cover, '1280');
    image.src = coverUrl;
    title.textContent = track.title;
    artist.textContent = getTrackArtists(track);

    if (nextTrack) {
        nextTrackEl.style.display = 'flex';
        nextTrackEl.querySelector('.value').textContent = `${nextTrack.title} • ${getTrackArtists(nextTrack)}`;
        
        nextTrackEl.classList.remove('animate-in');
        void nextTrackEl.offsetWidth;
        nextTrackEl.classList.add('animate-in');    } else {
        nextTrackEl.style.display = 'none';
        nextTrackEl.classList.remove('animate-in');
    }
    
    overlay.style.setProperty('--bg-image', `url('${coverUrl}')`);
    
    if (lyricsManager && audioPlayer) {
        lyricsToggleBtn.style.display = 'flex';
        lyricsToggleBtn.classList.remove('active');
        
        const toggleLyrics = () => {
            openLyricsPanel(track, audioPlayer, lyricsManager);
            lyricsToggleBtn.classList.toggle('active');
        };
        
        const newToggleBtn = lyricsToggleBtn.cloneNode(true);
        lyricsToggleBtn.parentNode.replaceChild(newToggleBtn, lyricsToggleBtn);
        newToggleBtn.addEventListener('click', toggleLyrics);
    } else {
        lyricsToggleBtn.style.display = 'none';
    }
    
    overlay.style.display = 'flex';
}

    closeFullscreenCover() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        overlay.style.display = 'none';
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            link.classList.toggle('active', link.hash === `#${pageId}`);
        });

        document.querySelector('.main-content').scrollTop = 0;

        // Clear background and color if not on album, artist, playlist, or mix page
        if (!['album', 'artist', 'playlist', 'mix'].includes(pageId)) {
             this.setPageBackground(null);
             this.updateGlobalTheme();
        }

        if (pageId === 'settings') {
            this.renderApiSettings();
        }
    }

    async renderLibraryPage() {
        this.showPage('library');
        
        const tracksContainer = document.getElementById('library-tracks-container');
        const albumsContainer = document.getElementById('library-albums-container');
        const artistsContainer = document.getElementById('library-artists-container');
        const playlistsContainer = document.getElementById('library-playlists-container');

        const likedTracks = await db.getFavorites('track');
        if (likedTracks.length) {
            this.renderListWithTracks(tracksContainer, likedTracks, true);
        } else {
            tracksContainer.innerHTML = createPlaceholder('No liked tracks yet.');
        }

        const likedAlbums = await db.getFavorites('album');
        if (likedAlbums.length) {
            albumsContainer.innerHTML = likedAlbums.map(a => this.createAlbumCardHTML(a)).join('');
            likedAlbums.forEach(album => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });
        } else {
            albumsContainer.innerHTML = createPlaceholder('No liked albums yet.');
        }

        const likedArtists = await db.getFavorites('artist');
        if (likedArtists.length) {
            artistsContainer.innerHTML = likedArtists.map(a => this.createArtistCardHTML(a)).join('');
            likedArtists.forEach(artist => {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    this.updateLikeState(el, 'artist', artist.id);
                }
            });
        } else {
            artistsContainer.innerHTML = createPlaceholder('No liked artists yet.');
        }

        const likedPlaylists = await db.getFavorites('playlist');
        const likedMixes = await db.getFavorites('mix');
        
        let mixedContent = [];
        if (likedPlaylists.length) mixedContent.push(...likedPlaylists.map(p => ({ ...p, _type: 'playlist' })));
        if (likedMixes.length) mixedContent.push(...likedMixes.map(m => ({ ...m, _type: 'mix' })));
        
        // Sort by addedAt descending
        mixedContent.sort((a, b) => b.addedAt - a.addedAt);

        if (mixedContent.length) {
            playlistsContainer.innerHTML = mixedContent.map(item => {
                return item._type === 'playlist' 
                    ? this.createPlaylistCardHTML(item) 
                    : this.createMixCardHTML(item);
            }).join('');

            likedPlaylists.forEach(playlist => {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            });
            
            likedMixes.forEach(mix => {
                const el = playlistsContainer.querySelector(`[data-mix-id="${mix.id}"]`);
                if (el) {
                    trackDataStore.set(el, mix);
                    this.updateLikeState(el, 'mix', mix.id);
                }
            });
        } else {
            playlistsContainer.innerHTML = createPlaceholder('No liked playlists or mixes yet.');
        }

        const myPlaylistsContainer = document.getElementById('my-playlists-container');
        const myPlaylists = await db.getPlaylists();
        if (myPlaylists.length) {
            myPlaylistsContainer.innerHTML = myPlaylists.map(p => this.createUserPlaylistCardHTML(p)).join('');
            myPlaylists.forEach(playlist => {
                const el = myPlaylistsContainer.querySelector(`[data-playlist-id="${playlist.id}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                }
            });
        } else {
            myPlaylistsContainer.innerHTML = createPlaceholder('No playlists yet. Create your first playlist!');
        }
    }

    async renderHomePage() {
        this.showPage('home');
        const recents = recentActivityManager.getRecents();

        const albumsContainer = document.getElementById('home-recent-albums');
        const artistsContainer = document.getElementById('home-recent-artists');
        const playlistsContainer = document.getElementById('home-recent-playlists');

        if (recents.albums.length) {
            albumsContainer.innerHTML = recents.albums.map(album => this.createAlbumCardHTML(album)).join('');
            recents.albums.forEach(album => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });
        } else {
            albumsContainer.innerHTML = createPlaceholder("You haven't viewed any albums yet.");
        }

        if (recents.artists.length) {
            artistsContainer.innerHTML = recents.artists.map(artist => this.createArtistCardHTML(artist)).join('');
            recents.artists.forEach(artist => {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    this.updateLikeState(el, 'artist', artist.id);
                }
            });
        } else {
            artistsContainer.innerHTML = createPlaceholder("You haven't viewed any artists yet.");
        }

        if (playlistsContainer) {
            const playlists = recents.playlists || [];
            const mixes = recents.mixes || [];
            
            // Note: Since we don't have a unified timestamp for recents in the separate arrays without normalizing,
            // we will just display playlists then mixes, or interleave them if we wanted to be fancy.
            // But usually recents are just lists.
            // Let's just concatenate them.
            
            const combinedRecents = [...playlists, ...mixes]; // Order: Playlists then Mixes

            if (combinedRecents.length) {
                playlistsContainer.innerHTML = combinedRecents.map(item => {
                    if (item.isUserPlaylist) {
                        return this.createUserPlaylistCardHTML(item);
                    }
                    if (item.mixType) { // It's a mix
                         return this.createMixCardHTML(item);
                    }
                    return this.createPlaylistCardHTML(item);
                }).join('');
                
                combinedRecents.forEach(item => {
                    if (item.isUserPlaylist) {
                        const el = playlistsContainer.querySelector(`[data-playlist-id="${item.id}"]`);
                        if (el) trackDataStore.set(el, item);
                    } else if (item.mixType) {
                        const el = playlistsContainer.querySelector(`[data-mix-id="${item.id}"]`);
                        if (el) {
                            trackDataStore.set(el, item);
                            this.updateLikeState(el, 'mix', item.id);
                        }
                    } else {
                        const el = playlistsContainer.querySelector(`[data-playlist-id="${item.uuid}"]`);
                        if (el) {
                            trackDataStore.set(el, item);
                            this.updateLikeState(el, 'playlist', item.uuid);
                        }
                    }
                });
            } else {
                playlistsContainer.innerHTML = createPlaceholder("You haven't viewed any playlists or mixes yet.");
            }
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

            finalArtists.forEach(artist => {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    this.updateLikeState(el, 'artist', artist.id);
                }
            });

            albumsContainer.innerHTML = finalAlbums.length
                ? finalAlbums.map(album => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            finalAlbums.forEach(album => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });

            playlistsContainer.innerHTML = finalPlaylists.length
                ? finalPlaylists.map(playlist => this.createPlaylistCardHTML(playlist)).join('')
                : createPlaceholder('No playlists found.');

            finalPlaylists.forEach(playlist => {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            });

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
        const mixBtn = document.getElementById('album-mix-btn');
        if (mixBtn) mixBtn.style.display = 'none';

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

            const coverUrl = this.api.getCoverUrl(album.cover);
            imageEl.src = coverUrl;
            imageEl.style.backgroundColor = '';

            // Set background and vibrant color
            this.setPageBackground(coverUrl);
            if (backgroundSettings.isEnabled() && album.cover) {
                this.extractAndApplyColor(this.api.getCoverUrl(album.cover, '80'));
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
            
            // Update header like button
            const albumLikeBtn = document.getElementById('like-album-btn');
            if (albumLikeBtn) {
                const isLiked = await db.isFavorite('album', album.id);
                albumLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                albumLikeBtn.classList.toggle('active', isLiked);
            }

            document.title = `${album.title} - ${album.artist.name}`;

            // "More from Artist" and Related Sections
            const moreAlbumsSection = document.getElementById('album-section-more-albums');
            const moreAlbumsContainer = document.getElementById('album-detail-more-albums');
            const moreAlbumsTitle = document.getElementById('album-title-more-albums');
            
            const epsSection = document.getElementById('album-section-eps');
            const epsContainer = document.getElementById('album-detail-eps');
            const epsTitle = document.getElementById('album-title-eps');
            
            const similarArtistsSection = document.getElementById('album-section-similar-artists');
            const similarArtistsContainer = document.getElementById('album-detail-similar-artists');
            
            const similarAlbumsSection = document.getElementById('album-section-similar-albums');
            const similarAlbumsContainer = document.getElementById('album-detail-similar-albums');

            // Hide all initially
            [moreAlbumsSection, epsSection, similarArtistsSection, similarAlbumsSection].forEach(el => {
                if (el) el.style.display = 'none';
            });

            try {
                const artistData = await this.api.getArtist(album.artist.id);
                
                // Add Mix/Radio Button to header
                const mixBtn = document.getElementById('album-mix-btn');
                if (mixBtn && artistData.mixes && artistData.mixes.ARTIST_MIX) {
                    mixBtn.style.display = 'flex';
                    mixBtn.onclick = () => window.location.hash = `#mix/${artistData.mixes.ARTIST_MIX}`;
                }

                const renderSection = (items, container, section, titleEl, titleText) => {
                    if (!container || !section) return;
                    
                    const filtered = (items || [])
                        .filter(a => a.id != album.id)
                        .filter((a, index, self) => 
                            index === self.findIndex((t) => t.title === a.title) // Dedup by title
                        )
                        .slice(0, 12);
                    
                    if (filtered.length === 0) return;

                    container.innerHTML = filtered.map(a => this.createAlbumCardHTML(a)).join('');
                    if (titleEl && titleText) titleEl.textContent = titleText;
                    section.style.display = 'block';

                    filtered.forEach(a => {
                        const el = container.querySelector(`[data-album-id="${a.id}"]`);
                        if (el) {
                            trackDataStore.set(el, a);
                            this.updateLikeState(el, 'album', a.id);
                        }
                    });
                };

                renderSection(artistData.albums, moreAlbumsContainer, moreAlbumsSection, moreAlbumsTitle, `More albums from ${album.artist.name}`);
                renderSection(artistData.eps, epsContainer, epsSection, epsTitle, `EPs and Singles from ${album.artist.name}`);

                // Similar Artists
                this.api.getSimilarArtists(album.artist.id).then(similar => {
                    if (similar && similar.length > 0 && similarArtistsContainer && similarArtistsSection) {
                        similarArtistsContainer.innerHTML = similar.map(a => this.createArtistCardHTML(a)).join('');
                        similarArtistsSection.style.display = 'block';
                    }
                }).catch(e => console.warn('Failed to load similar artists:', e));

                // Similar Albums
                this.api.getSimilarAlbums(albumId).then(similar => {
                    if (similar && similar.length > 0 && similarAlbumsContainer && similarAlbumsSection) {
                        similarAlbumsContainer.innerHTML = similar.map(a => this.createAlbumCardHTML(a)).join('');
                        similarAlbumsSection.style.display = 'block';
                        
                        similar.forEach(a => {
                            const el = similarAlbumsContainer.querySelector(`[data-album-id="${a.id}"]`);
                            if (el) {
                                trackDataStore.set(el, a);
                                this.updateLikeState(el, 'album', a.id);
                            }
                        });
                    }
                }).catch(e => console.warn('Failed to load similar albums:', e));

            } catch (err) {
                console.warn('Failed to load "More from artist":', err);
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
            // Check if it's a user playlist
            const userPlaylist = await db.getPlaylist(playlistId);
            if (userPlaylist) {
                // Render user playlist
                imageEl.src = userPlaylist.cover || 'assets/appicon.png';
                imageEl.style.backgroundColor = '';

                titleEl.textContent = userPlaylist.name;
                this.adjustTitleFontSize(titleEl, userPlaylist.name);

                const tracks = userPlaylist.tracks || [];
                const totalDuration = calculateTotalDuration(tracks);

                metaEl.textContent = `${tracks.length} tracks • ${formatDuration(totalDuration)}`;
                descEl.textContent = '';

                tracklistContainer.innerHTML = `
                    <div class="track-list-header">
                        <span style="width: 40px; text-align: center;">#</span>
                        <span>Title</span>
                        <span class="duration-header">Duration</span>
                    </div>
                `;

                this.renderListWithTracks(tracklistContainer, tracks, true);

                // Add remove buttons to tracks
                const trackItems = tracklistContainer.querySelectorAll('.track-item');
                trackItems.forEach((item, index) => {
                    const actionsDiv = item.querySelector('.track-item-actions');
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'track-action-btn remove-from-playlist-btn';
                    removeBtn.title = 'Remove from playlist';
                    removeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
                    removeBtn.dataset.trackIndex = index;
                    const menuBtn = actionsDiv.querySelector('.track-menu-btn');
                    actionsDiv.insertBefore(removeBtn, menuBtn);
                });

                // Update header like button - hide for user playlists
                const playlistLikeBtn = document.getElementById('like-playlist-btn');
                if (playlistLikeBtn) {
                    playlistLikeBtn.style.display = 'none';
                }

                const shuffleBtn = document.createElement('button');
                shuffleBtn.id = 'shuffle-playlist-btn';
                shuffleBtn.className = 'btn-primary';
                shuffleBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg><span>Shuffle</span>';
                shuffleBtn.onclick = () => {
                    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                    this.player.setQueue(shuffledTracks, 0);
                    this.player.playTrackFromQueue();
                };

                const actionsDiv = document.getElementById('page-playlist').querySelector('.detail-header-actions');

                const existingShuffle = actionsDiv.querySelector('#shuffle-playlist-btn');
                if (existingShuffle) existingShuffle.remove();
                const existingEdit = actionsDiv.querySelector('#edit-playlist-btn');
                if (existingEdit) existingEdit.remove();
                const existingDelete = actionsDiv.querySelector('#delete-playlist-btn');
                if (existingDelete) existingDelete.remove();

                const editBtn = document.createElement('button');
                editBtn.id = 'edit-playlist-btn';
                editBtn.className = 'btn-secondary';
                editBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span>';
                const deleteBtn = document.createElement('button');
                deleteBtn.id = 'delete-playlist-btn';
                deleteBtn.className = 'btn-secondary danger';
                deleteBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg><span>Delete</span>';
                actionsDiv.appendChild(shuffleBtn);
                actionsDiv.appendChild(editBtn);
                actionsDiv.appendChild(deleteBtn);

                const uniqueCovers = [];
                const seenCovers = new Set();
                const trackList = userPlaylist.tracks || [];
                for (const track of trackList) {
                    const cover = track.album?.cover;
                    if (cover && !seenCovers.has(cover)) {
                        seenCovers.add(cover);
                        uniqueCovers.push(cover);
                        if (uniqueCovers.length >= 4) break;
                    }
                }

                recentActivityManager.addPlaylist({ 
                    id: userPlaylist.id,
                    name: userPlaylist.name,
                    title: userPlaylist.name,
                    uuid: userPlaylist.id,
                    cover: userPlaylist.cover,
                    images: uniqueCovers,
                    numberOfTracks: userPlaylist.tracks ? userPlaylist.tracks.length : 0,
                    isUserPlaylist: true
                });
                document.title = userPlaylist.name;
            } else {
                // Render API playlist
                const { playlist, tracks } = await this.api.getPlaylist(playlistId);

                const imageId = playlist.squareImage || playlist.image;
                if (imageId) {
                    imageEl.src = this.api.getCoverUrl(imageId, '1080');
                    this.setPageBackground(imageEl.src);

                    this.extractAndApplyColor(this.api.getCoverUrl(imageId, '160'));
                } else {
                    imageEl.src = 'assets/appicon.png';
                    this.setPageBackground(null);
                    this.resetVibrantColor();
                }

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

                const shuffleBtn = document.createElement('button');
                shuffleBtn.id = 'shuffle-playlist-btn';
                shuffleBtn.className = 'btn-primary';
                shuffleBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg><span>Shuffle</span>';
                shuffleBtn.onclick = () => {
                    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                    this.player.setQueue(shuffledTracks, 0);
                    this.player.playTrackFromQueue();
                };

                const actionsDiv = document.getElementById('page-playlist').querySelector('.detail-header-actions');

                const existingShuffle = actionsDiv.querySelector('#shuffle-playlist-btn');
                if (existingShuffle) existingShuffle.remove();

                const playBtn = document.getElementById('play-playlist-btn');
                const dlBtn = document.getElementById('download-playlist-btn');
                if (playBtn && dlBtn) {
                    actionsDiv.insertBefore(shuffleBtn, dlBtn);
                }

                // Update header like button
                const playlistLikeBtn = document.getElementById('like-playlist-btn');
                if (playlistLikeBtn) {
                    const isLiked = await db.isFavorite('playlist', playlist.uuid);
                    playlistLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                    playlistLikeBtn.classList.toggle('active', isLiked);
                    playlistLikeBtn.style.display = 'flex';
                }

                // Show/hide Delete button
                const deleteBtn = document.getElementById('delete-playlist-btn');
                if (deleteBtn) {
                    deleteBtn.style.display = 'none';
                }

                recentActivityManager.addPlaylist(playlist);
                document.title = playlist.title || 'Artist Mix';
            }
        } catch (error) {
            console.error("Failed to load playlist:", error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load playlist details. ${error.message}`);
        }
    }

    async renderMixPage(mixId) {
        this.showPage('mix');

        const imageEl = document.getElementById('mix-detail-image');
        const titleEl = document.getElementById('mix-detail-title');
        const metaEl = document.getElementById('mix-detail-meta');
        const descEl = document.getElementById('mix-detail-description');
        const tracklistContainer = document.getElementById('mix-detail-tracklist');
        const playBtn = document.getElementById('play-mix-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play</span>`;
        const dlBtn = document.getElementById('download-mix-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download</span>`;

        // Skeleton loading
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
            const { mix, tracks } = await this.api.getMix(mixId);

            if (mix.cover) {
                imageEl.src = mix.cover;
                this.setPageBackground(mix.cover);
                this.extractAndApplyColor(mix.cover);
            } else {
                 // Try to get cover from first track album
                 if (tracks.length > 0 && tracks[0].album?.cover) {
                     imageEl.src = this.api.getCoverUrl(tracks[0].album.cover);
                     this.setPageBackground(imageEl.src);
                     this.extractAndApplyColor(this.api.getCoverUrl(tracks[0].album.cover, '160'));
                 } else {
                     imageEl.src = 'assets/appicon.png';
                     this.setPageBackground(null);
                     this.resetVibrantColor();
                 }
            }
            
            imageEl.style.backgroundColor = '';

            // Use title and subtitle from API directly
            const displayTitle = mix.title || 'Mix';
            titleEl.textContent = displayTitle;
            this.adjustTitleFontSize(titleEl, displayTitle);

            const totalDuration = calculateTotalDuration(tracks);
            metaEl.textContent = `${tracks.length} tracks • ${formatDuration(totalDuration)}`;
            descEl.innerHTML = `${mix.subTitle}`;

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                </div>
            `;

            this.renderListWithTracks(tracklistContainer, tracks, true);
            
            // Set play button action
            playBtn.onclick = () => {
                this.player.setQueue(tracks, 0);
                this.player.playTrackFromQueue();
            };
            
            recentActivityManager.addMix(mix);
            
             // Update header like button
            const mixLikeBtn = document.getElementById('like-mix-btn');
            if (mixLikeBtn) {
                mixLikeBtn.style.display = 'flex';
                const isLiked = await db.isFavorite('mix', mix.id);
                mixLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                mixLikeBtn.classList.toggle('active', isLiked);
            }

            document.title = displayTitle;
        } catch (error) {
            console.error("Failed to load mix:", error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load mix details. ${error.message}`);
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
        const similarContainer = document.getElementById('artist-detail-similar');
        const similarSection = document.getElementById('artist-section-similar');
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
        if (similarContainer) similarContainer.innerHTML = this.createSkeletonCards(6, true);
        if (similarSection) similarSection.style.display = 'block';

        try {
            const artist = await this.api.getArtist(artistId);

            // Handle Artist Mix Button
            const mixBtn = document.getElementById('artist-mix-btn');
            if (mixBtn) {
                if (artist.mixes && artist.mixes.ARTIST_MIX) {
                    mixBtn.style.display = 'flex';
                    mixBtn.onclick = () => window.location.hash = `#mix/${artist.mixes.ARTIST_MIX}`;
                } else {
                    mixBtn.style.display = 'none';
                }
            }

            // Similar Artists
            if (similarContainer && similarSection) {
                this.api.getSimilarArtists(artistId).then(similar => {
                    if (similar && similar.length > 0) {
                        similarContainer.innerHTML = similar.map(a => this.createArtistCardHTML(a)).join('');
                        similarSection.style.display = 'block';
                    } else {
                        similarSection.style.display = 'none';
                    }
                }).catch(() => {
                    similarSection.style.display = 'none';
                });
            }

            imageEl.src = this.api.getArtistPictureUrl(artist.picture);
            imageEl.style.backgroundColor = '';
            nameEl.textContent = artist.name;

            // Set background
            this.setPageBackground(imageEl.src);

            // Extract vibrant color using robust image extraction (160x160 for speed/accuracy balance)
            const artistPic160 = this.api.getArtistPictureUrl(artist.picture, '160');
            this.extractAndApplyColor(artistPic160);

            this.adjustTitleFontSize(nameEl, artist.name);

            metaEl.innerHTML = `
                <span>${artist.popularity}% popularity</span>
                <div class="artist-tags">
                    ${(artist.artistRoles || [])
                        .filter(role => role.category)
                        .map(role => `<span class="artist-tag">${role.category}</span>`)
                        .join('')}
                </div>
            `;

            this.renderListWithTracks(tracksContainer, artist.tracks, true);
            
            // Update header like button
            const artistLikeBtn = document.getElementById('like-artist-btn');
            if (artistLikeBtn) {
                const isLiked = await db.isFavorite('artist', artist.id);
                artistLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                artistLikeBtn.classList.toggle('active', isLiked);
            }

            albumsContainer.innerHTML = artist.albums.map(album =>
                this.createAlbumCardHTML(album)
            ).join('');
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

            artist.albums.forEach(album => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });

            recentActivityManager.addArtist(artist);

            document.title = artist.name;
        } catch (error) {
            console.error("Failed to load artist:", error);
            tracksContainer.innerHTML = albumsContainer.innerHTML =
                createPlaceholder(`Could not load artist details. ${error.message}`);
        }
    }

    async renderRecentPage() {
        this.showPage('recent');
        const container = document.getElementById('recent-tracks-container');
        container.innerHTML = this.createSkeletonTracks(10, true);

        try {
            const history = await db.getHistory();
            
            if (history.length === 0) {
                container.innerHTML = createPlaceholder("You haven't played any tracks yet.");
                return;
            }

            // Group by date
            const groups = {};
            const today = new Date().setHours(0, 0, 0, 0);
            const yesterday = new Date(today - 86400000).setHours(0, 0, 0, 0);

            history.forEach(item => {
                const date = new Date(item.timestamp);
                const dayStart = new Date(date).setHours(0, 0, 0, 0);
                
                let label;
                if (dayStart === today) label = 'Today';
                else if (dayStart === yesterday) label = 'Yesterday';
                else label = date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

                if (!groups[label]) groups[label] = [];
                groups[label].push(item);
            });

            container.innerHTML = '';

            for (const [label, tracks] of Object.entries(groups)) {
                const header = document.createElement('h3');
                header.className = 'track-list-header-group';
                header.textContent = label;
                header.style.margin = '1.5rem 0 0.5rem 0';
                header.style.fontSize = '1.1rem';
                header.style.fontWeight = '600';
                header.style.color = 'var(--foreground)';
                header.style.paddingLeft = '0.5rem';
                
                container.appendChild(header);

                // Use a temporary container to render tracks and then move them
                const tempContainer = document.createElement('div');
                this.renderListWithTracks(tempContainer, tracks, true);
                
                // Move children to main container
                while (tempContainer.firstChild) {
                    container.appendChild(tempContainer.firstChild);
                }
            }

        } catch (error) {
            console.error('Failed to load history:', error);
            container.innerHTML = createPlaceholder('Failed to load history.');
        }
    }

    renderApiSettings() {
        const container = document.getElementById('api-instance-list');
        Promise.all([
            this.api.settings.getInstances('api'),
            this.api.settings.getInstances('streaming')
        ]).then(([apiInstances, streamingInstances]) => {
            const cachedData = this.api.settings.getCachedSpeedTests();
            const speeds = cachedData?.speeds || {};

            const renderGroup = (instances, type) => {
                if (!instances || instances.length === 0) return '';

                const listHtml = instances.map((url, index) => {
                    const cacheKey = type === 'streaming' ? `${url}#streaming` : url;
                    const speedInfo = speeds[cacheKey];
                    const speedText = speedInfo
                        ? (speedInfo.speed === Infinity || typeof speedInfo.speed !== 'number'
                            ? `<span style="color: var(--muted-foreground); font-size: 0.8rem;">Failed</span>`
                            : `<span style="color: var(--muted-foreground); font-size: 0.8rem;">${speedInfo.speed.toFixed(0)}ms</span>`)
                        : '';

                    return `
                        <li data-index="${index}" data-type="${type}">
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

                return `
                    <li class="group-header" style="font-weight: bold; padding: 1rem 0 0.5rem; background: transparent; border: none; pointer-events: none;">
                        ${type === 'api' ? 'API Instances' : 'Streaming Instances'}
                    </li>
                    ${listHtml}
                `;
            };

            container.innerHTML = renderGroup(apiInstances, 'api') + renderGroup(streamingInstances, 'streaming');

            const stats = this.api.getCacheStats();
            const cacheInfo = document.getElementById('cache-info');
            if (cacheInfo) {
                cacheInfo.textContent = `Cache: ${stats.memoryEntries}/${stats.maxSize} entries`;
            }
        });
    }
}
