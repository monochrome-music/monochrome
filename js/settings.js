//js/settings
import {
    themeManager,
    lastFMStorage,
    nowPlayingSettings,
    lyricsSettings,
    backgroundSettings,
    trackListSettings,
    cardSettings,
    waveformSettings,
    replayGainSettings,
    smoothScrollingSettings,
    downloadQualitySettings,
    coverArtSizeSettings,
    qualityBadgeSettings,
    visualizerSettings,
    bulkDownloadSettings,
} from './storage.js';
import { db } from './db.js';
import { authManager } from './accounts/auth.js';
import { syncManager } from './accounts/pocketbase.js';
import { saveFirebaseConfig, clearFirebaseConfig } from './accounts/config.js';

export function initializeSettings(scrobbler, player, api, ui) {
    // Initialize account system UI & Settings
    authManager.updateUI(authManager.user);

    // Email Auth UI Logic
    const toggleEmailBtn = document.getElementById('toggle-email-auth-btn');
    const cancelEmailBtn = document.getElementById('cancel-email-auth-btn');
    const authContainer = document.getElementById('email-auth-container');
    const authButtonsContainer = document.getElementById('auth-buttons-container');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const signInBtn = document.getElementById('email-signin-btn');
    const signUpBtn = document.getElementById('email-signup-btn');

    if (toggleEmailBtn && authContainer && authButtonsContainer) {
        toggleEmailBtn.addEventListener('click', () => {
            authContainer.style.display = 'flex';
            authButtonsContainer.style.display = 'none';
        });
    }

    if (cancelEmailBtn && authContainer && authButtonsContainer) {
        cancelEmailBtn.addEventListener('click', () => {
            authContainer.style.display = 'none';
            authButtonsContainer.style.display = 'flex';
        });
    }

    if (signInBtn) {
        signInBtn.addEventListener('click', async () => {
            const email = emailInput.value;
            const password = passwordInput.value;
            if (!email || !password) {
                alert('Please enter both email and password.');
                return;
            }
            try {
                await authManager.signInWithEmail(email, password);
                authContainer.style.display = 'none';
                authButtonsContainer.style.display = 'flex';
                emailInput.value = '';
                passwordInput.value = '';
            } catch {
                // Error handled in authManager
            }
        });
    }

    if (signUpBtn) {
        signUpBtn.addEventListener('click', async () => {
            const email = emailInput.value;
            const password = passwordInput.value;
            if (!email || !password) {
                alert('Please enter both email and password.');
                return;
            }
            try {
                await authManager.signUpWithEmail(email, password);
                authContainer.style.display = 'none';
                authButtonsContainer.style.display = 'flex';
                emailInput.value = '';
                passwordInput.value = '';
            } catch {
                // Error handled in authManager
            }
        });
    }

    const lastfmConnectBtn = document.getElementById('lastfm-connect-btn');
    const lastfmStatus = document.getElementById('lastfm-status');
    const lastfmToggle = document.getElementById('lastfm-toggle');
    const lastfmToggleSetting = document.getElementById('lastfm-toggle-setting');
    const lastfmLoveToggle = document.getElementById('lastfm-love-toggle');
    const lastfmLoveSetting = document.getElementById('lastfm-love-setting');

    function updateLastFMUI() {
        if (scrobbler.isAuthenticated()) {
            lastfmStatus.textContent = `Connected as ${scrobbler.username}`;
            lastfmConnectBtn.textContent = 'Disconnect';
            lastfmConnectBtn.classList.add('danger');
            lastfmToggleSetting.style.display = 'flex';
            lastfmLoveSetting.style.display = 'flex';
            lastfmToggle.checked = lastFMStorage.isEnabled();
            lastfmLoveToggle.checked = lastFMStorage.shouldLoveOnLike();
        } else {
            lastfmStatus.textContent = 'Connect your Last.fm account to scrobble tracks';
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.classList.remove('danger');
            lastfmToggleSetting.style.display = 'none';
            lastfmLoveSetting.style.display = 'none';
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
                } catch {
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

    lastfmLoveToggle?.addEventListener('change', (e) => {
        lastFMStorage.setLoveOnLike(e.target.checked);
    });

    // Theme picker
    const themePicker = document.getElementById('theme-picker');
    const currentTheme = themeManager.getTheme();

    themePicker.querySelectorAll('.theme-option').forEach((option) => {
        if (option.dataset.theme === currentTheme) {
            option.classList.add('active');
        }

        option.addEventListener('click', () => {
            const theme = option.dataset.theme;

            themePicker.querySelectorAll('.theme-option').forEach((opt) => opt.classList.remove('active'));
            option.classList.add('active');

            if (theme === 'custom') {
                document.getElementById('custom-theme-editor').classList.add('show');
                renderCustomThemeEditor();
                themeManager.setTheme('custom');
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
            highlight: '#ffffff',
        };

        grid.innerHTML = Object.entries(customTheme)
            .map(
                ([key, value]) => `
            <div class="theme-color-input">
                <label>${key}</label>
                <input type="color" data-color="${key}" value="${value}">
            </div>
        `
            )
            .join('');
    }

    document.getElementById('apply-custom-theme')?.addEventListener('click', () => {
        const colors = {};
        document.querySelectorAll('#theme-color-grid input[type="color"]').forEach((input) => {
            colors[input.dataset.color] = input.value;
        });
        themeManager.setCustomTheme(colors);
    });

    document.getElementById('reset-custom-theme')?.addEventListener('click', () => {
        renderCustomThemeEditor();
    });

    // Streaming Quality setting
    const streamingQualitySetting = document.getElementById('streaming-quality-setting');
    if (streamingQualitySetting) {
        const savedQuality = localStorage.getItem('playback-quality') || 'HI_RES_LOSSLESS';
        streamingQualitySetting.value = savedQuality;
        player.setQuality(savedQuality);

        streamingQualitySetting.addEventListener('change', (e) => {
            const newQuality = e.target.value;
            player.setQuality(newQuality);
            localStorage.setItem('playback-quality', newQuality);
        });
    }

    // Download Quality setting
    const downloadQualitySetting = document.getElementById('download-quality-setting');
    if (downloadQualitySetting) {
        downloadQualitySetting.value = downloadQualitySettings.getQuality();

        downloadQualitySetting.addEventListener('change', (e) => {
            downloadQualitySettings.setQuality(e.target.value);
        });
    }

    // Cover Art Size setting
    const coverArtSizeSetting = document.getElementById('cover-art-size-setting');
    if (coverArtSizeSetting) {
        coverArtSizeSetting.value = coverArtSizeSettings.getSize();

        coverArtSizeSetting.addEventListener('change', (e) => {
            coverArtSizeSettings.setSize(e.target.value);
        });
    }

    // Quality Badge Settings
    const showQualityBadgesToggle = document.getElementById('show-quality-badges-toggle');
    if (showQualityBadgesToggle) {
        showQualityBadgesToggle.checked = qualityBadgeSettings.isEnabled();
        showQualityBadgesToggle.addEventListener('change', (e) => {
            qualityBadgeSettings.setEnabled(e.target.checked);
            // Re-render to reflect changes
            ui.renderLibraryPage();
            if (window.renderQueueFunction) window.renderQueueFunction();
        });
    }

    const zippedBulkDownloadsToggle = document.getElementById('zipped-bulk-downloads-toggle');
    if (zippedBulkDownloadsToggle) {
        zippedBulkDownloadsToggle.checked = !bulkDownloadSettings.shouldForceIndividual();
        zippedBulkDownloadsToggle.addEventListener('change', (e) => {
            bulkDownloadSettings.setForceIndividual(!e.target.checked);
        });
    }

    // ReplayGain Settings
    const replayGainMode = document.getElementById('replay-gain-mode');
    if (replayGainMode) {
        replayGainMode.value = replayGainSettings.getMode();
        replayGainMode.addEventListener('change', (e) => {
            replayGainSettings.setMode(e.target.value);
            player.applyReplayGain();
        });
    }

    const replayGainPreamp = document.getElementById('replay-gain-preamp');
    if (replayGainPreamp) {
        replayGainPreamp.value = replayGainSettings.getPreamp();
        replayGainPreamp.addEventListener('change', (e) => {
            replayGainSettings.setPreamp(parseFloat(e.target.value) || 3);
            player.applyReplayGain();
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

    // Track List Actions Mode
    const trackListActionsMode = document.getElementById('track-list-actions-mode');
    if (trackListActionsMode) {
        trackListActionsMode.value = trackListSettings.getMode();
        trackListActionsMode.addEventListener('change', (e) => {
            trackListSettings.setMode(e.target.value);
        });
    }

    // Compact Artist Toggle
    const compactArtistToggle = document.getElementById('compact-artist-toggle');
    if (compactArtistToggle) {
        compactArtistToggle.checked = cardSettings.isCompactArtist();
        compactArtistToggle.addEventListener('change', (e) => {
            cardSettings.setCompactArtist(e.target.checked);
        });
    }

    // Compact Album Toggle
    const compactAlbumToggle = document.getElementById('compact-album-toggle');
    if (compactAlbumToggle) {
        compactAlbumToggle.checked = cardSettings.isCompactAlbum();
        compactAlbumToggle.addEventListener('change', (e) => {
            cardSettings.setCompactAlbum(e.target.checked);
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

    // Romaji Lyrics Toggle
    const romajiLyricsToggle = document.getElementById('romaji-lyrics-toggle');
    if (romajiLyricsToggle) {
        romajiLyricsToggle.checked = localStorage.getItem('lyricsRomajiMode') === 'true';
        romajiLyricsToggle.addEventListener('change', (e) => {
            localStorage.setItem('lyricsRomajiMode', e.target.checked ? 'true' : 'false');
        });
    }

    // Album Background Toggle
    const albumBackgroundToggle = document.getElementById('album-background-toggle');
    if (albumBackgroundToggle) {
        albumBackgroundToggle.checked = backgroundSettings.isEnabled();
        albumBackgroundToggle.addEventListener('change', (e) => {
            backgroundSettings.setEnabled(e.target.checked);
        });
    }

    // Waveform Toggle
    const waveformToggle = document.getElementById('waveform-toggle');
    if (waveformToggle) {
        waveformToggle.checked = waveformSettings.isEnabled();
        waveformToggle.addEventListener('change', (e) => {
            waveformSettings.setEnabled(e.target.checked);

            window.dispatchEvent(new CustomEvent('waveform-toggle', { detail: { enabled: e.target.checked } }));
        });
    }

    // Smooth Scrolling Toggle
    const smoothScrollingToggle = document.getElementById('smooth-scrolling-toggle');
    if (smoothScrollingToggle) {
        smoothScrollingToggle.checked = smoothScrollingSettings.isEnabled();
        smoothScrollingToggle.addEventListener('change', (e) => {
            smoothScrollingSettings.setEnabled(e.target.checked);

            window.dispatchEvent(new CustomEvent('smooth-scrolling-toggle', { detail: { enabled: e.target.checked } }));
        });
    }

    // Visualizer Sensitivity
    const visualizerSensitivitySlider = document.getElementById('visualizer-sensitivity-slider');
    const visualizerSensitivityValue = document.getElementById('visualizer-sensitivity-value');
    if (visualizerSensitivitySlider && visualizerSensitivityValue) {
        const currentSensitivity = visualizerSettings.getSensitivity();
        visualizerSensitivitySlider.value = currentSensitivity;
        visualizerSensitivityValue.textContent = `${(currentSensitivity * 100).toFixed(0)}%`;

        visualizerSensitivitySlider.addEventListener('input', (e) => {
            const newSensitivity = parseFloat(e.target.value);
            visualizerSettings.setSensitivity(newSensitivity);
            visualizerSensitivityValue.textContent = `${(newSensitivity * 100).toFixed(0)}%`;
        });
    }

    // Visualizer Smart Intensity
    const smartIntensityToggle = document.getElementById('smart-intensity-toggle');
    if (smartIntensityToggle) {
        const isSmart = visualizerSettings.isSmartIntensityEnabled();
        smartIntensityToggle.checked = isSmart;

        const updateSliderState = (enabled) => {
            if (visualizerSensitivitySlider) {
                visualizerSensitivitySlider.disabled = enabled;
                visualizerSensitivitySlider.parentElement.style.opacity = enabled ? '0.5' : '1';
                visualizerSensitivitySlider.parentElement.style.pointerEvents = enabled ? 'none' : 'auto';
            }
        };
        updateSliderState(isSmart);

        smartIntensityToggle.addEventListener('change', (e) => {
            visualizerSettings.setSmartIntensity(e.target.checked);
            updateSliderState(e.target.checked);
        });
    }

    // Visualizer Enabled Toggle
    const visualizerEnabledToggle = document.getElementById('visualizer-enabled-toggle');
    const visualizerModeSetting = document.getElementById('visualizer-mode-setting');
    const visualizerSmartIntensitySetting = document.getElementById('visualizer-smart-intensity-setting');
    const visualizerSensitivitySetting = document.getElementById('visualizer-sensitivity-setting');
    const visualizerPresetSetting = document.getElementById('visualizer-preset-setting');

    const updateVisualizerSettingsVisibility = (enabled) => {
        const display = enabled ? 'flex' : 'none';
        if (visualizerModeSetting) visualizerModeSetting.style.display = display;
        if (visualizerSmartIntensitySetting) visualizerSmartIntensitySetting.style.display = display;
        if (visualizerSensitivitySetting) visualizerSensitivitySetting.style.display = display;
        if (visualizerPresetSetting) visualizerPresetSetting.style.display = display;
    };

    if (visualizerEnabledToggle) {
        visualizerEnabledToggle.checked = visualizerSettings.isEnabled();
        updateVisualizerSettingsVisibility(visualizerEnabledToggle.checked);

        visualizerEnabledToggle.addEventListener('change', (e) => {
            visualizerSettings.setEnabled(e.target.checked);
            updateVisualizerSettingsVisibility(e.target.checked);
        });
    }

    // Visualizer Preset Select
    const visualizerPresetSelect = document.getElementById('visualizer-preset-select');
    if (visualizerPresetSelect) {
        visualizerPresetSelect.value = visualizerSettings.getPreset();
        visualizerPresetSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            visualizerSettings.setPreset(val);
            // Assuming 'ui' has access to 'visualizer' instance or we need to find it
            // 'ui' is passed to initializeSettings. 
            // In ui.js, 'visualizer' is a property of UIRenderer.
            if (ui && ui.visualizer) {
                ui.visualizer.setPreset(val);
            }
        });
    }

    // Visualizer Mode Select
    const visualizerModeSelect = document.getElementById('visualizer-mode-select');
    if (visualizerModeSelect) {
        visualizerModeSelect.value = visualizerSettings.getMode();
        visualizerModeSelect.addEventListener('change', (e) => {
            visualizerSettings.setMode(e.target.value);
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
        zipFolderTemplate.value = localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}';
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
        const type = li.dataset.type || 'api'; // Default to api if not present

        const instances = await api.settings.getInstances(type);

        if (button.classList.contains('move-up') && index > 0) {
            [instances[index], instances[index - 1]] = [instances[index - 1], instances[index]];
        } else if (button.classList.contains('move-down') && index < instances.length - 1) {
            [instances[index], instances[index + 1]] = [instances[index + 1], instances[index]];
        }

        api.settings.saveInstances(instances, type);
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

    document.getElementById('firebase-clear-cloud-btn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete ALL your data from the cloud? This cannot be undone.')) {
            try {
                await syncManager.clearCloudData();
                alert('Cloud data cleared successfully.');
                authManager.signOut();
            } catch (error) {
                console.error('Failed to clear cloud data:', error);
                alert('Failed to clear cloud data: ' + error.message);
            }
        }
    });

    // Backup & Restore
    document.getElementById('export-library-btn')?.addEventListener('click', async () => {
        const data = await db.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `monochrome-library-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const importInput = document.getElementById('import-library-input');
    document.getElementById('import-library-btn')?.addEventListener('click', () => {
        importInput.click();
    });

    importInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                await db.importData(data);
                alert('Library imported successfully!');
                window.location.reload(); // Simple way to refresh all state
            } catch (err) {
                console.error('Import failed:', err);
                alert('Failed to import library. Please check the file format.');
            }
        };
        reader.readAsText(file);
    });

    const customDbBtn = document.getElementById('custom-db-btn');
    const customDbModal = document.getElementById('custom-db-modal');
    const customPbUrlInput = document.getElementById('custom-pb-url');
    const customFirebaseConfigInput = document.getElementById('custom-firebase-config');
    const customDbSaveBtn = document.getElementById('custom-db-save');
    const customDbResetBtn = document.getElementById('custom-db-reset');
    const customDbCancelBtn = document.getElementById('custom-db-cancel');

    if (customDbBtn && customDbModal) {
        customDbBtn.addEventListener('click', () => {
            const pbUrl = localStorage.getItem('monochrome-pocketbase-url') || '';
            const fbConfig = localStorage.getItem('monochrome-firebase-config');

            customPbUrlInput.value = pbUrl;
            if (fbConfig) {
                try {
                    customFirebaseConfigInput.value = JSON.stringify(JSON.parse(fbConfig), null, 2);
                } catch {
                    customFirebaseConfigInput.value = fbConfig;
                }
            } else {
                customFirebaseConfigInput.value = '';
            }

            customDbModal.classList.add('active');
        });

        const closeCustomDbModal = () => {
            customDbModal.classList.remove('active');
        };

        customDbCancelBtn.addEventListener('click', closeCustomDbModal);
        customDbModal.querySelector('.modal-overlay').addEventListener('click', closeCustomDbModal);

        customDbSaveBtn.addEventListener('click', () => {
            const pbUrl = customPbUrlInput.value.trim();
            const fbConfigStr = customFirebaseConfigInput.value.trim();

            if (pbUrl) {
                localStorage.setItem('monochrome-pocketbase-url', pbUrl);
            } else {
                localStorage.removeItem('monochrome-pocketbase-url');
            }

            if (fbConfigStr) {
                try {
                    const fbConfig = JSON.parse(fbConfigStr);
                    saveFirebaseConfig(fbConfig);
                } catch {
                    alert('Invalid JSON for Firebase Config');
                    return;
                }
            } else {
                clearFirebaseConfig();
            }

            alert('Settings saved. Reloading...');
            window.location.reload();
        });

        customDbResetBtn.addEventListener('click', () => {
            if (confirm('Reset custom database settings to default?')) {
                localStorage.removeItem('monochrome-pocketbase-url');
                clearFirebaseConfig();
                alert('Settings reset. Reloading...');
                window.location.reload();
            }
        });
    }
}
