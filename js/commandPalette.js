import { debounce } from './utils.js';
import { db } from './db.js';
import Fuse from 'fuse.js';

class CommandPalette {
    constructor() {
        this.overlay = document.getElementById('command-palette-overlay');
        this.input = document.getElementById('command-palette-input');
        this.resultsContainer = document.getElementById('command-palette-results');
        this.isOpen = false;
        this.selectedIndex = 0;
        this.results = [];

        this.allSettings = [];
        this.debouncedSearch = debounce(this.performSearch.bind(this), 300);

        this.commands = [
            {
                name: 'theme',
                description: 'Change theme (white, dark, ocean, purple, forest, etc.)',
                action: (args) => this.handleTheme(args)
            },
            {
                name: 'play',
                description: 'Search and play a track',
                action: (args, autoPick) => this.handlePlay(args, autoPick)
            },
            {
                name: 'shuffle',
                description: 'Shuffle a playlist, artist, or album',
                action: (args, autoPick) => this.handleShuffle(args, autoPick)
            },
            {
                name: 'queue',
                description: 'Manage the queue (wipe, like all, download)',
                action: (args) => this.handleQueue(args)
            },
            {
                name: 'setting',
                description: 'Search for a specific setting',
                action: (args) => this.handleSettingSearch(args)
            },
            {
                name: 'sleep',
                description: 'Set sleep timer in minutes',
                action: (args) => this.handleSleepTimer(args)
            },
            {
                name: 'quality',
                description: 'Set streaming & download quality',
                action: (args) => this.handleQuality(args)
            },
            {
                name: 'visualizer',
                description: 'Control visualizer (toggle, preset)',
                action: (args) => this.handleVisualizer(args)
            },
            {
                name: 'cache',
                description: 'Clear application cache',
                action: () => this.handleClearCache()
            }
        ];

        this.init();
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
        this.overlay.style.display = 'flex';
        this.input.value = '>';
        this.input.focus();
        this.handleInput();
    }

    close() {
        this.isOpen = false;
        this.overlay.style.display = 'none';
    }

    handleInput() {
        const value = this.input.value;
        this.selectedIndex = 0;

        if (!value.startsWith('>')) {
            this.renderResults([{
                name: 'Type > to use commands',
                description: 'e.g. >theme White, >play The Whole World Is Free',
                action: () => { this.input.value = '>'; this.handleInput(); },
                type: 'hint'
            }]);
            return;
        }

        const fullQuery = value.slice(1);
        const match = fullQuery.match(/^(\S+)(?:\s+(.*))?$/);
        
        if (!match) {
            this.renderDefaultCommands();
            return;
        }

        const cmdName = match[1].toLowerCase();
        const args = match[2] || '';

        const command = this.commands.find(c => c.name === cmdName);

        if (command) {
            const commandsWithSubmenus = ['queue', 'go', 'visualizer', 'quality', 'sleep', 'setting'];
            if (commandsWithSubmenus.includes(command.name) && !args.trim()) {
                command.action(args);
                return;
            }

            this.renderResults([{
                name: `Execute: ${command.name} ${args}`,
                description: args ? `Run ${command.name} for "${args}"` : command.description,
                action: () => command.action(args, ['play', 'shuffle', 'setting'].includes(command.name)),
                type: 'execution'
            }]);

            if (args.trim().length > 0 && (cmdName === 'play' || cmdName === 'shuffle')) {
                this.debouncedSearch(cmdName, args.trim());
            }
        } else {
            this.renderDefaultCommands(cmdName);
        }
    }

    handleKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
            this.updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.executeSelected();
        } else if (e.key === 'Escape') {
            this.close();
        }
    }

    renderDefaultCommands(filter = '') {
        let cmds = this.commands;
        if (filter) {
            if (Fuse) {
                const fuse = new Fuse(this.commands, { keys: ['name', 'description'] });
                cmds = fuse.search(filter).map(r => r.item);
            } else {
                cmds = this.commands.filter(c => c.name.includes(filter));
            }
        }
        
        this.renderResults(cmds.map(c => ({
            name: c.name,
            description: c.description,
            action: () => {
                this.input.value = `>${c.name} `;
                this.handleInput();
            },
            type: 'command'
        })));
    }

    renderResults(results) {
        this.results = results;
        this.resultsContainer.innerHTML = '';
        
        if (results.length === 0) {
            this.resultsContainer.innerHTML = '<div style="padding: 1rem; color: var(--muted-foreground); text-align: center;">No results found</div>';
            return;
        }

        results.forEach((result, index) => {
            const div = document.createElement('div');
            div.className = `command-result-item ${index === this.selectedIndex ? 'selected' : ''}`;
            
            const imgHtml = result.image ? `<img src="${result.image}" crossorigin="anonymous" style="width: 32px; height: 32px; border-radius: 4px; margin-right: 10px; object-fit: cover;">` : '';
            
            div.innerHTML = `
                <div style="display: flex; align-items: center;">
                    ${imgHtml}
                    <div style="display: flex; flex-direction: column;"><span class="command-result-name" style="font-weight: 500;">${result.name}</span><span class="command-result-desc" style="font-size: 0.8rem; opacity: 0.7;">${result.description || ''}</span></div>
                </div>
            `;
            div.addEventListener('click', () => {
                this.selectedIndex = index;
                this.executeSelected();
            });
            this.resultsContainer.appendChild(div);
        });
    }

    updateSelection() {
        const items = this.resultsContainer.querySelectorAll('.command-result-item');
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    executeSelected() {
        const result = this.results[this.selectedIndex];
        if (result && result.action) {
            result.action();
            if (result.type !== 'hint') {
                this.close();
            }
        } else if (result && result.type === 'command') {
            this.input.value = `>${result.name} `;
            this.handleInput();
        }
    }

    handleTheme(args) {
        if (!args) return;
        const theme = args.trim().toLowerCase();
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        const themeOptions = document.querySelectorAll('.theme-option');
        themeOptions.forEach(opt => {
            if (opt.dataset.theme === theme) opt.classList.add('active');
            else opt.classList.remove('active');
        });
    }

    async showNotification(message) {
        const { showNotification } = await import('./downloads.js');
        showNotification(message);
    }

    handleQueue(args) {
        const player = window.monochromePlayer;
        const ui = window.monochromeUi;

        if (!player || !ui) {
            console.error('Player or UI not available for queue command');
            return;
        }

        if (!args || !args.trim()) {
            this.renderResults([
                { name: '>queue wipe', description: 'Clear the queue and stop playback' },
                { name: '>queue like all', description: 'Like all tracks in the current queue' },
                { name: '>queue download', description: 'Download all tracks in the current queue' },
            ].map(c => ({
                ...c,
                type: 'command',
                action: () => {
                    this.input.value = c.name;
                    this.handleInput();
                }
            })));
            return;
        }

        const subCommand = args.trim().toLowerCase();

        switch (subCommand) {
            case 'wipe':
                player.wipeQueue();
                this.showNotification('Queue wiped.');
                this.close();
                break;
            case 'like all':
                this.likeAllInQueue(player, ui);
                break;
            case 'download':
                this.downloadQueue(player, ui);
                break;
            default:
                this.showNotification(`Unknown queue command: ${subCommand}`);
                break;
        }
    }

    async likeAllInQueue(player, ui) {
        const queue = player.getCurrentQueue();
        if (queue.length === 0) {
            this.showNotification('Queue is empty.');
            return;
        }

        const { handleTrackAction } = await import('./events.js');
        const scrobbler = window.monochromeScrobbler;
        
        let likedCount = 0;
        this.showNotification('Liking all tracks in queue...');
        for (const track of queue) {
            const isLiked = await db.isFavorite('track', track.id);
            if (!isLiked) {
                await handleTrackAction('toggle-like', track, player, ui.api, ui.lyricsManager, 'track', ui, scrobbler);
                likedCount++;
            }
        }
        this.showNotification(`Liked ${likedCount} new track(s) in the queue.`);
        this.close();
    }

    async downloadQueue(player, ui) {
        const queue = player.getCurrentQueue();
        if (queue.length === 0) {
            this.showNotification('Queue is empty.');
            return;
        }
        
        const { downloadTracks } = await import('./downloads.js');
        const { downloadQualitySettings } = await import('./storage.js');
        const lyricsManager = ui.lyricsManager;
        
        downloadTracks(queue, ui.api, downloadQualitySettings.getQuality(), lyricsManager);
        this.close();
    }

    handleNavigation(args) {
        const validPages = ['home', 'library', 'recent', 'settings', 'unreleased', 'about', 'download'];

        if (!args || !args.trim()) {
            this.renderResults(validPages.map(p => ({
                name: `>go ${p}`,
                description: `Navigate to ${p}`,
                action: () => {
                    this.close();
                    import('./router.js').then(m => m.navigate(p === 'home' ? '/' : `/${p}`));
                },
                type: 'command'
            })));
            return;
        }
        
        const page = args.trim().toLowerCase();
        
        if (validPages.includes(page)) {
            this.close();
            import('./router.js').then(m => m.navigate(page === 'home' ? '/' : `/${page}`));
        } else {
            this.showNotification(`Unknown page: ${page}`);
        }
    }

    handleSleepTimer(args) {
        if (!args || !args.trim()) {
            this.renderResults([15, 30, 45, 60, 120].map(m => ({
                name: `>sleep ${m}`,
                description: `Set sleep timer for ${m} minutes`,
                action: () => {
                    this.setSleepTimer(m);
                    this.close();
                },
                type: 'command'
            })));
            return;
        }

        const minutes = parseInt(args.trim());
        if (!isNaN(minutes) && minutes > 0) {
             this.setSleepTimer(minutes);
             this.close();
        } else {
             this.showNotification("Invalid duration");
        }
    }

    setSleepTimer(minutes) {
        if (window.monochromePlayer) {
            window.monochromePlayer.setSleepTimer(minutes);
            this.showNotification(`Sleep timer set for ${minutes} minutes`);
        }
    }

    handleQuality(args) {
        const qualityMap = {
            'low': 'LOW',
            'high': 'HIGH',
            'lossless': 'LOSSLESS',
            'hires': 'HI_RES_LOSSLESS',
            'hi-res': 'HI_RES_LOSSLESS',
            'master': 'HI_RES_LOSSLESS'
        };

        const displayQualities = [
            { id: 'low', name: 'Low', code: 'LOW' },
            { id: 'high', name: 'High', code: 'HIGH' },
            { id: 'lossless', name: 'Lossless', code: 'LOSSLESS' },
            { id: 'hi-res', name: 'Hi-Res', code: 'HI_RES_LOSSLESS' }
        ];

        if (!args || !args.trim()) {
            const results = displayQualities.map(q => ({
                name: `>quality ${q.id}`,
                description: `Set quality to ${q.name}`,
                action: () => {
                    this.setQuality(q.code, true, true);
                    this.close();
                },
                type: 'command'
            }));

            results.push({
                name: 'Usage: >quality [level] [-S] [-D]',
                description: '-S for Streaming only, -D for Download only',
                action: () => {},
                type: 'hint'
            });
            this.renderResults(results);
            return;
        }

        const parts = args.trim().split(/\s+/);
        const qualityKey = parts.find(p => !p.startsWith('-'))?.toLowerCase();
        const flags = parts.filter(p => p.startsWith('-')).map(f => f.toLowerCase());

        if (!qualityKey || !qualityMap[qualityKey]) {
            this.showNotification('Invalid quality setting');
            return;
        }

        const qualityCode = qualityMap[qualityKey];
        let setStreaming = true;
        let setDownload = true;

        if (flags.includes('-d') && !flags.includes('-s')) {
            setStreaming = false;
        } else if (flags.includes('-s') && !flags.includes('-d')) {
            setDownload = false;
        }
        
        this.setQuality(qualityCode, setStreaming, setDownload);
        this.close();
    }

    async setQuality(quality, setStreaming, setDownload) {
        const messages = [];
        const qualityName = this.getQualityName(quality);

        if (setStreaming) {
            if (window.monochromePlayer) {
                window.monochromePlayer.setQuality(quality);
                localStorage.setItem('playback-quality', quality);
                messages.push('Streaming');

                const streamingSelect = document.getElementById('streaming-quality-setting');
                if (streamingSelect) {
                    streamingSelect.value = quality;
                }
            }
        }

        if (setDownload) {
            const { downloadQualitySettings } = await import('./storage.js');
            downloadQualitySettings.setQuality(quality);
            messages.push('Download');

            const downloadSelect = document.getElementById('download-quality-setting');
            if (downloadSelect) {
                downloadSelect.value = quality;
            }
        }

        if (messages.length > 0) {
            this.showNotification(`${messages.join(' & ')} quality set to ${qualityName}`);
        }
    }

    getQualityName(code) {
        const names = {
            'LOW': 'Low',
            'HIGH': 'High',
            'LOSSLESS': 'Lossless',
            'HI_RES_LOSSLESS': 'Hi-Res'
        };
        return names[code] || code;
    }

    async handleVisualizer(args) {
        if (!args || !args.trim()) {
            this.renderResults([
                { name: '>visualizer toggle', description: 'Toggle visualizer on/off', cmd: 'toggle' },
                { name: '>visualizer butterchurn', description: 'Set preset to Butterchurn', cmd: 'butterchurn' },
                { name: '>visualizer kawarp', description: 'Set preset to Kawarp', cmd: 'kawarp' },
                { name: '>visualizer lcd', description: 'Set preset to LCD', cmd: 'lcd' },
                { name: '>visualizer particles', description: 'Set preset to Particles', cmd: 'particles' },
                { name: '>visualizer unknown-pleasures', description: 'Set preset to Unknown Pleasures', cmd: 'unknown-pleasures' }
            ].map(c => ({
                ...c,
                action: () => {
                    if (c.cmd === 'toggle') {
                        this.toggleVisualizer();
                    } else {
                        this.setVisualizerPreset(c.cmd);
                    }
                    this.close();
                },
                type: 'command'
            })));
            return;
        }

        const subCmd = args.trim().toLowerCase();
        if (subCmd === 'toggle') {
            this.toggleVisualizer();
            this.close();
        } else {
            const presets = ['butterchurn', 'kawarp', 'lcd', 'particles', 'unknown-pleasures'];
            if (presets.includes(subCmd)) {
                this.setVisualizerPreset(subCmd);
                this.close();
            } else {
                this.showNotification('Unknown visualizer command');
            }
        }
    }

    async toggleVisualizer() {
        const { visualizerSettings } = await import('./storage.js');
        const current = visualizerSettings.isEnabled();
        visualizerSettings.setEnabled(!current);
        this.showNotification(`Visualizer ${!current ? 'enabled' : 'disabled'}`);
        
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
        this.showNotification(`Visualizer preset set to ${preset}`);
    }

    async handleClearCache() {
        const api = window.monochromeUi?.api;
        if (api) {
            await api.clearCache();
            this.showNotification('Cache cleared');
            this.close();
        }
    }

    cacheAllSettings() {
        const settingItems = document.querySelectorAll('#page-settings .setting-item');
        this.allSettings = Array.from(settingItems).map(item => {
            const labelEl = item.querySelector('.label');
            const descEl = item.querySelector('.description');
            const tabEl = item.closest('.settings-tab-content');
            
            const label = labelEl ? labelEl.textContent.trim() : '';
            const description = descEl ? descEl.textContent.trim() : '';
            const tab = tabEl ? tabEl.id.replace('settings-tab-', '') : '';
            
            if (!item.id) {
                const inputEl = item.querySelector('input[id], select[id], button[id]');
                item.id = inputEl ? `setting-item-for-${inputEl.id}` : `setting-item-${Math.random().toString(36).substr(2, 9)}`;
            }

            return {
                id: item.id,
                label,
                description,
                tab,
            };
        }).filter(s => s.label);
    }

    async handleSettingSearch(args, autoPick = false) {
        const query = args.trim().toLowerCase();

        if (!query) {
            this.renderResults(this.allSettings.map(setting => ({
                name: setting.label,
                description: `[${setting.tab}] ${setting.description}`,
                action: () => {
                    this.navigateToSetting(setting);
                    this.close();
                },
                type: 'setting'
            })));
            return;
        }

        const fuse = new Fuse(this.allSettings, {
            keys: ['label', 'description'],
            includeScore: true,
            threshold: 0.4,
            ignoreLocation: true,
        });

        const results = fuse.search(query).map(r => r.item);

        if (autoPick && results.length > 0) {
            this.navigateToSetting(results[0]);
            this.close();
            return;
        }

        this.renderResults(results.map(setting => ({
            name: setting.label,
            description: `[${setting.tab}] ${setting.description}`,
            action: () => {
                this.navigateToSetting(setting);
                this.close();
            },
            type: 'setting'
        })));
    }

    async navigateToSetting(setting) {
        const router = await import('./router.js');
        router.navigate('/settings');

        await new Promise(resolve => setTimeout(resolve, 100));

            const tabButton = document.querySelector(`.settings-tab[data-tab="${setting.tab}"]`);
            if (tabButton && !tabButton.classList.contains('active')) {
                tabButton.click();
            }

        await new Promise(resolve => setTimeout(resolve, 50));

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


    async performSearch(cmdName, query) {
        if (!this.isOpen) return;
        
        const api = window.monochromeUi?.api;
        if (!api) return;

        let results = [];

        try {
            if (cmdName === 'play') {
                const data = await api.searchTracks(query);
                results = data.items.map(track => ({
                    name: track.title,
                    description: `${track.artist?.name || 'Unknown'} • ${track.album?.title || 'Unknown'}`,
                    image: api.getCoverUrl(track.album?.cover, 80),
                    action: () => {
                        window.monochromePlayer.setQueue([track], 0);
                        window.monochromePlayer.playTrackFromQueue();
                        this.close();
                    },
                    type: 'result'
                }));
            } else if (cmdName === 'shuffle') {
                const [albums, artists, playlists, userPlaylists] = await Promise.all([
                    api.searchAlbums(query),
                    api.searchArtists(query),
                    api.searchPlaylists(query),
                    db.getPlaylists(true)
                ]);

                let matchedUserPlaylists = [];
                if (Fuse) {
                    const fuse = new Fuse(userPlaylists, { keys: ['name'] });
                    matchedUserPlaylists = fuse.search(query).map(r => r.item);
                } else {
                    matchedUserPlaylists = userPlaylists.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
                }

                const formatResult = (item, type, subtitle, image) => ({
                    name: item.title || item.name,
                    description: `${type} • ${subtitle}`,
                    image: image,
                    action: () => this.playCollection(item, type, true),
                    type: 'result'
                });

                results = [
                    ...matchedUserPlaylists.map(p => formatResult(p, 'User Playlist', `${p.tracks?.length || 0} tracks`, p.cover || (p.images && p.images[0]))),
                    ...artists.items.map(a => formatResult(a, 'Artist', 'Artist', api.getArtistPictureUrl(a.picture, 80))),
                    ...albums.items.map(a => formatResult(a, 'Album', a.artist?.name, api.getCoverUrl(a.cover, 80))),
                    ...playlists.items.map(p => formatResult(p, 'Playlist', p.creator?.name || 'Tidal', api.getCoverUrl(p.image, 80)))
                ];
            }
        } catch (e) {
            console.error('Command palette search error:', e);
        }

        if (this.isOpen && results.length > 0) {
            this.renderResults(results);
        }
    }

    async handlePlay(args, autoPick) {
        if (!args) return;
        
        if (autoPick) {
            const api = window.monochromeUi?.api;
            const results = await api.searchTracks(args);
            if (results.items.length > 0) {
                const track = results.items[0];
                window.monochromePlayer.setQueue([track], 0);
                window.monochromePlayer.playTrackFromQueue();
                this.close();
            }
        }
    }

    async handleShuffle(args, autoPick) {
        if (!args) return;
        
        if (autoPick) {
            this.performSearch('shuffle', args).then(() => {
                if (this.results.length > 0 && this.results[0].action) {
                    this.results[0].action();
                }
            });
        }
    }

    async playCollection(item, type, shuffle) {
        const player = window.monochromePlayer;
        const api = window.monochromeUi.api;
        let tracks = [];

        try {
            if (type === 'User Playlist') {
                tracks = item.tracks;
            } else if (type === 'Artist') {
                const artist = await api.getArtist(item.id);
                const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
                const trackSet = new Set();
                const allTracks = [];

                const chunkSize = 8;
                for (let i = 0; i < allReleases.length; i += chunkSize) {
                    const chunk = allReleases.slice(i, i + chunkSize);
                    await Promise.all(
                        chunk.map(async (album) => {
                            try {
                                const { tracks: albumTracks } = await api.getAlbum(album.id);
                                albumTracks.forEach((track) => {
                                    if (!trackSet.has(track.id)) {
                                        trackSet.add(track.id);
                                        allTracks.push(track);
                                    }
                                });
                            } catch (err) {
                                console.warn(`Failed to fetch tracks for album ${album.title}:`, err);
                            }
                        })
                    );
                }
                
                if (allTracks.length > 0) {
                    tracks = allTracks;
                } else {
                    tracks = artist.tracks || [];
                }
            } else if (type === 'Album') {
                tracks = (await api.getAlbum(item.id)).tracks;
            } else if (type === 'Playlist') {
                tracks = (await api.getPlaylist(item.uuid)).tracks;
            }

            if (tracks && tracks.length > 0) {
                if (shuffle) {
                    tracks = [...tracks].sort(() => Math.random() - 0.5);
                    player.shuffleActive = true;
                    document.getElementById('shuffle-btn')?.classList.add('active');
                }
                player.setQueue(tracks, 0);
                player.playTrackFromQueue();
                this.close();
            }
        } catch (e) {
            console.error('Failed to play collection:', e);
        }
    }
}

new CommandPalette();