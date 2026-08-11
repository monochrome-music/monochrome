import { render } from 'preact';
import { AppHeader } from './app/AppHeader';
import { AppNavigation } from './app/AppNavigation';
import { NowPlayingBar } from './app/NowPlayingBar';
import { HomePage } from './routes/HomePage';
import { SearchPage } from './routes/SearchPage';
import { PodcastBrowsePage, PodcastDetailPage } from './routes/PodcastsPage';
import { RecentPage, UnreleasedPage } from './routes/RecentPage';
import { AlbumPage, FolderPage, MixPage, PlaylistPage } from './routes/CatalogDetailPages';
import {
    ContextMenu,
    EqualizerEmptyMenu,
    EqualizerNodeMenu,
    ExportMenu,
    SidePanel,
    SortMenu,
} from './app/UtilitySurfaces';
import './styles/modern.css';
import '../js/app.js';

function mountChrome() {
    const navigationRoot = document.querySelector<HTMLElement>('.sidebar-content');
    const headerRoot = document.querySelector<HTMLElement>('.main-header');
    const playerRoot = document.querySelector<HTMLElement>('.now-playing-bar');

    if (!navigationRoot || !headerRoot || !playerRoot) {
        throw new Error('Monochrome app chrome is incomplete.');
    }

    render(<AppNavigation />, navigationRoot);
    render(<AppHeader />, headerRoot);
    render(<NowPlayingBar />, playerRoot);

    const homeRoot = document.querySelector<HTMLElement>('#page-home');
    if (homeRoot) render(<HomePage />, homeRoot);
    const searchRoot = document.querySelector<HTMLElement>('#page-search');
    if (searchRoot) render(<SearchPage />, searchRoot);

    const routeRoots = [
        ['#page-recent', <RecentPage />],
        ['#page-unreleased', <UnreleasedPage />],
        ['#page-podcasts', <PodcastDetailPage />],
        ['#page-podcasts-browse', <PodcastBrowsePage />],
    ] as const;
    for (const [selector, component] of routeRoots) {
        const root = document.querySelector<HTMLElement>(selector);
        if (root) render(component, root);
    }

    const catalogRoots = [
        ['#page-album', <AlbumPage />],
        ['#page-playlist', <PlaylistPage />],
        ['#page-folder', <FolderPage />],
        ['#page-mix', <MixPage />],
    ] as const;
    for (const [selector, component] of catalogRoots) {
        const root = document.querySelector<HTMLElement>(selector);
        if (root) render(component, root);
    }

    const utilityRoots = [
        ['#context-menu', <ContextMenu />],
        ['#sort-menu', <SortMenu />],
        ['#export-playlist-menu', <ExportMenu />],
        ['#eq-node-context-menu', <EqualizerNodeMenu />],
        ['#eq-empty-context-menu', <EqualizerEmptyMenu />],
        ['#side-panel', <SidePanel />],
    ] as const;

    for (const [selector, component] of utilityRoots) {
        const root = document.querySelector<HTMLElement>(selector);
        if (root) render(component, root);
    }

    document.documentElement.dataset.uiFramework = 'preact';
}

mountChrome();
