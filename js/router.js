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
        document.title = `${track.title} • ${track.artist?.name || 'Unknown'} - Monochrome`;
    } else {
        const hash = window.location.hash;
        if (hash.includes('#album/')) {
            // Will be updated by album render
            return;
        }
        document.title = 'Monochrome Music';
    }
}
