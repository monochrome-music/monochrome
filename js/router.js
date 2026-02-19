//router.js
import { getTrackArtists } from './utils.js';
import { loadProfile } from './profile.js';

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

        // Helper to extract provider prefix and ID from params
        // Supports formats like: /track/t/123 (Tidal), /track/q/123 (Qobuz), /track/123 (default)
        const extractProviderAndId = (p) => {
            if (p.startsWith('t/')) {
                return { provider: 'tidal', id: p.slice(2) };
            }
            if (p.startsWith('q/')) {
                return { provider: 'qobuz', id: p.slice(2) };
            }
            return { provider: null, id: p };
        };

        switch (page) {
            case 'search':
                await ui.renderSearchPage(decodeURIComponent(param));
                break;
            case 'album': {
                const { provider, id } = extractProviderAndId(param);
                await ui.renderAlbumPage(id, provider);
                break;
            }
            case 'artist': {
                const { provider, id } = extractProviderAndId(param);
                await ui.renderArtistPage(id, provider);
                break;
            }
            case 'playlist': {
                const { provider, id } = extractProviderAndId(param);
                await ui.renderPlaylistPage(id, 'api', provider);
                break;
            }
            case 'userplaylist':
                await ui.renderPlaylistPage(param, 'user');
                break;
            case 'folder':
                await ui.renderFolderPage(param);
                break;
            case 'mix': {
                const { provider, id } = extractProviderAndId(param);
                await ui.renderMixPage(id, provider);
                break;
            }
            case 'track': {
                const { provider, id } = extractProviderAndId(param);
                if (id.startsWith('tracker-')) {
                    await ui.renderTrackerTrackPage(id);
                } else {
                    await ui.renderTrackPage(id, provider);
                }
                break;
            }
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
            case 'user':
                if (param && param.startsWith('@') && !param.includes('/')) {
                    await loadProfile(decodeURIComponent(param.slice(1)));
                }
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
