//js/ui.js
import { showNotification } from './downloads.js';
import {
    formatTime,
    createPlaceholder,
    trackDataStore,
    hasExplicitContent,
    getTrackArtists,
    getTrackArtistsHTML,
    getTrackTitle,
    getTrackYearDisplay,
    createQualityBadgeHTML,
    calculateTotalDuration,
    formatDuration,
    escapeHtml,
    getShareUrl,
} from './utils.js';
import { openLyricsPanel, renderLyricsInFullscreen, clearFullscreenLyricsSync } from './lyrics.js';
import {
    recentActivityManager,
    backgroundSettings,
    dynamicColorSettings,
    cardSettings,
    visualizerSettings,
    homePageSettings,
    fontSettings,
    contentBlockingSettings,
    settingsUiState,
    fullscreenCoverNoRoundSettings,
} from './storage.js';
import { db } from './db.js';
import { getVibrantColorFromImage } from './vibrant-color.js';
import { syncManager } from './accounts/pocketbase.js';
import { authManager } from './accounts/auth.js';
import { partyManager } from './listening-party.js';
import { Visualizer } from './visualizer.js';
import { navigate } from './router.js';
import { sidePanelManager } from './side-panel.js';
import {
    renderUnreleasedPage as renderUnreleasedTrackerPage,
    renderTrackerArtistPage as renderTrackerArtistContent,
    renderTrackerProjectPage as renderTrackerProjectContent,
    renderTrackerTrackPage as renderTrackerTrackContent,
    findTrackerArtistByName,
    getArtistUnreleasedProjects,
    createProjectCardHTML,
    createTrackFromSong,
} from './tracker.js';
import { trackSearch, trackChangeSort } from './analytics.js';

fontSettings.applyFont().catch(console.error);
fontSettings.applyFontSize();

import {
    SVG_PLAY,
    SVG_DOWNLOAD,
    SVG_MENU,
    SVG_HEART,
    SVG_VOLUME,
    SVG_MUTE,
    SVG_EYE,
    SVG_EYE_OFF,
    SVG_HEART_FILLED,
    SVG_CLOSE,
    SVG_SORT,
    SVG_BIN,
    SVG_TRASH,
    SVG_GLOBE,
    SVG_INSTAGRAM,
    SVG_FACEBOOK,
    SVG_YOUTUBE,
    SVG_TWITTER,
    SVG_LINK,
    SVG_SOUNDCLOUD,
    SVG_APPLE,
    SVG_REPEAT,
    SVG_REPEAT_ONE,
    SVG_PLAY_LARGE,
    SVG_PAUSE_LARGE,
    SVG_MINUS,
    SVG_SQUARE_PEN,
    SVG_SHARE,
    SVG_SHUFFLE,
    SVG_VIDEO,
    SVG_LEFT_ARROW,
    SVG_RIGHT_ARROW,
    SVG_CLOCK,
    SVG_CHECKBOX,
} from './icons.js';

const setFullscreenUIToggleIcon = (button, visualizerOnlyMode) => {
    if (!button) return;
    button.innerHTML = visualizerOnlyMode ? SVG_EYE(24) : SVG_EYE_OFF(24);
};

function sortTracks(tracks, sortType) {
    if (sortType === 'custom') return [...tracks];
    const sorted = [...tracks];
    switch (sortType) {
        case 'added-newest':
            return sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        case 'added-oldest':
            return sorted.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        case 'title':
            return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        case 'artist':
            return sorted.sort((a, b) => {
                const artistA = a.artist?.name || a.artists?.[0]?.name || '';
                const artistB = b.artist?.name || b.artists?.[0]?.name || '';
                return artistA.localeCompare(artistB);
            });
        case 'album':
            return sorted.sort((a, b) => {
                const albumA = a.album?.title || '';
                const albumB = b.album?.title || '';
                const albumCompare = albumA.localeCompare(albumB);
                if (albumCompare !== 0) return albumCompare;
                const trackNumA = a.trackNumber || a.position || 0;
                const trackNumB = b.trackNumber || b.position || 0;
                return trackNumA - trackNumB;
            });
        default:
            return sorted;
    }
}

const TRACKLIST_HEADER_WITH_LIKE_COL_HTML = `
    <div class="track-list-header">
        <span style="width: 40px; text-align: center;">#</span>
        <span>Title</span>
        <span class="track-list-header-spacer" aria-hidden="true"></span>
        <span class="duration-header">Duration</span>
        <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
    </div>
`;

export class UIRenderer {
    static #instance = null;

    static get instance() {
        if (!UIRenderer.#instance) {
            throw new Error('UIRenderer is not initialized. Call UIRenderer.initialize(api, player) first.');
        }
        return UIRenderer.#instance;
    }

    /** @private */
    constructor(api, player) {
        this.api = api;
        this.player = player;
        this.currentTrack = null;
        this.searchAbortController = null;
        this.vibrantColorCache = new Map();
        this.visualizer = null;
        this.renderLock = false;
        this.lastRecommendedTracks = [];
        this.currentArtistId = null;
        this.fullscreenLyricsVisible = true;
        this.fullscreenPlaybackStateCleanup = null;

        // Listen for dynamic color reset events
        window.addEventListener('reset-dynamic-color', () => {
            this.resetVibrantColor();
        });

        // Listen for theme changes to re-apply vibrant colors
        window.addEventListener('theme-changed', async () => {
            await this.updateGlobalTheme();
        });

        window.addEventListener('visualizer-dim-change', () => {
            if (this.visualizer) {
                this.visualizer.updateDimming();
            }
        });

        window.addEventListener('fullscreen-cover-settings-changed', () => {
            const overlay = document.getElementById('fullscreen-cover-overlay');
            const coverImage = document.getElementById('fullscreen-cover-image');
            if (overlay && overlay.style.display === 'flex') {
                if (fullscreenCoverNoRoundSettings.isEnabled()) {
                    overlay.classList.add('fullscreen-cover-no-round');
                } else {
                    overlay.classList.remove('fullscreen-cover-no-round');
                }
                if (coverImage?.vanillaTilt) {
                    coverImage.vanillaTilt.destroy();
                }
            }
        });

        window.addEventListener('refresh-home-editors-picks', async () => {
            await this.renderHomeEditorsPicks(true, 'home-editors-picks');
            await this.renderHomeEditorsPicks(true, 'home-editors-picks-empty');
        });
    }

    static async initialize(api, player) {
        if (UIRenderer.#instance) {
            throw new Error('UIRenderer is already initialized');
        }
        return (UIRenderer.#instance = new UIRenderer(api, player));
    }

    // Helper for Heart Icon
    createHeartIcon(filled = false) {
        if (filled) {
            return SVG_HEART_FILLED(20);
        }
        return SVG_HEART(20);
    }

    async extractAndApplyColor(url) {
        if (!url) {
            this.resetVibrantColor();
            return;
        }

        // Check if dynamic coloring is enabled
        if (!dynamicColorSettings.isEnabled()) {
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
            } catch {
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

    async renderPinnedItems() {
        const nav = document.getElementById('pinned-items-nav');
        const list = document.getElementById('pinned-items-list');
        if (!nav || !list) return;

        const pinnedItems = await db.getPinned();

        if (pinnedItems.length === 0) {
            nav.style.display = 'none';
            return;
        }

        nav.style.display = '';
        list.innerHTML = pinnedItems
            .map((item) => {
                let iconHTML;
                if (item.type === 'user-playlist' && !item.cover && item.images && item.images.length > 0) {
                    const images = item.images.slice(0, 4);
                    const imgsHTML = images
                        .map((src) => `<img src="${this.api.getCoverUrl(src)}" loading="lazy">`)
                        .join('');
                    iconHTML = `<div class="pinned-item-collage">${imgsHTML}</div>`;
                } else {
                    const coverUrl =
                        item.type === 'artist'
                            ? this.api.getArtistPictureUrl(item.cover)
                            : this.api.getCoverUrl(item.cover);
                    const coverClass = item.type === 'artist' ? 'artist' : '';
                    iconHTML = `<img src="${coverUrl}" class="pinned-item-cover ${coverClass}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='assets/logo.svg'">`;
                }

                return `
                <li class="nav-item">
                    <a href="${item.href}">
                        ${iconHTML}
                        <span class="pinned-item-name">${escapeHtml(item.name)}</span>
                    </a>
                </li>
            `;
            })
            .join('');
    }

    async setCurrentTrack(track) {
        this.currentTrack = track;
        await this.updateGlobalTheme();

        const likeBtn = document.getElementById('now-playing-like-btn');
        const addPlaylistBtn = document.getElementById('now-playing-add-playlist-btn');
        const mobileAddPlaylistBtn = document.getElementById('mobile-add-playlist-btn');
        const lyricsBtn = document.getElementById('toggle-lyrics-btn');
        const fsLikeBtn = document.getElementById('fs-like-btn');
        const fsAddPlaylistBtn = document.getElementById('fs-add-playlist-btn');

        if (track) {
            const isLocal = track.isLocal;
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            const shouldHideLikes = isLocal || isTracker;

            if (likeBtn) {
                if (shouldHideLikes) {
                    likeBtn.style.display = 'none';
                } else {
                    likeBtn.style.display = 'flex';
                    await this.updateLikeState(likeBtn.parentElement, track.type || 'track', track.id);
                }
            }

            if (addPlaylistBtn) {
                if (isLocal) {
                    addPlaylistBtn.style.setProperty('display', 'none', 'important');
                } else {
                    addPlaylistBtn.style.removeProperty('display');
                    addPlaylistBtn.style.display = 'flex';
                }
            }
            if (mobileAddPlaylistBtn) {
                if (isLocal) {
                    mobileAddPlaylistBtn.style.setProperty('display', 'none', 'important');
                } else {
                    mobileAddPlaylistBtn.style.removeProperty('display');
                    mobileAddPlaylistBtn.style.display = 'flex';
                }
            }
            if (lyricsBtn) {
                if (isLocal) lyricsBtn.style.display = 'none';
                else lyricsBtn.style.removeProperty('display');
            }

            if (fsLikeBtn) {
                if (shouldHideLikes) {
                    fsLikeBtn.style.display = 'none';
                } else {
                    fsLikeBtn.style.display = 'flex';
                    await this.updateLikeState(fsLikeBtn.parentElement, track.type || 'track', track.id);
                }
            }
            if (fsAddPlaylistBtn) {
                if (shouldHideLikes) fsAddPlaylistBtn.style.display = 'none';
                else fsAddPlaylistBtn.style.display = 'flex';
            }
        } else {
            if (likeBtn) likeBtn.style.display = 'none';
            if (addPlaylistBtn) addPlaylistBtn.style.setProperty('display', 'none', 'important');
            if (mobileAddPlaylistBtn) mobileAddPlaylistBtn.style.setProperty('display', 'none', 'important');
            if (lyricsBtn) lyricsBtn.style.display = 'none';
            if (fsLikeBtn) fsLikeBtn.style.display = 'none';
            if (fsAddPlaylistBtn) fsAddPlaylistBtn.style.display = 'none';
        }
    }

    async updateGlobalTheme() {
        // Check if we are currently viewing an album page
        const isAlbumPage = document.getElementById('page-album').classList.contains('active');

        if (isAlbumPage) {
            // The album page render logic handles its own coloring.
            // We shouldn't override it here.
            return;
        }

        if (backgroundSettings.isEnabled() && this.currentTrack?.album?.cover) {
            await this.extractAndApplyColor(this.api.getCoverUrl(this.currentTrack.album.cover, '80'));
        } else {
            this.resetVibrantColor();
        }
    }

    createExplicitBadge() {
        return '<span class="explicit-badge" title="Explicit">E</span>';
    }

    adjustTitleFontSize(element, text) {
        element.classList.remove('long-title', 'very-long-title');
        if (!text) return;
        if (text.length > 40) {
            element.classList.add('very-long-title');
        } else if (text.length > 25) {
            element.classList.add('long-title');
        }
    }

    createTrackItemHTML(
        track,
        index,
        showCover = false,
        hasMultipleDiscs = false,
        useTrackNumber = false,
        inlineLike = false
    ) {
        const isUnavailable = track.isUnavailable;
        const isBlocked = contentBlockingSettings?.shouldHideTrack(track);
        const isVideo = track.type === 'video';

        let trackImageHTML = '';
        if (showCover) {
            if (isVideo && this.currentPage === 'playlist') {
                const videoCoverUrl = this.api.getVideoCoverUrl(track.imageId);
                if (videoCoverUrl) {
                    trackImageHTML = `<img src="${videoCoverUrl}" alt="" class="track-item-cover" loading="lazy">`;
                } else {
                    trackImageHTML = `<div class="track-item-cover video-icon-placeholder" style="display: flex; align-items: center; justify-content: center; background: var(--secondary);">${SVG_VIDEO(20, { style: 'opacity: 0.7;' })}</div>`;
                }
            } else if (isVideo && (this.currentPage === 'search' || this.currentPage === 'library')) {
                const videoCoverUrl = this.api.getVideoCoverUrl(track.imageId);
                if (videoCoverUrl) {
                    trackImageHTML = `<img src="${videoCoverUrl}" alt="" class="track-item-cover" loading="lazy">`;
                } else {
                    trackImageHTML = `<div class="track-item-cover video-icon-placeholder" style="display: flex; align-items: center; justify-content: center; background: var(--secondary);">${SVG_PLAY(16, { style: 'opacity: 0.7;' })}</div>`;
                }
            } else {
                trackImageHTML = this.getCoverHTML(
                    track.image || track.cover || track.album?.cover,
                    'Track Cover',
                    'track-item-cover',
                    'lazy'
                );
            }
        }

        let displayIndex;
        if (hasMultipleDiscs && !showCover) {
            const discNum = track.volumeNumber ?? track.discNumber ?? 1;
            displayIndex = `${discNum}-${track.trackNumber}`;
        } else if (useTrackNumber && track.trackNumber) {
            displayIndex = track.trackNumber;
        } else {
            displayIndex = index + 1;
        }

        const videoIcon = isVideo
            ? `<span class="video-item-icon" title="Music Video" style="display: inline-flex; align-items: center; margin-right: 4px; color: var(--muted-foreground);">${SVG_VIDEO(14)}</span>`
            : '';
        const trackNumberHTML = `<div class="track-number">${showCover ? trackImageHTML : displayIndex}</div>`;
        const checkboxHTML = `<div class="track-checkbox" data-action="toggle-select">${SVG_CHECKBOX(18)}</div>`;
        const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(track);
        const trackTitle = getTrackTitle(track);
        const isCurrentTrack = this.player?.currentTrack?.id === track.id;

        if (track.isLocal && (!track.album?.cover || track.album.cover === 'assets/appicon.png')) {
            showCover = false;
        }

        const yearDisplay = getTrackYearDisplay(track);

        const actionsHTML = isUnavailable
            ? ''
            : `
            <button class="track-menu-btn" type="button" title="More options" ${track.isLocal ? 'style="display:none"' : ''}>
                ${SVG_MENU(20)}
            </button>
        `;

        const blockedTitle = isBlocked
            ? `title="Blocked: ${contentBlockingSettings.isTrackBlocked(track.id) ? 'Track blocked' : contentBlockingSettings.isArtistBlocked(track.artist?.id) ? 'Artist blocked' : 'Album blocked'}"`
            : '';

        const likeType = isVideo ? 'video' : 'track';
        const showRowLike = inlineLike && !isUnavailable && !isBlocked;
        const inlineLikeHTML = showRowLike
            ? `<div class="track-item-inline-like">
                <button type="button" class="like-btn track-row-like-btn" data-action="toggle-like" data-type="${likeType}" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
            </div>`
            : '';

        const classList = [
            'track-item',
            isVideo ? 'video-track-item' : '',
            isCurrentTrack ? 'playing' : '',
            isUnavailable ? 'unavailable' : '',
            isBlocked ? 'blocked' : '',
            showRowLike ? 'track-item--inline-like' : '',
        ]
            .filter(Boolean)
            .join(' ');

        return `
            <div class="${classList}" 
                 data-track-id="${track.id}" 
                 ${isVideo ? 'data-type="video"' : 'data-type="track"'}
                 ${track.isLocal ? 'data-is-local="true"' : ''}
                 ${isUnavailable ? 'title="This track is currently unavailable"' : ''}
                 ${blockedTitle}>
                ${checkboxHTML}
                ${trackNumberHTML}
                <div class="track-item-info">
                    <div class="track-item-details">
                        <div class="title">
                            ${videoIcon}
                            ${escapeHtml(trackTitle)}
                            ${explicitBadge}
                            ${qualityBadge}
                        </div>
                        <div class="artist">${getTrackArtistsHTML(track)}${yearDisplay}</div>
                    </div>
                </div>
                ${inlineLikeHTML}
                <div class="track-item-duration">${isUnavailable || isBlocked ? '--:--' : track.duration ? formatTime(track.duration) : '--:--'}</div>
                <div class="track-item-actions">
                    ${actionsHTML}
                </div>
            </div>
        `;
    }

    getCoverHTML(
        cover,
        alt,
        className = 'card-image',
        loading = 'lazy',
        videoCoverUrl = null,
        isEditorsPick = false,
        type = 'album'
    ) {
        let size = '320';
        if (this.currentPage === 'search' || className === 'track-item-cover') {
            size = '80';
        } else if (type === 'artist') {
            size = '160';
        }

        const imageUrl =
            type === 'artist' ? this.api.getArtistPictureUrl(cover, size) : this.api.getCoverUrl(cover, size);

        if (videoCoverUrl) {
            return `<video src="${videoCoverUrl}" poster="${imageUrl}" class="${className}" alt="${alt}" preload="metadata" playsinline muted></video>`;
        }

        if (
            isEditorsPick &&
            cover &&
            typeof cover === 'string' &&
            !cover.startsWith('http') &&
            !cover.startsWith('blob:') &&
            !cover.startsWith('assets/')
        ) {
            const formattedId = String(cover).replace(/-/g, '/');
            const tidalUrl = `https://resources.tidal.com/images/${formattedId}/320x320.jpg`;
            const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(tidalUrl)}&w=250&h=250&output=webp`;
            return `<img src="${wsrvUrl}" class="${className}" alt="${alt}" loading="${loading}">`;
        }

        return `<img src="${imageUrl}" class="${className}" alt="${alt}" loading="${loading}">`;
    }

    createBaseCardHTML({
        type,
        id,
        href,
        title,
        subtitle,
        imageHTML,
        actionButtonsHTML,
        isCompact,
        extraAttributes = '',
        extraClasses = '',
    }) {
        const playBtnHTML =
            type !== 'artist'
                ? `
            <button class="play-btn card-play-btn" data-action="play-card" data-type="${type}" data-id="${id}" title="Play">
                ${SVG_PLAY(20)}
            </button>
            <button class="card-menu-btn" data-action="card-menu" data-type="${type}" data-id="${id}" title="Menu">
                ${SVG_MENU(20)}
            </button>
        `
                : '';

        const cardContent = `
            <div class="card-info">
                <h3 class="card-title">${title}</h3>
                ${subtitle ? `<p class="card-subtitle">${subtitle}</p>` : ''}
            </div>`;

        // In compact mode, move the play button outside the wrapper to position it on the right side of the card
        const buttonsInWrapper = !isCompact ? playBtnHTML : '';
        const buttonsOutside = isCompact ? playBtnHTML : '';

        return `
            <div class="card ${extraClasses} ${isCompact ? 'compact' : ''}" data-${type}-id="${id}" data-href="${href}" style="cursor: pointer;" ${extraAttributes}>
                <div class="card-image-wrapper">
                    ${imageHTML}
                    ${actionButtonsHTML}
                    ${buttonsInWrapper}
                </div>
                ${cardContent}
                ${buttonsOutside}
            </div>
        `;
    }

    createPlaylistCardHTML(playlist) {
        const imageId = playlist.squareImage || playlist.image || playlist.uuid;
        const isCompact = cardSettings.isCompactAlbum();

        return this.createBaseCardHTML({
            type: 'playlist',
            id: playlist.uuid,
            href: `/playlist/${playlist.uuid}`,
            title: playlist.title,
            subtitle: `${playlist.numberOfTracks || 0} tracks`,
            imageHTML: `<img src="${this.api.getCoverUrl(imageId)}" alt="${playlist.title}" class="card-image" loading="lazy">`,
            actionButtonsHTML: `
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="playlist" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
            `,
            isCompact,
        });
    }

    createFolderCardHTML(folder) {
        const imageSrc = folder.cover || 'assets/folder.png';
        const isCompact = cardSettings.isCompactAlbum();

        return this.createBaseCardHTML({
            type: 'folder',
            id: folder.id,
            href: `/folder/${folder.id}`,
            title: escapeHtml(folder.name),
            subtitle: `${folder.playlists ? folder.playlists.length : 0} playlists`,
            imageHTML: `<img src="${imageSrc}" alt="${escapeHtml(folder.name)}" class="card-image" loading="lazy" onerror="this.src='/assets/folder.png'">`,
            actionButtonsHTML: '',
            isCompact,
        });
    }

    createMixCardHTML(mix) {
        const imageSrc = mix.cover || '/assets/appicon.png';
        const description = mix.subTitle || mix.description || '';
        const isCompact = cardSettings.isCompactAlbum();

        return this.createBaseCardHTML({
            type: 'mix',
            id: mix.id,
            href: `/mix/${mix.id}`,
            title: mix.title,
            subtitle: description,
            imageHTML: `<img src="${imageSrc}" alt="${mix.title}" class="card-image" loading="lazy">`,
            actionButtonsHTML: `
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="mix" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
            `,
            isCompact,
        });
    }

    createUserPlaylistCardHTML(playlist, customSubtitle = null) {
        let imageHTML = '';
        if (playlist.cover) {
            imageHTML = this.getCoverHTML(
                playlist.cover,
                escapeHtml(playlist.name),
                'card-image',
                playlist._lazy === false ? 'eager' : 'lazy',
                null,
                playlist._isEditorsPick || false,
                'album'
            );
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
                        ${covers.map((cover) => `<img src="${this.api.getCoverUrl(cover)}" alt="" loading="lazy">`).join('')}
                    </div>
                `;
            } else if (uniqueCovers.length > 0) {
                imageHTML = `<img src="${this.api.getCoverUrl(uniqueCovers[0])}" alt="${playlist.name}" class="card-image" loading="lazy">`;
            } else {
                imageHTML = `<img src="/assets/appicon.png" alt="${playlist.name}" class="card-image" loading="lazy">`;
            }
        }

        const isCompact = cardSettings.isCompactAlbum();
        const subtitle =
            customSubtitle || `${playlist.tracks ? playlist.tracks.length : playlist.numberOfTracks || 0} tracks`;

        return this.createBaseCardHTML({
            type: 'user-playlist', // Note: data-type logic in base might need adjustment if it uses this for buttons.
            // Actually Base uses type for data attributes. play-card uses data-type="user-playlist" which is correct.
            id: playlist.id,
            href: `/userplaylist/${playlist.id}`,
            title: escapeHtml(playlist.name),
            subtitle,
            imageHTML: imageHTML,
            actionButtonsHTML: `
                <button class="edit-playlist-btn" data-action="edit-playlist" title="Edit Playlist">
                    ${SVG_SQUARE_PEN(20)}
                </button>
                <button class="delete-playlist-btn" data-action="delete-playlist" title="Delete Playlist">
                    ${SVG_BIN(20)}
                </button>
            `,
            isCompact,
            extraAttributes: 'draggable="true"',
            extraClasses: 'user-playlist',
        });
    }

    createAlbumCardHTML(album) {
        const explicitBadge = hasExplicitContent(album) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(album);
        const isBlocked = contentBlockingSettings?.shouldHideAlbum(album);
        let yearDisplay = '';
        if (album.releaseDate) {
            const date = new Date(album.releaseDate);
            if (!isNaN(date.getTime())) yearDisplay = `${date.getFullYear()}`;
        }

        let typeLabel = '';
        if (album.type === 'EP') typeLabel = ' • EP';
        else if (album.type === 'SINGLE') typeLabel = ' • Single';

        const isCompact = cardSettings.isCompactAlbum();
        let artistName = '';
        if (album.artist) {
            artistName = typeof album.artist === 'string' ? album.artist : album.artist.name;
        } else if (album.artists?.length) {
            artistName = album.artists.map((a) => a.name).join(', ');
        }

        return this.createBaseCardHTML({
            type: 'album',
            id: album.id,
            href: album._href || `/album/${album.id}`,
            title: `${escapeHtml(album.title)} ${explicitBadge} ${qualityBadge}`,
            subtitle: `${escapeHtml(artistName)} • ${yearDisplay}${typeLabel}`,
            imageHTML: this.getCoverHTML(
                album.cover,
                escapeHtml(album.title),
                'card-image',
                album._lazy === false ? 'eager' : 'lazy',
                album.videoCoverUrl,
                album._isEditorsPick || false,
                'album'
            ),
            actionButtonsHTML: `
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="album" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
            `,
            isCompact,
            extraClasses: isBlocked ? 'blocked' : '',
            extraAttributes: isBlocked
                ? `title="Blocked: ${contentBlockingSettings.isAlbumBlocked(album.id) ? 'Album blocked' : 'Artist blocked'}"`
                : '',
        });
    }

    createVideoCardHTML(video) {
        const duration = formatTime(video.duration);
        const artistName = getTrackArtists(video);

        const videoCoverCandidate = video.imageId || video.image || video.cover || null;
        const videoCoverUrl =
            videoCoverCandidate && (typeof videoCoverCandidate === 'string' || typeof videoCoverCandidate === 'number')
                ? this.api.getVideoCoverUrl(videoCoverCandidate)
                : null;
        const coverFallback = video.image || video.cover;
        const coverPrimitive =
            coverFallback != null && (typeof coverFallback === 'string' || typeof coverFallback === 'number')
                ? coverFallback
                : null;
        let imageHTML;

        if (videoCoverUrl) {
            imageHTML = `<img src="${videoCoverUrl}" alt="${escapeHtml(video.title)}" class="card-image" loading="lazy">`;
        } else if (coverPrimitive) {
            imageHTML = this.getCoverHTML(coverPrimitive, escapeHtml(video.title));
        } else {
            imageHTML = `<div class="card-image video-icon-placeholder" style="display: flex; align-items: center; justify-content: center; background: var(--secondary); aspect-ratio: 16/9; width: 100%;">${SVG_PLAY(48, { style: 'opacity: 0.7;' })}</div>`;
        }

        return `
            <div class="card video-card" data-video-id="${video.id}" data-type="video" draggable="true">
                <div class="card-image-container">
                    ${imageHTML}
                    <div class="card-overlay">
                        <button class="card-play-btn" title="Play video">
                            ${SVG_PLAY(24)}
                        </button>
                    </div>
                    <button class="like-btn card-like-btn" data-action="toggle-like" data-type="video" title="Add to Liked">
                        ${this.createHeartIcon(false)}
                    </button>
                    <div class="video-duration-badge" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 500;">${duration}</div>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
                    <div class="card-subtitle">${escapeHtml(artistName)}</div>
                </div>
            </div>
        `;
    }

    createArtistCardHTML(artist) {
        const isCompact = cardSettings.isCompactArtist();
        const isBlocked = contentBlockingSettings?.shouldHideArtist(artist);

        return this.createBaseCardHTML({
            type: 'artist',
            id: artist.id,
            href: `/artist/${artist.id}`,
            title: escapeHtml(artist.name),
            subtitle: '',
            imageHTML: this.getCoverHTML(
                artist.picture,
                escapeHtml(artist.name),
                'card-image',
                artist._lazy === false ? 'eager' : 'lazy',
                null,
                artist._isEditorsPick || false,
                'artist'
            ),
            actionButtonsHTML: `
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="artist" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
            `,
            isCompact,
            extraClasses: `artist${isBlocked ? ' blocked' : ''}`,
            extraAttributes: isBlocked ? 'title="Blocked: Artist blocked"' : '',
        });
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
                <div class="skeleton skeleton-track-actions"></div>
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
        return Array(count)
            .fill(0)
            .map(() => this.createSkeletonTrack(showCover))
            .join('');
    }

    createSkeletonCards(count = 6, isArtist = false) {
        return Array(count)
            .fill(0)
            .map(() => this.createSkeletonCard(isArtist))
            .join('');
    }

    setupSearchClearButton(inputElement, clearBtnSelector = '.search-clear-btn') {
        if (!inputElement) return;

        const clearBtn = inputElement.parentElement?.querySelector(clearBtnSelector);
        if (!clearBtn) return;

        // Remove old listener if exists
        const oldListener = clearBtn._clearListener;
        if (oldListener) clearBtn.removeEventListener('click', oldListener);

        const oldToggle = inputElement._searchClearToggleListener;
        if (oldToggle) inputElement.removeEventListener('input', oldToggle);

        const toggleVisibility = () => {
            clearBtn.style.display = inputElement.value.trim() ? 'flex' : 'none';
        };

        const clearListener = () => {
            inputElement.value = '';
            inputElement.dispatchEvent(new Event('input'));
            inputElement.focus();
        };

        inputElement._searchClearToggleListener = toggleVisibility;
        inputElement.addEventListener('input', toggleVisibility);
        clearBtn._clearListener = clearListener;
        clearBtn.addEventListener('click', clearListener);
    }

    setupTracklistSearch(
        searchInputId = 'track-list-search-input',
        tracklistContainerId = 'playlist-detail-tracklist'
    ) {
        const searchInput = document.getElementById(searchInputId);
        const tracklistContainer = document.getElementById(tracklistContainerId);

        if (!searchInput || !tracklistContainer) return;

        // Setup clear button
        this.setupSearchClearButton(searchInput);

        // Remove previous listener if exists
        const oldListener = searchInput._searchListener;
        if (oldListener) {
            searchInput.removeEventListener('input', oldListener);
        }

        // Create new listener
        const listener = () => {
            const query = searchInput.value.toLowerCase().trim();
            const trackItems = tracklistContainer.querySelectorAll('.track-item');

            trackItems.forEach((item) => {
                const trackData = trackDataStore.get(item);
                if (!trackData) {
                    item.style.display = '';
                    return;
                }

                const title = (trackData.title || '').toLowerCase();
                const artist = (trackData.artist?.name || trackData.artists?.[0]?.name || '').toLowerCase();
                const album = (trackData.album?.title || '').toLowerCase();

                const matches = title.includes(query) || artist.includes(query) || album.includes(query);
                item.style.display = matches ? '' : 'none';
            });
        };

        searchInput._searchListener = listener;
        searchInput.addEventListener('input', listener);
    }

    setupLibraryLikedTracksSearch(container) {
        const searchInput = document.getElementById('library-liked-tracks-search');
        if (!searchInput || !container) return;

        this.setupSearchClearButton(searchInput);

        const oldListener = searchInput._libraryLikedSearchListener;
        if (oldListener) {
            searchInput.removeEventListener('input', oldListener);
        }

        const listener = () => {
            const query = searchInput.value.toLowerCase().trim();
            const selector = container.classList.contains('card-grid') ? '.card[data-track-id]' : '.track-item';
            container.querySelectorAll(selector).forEach((item) => {
                const track = trackDataStore.get(item);
                if (!track) {
                    item.style.display = '';
                    return;
                }
                const title = (getTrackTitle(track) || '').toLowerCase();
                const artist = (track.artist?.name || track.artists?.[0]?.name || '').toLowerCase();
                const matches = !query || title.includes(query) || artist.includes(query);
                item.style.display = matches ? '' : 'none';
            });
        };

        searchInput._libraryLikedSearchListener = listener;
        searchInput.addEventListener('input', listener);
        listener();
    }

    async renderListWithTracks(
        container,
        tracks,
        showCover,
        append = false,
        useTrackNumber = false,
        inlineLike = false
    ) {
        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');

        // Check if there are multiple discs in the tracks array
        const hasMultipleDiscs = tracks.some((t) => (t.volumeNumber || t.discNumber || 1) > 1);

        tempDiv.innerHTML = tracks
            .map((track, i) =>
                this.createTrackItemHTML(track, i, showCover, hasMultipleDiscs, useTrackNumber, inlineLike)
            )
            .join('');

        // Bind data to elements immediately using index, avoiding selector ambiguity
        Array.from(tempDiv.children).forEach((element, index) => {
            const track = tracks[index];
            if (element && track) {
                trackDataStore.set(element, track);
                // Async update for like button
                this.updateLikeState(element, track.type || 'track', track.id).catch(console.error);
            }
        });

        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        if (!append) container.innerHTML = '';
        container.appendChild(fragment);
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
        const isLightMode = theme === 'white';

        let hex = color.replace('#', '');
        // Handle shorthand hex
        if (hex.length === 3) {
            hex = hex
                .split('')
                .map((char) => char + char)
                .join('');
        }

        let r = parseInt(hex.substr(0, 2), 16);
        let g = parseInt(hex.substr(2, 2), 16);
        let b = parseInt(hex.substr(4, 2), 16);

        // Calculate perceived brightness
        let brightness = (r * 299 + g * 587 + b * 114) / 1000;

        if (isLightMode) {
            // In light mode, the background is white.
            // We need the color (used for text/highlights) to be dark enough.
            // If brightness is too high (> 150), darken it.
            while (brightness > 150) {
                r = Math.floor(r * 0.9);
                g = Math.floor(g * 0.9);
                b = Math.floor(b * 0.9);
                brightness = (r * 299 + g * 587 + b * 114) / 1000;
            }
        } else {
            // In dark mode, the background is dark.
            // We need the color to be light enough.
            // If brightness is too low (< 80), lighten it.
            while (brightness < 80) {
                r = Math.min(255, Math.max(r + 1, Math.floor(r * 1.15)));
                g = Math.min(255, Math.max(g + 1, Math.floor(g * 1.15)));
                b = Math.min(255, Math.max(b + 1, Math.floor(b * 1.15)));
                brightness = (r * 299 + g * 587 + b * 114) / 1000;
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

    getFullscreenQualityBadgeHTML(track) {
        const nowPlayingTitle = document.querySelector('.now-playing-bar .title');
        if (nowPlayingTitle && this.player?.currentTrack?.id === track?.id) {
            const badges = Array.from(nowPlayingTitle.querySelectorAll('.shaka-quality-badge, .quality-badge'));
            const liveBadge = badges.find((badge) => getComputedStyle(badge).display !== 'none') || badges[0];
            if (liveBadge) {
                const badgeClone = liveBadge.cloneNode(true);
                if (badgeClone instanceof HTMLElement) {
                    badgeClone.style.removeProperty('display');
                }
                return badgeClone.outerHTML;
            }
        }

        return createQualityBadgeHTML(track);
    }

    async updateFullscreenMetadata(track, nextTrack) {
        if (!track) return;
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const image = document.getElementById('fullscreen-cover-image');
        const videoContainer = document.getElementById('fullscreen-video-container');
        const title = document.getElementById('fullscreen-track-title');
        const artist = document.getElementById('fullscreen-track-artist');
        const nextTrackEl = document.getElementById('fullscreen-next-track');

        const isRealVideo = track.type === 'video';
        const visualizerContainer = document.getElementById('visualizer-container');
        overlay.classList.toggle('is-video-mode', isRealVideo);

        const toggleUiBtn = document.getElementById('toggle-ui-btn');
        if (toggleUiBtn) {
            toggleUiBtn.style.display = isRealVideo ? 'none' : 'flex';
        }

        if (isRealVideo) {
            if (sidePanelManager.isActive('lyrics')) {
                sidePanelManager.close();
            }

            const fsLikeBtn = document.getElementById('fs-like-btn');
            if (fsLikeBtn) {
                await this.updateLikeState(fsLikeBtn.parentElement, 'video', track.id);
            }

            if (videoContainer) {
                videoContainer.style.display = 'flex';
                const videoPlayer = document.getElementById('video-player');
                if (videoPlayer && videoPlayer.parentElement !== videoContainer) {
                    videoContainer.appendChild(videoPlayer);
                    videoPlayer.style.display = 'block';
                    videoPlayer.style.width = '100%';
                    videoPlayer.style.height = '100%';
                    videoPlayer.style.objectFit = 'contain';
                }
            }
            if (image) image.style.display = 'none';
            if (visualizerContainer) visualizerContainer.style.display = 'none';
        } else {
            if (videoContainer) {
                videoContainer.style.display = 'none';
                const videoPlayer = document.getElementById('video-player');
                if (videoPlayer && videoPlayer.parentElement === videoContainer) {
                    document.body.appendChild(videoPlayer);
                    videoPlayer.style.display = 'none';
                }
            }
            if (image) image.style.display = 'block';
            if (visualizerContainer) visualizerContainer.style.display = 'block';

            const qualityBtn = document.getElementById('fs-quality-btn');
            const qualityMenu = document.getElementById('fs-quality-menu');
            if (qualityBtn) qualityBtn.style.display = 'none';
            if (qualityMenu) qualityMenu.style.display = 'none';

            const videoCoverUrl = track.videoUrl || track.videoCoverUrl || track.album?.videoCoverUrl || null;
            const coverUrl = videoCoverUrl || this.api.getCoverUrl(track.album?.cover, '1280');

            const fsLikeBtn = document.getElementById('fs-like-btn');
            if (fsLikeBtn) {
                await this.updateLikeState(fsLikeBtn.parentElement, track.type || 'track', track.id);
            }

            const currentImage = document.getElementById('fullscreen-cover-image');

            if (videoCoverUrl) {
                if (currentImage.tagName === 'IMG') {
                    const video = document.createElement('video');
                    video.src = videoCoverUrl;
                    video.autoplay = true;
                    video.loop = true;
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'auto';
                    video.className = currentImage.className;
                    currentImage.replaceWith(video);
                } else if (currentImage.src !== videoCoverUrl) {
                    currentImage.src = videoCoverUrl;
                }
            } else {
                if (currentImage.tagName === 'VIDEO') {
                    const img = document.createElement('img');
                    img.src = coverUrl;
                    img.id = currentImage.id;
                    img.className = currentImage.className;
                    currentImage.replaceWith(img);
                } else if (currentImage.src !== coverUrl) {
                    currentImage.src = coverUrl;
                }
            }
            overlay.style.setProperty('--bg-image', `url('${this.api.getCoverUrl(track.album?.cover, '1280')}')`);
            await this.extractAndApplyColor(this.api.getCoverUrl(track.album?.cover, '80'));
        }

        const qualityBadge = this.getFullscreenQualityBadgeHTML(track);
        title.innerHTML = `${escapeHtml(track.title)} ${qualityBadge}`;
        artist.textContent = getTrackArtists(track);

        if (nextTrack) {
            nextTrackEl.style.display = 'flex';
            nextTrackEl.querySelector('.value').textContent = `${nextTrack.title} • ${getTrackArtists(nextTrack)}`;
        } else {
            nextTrackEl.style.display = 'none';
        }
    }

    async showFullscreenCover(track, nextTrack, lyricsManager, activeElement) {
        if (!track) return;
        this.fullscreenVisualizerSuppressed = true;
        if (window.location.hash !== '#fullscreen') {
            window.history.pushState({ fullscreen: true }, '', '#fullscreen');
        }
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const nextTrackEl = document.getElementById('fullscreen-next-track');
        const lyricsPane = document.getElementById('fullscreen-lyrics-pane');
        const lyricsContent = document.getElementById('fullscreen-lyrics-content');
        const lyricsToggleBtn = document.getElementById('toggle-fullscreen-lyrics-btn');

        await this.updateFullscreenMetadata(track, nextTrack);

        if (nextTrack) {
            nextTrackEl.classList.remove('animate-in');
            void nextTrackEl.offsetWidth;
            nextTrackEl.classList.add('animate-in');
        } else {
            nextTrackEl.classList.remove('animate-in');
        }

        const canRenderLyrics = Boolean(lyricsManager && activeElement && lyricsPane && lyricsContent && track.type !== 'video');
        if (canRenderLyrics) {
            lyricsToggleBtn.style.display = 'none';
            overlay.classList.remove('lyrics-unavailable');
            clearFullscreenLyricsSync(lyricsContent);
            await renderLyricsInFullscreen(track, activeElement, lyricsManager, lyricsContent);
        } else {
            lyricsToggleBtn.style.display = 'none';
            overlay.classList.add('lyrics-unavailable');
            if (lyricsContent) {
                clearFullscreenLyricsSync(lyricsContent);
                lyricsContent.innerHTML = '<div class="fullscreen-lyrics-empty">Lyrics are not available for this track.</div>';
            }
        }

        const playerBar = document.querySelector('.now-playing-bar');
        if (playerBar) playerBar.style.display = 'none';
        if (sidePanelManager.isActive('lyrics') || sidePanelManager.isActive('queue')) {
            sidePanelManager.close();
        }
        const mainContent = document.querySelector('.main-content');
        if (mainContent instanceof HTMLElement) {
            this.fullscreenMainContentOverflow = mainContent.style.overflowY;
            mainContent.style.overflowY = 'hidden';
        }

        this.setupFullscreenControls();
        overlay.style.display = 'flex';

        if (fullscreenCoverNoRoundSettings.isEnabled()) {
            overlay.classList.add('fullscreen-cover-no-round');
        } else {
            overlay.classList.remove('fullscreen-cover-no-round');
        }

        const coverImage = document.getElementById('fullscreen-cover-image');
        if (coverImage?.vanillaTilt) {
            coverImage.vanillaTilt.destroy();
        }

        // Setup UI toggle button
        this.setupUIToggleButton(overlay);
        this.setupControlsAutoHide(overlay);
        await this.refreshFullscreenVisualizerState(activeElement);
    }

    closeFullscreenCover() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const coverImage = document.getElementById('fullscreen-cover-image');
        const lyricsContent = document.getElementById('fullscreen-lyrics-content');
        if (coverImage && coverImage.vanillaTilt) {
            coverImage.vanillaTilt.destroy();
        }
        if (lyricsContent) {
            clearFullscreenLyricsSync(lyricsContent);
            lyricsContent.innerHTML = '<div class="fullscreen-lyrics-empty">Lyrics appear here.</div>';
        }
        overlay.style.display = 'none';
        overlay.classList.remove('visualizer-active', 'ui-hidden', 'fullscreen-cover-no-round', 'fullscreen-paused');

        const playerBar = document.querySelector('.now-playing-bar');
        if (playerBar) playerBar.style.removeProperty('display');
        const mainContent = document.querySelector('.main-content');
        if (mainContent instanceof HTMLElement) {
            if (typeof this.fullscreenMainContentOverflow === 'string' && this.fullscreenMainContentOverflow.length > 0) {
                mainContent.style.overflowY = this.fullscreenMainContentOverflow;
            } else {
                mainContent.style.removeProperty('overflow-y');
            }
            this.fullscreenMainContentOverflow = null;
        }

        if (this.player?.currentTrack?.type === 'video') {
            const coverContainer = document.querySelector('.now-playing-bar .track-info');
            const videoPlayer = document.getElementById('video-player');
            const imgCover = coverContainer?.querySelector('.cover:not(#audio-player):not(#video-player)');

            if (videoPlayer && coverContainer) {
                if (imgCover) imgCover.style.display = 'none';

                videoPlayer.style.display = 'block';
                videoPlayer.classList.add('cover', 'video-cover-mirror');
                videoPlayer.style.width = '56px';
                videoPlayer.style.height = '56px';
                videoPlayer.style.borderRadius = 'var(--radius-sm)';
                videoPlayer.style.objectFit = 'cover';
                videoPlayer.style.gridArea = 'none';

                if (videoPlayer.parentElement !== coverContainer) {
                    coverContainer.insertBefore(videoPlayer, coverContainer.firstChild);
                }
            }
        }

        if (this.fullscreenUpdateInterval) {
            cancelAnimationFrame(this.fullscreenUpdateInterval);
            this.fullscreenUpdateInterval = null;
        }

        if (this.visualizer) {
            this.visualizer.stop();
        }
        this.fullscreenVisualizerSuppressed = false;

        // Clear UI toggle button timers
        if (this.uiToggleMouseTimer) {
            clearTimeout(this.uiToggleMouseTimer);
            this.uiToggleMouseTimer = null;
        }
    }

    async startFullscreenVisualizer(activeElement, overlay) {
        if (!activeElement) return;

        if (!this.visualizer) {
            const canvas = document.getElementById('visualizer-canvas');
            if (canvas) {
                this.visualizer = new Visualizer(canvas, activeElement);
                await this.visualizer.initPresets();
            }
        }

        if (this.visualizer) {
            await this.visualizer.start();
            overlay.classList.add('visualizer-active');
        }
    }

    async ensureVisualizerPermission(activeElement, overlay, { closeOnCancel = false } = {}) {
        if (localStorage.getItem('epilepsy-warning-dismissed') === 'true') {
            await this.startFullscreenVisualizer(activeElement, overlay);
            return true;
        }

        const modal = document.getElementById('epilepsy-warning-modal');
        if (!modal) {
            await this.startFullscreenVisualizer(activeElement, overlay);
            return true;
        }

        return await new Promise((resolve) => {
            modal.classList.add('active');

            const acceptBtn = document.getElementById('epilepsy-accept-btn');
            const cancelBtn = document.getElementById('epilepsy-cancel-btn');

            acceptBtn.onclick = async () => {
                modal.classList.remove('active');
                localStorage.setItem('epilepsy-warning-dismissed', 'true');
                await this.startFullscreenVisualizer(activeElement, overlay);
                resolve(true);
            };

            cancelBtn.onclick = () => {
                modal.classList.remove('active');
                if (closeOnCancel) {
                    this.closeFullscreenCover();
                }
                resolve(false);
            };
        });
    }

    async refreshFullscreenVisualizerState(activeElement, { closeOnCancel = false } = {}) {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const visualizerBtn = document.getElementById('fs-visualizer-btn');
        const toggleBtn = document.getElementById('toggle-ui-btn');
        const isVideoTrack = this.player?.currentTrack?.type === 'video';
        const enabled = visualizerSettings.isEnabled() && !isVideoTrack && !this.fullscreenVisualizerSuppressed;

        if (!overlay) return;

        if (visualizerBtn) {
            visualizerBtn.style.display = isVideoTrack ? 'none' : 'flex';
            visualizerBtn.classList.toggle('active', enabled);
            visualizerBtn.title = enabled ? 'Disable Visualizer' : 'Use Visualizer';
        }

        if (!enabled) {
            overlay.classList.remove('visualizer-active');
            overlay.classList.remove('ui-hidden');
            if (this.visualizer) {
                this.visualizer.stop();
            }
            if (toggleBtn) {
                toggleBtn.classList.remove('active', 'visible');
                toggleBtn.title = 'Hide UI';
                setFullscreenUIToggleIcon(toggleBtn, false);
            }
            return;
        }

        const allowed = await this.ensureVisualizerPermission(activeElement, overlay, { closeOnCancel });
        if (!allowed) {
            this.fullscreenVisualizerSuppressed = true;
            overlay.classList.remove('visualizer-active');
            if (this.visualizer) {
                this.visualizer.stop();
            }
            if (visualizerBtn) {
                visualizerBtn.classList.remove('active');
                visualizerBtn.title = 'Use Visualizer';
            }
        }
    }

    setupUIToggleButton(overlay) {
        const toggleBtn = document.getElementById('toggle-ui-btn');
        if (!toggleBtn) return;

        const updateToggleButtonIcon = () => {
            const visualizerOnlyMode =
                overlay.classList.contains('ui-hidden') && overlay.classList.contains('visualizer-active');
            setFullscreenUIToggleIcon(toggleBtn, visualizerOnlyMode);
        };

        let isUIHidden = overlay.classList.contains('ui-hidden');
        toggleBtn.classList.toggle('active', isUIHidden);
        toggleBtn.title = isUIHidden ? 'Show UI' : 'Hide UI';
        updateToggleButtonIcon();

        // Show button
        const showButton = () => {
            toggleBtn.classList.add('visible');
        };

        // Hide button
        const hideButton = () => {
            toggleBtn.classList.remove('visible');
        };

        // Initial state: hide button if UI is hidden
        if (isUIHidden) {
            hideButton();
        } else {
            showButton();
        }

        const toggleUI = async (e) => {
            if (e) e.stopPropagation();
            if (!overlay.classList.contains('visualizer-active')) {
                const isVideoTrack = this.player?.currentTrack?.type === 'video';
                if (isVideoTrack) {
                    overlay.classList.remove('ui-hidden');
                    isUIHidden = false;
                    toggleBtn.classList.remove('active');
                    toggleBtn.title = 'Hide UI';
                    updateToggleButtonIcon();
                    showButton();
                    return;
                }

                this.fullscreenVisualizerSuppressed = false;
                visualizerSettings.setEnabled(true);
                await this.refreshFullscreenVisualizerState(this.player?.activeElement);

                if (!overlay.classList.contains('visualizer-active')) {
                    overlay.classList.remove('ui-hidden');
                    isUIHidden = false;
                    toggleBtn.classList.remove('active');
                    toggleBtn.title = 'Hide UI';
                    updateToggleButtonIcon();
                    showButton();
                    return;
                }
            }
            isUIHidden = !isUIHidden;
            overlay.classList.toggle('ui-hidden', isUIHidden);
            toggleBtn.classList.toggle('active', isUIHidden);
            toggleBtn.title = isUIHidden ? 'Show UI' : 'Hide UI';
            updateToggleButtonIcon();

            if (isUIHidden) {
                hideButton();
            } else {
                showButton();
            }
        };

        // Mouse move handler
        const handleMouseMove = (e) => {
            const rect = overlay.getBoundingClientRect();
            const isNearTopRight = e.clientY < 100 && e.clientX > rect.width - 150;

            if (isUIHidden) {
                if (overlay.classList.contains('is-video-mode')) {
                    if (isNearTopRight) {
                        showButton();
                    } else {
                        hideButton();
                    }
                } else if (isNearTopRight) {
                    showButton();
                } else {
                    hideButton();
                }
            }
        };

        // Add event listeners
        toggleBtn.addEventListener('click', toggleUI);
        overlay.addEventListener('mousemove', handleMouseMove);
        overlay.addEventListener('mouseleave', () => {
            if (isUIHidden) {
                hideButton();
            }
        });

        // Store cleanup function
        this.uiToggleCleanup = () => {
            toggleBtn.removeEventListener('click', toggleUI);
            overlay.removeEventListener('mousemove', handleMouseMove);
        };
    }

    setupControlsAutoHide(overlay) {
        if (this.controlsIdleCleanup) this.controlsIdleCleanup();
        overlay.classList.remove('controls-idle');

        this.controlsIdleCleanup = () => {
            overlay.classList.remove('controls-idle');
        };
    }
    setupFullscreenControls() {
        const playBtn = document.getElementById('fs-play-pause-btn');
        const prevBtn = document.getElementById('fs-prev-btn');
        const nextBtn = document.getElementById('fs-next-btn');
        const shuffleBtn = document.getElementById('fs-shuffle-btn');
        const repeatBtn = document.getElementById('fs-repeat-btn');
        const visualizerBtn = document.getElementById('fs-visualizer-btn');
        const progressBar = document.getElementById('fs-progress-bar');
        const progressFill = document.getElementById('fs-progress-fill');
        const currentTimeEl = document.getElementById('fs-current-time');
        const totalDurationEl = document.getElementById('fs-total-duration');
        const fsLikeBtn = document.getElementById('fs-like-btn');
        const fsAddPlaylistBtn = document.getElementById('fs-add-playlist-btn');
        const fsDownloadBtn = document.getElementById('fs-download-btn');
        const fsCastBtn = document.getElementById('fs-cast-btn');
        const fsQueueBtn = document.getElementById('fs-queue-btn');
        const artistEl = document.getElementById('fullscreen-track-artist');

        if (artistEl) {
            artistEl.style.cursor = 'pointer';
            artistEl.onclick = () => {
                if (this.player.currentTrack && this.player.currentTrack.artist) {
                    this.closeFullscreenCover();
                    navigate(`/artist/${this.player.currentTrack.artist.id}`);
                }
            };
        }

        let lastPausedState = null;
        const updatePlayBtn = () => {
            const activeEl = this.player.activeElement;
            const isPaused = activeEl.paused;
            if (isPaused === lastPausedState) return;
            lastPausedState = isPaused;

            if (isPaused) {
                playBtn.innerHTML = SVG_PLAY_LARGE(32);
            } else {
                playBtn.innerHTML = SVG_PAUSE_LARGE(32);
            }
        };

        updatePlayBtn();

        playBtn.onclick = () => {
            this.player.handlePlayPause();
            updatePlayBtn();
        };

        prevBtn.onclick = () => this.player.playPrev();
        nextBtn.onclick = () => this.player.playNext();

        shuffleBtn.onclick = () => {
            this.player.toggleShuffle();
            shuffleBtn.classList.toggle('active', this.player.shuffleActive);
        };

        repeatBtn.onclick = () => {
            const mode = this.player.toggleRepeat();
            repeatBtn.classList.toggle('active', mode !== 0);
            if (mode === 2) {
                repeatBtn.innerHTML = SVG_REPEAT_ONE(24);
            } else {
                repeatBtn.innerHTML = SVG_REPEAT(24);
            }
        };

        if (visualizerBtn) {
            visualizerBtn.onclick = async () => {
                if (this.fullscreenVisualizerSuppressed) {
                    this.fullscreenVisualizerSuppressed = false;
                    visualizerSettings.setEnabled(true);
                } else if (visualizerSettings.isEnabled()) {
                    visualizerSettings.setEnabled(false);
                    this.fullscreenVisualizerSuppressed = false;
                } else {
                    this.fullscreenVisualizerSuppressed = false;
                    visualizerSettings.setEnabled(true);
                }
                await this.refreshFullscreenVisualizerState(this.player.activeElement);
            };
        }

        // Progress bar with drag support
        let isFsSeeking = false;
        let wasFsPlaying = false;
        let lastFsSeekPosition = 0;

        const updateFsSeekUI = (position) => {
            const activeEl = this.player.activeElement;
            if (!isNaN(activeEl.duration)) {
                progressFill.style.width = `${position * 100}%`;
                if (currentTimeEl) {
                    currentTimeEl.textContent = formatTime(position * activeEl.duration);
                }
            }
        };

        progressBar.addEventListener('mousedown', (e) => {
            const activeEl = this.player.activeElement;
            isFsSeeking = true;
            wasFsPlaying = !activeEl.paused;
            if (wasFsPlaying) activeEl.pause();

            const rect = progressBar.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            lastFsSeekPosition = pos;
            updateFsSeekUI(pos);
        });

        progressBar.addEventListener(
            'touchstart',
            (e) => {
                const activeEl = this.player.activeElement;
                e.preventDefault();
                isFsSeeking = true;
                wasFsPlaying = !activeEl.paused;
                if (wasFsPlaying) activeEl.pause();

                const touch = e.touches[0];
                const rect = progressBar.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                lastFsSeekPosition = pos;
                updateFsSeekUI(pos);
            },
            { passive: false }
        );

        document.addEventListener('mousemove', (e) => {
            if (isFsSeeking) {
                const rect = progressBar.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                lastFsSeekPosition = pos;
                updateFsSeekUI(pos);
            }
        });

        document.addEventListener(
            'touchmove',
            (e) => {
                if (isFsSeeking) {
                    const touch = e.touches[0];
                    const rect = progressBar.getBoundingClientRect();
                    const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                    lastFsSeekPosition = pos;
                    updateFsSeekUI(pos);
                }
            },
            { passive: false }
        );

        document.addEventListener('mouseup', () => {
            if (isFsSeeking) {
                const activeEl = this.player.activeElement;
                if (!isNaN(activeEl.duration)) {
                    activeEl.currentTime = lastFsSeekPosition * activeEl.duration;
                    if (wasFsPlaying) activeEl.play();
                }
                isFsSeeking = false;
            }
        });

        document.addEventListener('touchend', () => {
            if (isFsSeeking) {
                const activeEl = this.player.activeElement;
                if (!isNaN(activeEl.duration)) {
                    activeEl.currentTime = lastFsSeekPosition * activeEl.duration;
                    if (wasFsPlaying) activeEl.play();
                }
                isFsSeeking = false;
            }
        });

        if (fsLikeBtn) {
            fsLikeBtn.onclick = () => document.getElementById('now-playing-like-btn')?.click();
        }
        if (fsAddPlaylistBtn) {
            fsAddPlaylistBtn.onclick = () => document.getElementById('now-playing-add-playlist-btn')?.click();
        }
        if (fsDownloadBtn) {
            fsDownloadBtn.onclick = () => document.getElementById('download-current-btn')?.click();
        }
        if (fsCastBtn) {
            fsCastBtn.onclick = () => document.getElementById('cast-btn')?.click();
        }
        if (fsQueueBtn) {
            fsQueueBtn.onclick = () => {
                document.getElementById('queue-btn')?.click();
            };
        }

        shuffleBtn.classList.toggle('active', this.player.shuffleActive);
        const mode = this.player.repeatMode;
        repeatBtn.classList.toggle('active', mode !== 0);
        if (mode === 2) {
            repeatBtn.innerHTML = SVG_REPEAT_ONE(24);
        }

        // Fullscreen volume controls
        const fsVolumeBtn = document.getElementById('fs-volume-btn');
        const fsVolumeBar = document.getElementById('fs-volume-bar');
        const fsVolumeFill = document.getElementById('fs-volume-fill');

        if (fsVolumeBtn && fsVolumeBar && fsVolumeFill) {
            const updateFsVolumeUI = () => {
                const activeEl = this.player.activeElement;
                const { muted } = activeEl;
                const volume = this.player.userVolume;
                fsVolumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE(20) : SVG_VOLUME(20);
                fsVolumeBtn.classList.toggle('muted', muted || volume === 0);
                const effectiveVolume = muted ? 0 : volume * 100;
                fsVolumeFill.style.setProperty('--fs-volume-level', `${effectiveVolume}%`);
                fsVolumeFill.style.width = `${effectiveVolume}%`;
            };

            fsVolumeBtn.onclick = () => {
                const activeEl = this.player.activeElement;
                activeEl.muted = !activeEl.muted;
                localStorage.setItem('muted', activeEl.muted);
                updateFsVolumeUI();
            };

            const handleFsVolumeWheel = (e) => {
                e.preventDefault();

                const delta = e.deltaY > 0 ? -0.05 : 0.05;
                const currentVolume = this.player.userVolume;
                const newVolume = Math.max(0, Math.min(1, currentVolume + delta));

                const activeEl = this.player.activeElement;
                if (delta > 0 && activeEl.muted) {
                    activeEl.muted = false;
                    localStorage.setItem('muted', false);
                }

                this.player.setVolume(newVolume);
                updateFsVolumeUI();
            };

            [fsVolumeBar, fsVolumeBtn].forEach((el) => {
                if (el._fsVolumeWheelHandler) {
                    el.removeEventListener('wheel', el._fsVolumeWheelHandler);
                }
                el._fsVolumeWheelHandler = handleFsVolumeWheel;
                el.addEventListener('wheel', handleFsVolumeWheel, { passive: false });
            });

            const setFsVolume = (e) => {
                const rect = fsVolumeBar.getBoundingClientRect();
                const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const newVolume = position;
                this.player.setVolume(newVolume);
                const activeEl = this.player.activeElement;
                if (activeEl.muted && newVolume > 0) {
                    activeEl.muted = false;
                    localStorage.setItem('muted', false);
                }
                updateFsVolumeUI();
            };

            let isAdjustingFsVolume = false;

            fsVolumeBar.addEventListener('mousedown', (e) => {
                isAdjustingFsVolume = true;
                setFsVolume(e);
            });

            fsVolumeBar.addEventListener(
                'touchstart',
                (e) => {
                    e.preventDefault();
                    isAdjustingFsVolume = true;
                    const touch = e.touches[0];
                    setFsVolume({ clientX: touch.clientX });
                },
                { passive: false }
            );

            document.addEventListener('mousemove', (e) => {
                if (isAdjustingFsVolume) {
                    setFsVolume(e);
                }
            });

            document.addEventListener(
                'touchmove',
                (e) => {
                    if (isAdjustingFsVolume) {
                        const touch = e.touches[0];
                        setFsVolume({ clientX: touch.clientX });
                    }
                },
                { passive: false }
            );

            document.addEventListener('mouseup', () => {
                isAdjustingFsVolume = false;
            });

            document.addEventListener('touchend', () => {
                isAdjustingFsVolume = false;
            });

            this.player.activeElement.addEventListener('volumechange', updateFsVolumeUI);
            updateFsVolumeUI();
        }

        const update = () => {
            if (document.getElementById('fullscreen-cover-overlay').style.display === 'none') return;

            const activeEl = this.player.activeElement;
            const duration = activeEl.duration || 0;
            const current = activeEl.currentTime || 0;

            if (duration > 0) {
                // Only update progress if not currently seeking (user is dragging)
                if (!isFsSeeking) {
                    const percent = (current / duration) * 100;
                    progressFill.style.width = `${percent}%`;
                    currentTimeEl.textContent = formatTime(current);
                }
                totalDurationEl.textContent = formatTime(duration);
            }

            updatePlayBtn();
            this.fullscreenUpdateInterval = requestAnimationFrame(update);
        };

        if (this.fullscreenUpdateInterval) cancelAnimationFrame(this.fullscreenUpdateInterval);
        this.fullscreenUpdateInterval = requestAnimationFrame(update);
    }

    async showPage(pageId) {
        const previousPage = this.currentPage;
        this.currentPage = pageId;
        document.querySelectorAll('.page').forEach((page) => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        document.querySelectorAll('.sidebar-nav a').forEach((link) => {
            link.classList.toggle(
                'active',
                link.pathname === `/${pageId}` || (pageId === 'home' && link.pathname === '/')
            );
        });

        const mainContent = document.querySelector('.main-content');
        if (mainContent && previousPage !== pageId) {
            mainContent.scrollTop = 0;
        }

        // Clear artist context when navigating away from artist page
        if (pageId !== 'artist') {
            this.currentArtistId = null;
            this.player.clearArtistPopularTracksContext();
        }

        // Clear background and color if not on album, artist, playlist, or mix page
        if (!['album', 'artist', 'playlist', 'mix'].includes(pageId)) {
            this.setPageBackground(null);
            await this.updateGlobalTheme();
        }

        const downloadsdisabled = true;
        if (downloadsdisabled == true) {
            if (pageId === 'download') {
                const maintenanceModal = document.getElementById('maintenance-modal');
                const maintenanceHomeBtn = document.getElementById('maintenance-home-btn');
                if (maintenanceModal) {
                    maintenanceModal.classList.add('active');
                    if (maintenanceHomeBtn) {
                        maintenanceHomeBtn.onclick = () => {
                            maintenanceModal.classList.remove('active');
                            navigate('/');
                        };
                    }
                }
            } else {
                const maintenanceModal = document.getElementById('maintenance-modal');
                if (maintenanceModal) {
                    maintenanceModal.classList.remove('active');
                }
            }
        }
        if (pageId === 'settings') {
            this.renderApiSettings();
            const savedTabName = settingsUiState.getActiveTab();
            const savedTab = document.querySelector(`.settings-tab[data-tab="${savedTabName}"]`);
            if (savedTab) {
                document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
                document.querySelectorAll('.settings-tab-content').forEach((c) => c.classList.remove('active'));
                savedTab.classList.add('active');
                document.getElementById(`settings-tab-${savedTabName}`)?.classList.add('active');
            }
        } else {
            document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach((c) => c.classList.remove('active'));
        }
    }

    async renderPartiesPage() {
        await this.showPage('parties');
        const authRequired = document.getElementById('parties-auth-required');
        const hostControls = document.getElementById('parties-host-controls');
        const loginBtn = document.getElementById('parties-login-btn');

        if (authManager.user) {
            authRequired.style.display = 'none';
            hostControls.style.display = 'block';
        } else {
            authRequired.style.display = 'block';
            hostControls.style.display = 'none';
            loginBtn.onclick = () => navigate('/account');
        }
    }

    async renderPartyDetailPage(id) {
        await this.showPage('party-detail');
        await partyManager.joinParty(id);
    }

    async renderLibraryPage() {
        await this.showPage('library');

        const tracksContainer = document.getElementById('library-tracks-container');
        const videosTabContent = document.getElementById('library-tab-videos');
        const albumsContainer = document.getElementById('library-albums-container');
        const artistsContainer = document.getElementById('library-artists-container');
        const playlistsContainer = document.getElementById('library-playlists-container');
        const localContainer = document.getElementById('library-local-container');
        const foldersContainer = document.getElementById('my-folders-container');
        const myPlaylistsContainer = document.getElementById('my-playlists-container');

        const likedTracks = await db.getFavorites('track');
        const shuffleBtn = document.getElementById('shuffle-liked-tracks-btn');
        const downloadBtn = document.getElementById('download-liked-tracks-btn');
        const likedToolbar = document.getElementById('library-liked-tracks-toolbar');
        const viewListBtn = document.getElementById('library-liked-tracks-view-list');
        const viewGridBtn = document.getElementById('library-liked-tracks-view-grid');
        const likedViewLayout = localStorage.getItem('libraryLikedTracksView') || 'list';

        if (likedTracks.length) {
            if (likedToolbar) likedToolbar.style.display = 'flex';
            if (shuffleBtn) shuffleBtn.style.display = 'flex';
            if (downloadBtn) downloadBtn.style.display = 'flex';
            if (viewListBtn) viewListBtn.classList.toggle('active', likedViewLayout === 'list');
            if (viewGridBtn) viewGridBtn.classList.toggle('active', likedViewLayout === 'grid');

            if (likedViewLayout === 'grid') {
                tracksContainer.classList.remove('track-list');
                tracksContainer.classList.add('card-grid');
                tracksContainer.innerHTML = likedTracks.map((t) => this.createTrackCardHTML(t)).join('');
                likedTracks.forEach(async (track) => {
                    const el = tracksContainer.querySelector(`[data-track-id="${track.id}"]`);
                    if (el) {
                        trackDataStore.set(el, track);
                        const lt = track.type === 'video' ? 'video' : 'track';
                        await this.updateLikeState(el, lt, track.id);
                    }
                });
            } else {
                tracksContainer.classList.remove('card-grid');
                tracksContainer.classList.add('track-list');
                await this.renderListWithTracks(tracksContainer, likedTracks, true, false, false, true);
            }
            this.setupLibraryLikedTracksSearch(tracksContainer);
        } else {
            if (likedToolbar) likedToolbar.style.display = 'none';
            if (shuffleBtn) shuffleBtn.style.display = 'none';
            if (downloadBtn) downloadBtn.style.display = 'none';
            tracksContainer.classList.remove('card-grid');
            tracksContainer.classList.add('track-list');
            tracksContainer.innerHTML = createPlaceholder('No liked tracks yet.');
        }

        const likedVideos = await db.getFavorites('video');
        if (videosTabContent) {
            const grid = videosTabContent.querySelector('.card-grid');
            if (likedVideos.length) {
                grid.innerHTML = likedVideos.map((v) => this.createVideoCardHTML(v)).join('');
                for (const video of likedVideos) {
                    const el = grid.querySelector(`[data-video-id="${video.id}"]`);
                    if (el) {
                        trackDataStore.set(el, video);
                        await this.updateLikeState(el, 'video', video.id);
                        el.addEventListener('click', (e) => {
                            if (e.target.closest('.like-btn')) {
                                e.stopPropagation();
                                return;
                            }
                            if (e.target.closest('.card-play-btn') || e.target.closest('.card-image-container')) {
                                e.stopPropagation();
                                this.player.playVideo(video);
                            }
                        });
                    }
                }
            } else {
                grid.innerHTML = createPlaceholder('No liked videos yet.');
            }
        }

        const likedAlbums = await db.getFavorites('album');
        if (likedAlbums.length) {
            albumsContainer.innerHTML = likedAlbums.map((a) => this.createAlbumCardHTML(a)).join('');
            for (const album of likedAlbums) {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    await this.updateLikeState(el, 'album', album.id);
                }
            }
        } else {
            albumsContainer.innerHTML = createPlaceholder('No liked albums yet.');
        }

        const likedArtists = await db.getFavorites('artist');
        if (likedArtists.length) {
            artistsContainer.innerHTML = likedArtists.map((a) => this.createArtistCardHTML(a)).join('');
            for (const artist of likedArtists) {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    await this.updateLikeState(el, 'artist', artist.id);
                }
            }
        } else {
            artistsContainer.innerHTML = createPlaceholder('No liked artists yet.');
        }

        const likedPlaylists = await db.getFavorites('playlist');
        const likedMixes = await db.getFavorites('mix');

        let mixedContent = [];
        if (likedPlaylists.length) mixedContent.push(...likedPlaylists.map((p) => ({ ...p, _type: 'playlist' })));
        if (likedMixes.length) mixedContent.push(...likedMixes.map((m) => ({ ...m, _type: 'mix' })));

        // Sort by addedAt descending
        mixedContent.sort((a, b) => b.addedAt - a.addedAt);

        if (mixedContent.length) {
            playlistsContainer.innerHTML = mixedContent
                .map((item) => {
                    return item._type === 'playlist' ? this.createPlaylistCardHTML(item) : this.createMixCardHTML(item);
                })
                .join('');

            for (const playlist of likedPlaylists) {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    await this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            }

            for (const mix of likedMixes) {
                const el = playlistsContainer.querySelector(`[data-mix-id="${mix.id}"]`);
                if (el) {
                    trackDataStore.set(el, mix);
                    await this.updateLikeState(el, 'mix', mix.id);
                }
            }
        } else {
            playlistsContainer.innerHTML = createPlaceholder('No liked playlists or mixes yet.');
        }

        const folders = await db.getFolders();
        if (foldersContainer) {
            foldersContainer.innerHTML = folders.map((f) => this.createFolderCardHTML(f)).join('');
            foldersContainer.style.display = folders.length ? 'grid' : 'none';
        }

        const myPlaylists = await db.getPlaylists();
        const playlistsInFolders = new Set();
        folders.forEach((folder) => {
            if (folder.playlists) {
                folder.playlists.forEach((id) => playlistsInFolders.add(id));
            }
        });

        const visiblePlaylists = myPlaylists.filter((p) => !playlistsInFolders.has(p.id));

        if (myPlaylistsContainer) {
            myPlaylistsContainer.querySelectorAll('.user-playlist').forEach((el) => el.remove());
            myPlaylistsContainer.querySelectorAll('.placeholder-text').forEach((el) => el.remove());

            if (visiblePlaylists.length) {
                myPlaylistsContainer.insertAdjacentHTML(
                    'beforeend',
                    visiblePlaylists.map((p) => this.createUserPlaylistCardHTML(p)).join('')
                );
                visiblePlaylists.forEach((playlist) => {
                    const el = myPlaylistsContainer.querySelector(`[data-user-playlist-id="${playlist.id}"]`);
                    if (el) {
                        trackDataStore.set(el, playlist);
                    }
                });
            }
        }

        // Render Local Files
        if (localContainer) {
            await this.renderLocalFiles(localContainer);
        }
    }

    async renderLocalFiles(container) {
        if (!container) return;

        const introDiv = document.getElementById('local-files-intro');
        const headerDiv = document.getElementById('local-files-header');
        const listContainer = document.getElementById('local-files-list');
        const selectBtnText = document.getElementById('select-local-folder-text');

        const handle = await db.getSetting('local_folder_handle');
        if (handle) {
            if (selectBtnText) selectBtnText.textContent = `Load "${handle.name}"`;

            if (window.localFilesCache && window.localFilesCache.length > 0) {
                if (introDiv) introDiv.style.display = 'none';
                if (headerDiv) {
                    headerDiv.style.display = 'flex';
                    headerDiv.querySelector('h3').textContent = `Local Files (${window.localFilesCache.length})`;
                }
                if (listContainer) {
                    await this.renderListWithTracks(listContainer, window.localFilesCache, true);
                }
            } else {
                if (introDiv) introDiv.style.display = 'block';
                if (headerDiv) headerDiv.style.display = 'none';
                if (listContainer) listContainer.innerHTML = '';
                // Kick off a background scan when there is a saved folder handle but
                // the cache hasn't been populated yet (e.g. first visit after a page
                // reload where the startup scan was silently denied permission).
                if (!window.localFilesScanInProgress && !window.localFilesCache) {
                    window.refreshLocalMediaFolder?.();
                }
            }
        } else {
            if (selectBtnText) selectBtnText.textContent = 'Select Music Folder';
            if (introDiv) introDiv.style.display = 'block';
            if (headerDiv) headerDiv.style.display = 'none';
            if (listContainer) listContainer.innerHTML = '';
        }
    }

    async renderHomePage() {
        if (this.renderLock) return;
        this.renderLock = true;

        try {
            await this.showPage('home');
            await this.setupHomeTabs();

            const welcomeEl = document.getElementById('home-welcome');
            const contentEl = document.getElementById('home-content');
            const editorsPicksSectionEmpty = document.getElementById('home-editors-picks-section-empty');
            const editorsPicksSection = document.getElementById('home-editors-picks-section');

            const history = await db.getHistory();
            const favorites = await db.getFavorites('track');
            const playlists = await db.getPlaylists(true);

            const hasActivity = history.length > 0 || favorites.length > 0 || playlists.length > 0;

            // Handle Editor's Picks visibility based on settings
            if (!homePageSettings.shouldShowEditorsPicks()) {
                if (editorsPicksSectionEmpty) editorsPicksSectionEmpty.style.display = 'none';
                if (editorsPicksSection) editorsPicksSection.style.display = 'none';
            } else {
                // Show empty-state section at top when no activity, hide the bottom one
                if (editorsPicksSectionEmpty) editorsPicksSectionEmpty.style.display = hasActivity ? 'none' : '';
                // Show bottom section when has activity, render it
                if (editorsPicksSection) editorsPicksSection.style.display = hasActivity ? '' : 'none';
            }

            // Render editor's picks in the visible container
            if (hasActivity) {
                await this.renderHomeEditorsPicks(false, 'home-editors-picks');
            } else {
                await this.renderHomeEditorsPicks(false, 'home-editors-picks-empty');
            }

            if (!hasActivity) {
                if (welcomeEl) welcomeEl.style.display = 'block';
                if (contentEl) contentEl.style.display = 'none';
                return;
            }

            if (welcomeEl) welcomeEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'block';

            const refreshSongsBtn = document.getElementById('refresh-songs-btn');
            const refreshAlbumsBtn = document.getElementById('refresh-albums-btn');
            const refreshArtistsBtn = document.getElementById('refresh-artists-btn');
            const clearRecentBtn = document.getElementById('clear-recent-btn');

            if (refreshSongsBtn) refreshSongsBtn.onclick = () => this.renderHomeSongs(true);
            if (refreshAlbumsBtn) refreshAlbumsBtn.onclick = () => this.renderHomeAlbums(true);
            if (refreshArtistsBtn) refreshArtistsBtn.onclick = () => this.renderHomeArtists(true);
            if (clearRecentBtn)
                clearRecentBtn.onclick = async () => {
                    if (confirm('Clear recent activity?')) {
                        recentActivityManager.clear();
                        await this.renderHomeRecent();
                    }
                };

            await this.renderHomeRecent();

            // Load dynamic sections in parallel with pre-fetched seeds
            const seeds = await this.getSeeds();
            await Promise.all([
                this.renderHomeSongs(false, seeds),
                this.renderHomeAlbums(false, seeds),
                this.renderHomeArtists(false, seeds),
            ]);
        } finally {
            this.renderLock = false;
        }
    }

    async setupHomeTabs() {
        const tabs = document.querySelectorAll('.home-tab');
        if (tabs.length === 0) return;

        if (tabs[0].dataset.initialized) return;

        for (const tab of tabs) {
            tab.dataset.initialized = 'true';
            tab.addEventListener('click', async () => {
                document.querySelectorAll('.home-tab').forEach((t) => t.classList.remove('active'));
                document.querySelectorAll('.home-view').forEach((v) => {
                    v.style.display = 'none';
                    v.classList.remove('active');
                });

                tab.classList.add('active');
                const viewId = `home-view-${tab.dataset.tab}`;
                const view = document.getElementById(viewId);
                if (view) {
                    view.style.display = 'block';
                    view.classList.add('active');
                }

                if (tab.dataset.tab === 'explore') {
                    await this.renderExplorePage();
                }
            });
        }
    }

    async renderExplorePage() {
        const container = document.getElementById('explore-grid');
        if (!container) return;

        if (container.children.length > 0) return;

        container.classList.remove('card-grid');

        container.innerHTML = `<div class="card-grid">${this.createSkeletonCards(12)}</div>`;

        try {
            const response = await fetch('https://hot.monochrome.tf/');
            if (!response.ok) throw new Error('Failed to load explore data');
            const data = await response.json();

            container.innerHTML = '';

            const GENRES = [
                { id: 'hip_hop', name: 'Hip-Hop' },
                { id: 'rnb', name: 'R&B / Soul' },
                { id: 'blues', name: 'Blues' },
                { id: 'classical', name: 'Classical' },
                { id: 'country', name: 'Country' },
                { id: 'dance_electronic', name: 'Dance & Electronic' },
                { id: 'americana', name: 'Folk / Americana' },
                { id: 'world', name: 'Global' },
                { id: 'gospel', name: 'Gospel / Christian' },
                { id: 'jazz', name: 'Jazz' },
                { id: 'kpop', name: 'K-Pop' },
                { id: 'kids', name: 'Kids' },
                { id: 'latin', name: 'Latin' },
                { id: 'metal', name: 'Metal' },
                { id: 'pop', name: 'Pop' },
                { id: 'reggae', name: 'Reggae / Dancehall' },
                { id: 'retro', name: 'Legacy' },
                { id: 'indierock', name: 'Rock / Indie' },
            ];

            if (GENRES.length > 0) {
                const genresSection = document.createElement('section');
                genresSection.className = 'content-section';
                genresSection.innerHTML = `<h2 class="section-title">Genres</h2>`;

                const genresGrid = document.createElement('div');
                genresGrid.style.display = 'flex';
                genresGrid.style.flexWrap = 'wrap';
                genresGrid.style.gap = '0.5rem';
                genresGrid.innerHTML = GENRES.map(
                    (genre) => `
                    <div class="card genre-card" data-genre-id="${genre.id}" data-genre-name="${escapeHtml(genre.name)}" style="cursor: pointer; background: var(--secondary); padding: 0.6rem 1rem; border-radius: var(--radius); border: 1px solid var(--border);">
                        <h3 style="margin: 0; font-size: 0.875rem; font-weight: 600;">${escapeHtml(genre.name)}</h3>
                    </div>
                `
                ).join('');

                genresSection.appendChild(genresGrid);
                container.appendChild(genresSection);

                for (const card of genresGrid.querySelectorAll('.genre-card')) {
                    card.addEventListener('click', async () => {
                        await this.renderGenrePage(card.dataset.genreId, card.dataset.genreName);
                    });
                }
            }

            if (data.top_albums && data.top_albums.length > 0) {
                await this.renderExploreSection(container, 'Trending Albums', data.top_albums, 'album');
            }

            if (data.top_tracks && data.top_tracks.length > 0) {
                await this.renderExploreSection(container, 'Trending Tracks', data.top_tracks, 'track');
            }

            if (data.featured_playlists && data.featured_playlists.length > 0) {
                await this.renderExploreSection(container, 'Featured Playlists', data.featured_playlists, 'playlist');
            }

            if (data.sections && data.sections.length > 0) {
                for (const section of data.sections) {
                    if (section.items && section.items.length > 0) {
                        let type = null;
                        if (section.type === 'ALBUM_LIST') type = 'album';
                        else if (section.type === 'TRACK_LIST') type = 'track';
                        else if (section.type === 'PLAYLIST_LIST') type = 'playlist';

                        if (type) {
                            await this.renderExploreSection(container, section.title, section.items, type);
                        }
                    }
                }
            }

            if (container.children.length === 0) {
                container.innerHTML = createPlaceholder('No explore content available.');
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = createPlaceholder('Failed to load explore content.');
        }
    }

    async renderExploreSection(container, title, items, type) {
        const section = document.createElement('section');
        section.className = 'content-section';
        section.innerHTML = `<h2 class="section-title">${title}</h2>`;

        if (type === 'track') {
            const list = document.createElement('div');
            list.className = 'track-list';
            await this.renderListWithTracks(list, items, true);
            section.appendChild(list);
        } else {
            const grid = document.createElement('div');
            grid.className = 'card-grid';
            grid.innerHTML = items
                .map((item) => {
                    if (type === 'album') return this.createAlbumCardHTML(item);
                    if (type === 'playlist') return this.createPlaylistCardHTML(item);
                    return '';
                })
                .join('');

            for (const item of items) {
                let selector;
                if (type === 'album') selector = `[data-album-id="${item.id}"]`;
                if (type === 'playlist') selector = `[data-playlist-id="${item.uuid}"]`;

                if (selector) {
                    const el = grid.querySelector(selector);
                    if (el) {
                        trackDataStore.set(el, item);
                        if (type === 'album') await this.updateLikeState(el, 'album', item.id);
                        if (type === 'playlist') await this.updateLikeState(el, 'playlist', item.uuid);
                    }
                }
            }
            section.appendChild(grid);
        }
        container.appendChild(section);
    }

    async renderGenrePage(genreId, genreName) {
        const container = document.getElementById('explore-grid');
        if (!container) return;

        container.classList.remove('card-grid');

        container.innerHTML = `
            <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem;">
                <button class="btn-secondary explore-back-btn" style="display: flex; align-items: center; gap: 0.5rem;">
                    ${SVG_LEFT_ARROW(20)}
                    Back
                </button>
                <h2 class="section-title" style="margin: 0;">${escapeHtml(genreName)}</h2>
            </div>
            <div class="card-grid">${this.createSkeletonCards(12)}</div>
        `;

        container.querySelector('.explore-back-btn').addEventListener('click', async () => {
            container.innerHTML = '';
            await this.renderExplorePage();
        });

        try {
            const response = await fetch(`https://hot.monochrome.tf/explore/genre/?id=${genreId}`);
            if (!response.ok) throw new Error('Failed to load genre data');
            const data = await response.json();

            const header = container.firstElementChild;
            container.innerHTML = '';
            container.appendChild(header);

            const contentContainer = document.createElement('div');
            container.appendChild(contentContainer);

            if (data.sections && data.sections.length > 0) {
                for (const section of data.sections) {
                    if (section.items && section.items.length > 0) {
                        let type = null;
                        if (section.type === 'ALBUM_LIST') type = 'album';
                        else if (section.type === 'TRACK_LIST') type = 'track';
                        else if (section.type === 'PLAYLIST_LIST') type = 'playlist';

                        if (type) {
                            await this.renderExploreSection(contentContainer, section.title, section.items, type);
                        }
                    }
                }
            }

            if (contentContainer.children.length === 0) {
                contentContainer.innerHTML = createPlaceholder('No content found for this genre.');
            }
        } catch (e) {
            console.error(e);
            const header = container.firstElementChild;
            container.innerHTML = '';
            container.appendChild(header);
            const errorDiv = document.createElement('div');
            errorDiv.innerHTML = createPlaceholder('Failed to load genre content.');
            container.appendChild(errorDiv);
        }
    }

    async getSeeds() {
        const history = await db.getHistory();
        const favorites = await db.getFavorites('track');
        const playlists = await db.getPlaylists(true);
        const playlistTracks = playlists.flatMap((p) => p.tracks || []);

        // Prioritize: Playlists > Favorites > History
        // Take random samples from each to form seeds
        const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

        const combined = [
            ...shuffle(playlistTracks).slice(0, 20),
            ...shuffle(favorites).slice(0, 20),
            ...shuffle(history).slice(0, 10),
        ];

        const seenIds = new Set();
        const seeds = combined.filter((t) => {
            if (seenIds.has(t.id)) return false;
            seenIds.add(t.id);
            return true;
        });

        return shuffle(seeds);
    }

    async renderHomeSongs(forceRefresh = false, providedSeeds = null) {
        const songsContainer = document.getElementById('home-recommended-songs');
        const section = songsContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowRecommendedSongs()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (songsContainer) {
            if (forceRefresh || songsContainer.children.length === 0) {
                songsContainer.innerHTML = this.createSkeletonTracks(10, true);
            } else if (!songsContainer.querySelector('.skeleton')) {
                return; // Already loaded
            }

            try {
                const seeds = providedSeeds || (await this.getSeeds());

                const [favorites, playlists, history] = await Promise.all([
                    db.getFavorites('track'),
                    db.getPlaylists(true),
                    db.getHistory(),
                ]);
                const knownTrackIds = new Set([
                    ...favorites.map((t) => t.id),
                    ...playlists.flatMap((p) => (p.tracks || []).map((t) => t.id)),
                    ...history.map((t) => t.id),
                ]);

                const recommendedTracks = await this.api.getRecommendedTracksForPlaylist(seeds, 20, {
                    skipCache: forceRefresh,
                    knownTrackIds: knownTrackIds,
                });

                const filteredTracks = await this.filterUserContent(recommendedTracks, 'track');
                this.lastRecommendedTracks = filteredTracks;

                if (filteredTracks.length > 0) {
                    await this.renderListWithTracks(songsContainer, filteredTracks, true, false, false, true);
                } else {
                    songsContainer.innerHTML = createPlaceholder('No song recommendations found.');
                }
            } catch (e) {
                console.error(e);
                songsContainer.innerHTML = createPlaceholder('Failed to load song recommendations.');
            }
        }
    }

    async renderHomeAlbums(forceRefresh = false, providedSeeds = null, retryCount = 0) {
        const albumsContainer = document.getElementById('home-recommended-albums');
        const section = albumsContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowRecommendedAlbums()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (albumsContainer) {
            if (forceRefresh || albumsContainer.children.length === 0) {
                albumsContainer.innerHTML = this.createSkeletonCards(5);
            } else if (!albumsContainer.querySelector('.skeleton') && !forceRefresh) {
                return;
            }

            try {
                const seeds = providedSeeds || (await this.getSeeds());
                const albumSeed = seeds.find((t) => t.album && t.album.id);
                if (albumSeed) {
                    const similarAlbums = await this.api.getSimilarAlbums(albumSeed.album.id);
                    const filteredAlbums = await this.filterUserContent(similarAlbums, 'album');

                    if (filteredAlbums.length > 0) {
                        albumsContainer.innerHTML = filteredAlbums
                            .slice(0, 12)
                            .map((a) => this.createAlbumCardHTML(a))
                            .join('');
                        for (const a of filteredAlbums.slice(0, 12)) {
                            const el = albumsContainer.querySelector(`[data-album-id="${a.id}"]`);
                            if (el) {
                                trackDataStore.set(el, a);
                                await this.updateLikeState(el, 'album', a.id);
                            }
                        }
                    } else if (retryCount < 2) {
                        await new Promise((resolve) => setTimeout(resolve, 1500));
                        return this.renderHomeAlbums(forceRefresh, null, retryCount + 1);
                    } else {
                        albumsContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 2rem 0;">${createPlaceholder('Tell us more about what you like so we can recommend albums!')}</div>`;
                    }
                } else if (retryCount < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    return this.renderHomeAlbums(forceRefresh, null, retryCount + 1);
                } else {
                    albumsContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 2rem 0;">${createPlaceholder('Tell us more about what you like so we can recommend albums!')}</div>`;
                }
            } catch (e) {
                console.error(e);
                if (retryCount < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    return this.renderHomeAlbums(forceRefresh, null, retryCount + 1);
                }
                albumsContainer.innerHTML = createPlaceholder('Failed to load album recommendations.');
            }
        }
    }

    createTrackCardHTML(track) {
        const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(track);
        const isCompact = cardSettings.isCompactAlbum();
        const likeType = track.type === 'video' ? 'video' : 'track';

        return this.createBaseCardHTML({
            type: 'track',
            id: track.id,
            href: `/track/${track.id}`,
            title: `${escapeHtml(getTrackTitle(track))} ${explicitBadge} ${qualityBadge}`,
            subtitle: escapeHtml(getTrackArtists(track)),
            imageHTML: this.getCoverHTML(
                track.album?.cover,
                escapeHtml(track.title),
                'card-image',
                'lazy',
                track.videoUrl || track.album?.videoCoverUrl
            ),
            actionButtonsHTML: `
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="${likeType}" title="Add to Liked">
                    ${this.createHeartIcon(false)}
                </button>
            `,
            isCompact,
        });
    }

    async renderHomeEditorsPicks(forceRefresh = false, containerId = 'home-editors-picks') {
        const picksContainer = document.getElementById(containerId);

        if (picksContainer) {
            if (forceRefresh) picksContainer.innerHTML = this.createSkeletonCards(6);
            else if (picksContainer.children.length > 0 && !picksContainer.querySelector('.skeleton')) return;

            try {
                const source = homePageSettings.getEditorsPicksSource();
                const picksPath = source === 'current' ? '/editors-picks.json' : `/editors-picks-old/${source}`;
                const response = await fetch(picksPath);
                if (!response.ok) throw new Error("Failed to load editor's picks");

                let items = await response.json();

                if (!Array.isArray(items) || items.length === 0) {
                    picksContainer.innerHTML = createPlaceholder("No editor's picks available.");
                    return;
                }

                // Filter out blocked content
                const { contentBlockingSettings } = await import('./storage.js');
                items = items.filter((item) => {
                    if (item.type === 'track') {
                        return !contentBlockingSettings.shouldHideTrack(item);
                    } else if (item.type === 'album') {
                        return !contentBlockingSettings.shouldHideAlbum(item);
                    } else if (item.type === 'artist') {
                        return !contentBlockingSettings.shouldHideArtist(item);
                    }
                    return true;
                });

                // Shuffle items if enabled
                if (homePageSettings.shouldShuffleEditorsPicks()) {
                    items = [...items].sort(() => Math.random() - 0.5);
                }

                // Use cached metadata or fetch details for each item
                const cardsHTML = [];
                const itemsToStore = [];

                for (const item of items) {
                    try {
                        if (item.type === 'album') {
                            // Check if we have cached metadata
                            if (item.title && item.artist) {
                                // Use cached data directly
                                const album = {
                                    id: item.id,
                                    title: item.title,
                                    artist: item.artist,
                                    releaseDate: item.releaseDate,
                                    cover: item.cover,
                                    explicit: item.explicit,
                                    audioQuality: item.audioQuality,
                                    mediaMetadata: item.mediaMetadata,
                                    type: 'ALBUM',
                                    _lazy: cardsHTML.length >= 6,
                                    _isEditorsPick: true,
                                };
                                cardsHTML.push(this.createAlbumCardHTML(album));
                                itemsToStore.push({ el: null, data: album, type: 'album' });
                            } else {
                                // Fall back to API call for legacy format
                                const result = await this.api.getAlbum(item.id);
                                if (result && result.album) {
                                    result.album._lazy = cardsHTML.length >= 6;
                                    result.album._isEditorsPick = true;
                                    cardsHTML.push(this.createAlbumCardHTML(result.album));
                                    itemsToStore.push({ el: null, data: result.album, type: 'album' });
                                }
                            }
                        } else if (item.type === 'userplaylist') {
                            if (item.id && item.title) {
                                const playlist = {
                                    id: item.id,
                                    name: item.title,
                                    cover: item.cover,
                                    numberOfTracks: item.numberOfTracks || 0,
                                };
                                cardsHTML.push(
                                    this.createAlbumCardHTML({
                                        ...playlist,
                                        title: item.title,
                                        artist: item.artist,
                                        cover: item.cover,
                                        explicit: item.explicit,
                                        releaseDate: item.releaseDate,
                                        type: 'ALBUM',
                                        _href: `/userplaylist/${item.id}`,
                                        _lazy: cardsHTML.length >= 6,
                                        _isEditorsPick: true,
                                    })
                                );
                                itemsToStore.push({ el: null, data: playlist, type: 'user-playlist' });
                            }
                        } else if (item.type === 'artist') {
                            if (item.name && item.picture) {
                                // Use cached data directly
                                const artist = {
                                    id: item.id,
                                    name: item.name,
                                    picture: item.picture,
                                    _lazy: cardsHTML.length >= 6,
                                    _isEditorsPick: true,
                                };
                                cardsHTML.push(this.createArtistCardHTML(artist));
                                itemsToStore.push({ el: null, data: artist, type: 'artist' });
                            } else {
                                // Fall back to API call
                                const artist = await this.api.getArtist(item.id);
                                if (artist) {
                                    artist._lazy = cardsHTML.length >= 6;
                                    artist._isEditorsPick = true;
                                    cardsHTML.push(this.createArtistCardHTML(artist));
                                    itemsToStore.push({ el: null, data: artist, type: 'artist' });
                                }
                            }
                        } else if (item.type === 'track') {
                            if (item.title && item.album) {
                                // Use cached data directly
                                const track = {
                                    id: item.id,
                                    title: item.title,
                                    artist: item.artist,
                                    album: item.album,
                                    explicit: item.explicit,
                                    audioQuality: item.audioQuality,
                                    mediaMetadata: item.mediaMetadata,
                                    duration: item.duration,
                                    _lazy: cardsHTML.length >= 6,
                                    _isEditorsPick: true,
                                };
                                cardsHTML.push(this.createTrackCardHTML(track));
                                itemsToStore.push({ el: null, data: track, type: 'track' });
                            } else {
                                // Fall back to API call
                                const track = await this.api.getTrackMetadata(item.id);
                                if (track) {
                                    track._lazy = cardsHTML.length >= 6;
                                    track._isEditorsPick = true;
                                    cardsHTML.push(this.createTrackCardHTML(track));
                                    itemsToStore.push({ el: null, data: track, type: 'track' });
                                }
                            }
                        } else if (item.type === 'user-playlist') {
                            if (item.id && item.name) {
                                const playlist = {
                                    id: item.id,
                                    name: item.name,
                                    cover: item.cover,
                                    tracks: item.tracks || [],
                                    numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                                    _lazy: cardsHTML.length >= 6,
                                    _isEditorsPick: true,
                                };
                                const subtitle = item.username ? `by ${item.username}` : null;
                                cardsHTML.push(this.createUserPlaylistCardHTML(playlist, subtitle));
                                itemsToStore.push({ el: null, data: playlist, type: 'user-playlist' });
                            } else {
                                const playlist = await syncManager.getPublicPlaylist(item.id);
                                if (playlist) {
                                    playlist._lazy = cardsHTML.length >= 6;
                                    playlist._isEditorsPick = true;
                                    const subtitle = item.username ? `by ${item.username}` : null;
                                    cardsHTML.push(this.createUserPlaylistCardHTML(playlist, subtitle));
                                    itemsToStore.push({ el: null, data: playlist, type: 'user-playlist' });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn(`Failed to load ${item.type} ${item.id}:`, e);
                    }
                }

                if (cardsHTML.length > 0) {
                    picksContainer.innerHTML = cardsHTML.join('');
                    for (const item of itemsToStore) {
                        const type = item.type;
                        const id = item.data.id;
                        const el = picksContainer.querySelector(`[data-${type}-id="${id}"]`);
                        if (el) {
                            trackDataStore.set(el, item.data);
                            await this.updateLikeState(el, type, id);
                        }
                    }
                } else {
                    picksContainer.innerHTML = createPlaceholder("No editor's picks available.");
                }
            } catch (e) {
                console.error("Failed to load editor's picks:", e);
                picksContainer.innerHTML = createPlaceholder("Failed to load editor's picks.");
            }
        }
    }

    async renderHomeArtists(forceRefresh = false, providedSeeds = null) {
        const artistsContainer = document.getElementById('home-recommended-artists');
        const section = artistsContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowRecommendedArtists()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (artistsContainer) {
            if (forceRefresh || artistsContainer.children.length === 0) {
                artistsContainer.innerHTML = this.createSkeletonCards(12, true);
            } else if (!artistsContainer.querySelector('.skeleton')) {
                return;
            }

            try {
                const seeds = providedSeeds || (await this.getSeeds());
                const artistSeed = seeds.find((t) => (t.artist && t.artist.id) || (t.artists && t.artists.length > 0));
                const artistId = artistSeed ? artistSeed.artist?.id || artistSeed.artists?.[0]?.id : null;

                if (artistId) {
                    const similarArtists = await this.api.getSimilarArtists(artistId);
                    const filteredArtists = await this.filterUserContent(similarArtists, 'artist');

                    if (filteredArtists.length > 0) {
                        artistsContainer.innerHTML = filteredArtists
                            .slice(0, 12)
                            .map((a) => this.createArtistCardHTML(a))
                            .join('');
                        for (const a of filteredArtists.slice(0, 12)) {
                            const el = artistsContainer.querySelector(`[data-artist-id="${a.id}"]`);
                            if (el) {
                                trackDataStore.set(el, a);
                                await this.updateLikeState(el, 'artist', a.id);
                            }
                        }
                    } else {
                        artistsContainer.innerHTML = createPlaceholder('No artist recommendations found.');
                    }
                } else {
                    artistsContainer.innerHTML = createPlaceholder(
                        'Listen to more music to get artist recommendations.'
                    );
                }
            } catch (e) {
                console.error(e);
                artistsContainer.innerHTML = createPlaceholder('Failed to load artist recommendations.');
            }
        }
    }

    async renderHomeRecent() {
        const recentContainer = document.getElementById('home-recent-mixed');
        const section = recentContainer?.closest('.content-section');

        if (!homePageSettings.shouldShowJumpBackIn()) {
            if (section) section.style.display = 'none';
            return;
        }

        if (section) section.style.display = '';

        if (recentContainer) {
            const recents = recentActivityManager.getRecents();
            const items = [];

            if (recents.albums) items.push(...recents.albums.slice(0, 4).map((i) => ({ ...i, _kind: 'album' })));
            if (recents.playlists)
                items.push(...recents.playlists.slice(0, 4).map((i) => ({ ...i, _kind: 'playlist' })));
            if (recents.mixes) items.push(...recents.mixes.slice(0, 4).map((i) => ({ ...i, _kind: 'mix' })));

            items.sort(() => Math.random() - 0.5);
            const displayItems = items.slice(0, 6);

            if (displayItems.length > 0) {
                recentContainer.innerHTML = displayItems
                    .map((item) => {
                        if (item._kind === 'album') return this.createAlbumCardHTML(item);
                        if (item._kind === 'playlist') {
                            if (item.isUserPlaylist) return this.createUserPlaylistCardHTML(item);
                            return this.createPlaylistCardHTML(item);
                        }
                        if (item._kind === 'mix') return this.createMixCardHTML(item);
                        return '';
                    })
                    .join('');

                for (const item of displayItems) {
                    let selector = '';
                    if (item._kind === 'album') selector = `[data-album-id="${item.id}"]`;
                    else if (item._kind === 'playlist')
                        selector = item.isUserPlaylist
                            ? `[data-user-playlist-id="${item.id}"]`
                            : `[data-playlist-id="${item.uuid}"]`;
                    else if (item._kind === 'mix') selector = `[data-mix-id="${item.id}"]`;

                    const el = recentContainer.querySelector(selector);
                    if (el) {
                        trackDataStore.set(el, item);
                        if (item._kind === 'album') await this.updateLikeState(el, 'album', item.id);
                        if (item._kind === 'playlist' && !item.isUserPlaylist)
                            await this.updateLikeState(el, 'playlist', item.uuid);
                        if (item._kind === 'mix') await this.updateLikeState(el, 'mix', item.id);
                    }
                }
            } else {
                recentContainer.innerHTML = createPlaceholder('No recent items yet...');
            }
        }
    }

    async filterUserContent(items, type) {
        if (!items || items.length === 0) return [];

        // Import blocking settings
        const { contentBlockingSettings } = await import('./storage.js');

        // First filter out blocked content
        if (type === 'track') {
            items = contentBlockingSettings.filterTracks(items);
        } else if (type === 'album') {
            items = contentBlockingSettings.filterAlbums(items);
        } else if (type === 'artist') {
            items = contentBlockingSettings.filterArtists(items);
        }

        const favorites = await db.getFavorites(type);
        const favoriteIds = new Set(favorites.map((i) => i.id));

        const likedTracks = await db.getFavorites('track');
        const playlists = await db.getPlaylists(true);

        const userTracksMap = new Map();
        likedTracks.forEach((t) => userTracksMap.set(t.id, t));
        playlists.forEach((p) => {
            if (p.tracks) p.tracks.forEach((t) => userTracksMap.set(t.id, t));
        });

        if (type === 'track') {
            return items.filter((item) => !userTracksMap.has(item.id));
        }

        if (type === 'album') {
            const albumTrackCounts = new Map();
            for (const track of userTracksMap.values()) {
                if (track.album && track.album.id) {
                    const aid = track.album.id;
                    albumTrackCounts.set(aid, (albumTrackCounts.get(aid) || 0) + 1);
                }
            }

            return items.filter((item) => {
                if (favoriteIds.has(item.id)) return false;

                const userCount = albumTrackCounts.get(item.id) || 0;
                const total = item.numberOfTracks;

                if (total && total > 0) {
                    if (userCount / total > 0.5) return false;
                }

                return true;
            });
        }

        return items.filter((item) => !favoriteIds.has(item.id));
    }

    async setupHlsVideo(video, result, fallbackImg) {
        if (!result) return;
        const url = typeof result === 'string' ? result : result.videoUrl || result.hlsUrl;
        if (!url) return;

        if (url.endsWith('.m3u8')) {
            const Hls = (await import('hls.js')).default;
            if (Hls.isSupported()) {
                const hls = new Hls();
                video._hls = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch((e) => {
                        console.warn('Autoplay failed, muted play might be required:', e);
                        video.muted = true;
                        video.play().catch(() => {});
                    });
                });
                hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (data.fatal) {
                        console.warn('HLS fatal error:', data.type);
                        video.replaceWith(fallbackImg);
                        hls.destroy();
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // safari supports HLS natively
                video.src = url;
            } else {
                video.replaceWith(fallbackImg);
            }
        } else {
            // MP4
            video.src = url;
            video.play().catch((e) => {
                console.warn('MP4 autoplay failed:', e);
                video.muted = true;
                video.play().catch(() => {});
            });
        }
        video.onerror = async () => {
            if (result.hlsUrl) {
                // HLS fallback (for some reason alot of animated covers js dont work on MP4 lol)
                await this.setupHlsVideo(video, { videoUrl: null, hlsUrl: result.hlsUrl }, fallbackImg);
            } else {
                video.replaceWith(fallbackImg);
            }
        };
    }

    async replaceVideoArtwork(container, type, id, result) {
        const url = result.videoUrl || result.hlsUrl;
        if (!url) return;

        const card = container.querySelector(`[data-${type}-id="${id}"]`);
        if (!card) return;
        const img = card.querySelector('.card-image');
        if (img && img.tagName !== 'VIDEO') {
            const video = document.createElement('video');
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.className = img.className;
            video.id = img.id;
            video.style.objectFit = 'cover';

            video.poster = img.src;

            video.onerror = async () => {
                if (video.src === result.videoUrl && result.hlsUrl) {
                    await this.setupHlsVideo(video, { videoUrl: null, hlsUrl: result.hlsUrl }, img);
                    return;
                }
                video.replaceWith(img);
            };

            video.addEventListener(
                'error',
                async (e) => {
                    if (video.src === result.videoUrl && result.hlsUrl) {
                        await this.setupHlsVideo(video, { videoUrl: null, hlsUrl: result.hlsUrl }, img);
                        return;
                    }
                    console.warn('Video decoding error:', e);
                    video.replaceWith(img);
                },
                true
            );

            img.replaceWith(video);

            await this.setupHlsVideo(video, result, img);
        }
    }

    async renderSearchPage(query) {
        await this.showPage('search');
        document.getElementById('search-results-title').textContent = `Search Results for "${query}"`;

        const tracksContainer = document.getElementById('search-tracks-container');
        const artistsContainer = document.getElementById('search-artists-container');
        const albumsContainer = document.getElementById('search-albums-container');
        const playlistsContainer = document.getElementById('search-playlists-container');
        const podcastsContainer = document.getElementById('search-podcasts-container');

        tracksContainer.innerHTML = this.createSkeletonTracks(8, true);
        artistsContainer.innerHTML = this.createSkeletonCards(6, true);
        albumsContainer.innerHTML = this.createSkeletonCards(6, false);
        playlistsContainer.innerHTML = this.createSkeletonCards(6, false);
        podcastsContainer.innerHTML = this.createSkeletonCards(6, true);

        if (this.searchAbortController) {
            this.searchAbortController.abort();
        }
        this.searchAbortController = new AbortController();
        const signal = this.searchAbortController.signal;

        try {
            const provider = this.api.getCurrentProvider();
            const results = await this.api.search(query, { signal, provider });

            let finalTracks = (results.tracks && results.tracks.items) || [];
            let finalVideos = (results.videos && results.videos.items) || [];
            let finalArtists = (results.artists && results.artists.items) || [];
            let finalAlbums = (results.albums && results.albums.items) || [];
            let finalPlaylists = (results.playlists && results.playlists.items) || [];

            if (finalArtists.length === 0 && finalTracks.length > 0) {
                const artistMap = new Map();
                finalTracks.forEach((track) => {
                    if (track.artist && !artistMap.has(track.artist.id)) {
                        artistMap.set(track.artist.id, track.artist);
                    }
                    if (track.artists) {
                        track.artists.forEach((artist) => {
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
                finalTracks.forEach((track) => {
                    if (track.album && !albumMap.has(track.album.id)) {
                        albumMap.set(track.album.id, track.album);
                    }
                });
                finalAlbums = Array.from(albumMap.values());
            }

            // Track search with results
            const totalResults = finalTracks.length + finalArtists.length + finalAlbums.length + finalPlaylists.length;
            trackSearch(query, totalResults);

            if (finalTracks.length) {
                await this.renderListWithTracks(tracksContainer, finalTracks, true, false, false, true);
            } else {
                tracksContainer.innerHTML = createPlaceholder('No tracks found.');
            }

            const videosContainer = document.getElementById('search-videos-container');
            if (videosContainer) {
                videosContainer.innerHTML = finalVideos.length
                    ? finalVideos.map((video) => this.createVideoCardHTML(video)).join('')
                    : createPlaceholder('No videos found.');

                for (const video of finalVideos) {
                    const el = videosContainer.querySelector(`[data-video-id="${video.id}"]`);
                    if (el) {
                        trackDataStore.set(el, video);
                        await this.updateLikeState(el, 'video', video.id);
                        el.addEventListener('click', (e) => {
                            if (e.target.closest('.like-btn')) {
                                e.stopPropagation();
                                return;
                            }
                            if (e.target.closest('.card-play-btn') || e.target.closest('.card-image-container')) {
                                e.stopPropagation();
                                this.player.playVideo(video);
                            }
                        });
                    }
                }
            }

            artistsContainer.innerHTML = finalArtists.length
                ? finalArtists.map((artist) => this.createArtistCardHTML(artist)).join('')
                : createPlaceholder('No artists found.');

            for (const artist of finalArtists) {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    await this.updateLikeState(el, 'artist', artist.id);
                }
            }

            albumsContainer.innerHTML = finalAlbums.length
                ? finalAlbums.map((album) => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            for (const album of finalAlbums) {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    await this.updateLikeState(el, 'album', album.id);
                }
            }

            playlistsContainer.innerHTML = finalPlaylists.length
                ? finalPlaylists.map((playlist) => this.createPlaylistCardHTML(playlist)).join('')
                : createPlaceholder('No playlists found.');

            for (const playlist of finalPlaylists) {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    await this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            }

            await this.renderPodcastSearchResults(query);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Search failed:', error);
            const errorMsg = createPlaceholder(`Error during search. ${error.message}`);
            tracksContainer.innerHTML = errorMsg;
            artistsContainer.innerHTML = errorMsg;
            albumsContainer.innerHTML = errorMsg;
            playlistsContainer.innerHTML = errorMsg;
            podcastsContainer.innerHTML = errorMsg;
        }
    }

    renderSearchHistory() {
        const historyEl = document.getElementById('search-history');
        if (!historyEl) return;
        const history = JSON.parse(localStorage.getItem('search-history') || '[]');
        if (history.length === 0) {
            historyEl.style.display = 'none';
            return;
        }
        historyEl.innerHTML =
            history
                .map(
                    (query) => `
            <div class="search-history-item" data-query="${escapeHtml(query)}">
                ${SVG_CLOCK(16)}
                <span class="query-text">${escapeHtml(query)}</span>
                <span class="delete-history-btn" title="Remove from history">
                    ${SVG_CLOSE(14)}
                </span>
            </div>
        `
                )
                .join('') +
            `
            <div class="search-history-clear-all" id="clear-search-history">
                Clear all history
            </div>
        `;
        historyEl.style.display = 'block';

        historyEl.querySelectorAll('.search-history-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.delete-history-btn')) {
                    e.stopPropagation();
                    this.removeFromSearchHistory(item.dataset.query);
                    return;
                }
                const query = item.dataset.query;
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.value = query;
                    searchInput.dispatchEvent(new Event('input'));
                    historyEl.style.display = 'none';
                }
            });
        });

        const clearBtn = document.getElementById('clear-search-history');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                localStorage.removeItem('search-history');
                this.renderSearchHistory();
            });
        }
    }

    removeFromSearchHistory(query) {
        let history = JSON.parse(localStorage.getItem('search-history') || '[]');
        history = history.filter((q) => q !== query);
        localStorage.setItem('search-history', JSON.stringify(history));
        this.renderSearchHistory();
    }

    addToSearchHistory(query) {
        if (!query || query.trim().length === 0) return;
        let history = JSON.parse(localStorage.getItem('search-history') || '[]');
        history = history.filter((q) => q !== query);
        history.unshift(query);
        history = history.slice(0, 10);
        localStorage.setItem('search-history', JSON.stringify(history));
    }

    async renderAlbumPage(albumId, provider = null) {
        await this.showPage('album');

        const imageEl = document.getElementById('album-detail-image');
        const titleEl = document.getElementById('album-detail-title');
        const metaEl = document.getElementById('album-detail-meta');
        const prodEl = document.getElementById('album-detail-producer');
        const rateCriticsEl = document.getElementById('album-detail-ratings-critics');
        const rateUsersEl = document.getElementById('album-detail-ratings-users');
        const tracklistContainer = document.getElementById('album-detail-tracklist');
        const playBtn = document.getElementById('play-album-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY(20)}<span>Play Album</span>`;
        const dlBtn = document.getElementById('download-album-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD(20)}<span>Download Album</span>`;
        const mixBtn = document.getElementById('album-mix-btn');
        if (mixBtn) mixBtn.style.display = 'none';

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        prodEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        rateCriticsEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        rateUsersEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        tracklistContainer.innerHTML = `
            <div class="track-list-header">
                <span style="width: 40px; text-align: center;">#</span>
                <span>Title</span>
                <span class="duration-header">Duration</span>
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, false)}
        `;

        try {
            const { album, tracks } = await this.api.getAlbum(albumId, provider);
            this.currentAlbumId = albumId;

            const videoCoverUrl = album.videoCoverUrl || null;

            if (!videoCoverUrl && tracks.length > 0) {
                const firstTrack = tracks[0];
                this.api.getVideoArtwork(firstTrack.title, getTrackArtists(firstTrack)).then(async (result) => {
                    if (result && this.currentPage === 'album' && this.currentAlbumId === albumId) {
                        const url = result.videoUrl || result.hlsUrl;
                        if (!url) return;
                        album.videoCoverUrl = url;
                        const currentImageEl = document.getElementById('album-detail-image');
                        if (currentImageEl && currentImageEl.tagName !== 'VIDEO') {
                            const video = document.createElement('video');
                            video.autoplay = true;
                            video.loop = true;
                            video.muted = true;
                            video.playsInline = true;
                            video.preload = 'auto';
                            video.className = currentImageEl.className;
                            video.id = currentImageEl.id;
                            video.style.opacity = '1';
                            video.poster = currentImageEl.src;

                            await this.setupHlsVideo(video, result, currentImageEl);
                            currentImageEl.replaceWith(video);
                        }
                    }
                });
            }

            const coverUrl = videoCoverUrl || this.api.getCoverUrl(album.cover);

            if (videoCoverUrl) {
                if (imageEl.tagName !== 'VIDEO') {
                    const video = document.createElement('video');
                    video.autoplay = true;
                    video.loop = true;
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'auto';
                    video.className = imageEl.className;
                    video.id = imageEl.id;
                    await this.setupHlsVideo(video, videoCoverUrl, imageEl);
                    imageEl.replaceWith(video);
                } else {
                    await this.setupHlsVideo(imageEl, videoCoverUrl, null);
                }
            } else {
                if (imageEl.tagName === 'VIDEO') {
                    const img = document.createElement('img');
                    img.src = coverUrl;
                    img.className = imageEl.className;
                    img.id = imageEl.id;
                    imageEl.replaceWith(img);
                } else {
                    imageEl.src = coverUrl;
                }
            }
            imageEl.style.backgroundColor = '';

            // Set background and vibrant color
            this.setPageBackground(coverUrl);
            if (backgroundSettings.isEnabled() && album.cover) {
                await this.extractAndApplyColor(this.api.getCoverUrl(album.cover, '80'));
            }

            const explicitBadge = hasExplicitContent(album) ? this.createExplicitBadge() : '';
            titleEl.innerHTML = `${escapeHtml(album.title)} ${explicitBadge}`;

            this.adjustTitleFontSize(titleEl, album.title);

            const totalDuration = calculateTotalDuration(tracks);
            let dateDisplay = '';
            if (album.releaseDate) {
                const releaseDate = new Date(album.releaseDate);
                if (!isNaN(releaseDate.getTime())) {
                    const year = releaseDate.getFullYear();
                    dateDisplay =
                        window.innerWidth > 768
                            ? releaseDate.toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                              })
                            : year;
                }
            }

            const firstCopyright = tracks.find((track) => track.copyright)?.copyright;

            metaEl.innerHTML =
                (dateDisplay ? `${dateDisplay} • ` : '') + `${tracks.length} tracks • ${formatDuration(totalDuration)}`;

            prodEl.innerHTML =
                `By <a href="/artist/${album.artist.id}">${album.artist.name}</a>` +
                (firstCopyright ? ` • ${firstCopyright}` : '');

            async function fetchAotyWorker(album, artist) {
                try {
                    const response = await fetch(
                        `https://aoty-critics.samidy.workers.dev/?artist=${artist}&album=${album}`
                    );
                    const data = await response.json();

                    rateCriticsEl.innerHTML = `<a href="${data.url}" target="_blank" style="color: var(--muted-foreground);">Critic Score: <span style="text-decoration: underline;">${data.critic.score}</span>, Based on ${data.critic.count} reviews</a>`;
                    rateUsersEl.innerHTML = `<a href="${data.url}" target="_blank" style="color: var(--muted-foreground);">User Score: <span style="text-decoration: underline;">${data.user.score}</span>, Based on ${data.user.count} reviews</a>`;
                } catch (e) {
                    rateCriticsEl.innerHTML = `<a style="color: var(--muted-foreground);">Unable to Fetch Critic Score</a>`;
                    rateUsersEl.innerHTML = `<a style="color: var(--muted-foreground);">Unable to Fetch User Score</a>`;
                }
            }

            fetchAotyWorker(album.title, album.artist.name);

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                </div>
            `;

            tracks.sort((a, b) => {
                const discA = a.volumeNumber ?? a.discNumber ?? 1;
                const discB = b.volumeNumber ?? b.discNumber ?? 1;
                if (discA !== discB) return discA - discB;
                return a.trackNumber - b.trackNumber;
            });
            await this.renderListWithTracks(tracklistContainer, tracks, false, true);

            recentActivityManager.addAlbum(album);

            // Update header like button
            const albumLikeBtn = document.getElementById('like-album-btn');
            if (albumLikeBtn) {
                const isLiked = await db.isFavorite('album', album.id);
                albumLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                albumLikeBtn.classList.toggle('active', isLiked);
            }

            // Store album data for menu button
            const albumMenuBtn = document.getElementById('album-menu-btn');
            if (albumMenuBtn) {
                albumMenuBtn.dataset.id = album.id;
                trackDataStore.set(albumMenuBtn, album);
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
            [moreAlbumsSection, epsSection, similarArtistsSection, similarAlbumsSection].forEach((el) => {
                if (el) el.style.display = 'none';
            });

            try {
                const artistData = await this.api.getArtist(album.artist.id);

                // Add Mix/Radio Button to header
                const mixBtn = document.getElementById('album-mix-btn');
                if (mixBtn && artistData.mixes && artistData.mixes.ARTIST_MIX) {
                    mixBtn.style.display = 'flex';
                    mixBtn.onclick = () => navigate(`/mix/${artistData.mixes.ARTIST_MIX}`);
                }

                const renderSection = async (items, container, section, titleEl, titleText) => {
                    if (!container || !section) return;

                    const filtered = (items || [])
                        .filter((a) => a.id != album.id)
                        .filter(
                            (a, index, self) => index === self.findIndex((t) => t.title === a.title) // Dedup by title
                        )
                        .slice(0, 12);

                    if (filtered.length === 0) return;

                    container.innerHTML = filtered.map((a) => this.createAlbumCardHTML(a)).join('');
                    if (titleEl && titleText) titleEl.textContent = titleText;
                    section.style.display = 'block';

                    for (const a of filtered) {
                        const el = container.querySelector(`[data-album-id="${a.id}"]`);
                        if (el) {
                            trackDataStore.set(el, a);
                            await this.updateLikeState(el, 'album', a.id);
                        }
                    }
                };

                await renderSection(
                    artistData.albums,
                    moreAlbumsContainer,
                    moreAlbumsSection,
                    moreAlbumsTitle,
                    `More albums from ${album.artist.name}`
                );
                await renderSection(
                    artistData.eps,
                    epsContainer,
                    epsSection,
                    epsTitle,
                    `EPs and Singles from ${album.artist.name}`
                );

                // Similar Artists
                this.api
                    .getSimilarArtists(album.artist.id)
                    .then(async (similar) => {
                        // Filter out blocked artists
                        const { contentBlockingSettings } = await import('./storage.js');
                        const filteredSimilar = contentBlockingSettings.filterArtists(similar || []);

                        if (filteredSimilar.length > 0 && similarArtistsContainer && similarArtistsSection) {
                            similarArtistsContainer.innerHTML = filteredSimilar
                                .map((a) => this.createArtistCardHTML(a))
                                .join('');
                            similarArtistsSection.style.display = 'block';

                            for (const a of filteredSimilar) {
                                const el = similarArtistsContainer.querySelector(`[data-artist-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    await this.updateLikeState(el, 'artist', a.id);
                                }
                            }
                        }
                    })
                    .catch((e) => console.warn('Failed to load similar artists:', e));

                // Similar Albums
                this.api
                    .getSimilarAlbums(albumId)
                    .then(async (similar) => {
                        // Filter out blocked albums
                        const { contentBlockingSettings } = await import('./storage.js');
                        const filteredSimilar = contentBlockingSettings.filterAlbums(similar || []);

                        if (filteredSimilar.length > 0 && similarAlbumsContainer && similarAlbumsSection) {
                            similarAlbumsContainer.innerHTML = filteredSimilar
                                .map((a) => this.createAlbumCardHTML(a))
                                .join('');
                            similarAlbumsSection.style.display = 'block';

                            for (const a of filteredSimilar) {
                                const el = similarAlbumsContainer.querySelector(`[data-album-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    await this.updateLikeState(el, 'album', a.id);
                                }
                            }
                        }
                    })
                    .catch((e) => console.warn('Failed to load similar albums:', e));
            } catch (err) {
                console.warn('Failed to load "More from artist":', err);
            }
        } catch (error) {
            console.error('Failed to load album:', error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load album details. ${error.message}`);
        }
    }

    async loadRecommendedSongsForPlaylist(tracks, forceRefresh = false) {
        const recommendedSection = document.getElementById('playlist-section-recommended');
        const recommendedContainer = document.getElementById('playlist-detail-recommended');

        if (!recommendedSection || !recommendedContainer) {
            console.warn('Recommended songs section not found in DOM');
            return;
        }

        if (forceRefresh) {
            recommendedContainer.innerHTML = this.createSkeletonTracks(5, true);
        }

        try {
            let recommendedTracks = await this.api.getRecommendedTracksForPlaylist(tracks, 20, {
                refresh: forceRefresh,
            });

            // Filter out blocked tracks
            const { contentBlockingSettings } = await import('./storage.js');
            recommendedTracks = contentBlockingSettings.filterTracks(recommendedTracks);

            if (recommendedTracks.length > 0) {
                await this.renderListWithTracks(recommendedContainer, recommendedTracks, true, false, false, true);

                const trackItems = recommendedContainer.querySelectorAll('.track-item');
                trackItems.forEach((item) => {
                    const actionsDiv = item.querySelector('.track-item-actions');
                    if (actionsDiv) {
                        const addToPlaylistBtn = document.createElement('button');
                        addToPlaylistBtn.className = 'track-action-btn add-to-playlist-btn';
                        addToPlaylistBtn.title = 'Add to this playlist';
                        addToPlaylistBtn.innerHTML = SVG_MINUS(20);
                        addToPlaylistBtn.onclick = async (e) => {
                            e.stopPropagation();
                            const trackData = trackDataStore.get(item);
                            if (trackData) {
                                try {
                                    const path = window.location.pathname;
                                    const playlistMatch = path.match(/\/userplaylist\/([^/]+)/);
                                    if (playlistMatch) {
                                        const playlistId = playlistMatch[1];
                                        await db.addTrackToPlaylist(playlistId, trackData);
                                        const updatedPlaylist = await db.getPlaylist(playlistId);
                                        await syncManager.syncUserPlaylist(updatedPlaylist, 'update');

                                        const tracklistContainer = document.getElementById('playlist-detail-tracklist');
                                        if (tracklistContainer && updatedPlaylist.tracks) {
                                            tracklistContainer.innerHTML = TRACKLIST_HEADER_WITH_LIKE_COL_HTML;
                                            await this.renderListWithTracks(
                                                tracklistContainer,
                                                updatedPlaylist.tracks,
                                                true,
                                                true,
                                                false,
                                                true
                                            );

                                            if (document.querySelector('.remove-from-playlist-btn')) {
                                                this.enableTrackReordering(
                                                    tracklistContainer,
                                                    updatedPlaylist.tracks,
                                                    playlistId,
                                                    syncManager
                                                );
                                            }

                                            // Update the playlist metadata
                                            const metaEl = document.getElementById('playlist-detail-meta');
                                            if (metaEl) {
                                                const totalDuration = calculateTotalDuration(updatedPlaylist.tracks);
                                                metaEl.textContent = `${updatedPlaylist.tracks.length} tracks • ${formatDuration(totalDuration)}`;
                                            }
                                        }

                                        showNotification(`Added "${trackData.title}" to playlist`);
                                    }
                                } catch (error) {
                                    console.error('Failed to add track to playlist:', error);
                                    showNotification('Failed to add track to playlist');
                                }
                            }
                        };

                        const menuBtn = actionsDiv.querySelector('.track-menu-btn');
                        if (menuBtn) {
                            actionsDiv.insertBefore(addToPlaylistBtn, menuBtn);
                        } else {
                            actionsDiv.appendChild(addToPlaylistBtn);
                        }
                    }
                });

                recommendedSection.style.display = 'block';
            } else {
                recommendedSection.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to load recommended songs:', error);
            recommendedSection.style.display = 'none';
        }
    }

    async renderPlaylistPage(playlistId, source = null, _provider = null) {
        await this.showPage('playlist');

        // Reset search input for new playlist
        const searchInput = document.getElementById('track-list-search-input');
        if (searchInput) searchInput.value = '';

        const imageEl = document.getElementById('playlist-detail-image');
        const collageEl = document.getElementById('playlist-detail-collage');
        const titleEl = document.getElementById('playlist-detail-title');
        const metaEl = document.getElementById('playlist-detail-meta');
        const descEl = document.getElementById('playlist-detail-description');
        const tracklistContainer = document.getElementById('playlist-detail-tracklist');
        const playBtn = document.getElementById('play-playlist-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY(20)}<span>Play</span>`;
        const dlBtn = document.getElementById('download-playlist-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD(20)}<span>Download</span>`;
        const addPlaylistBtn = document.getElementById('add-playlist-to-playlist-btn');

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        descEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100%;"></div>';
        tracklistContainer.innerHTML = `${TRACKLIST_HEADER_WITH_LIKE_COL_HTML}${this.createSkeletonTracks(10, true)}`;

        try {
            // Check if it's a user playlist (UUID format)
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playlistId);

            let playlistData = null;
            let ownedPlaylist = null;
            let currentSort = 'custom';

            // Priority:
            // 1. If source is 'user', check DB/Sync.
            // 2. If source is 'api', check API.
            // 3. If no source, check DB if UUID, then API.

            if (source === 'user' || (!source && isUUID)) {
                ownedPlaylist = await db.getPlaylist(playlistId);
                playlistData = ownedPlaylist;

                // If not in local DB, check if it's a public Pocketbase playlist
                if (!playlistData) {
                    try {
                        playlistData = await syncManager.getPublicPlaylist(playlistId);
                    } catch (e) {
                        console.warn('Failed to check public pocketbase playlists:', e);
                    }
                }
            }

            if (playlistData) {
                // ... (rest of the logic)
                if (addPlaylistBtn) addPlaylistBtn.style.display = 'none';

                if (playlistData.cover) {
                    imageEl.src = playlistData.cover;
                    imageEl.style.display = 'block';
                    if (collageEl) collageEl.style.display = 'none';
                    this.setPageBackground(playlistData.cover);
                    await this.extractAndApplyColor(playlistData.cover);
                } else {
                    const tracksWithCovers = (playlistData.tracks || []).filter((t) => t.album && t.album.cover);
                    const uniqueCovers = [];
                    const seen = new Set();
                    for (const t of tracksWithCovers) {
                        if (!seen.has(t.album.cover)) {
                            seen.add(t.album.cover);
                            uniqueCovers.push(t.album.cover);
                            if (uniqueCovers.length >= 4) break;
                        }
                    }

                    if (uniqueCovers.length > 0 && collageEl) {
                        imageEl.style.display = 'none';
                        collageEl.style.display = 'grid';
                        collageEl.innerHTML = '';
                        const imagesToRender = [];
                        for (let i = 0; i < 4; i++) {
                            imagesToRender.push(uniqueCovers[i % uniqueCovers.length]);
                        }
                        imagesToRender.forEach((cover) => {
                            const img = document.createElement('img');
                            img.src = this.api.getCoverUrl(cover);
                            collageEl.appendChild(img);
                        });
                    } else {
                        imageEl.src = '/assets/appicon.png';
                        imageEl.style.display = 'block';
                        if (collageEl) collageEl.style.display = 'none';
                    }
                    this.setPageBackground(null);
                    this.resetVibrantColor();
                }

                titleEl.textContent = playlistData.name || playlistData.title;
                this.adjustTitleFontSize(titleEl, titleEl.textContent);

                const tracks = playlistData.tracks || [];
                const totalDuration = calculateTotalDuration(tracks);

                metaEl.textContent = `${tracks.length} tracks • ${formatDuration(totalDuration)}`;
                descEl.textContent = playlistData.description || '';

                const originalTracks = [...tracks];
                const savedSort = localStorage.getItem(`playlist-sort-${playlistId}`);
                currentSort = savedSort || 'custom';
                let currentTracks = sortTracks(originalTracks, currentSort);

                const renderTracks = async () => {
                    // Re-fetch container each time because enableTrackReordering clones it
                    const container = document.getElementById('playlist-detail-tracklist');
                    container.innerHTML = TRACKLIST_HEADER_WITH_LIKE_COL_HTML;
                    await this.renderListWithTracks(container, currentTracks, true, true, false, true);

                    // Add remove buttons and enable reordering ONLY IF OWNED
                    if (ownedPlaylist) {
                        const trackItems = container.querySelectorAll('.track-item');
                        trackItems.forEach((item, index) => {
                            const actionsDiv = item.querySelector('.track-item-actions');
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'track-action-btn remove-from-playlist-btn';
                            removeBtn.title = 'Remove from playlist';
                            removeBtn.innerHTML = SVG_BIN(20);
                            removeBtn.dataset.trackId = currentTracks[index].id;
                            removeBtn.dataset.type = currentTracks[index].type || 'track';

                            const menuBtn = actionsDiv.querySelector('.track-menu-btn');
                            actionsDiv.insertBefore(removeBtn, menuBtn);
                        });

                        // Always add is-editable class for owned playlists to fix layout
                        // This expands the grid columns to accommodate the remove button
                        container.classList.add('is-editable');

                        // Only enable drag-and-drop reordering in custom sort mode
                        if (currentSort === 'custom') {
                            this.enableTrackReordering(container, currentTracks, playlistId, syncManager);
                        }
                    } else {
                        container.classList.remove('is-editable');
                    }
                };

                const applySort = async (sortType) => {
                    currentSort = sortType;
                    localStorage.setItem(`playlist-sort-${playlistId}`, sortType);
                    currentTracks = sortTracks(originalTracks, sortType);
                    await renderTracks();
                };

                await renderTracks();

                // Update header like button - hide for user playlists
                const playlistLikeBtn = document.getElementById('like-playlist-btn');
                if (playlistLikeBtn) {
                    playlistLikeBtn.style.display = 'none';
                }

                // Load recommended songs thingy
                if (ownedPlaylist) {
                    await this.loadRecommendedSongsForPlaylist(tracks);

                    const refreshBtn = document.getElementById('refresh-recommended-songs-btn');
                    if (refreshBtn) {
                        refreshBtn.onclick = async () => {
                            const icon = refreshBtn.querySelector('svg');
                            if (icon) icon.style.animation = 'spin 1s linear infinite';
                            refreshBtn.disabled = true;
                            await this.loadRecommendedSongsForPlaylist(tracks, true);
                            if (icon) icon.style.animation = '';
                            refreshBtn.disabled = false;
                        };
                    }
                }

                // Render Actions (Sort, Shuffle, Edit, Delete, Share)
                await this.updatePlaylistHeaderActions(
                    playlistData,
                    !!ownedPlaylist,
                    currentTracks,
                    false,
                    applySort,
                    () => currentSort
                );

                playBtn.onclick = () => {
                    this.player.setQueue(currentTracks, 0);
                    this.player.playTrackFromQueue();
                };

                const uniqueCovers = [];
                const seenCovers = new Set();
                const trackList = playlistData.tracks || [];
                for (const track of trackList) {
                    const cover = track.album?.cover;
                    if (cover && !seenCovers.has(cover)) {
                        seenCovers.add(cover);
                        uniqueCovers.push(cover);
                        if (uniqueCovers.length >= 4) break;
                    }
                }

                recentActivityManager.addPlaylist({
                    id: playlistData.id || playlistData.uuid,
                    name: playlistData.name || playlistData.title,
                    title: playlistData.title || playlistData.name,
                    uuid: playlistData.uuid || playlistData.id,
                    cover: playlistData.cover,
                    images: uniqueCovers,
                    numberOfTracks: playlistData.tracks ? playlistData.tracks.length : 0,
                    isUserPlaylist: true,
                });
                document.title = `${playlistData.name || playlistData.title} - Monochrome`;

                // Setup playlist search
                this.setupTracklistSearch();
            } else {
                if (addPlaylistBtn) addPlaylistBtn.style.display = 'flex';

                // If source was explicitly 'user' and we didn't find it, fail.
                if (source === 'user') {
                    throw new Error('Playlist not found. If this is a custom playlist, make sure it is set to Public.');
                }

                // Render API playlist
                let apiResult = await this.api.getPlaylist(playlistId);

                const { playlist, tracks } = apiResult;

                const imageId = playlist.squareImage || playlist.image;
                if (imageId) {
                    imageEl.src = this.api.getCoverUrl(imageId, '1080');
                    this.setPageBackground(imageEl.src);

                    await this.extractAndApplyColor(this.api.getCoverUrl(imageId, '160'));
                } else {
                    imageEl.src = '/assets/appicon.png';
                    this.setPageBackground(null);
                    this.resetVibrantColor();
                }

                titleEl.textContent = playlist.title;
                this.adjustTitleFontSize(titleEl, playlist.title);

                const totalDuration = calculateTotalDuration(tracks);

                metaEl.textContent = `${playlist.numberOfTracks} tracks • ${formatDuration(totalDuration)}`;
                descEl.textContent = playlist.description || '';

                const originalTracks = [...tracks];
                const savedSort = localStorage.getItem(`playlist-sort-${playlistId}`);
                let currentSort = savedSort || 'custom';
                let currentTracks = sortTracks(originalTracks, currentSort);

                const renderTracks = async () => {
                    tracklistContainer.innerHTML = TRACKLIST_HEADER_WITH_LIKE_COL_HTML;
                    await this.renderListWithTracks(tracklistContainer, currentTracks, true, true, false, true);
                };

                const applySort = async (sortType) => {
                    currentSort = sortType;
                    localStorage.setItem(`playlist-sort-${playlistId}`, sortType);
                    currentTracks = sortTracks(originalTracks, sortType);
                    await renderTracks();
                };

                await renderTracks();

                playBtn.onclick = () => {
                    this.player.setQueue(currentTracks, 0);
                    this.player.playTrackFromQueue();
                };

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

                // Hide recommended songs section for tidal playlists
                const recommendedSection = document.getElementById('playlist-section-recommended');
                if (recommendedSection) {
                    recommendedSection.style.display = 'none';
                }

                // Render Actions (Shuffle + Sort + Share)
                await this.updatePlaylistHeaderActions(
                    playlist,
                    false,
                    currentTracks,
                    false,
                    applySort,
                    () => currentSort
                );

                recentActivityManager.addPlaylist(playlist);
                document.title = playlist.title || 'Artist Mix';
            }

            // Setup playlist search
            this.setupTracklistSearch();
        } catch (error) {
            console.error('Failed to load playlist:', error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load playlist details. ${error.message}`);
        }
    }

    async renderFolderPage(folderId) {
        await this.showPage('folder');
        const imageEl = document.getElementById('folder-detail-image');
        const titleEl = document.getElementById('folder-detail-title');
        const metaEl = document.getElementById('folder-detail-meta');
        const container = document.getElementById('folder-detail-container');

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        container.innerHTML = this.createSkeletonCards(4, false);

        try {
            const folder = await db.getFolder(folderId);
            if (!folder) throw new Error('Folder not found');

            imageEl.src = folder.cover || '/assets/folder.png';
            imageEl.onerror = () => {
                imageEl.src = '/assets/folder.png';
            };
            imageEl.style.backgroundColor = '';

            titleEl.textContent = folder.name;
            metaEl.textContent = `Created ${new Date(folder.createdAt).toLocaleDateString()}`;

            this.setPageBackground(null);
            this.resetVibrantColor();

            if (folder.playlists?.length > 0) {
                const playlistPromises = folder.playlists.map((id) => db.getPlaylist(id));
                const playlists = (await Promise.all(playlistPromises)).filter(Boolean);
                if (playlists.length > 0) {
                    container.innerHTML = playlists.map((p) => this.createUserPlaylistCardHTML(p)).join('');
                    playlists.forEach((playlist) => {
                        const el = container.querySelector(`[data-user-playlist-id="${playlist.id}"]`);
                        if (el) trackDataStore.set(el, playlist);
                    });
                } else {
                    container.innerHTML = createPlaceholder(
                        'This folder is empty. Some playlists may have been deleted.'
                    );
                }
            } else {
                container.innerHTML = createPlaceholder('This folder is empty. Drag a playlist here to add it.');
            }
        } catch (error) {
            console.error('Failed to load folder:', error);
            container.innerHTML = createPlaceholder('Folder not found.');
        }
    }

    async renderMixPage(mixId, provider = null) {
        await this.showPage('mix');

        const imageEl = document.getElementById('mix-detail-image');
        const titleEl = document.getElementById('mix-detail-title');
        const metaEl = document.getElementById('mix-detail-meta');
        const descEl = document.getElementById('mix-detail-description');
        const tracklistContainer = document.getElementById('mix-detail-tracklist');
        const playBtn = document.getElementById('play-mix-btn');
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY(20)}<span>Play</span>`;
        const dlBtn = document.getElementById('download-mix-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD(20)}<span>Download</span>`;

        // Skeleton loading
        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 200px; max-width: 80%;"></div>';
        descEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100%;"></div>';
        tracklistContainer.innerHTML = `${TRACKLIST_HEADER_WITH_LIKE_COL_HTML}${this.createSkeletonTracks(10, true)}`;

        try {
            const { mix, tracks } = await this.api.getMix(mixId, provider);
            this.currentMixId = mixId;

            if (mix.cover) {
                imageEl.src = mix.cover;
                this.setPageBackground(mix.cover);
                await this.extractAndApplyColor(mix.cover);
            } else {
                // Try to get cover from first track album
                if (tracks.length > 0 && tracks[0].album?.cover) {
                    const firstTrack = tracks[0];
                    let videoCoverUrl =
                        firstTrack.videoUrl || firstTrack.videoCoverUrl || firstTrack.album?.videoCoverUrl || null;

                    if (!videoCoverUrl && (firstTrack.album || firstTrack.type === 'video')) {
                        const fetchArtwork = () => {
                            this.api
                                .getVideoArtwork(firstTrack.title, getTrackArtists(firstTrack))
                                .then(async (result) => {
                                    if (result && this.currentPage === 'mix' && this.currentMixId === mixId) {
                                        const url = result.videoUrl || result.hlsUrl;
                                        if (!url) return;
                                        firstTrack.album = firstTrack.album || {};
                                        firstTrack.album.videoCoverUrl = url;
                                        const currentImageEl = document.getElementById('mix-detail-image');
                                        if (currentImageEl && currentImageEl.tagName !== 'VIDEO') {
                                            const video = document.createElement('video');
                                            video.autoplay = true;
                                            video.loop = true;
                                            video.muted = true;
                                            video.playsInline = true;
                                            video.preload = 'auto';
                                            video.className = currentImageEl.className;
                                            video.id = currentImageEl.id;
                                            video.style.opacity = '1';
                                            video.poster = currentImageEl.src;

                                            await this.setupHlsVideo(video, result, currentImageEl);
                                            currentImageEl.replaceWith(video);
                                        }
                                    }
                                });
                        };

                        if (firstTrack.type === 'video') {
                            await this.api
                                .getVideoStreamUrl(firstTrack.id)
                                .then(async (url) => {
                                    if (url) {
                                        firstTrack.videoUrl = url;
                                        await this.renderMixPage(mixId);
                                    } else {
                                        fetchArtwork();
                                    }
                                })
                                .catch(fetchArtwork);
                        } else {
                            fetchArtwork();
                        }
                    }

                    const coverUrl = videoCoverUrl || this.api.getCoverUrl(firstTrack.album.cover);

                    if (videoCoverUrl) {
                        if (imageEl.tagName === 'IMG') {
                            const video = document.createElement('video');
                            video.src = videoCoverUrl;
                            video.autoplay = true;
                            video.loop = true;
                            video.muted = true;
                            video.playsInline = true;
                            video.className = imageEl.className;
                            video.id = imageEl.id;
                            imageEl.replaceWith(video);
                        } else {
                            imageEl.src = videoCoverUrl;
                        }
                    } else {
                        if (imageEl.tagName === 'VIDEO') {
                            const img = document.createElement('img');
                            img.src = coverUrl;
                            img.className = imageEl.className;
                            img.id = imageEl.id;
                            imageEl.replaceWith(img);
                        } else {
                            imageEl.src = coverUrl;
                        }
                    }
                    this.setPageBackground(coverUrl);
                    await this.extractAndApplyColor(this.api.getCoverUrl(tracks[0].album.cover, '160'));
                } else {
                    imageEl.src = '/assets/appicon.png';
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

            tracklistContainer.innerHTML = TRACKLIST_HEADER_WITH_LIKE_COL_HTML;

            await this.renderListWithTracks(tracklistContainer, tracks, true, true, false, true);

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
            console.error('Failed to load mix:', error);
            tracklistContainer.innerHTML = createPlaceholder(`Could not load mix details. ${error.message}`);
        }
    }

    async renderArtistPage(artistId, provider = null) {
        await this.showPage('artist');
        this.currentArtistId = artistId;

        const imageEl = document.getElementById('artist-detail-image');
        const nameEl = document.getElementById('artist-detail-name');
        const metaEl = document.getElementById('artist-detail-meta');
        const socialsEl = document.getElementById('artist-detail-socials');
        const bioEl = document.getElementById('artist-detail-bio');
        const tracksContainer = document.getElementById('artist-detail-tracks');
        const albumsContainer = document.getElementById('artist-detail-albums');
        const epsContainer = document.getElementById('artist-detail-eps');
        const epsSection = document.getElementById('artist-section-eps');
        const similarContainer = document.getElementById('artist-detail-similar');
        const similarSection = document.getElementById('artist-section-similar');
        const inLibraryContainer = document.getElementById('artist-detail-in-library');
        const inLibrarySection = document.getElementById('artist-section-in-library');
        const dlBtn = document.getElementById('download-discography-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD(20)}<span>Download Discography</span>`;

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        nameEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        metaEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 150px;"></div>';
        if (socialsEl) socialsEl.innerHTML = '';
        if (bioEl) {
            bioEl.style.display = 'none';
            bioEl.textContent = '';
            bioEl.classList.remove('expanded');
        }
        tracksContainer.innerHTML = this.createSkeletonTracks(5, true);
        albumsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (epsContainer) epsContainer.innerHTML = this.createSkeletonCards(6, false);
        if (epsSection) epsSection.style.display = 'none';
        const loadUnreleasedSection = document.getElementById('artist-section-load-unreleased');
        if (loadUnreleasedSection) loadUnreleasedSection.style.display = 'none';
        if (similarContainer) similarContainer.innerHTML = this.createSkeletonCards(6, true);
        if (similarSection) similarSection.style.display = 'block';
        if (inLibrarySection) inLibrarySection.style.display = 'none';
        if (inLibraryContainer) {
            inLibraryContainer.innerHTML = '';
            inLibraryContainer.hidden = true;
        }
        // Reset chevron and toggle state
        const chevronEl = document.getElementById('in-library-chevron');
        if (chevronEl) chevronEl.style.transform = 'rotate(0deg)';
        const toggleBtn = document.getElementById('in-library-toggle');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');

        try {
            const artist = await this.api.getArtist(artistId, provider);

            // Handle Biography
            if (bioEl) {
                // Pre-define regex patterns for better performance
                const linkTypes = ['artist', 'album', 'track', 'playlist'];
                const regexCache = {
                    wimp: linkTypes.reduce((acc, type) => {
                        acc[type] = new RegExp(`\\[wimpLink ${type}Id="([a-f\\d-]+)"\\](.*?)\\[\\/wimpLink\\]`, 'g');
                        return acc;
                    }, {}),
                    legacy: linkTypes.reduce((acc, type) => {
                        acc[type] = new RegExp(`\\[${type}:([a-f\\d-]+)\\](.*?)\\[\\/${type}\\]`, 'g');
                        return acc;
                    }, {}),
                    doubleBracket: /\[\[(.*?)\|(.*?)\]\]/g,
                };

                const parseBio = (text) => {
                    if (!text) return '';

                    let parsed = text;

                    linkTypes.forEach((type) => {
                        parsed = parsed.replace(
                            regexCache.wimp[type],
                            (_m, id, name) =>
                                `<span class="bio-link" data-type="${type}" data-id="${id}">${name}</span>`
                        );
                        parsed = parsed.replace(
                            regexCache.legacy[type],
                            (_m, id, name) =>
                                `<span class="bio-link" data-type="${type}" data-id="${id}">${name}</span>`
                        );
                    });

                    parsed = parsed.replace(
                        regexCache.doubleBracket,
                        (_m, name, id) => `<span class="bio-link" data-type="artist" data-id="${id}">${name}</span>`
                    );

                    return parsed.replace(/\n/g, '<br>');
                };

                // Helper to strip tags for clean preview
                const stripBioTags = (text) => {
                    if (!text) return '';
                    let clean = text;
                    linkTypes.forEach((type) => {
                        // [wimpLink artistId="..."]Name[/wimpLink] -> Name
                        clean = clean.replace(regexCache.wimp[type], (_m, _id, name) => name);
                        // [artist:...]Name[/artist] -> Name
                        clean = clean.replace(regexCache.legacy[type], (_m, _id, name) => name);
                    });
                    // [[Name|ID]] -> Name
                    clean = clean.replace(regexCache.doubleBracket, (_m, name, _id) => name);
                    return clean;
                };

                const showBioModal = (bio) => {
                    const text = typeof bio === 'string' ? bio : bio.text;
                    const source = typeof bio === 'string' ? null : bio.source;

                    const modal = document.createElement('div');
                    modal.className = 'modal active bio-modal';
                    modal.style.zIndex = '9999'; // Ensure it's on top
                    modal.innerHTML = `
                        <div class="modal-overlay"></div>
                        <div class="modal-content extra-wide" style="display: flex; flex-direction: column;">
                            <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
                                <h3 style="margin: 0;">Artist Biography</h3>
                                <button class="btn-close" style="background: none; border: none; font-size: 2rem; cursor: pointer; color: var(--foreground); padding: 0.2rem 0.5rem; line-height: 1;">&times;</button>
                            </div>
                            <div class="modal-body" style="max-height: 70vh; overflow-y: auto; line-height: 1.8; font-size: 1.1rem; padding-right: 1rem; color: var(--foreground); cursor: default;">
                                ${parseBio(text)}
                                ${source ? `<div class="bio-source">Source: ${source}</div>` : ''}
                            </div>
                        </div>
                    `;

                    document.body.appendChild(modal);

                    const close = (e) => {
                        if (e) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        modal.remove();
                    };

                    modal.querySelector('.modal-overlay').onclick = close;
                    modal.querySelector('.btn-close').onclick = close;

                    // Ensure links are clickable by attaching the listener to the modal body
                    const modalBody = modal.querySelector('.modal-body');
                    modalBody.addEventListener(
                        'click',
                        (e) => {
                            const link = e.target.closest('.bio-link');
                            if (link) {
                                e.preventDefault();
                                e.stopPropagation();
                                const { type, id } = link.dataset;
                                if (type && id) {
                                    modal.remove();
                                    navigate(`/${type}/t/${id}`);
                                }
                            }
                        },
                        true
                    ); // Use capture phase to ensure it's hit
                };

                const renderBioPreview = (bio) => {
                    const text = typeof bio === 'string' ? bio : bio.text;
                    if (text) {
                        // Use stripped text for preview to avoid broken tags/links
                        const cleanText = stripBioTags(text);
                        const isLong = cleanText.length > 200;
                        const previewText = isLong ? cleanText.substring(0, 200).trim() + '...' : cleanText;

                        bioEl.innerHTML = previewText.replace(/\n/g, '<br>');
                        bioEl.style.display = 'block';
                        bioEl.style.webkitLineClamp = 'unset';
                        bioEl.style.cursor = 'default';
                        bioEl.onclick = null;

                        if (isLong) {
                            bioEl.appendChild(document.createElement('br'));
                            const readMore = document.createElement('span');
                            readMore.className = 'bio-read-more';
                            readMore.textContent = 'Read More';
                            readMore.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                showBioModal(bio);
                            };
                            bioEl.appendChild(readMore);
                        }
                    } else {
                        bioEl.style.display = 'none';
                    }
                };

                if (artist.biography) {
                    renderBioPreview(artist.biography);
                } else {
                    // Try to fetch biography asynchronously
                    this.api
                        .getArtistBiography(artistId, provider)
                        .then((bio) => {
                            if (bio) renderBioPreview(bio);
                        })
                        .catch(() => {
                            /* ignore */
                        });
                }
            }

            // Handle Artist Mix Button
            const mixBtn = document.getElementById('artist-mix-btn');
            if (mixBtn) {
                if (artist.mixes && artist.mixes.ARTIST_MIX) {
                    mixBtn.style.display = 'flex';
                    mixBtn.onclick = () => navigate(`/mix/${artist.mixes.ARTIST_MIX}`);
                } else {
                    mixBtn.style.display = 'none';
                }
            }

            // Similar Artists
            if (similarContainer && similarSection) {
                this.api
                    .getSimilarArtists(artistId)
                    .then(async (similar) => {
                        // Filter out blocked artists
                        const { contentBlockingSettings } = await import('./storage.js');
                        const filteredSimilar = contentBlockingSettings.filterArtists(similar || []);

                        if (filteredSimilar.length > 0) {
                            similarContainer.innerHTML = filteredSimilar
                                .map((a) => this.createArtistCardHTML(a))
                                .join('');
                            similarSection.style.display = 'block';

                            for (const a of filteredSimilar) {
                                const el = similarContainer.querySelector(`[data-artist-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    await this.updateLikeState(el, 'artist', a.id);
                                }
                            }
                        } else {
                            similarSection.style.display = 'none';
                        }
                    })
                    .catch(() => {
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
            await this.extractAndApplyColor(artistPic160);

            this.adjustTitleFontSize(nameEl, artist.name);

            metaEl.innerHTML = `
                <span>${artist.popularity}% popularity</span>
                <div class="artist-tags">
                    ${(artist.artistRoles || [])
                        .filter((role) => role.category)
                        .map((role) => `<span class="artist-tag">${role.category}</span>`)
                        .join('')}
                </div>
            `;

            this.api.getArtistSocials(artist.name).then((links) => {
                if (socialsEl && links.length > 0) {
                    socialsEl.innerHTML = links.map((link) => this.createSocialLinkHTML(link)).join('');
                }
            });

            await this.renderListWithTracks(tracksContainer, artist.tracks, true);

            // "In your library" section: find liked tracks and playlist tracks for this artist
            if (inLibraryContainer && inLibrarySection) {
                const artistNameLower = artist.name.toLowerCase();

                const isTrackByArtist = (track) => {
                    if (track.artists && Array.isArray(track.artists)) {
                        return track.artists.some(
                            (a) =>
                                a &&
                                ((artist.id && a.id === artist.id) ||
                                    (a.name && a.name.toLowerCase() === artistNameLower))
                        );
                    }
                    if (track.artist) {
                        if (typeof track.artist === 'object') {
                            if (artist.id && track.artist.id === artist.id) return true;
                            if (track.artist.name && track.artist.name.toLowerCase() === artistNameLower) return true;
                        } else if (typeof track.artist === 'string') {
                            if (track.artist.toLowerCase() === artistNameLower) return true;
                        }
                    }
                    return false;
                };

                const refreshInLibrary = async () => {
                    try {
                        const seenIds = new Set();
                        const libraryTracks = [];
                        const trackSourceMap = new Map(); // trackId -> Array<{ label, href }>

                        const addSource = (trackId, source) => {
                            if (!trackSourceMap.has(trackId)) {
                                trackSourceMap.set(trackId, []);
                            }
                            trackSourceMap.get(trackId).push(source);
                        };

                        // Get liked tracks
                        const likedTracks = await db.getFavorites('track');
                        for (const track of likedTracks) {
                            if (isTrackByArtist(track)) {
                                if (!seenIds.has(track.id)) {
                                    seenIds.add(track.id);
                                    libraryTracks.push(track);
                                }
                                addSource(track.id, { label: 'Liked Tracks', href: '/library' });
                            }
                        }

                        // Get tracks from user playlists
                        const userPlaylists = await db.getPlaylists(true);
                        for (const playlist of userPlaylists) {
                            if (playlist.tracks && Array.isArray(playlist.tracks)) {
                                for (const track of playlist.tracks) {
                                    if (isTrackByArtist(track)) {
                                        if (!seenIds.has(track.id)) {
                                            seenIds.add(track.id);
                                            libraryTracks.push(track);
                                        }
                                        const label = playlist.name || playlist.title || 'Playlist';
                                        addSource(track.id, {
                                            label,
                                            href: `/userplaylist/${playlist.id}`,
                                        });
                                    }
                                }
                            }
                        }

                        // Sort alphabetically by title
                        libraryTracks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

                        if (libraryTracks.length > 0) {
                            inLibrarySection.style.display = 'block';
                            await this.renderListWithTracks(inLibraryContainer, libraryTracks, true);

                            // Inject source labels into each track's .artist div
                            const trackElements = inLibraryContainer.querySelectorAll('.track-item');
                            trackElements.forEach((el, idx) => {
                                const track = libraryTracks[idx];
                                if (!track) return;
                                const sources = trackSourceMap.get(track.id);
                                if (!sources || sources.length === 0) return;
                                const artistDiv = el.querySelector('.track-item-details .artist');
                                if (!artistDiv) return;

                                // Extract artist name and year from existing content
                                const artistLinks = artistDiv.querySelectorAll('.artist-link');
                                const artistNames = Array.from(artistLinks)
                                    .map((a) => a.textContent)
                                    .join(', ');
                                const truncatedArtist =
                                    artistNames.length > 15 ? artistNames.slice(0, 20) + '…' : artistNames;

                                // Extract year from text content (pattern: " • 2024")
                                const fullText = artistDiv.textContent;
                                const yearMatch = fullText.match(/\s•\s(\d{4})/);
                                const yearText = yearMatch ? ` • ${yearMatch[1]}` : '';

                                // Build source content
                                const sourceSpan = document.createElement('span');
                                sourceSpan.className = 'library-source';

                                const labelSpan = document.createElement('span');
                                labelSpan.className = 'library-source-label';
                                labelSpan.textContent = '· Source:\u00a0';

                                const linkSpan = document.createElement('span');
                                linkSpan.className = 'library-source-link';

                                sourceSpan.style.cursor = 'pointer';
                                sourceSpan.appendChild(labelSpan);
                                sourceSpan.appendChild(linkSpan);

                                if (sources.length === 1) {
                                    const srcLabel =
                                        sources[0].label.length > 15
                                            ? sources[0].label.slice(0, 15) + '…'
                                            : sources[0].label;
                                    linkSpan.textContent = srcLabel;
                                    sourceSpan.addEventListener('click', (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        navigate(sources[0].href);
                                    });
                                } else {
                                    linkSpan.textContent = 'Multiple Playlists';
                                    sourceSpan.addEventListener('click', (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();

                                        const modal = document.getElementById('goto-playlist-modal');
                                        const list = document.getElementById('goto-playlist-list');
                                        const cancelBtn = document.getElementById('goto-playlist-cancel');
                                        const overlay = modal.querySelector('.modal-overlay');

                                        list.innerHTML = '';
                                        sources.forEach((s) => {
                                            const option = document.createElement('div');
                                            option.className = 'modal-option';
                                            option.dataset.href = s.href;
                                            const span = document.createElement('span');
                                            span.textContent = s.label;
                                            option.appendChild(span);
                                            list.appendChild(option);
                                        });

                                        const closeModal = () => {
                                            modal.classList.remove('active');
                                        };

                                        list.onclick = (ev) => {
                                            const option = ev.target.closest('.modal-option');
                                            if (!option) return;
                                            const href = option.dataset.href;
                                            closeModal();
                                            if (href) navigate(href);
                                        };

                                        cancelBtn.onclick = closeModal;
                                        overlay.onclick = closeModal;
                                        modal.classList.add('active');
                                    });
                                }

                                // Rebuild artist div with structured layout
                                artistDiv.innerHTML = '';
                                artistDiv.classList.add('library-artist-flex');

                                const artistNameSpan = document.createElement('span');
                                artistNameSpan.className = 'library-artist-name';
                                artistNameSpan.textContent = truncatedArtist;

                                const yearSpan = document.createElement('span');
                                yearSpan.className = 'library-year';
                                yearSpan.textContent = yearText;

                                artistDiv.appendChild(artistNameSpan);
                                artistDiv.appendChild(yearSpan);
                                artistDiv.appendChild(sourceSpan);
                            });
                        } else {
                            inLibrarySection.style.display = 'none';
                        }
                    } catch (err) {
                        console.warn('Failed to load library tracks for artist:', err);
                        inLibrarySection.style.display = 'none';
                    }
                };

                // Initial load
                await refreshInLibrary().then(() => {
                    inLibraryContainer.hidden = true;
                });

                // Setup chevron toggle (once)
                const toggle = document.getElementById('in-library-toggle');
                const chevron = document.getElementById('in-library-chevron');
                if (toggle) {
                    toggle.onclick = () => {
                        const isOpen = !inLibraryContainer.hidden;
                        inLibraryContainer.hidden = isOpen;
                        toggle.setAttribute('aria-expanded', String(!isOpen));
                        if (chevron) {
                            chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
                        }
                    };
                }

                // Real-time updates: refresh when favorites or playlists change
                let refreshTimeout;
                const debouncedRefresh = () => {
                    clearTimeout(refreshTimeout);
                    refreshTimeout = setTimeout(() => refreshInLibrary(), 300);
                };

                // Cleanup previous listeners before attaching new ones
                const cleanupOnNav = () => {
                    window.removeEventListener('favorites-changed', debouncedRefresh);
                    window.removeEventListener('playlist-tracks-changed', debouncedRefresh);
                    window.removeEventListener('popstate', cleanupOnNav);
                };
                cleanupOnNav();

                window.addEventListener('favorites-changed', debouncedRefresh);
                window.addEventListener('playlist-tracks-changed', debouncedRefresh);
                window.addEventListener('popstate', cleanupOnNav, { once: true });
            }

            // Update header like button
            const artistLikeBtn = document.getElementById('like-artist-btn');
            if (artistLikeBtn) {
                const isLiked = await db.isFavorite('artist', artist.id);
                artistLikeBtn.innerHTML = this.createHeartIcon(isLiked);
                artistLikeBtn.classList.toggle('active', isLiked);
            }

            // Render Albums
            albumsContainer.innerHTML = artist.albums.length
                ? artist.albums.map((album) => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            // Render EPs and Singles
            if (epsContainer && epsSection) {
                if (artist.eps && artist.eps.length > 0) {
                    epsContainer.innerHTML = artist.eps.map((album) => this.createAlbumCardHTML(album)).join('');
                    epsSection.style.display = 'block';

                    for (const album of artist.eps) {
                        const el = epsContainer.querySelector(`[data-album-id="${album.id}"]`);
                        if (el) {
                            trackDataStore.set(el, album);
                            await this.updateLikeState(el, 'album', album.id);
                        }
                    }
                } else {
                    epsSection.style.display = 'none';
                }
            }

            for (const album of artist.albums) {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    await this.updateLikeState(el, 'album', album.id);
                }
            }

            const videosSection = document.getElementById('artist-section-videos');
            const videosContainer = document.getElementById('artist-detail-videos');
            if (videosSection && videosContainer) {
                if (artist.videos && artist.videos.length > 0) {
                    videosContainer.innerHTML = artist.videos.map((video) => this.createVideoCardHTML(video)).join('');
                    videosSection.style.display = 'block';

                    for (const video of artist.videos) {
                        const el = videosContainer.querySelector(`[data-video-id="${video.id}"]`);
                        if (el) {
                            trackDataStore.set(el, video);
                            await this.updateLikeState(el, 'track', video.id);
                        }
                    }
                } else {
                    videosSection.style.display = 'none';
                }
            }

            // Check for unreleased projects
            const unreleasedSection = document.getElementById('artist-section-unreleased');
            const unreleasedContainer = document.getElementById('artist-detail-unreleased');
            const loadUnreleasedBtn = document.getElementById('load-unreleased-btn');
            const loadUnreleasedSection = document.getElementById('artist-section-load-unreleased');
            if (unreleasedSection && unreleasedContainer && loadUnreleasedBtn && loadUnreleasedSection) {
                // Initially hide the unreleased section
                unreleasedSection.style.display = 'none';
                loadUnreleasedSection.style.display = 'none';

                // Check if artist has unreleased projects
                const trackerArtist = findTrackerArtistByName(artist.name);
                if (trackerArtist) {
                    // Show the load button section
                    loadUnreleasedSection.style.display = 'block';

                    // Add click handler to load and display unreleased projects
                    loadUnreleasedBtn.onclick = async () => {
                        loadUnreleasedBtn.disabled = true;
                        loadUnreleasedBtn.textContent = 'Loading...';

                        try {
                            const unreleasedData = await getArtistUnreleasedProjects(artist.name);
                            if (unreleasedData && unreleasedData.eras.length > 0) {
                                const { artist: trackerArtistData, sheetId, eras } = unreleasedData;

                                unreleasedContainer.innerHTML = eras
                                    .map((e) => {
                                        let trackCount = 0;
                                        if (e.data) {
                                            Object.values(e.data).forEach((songs) => {
                                                if (songs && songs.length) trackCount += songs.length;
                                            });
                                        }
                                        return createProjectCardHTML(e, trackerArtistData, sheetId, trackCount);
                                    })
                                    .join('');

                                unreleasedSection.style.display = 'block';
                                loadUnreleasedBtn.style.display = 'none';

                                // Add click handlers
                                const player = this.player;
                                unreleasedContainer.querySelectorAll('.card').forEach((card) => {
                                    const eraName = decodeURIComponent(card.dataset.trackerProjectId);
                                    const era = eras.find((e) => e.name === eraName);
                                    if (!era) return;

                                    card.onclick = (e) => {
                                        if (e.target.closest('.card-play-btn')) {
                                            e.stopPropagation();
                                            let eraTracks = [];
                                            if (era.data) {
                                                Object.values(era.data).forEach((songs) => {
                                                    if (songs && songs.length) {
                                                        songs.forEach((song) => {
                                                            const track = createTrackFromSong(
                                                                song,
                                                                era,
                                                                trackerArtistData.name,
                                                                eraTracks.length,
                                                                sheetId
                                                            );
                                                            eraTracks.push(track);
                                                        });
                                                    }
                                                });
                                            }
                                            const availableTracks = eraTracks.filter((t) => !t.unavailable);
                                            if (availableTracks.length > 0) {
                                                player.setQueue(availableTracks, 0);
                                                player.playTrackFromQueue();
                                            }
                                        } else if (e.target.closest('.card-menu-btn')) {
                                            e.stopPropagation();
                                        } else {
                                            navigate(`/unreleased/${sheetId}/${encodeURIComponent(era.name)}`);
                                        }
                                    };
                                });
                            } else {
                                loadUnreleasedBtn.textContent = 'No unreleased projects';
                            }
                        } catch (error) {
                            console.error('Failed to load unreleased projects:', error);
                            loadUnreleasedBtn.textContent = 'Failed to load';
                            loadUnreleasedBtn.disabled = false;
                        }
                    };
                }
            }

            recentActivityManager.addArtist(artist);

            document.title = artist.name;
        } catch (error) {
            console.error('Failed to load artist:', error);
            tracksContainer.innerHTML = albumsContainer.innerHTML = createPlaceholder(
                `Could not load artist details. ${error.message}`
            );
        }
    }

    createSocialLinkHTML(link) {
        const url = link.url;

        if (url.includes('tidal.com')) return '';

        let icon = SVG_GLOBE(24);
        let title = 'Website';

        if (url.includes('twitter.com') || url.includes('x.com')) {
            icon = SVG_TWITTER(24);
            title = 'Twitter';
        } else if (url.includes('instagram.com')) {
            icon = SVG_INSTAGRAM(24);
            title = 'Instagram';
        } else if (url.includes('facebook.com')) {
            icon = SVG_FACEBOOK(24);
            title = 'Facebook';
        } else if (url.includes('youtube.com')) {
            icon = SVG_YOUTUBE(24);
            title = 'YouTube';
        } else if (url.includes('spotify.com') || url.includes('open.spotify.com')) {
            icon = SVG_LINK(24);
            title = 'Spotify';
        } else if (url.includes('soundcloud.com')) {
            icon = SVG_SOUNDCLOUD(24);
            title = 'SoundCloud';
        } else if (url.includes('apple.com')) {
            icon = SVG_APPLE(24);
            title = 'Apple Music';
        }

        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="social-link" title="${title}">${icon}</a>`;
    }

    async renderRecentPage() {
        await this.showPage('recent');
        const container = document.getElementById('recent-tracks-container');
        const clearBtn = document.getElementById('clear-history-btn');
        container.innerHTML = this.createSkeletonTracks(10, true);

        try {
            const history = await db.getHistory();

            // Show/hide clear button based on whether there's history
            if (clearBtn) {
                clearBtn.style.display = history.length > 0 ? 'flex' : 'none';
            }

            if (history.length === 0) {
                container.innerHTML = createPlaceholder("You haven't played any tracks yet.");
                return;
            }

            // Group by date
            const groups = {};
            const today = new Date().setHours(0, 0, 0, 0);
            const yesterday = new Date(today - 86400000).setHours(0, 0, 0, 0);

            history.forEach((item) => {
                const date = new Date(item.timestamp);
                const dayStart = new Date(date).setHours(0, 0, 0, 0);

                let label;
                if (dayStart === today) label = 'Today';
                else if (dayStart === yesterday) label = 'Yesterday';
                else
                    label = date.toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

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
                await this.renderListWithTracks(tempContainer, tracks, true);

                // Move children to main container
                while (tempContainer.firstChild) {
                    container.appendChild(tempContainer.firstChild);
                }
            }

            // Setup clear button handler
            if (clearBtn) {
                clearBtn.onclick = async () => {
                    if (confirm('Clear all recently played tracks? This cannot be undone.')) {
                        try {
                            await db.clearHistory();
                            await syncManager.clearHistory();
                            container.innerHTML = createPlaceholder("You haven't played any tracks yet.");
                            clearBtn.style.display = 'none';
                        } catch (err) {
                            console.error('Failed to clear history:', err);
                            alert('Failed to clear history');
                        }
                    }
                };
            }
        } catch (error) {
            console.error('Failed to load history:', error);
            container.innerHTML = createPlaceholder('Failed to load history.');
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    async renderUnreleasedPage() {
        await this.showPage('unreleased');
        const container = document.getElementById('unreleased-content');
        await renderUnreleasedTrackerPage(container);
    }

    async renderTrackerArtistPage(sheetId) {
        await this.showPage('tracker-artist');
        const container = document.getElementById('tracker-artist-projects-container');
        await renderTrackerArtistContent(sheetId, container);
    }

    async renderTrackerProjectPage(sheetId, projectName) {
        await this.showPage('album'); // Use album page template
        const container = document.getElementById('album-detail-tracklist');
        await renderTrackerProjectContent(sheetId, projectName, container, this);
    }

    async renderTrackerTrackPage(trackId) {
        await this.showPage('album'); // Use album page template
        const container = document.getElementById('album-detail-tracklist');
        await renderTrackerTrackContent(trackId, container, this);
    }

    /**
     *
     * @param {*} playlist
     * @param {*} isOwned
     * @param {*} tracks
     * @param {*} showShare
     * @param {() => Promise<void> | undefined} onSort
     * @param {*} getCurrentSort
     */
    async updatePlaylistHeaderActions(
        playlist,
        isOwned,
        tracks,
        showShare = false,
        onSort = null,
        getCurrentSort = null
    ) {
        const actionsDiv = document.getElementById('page-playlist').querySelector('.detail-header-actions');

        // Cleanup existing dynamic buttons
        [
            'shuffle-playlist-btn',
            'edit-playlist-btn',
            'delete-playlist-btn',
            'share-playlist-btn',
            'sort-playlist-btn',
        ].forEach((id) => {
            const btn = actionsDiv.querySelector(`#${id}`);
            if (btn) btn.remove();
        });

        const fragment = document.createDocumentFragment();

        // Shuffle
        const shuffleBtn = document.createElement('button');
        shuffleBtn.id = 'shuffle-playlist-btn';
        shuffleBtn.className = 'btn-primary';
        shuffleBtn.innerHTML = `${SVG_SHUFFLE(20)}<span>Shuffle</span>`;
        shuffleBtn.onclick = () => {
            const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
            this.player.setQueue(shuffledTracks, 0);
            this.player.playTrackFromQueue();
        };

        // Sort button (always available if onSort is provided)
        let sortBtn = null;
        if (onSort) {
            sortBtn = document.createElement('button');
            sortBtn.id = 'sort-playlist-btn';
            sortBtn.className = 'btn-secondary';
            sortBtn.innerHTML = `${SVG_SORT(20)}<span>Sort</span>`;

            sortBtn.onclick = async (e) => {
                e.stopPropagation();
                const menu = document.getElementById('sort-menu');

                // Show "Date Added" options only if tracks have addedAt
                const hasAddedDate = tracks.some((t) => t.addedAt);
                menu.querySelectorAll('.requires-added-date').forEach((opt) => {
                    opt.style.display = hasAddedDate ? '' : 'none';
                });

                // Highlight current sort option
                const currentSortType = getCurrentSort ? getCurrentSort() : 'custom';
                menu.querySelectorAll('li').forEach((opt) => {
                    opt.classList.toggle('sort-active', opt.dataset.sort === currentSortType);
                });

                const rect = sortBtn.getBoundingClientRect();
                menu.style.top = `${rect.bottom + 5}px`;
                menu.style.left = `${rect.left}px`;
                menu.style.display = 'block';

                const closeMenu = () => {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closeMenu);
                };

                const handleSort = async (ev) => {
                    const li = ev.target.closest('li');
                    if (li && li.dataset.sort) {
                        trackChangeSort(li.dataset.sort);
                        await onSort(li.dataset.sort);
                        closeMenu();
                    }
                };

                menu.onclick = handleSort;

                setTimeout(() => document.addEventListener('click', closeMenu), 0);
            };
        }

        // Edit/Delete (Owned Only)
        if (isOwned) {
            const editBtn = document.createElement('button');
            editBtn.id = 'edit-playlist-btn';
            editBtn.className = 'btn-secondary';
            editBtn.innerHTML = `${SVG_SQUARE_PEN(24)}<span>Edit</span>`;
            fragment.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.id = 'delete-playlist-btn';
            deleteBtn.className = 'btn-secondary danger';
            deleteBtn.innerHTML = `${SVG_BIN(24)}<span>Delete</span>`;
            fragment.appendChild(deleteBtn);
        }

        // Share (User Playlists Only)
        if (showShare || (isOwned && playlist.isPublic)) {
            const shareBtn = document.createElement('button');
            shareBtn.id = 'share-playlist-btn';
            shareBtn.className = 'btn-secondary';
            shareBtn.innerHTML = `${SVG_SHARE(20)}<span>Share</span>`;

            shareBtn.onclick = () => {
                const url = getShareUrl(`/userplaylist/${playlist.id || playlist.uuid}`);
                navigator.clipboard
                    .writeText(url)
                    .then(() => alert('Link copied to clipboard!'))
                    .catch(console.error);
            };
            fragment.appendChild(shareBtn);
        }

        // Insert buttons in the correct order: Play, Shuffle, Download, Sort, Like, Edit/Delete/Share
        const dlBtn = actionsDiv.querySelector('#download-playlist-btn');
        const likeBtn = actionsDiv.querySelector('#like-playlist-btn');

        if (dlBtn) {
            // We want Shuffle first, then Edit/Delete/Share.
            // But Download is usually first or second.
            // In renderPlaylistPage: Play, Download, Like.
            // We want Shuffle after Play? Or after Download?
            // Previous code: actionsDiv.insertBefore(shuffleBtn, dlBtn); => Shuffle before Download.
            // Then appended others.

            // Let's just append everything for now to keep it simple, or insert Shuffle specifically.
            // The Play button is static. Download is static.

            // If we want Shuffle before Download:
            // fragment has Shuffle, Edit, Delete, Share.
            // If we insert fragment before Download, all go before Download.
            // That might change the order.
            // Previous order: Shuffle (before Download), then Edit/Delete/Share (appended = after Like).

            // Let's split fragment?
            // Or just use append for all.
            // The user didn't complain about order, but consistency is good.
            // "Fix popup buttons" was the request.

            // Let's stick to appending for now to minimize visual layout shifts from previous (where Edit/Delete were appended).
            // Shuffle was inserted before Download.
            actionsDiv.insertBefore(shuffleBtn, dlBtn);
            // Insert Sort after Download, before Like
            if (sortBtn && likeBtn) {
                actionsDiv.insertBefore(sortBtn, likeBtn);
            } else if (sortBtn) {
                actionsDiv.appendChild(sortBtn);
            }

            // Append Edit/Delete/Share buttons after Like
            while (fragment.firstChild) {
                actionsDiv.appendChild(fragment.firstChild);
            }
        } else {
            // If no Download button, just append everything
            actionsDiv.appendChild(shuffleBtn);
            if (sortBtn) actionsDiv.appendChild(sortBtn);
            while (fragment.firstChild) {
                actionsDiv.appendChild(fragment.firstChild);
            }
        }
    }

    enableTrackReordering(container, tracks, playlistId, syncManager) {
        // Clone to remove old listeners
        const newContainer = container.cloneNode(true);
        if (container.parentNode) {
            container.parentNode.replaceChild(newContainer, container);
        }
        container = newContainer;

        let draggedElement = null;
        let draggedIndex = -1;
        let trackItems = Array.from(container.querySelectorAll('.track-item'));

        trackItems.forEach((item, index) => {
            // Re-bind data to cloned elements
            if (tracks[index]) {
                trackDataStore.set(item, tracks[index]);
            }
            item.draggable = true;
            item.dataset.index = index;
        });

        const dragStart = (e) => {
            draggedElement = e.target.closest('.track-item');
            if (!draggedElement) return;

            draggedIndex = parseInt(draggedElement.dataset.index);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedIndex);
            draggedElement.classList.add('dragging');
        };

        const dragEnd = () => {
            if (draggedElement) {
                draggedElement.classList.remove('dragging');
                draggedElement = null;
            }
        };

        const dragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (!draggedElement) return;

            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement === draggedElement) return;

            if (afterElement) {
                container.insertBefore(draggedElement, afterElement);
            } else {
                container.appendChild(draggedElement);
            }
        };

        const drop = async (e) => {
            e.preventDefault();

            if (!draggedElement) return;

            try {
                // Get new order from DOM
                const newTrackItems = Array.from(container.querySelectorAll('.track-item'));
                const newTracks = newTrackItems.map((item) => {
                    const originalIndex = parseInt(item.dataset.index);
                    return tracks[originalIndex];
                });

                newTrackItems.forEach((item, index) => {
                    item.dataset.index = index;
                });

                tracks.splice(0, tracks.length, ...newTracks);

                // Save to DB
                const updatedPlaylist = await db.updatePlaylistTracks(playlistId, newTracks);
                syncManager.syncUserPlaylist(updatedPlaylist, 'update');

                draggedElement = null;
                draggedIndex = -1;
            } catch (error) {
                console.error('Error updating playlist tracks:', error);
                if (draggedElement) {
                    draggedElement.classList.remove('dragging');
                    draggedElement = null;
                }
                draggedIndex = -1;
            }
        };

        container.addEventListener('dragstart', dragStart);
        container.addEventListener('dragend', dragEnd);
        container.addEventListener('dragover', dragOver);
        container.addEventListener('drop', drop);

        // Cache function to avoid recreating
        function getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.track-item:not(.dragging)')];

            return draggableElements.reduce(
                (closest, child) => {
                    const box = child.getBoundingClientRect();
                    const offset = y - box.top - box.height / 2;
                    if (offset < 0 && offset > closest.offset) {
                        return { offset: offset, element: child };
                    } else {
                        return closest;
                    }
                },
                { offset: Number.NEGATIVE_INFINITY }
            ).element;
        }
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.track-item:not(.dragging)')];

        return draggableElements.reduce(
            (closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            },
            { offset: Number.NEGATIVE_INFINITY }
        ).element;
    }

    renderApiSettings() {
        const container = document.getElementById('api-instance-list');
        Promise.all([this.api.settings.getInstances('api'), this.api.settings.getInstances('streaming')])
            .then(([apiInstances, streamingInstances]) => {
                const renderGroup = (instances, type) => {
                    if (!instances || instances.length === 0) return '';

                    const listHtml = instances
                        .map((instance, index) => {
                            const isObject = instance && typeof instance === 'object';
                            const instanceUrl = isObject ? instance.url || '' : String(instance || '');
                            const instanceName = isObject
                                ? instance.name || instance.displayName || instance.id || instanceUrl
                                : instanceUrl;
                            const instanceVersion = isObject && instance.version ? String(instance.version) : '';
                            const isUser = isObject && instance.isUser;
                            const safeName = escapeHtml(instanceName || 'Unknown instance');
                            const safeUrl = escapeHtml(instanceUrl || '');
                            const safeVersion = escapeHtml(instanceVersion);

                            return `
                        <li data-index="${index}" data-type="${type}" data-url="${safeUrl}">
                            <div style="flex: 1; min-width: 0;">
                                <div class="instance-url">${safeName} ${isUser ? '<span style="font-size: 0.6rem; opacity: 0.7; background: var(--muted); padding: 1px 4px; border-radius: 3px; margin-left: 4px; vertical-align: middle;">U</span>' : ''}</div>
                                ${safeUrl && safeUrl !== safeName ? `<div style="font-size: 0.8rem; color: var(--muted-foreground); margin-top: 0.15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeUrl}</div>` : ''}
                                ${safeVersion ? `<div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.1rem;">v${safeVersion}</div>` : ''}
                            </div>
                            <div class="controls">
                                ${
                                    isUser
                                        ? `
                                <button class="delete-instance" title="Delete Instance">
                                    ${SVG_TRASH(16)}
                                </button>`
                                        : ''
                                }
                            </div>
                        </li>
                    `;
                        })
                        .join('');

                    return `
                    <li class="group-header" style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; padding: 1rem 0 0.5rem; background: transparent; border: none;">
                        <span>${type === 'api' ? 'API Instances' : 'Streaming Instances'}</span>
                        <button class="add-instance" data-type="${type}" title="Add Custom Instance" style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer; pointer-events: auto;">
                            Add
                        </button>
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
            })
            .catch(console.error);
    }

    async renderTrackPage(trackId, provider = null) {
        await this.showPage('track');

        document.body.classList.add('sidebar-collapsed');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = SVG_RIGHT_ARROW(20);
        }

        const imageEl = document.getElementById('track-detail-image');
        const titleEl = document.getElementById('track-detail-title');
        const artistEl = document.getElementById('track-detail-artist');
        const albumEl = document.getElementById('track-detail-album');
        const yearEl = document.getElementById('track-detail-year');
        const albumSection = document.getElementById('track-album-section');
        const albumTracksContainer = document.getElementById('track-detail-album-tracks');
        const similarSection = document.getElementById('track-similar-section');

        const playBtn = document.getElementById('play-track-btn');
        const likeBtn = document.getElementById('like-track-btn');

        imageEl.src = '';
        imageEl.style.backgroundColor = 'var(--muted)';
        titleEl.innerHTML = '<div class="skeleton" style="height: 48px; width: 300px; max-width: 90%;"></div>';
        artistEl.innerHTML = '<div class="skeleton" style="height: 16px; width: 100px;"></div>';
        albumEl.innerHTML = '';
        yearEl.innerHTML = '';
        albumTracksContainer.innerHTML = this.createSkeletonTracks(5, false);
        albumSection.style.display = 'none';
        similarSection.style.display = 'none';

        if (!trackId || trackId === 'undefined' || trackId === 'null') {
            titleEl.textContent = 'Invalid Track ID';
            artistEl.innerHTML = '';
            return;
        }

        try {
            let track;
            track = await this.api.getTrackMetadata(trackId);
            this.currentTrackPageId = track.id;

            let videoCoverUrl = track.videoUrl || track.videoCoverUrl || track.album?.videoCoverUrl || null;

            if (!videoCoverUrl && (track.album || track.type === 'video')) {
                const fetchArtwork = () => {
                    this.api.getVideoArtwork(track.title, getTrackArtists(track)).then(async (result) => {
                        if (result && this.currentPage === 'track' && this.currentTrackPageId === track.id) {
                            const url = result.videoUrl || result.hlsUrl;
                            if (!url) return;
                            track.album = track.album || {};
                            track.album.videoCoverUrl = url;
                            const currentImageEl = document.getElementById('track-detail-image');
                            if (currentImageEl && currentImageEl.tagName !== 'VIDEO') {
                                const video = document.createElement('video');
                                video.autoplay = true;
                                video.loop = true;
                                video.muted = true;
                                video.playsInline = true;
                                video.preload = 'auto';
                                video.className = currentImageEl.className;
                                video.id = currentImageEl.id;
                                video.style.opacity = '1';
                                video.poster = currentImageEl.src;

                                await this.setupHlsVideo(video, result, currentImageEl);
                                currentImageEl.replaceWith(video);
                            }
                        }
                    });
                };

                if (track.type === 'video') {
                    this.api
                        .getVideoStreamUrl(track.id)
                        .then(async (url) => {
                            if (url) {
                                track.videoUrl = url;
                                await this.renderTrackPage(trackId, provider);
                            } else {
                                fetchArtwork();
                            }
                        })
                        .catch(fetchArtwork);
                } else {
                    fetchArtwork();
                }
            }

            const coverUrl = videoCoverUrl || this.api.getCoverUrl(track.image || track.cover || track.album?.cover);

            if (videoCoverUrl) {
                if (imageEl.tagName !== 'VIDEO') {
                    const video = document.createElement('video');
                    video.autoplay = true;
                    video.loop = true;
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'auto';
                    video.className = imageEl.className;
                    video.id = imageEl.id;
                    await this.setupHlsVideo(video, videoCoverUrl, imageEl);
                    imageEl.replaceWith(video);
                } else {
                    await this.setupHlsVideo(imageEl, videoCoverUrl, null);
                }
            } else {
                if (imageEl.tagName === 'VIDEO') {
                    const img = document.createElement('img');
                    img.src = coverUrl;
                    img.className = imageEl.className;
                    img.id = imageEl.id;
                    imageEl.replaceWith(img);
                } else {
                    imageEl.src = coverUrl;
                }
            }
            imageEl.style.backgroundColor = '';

            this.setPageBackground(coverUrl);
            if (backgroundSettings.isEnabled() && track.album?.cover) {
                await this.extractAndApplyColor(this.api.getCoverUrl(track.album.cover, '80'));
            }

            const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
            const qualityBadge = createQualityBadgeHTML(track);
            titleEl.innerHTML = `${escapeHtml(track.title)} ${explicitBadge} ${qualityBadge}`;
            this.adjustTitleFontSize(titleEl, track.title);

            artistEl.innerHTML = getTrackArtistsHTML(track);

            if (track.album) {
                albumEl.innerHTML = `<a href="/album/${track.album.id}">${escapeHtml(track.album.title)}</a>`;
            }

            if (track.album?.releaseDate) {
                const date = new Date(track.album.releaseDate);
                if (!isNaN(date.getTime())) {
                    yearEl.textContent = date.getFullYear();
                }
            }

            playBtn.onclick = () => {
                this.player.setQueue([track], 0);
                this.player.playTrackFromQueue();
            };

            if (likeBtn) {
                const isLiked = await db.isFavorite('track', track.id);
                likeBtn.innerHTML = this.createHeartIcon(isLiked);
                likeBtn.classList.toggle('active', isLiked);
            }

            if (track.album?.id) {
                const { tracks } = await this.api.getAlbum(track.album.id);
                if (tracks && tracks.length > 0) {
                    albumSection.style.display = 'block';
                    await this.renderListWithTracks(albumTracksContainer, tracks, false);
                }
            }

            document.title = `${track.title} - ${getTrackArtists(track)}`;
        } catch (error) {
            console.error('Failed to load track:', error);
            titleEl.textContent = 'Track not found';
            artistEl.innerHTML = '';
        }
    }

    async renderPodcastsBrowsePage() {
        await this.showPage('podcasts-browse');
        const trendingContainer = document.getElementById('podcasts-trending-container');
        const recentContainer = document.getElementById('podcasts-recent-container');
        trendingContainer.innerHTML = this.createSkeletonCards(12, true);
        recentContainer.innerHTML = this.createSkeletonCards(12, true);

        try {
            const { podcastsAPI } = await import('./podcasts-api.js');
            const trendingResult = await podcastsAPI.getTrendingPodcasts({ max: 24 });
            if (trendingResult.items.length > 0) {
                trendingContainer.innerHTML = trendingResult.items
                    .map((podcast) => this.createPodcastCardHTML(podcast))
                    .join('');
                this.attachPodcastCardListeners(trendingContainer, trendingResult.items);
            } else {
                trendingContainer.innerHTML = createPlaceholder('No trending podcasts found.');
            }
        } catch (error) {
            console.error('Failed to load trending podcasts:', error);
            trendingContainer.innerHTML = createPlaceholder('Failed to load trending podcasts.');
        }

        document.title = 'Podcasts - Monochrome Music';
    }

    cleanupPodcastState() {
        this.podcastState = null;
    }

    async renderPodcastPage(podcastId) {
        this.cleanupPodcastState();
        await this.showPage('podcasts');

        this.podcastState = {
            id: podcastId,
            episodes: [],
            offset: 0,
            hasMore: true,
            isLoading: false,
        };

        const nameEl = document.getElementById('podcasts-detail-name');
        const metaEl = document.getElementById('podcasts-detail-meta');
        const imageEl = document.getElementById('podcasts-detail-image');
        const episodesContainer = document.getElementById('podcasts-episodes-container');

        nameEl.textContent = 'Loading...';
        metaEl.textContent = '';
        episodesContainer.innerHTML = this.createSkeletonTracks(8, true);

        try {
            const { podcastsAPI } = await import('./podcasts-api.js');
            const podcastResult = await podcastsAPI.getPodcastById(podcastId);

            if (podcastResult) {
                nameEl.textContent = podcastResult.title;
                metaEl.textContent = `${podcastResult.episodeCount} episodes • ${podcastResult.author}`;
                if (podcastResult.image) {
                    imageEl.src = podcastResult.image;
                    this.setPageBackground(podcastResult.image);
                }

                this.podcastState.podcastTitle = podcastResult.title;
                const _playBtn = document.getElementById('play-podcasts-btn');
            } else {
                this.podcastState.podcastTitle = 'Unknown Podcast';
            }

            document.title = `${podcastResult?.title || 'Podcast'} - Monochrome Music`;

            episodesContainer.innerHTML = '';
            await this.loadAllPodcastEpisodes();
        } catch (error) {
            console.error('Failed to load podcast:', error);
            nameEl.textContent = 'Podcast not found';
            episodesContainer.innerHTML = createPlaceholder('Failed to load podcast.');
        }
    }

    async loadAllPodcastEpisodes() {
        this.podcastState.isLoading = true;
        const episodesContainer = document.getElementById('podcasts-episodes-container');
        episodesContainer.innerHTML = this.createSkeletonTracks(8, true);

        try {
            const { podcastsAPI } = await import('./podcasts-api.js');
            const result = await podcastsAPI.getPodcastEpisodes(this.podcastState.id, {
                max: 10000,
            });

            this.podcastState.episodes = result.items;
            this.podcastState.hasMore = false;

            const podcastTitle = this.podcastState.podcastTitle || 'Unknown Podcast';
            const tracks = result.items.map((ep) => this.transformPodcastEpisodeToTrack(ep, podcastTitle));
            await this.renderListWithTracks(episodesContainer, tracks, true);

            const playBtn = document.getElementById('play-podcasts-btn');
            if (playBtn && result.items.length > 0) {
                playBtn.onclick = () => {
                    const tracksToPlay = this.podcastState.episodes.map((ep) =>
                        this.transformPodcastEpisodeToTrack(ep, podcastTitle)
                    );
                    if (this.player) {
                        this.player.setQueue(tracksToPlay, 0);
                        this.player.playTrackFromQueue();
                    }
                };
            }
        } catch (error) {
            console.error('Failed to load podcast episodes:', error);
            episodesContainer.innerHTML = createPlaceholder('Failed to load episodes.');
        }

        this.podcastState.isLoading = false;
    }

    async renderPodcastSearchResults(query) {
        const podcastsContainer = document.getElementById('search-podcasts-container');
        podcastsContainer.innerHTML = this.createSkeletonCards(12, true);

        try {
            const { podcastsAPI } = await import('./podcasts-api.js');
            const result = await podcastsAPI.searchPodcasts(query, { max: 20 });

            if (result.items.length > 0) {
                podcastsContainer.innerHTML = result.items
                    .map((podcast) => this.createPodcastCardHTML(podcast))
                    .join('');
                this.attachPodcastCardListeners(podcastsContainer, result.items);
            } else {
                podcastsContainer.innerHTML = createPlaceholder('No podcasts found.');
            }
        } catch (error) {
            console.error('Podcast search failed:', error);
            podcastsContainer.innerHTML = createPlaceholder('Failed to search podcasts.');
        }
    }

    createPodcastCardHTML(podcast) {
        const title = escapeHtml(podcast.title || 'Unknown Podcast');
        const author = escapeHtml(podcast.author || '');
        const image = podcast.image || '';
        const description = escapeHtml((podcast.description || '').substring(0, 120));
        const episodeCount = podcast.episodeCount || 0;

        return `
            <div class="card" data-podcast-id="${podcast.id}">
                <div class="card-image-container">
                    <img src="${image}" alt="${title}" loading="lazy" onerror="this.style.display='none'" />
                    <div class="card-image-placeholder" ${image ? 'style="display:none"' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><circle cx="50" cy="45" r="20" fill="%23666"/><rect x="35" y="70" width="30" height="15" rx="3" fill="%23666"/></svg>
                    </div>
                </div>
                <div class="card-info">
                    <h3 class="card-title">${title}</h3>
                    <p class="card-subtitle">${author}</p>
                    <p class="card-description">${description}${podcast.description?.length > 120 ? '...' : ''}</p>
                    <span class="card-meta">${episodeCount} episodes</span>
                </div>
            </div>
        `;
    }

    attachPodcastCardListeners(container, podcasts) {
        const cards = container.querySelectorAll('.card[data-podcast-id]');
        cards.forEach((card) => {
            const podcastId = card.dataset.podcastId;
            const podcast = podcasts.find((p) => p.id === podcastId);
            if (podcast) {
                card.addEventListener('click', () => {
                    navigate(`/podcasts/${podcastId}`);
                });
            }
        });
    }

    transformPodcastEpisodeToTrack(episode, podcastTitle = 'Unknown Podcast') {
        return {
            id: `podcast_${episode.id}`,
            title: episode.title,
            artist: { id: null, name: podcastTitle },
            artists: [{ id: null, name: podcastTitle }],
            album: {
                id: null,
                title: podcastTitle,
                cover: episode.image || episode.feedImage || '',
            },
            duration: episode.duration,
            explicit: episode.explicit,
            dateAdded: episode.datePublished,
            isPodcast: true,
            enclosureUrl: episode.enclosureUrl,
            enclosureType: episode.enclosureType,
            enclosureLength: episode.enclosureLength,
            episodeNumber: episode.episode,
            episodeType: episode.episodeType,
            season: episode.season,
            description: episode.description,
            podcastEpisode: episode,
        };
    }
}
