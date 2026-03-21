import { debounce } from './utils.js';
import { db } from './db.js';
import Fuse from 'fuse.js';
import { navigate } from './router.js';

const ICONS = {
    search: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    house: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    library:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>',
    clock: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    calendar:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    settings:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    info: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    download:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
    heart: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    play: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    pause: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
    skipForward:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>',
    skipBack:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/></svg>',
    shuffle:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
    repeat: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
    volumeX:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>',
    volume: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/></svg>',
    list: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>',
    maximize:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    sparkles:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>',
    palette:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
    sun: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    moon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    sliders:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    folderPlus:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
    user: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    logOut: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
    logIn: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>',
    keyboard:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>',
    music: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    disc: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg>',
    mic: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
    upload: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
    handHeart:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/><path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/><path d="m2 15 6 6"/><path d="M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.73 2.73 0 0 0 16 4a2.78 2.78 0 0 0-5 1.8c0 1.2.8 2 1.5 2.8L16 12Z"/></svg>',
    monitor:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
    pencil: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>',
    radio: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>',
    store: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/></svg>',
};

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

class CommandPalette {
    constructor() {
        this.overlay = document.getElementById('command-palette-overlay');
        this.input = document.getElementById('command-palette-input');
        this.resultsContainer = document.getElementById('command-palette-results');
        this.isOpen = false;
        this.selectedIndex = 0;
        this.flatItems = [];
        this.allSettings = [];
        this.musicSearchAbort = null;
        this.debouncedMusicSearch = debounce(this.searchMusic.bind(this), 300);
        this.commands = this.buildCommands();
        this.fuse = new Fuse(this.commands, {
            keys: [
                { name: 'label', weight: 0.6 },
                { name: 'keywords', weight: 0.3 },
                { name: 'group', weight: 0.1 },
            ],
            threshold: 0.4,
            ignoreLocation: true,
            includeScore: true,
        });

        this.init();
    }

    buildCommands() {
        return [
            {
                id: 'nav-home',
                group: 'Navigation',
                icon: 'house',
                label: 'Go to Home',
                keywords: ['home', 'main', 'start', 'landing'],
                action: () => {
                    navigate('/');
                },
            },
            {
                id: 'nav-library',
                group: 'Navigation',
                icon: 'library',
                label: 'Go to Library',
                keywords: ['library', 'collection', 'playlists', 'favorites'],
                action: () => {
                    navigate('/library');
                },
            },
            {
                id: 'nav-recent',
                group: 'Navigation',
                icon: 'clock',
                label: 'Go to Recent',
                keywords: ['recent', 'history', 'last played'],
                action: () => {
                    navigate('/recent');
                },
            },
            {
                id: 'nav-unreleased',
                group: 'Navigation',
                icon: 'calendar',
                label: 'Go to Unreleased',
                keywords: ['unreleased', 'upcoming', 'tracker'],
                action: () => {
                    navigate('/unreleased');
                },
            },
            {
                id: 'nav-settings',
                group: 'Navigation',
                icon: 'settings',
                label: 'Go to Settings',
                keywords: ['settings', 'preferences', 'config', 'options'],
                shortcut: null,
                action: () => {
                    navigate('/settings');
                },
            },
            {
                id: 'nav-about',
                group: 'Navigation',
                icon: 'info',
                label: 'Go to About',
                keywords: ['about', 'version', 'credits'],
                action: () => {
                    navigate('/about');
                },
            },
            {
                id: 'nav-download',
                group: 'Navigation',
                icon: 'download',
                label: 'Go to Download',
                keywords: ['download', 'desktop', 'app'],
                action: () => {
                    navigate('/download');
                },
            },
            {
                id: 'nav-donate',
                group: 'Navigation',
                icon: 'handHeart',
                label: 'Go to Donate',
                keywords: ['donate', 'support', 'contribute'],
                action: () => {
                    navigate('/donate');
                },
            },

            {
                id: 'play-pause',
                group: 'Playback',
                icon: 'play',
                label: 'Play / Pause',
                keywords: ['play', 'pause', 'toggle', 'resume', 'stop'],
                shortcut: 'Space',
                action: () => {
                    window.monochromePlayer?.handlePlayPause();
                },
            },
            {
                id: 'play-next',
                group: 'Playback',
                icon: 'skipForward',
                label: 'Next Track',
                keywords: ['next', 'skip', 'forward'],
                shortcut: 'Shift+→',
                action: () => {
                    window.monochromePlayer?.playNext();
                },
            },
            {
                id: 'play-prev',
                group: 'Playback',
                icon: 'skipBack',
                label: 'Previous Track',
                keywords: ['previous', 'back', 'rewind'],
                shortcut: 'Shift+←',
                action: () => {
                    window.monochromePlayer?.playPrev();
                },
            },
            {
                id: 'play-shuffle',
                group: 'Playback',
                icon: 'shuffle',
                label: 'Toggle Shuffle',
                keywords: ['shuffle', 'random'],
                shortcut: 'S',
                action: () => {
                    document.getElementById('shuffle-btn')?.click();
                },
            },
            {
                id: 'play-repeat',
                group: 'Playback',
                icon: 'repeat',
                label: 'Toggle Repeat',
                keywords: ['repeat', 'loop', 'cycle'],
                shortcut: 'R',
                action: () => {
                    document.getElementById('repeat-btn')?.click();
                },
            },
            {
                id: 'play-mute',
                group: 'Playback',
                icon: 'volumeX',
                label: 'Mute / Unmute',
                keywords: ['mute', 'unmute', 'sound', 'volume', 'silent'],
                shortcut: 'M',
                action: () => {
                    const el = window.monochromePlayer?.activeElement;
                    if (el) el.muted = !el.muted;
                },
            },
            {
                id: 'play-vol-up',
                group: 'Playback',
                icon: 'volume',
                label: 'Volume Up',
                keywords: ['volume', 'louder'],
                shortcut: '↑',
                action: () => {
                    const p = window.monochromePlayer;
                    if (p) p.setVolume(p.userVolume + 0.1);
                },
            },
            {
                id: 'play-vol-down',
                group: 'Playback',
                icon: 'volume',
                label: 'Volume Down',
                keywords: ['volume', 'quieter', 'softer'],
                shortcut: '↓',
                action: () => {
                    const p = window.monochromePlayer;
                    if (p) p.setVolume(p.userVolume - 0.1);
                },
            },

            {
                id: 'like-current',
                group: 'Now Playing',
                icon: 'heart',
                label: 'Like Current Track',
                keywords: ['like', 'favorite', 'love', 'heart', 'save'],
                action: () => {
                    document.querySelector('.now-playing-bar .like-btn')?.click();
                },
            },
            {
                id: 'download-current',
                group: 'Now Playing',
                icon: 'download',
                label: 'Download Current Track',
                keywords: ['download', 'save', 'current'],
                action: () => {
                    document.querySelector('.now-playing-bar .download-btn')?.click();
                },
            },

            {
                id: 'queue-open',
                group: 'Queue',
                icon: 'list',
                label: 'Open Queue',
                keywords: ['queue', 'list', 'up next'],
                shortcut: 'Q',
                action: () => {
                    document.getElementById('queue-btn')?.click();
                },
            },
            {
                id: 'queue-wipe',
                group: 'Queue',
                icon: 'trash',
                label: 'Clear Queue',
                keywords: ['wipe', 'clear', 'empty', 'queue'],
                action: () => {
                    window.monochromePlayer?.wipeQueue();
                    this.notify('Queue cleared');
                },
            },
            {
                id: 'queue-like-all',
                group: 'Queue',
                icon: 'heart',
                label: 'Like All in Queue',
                keywords: ['like', 'all', 'queue', 'heart', 'favorite'],
                action: () => this.likeAllInQueue(),
            },
            {
                id: 'queue-download',
                group: 'Queue',
                icon: 'download',
                label: 'Download Queue',
                keywords: ['download', 'queue', 'save', 'all'],
                action: () => this.downloadQueue(),
            },

            {
                id: 'lyrics-toggle',
                group: 'View',
                icon: 'text',
                label: 'Toggle Lyrics',
                keywords: ['lyrics', 'words', 'text', 'karaoke'],
                shortcut: 'L',
                action: () => {
                    document.querySelector('.now-playing-bar .cover')?.click();
                },
            },
            {
                id: 'fullscreen-open',
                group: 'View',
                icon: 'maximize',
                label: 'Open Fullscreen View',
                keywords: ['fullscreen', 'expand', 'immersive', 'cover'],
                action: () => {
                    const cover = document.querySelector('.now-playing-bar .cover-art');
                    if (cover) cover.click();
                },
            },
            {
                id: 'vis-toggle',
                group: 'View',
                icon: 'sparkles',
                label: 'Toggle Visualizer',
                keywords: ['visualizer', 'visual', 'animation', 'effects'],
                action: () => this.toggleVisualizer(),
            },
            {
                id: 'vis-butterchurn',
                group: 'View',
                icon: 'sparkles',
                label: 'Visualizer: Butterchurn',
                keywords: ['butterchurn', 'milkdrop', 'preset', 'visualizer'],
                action: () => this.setVisualizerPreset('butterchurn'),
            },
            {
                id: 'vis-kawarp',
                group: 'View',
                icon: 'sparkles',
                label: 'Visualizer: Kawarp',
                keywords: ['kawarp', 'preset', 'visualizer'],
                action: () => this.setVisualizerPreset('kawarp'),
            },
            {
                id: 'vis-lcd',
                group: 'View',
                icon: 'sparkles',
                label: 'Visualizer: LCD',
                keywords: ['lcd', 'preset', 'visualizer'],
                action: () => this.setVisualizerPreset('lcd'),
            },
            {
                id: 'vis-particles',
                group: 'View',
                icon: 'sparkles',
                label: 'Visualizer: Particles',
                keywords: ['particles', 'preset', 'visualizer'],
                action: () => this.setVisualizerPreset('particles'),
            },
            {
                id: 'vis-unknown',
                group: 'View',
                icon: 'sparkles',
                label: 'Visualizer: Unknown Pleasures',
                keywords: ['unknown pleasures', 'preset', 'visualizer', 'joy division'],
                action: () => this.setVisualizerPreset('unknown-pleasures'),
            },

            {
                id: 'theme-system',
                group: 'Theme',
                icon: 'monitor',
                label: 'Theme: System',
                keywords: ['theme', 'system', 'auto', 'default'],
                action: () => this.setTheme('system'),
            },
            {
                id: 'theme-black',
                group: 'Theme',
                icon: 'moon',
                label: 'Theme: Monochrome',
                keywords: ['theme', 'monochrome', 'black', 'dark', 'amoled'],
                action: () => this.setTheme('monochrome'),
            },
            {
                id: 'theme-dark',
                group: 'Theme',
                icon: 'moon',
                label: 'Theme: Dark',
                keywords: ['theme', 'dark'],
                action: () => this.setTheme('dark'),
            },
            {
                id: 'theme-white',
                group: 'Theme',
                icon: 'sun',
                label: 'Theme: White',
                keywords: ['theme', 'white', 'light'],
                action: () => this.setTheme('white'),
            },
            {
                id: 'theme-ocean',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Ocean',
                keywords: ['theme', 'ocean', 'blue', 'sea'],
                action: () => this.setTheme('ocean'),
            },
            {
                id: 'theme-purple',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Purple',
                keywords: ['theme', 'purple', 'violet'],
                action: () => this.setTheme('purple'),
            },
            {
                id: 'theme-forest',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Forest',
                keywords: ['theme', 'forest', 'green', 'nature'],
                action: () => this.setTheme('forest'),
            },
            {
                id: 'theme-mocha',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Mocha',
                keywords: ['theme', 'mocha', 'catppuccin', 'brown', 'warm'],
                action: () => this.setTheme('mocha'),
            },
            {
                id: 'theme-macchiato',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Macchiato',
                keywords: ['theme', 'macchiato', 'catppuccin'],
                action: () => this.setTheme('machiatto'),
            },
            {
                id: 'theme-frappe',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Frappé',
                keywords: ['theme', 'frappe', 'catppuccin'],
                action: () => this.setTheme('frappe'),
            },
            {
                id: 'theme-latte',
                group: 'Theme',
                icon: 'palette',
                label: 'Theme: Latte',
                keywords: ['theme', 'latte', 'catppuccin', 'light'],
                action: () => this.setTheme('latte'),
            },
            {
                id: 'theme-store',
                group: 'Theme',
                icon: 'store',
                label: 'Open Theme Store',
                keywords: ['theme', 'store', 'browse', 'community', 'custom'],
                action: () => {
                    document.getElementById('open-theme-store')?.click();
                },
            },

            {
                id: 'quality-low',
                group: 'Audio',
                icon: 'sliders',
                label: 'Quality: Low',
                keywords: ['quality', 'low', 'streaming', 'bitrate'],
                action: () => this.setQuality('LOW'),
            },
            {
                id: 'quality-high',
                group: 'Audio',
                icon: 'sliders',
                label: 'Quality: High',
                keywords: ['quality', 'high', 'streaming', 'bitrate'],
                action: () => this.setQuality('HIGH'),
            },
            {
                id: 'quality-lossless',
                group: 'Audio',
                icon: 'sliders',
                label: 'Quality: Lossless',
                keywords: ['quality', 'lossless', 'flac', 'cd', 'streaming'],
                action: () => this.setQuality('LOSSLESS'),
            },
            {
                id: 'quality-hires',
                group: 'Audio',
                icon: 'sliders',
                label: 'Quality: Hi-Res',
                keywords: ['quality', 'hires', 'hi-res', 'master', 'mqa', 'streaming'],
                action: () => this.setQuality('HI_RES_LOSSLESS'),
            },
            {
                id: 'sleep-15',
                group: 'Audio',
                icon: 'clock',
                label: 'Sleep Timer: 15 min',
                keywords: ['sleep', 'timer', '15', 'minutes'],
                action: () => this.setSleepTimer(15),
            },
            {
                id: 'sleep-30',
                group: 'Audio',
                icon: 'clock',
                label: 'Sleep Timer: 30 min',
                keywords: ['sleep', 'timer', '30', 'minutes'],
                action: () => this.setSleepTimer(30),
            },
            {
                id: 'sleep-60',
                group: 'Audio',
                icon: 'clock',
                label: 'Sleep Timer: 60 min',
                keywords: ['sleep', 'timer', '60', 'minutes', 'hour'],
                action: () => this.setSleepTimer(60),
            },
            {
                id: 'sleep-120',
                group: 'Audio',
                icon: 'clock',
                label: 'Sleep Timer: 120 min',
                keywords: ['sleep', 'timer', '120', 'minutes', 'hours'],
                action: () => this.setSleepTimer(120),
            },

            {
                id: 'lib-create-playlist',
                group: 'Library',
                icon: 'plus',
                label: 'Create Playlist',
                keywords: ['create', 'new', 'playlist', 'add'],
                action: () => this.createPlaylist(),
            },
            {
                id: 'lib-create-folder',
                group: 'Library',
                icon: 'folderPlus',
                label: 'Create Folder',
                keywords: ['create', 'new', 'folder', 'add', 'organize'],
                action: () => this.createFolder(),
            },

            {
                id: 'sys-cache',
                group: 'System',
                icon: 'trash',
                label: 'Clear Cache',
                keywords: ['cache', 'clear', 'reset', 'clean'],
                action: () => this.clearCache(),
            },
            {
                id: 'sys-shortcuts',
                group: 'System',
                icon: 'keyboard',
                label: 'View Keyboard Shortcuts',
                keywords: ['keyboard', 'shortcuts', 'keys', 'hotkeys', 'bindings'],
                action: () => {
                    document.getElementById('shortcuts-modal')?.style.setProperty('display', 'flex');
                },
            },
            {
                id: 'sys-export',
                group: 'System',
                icon: 'upload',
                label: 'Export Data',
                keywords: ['export', 'backup', 'data', 'save'],
                action: () => this.navigateToSetting({ tab: 'system', id: 'export-data-btn' }),
            },
            {
                id: 'sys-search-setting',
                group: 'System',
                icon: 'search',
                label: 'Search Settings...',
                keywords: ['setting', 'find', 'search', 'preference', 'option', 'configure'],
                action: () => this.enterSettingsMode(),
            },

            {
                id: 'acc-profile',
                group: 'Account',
                icon: 'user',
                label: 'View Profile',
                keywords: ['profile', 'account', 'user', 'me'],
                action: () => {
                    document.querySelector('.user-avatar-btn')?.click();
                },
            },
            {
                id: 'acc-edit-profile',
                group: 'Account',
                icon: 'pencil',
                label: 'Edit Profile',
                keywords: ['edit', 'profile', 'username', 'avatar', 'display name'],
                action: async () => {
                    const { openEditProfile } = await import('./profile.js');
                    openEditProfile();
                },
            },
            {
                id: 'acc-sign-out',
                group: 'Account',
                icon: 'logOut',
                label: 'Sign Out',
                keywords: ['sign out', 'log out', 'logout', 'disconnect'],
                action: async () => {
                    const { authManager } = await import('./accounts/auth.js');
                    await authManager.signOut();
                },
            },
            {
                id: 'acc-sign-in',
                group: 'Account',
                icon: 'logIn',
                label: 'Sign In',
                keywords: ['sign in', 'log in', 'login', 'account', 'connect'],
                action: () => {
                    navigate('/account');
                },
            },
        ];
    }

    init() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggle();
            }
        });

        this.input.addEventListener('input', () => this.handleInput());
        this.input.addEventListener('keydown', (e) => this.handleKeydown(e));

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.cacheAllSettings();
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        this.isOpen = true;
        this.settingsMode = false;
        this.overlay.style.display = 'flex';
        this.input.value = '';
        this.input.placeholder = 'Search commands, music, settings...';
        this.input.focus();
        this.showDefaultCommands();
    }

    close() {
        this.isOpen = false;
        this.settingsMode = false;
        this.overlay.style.display = 'none';
        this.cancelMusicSearch();
    }

    enterSettingsMode() {
        this.settingsMode = true;
        this.input.value = '';
        this.input.placeholder = 'Search settings...';
        this.input.focus();
        this.cacheAllSettings();
        this.renderSettingsResults('');
    }

    handleInput() {
        const query = this.input.value.trim();
        this.selectedIndex = 0;

        if (this.settingsMode) {
            this.renderSettingsResults(query);
            return;
        }

        if (!query) {
            this.cancelMusicSearch();
            this.showDefaultCommands();
            return;
        }

        this.searchCommands(query);
        this.debouncedMusicSearch(query);
    }

    handleKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.flatItems.length - 1);
            this.updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.executeSelected();
        } else if (e.key === 'Escape') {
            if (this.settingsMode) {
                this.settingsMode = false;
                this.input.value = '';
                this.input.placeholder = 'Search commands, music, settings...';
                this.showDefaultCommands();
            } else {
                this.close();
            }
        } else if (e.key === 'Backspace' && this.settingsMode && !this.input.value) {
            this.settingsMode = false;
            this.input.placeholder = 'Search commands, music, settings...';
            this.showDefaultCommands();
        }
    }

    showDefaultCommands() {
        const groups = this.groupBy(
            this.commands.filter((c) => {
                const priority = [
                    'nav-home',
                    'nav-library',
                    'nav-settings',
                    'play-pause',
                    'play-next',
                    'play-prev',
                    'play-shuffle',
                    'queue-open',
                    'lyrics-toggle',
                    'fullscreen-open',
                    'sys-search-setting',
                ];
                return priority.includes(c.id);
            }),
            'group'
        );

        this.renderGroups(groups);
    }

    searchCommands(query) {
        const fuseResults = this.fuse.search(query).slice(0, 12);
        const matched = fuseResults.map((r) => r.item);

        if (matched.length === 0) {
            this.renderGroups({});
            return;
        }

        const groups = this.groupBy(matched, 'group');
        this.renderGroups(groups);
    }

    async searchMusic(query) {
        if (!query || query.length < 2) return;

        const api = window.monochromeUi?.api;
        if (!api) return;

        this.cancelMusicSearch();
        const controller = new AbortController();
        this.musicSearchAbort = controller;

        this.showMusicLoading();

        try {
            const [tracks, albums, artists] = await Promise.all([
                api.searchTracks(query, { limit: 4 }),
                api.searchAlbums(query, { limit: 3 }),
                api.searchArtists(query, { limit: 3 }),
            ]);

            if (controller.signal.aborted || !this.isOpen) return;

            const musicGroups = {};

            if (tracks?.items?.length) {
                musicGroups['Tracks'] = tracks.items.map((track) => ({
                    id: `track-${track.id}`,
                    group: 'Tracks',
                    icon: null,
                    image: api.getCoverUrl(track.album?.cover, 80),
                    label: track.title,
                    description: `${track.artist?.name || 'Unknown'} \u2022 ${track.album?.title || ''}`,
                    action: async () => {
                        window.monochromePlayer.setQueue([track], 0);
                        await window.monochromePlayer.playTrackFromQueue();
                    },
                }));
            }

            if (albums?.items?.length) {
                musicGroups['Albums'] = albums.items.map((album) => ({
                    id: `album-${album.id}`,
                    group: 'Albums',
                    icon: null,
                    image: api.getCoverUrl(album.cover, 80),
                    label: album.title,
                    description: album.artist?.name || 'Unknown',
                    action: () => {
                        navigate(`/album/${album.id}`);
                    },
                }));
            }

            if (artists?.items?.length) {
                musicGroups['Artists'] = artists.items.map((artist) => ({
                    id: `artist-${artist.id}`,
                    group: 'Artists',
                    icon: null,
                    image: api.getArtistPictureUrl(artist.picture, 80),
                    label: artist.name,
                    description: 'Artist',
                    action: () => {
                        navigate(`/artist/${artist.id}`);
                    },
                }));
            }

            if (Object.keys(musicGroups).length > 0) {
                this.appendMusicGroups(musicGroups);
            }

            this.removeMusicLoading();
        } catch (e) {
            if (e.name !== 'AbortError') {
                this.removeMusicLoading();
            }
        }
    }

    cancelMusicSearch() {
        if (this.musicSearchAbort) {
            this.musicSearchAbort.abort();
            this.musicSearchAbort = null;
        }
    }

    showMusicLoading() {
        this.removeMusicLoading();
        const loading = document.createElement('div');
        loading.className = 'cmdk-loading';
        loading.setAttribute('data-music-loading', '');
        loading.innerHTML = '<div class="cmdk-loading-spinner"></div>Searching music...';
        this.resultsContainer.appendChild(loading);
    }

    removeMusicLoading() {
        this.resultsContainer.querySelector('[data-music-loading]')?.remove();
    }

    appendMusicGroups(musicGroups) {
        this.removeMusicLoading();
        this.resultsContainer.querySelectorAll('[data-music-group]').forEach((el) => el.remove());

        const startIndex = this.flatItems.length;
        let index = startIndex;

        for (const [heading, items] of Object.entries(musicGroups)) {
            const groupEl = document.createElement('div');
            groupEl.className = 'cmdk-group';
            groupEl.setAttribute('data-music-group', '');

            const headingEl = document.createElement('div');
            headingEl.className = 'cmdk-group-heading';
            headingEl.textContent = heading;
            groupEl.appendChild(headingEl);

            for (const item of items) {
                const itemEl = this.createItemElement(item, index);
                groupEl.appendChild(itemEl);
                this.flatItems.push(item);
                index++;
            }

            this.resultsContainer.appendChild(groupEl);
        }
    }

    groupBy(items, key) {
        const groups = {};
        for (const item of items) {
            const group = item[key] || 'Other';
            if (!groups[group]) groups[group] = [];
            groups[group].push(item);
        }
        return groups;
    }

    renderGroups(groups) {
        this.resultsContainer.innerHTML = '';
        this.flatItems = [];
        let index = 0;

        const groupEntries = Object.entries(groups);
        if (groupEntries.length === 0) {
            const query = this.input.value.trim();
            if (query) {
                const empty = document.createElement('div');
                empty.className = 'cmdk-empty';
                empty.textContent = 'No commands found';
                this.resultsContainer.appendChild(empty);
            }
            return;
        }

        for (const [heading, items] of groupEntries) {
            const groupEl = document.createElement('div');
            groupEl.className = 'cmdk-group';

            const headingEl = document.createElement('div');
            headingEl.className = 'cmdk-group-heading';
            headingEl.textContent = heading;
            groupEl.appendChild(headingEl);

            for (const item of items) {
                const itemEl = this.createItemElement(item, index);
                groupEl.appendChild(itemEl);
                this.flatItems.push(item);
                index++;
            }

            this.resultsContainer.appendChild(groupEl);
        }

        this.updateSelection();
    }

    createItemElement(item, index) {
        const el = document.createElement('div');
        el.className = 'cmdk-item';
        el.setAttribute('data-index', index);
        if (index === this.selectedIndex) el.setAttribute('data-selected', 'true');

        let iconHtml = '';
        if (item.image) {
            iconHtml = `<div class="cmdk-item-icon"><img src="${escapeHtml(item.image)}" crossorigin="anonymous" alt="" loading="lazy" /></div>`;
        } else if (item.icon && ICONS[item.icon]) {
            iconHtml = `<div class="cmdk-item-icon">${ICONS[item.icon]}</div>`;
        }

        let shortcutHtml = '';
        if (item.shortcut) {
            const keys = item.shortcut.split('+');
            shortcutHtml = `<div class="cmdk-item-shortcut">${keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</div>`;
        }

        const descHtml = item.description
            ? `<span class="cmdk-item-description">${escapeHtml(item.description)}</span>`
            : '';

        el.innerHTML = `${iconHtml}<div class="cmdk-item-content"><span class="cmdk-item-label">${escapeHtml(item.label)}</span>${descHtml}</div>${shortcutHtml}`;

        el.addEventListener('click', () => {
            this.selectedIndex = index;
            this.executeSelected();
        });

        el.addEventListener('mouseenter', () => {
            this.selectedIndex = index;
            this.updateSelection();
        });

        return el;
    }

    updateSelection() {
        const items = this.resultsContainer.querySelectorAll('.cmdk-item');
        items.forEach((item) => {
            const idx = parseInt(item.getAttribute('data-index'));
            if (idx === this.selectedIndex) {
                item.setAttribute('data-selected', 'true');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.removeAttribute('data-selected');
            }
        });
    }

    executeSelected() {
        const item = this.flatItems[this.selectedIndex];
        if (!item || !item.action) return;

        item.action();
        this.close();
    }

    renderSettingsResults(query) {
        if (this.allSettings.length === 0) this.cacheAllSettings();

        let results = this.allSettings;
        if (query) {
            const fuse = new Fuse(this.allSettings, {
                keys: ['label', 'description'],
                includeScore: true,
                threshold: 0.4,
                ignoreLocation: true,
            });
            results = fuse.search(query).map((r) => r.item);
        }

        const items = results.map((setting) => ({
            id: `setting-${setting.id}`,
            group: `Settings \u2022 ${setting.tab}`,
            icon: 'settings',
            label: setting.label,
            description: setting.description,
            action: () => this.navigateToSetting(setting),
        }));

        const groups = this.groupBy(items, 'group');
        this.renderGroups(groups);
    }

    cacheAllSettings() {
        const settingItems = document.querySelectorAll('#page-settings .setting-item');
        this.allSettings = Array.from(settingItems)
            .map((item) => {
                const labelEl = item.querySelector('.label');
                const descEl = item.querySelector('.description');
                const tabEl = item.closest('.settings-tab-content');

                const label = labelEl ? labelEl.textContent.trim() : '';
                const description = descEl ? descEl.textContent.trim() : '';
                const tab = tabEl ? tabEl.id.replace('settings-tab-', '') : '';

                if (!item.id) {
                    const inputEl = item.querySelector('input[id], select[id], button[id]');
                    item.id = inputEl
                        ? `setting-item-for-${inputEl.id}`
                        : `setting-item-${Math.random().toString(36).substr(2, 9)}`;
                }

                return { id: item.id, label, description, tab };
            })
            .filter((s) => s.label);
    }

    async navigateToSetting(setting) {
        navigate('/settings');

        await new Promise((resolve) => setTimeout(resolve, 100));

        const tabButton = document.querySelector(`.settings-tab[data-tab="${setting.tab}"]`);
        if (tabButton && !tabButton.classList.contains('active')) {
            tabButton.click();
        }

        await new Promise((resolve) => setTimeout(resolve, 50));

        const settingElement = document.getElementById(setting.id);
        if (settingElement) {
            settingElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            settingElement.style.transition = 'background-color 0.3s ease-out, box-shadow 0.3s ease-out';
            settingElement.style.backgroundColor = 'rgba(var(--highlight-rgb), 0.2)';
            settingElement.style.boxShadow = '0 0 0 2px rgba(var(--highlight-rgb), 0.5)';
            setTimeout(() => {
                settingElement.style.backgroundColor = '';
                settingElement.style.boxShadow = '';
            }, 2000);
        }
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        const themeOptions = document.querySelectorAll('.theme-option');
        themeOptions.forEach((opt) => {
            if (opt.dataset.theme === theme) opt.classList.add('active');
            else opt.classList.remove('active');
        });
        this.notify(`Theme set to ${theme}`);
    }

    async toggleVisualizer() {
        const { visualizerSettings } = await import('./storage.js');
        const current = visualizerSettings.isEnabled();
        visualizerSettings.setEnabled(!current);
        this.notify(`Visualizer ${!current ? 'enabled' : 'disabled'}`);

        const overlay = document.getElementById('fullscreen-cover-overlay');
        if (overlay && getComputedStyle(overlay).display !== 'none') {
            window.monochromeUi?.closeFullscreenCover();
        }
    }

    async setVisualizerPreset(preset) {
        const { visualizerSettings } = await import('./storage.js');
        visualizerSettings.setPreset(preset);
        if (window.monochromeUi?.visualizer) {
            window.monochromeUi.visualizer.setPreset(preset);
        }
        this.notify(`Visualizer preset: ${preset}`);
    }

    async setQuality(quality) {
        const qualityNames = { LOW: 'Low', HIGH: 'High', LOSSLESS: 'Lossless', HI_RES_LOSSLESS: 'Hi-Res' };

        if (window.monochromePlayer) {
            window.monochromePlayer.setQuality(quality);
            localStorage.setItem('playback-quality', quality);
            const streamingSelect = document.getElementById('streaming-quality-setting');
            if (streamingSelect) streamingSelect.value = quality;
        }

        const { downloadQualitySettings } = await import('./storage.js');
        downloadQualitySettings.setQuality(quality);
        const downloadSelect = document.getElementById('download-quality-setting');
        if (downloadSelect) downloadSelect.value = quality;

        this.notify(`Quality set to ${qualityNames[quality] || quality}`);
    }

    setSleepTimer(minutes) {
        if (window.monochromePlayer) {
            window.monochromePlayer.setSleepTimer(minutes);
            this.notify(`Sleep timer: ${minutes} minutes`);
        }
    }

    async likeAllInQueue() {
        const player = window.monochromePlayer;
        const ui = window.monochromeUi;
        if (!player || !ui) return;

        const queue = player.getCurrentQueue();
        if (queue.length === 0) {
            this.notify('Queue is empty');
            return;
        }

        const { handleTrackAction } = await import('./events.js');
        const scrobbler = window.monochromeScrobbler;

        let likedCount = 0;
        this.notify('Liking all tracks in queue...');
        for (const track of queue) {
            const isLiked = await db.isFavorite('track', track.id);
            if (!isLiked) {
                await handleTrackAction('toggle-like', track, player, ui.api, ui.lyricsManager, 'track', ui, scrobbler);
                likedCount++;
            }
        }
        this.notify(`Liked ${likedCount} new track(s)`);
    }

    async downloadQueue() {
        const player = window.monochromePlayer;
        const ui = window.monochromeUi;
        if (!player || !ui) return;

        const queue = player.getCurrentQueue();
        if (queue.length === 0) {
            this.notify('Queue is empty');
            return;
        }

        const { downloadTracks } = await import('./downloads.js');
        const { downloadQualitySettings } = await import('./storage.js');
        downloadTracks(queue, ui.api, downloadQualitySettings.getQuality(), ui.lyricsManager);
    }

    async createPlaylist() {
        const name = `New Playlist ${new Date().toLocaleDateString()}`;
        await db.createPlaylist(name);
        navigate('/library');
        this.notify('Playlist created');
    }

    async createFolder() {
        const name = `New Folder ${new Date().toLocaleDateString()}`;
        await db.createFolder(name);
        navigate('/library');
        this.notify('Folder created');
    }

    async clearCache() {
        const api = window.monochromeUi?.api;
        if (api) {
            await api.clearCache();
            this.notify('Cache cleared');
        }
    }

    async notify(message) {
        const { showNotification } = await import('./downloads.js');
        showNotification(message);
    }
}

new CommandPalette();
