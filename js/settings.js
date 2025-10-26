import { themeManager, lastFMStorage, nowPlayingSettings, lyricsSettings } from './storage.js';

export function initializeSettings(scrobbler, player, api, ui) {
    const lastfmConnectBtn = document.getElementById('lastfm-connect-btn');
    const lastfmStatus = document.getElementById('lastfm-status');
    const lastfmToggle = document.getElementById('lastfm-toggle');
    const lastfmToggleSetting = document.getElementById('lastfm-toggle-setting');
    
    function updateLastFMUI() {
        if (scrobbler.isAuthenticated()) {
            lastfmStatus.textContent = `Connected as ${scrobbler.username}`;
            lastfmConnectBtn.textContent = 'Disconnect';
            lastfmConnectBtn.classList.add('danger');
            lastfmToggleSetting.style.display = 'flex';
            lastfmToggle.checked = lastFMStorage.isEnabled();
        } else {
            lastfmStatus.textContent = 'Connect your Last.fm account to scrobble tracks';
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.classList.remove('danger');
            lastfmToggleSetting.style.display = 'none';
        }
    }
    
    updateLastFMUI();
    
    lastfmConnectBtn?.addEventListener('click', async () => {
        if (scrobbler.isAuthenticated()) {
            if (confirm('Disconnect from Last.fm?')) {
                scrobbler.disconnect();
                updateLastFMUI();
            }
            return;
        }
        
        const authWindow = window.open('', '_blank');
        lastfmConnectBtn.disabled = true;
        lastfmConnectBtn.textContent = 'Opening Last.fm...';
        
        try {
            const { token, url } = await scrobbler.getAuthUrl();
            
            if (authWindow) {
                authWindow.location.href = url;
            } else {
                alert('Popup blocked! Please allow popups.');
                lastfmConnectBtn.textContent = 'Connect Last.fm';
                lastfmConnectBtn.disabled = false;
                return;
            }
            
            lastfmConnectBtn.textContent = 'Waiting for authorization...';
            
            let attempts = 0;
            const maxAttempts = 30;
            
            const checkAuth = setInterval(async () => {
                attempts++;
                
                if (attempts > maxAttempts) {
                    clearInterval(checkAuth);
                    lastfmConnectBtn.textContent = 'Connect Last.fm';
                    lastfmConnectBtn.disabled = false;
                    if (authWindow && !authWindow.closed) authWindow.close();
                    alert('Authorization timed out. Please try again.');
                    return;
                }
                
                try {
                    const result = await scrobbler.completeAuthentication(token);
                    
                    if (result.success) {
                        clearInterval(checkAuth);
                        if (authWindow && !authWindow.closed) authWindow.close();
                        updateLastFMUI();
                        lastfmConnectBtn.disabled = false;
                        lastFMStorage.setEnabled(true);
                        lastfmToggle.checked = true;
                        alert(`Successfully connected to Last.fm as ${result.username}!`);
                    }
                } catch (e) {
                    // Still waiting
                }
            }, 2000);
            
        } catch (error) {
            console.error('Last.fm connection failed:', error);
            alert('Failed to connect to Last.fm: ' + error.message);
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.disabled = false;
            if (authWindow && !authWindow.closed) authWindow.close();
        }
    });
    
    lastfmToggle?.addEventListener('change', (e) => {
        lastFMStorage.setEnabled(e.target.checked);
    });
    
    // Theme picker
    const themePicker = document.getElementById('theme-picker');
    const currentTheme = themeManager.getTheme();
    
    themePicker.querySelectorAll('.theme-option').forEach(option => {
        if (option.dataset.theme === currentTheme) {
            option.classList.add('active');
        }
        
        option.addEventListener('click', () => {
            const theme = option.dataset.theme;
            
            themePicker.querySelectorAll('.theme-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            if (theme === 'custom') {
                document.getElementById('custom-theme-editor').classList.add('show');
                renderCustomThemeEditor();
            } else {
                document.getElementById('custom-theme-editor').classList.remove('show');
                themeManager.setTheme(theme);
            }
        });
    });
    
    function renderCustomThemeEditor() {
        const grid = document.getElementById('theme-color-grid');
        const customTheme = themeManager.getCustomTheme() || {
            background: '#000000',
            foreground: '#fafafa',
            primary: '#ffffff',
            secondary: '#27272a',
            muted: '#27272a',
            border: '#27272a',
            highlight: '#ffffff'
        };
        
        grid.innerHTML = Object.entries(customTheme).map(([key, value]) => `
            <div class="theme-color-input">
                <label>${key}</label>
                <input type="color" data-color="${key}" value="${value}">
            </div>
        `).join('');
    }
    
    document.getElementById('apply-custom-theme')?.addEventListener('click', () => {
        const colors = {};
        document.querySelectorAll('#theme-color-grid input[type="color"]').forEach(input => {
            colors[input.dataset.color] = input.value;
        });
        themeManager.setCustomTheme(colors);
    });
    
    document.getElementById('reset-custom-theme')?.addEventListener('click', () => {
        renderCustomThemeEditor();
    });
    
    // Quality setting
    const qualitySetting = document.getElementById('quality-setting');
    if (qualitySetting) {
        const savedQuality = localStorage.getItem('playback-quality') || 'LOSSLESS';
        qualitySetting.value = savedQuality;
        player.setQuality(savedQuality);
        
        qualitySetting.addEventListener('change', (e) => {
            const newQuality = e.target.value;
            player.setQuality(newQuality);
            localStorage.setItem('playback-quality', newQuality);
        });
    }
    
    // Now Playing Mode
    const nowPlayingMode = document.getElementById('now-playing-mode');
    if (nowPlayingMode) {
        nowPlayingMode.value = nowPlayingSettings.getMode();
        nowPlayingMode.addEventListener('change', (e) => {
            nowPlayingSettings.setMode(e.target.value);
        });
    }
    
    // Download Lyrics Toggle
    const downloadLyricsToggle = document.getElementById('download-lyrics-toggle');
    if (downloadLyricsToggle) {
        downloadLyricsToggle.checked = lyricsSettings.shouldDownloadLyrics();
        downloadLyricsToggle.addEventListener('change', (e) => {
            lyricsSettings.setDownloadLyrics(e.target.checked);
        });
    }
    
    // Filename template setting
    const filenameTemplate = document.getElementById('filename-template');
    if (filenameTemplate) {
        filenameTemplate.value = localStorage.getItem('filename-template') || '{trackNumber} - {artist} - {title}';
        filenameTemplate.addEventListener('change', (e) => {
            localStorage.setItem('filename-template', e.target.value);
        });
    }
    
    // ZIP folder template
    const zipFolderTemplate = document.getElementById('zip-folder-template');
    if (zipFolderTemplate) {
        zipFolderTemplate.value = localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist} - monochrome.tf';
        zipFolderTemplate.addEventListener('change', (e) => {
            localStorage.setItem('zip-folder-template', e.target.value);
        });
    }
    
    // API settings
    document.getElementById('refresh-speed-test-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('refresh-speed-test-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Testing...';
        btn.disabled = true;
        
        try {
            await api.settings.refreshSpeedTests();
            ui.renderApiSettings();
            btn.textContent = 'Done!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        } catch (error) {
            console.error('Failed to refresh speed tests:', error);
            btn.textContent = 'Error';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        }
    });
    
    document.getElementById('api-instance-list')?.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        
        const li = button.closest('li');
        const index = parseInt(li.dataset.index, 10);
        const instances = await api.settings.getInstances();
        
        if (button.classList.contains('move-up') && index > 0) {
            [instances[index], instances[index - 1]] = [instances[index - 1], instances[index]];
        } else if (button.classList.contains('move-down') && index < instances.length - 1) {
            [instances[index], instances[index + 1]] = [instances[index + 1], instances[index]];
        }
        
        api.settings.saveInstances(instances);
        ui.renderApiSettings();
    });
    
    document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('clear-cache-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Clearing...';
        btn.disabled = true;
        
        try {
            await api.clearCache();
            btn.textContent = 'Cleared!';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
                if (window.location.hash.includes('settings')) {
                    ui.renderApiSettings();
                }
            }, 1500);
        } catch (error) {
            console.error('Failed to clear cache:', error);
            btn.textContent = 'Error';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        }
    });
}