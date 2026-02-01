//router.js
import { getTrackArtists } from './utils.js';

export function navigate(path) {
    if (path === window.location.pathname) {
        return;
    }
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
}

export function createRouter(ui) {
    const router = async () => {
        if (window.location.hash && window.location.hash.length > 1) {
            const hash = window.location.hash.substring(1);
            if (hash.includes('/')) {
                const newPath = hash.startsWith('/') ? hash : '/' + hash;
                window.history.replaceState(null, '', newPath);
            }
        }

        let path = window.location.pathname;

        if (path.startsWith('/')) path = path.substring(1);
        if (path.endsWith('/')) path = path.substring(0, path.length - 1);
        if (path === '' || path === 'index.html') path = 'home';

        const parts = path.split('/');
        const page = parts[0];
        const param = parts.slice(1).join('/');

        switch (page) {
            case 'search':
                await ui.renderSearchPage(decodeURIComponent(param));
                break;
            case 'album':
                await ui.renderAlbumPage(param);
                break;
            case 'artist':
                await ui.renderArtistPage(param);
                break;
            case 'playlist':
                await ui.renderPlaylistPage(param, 'api');
                break;
            case 'userplaylist':
                await ui.renderPlaylistPage(param, 'user');
                break;
            case 'folder':
                await ui.renderFolderPage(param);
                break;
            case 'mix':
                await ui.renderMixPage(param);
                break;
            case 'track':
                if (param.startsWith('tracker-')) {
                    await ui.renderTrackerTrackPage(param);
                } else {
                    await ui.renderTrackPage(param);
                }
                break;
            case 'library':
                await ui.renderLibraryPage();
                break;
            case 'recent':
                await ui.renderRecentPage();
                break;
            case 'unreleased':
                if (param) {
                    const parts = param.split('/');
                    const sheetId = parts[0];
                    const projectName = parts[1] ? decodeURIComponent(parts[1]) : null;
                    if (projectName) {
                        await ui.renderTrackerProjectPage(sheetId, projectName);
                    } else {
                        await ui.renderTrackerArtistPage(sheetId);
                    }
                } else {
                    await ui.renderUnreleasedPage();
                }
                break;
            case 'home':
                await ui.renderHomePage();
                break;
            default:
                ui.showPage(page);
                break;
        }
    };

    return router;
}

export function updateTabTitle(player) {
    if (player.currentTrack) {
        const track = player.currentTrack;
        document.title = `${track.title} • ${getTrackArtists(track)}`;
    } else {
        const path = window.location.pathname;
        if (path.startsWith('/album/') || path.startsWith('/playlist/') || path.startsWith('/track/')) {
            return;
        }
        document.title = 'Monochrome Music';
    }
}
