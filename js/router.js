//router.js
import { getTrackArtists } from './utils.js';

export function createRouter(ui) {
    const router = async () => {
        const path = window.location.hash.substring(1) || 'home';
        const [page, param] = path.split('/');

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
            case 'mix':
                await ui.renderMixPage(param);
                break;
            case 'library':
                await ui.renderLibraryPage();
                break;
            case 'recent':
                await ui.renderRecentPage();
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
        const hash = window.location.hash;
        if (hash.includes('#album/') || hash.includes('#playlist/')) {
            return;
        }
        document.title = 'Monochrome Music';
    }
}
