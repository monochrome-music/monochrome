//js/ui.js
import { showNotification } from './downloads.js';
import {
    SVG_PLAY,
    SVG_DOWNLOAD,
    SVG_MENU,
    SVG_HEART,
    SVG_VOLUME,
    SVG_MUTE,
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
import { openLyricsPanel } from './lyrics.js';
import {
    recentActivityManager,
    backgroundSettings,
    dynamicColorSettings,
    cardSettings,
    visualizerSettings,
    homePageSettings,
    fontSettings,
    contentBlockingSettings,
} from './storage.js';
import { db } from './db.js';
import { getVibrantColorFromImage } from './vibrant-color.js';
import { syncManager } from './accounts/pocketbase.js';
import { Visualizer } from './visualizer.js';
import { navigate } from './router.js';
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

fontSettings.applyFont();
fontSettings.applyFontSize();

const SVG_GLOBE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
const SVG_INSTAGRAM =
    '<svg width="64px" height="64px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke=""><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18ZM12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16Z" fill="#9E9E9E"></path> <path d="M18 5C17.4477 5 17 5.44772 17 6C17 6.55228 17.4477 7 18 7C18.5523 7 19 6.55228 19 6C19 5.44772 18.5523 5 18 5Z" fill="#9E9E9E"></path> <path fill-rule="evenodd" clip-rule="evenodd" d="M1.65396 4.27606C1 5.55953 1 7.23969 1 10.6V13.4C1 16.7603 1 18.4405 1.65396 19.7239C2.2292 20.8529 3.14708 21.7708 4.27606 22.346C5.55953 23 7.23969 23 10.6 23H13.4C16.7603 23 18.4405 23 19.7239 22.346C20.8529 21.7708 21.7708 20.8529 22.346 19.7239C23 18.4405 23 16.7603 23 13.4V10.6C23 7.23969 23 5.55953 22.346 4.27606C21.7708 3.14708 20.8529 2.2292 19.7239 1.65396C18.4405 1 16.7603 1 13.4 1H10.6C7.23969 1 5.55953 1 4.27606 1.65396C3.14708 2.2292 2.2292 3.14708 1.65396 4.27606ZM13.4 3H10.6C8.88684 3 7.72225 3.00156 6.82208 3.0751C5.94524 3.14674 5.49684 3.27659 5.18404 3.43597C4.43139 3.81947 3.81947 4.43139 3.43597 5.18404C3.27659 5.49684 3.14674 5.94524 3.0751 6.82208C3.00156 7.72225 3 8.88684 3 10.6V13.4C3 15.1132 3.00156 16.2777 3.0751 17.1779C3.14674 18.0548 3.27659 18.5032 3.43597 18.816C3.81947 19.5686 4.43139 20.1805 5.18404 20.564C5.49684 20.7234 5.94524 20.8533 6.82208 20.9249C7.72225 20.9984 8.88684 21 10.6 21H13.4C15.1132 21 16.2777 20.9984 17.1779 20.9249C18.0548 20.8533 18.5032 20.7234 18.816 20.564C19.5686 20.1805 20.1805 19.5686 20.564 18.816C20.7234 18.5032 20.8533 18.0548 20.9249 17.1779C20.9984 16.2777 21 15.1132 21 13.4V10.6C21 8.88684 20.9984 7.72225 20.9249 6.82208C20.8533 5.94524 20.7234 5.49684 20.564 5.18404C20.1805 4.43139 19.5686 3.81947 18.816 3.43597C18.5032 3.27659 18.0548 3.14674 17.1779 3.0751C16.2777 3.00156 15.1132 3 13.4 3Z" fill="#9E9E9E"></path> </g></svg>';
const SVG_FACEBOOK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>';
const SVG_YOUTUBE =
    '<svg viewBox="0 -3 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="#000000"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>youtube [#9E9E9E168]</title> <desc>Created with Sketch.</desc> <defs> </defs> <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"> <g id="Dribbble-Light-Preview" transform="translate(-300.000000, -7442.000000)" fill="#9E9E9E"> <g id="icons" transform="translate(56.000000, 160.000000)"> <path d="M251.988432,7291.58588 L251.988432,7285.97425 C253.980638,7286.91168 255.523602,7287.8172 257.348463,7288.79353 C255.843351,7289.62824 253.980638,7290.56468 251.988432,7291.58588 M263.090998,7283.18289 C262.747343,7282.73013 262.161634,7282.37809 261.538073,7282.26141 C259.705243,7281.91336 248.270974,7281.91237 246.439141,7282.26141 C245.939097,7282.35515 245.493839,7282.58153 245.111335,7282.93357 C243.49964,7284.42947 244.004664,7292.45151 244.393145,7293.75096 C244.556505,7294.31342 244.767679,7294.71931 245.033639,7294.98558 C245.376298,7295.33761 245.845463,7295.57995 246.384355,7295.68865 C247.893451,7296.0008 255.668037,7296.17532 261.506198,7295.73552 C262.044094,7295.64178 262.520231,7295.39147 262.895762,7295.02447 C264.385932,7293.53455 264.28433,7285.06174 263.090998,7283.18289" id="youtube-[#9E9E9E168]"> </path> </g> </g> </g> </g></svg>';
const SVG_TWITTER =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>';
const SVG_LINK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const SVG_SOUNDCLOUD =
    '<svg fill="#9E9E9E" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" enable-background="new 0 0 512 512" xml:space="preserve" stroke="#9E9E9E"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g id="5151e0c8492e5103c096af88a50061c5"> <path display="inline" d="M25.173,355.106c1.076,0,1.946-0.849,2.117-2.067l5.717-44.884l-5.717-45.889 c-0.171-1.22-1.041-2.061-2.117-2.061c-1.091,0-1.982,0.862-2.125,2.061c0,0.007-5.026,45.889-5.026,45.889l5.026,44.876 C23.191,354.229,24.083,355.106,25.173,355.106z M8.328,336.058c0,0,0,0,0,0.007l0,0V336.058z M6.274,338.047 c1.041,0,1.875-0.813,2.053-1.982l4.42-27.909l-4.42-28.395c-0.171-1.169-1.012-1.981-2.053-1.981 c-1.062,0-1.896,0.819-2.046,1.996L0.5,308.155l3.729,27.896C4.378,337.227,5.212,338.047,6.274,338.047z M47.808,253.712 c-0.157-1.454-1.233-2.51-2.56-2.51c-1.354,0-2.424,1.063-2.566,2.51l-4.762,54.45l4.762,52.455 c0.143,1.461,1.212,2.509,2.566,2.509c1.326,0,2.402-1.048,2.552-2.495l5.425-52.469L47.808,253.712z M65.487,365.236 c1.568,0,2.852-1.269,3.001-2.944l0,0l5.119-54.123l-5.119-55.947c-0.149-1.675-1.433-2.944-3.001-2.944 c-1.583,0-2.873,1.27-3.001,2.951l-4.513,55.94l4.513,54.123C62.614,363.968,63.904,365.236,65.487,365.236z M85.89,366.127 c1.825,0,3.301-1.461,3.436-3.386l-0.007,0.007l4.827-54.571l-4.827-51.913c-0.128-1.918-1.604-3.372-3.429-3.372 c-1.839,0-3.315,1.454-3.429,3.387l-4.256,51.898l4.256,54.564C82.575,364.666,84.051,366.127,85.89,366.127z M114.848,308.198 l-4.527-84.436c-0.114-2.152-1.811-3.828-3.864-3.828s-3.764,1.676-3.864,3.828l-4,84.436l4,54.564 c0.1,2.124,1.811,3.813,3.864,3.813s3.75-1.689,3.864-3.828v0.015L114.848,308.198z M127.195,366.677 c2.303,0,4.185-1.868,4.299-4.264v0.036l4.228-54.244l-4.228-103.74c-0.114-2.395-1.996-4.27-4.299-4.27 c-2.317,0-4.213,1.875-4.313,4.27c0,0.008-3.735,103.74-3.735,103.74l3.743,54.229 C122.982,364.809,124.878,366.677,127.195,366.677z M148.09,191.112c-2.574,0-4.655,2.067-4.748,4.705 c0,0.008-3.472,112.402-3.472,112.402l3.479,53.666c0.085,2.616,2.167,4.677,4.741,4.677c2.552,0,4.641-2.061,4.741-4.698v0.036 l3.928-53.681l-3.928-112.409C152.73,193.173,150.642,191.112,148.09,191.112z M169.156,366.669c2.809,0,5.083-2.26,5.175-5.14 v0.035l3.622-53.338l-3.622-116.188c-0.093-2.887-2.366-5.146-5.175-5.146c-2.823,0-5.097,2.26-5.183,5.146l-3.223,116.188 l3.223,53.331C164.059,364.409,166.333,366.669,169.156,366.669z M190.378,366.619c3.065,0,5.532-2.452,5.611-5.589v0.043 l3.336-52.84l-3.336-113.229c-0.079-3.129-2.546-5.582-5.611-5.582c-3.072,0-5.546,2.46-5.617,5.582l-2.958,113.229l2.965,52.825 C184.832,364.167,187.306,366.619,190.378,366.619z M220.848,308.248l-3.03-109.108c-0.071-3.372-2.73-6.017-6.045-6.017 c-3.329,0-5.988,2.645-6.053,6.024l-2.702,109.093l2.702,52.49c0.064,3.344,2.724,5.988,6.053,5.988 c3.314,0,5.974-2.645,6.045-6.023v0.043L220.848,308.248z M233.33,366.826c3.515,0,6.423-2.901,6.48-6.466v0.043l2.737-52.148 l-2.737-129.824c-0.058-3.558-2.966-6.459-6.48-6.459c-3.521,0-6.431,2.901-6.487,6.459l-2.445,129.781 c0,0.079,2.445,52.184,2.445,52.184C226.899,363.925,229.809,366.826,233.33,366.826z M254.788,159.767 c-3.771,0-6.872,3.108-6.93,6.908l-2.83,141.595l2.83,51.385c0.058,3.75,3.158,6.851,6.93,6.851c3.764,0,6.865-3.101,6.922-6.9 v0.057l3.08-51.392l-3.08-141.602C261.653,162.875,258.552,159.767,254.788,159.767z M274.428,366.861 c0.157,0.015,173.098,0.101,174.224,0.101c34.718,0,62.849-28.146,62.849-62.863s-28.131-62.849-62.849-62.849 c-8.618,0-16.824,1.74-24.31,4.877c-4.997-56.646-52.512-101.089-110.448-101.089c-14.179,0-28.002,2.795-40.207,7.521 c-4.74,1.832-6.01,3.729-6.052,7.386c0,0.007,0,199.488,0,199.488C267.685,363.283,270.671,366.491,274.428,366.861z"> </path> </g> </g></svg>';
const SVG_APPLE =
    '<svg viewBox="-1.5 0 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="#000000"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>apple [#9E9E9E173]</title> <desc>Created with Sketch.</desc> <defs> </defs> <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"> <g id="Dribbble-Light-Preview" transform="translate(-102.000000, -7439.000000)" fill="#9E9E9E"> <g id="icons" transform="translate(56.000000, 160.000000)"> <path d="M57.5708873,7282.19296 C58.2999598,7281.34797 58.7914012,7280.17098 58.6569121,7279 C57.6062792,7279.04 56.3352055,7279.67099 55.5818643,7280.51498 C54.905374,7281.26397 54.3148354,7282.46095 54.4735932,7283.60894 C55.6455696,7283.69593 56.8418148,7283.03894 57.5708873,7282.19296 M60.1989864,7289.62485 C60.2283111,7292.65181 62.9696641,7293.65879 63,7293.67179 C62.9777537,7293.74279 62.562152,7295.10677 61.5560117,7296.51675 C60.6853718,7297.73474 59.7823735,7298.94772 58.3596204,7298.97372 C56.9621472,7298.99872 56.5121648,7298.17973 54.9134635,7298.17973 C53.3157735,7298.17973 52.8162425,7298.94772 51.4935978,7298.99872 C50.1203933,7299.04772 49.0738052,7297.68074 48.197098,7296.46676 C46.4032359,7293.98379 45.0330649,7289.44985 46.8734421,7286.3899 C47.7875635,7284.87092 49.4206455,7283.90793 51.1942837,7283.88393 C52.5422083,7283.85893 53.8153044,7284.75292 54.6394294,7284.75292 C55.4635543,7284.75292 57.0106846,7283.67793 58.6366882,7283.83593 C59.3172232,7283.86293 61.2283842,7284.09893 62.4549652,7285.8199 C62.355868,7285.8789 60.1747177,7287.09489 60.1989864,7289.62485" id="apple-[#9E9E9E173]"> </path> </g> </g> </g> </g></svg>';

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

export class UIRenderer {
    constructor(api, player) {
        this.api = api;
        this.player = player;
        this.currentTrack = null;
        this.searchAbortController = null;
        this.vibrantColorCache = new Map();
        this.visualizer = null;
        this.renderLock = false;

        // Listen for dynamic color reset events
        window.addEventListener('reset-dynamic-color', () => {
            this.resetVibrantColor();
        });

        // Listen for theme changes to re-apply vibrant colors
        window.addEventListener('theme-changed', () => {
            this.updateGlobalTheme();
        });
    }

    // Helper for Heart Icon
    createHeartIcon(filled = false) {
        if (filled) {
            return SVG_HEART.replace('class="heart-icon"', 'class="heart-icon filled"');
        }
        return SVG_HEART;
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

    setCurrentTrack(track) {
        this.currentTrack = track;
        this.updateGlobalTheme();

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
                    this.updateLikeState(likeBtn.parentElement, 'track', track.id);
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
                if (isLocal || isTracker) lyricsBtn.style.display = 'none';
                else lyricsBtn.style.removeProperty('display');
            }

            if (fsLikeBtn) {
                if (shouldHideLikes) {
                    fsLikeBtn.style.display = 'none';
                } else {
                    fsLikeBtn.style.display = 'flex';
                    this.updateLikeState(fsLikeBtn.parentElement, 'track', track.id);
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
        if (!text) return;
        if (text.length > 40) {
            element.classList.add('very-long-title');
        } else if (text.length > 25) {
            element.classList.add('long-title');
        }
    }

    createTrackItemHTML(track, index, showCover = false, hasMultipleDiscs = false, useTrackNumber = false) {
        const isUnavailable = track.isUnavailable;
        const isBlocked = contentBlockingSettings?.shouldHideTrack(track);
        const trackImageHTML = showCover
            ? this.getCoverHTML(track.album?.videoCover, track.album?.cover, 'Track Cover', 'track-item-cover')
            : '';

        let displayIndex;
        if (hasMultipleDiscs && !showCover) {
            const discNum = track.volumeNumber ?? track.discNumber ?? 1;
            displayIndex = `${discNum}-${track.trackNumber}`;
        } else if (useTrackNumber && track.trackNumber) {
            displayIndex = track.trackNumber;
        } else {
            displayIndex = index + 1;
        }

        const trackNumberHTML = `<div class="track-number">${showCover ? trackImageHTML : displayIndex}</div>`;
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
                ${SVG_MENU}
            </button>
        `;

        const blockedTitle = isBlocked
            ? `title="Blocked: ${contentBlockingSettings.isTrackBlocked(track.id) ? 'Track blocked' : contentBlockingSettings.isArtistBlocked(track.artist?.id) ? 'Artist blocked' : 'Album blocked'}"`
            : '';

        const classList = [
            'track-item',
            isCurrentTrack ? 'playing' : '',
            isUnavailable ? 'unavailable' : '',
            isBlocked ? 'blocked' : '',
        ]
            .filter(Boolean)
            .join(' ');

        return `
            <div class="${classList}" 
                 data-track-id="${track.id}" 
                 ${track.isLocal ? 'data-is-local="true"' : ''}
                 ${isUnavailable ? 'title="This track is currently unavailable"' : ''}
                 ${blockedTitle}>
                ${trackNumberHTML}
                <div class="track-item-info">
                    <div class="track-item-details">
                        <div class="title">
                            ${escapeHtml(trackTitle)}
                            ${explicitBadge}
                            ${qualityBadge}
                        </div>
                        <div class="artist">${getTrackArtistsHTML(track)}${yearDisplay}</div>
                    </div>
                </div>
                <div class="track-item-duration">${isUnavailable || isBlocked ? '--:--' : track.duration ? formatTime(track.duration) : '--:--'}</div>
                <div class="track-item-actions">
                    ${actionsHTML}
                </div>
            </div>
        `;
    }

    getCoverHTML(videoCover, cover, alt, className = 'card-image', loading = 'lazy') {
        const videoUrl = videoCover ? this.api.tidalAPI.getVideoCoverUrl(videoCover) : null;
        if (videoUrl) {
            return `<video src="${videoUrl}" class="${className}" alt="${alt}" autoplay loop muted playsinline></video>`;
        }
        return `<img src="${this.api.getCoverUrl(cover)}" class="${className}" alt="${alt}" loading="${loading}">`;
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
                ${SVG_PLAY}
            </button>
            <button class="card-menu-btn" data-action="card-menu" data-type="${type}" data-id="${id}" title="Menu">
                ${SVG_MENU}
            </button>
        `
                : '';

        const cardContent = `
            <div class="card-info">
                <h4 class="card-title">${title}</h4>
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
            href: `/album/${album.id}`,
            title: `${escapeHtml(album.title)} ${explicitBadge} ${qualityBadge}`,
            subtitle: `${escapeHtml(artistName)} • ${yearDisplay}${typeLabel}`,
            imageHTML: this.getCoverHTML(album.videoCover, album.cover, escapeHtml(album.title)),
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

    createArtistCardHTML(artist) {
        const isCompact = cardSettings.isCompactArtist();
        const isBlocked = contentBlockingSettings?.shouldHideArtist(artist);

        return this.createBaseCardHTML({
            type: 'artist',
            id: artist.id,
            href: `/artist/${artist.id}`,
            title: escapeHtml(artist.name),
            subtitle: '',
            imageHTML: `<img src="${this.api.getArtistPictureUrl(artist.picture)}" alt="${escapeHtml(artist.name)}" class="card-image" loading="lazy">`,
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

        // Toggle visibility based on input value
        const toggleVisibility = () => {
            clearBtn.style.display = inputElement.value.trim() ? 'flex' : 'none';
        };

        // Clear input on click
        const clearListener = () => {
            inputElement.value = '';
            inputElement.dispatchEvent(new Event('input'));
            inputElement.focus();
        };

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

    renderListWithTracks(container, tracks, showCover, append = false, useTrackNumber = false) {
        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');

        // Check if there are multiple discs in the tracks array
        const hasMultipleDiscs = tracks.some((t) => (t.volumeNumber || t.discNumber || 1) > 1);

        tempDiv.innerHTML = tracks
            .map((track, i) => this.createTrackItemHTML(track, i, showCover, hasMultipleDiscs, useTrackNumber))
            .join('');

        // Bind data to elements immediately using index, avoiding selector ambiguity
        Array.from(tempDiv.children).forEach((element, index) => {
            const track = tracks[index];
            if (element && track) {
                trackDataStore.set(element, track);
                // Async update for like button
                this.updateLikeState(element, 'track', track.id);
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

    updateFullscreenMetadata(track, nextTrack) {
        if (!track) return;
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const image = document.getElementById('fullscreen-cover-image');
        const title = document.getElementById('fullscreen-track-title');
        const artist = document.getElementById('fullscreen-track-artist');
        const nextTrackEl = document.getElementById('fullscreen-next-track');

        const videoCoverUrl = track.album?.videoCover
            ? this.api.tidalAPI.getVideoCoverUrl(track.album.videoCover, '1280')
            : null;
        const coverUrl = videoCoverUrl || this.api.getCoverUrl(track.album?.cover, '1280');

        const fsLikeBtn = document.getElementById('fs-like-btn');
        if (fsLikeBtn) {
            this.updateLikeState(fsLikeBtn.parentElement, 'track', track.id);
        }

        if (videoCoverUrl) {
            if (image.tagName === 'IMG') {
                const video = document.createElement('video');
                video.src = videoCoverUrl;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.id = image.id;
                video.className = image.className;
                image.replaceWith(video);
            }
        } else {
            if (image.tagName === 'VIDEO') {
                const img = document.createElement('img');
                img.src = coverUrl;
                img.id = image.id;
                img.className = image.className;
                image.replaceWith(img);
            }
        }

        const currentImage = document.getElementById('fullscreen-cover-image');
        if (currentImage.src !== coverUrl || !videoCoverUrl) {
            currentImage.src = coverUrl;
        }
        overlay.style.setProperty('--bg-image', `url('${coverUrl}')`);
        this.extractAndApplyColor(this.api.getCoverUrl(track.album?.cover, '80'));

        const qualityBadge = createQualityBadgeHTML(track);
        title.innerHTML = `${escapeHtml(track.title)} ${qualityBadge}`;
        artist.textContent = getTrackArtists(track);

        if (nextTrack) {
            nextTrackEl.style.display = 'flex';
            nextTrackEl.querySelector('.value').textContent = `${nextTrack.title} • ${getTrackArtists(nextTrack)}`;
        } else {
            nextTrackEl.style.display = 'none';
        }
    }

    async showFullscreenCover(track, nextTrack, lyricsManager, audioPlayer) {
        if (!track) return;
        if (window.location.hash !== '#fullscreen') {
            window.history.pushState({ fullscreen: true }, '', '#fullscreen');
        }
        const overlay = document.getElementById('fullscreen-cover-overlay');
        const nextTrackEl = document.getElementById('fullscreen-next-track');
        const lyricsToggleBtn = document.getElementById('toggle-fullscreen-lyrics-btn');

        this.updateFullscreenMetadata(track, nextTrack);

        if (nextTrack) {
            nextTrackEl.classList.remove('animate-in');
            void nextTrackEl.offsetWidth;
            nextTrackEl.classList.add('animate-in');
        } else {
            nextTrackEl.classList.remove('animate-in');
        }

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

        const playerBar = document.querySelector('.now-playing-bar');
        if (playerBar) playerBar.style.display = 'none';

        this.setupFullscreenControls(audioPlayer);

        overlay.style.display = 'flex';

        const startVisualizer = () => {
            if (!visualizerSettings.isEnabled()) {
                if (this.visualizer) this.visualizer.stop();
                return;
            }

            if (!this.visualizer && audioPlayer) {
                const canvas = document.getElementById('visualizer-canvas');
                if (canvas) {
                    this.visualizer = new Visualizer(canvas, audioPlayer);
                }
            }
            if (this.visualizer) {
                this.visualizer.start();
            }
        };

        if (localStorage.getItem('epilepsy-warning-dismissed') === 'true') {
            startVisualizer();
        } else {
            const modal = document.getElementById('epilepsy-warning-modal');
            if (modal) {
                modal.classList.add('active');

                const acceptBtn = document.getElementById('epilepsy-accept-btn');
                const cancelBtn = document.getElementById('epilepsy-cancel-btn');

                acceptBtn.onclick = () => {
                    modal.classList.remove('active');
                    localStorage.setItem('epilepsy-warning-dismissed', 'true');
                    startVisualizer();
                };
                cancelBtn.onclick = () => {
                    modal.classList.remove('active');
                    this.closeFullscreenCover();
                };
            } else {
                startVisualizer();
            }
        }
    }

    closeFullscreenCover() {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        overlay.style.display = 'none';

        const playerBar = document.querySelector('.now-playing-bar');
        if (playerBar) playerBar.style.removeProperty('display');

        if (this.fullscreenUpdateInterval) {
            cancelAnimationFrame(this.fullscreenUpdateInterval);
            this.fullscreenUpdateInterval = null;
        }

        if (this.visualizer) {
            this.visualizer.stop();
        }
    }

    setupFullscreenControls(audioPlayer) {
        const playBtn = document.getElementById('fs-play-pause-btn');
        const prevBtn = document.getElementById('fs-prev-btn');
        const nextBtn = document.getElementById('fs-next-btn');
        const shuffleBtn = document.getElementById('fs-shuffle-btn');
        const repeatBtn = document.getElementById('fs-repeat-btn');
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
            const isPaused = audioPlayer.paused;
            if (isPaused === lastPausedState) return;
            lastPausedState = isPaused;

            if (isPaused) {
                playBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            } else {
                playBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
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
                repeatBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>';
            } else {
                repeatBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
            }
        };

        // Progress bar with drag support
        let isFsSeeking = false;
        let wasFsPlaying = false;
        let lastFsSeekPosition = 0;

        const updateFsSeekUI = (position) => {
            if (!isNaN(audioPlayer.duration)) {
                progressFill.style.width = `${position * 100}%`;
                if (currentTimeEl) {
                    currentTimeEl.textContent = formatTime(position * audioPlayer.duration);
                }
            }
        };

        progressBar.addEventListener('mousedown', (e) => {
            isFsSeeking = true;
            wasFsPlaying = !audioPlayer.paused;
            if (wasFsPlaying) audioPlayer.pause();

            const rect = progressBar.getBoundingClientRect();
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            lastFsSeekPosition = pos;
            updateFsSeekUI(pos);
        });

        progressBar.addEventListener(
            'touchstart',
            (e) => {
                e.preventDefault();
                isFsSeeking = true;
                wasFsPlaying = !audioPlayer.paused;
                if (wasFsPlaying) audioPlayer.pause();

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
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = lastFsSeekPosition * audioPlayer.duration;
                    if (wasFsPlaying) audioPlayer.play();
                }
                isFsSeeking = false;
            }
        });

        document.addEventListener('touchend', () => {
            if (isFsSeeking) {
                if (!isNaN(audioPlayer.duration)) {
                    audioPlayer.currentTime = lastFsSeekPosition * audioPlayer.duration;
                    if (wasFsPlaying) audioPlayer.play();
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
            repeatBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>';
        }

        // Fullscreen volume controls
        const fsVolumeBtn = document.getElementById('fs-volume-btn');
        const fsVolumeBar = document.getElementById('fs-volume-bar');
        const fsVolumeFill = document.getElementById('fs-volume-fill');

        if (fsVolumeBtn && fsVolumeBar && fsVolumeFill) {
            const updateFsVolumeUI = () => {
                const { muted } = audioPlayer;
                const volume = this.player.userVolume;
                fsVolumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE : SVG_VOLUME;
                fsVolumeBtn.classList.toggle('muted', muted || volume === 0);
                const effectiveVolume = muted ? 0 : volume * 100;
                fsVolumeFill.style.setProperty('--fs-volume-level', `${effectiveVolume}%`);
                fsVolumeFill.style.width = `${effectiveVolume}%`;
            };

            fsVolumeBtn.onclick = () => {
                audioPlayer.muted = !audioPlayer.muted;
                localStorage.setItem('muted', audioPlayer.muted);
                updateFsVolumeUI();
            };

            const setFsVolume = (e) => {
                const rect = fsVolumeBar.getBoundingClientRect();
                const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const newVolume = position;
                this.player.setVolume(newVolume);
                if (audioPlayer.muted && newVolume > 0) {
                    audioPlayer.muted = false;
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

            audioPlayer.addEventListener('volumechange', updateFsVolumeUI);
            updateFsVolumeUI();
        }

        const update = () => {
            if (document.getElementById('fullscreen-cover-overlay').style.display === 'none') return;

            const duration = audioPlayer.duration || 0;
            const current = audioPlayer.currentTime || 0;

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

    showPage(pageId) {
        document.querySelectorAll('.page').forEach((page) => {
            page.classList.toggle('active', page.id === `page-${pageId}`);
        });

        document.querySelectorAll('.sidebar-nav a').forEach((link) => {
            link.classList.toggle(
                'active',
                link.pathname === `/${pageId}` || (pageId === 'home' && link.pathname === '/')
            );
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
        const localContainer = document.getElementById('library-local-container');
        const foldersContainer = document.getElementById('my-folders-container');

        const likedTracks = await db.getFavorites('track');
        const shuffleBtn = document.getElementById('shuffle-liked-tracks-btn');
        const downloadBtn = document.getElementById('download-liked-tracks-btn');

        if (likedTracks.length) {
            if (shuffleBtn) shuffleBtn.style.display = 'flex';
            if (downloadBtn) downloadBtn.style.display = 'flex';
            this.renderListWithTracks(tracksContainer, likedTracks, true);
        } else {
            if (shuffleBtn) shuffleBtn.style.display = 'none';
            if (downloadBtn) downloadBtn.style.display = 'none';
            tracksContainer.innerHTML = createPlaceholder('No liked tracks yet.');
        }

        const likedAlbums = await db.getFavorites('album');
        if (likedAlbums.length) {
            albumsContainer.innerHTML = likedAlbums.map((a) => this.createAlbumCardHTML(a)).join('');
            likedAlbums.forEach((album) => {
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
            artistsContainer.innerHTML = likedArtists.map((a) => this.createArtistCardHTML(a)).join('');
            likedArtists.forEach((artist) => {
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

            likedPlaylists.forEach((playlist) => {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            });

            likedMixes.forEach((mix) => {
                const el = playlistsContainer.querySelector(`[data-mix-id="${mix.id}"]`);
                if (el) {
                    trackDataStore.set(el, mix);
                    this.updateLikeState(el, 'mix', mix.id);
                }
            });
        } else {
            playlistsContainer.innerHTML = createPlaceholder('No liked playlists or mixes yet.');
        }

        const folders = await db.getFolders();
        if (foldersContainer) {
            foldersContainer.innerHTML = folders.map((f) => this.createFolderCardHTML(f)).join('');
            foldersContainer.style.display = folders.length ? 'grid' : 'none';
        }

        const myPlaylistsContainer = document.getElementById('my-playlists-container');
        const myPlaylists = await db.getPlaylists();

        const playlistsInFolders = new Set();
        folders.forEach((folder) => {
            if (folder.playlists) {
                folder.playlists.forEach((id) => playlistsInFolders.add(id));
            }
        });

        const visiblePlaylists = myPlaylists.filter((p) => !playlistsInFolders.has(p.id));

        if (visiblePlaylists.length) {
            myPlaylistsContainer.innerHTML = visiblePlaylists.map((p) => this.createUserPlaylistCardHTML(p)).join('');
            visiblePlaylists.forEach((playlist) => {
                const el = myPlaylistsContainer.querySelector(`[data-user-playlist-id="${playlist.id}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                }
            });
        } else {
            if (folders.length === 0) {
                myPlaylistsContainer.innerHTML = createPlaceholder('No playlists yet. Create your first playlist!');
            } else {
                myPlaylistsContainer.innerHTML = '';
            }
        }

        // Render Local Files
        this.renderLocalFiles(localContainer);
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
                    this.renderListWithTracks(listContainer, window.localFilesCache, true);
                }
            } else {
                if (introDiv) introDiv.style.display = 'block';
                if (headerDiv) headerDiv.style.display = 'none';
                if (listContainer) listContainer.innerHTML = '';
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
            this.showPage('home');

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
                this.renderHomeEditorsPicks(false, 'home-editors-picks');
            } else {
                this.renderHomeEditorsPicks(false, 'home-editors-picks-empty');
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
                clearRecentBtn.onclick = () => {
                    if (confirm('Clear recent activity?')) {
                        recentActivityManager.clear();
                        this.renderHomeRecent();
                    }
                };

            this.renderHomeRecent();

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

    async getSeeds() {
        const history = await db.getHistory();
        const favorites = await db.getFavorites('track');
        const playlists = await db.getPlaylists(true);
        const playlistTracks = playlists.flatMap((p) => p.tracks || []);

        // Prioritize: Playlists > Favorites > History
        // Take random samples from each to form seeds
        const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

        const seeds = [
            ...shuffle(playlistTracks).slice(0, 20),
            ...shuffle(favorites).slice(0, 20),
            ...shuffle(history).slice(0, 10),
        ];

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
                const trackSeeds = seeds.slice(0, 5);
                const recommendedTracks = await this.api.getRecommendedTracksForPlaylist(trackSeeds, 20, {
                    skipCache: forceRefresh,
                });

                const filteredTracks = await this.filterUserContent(recommendedTracks, 'track');

                if (filteredTracks.length > 0) {
                    this.renderListWithTracks(songsContainer, filteredTracks, true);
                } else {
                    songsContainer.innerHTML = createPlaceholder('No song recommendations found.');
                }
            } catch (e) {
                console.error(e);
                songsContainer.innerHTML = createPlaceholder('Failed to load song recommendations.');
            }
        }
    }

    async renderHomeAlbums(forceRefresh = false, providedSeeds = null) {
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
            } else if (!albumsContainer.querySelector('.skeleton')) {
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
                        filteredAlbums.slice(0, 12).forEach((a) => {
                            const el = albumsContainer.querySelector(`[data-album-id="${a.id}"]`);
                            if (el) {
                                trackDataStore.set(el, a);
                                this.updateLikeState(el, 'album', a.id);
                            }
                        });
                    } else {
                        albumsContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 2rem 0;">${createPlaceholder('Tell us more about what you like so we can recommend albums!')}</div>`;
                    }
                } else {
                    albumsContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 2rem 0;">${createPlaceholder('Tell us more about what you like so we can recommend albums!')}</div>`;
                }
            } catch (e) {
                console.error(e);
                albumsContainer.innerHTML = createPlaceholder('Failed to load album recommendations.');
            }
        }
    }

    createTrackCardHTML(track) {
        const explicitBadge = hasExplicitContent(track) ? this.createExplicitBadge() : '';
        const qualityBadge = createQualityBadgeHTML(track);
        const isCompact = cardSettings.isCompactAlbum();

        return this.createBaseCardHTML({
            type: 'track',
            id: track.id,
            href: `/track/${track.id}`,
            title: `${escapeHtml(getTrackTitle(track))} ${explicitBadge} ${qualityBadge}`,
            subtitle: escapeHtml(getTrackArtists(track)),
            imageHTML: this.getCoverHTML(track.album?.videoCover, track.album?.cover, escapeHtml(track.title)),
            actionButtonsHTML: `
                <button class="like-btn card-like-btn" data-action="toggle-like" data-type="track" title="Add to Liked">
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
                const response = await fetch('/editors-picks.json');
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
                                };
                                cardsHTML.push(this.createAlbumCardHTML(album));
                                itemsToStore.push({ el: null, data: album, type: 'album' });
                            } else {
                                // Fall back to API call for legacy format
                                const result = await this.api.getAlbum(item.id);
                                if (result && result.album) {
                                    cardsHTML.push(this.createAlbumCardHTML(result.album));
                                    itemsToStore.push({ el: null, data: result.album, type: 'album' });
                                }
                            }
                        } else if (item.type === 'artist') {
                            if (item.name && item.picture) {
                                // Use cached data directly
                                const artist = {
                                    id: item.id,
                                    name: item.name,
                                    picture: item.picture,
                                };
                                cardsHTML.push(this.createArtistCardHTML(artist));
                                itemsToStore.push({ el: null, data: artist, type: 'artist' });
                            } else {
                                // Fall back to API call
                                const artist = await this.api.getArtist(item.id);
                                if (artist) {
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
                                };
                                cardsHTML.push(this.createTrackCardHTML(track));
                                itemsToStore.push({ el: null, data: track, type: 'track' });
                            } else {
                                // Fall back to API call
                                const track = await this.api.getTrackMetadata(item.id);
                                if (track) {
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
                                };
                                const subtitle = item.username ? `by ${item.username}` : null;
                                cardsHTML.push(this.createUserPlaylistCardHTML(playlist, subtitle));
                                itemsToStore.push({ el: null, data: playlist, type: 'user-playlist' });
                            } else {
                                const playlist = await syncManager.getPublicPlaylist(item.id);
                                if (playlist) {
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
                    itemsToStore.forEach((item, _index) => {
                        const type = item.type;
                        const id = item.data.id;
                        const el = picksContainer.querySelector(`[data-${type}-id="${id}"]`);
                        if (el) {
                            trackDataStore.set(el, item.data);
                            this.updateLikeState(el, type, id);
                        }
                    });
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
                        filteredArtists.slice(0, 12).forEach((a) => {
                            const el = artistsContainer.querySelector(`[data-artist-id="${a.id}"]`);
                            if (el) {
                                trackDataStore.set(el, a);
                                this.updateLikeState(el, 'artist', a.id);
                            }
                        });
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

    renderHomeRecent() {
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

                displayItems.forEach((item) => {
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
                        if (item._kind === 'album') this.updateLikeState(el, 'album', item.id);
                        if (item._kind === 'playlist' && !item.isUserPlaylist)
                            this.updateLikeState(el, 'playlist', item.uuid);
                        if (item._kind === 'mix') this.updateLikeState(el, 'mix', item.id);
                    }
                });
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
            const provider = this.api.getCurrentProvider();
            const [tracksResult, artistsResult, albumsResult, playlistsResult] = await Promise.all([
                this.api.searchTracks(query, { signal, provider }),
                this.api.searchArtists(query, { signal, provider }),
                this.api.searchAlbums(query, { signal, provider }),
                this.api.searchPlaylists(query, { signal, provider }),
            ]);

            let finalTracks = tracksResult.items;
            let finalArtists = artistsResult.items;
            let finalAlbums = albumsResult.items;
            let finalPlaylists = playlistsResult.items;

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
                this.renderListWithTracks(tracksContainer, finalTracks, true);
            } else {
                tracksContainer.innerHTML = createPlaceholder('No tracks found.');
            }

            artistsContainer.innerHTML = finalArtists.length
                ? finalArtists.map((artist) => this.createArtistCardHTML(artist)).join('')
                : createPlaceholder('No artists found.');

            finalArtists.forEach((artist) => {
                const el = artistsContainer.querySelector(`[data-artist-id="${artist.id}"]`);
                if (el) {
                    trackDataStore.set(el, artist);
                    this.updateLikeState(el, 'artist', artist.id);
                }
            });

            albumsContainer.innerHTML = finalAlbums.length
                ? finalAlbums.map((album) => this.createAlbumCardHTML(album)).join('')
                : createPlaceholder('No albums found.');

            finalAlbums.forEach((album) => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });

            playlistsContainer.innerHTML = finalPlaylists.length
                ? finalPlaylists.map((playlist) => this.createPlaylistCardHTML(playlist)).join('')
                : createPlaceholder('No playlists found.');

            finalPlaylists.forEach((playlist) => {
                const el = playlistsContainer.querySelector(`[data-playlist-id="${playlist.uuid}"]`);
                if (el) {
                    trackDataStore.set(el, playlist);
                    this.updateLikeState(el, 'playlist', playlist.uuid);
                }
            });
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Search failed:', error);
            const errorMsg = createPlaceholder(`Error during search. ${error.message}`);
            tracksContainer.innerHTML = errorMsg;
            artistsContainer.innerHTML = errorMsg;
            albumsContainer.innerHTML = errorMsg;
            playlistsContainer.innerHTML = errorMsg;
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
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="history-icon">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span class="query-text">${escapeHtml(query)}</span>
                <span class="delete-history-btn" title="Remove from history">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, false)}
        `;

        try {
            const { album, tracks } = await this.api.getAlbum(albumId, provider);

            const videoCoverUrl = album.videoCover ? this.api.tidalAPI.getVideoCoverUrl(album.videoCover) : null;
            const coverUrl = videoCoverUrl || this.api.getCoverUrl(album.cover);

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
            imageEl.style.backgroundColor = '';

            // Set background and vibrant color
            this.setPageBackground(coverUrl);
            if (backgroundSettings.isEnabled() && album.cover) {
                this.extractAndApplyColor(this.api.getCoverUrl(album.cover, '80'));
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
            this.renderListWithTracks(tracklistContainer, tracks, false, true);

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

                const renderSection = (items, container, section, titleEl, titleText) => {
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

                    filtered.forEach((a) => {
                        const el = container.querySelector(`[data-album-id="${a.id}"]`);
                        if (el) {
                            trackDataStore.set(el, a);
                            this.updateLikeState(el, 'album', a.id);
                        }
                    });
                };

                renderSection(
                    artistData.albums,
                    moreAlbumsContainer,
                    moreAlbumsSection,
                    moreAlbumsTitle,
                    `More albums from ${album.artist.name}`
                );
                renderSection(
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

                            filteredSimilar.forEach((a) => {
                                const el = similarArtistsContainer.querySelector(`[data-artist-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    this.updateLikeState(el, 'artist', a.id);
                                }
                            });
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

                            filteredSimilar.forEach((a) => {
                                const el = similarAlbumsContainer.querySelector(`[data-album-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    this.updateLikeState(el, 'album', a.id);
                                }
                            });
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
                this.renderListWithTracks(recommendedContainer, recommendedTracks, true);

                const trackItems = recommendedContainer.querySelectorAll('.track-item');
                trackItems.forEach((item) => {
                    const actionsDiv = item.querySelector('.track-item-actions');
                    if (actionsDiv) {
                        const addToPlaylistBtn = document.createElement('button');
                        addToPlaylistBtn.className = 'track-action-btn add-to-playlist-btn';
                        addToPlaylistBtn.title = 'Add to this playlist';
                        addToPlaylistBtn.innerHTML =
                            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
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
                                        syncManager.syncUserPlaylist(updatedPlaylist, 'update');

                                        const tracklistContainer = document.getElementById('playlist-detail-tracklist');
                                        if (tracklistContainer && updatedPlaylist.tracks) {
                                            tracklistContainer.innerHTML = `
                                                                                                                                                <div class="track-list-header">
                                                                                                                                                    <span style="width: 40px; text-align: center;">#</span>
                                                                                                                                                    <span>Title</span>
                                                                                                                                                    <span class="duration-header">Duration</span>
                                                                                                                                                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                                                                                                                                                </div>                                            `;
                                            this.renderListWithTracks(tracklistContainer, updatedPlaylist.tracks, true);

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
        this.showPage('playlist');

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
        if (playBtn) playBtn.innerHTML = `${SVG_PLAY}<span>Play</span>`;
        const dlBtn = document.getElementById('download-playlist-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download</span>`;
        const addPlaylistBtn = document.getElementById('add-playlist-to-playlist-btn');

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
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, true)}
        `;

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
                    this.extractAndApplyColor(playlistData.cover);
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

                const renderTracks = () => {
                    // Re-fetch container each time because enableTrackReordering clones it
                    const container = document.getElementById('playlist-detail-tracklist');
                    container.innerHTML = `
                        <div class="track-list-header">
                            <span style="width: 40px; text-align: center;">#</span>
                            <span>Title</span>
                            <span class="duration-header">Duration</span>
                            <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                        </div>
                    `;
                    this.renderListWithTracks(container, currentTracks, true, true);

                    // Add remove buttons and enable reordering ONLY IF OWNED
                    if (ownedPlaylist) {
                        const trackItems = container.querySelectorAll('.track-item');
                        trackItems.forEach((item, index) => {
                            const actionsDiv = item.querySelector('.track-item-actions');
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'track-action-btn remove-from-playlist-btn';
                            removeBtn.title = 'Remove from playlist';
                            removeBtn.innerHTML =
                                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
                            removeBtn.dataset.trackId = currentTracks[index].id;

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

                const applySort = (sortType) => {
                    currentSort = sortType;
                    localStorage.setItem(`playlist-sort-${playlistId}`, sortType);
                    currentTracks = sortTracks(originalTracks, sortType);
                    renderTracks();
                };

                renderTracks();

                // Update header like button - hide for user playlists
                const playlistLikeBtn = document.getElementById('like-playlist-btn');
                if (playlistLikeBtn) {
                    playlistLikeBtn.style.display = 'none';
                }

                // Load recommended songs thingy
                if (ownedPlaylist) {
                    this.loadRecommendedSongsForPlaylist(tracks);

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
                this.updatePlaylistHeaderActions(
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

                    this.extractAndApplyColor(this.api.getCoverUrl(imageId, '160'));
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

                const renderTracks = () => {
                    tracklistContainer.innerHTML = `
                        <div class="track-list-header">
                            <span style="width: 40px; text-align: center;">#</span>
                            <span>Title</span>
                            <span class="duration-header">Duration</span>
                            <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                        </div>
                    `;
                    this.renderListWithTracks(tracklistContainer, currentTracks, true, true);
                };

                const applySort = (sortType) => {
                    currentSort = sortType;
                    localStorage.setItem(`playlist-sort-${playlistId}`, sortType);
                    currentTracks = sortTracks(originalTracks, sortType);
                    renderTracks();
                };

                renderTracks();

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
                this.updatePlaylistHeaderActions(playlist, false, currentTracks, false, applySort, () => currentSort);

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
        this.showPage('folder');
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
                <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
            </div>
            ${this.createSkeletonTracks(10, true)}
        `;

        try {
            const { mix, tracks } = await this.api.getMix(mixId, provider);

            if (mix.cover) {
                imageEl.src = mix.cover;
                this.setPageBackground(mix.cover);
                this.extractAndApplyColor(mix.cover);
            } else {
                // Try to get cover from first track album
                if (tracks.length > 0 && tracks[0].album?.cover) {
                    const videoCoverUrl = tracks[0].album?.videoCover
                        ? this.api.tidalAPI.getVideoCoverUrl(tracks[0].album.videoCover)
                        : null;
                    const coverUrl = videoCoverUrl || this.api.getCoverUrl(tracks[0].album.cover);

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
                    this.extractAndApplyColor(this.api.getCoverUrl(tracks[0].album.cover, '160'));
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

            tracklistContainer.innerHTML = `
                <div class="track-list-header">
                    <span style="width: 40px; text-align: center;">#</span>
                    <span>Title</span>
                    <span class="duration-header">Duration</span>
                    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
                </div>
            `;

            this.renderListWithTracks(tracklistContainer, tracks, true, true);

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
        this.showPage('artist');

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
        const dlBtn = document.getElementById('download-discography-btn');
        if (dlBtn) dlBtn.innerHTML = `${SVG_DOWNLOAD}<span>Download Discography</span>`;

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

                            filteredSimilar.forEach((a) => {
                                const el = similarContainer.querySelector(`[data-artist-id="${a.id}"]`);
                                if (el) {
                                    trackDataStore.set(el, a);
                                    this.updateLikeState(el, 'artist', a.id);
                                }
                            });
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
            this.extractAndApplyColor(artistPic160);

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

            this.renderListWithTracks(tracksContainer, artist.tracks, true);

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

                    artist.eps.forEach((album) => {
                        const el = epsContainer.querySelector(`[data-album-id="${album.id}"]`);
                        if (el) {
                            trackDataStore.set(el, album);
                            this.updateLikeState(el, 'album', album.id);
                        }
                    });
                } else {
                    epsSection.style.display = 'none';
                }
            }

            artist.albums.forEach((album) => {
                const el = albumsContainer.querySelector(`[data-album-id="${album.id}"]`);
                if (el) {
                    trackDataStore.set(el, album);
                    this.updateLikeState(el, 'album', album.id);
                }
            });

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
        if (url.includes('qobuz.com')) return '';

        let icon = SVG_GLOBE;
        let title = 'Website';

        if (url.includes('twitter.com') || url.includes('x.com')) {
            icon = SVG_TWITTER;
            title = 'Twitter';
        } else if (url.includes('instagram.com')) {
            icon = SVG_INSTAGRAM;
            title = 'Instagram';
        } else if (url.includes('facebook.com')) {
            icon = SVG_FACEBOOK;
            title = 'Facebook';
        } else if (url.includes('youtube.com')) {
            icon = SVG_YOUTUBE;
            title = 'YouTube';
        } else if (url.includes('spotify.com') || url.includes('open.spotify.com')) {
            icon = SVG_LINK;
            title = 'Spotify';
        } else if (url.includes('soundcloud.com')) {
            icon = SVG_SOUNDCLOUD;
            title = 'SoundCloud';
        } else if (url.includes('apple.com')) {
            icon = SVG_APPLE;
            title = 'Apple Music';
        }

        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="social-link" title="${title}">${icon}</a>`;
    }

    async renderRecentPage() {
        this.showPage('recent');
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
                this.renderListWithTracks(tempContainer, tracks, true);

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
        this.showPage('unreleased');
        const container = document.getElementById('unreleased-content');
        await renderUnreleasedTrackerPage(container);
    }

    async renderTrackerArtistPage(sheetId) {
        this.showPage('tracker-artist');
        const container = document.getElementById('tracker-artist-projects-container');
        await renderTrackerArtistContent(sheetId, container);
    }

    async renderTrackerProjectPage(sheetId, projectName) {
        this.showPage('album'); // Use album page template
        const container = document.getElementById('album-detail-tracklist');
        await renderTrackerProjectContent(sheetId, projectName, container, this);
    }

    async renderTrackerTrackPage(trackId) {
        this.showPage('album'); // Use album page template
        const container = document.getElementById('album-detail-tracklist');
        await renderTrackerTrackContent(trackId, container, this);
    }

    updatePlaylistHeaderActions(playlist, isOwned, tracks, showShare = false, onSort = null, getCurrentSort = null) {
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
        shuffleBtn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/></svg><span>Shuffle</span>';
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
            sortBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg><span>Sort</span>';

            sortBtn.onclick = (e) => {
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

                const handleSort = (ev) => {
                    const li = ev.target.closest('li');
                    if (li && li.dataset.sort) {
                        trackChangeSort(li.dataset.sort);
                        onSort(li.dataset.sort);
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
            editBtn.innerHTML =
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit</span>';
            fragment.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.id = 'delete-playlist-btn';
            deleteBtn.className = 'btn-secondary danger';
            deleteBtn.innerHTML =
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg><span>Delete</span>';
            fragment.appendChild(deleteBtn);
        }

        // Share (User Playlists Only)
        if (showShare || (isOwned && playlist.isPublic)) {
            const shareBtn = document.createElement('button');
            shareBtn.id = 'share-playlist-btn';
            shareBtn.className = 'btn-secondary';
            shareBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg><span>Share</span>';

            shareBtn.onclick = () => {
                const url = getShareUrl(`/userplaylist/${playlist.id || playlist.uuid}`);
                navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!'));
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
        Promise.all([this.api.settings.getInstances('api'), this.api.settings.getInstances('streaming')]).then(
            ([apiInstances, streamingInstances]) => {
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
                            const safeName = escapeHtml(instanceName || 'Unknown instance');
                            const safeUrl = escapeHtml(instanceUrl || '');
                            const safeVersion = escapeHtml(instanceVersion);

                            return `
                        <li data-index="${index}" data-type="${type}">
                            <div style="flex: 1; min-width: 0;">
                                <div class="instance-url">${safeName}</div>
                                ${safeUrl && safeUrl !== safeName ? `<div style="font-size: 0.8rem; color: var(--muted-foreground); margin-top: 0.15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeUrl}</div>` : ''}
                                ${safeVersion ? `<div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.1rem;">v${safeVersion}</div>` : ''}
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
                        })
                        .join('');

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
            }
        );
    }

    async renderTrackPage(trackId, provider = null) {
        this.showPage('track');

        document.body.classList.add('sidebar-collapsed');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
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
            try {
                const result = await this.api.getTrack(trackId, provider);
                track = result.track;
            } catch (e) {
                console.warn('getTrack failed, trying getTrackMetadata', e);
                track = await this.api.getTrackMetadata(trackId, provider);
            }

            const videoCoverUrl = track.album?.videoCover
                ? this.api.tidalAPI.getVideoCoverUrl(track.album.videoCover)
                : null;
            const coverUrl = videoCoverUrl || this.api.getCoverUrl(track.album?.cover);

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
            imageEl.style.backgroundColor = '';

            this.setPageBackground(coverUrl);
            if (backgroundSettings.isEnabled() && track.album?.cover) {
                this.extractAndApplyColor(this.api.getCoverUrl(track.album.cover, '80'));
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
                    this.renderListWithTracks(albumTracksContainer, tracks, false);
                }
            }

            document.title = `${track.title} - ${getTrackArtists(track)}`;
        } catch (error) {
            console.error('Failed to load track:', error);
            titleEl.textContent = 'Track not found';
            artistEl.innerHTML = '';
        }
    }
}
