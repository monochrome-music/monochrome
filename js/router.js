//router.js
import { getTrackArtists } from './utils.js';

export function createRouter(ui) {
    const router = () => {
        const path = window.location.hash.substring(1) || "home";
        const [page, param] = path.split('/');

        switch (page) {
            case 'search':
                ui.renderSearchPage(decodeURIComponent(param));
                break;
            case 'album':
                ui.renderAlbumPage(param);
                break;
            case 'artist':
                ui.renderArtistPage(param);
                break;
            case 'playlist':
                ui.renderPlaylistPage(param);
                break;
            case 'userplaylist':
                ui.renderPlaylistPage(param);
                break;
            case 'mix':
                ui.renderMixPage(param);
                break;
            case 'library':
                ui.renderLibraryPage();
                break;
            case 'recent':
                ui.renderRecentPage();
                break;
            case 'home':
                ui.renderHomePage();
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
