//js/settings
import {
    themeManager,
    lastFMStorage,
    nowPlayingSettings,
    lyricsSettings,
    backgroundSettings,
    cardSettings,
    waveformSettings,
    replayGainSettings,
    smoothScrollingSettings,
    downloadQualitySettings,
    coverArtSizeSettings,
    qualityBadgeSettings,
    trackDateSettings,
    visualizerSettings,
    bulkDownloadSettings,
    playlistSettings,
    equalizerSettings,
    listenBrainzSettings,
    malojaSettings,
    libreFmSettings,
    homePageSettings,
    sidebarSectionSettings,
} from './storage.js';
import { audioContextManager, EQ_PRESETS } from './audio-context.js';
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
    const resetPasswordBtn = document.getElementById('reset-password-btn');

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

    if (resetPasswordBtn) {
        resetPasswordBtn.addEventListener('click', async () => {
            const email = emailInput.value;
            if (!email) {
                alert('Please enter your email address to reset your password.');
                return;
            }
            try {
                await authManager.sendPasswordReset(email);
            } catch {
                /* ignore */
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
        if (scrobbler.lastfm.isAuthenticated()) {
            lastfmStatus.textContent = `Connected as ${scrobbler.lastfm.username}`;
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
        if (scrobbler.lastfm.isAuthenticated()) {
            if (confirm('Disconnect from Last.fm?')) {
                scrobbler.lastfm.disconnect();
                updateLastFMUI();
            }
            return;
        }

        const authWindow = window.open('', '_blank');
        lastfmConnectBtn.disabled = true;
        lastfmConnectBtn.textContent = 'Opening Last.fm...';

        try {
            const { token, url } = await scrobbler.lastfm.getAuthUrl();

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
                    const result = await scrobbler.lastfm.completeAuthentication(token);

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

    // Last.fm Toggles
    if (lastfmToggle) {
        lastfmToggle.addEventListener('change', (e) => {
            lastFMStorage.setEnabled(e.target.checked);
        });
    }

    if (lastfmLoveToggle) {
        lastfmLoveToggle.addEventListener('change', (e) => {
            lastFMStorage.setLoveOnLike(e.target.checked);
        });
    }

    // ========================================
    // ListenBrainz Settings
    // ========================================
    const lbToggle = document.getElementById('listenbrainz-enabled-toggle');
    const lbTokenSetting = document.getElementById('listenbrainz-token-setting');
    const lbCustomUrlSetting = document.getElementById('listenbrainz-custom-url-setting');
    const lbTokenInput = document.getElementById('listenbrainz-token-input');
    const lbCustomUrlInput = document.getElementById('listenbrainz-custom-url-input');

    const updateListenBrainzUI = () => {
        const isEnabled = listenBrainzSettings.isEnabled();
        if (lbToggle) lbToggle.checked = isEnabled;
        if (lbTokenSetting) lbTokenSetting.style.display = isEnabled ? 'flex' : 'none';
        if (lbCustomUrlSetting) lbCustomUrlSetting.style.display = isEnabled ? 'flex' : 'none';
        if (lbTokenInput) lbTokenInput.value = listenBrainzSettings.getToken();
        if (lbCustomUrlInput) lbCustomUrlInput.value = listenBrainzSettings.getCustomUrl();
    };

    updateListenBrainzUI();

    if (lbToggle) {
        lbToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            listenBrainzSettings.setEnabled(enabled);
            updateListenBrainzUI();
        });
    }

    if (lbTokenInput) {
        lbTokenInput.addEventListener('change', (e) => {
            listenBrainzSettings.setToken(e.target.value.trim());
        });
    }

    if (lbCustomUrlInput) {
        lbCustomUrlInput.addEventListener('change', (e) => {
            listenBrainzSettings.setCustomUrl(e.target.value.trim());
        });
    }

    // ========================================
    // Maloja Settings
    // ========================================
    const malojaToggle = document.getElementById('maloja-enabled-toggle');
    const malojaTokenSetting = document.getElementById('maloja-token-setting');
    const malojaCustomUrlSetting = document.getElementById('maloja-custom-url-setting');
    const malojaTokenInput = document.getElementById('maloja-token-input');
    const malojaCustomUrlInput = document.getElementById('maloja-custom-url-input');

    const updateMalojaUI = () => {
        const isEnabled = malojaSettings.isEnabled();
        if (malojaToggle) malojaToggle.checked = isEnabled;
        if (malojaTokenSetting) malojaTokenSetting.style.display = isEnabled ? 'flex' : 'none';
        if (malojaCustomUrlSetting) malojaCustomUrlSetting.style.display = isEnabled ? 'flex' : 'none';
        if (malojaTokenInput) malojaTokenInput.value = malojaSettings.getToken();
        if (malojaCustomUrlInput) malojaCustomUrlInput.value = malojaSettings.getCustomUrl();
    };

    updateMalojaUI();

    if (malojaToggle) {
        malojaToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            malojaSettings.setEnabled(enabled);
            updateMalojaUI();
        });
    }

    if (malojaTokenInput) {
        malojaTokenInput.addEventListener('change', (e) => {
            malojaSettings.setToken(e.target.value.trim());
        });
    }

    if (malojaCustomUrlInput) {
        malojaCustomUrlInput.addEventListener('change', (e) => {
            malojaSettings.setCustomUrl(e.target.value.trim());
        });
    }

    // ========================================
    // Libre.fm Settings
    // ========================================
    const librefmConnectBtn = document.getElementById('librefm-connect-btn');
    const librefmStatus = document.getElementById('librefm-status');
    const librefmToggle = document.getElementById('librefm-toggle');
    const librefmToggleSetting = document.getElementById('librefm-toggle-setting');
    const librefmLoveToggle = document.getElementById('librefm-love-toggle');
    const librefmLoveSetting = document.getElementById('librefm-love-setting');

    function updateLibreFmUI() {
        if (scrobbler.librefm.isAuthenticated()) {
            librefmStatus.textContent = `Connected as ${scrobbler.librefm.username}`;
            librefmConnectBtn.textContent = 'Disconnect';
            librefmConnectBtn.classList.add('danger');
            librefmToggleSetting.style.display = 'flex';
            librefmLoveSetting.style.display = 'flex';
            librefmToggle.checked = libreFmSettings.isEnabled();
            librefmLoveToggle.checked = libreFmSettings.shouldLoveOnLike();
        } else {
            librefmStatus.textContent = 'Connect your Libre.fm account to scrobble tracks';
            librefmConnectBtn.textContent = 'Connect Libre.fm';
            librefmConnectBtn.classList.remove('danger');
            librefmToggleSetting.style.display = 'none';
            librefmLoveSetting.style.display = 'none';
        }
    }

    if (librefmConnectBtn) {
        updateLibreFmUI();

        librefmConnectBtn.addEventListener('click', async () => {
            if (scrobbler.librefm.isAuthenticated()) {
                if (confirm('Disconnect from Libre.fm?')) {
                    scrobbler.librefm.disconnect();
                    updateLibreFmUI();
                }
                return;
            }

            const authWindow = window.open('', '_blank');
            librefmConnectBtn.disabled = true;
            librefmConnectBtn.textContent = 'Opening Libre.fm...';

            try {
                const { token, url } = await scrobbler.librefm.getAuthUrl();

                if (authWindow) {
                    authWindow.location.href = url;
                } else {
                    alert('Popup blocked! Please allow popups.');
                    librefmConnectBtn.textContent = 'Connect Libre.fm';
                    librefmConnectBtn.disabled = false;
                    return;
                }

                librefmConnectBtn.textContent = 'Waiting for authorization...';

                let attempts = 0;
                const maxAttempts = 30;

                const checkAuth = setInterval(async () => {
                    attempts++;

                    if (attempts > maxAttempts) {
                        clearInterval(checkAuth);
                        librefmConnectBtn.textContent = 'Connect Libre.fm';
                        librefmConnectBtn.disabled = false;
                        if (authWindow && !authWindow.closed) authWindow.close();
                        alert('Authorization timed out. Please try again.');
                        return;
                    }

                    try {
                        const result = await scrobbler.librefm.completeAuthentication(token);

                        if (result.success) {
                            clearInterval(checkAuth);
                            if (authWindow && !authWindow.closed) authWindow.close();
                            updateLibreFmUI();
                            librefmConnectBtn.disabled = false;
                            libreFmSettings.setEnabled(true);
                            librefmToggle.checked = true;
                            alert(`Successfully connected to Libre.fm as ${result.username}!`);
                        }
                    } catch {
                        // Still waiting
                    }
                }, 2000);
            } catch (error) {
                console.error('Libre.fm connection failed:', error);
                alert('Failed to connect to Libre.fm: ' + error.message);
                librefmConnectBtn.textContent = 'Connect Libre.fm';
                librefmConnectBtn.disabled = false;
                if (authWindow && !authWindow.closed) authWindow.close();
            }
        });

        // Libre.fm Toggles
        if (librefmToggle) {
            librefmToggle.addEventListener('change', (e) => {
                libreFmSettings.setEnabled(e.target.checked);
            });
        }

        if (librefmLoveToggle) {
            librefmLoveToggle.addEventListener('change', (e) => {
                libreFmSettings.setLoveOnLike(e.target.checked);
            });
        }
    }

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

    // Track Date Settings
    const useAlbumReleaseYearToggle = document.getElementById('use-album-release-year-toggle');
    if (useAlbumReleaseYearToggle) {
        useAlbumReleaseYearToggle.checked = trackDateSettings.useAlbumYear();
        useAlbumReleaseYearToggle.addEventListener('change', (e) => {
            trackDateSettings.setUseAlbumYear(e.target.checked);
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

    // ========================================
    // 16-Band Equalizer Settings
    // ========================================
    const eqToggle = document.getElementById('equalizer-enabled-toggle');
    const eqContainer = document.getElementById('equalizer-container');
    const eqPresetSelect = document.getElementById('equalizer-preset-select');
    const eqResetBtn = document.getElementById('equalizer-reset-btn');
    const eqBands = document.querySelectorAll('.eq-band');

    /**
     * Update the visual display of a band value
     */
    const updateBandValueDisplay = (bandEl, value) => {
        const valueEl = bandEl.querySelector('.eq-value');
        if (!valueEl) return;

        const displayValue = value > 0 ? `+${value}` : value.toString();
        valueEl.textContent = displayValue;

        // Add color classes based on value
        valueEl.classList.remove('positive', 'negative');
        if (value > 0) {
            valueEl.classList.add('positive');
        } else if (value < 0) {
            valueEl.classList.add('negative');
        }
    };

    /**
     * Update all band sliders and displays from an array of gains
     */
    const updateAllBandUI = (gains) => {
        eqBands.forEach((bandEl, index) => {
            const slider = bandEl.querySelector('.eq-slider');
            if (slider && gains[index] !== undefined) {
                slider.value = gains[index];
                updateBandValueDisplay(bandEl, gains[index]);
            }
        });
    };

    /**
     * Toggle EQ container visibility
     */
    const updateEQContainerVisibility = (enabled) => {
        if (eqContainer) {
            eqContainer.style.display = enabled ? 'block' : 'none';
        }
    };

    // Initialize EQ toggle
    if (eqToggle) {
        const isEnabled = equalizerSettings.isEnabled();
        eqToggle.checked = isEnabled;
        updateEQContainerVisibility(isEnabled);

        eqToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            audioContextManager.toggleEQ(enabled);
            updateEQContainerVisibility(enabled);
        });
    }

    // Initialize preset selector
    if (eqPresetSelect) {
        eqPresetSelect.value = equalizerSettings.getPreset();

        eqPresetSelect.addEventListener('change', (e) => {
            const presetKey = e.target.value;
            const preset = EQ_PRESETS[presetKey];

            if (preset) {
                audioContextManager.applyPreset(presetKey);
                updateAllBandUI(preset.gains);
            }
        });
    }

    // Initialize reset button
    if (eqResetBtn) {
        eqResetBtn.addEventListener('click', () => {
            audioContextManager.reset();
            updateAllBandUI(new Array(16).fill(0));
            if (eqPresetSelect) {
                eqPresetSelect.value = 'flat';
            }
        });
    }

    // Initialize all band sliders
    if (eqBands.length > 0) {
        const savedGains = equalizerSettings.getGains();

        eqBands.forEach((bandEl) => {
            const bandIndex = parseInt(bandEl.dataset.band, 10);
            const slider = bandEl.querySelector('.eq-slider');

            if (slider && !isNaN(bandIndex)) {
                // Set initial value from saved settings
                const initialGain = savedGains[bandIndex] ?? 0;
                slider.value = initialGain;
                updateBandValueDisplay(bandEl, initialGain);

                // Handle slider input
                slider.addEventListener('input', (e) => {
                    const gain = parseFloat(e.target.value);
                    audioContextManager.setBandGain(bandIndex, gain);
                    updateBandValueDisplay(bandEl, gain);

                    // When manually adjusting, switch preset to 'flat' (custom)
                    // to indicate the user has made custom changes
                    if (eqPresetSelect && eqPresetSelect.value !== 'flat') {
                        // Check if current gains still match the selected preset
                        const currentPreset = EQ_PRESETS[eqPresetSelect.value];
                        if (currentPreset) {
                            const currentGains = audioContextManager.getGains();
                            const matches = currentPreset.gains.every((g, i) => Math.abs(g - currentGains[i]) < 0.01);
                            if (!matches) {
                                // Don't change the select, but the preset will save as 'custom'
                            }
                        }
                    }
                });

                // Double-click to reset individual band to 0
                slider.addEventListener('dblclick', () => {
                    slider.value = 0;
                    audioContextManager.setBandGain(bandIndex, 0);
                    updateBandValueDisplay(bandEl, 0);
                });
            }
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

    // Home Page Section Toggles
    const showRecommendedSongsToggle = document.getElementById('show-recommended-songs-toggle');
    if (showRecommendedSongsToggle) {
        showRecommendedSongsToggle.checked = homePageSettings.shouldShowRecommendedSongs();
        showRecommendedSongsToggle.addEventListener('change', (e) => {
            homePageSettings.setShowRecommendedSongs(e.target.checked);
        });
    }

    const showRecommendedAlbumsToggle = document.getElementById('show-recommended-albums-toggle');
    if (showRecommendedAlbumsToggle) {
        showRecommendedAlbumsToggle.checked = homePageSettings.shouldShowRecommendedAlbums();
        showRecommendedAlbumsToggle.addEventListener('change', (e) => {
            homePageSettings.setShowRecommendedAlbums(e.target.checked);
        });
    }

    const showRecommendedArtistsToggle = document.getElementById('show-recommended-artists-toggle');
    if (showRecommendedArtistsToggle) {
        showRecommendedArtistsToggle.checked = homePageSettings.shouldShowRecommendedArtists();
        showRecommendedArtistsToggle.addEventListener('change', (e) => {
            homePageSettings.setShowRecommendedArtists(e.target.checked);
        });
    }

    const showJumpBackInToggle = document.getElementById('show-jump-back-in-toggle');
    if (showJumpBackInToggle) {
        showJumpBackInToggle.checked = homePageSettings.shouldShowJumpBackIn();
        showJumpBackInToggle.addEventListener('change', (e) => {
            homePageSettings.setShowJumpBackIn(e.target.checked);
        });
    }

    // Sidebar Section Toggles
    const sidebarShowHomeToggle = document.getElementById('sidebar-show-home-toggle');
    if (sidebarShowHomeToggle) {
        sidebarShowHomeToggle.checked = sidebarSectionSettings.shouldShowHome();
        sidebarShowHomeToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowHome(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowLibraryToggle = document.getElementById('sidebar-show-library-toggle');
    if (sidebarShowLibraryToggle) {
        sidebarShowLibraryToggle.checked = sidebarSectionSettings.shouldShowLibrary();
        sidebarShowLibraryToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowLibrary(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowRecentToggle = document.getElementById('sidebar-show-recent-toggle');
    if (sidebarShowRecentToggle) {
        sidebarShowRecentToggle.checked = sidebarSectionSettings.shouldShowRecent();
        sidebarShowRecentToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowRecent(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowUnreleasedToggle = document.getElementById('sidebar-show-unreleased-toggle');
    if (sidebarShowUnreleasedToggle) {
        sidebarShowUnreleasedToggle.checked = sidebarSectionSettings.shouldShowUnreleased();
        sidebarShowUnreleasedToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowUnreleased(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowDonateToggle = document.getElementById('sidebar-show-donate-toggle');
    if (sidebarShowDonateToggle) {
        sidebarShowDonateToggle.checked = sidebarSectionSettings.shouldShowDonate();
        sidebarShowDonateToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowDonate(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowSettingsToggle = document.getElementById('sidebar-show-settings-toggle');
    if (sidebarShowSettingsToggle) {
        sidebarShowSettingsToggle.checked = sidebarSectionSettings.shouldShowSettings();
        sidebarShowSettingsToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowSettings(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowAccountToggle = document.getElementById('sidebar-show-account-toggle');
    if (sidebarShowAccountToggle) {
        sidebarShowAccountToggle.checked = sidebarSectionSettings.shouldShowAccount();
        sidebarShowAccountToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowAccount(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowAboutToggle = document.getElementById('sidebar-show-about-toggle');
    if (sidebarShowAboutToggle) {
        sidebarShowAboutToggle.checked = sidebarSectionSettings.shouldShowAbout();
        sidebarShowAboutToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowAbout(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowDownloadToggle = document.getElementById('sidebar-show-download-toggle');
    if (sidebarShowDownloadToggle) {
        sidebarShowDownloadToggle.checked = sidebarSectionSettings.shouldShowDownload();
        sidebarShowDownloadToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowDownload(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowDiscordToggle = document.getElementById('sidebar-show-discord-toggle');
    if (sidebarShowDiscordToggle) {
        sidebarShowDiscordToggle.checked = sidebarSectionSettings.shouldShowDiscord();
        sidebarShowDiscordToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowDiscord(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    // Apply sidebar visibility on initialization
    sidebarSectionSettings.applySidebarVisibility();

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

    // Playlist file generation settings
    const generateM3UToggle = document.getElementById('generate-m3u-toggle');
    if (generateM3UToggle) {
        generateM3UToggle.checked = playlistSettings.shouldGenerateM3U();
        generateM3UToggle.addEventListener('change', (e) => {
            playlistSettings.setGenerateM3U(e.target.checked);
        });
    }

    const generateM3U8Toggle = document.getElementById('generate-m3u8-toggle');
    if (generateM3U8Toggle) {
        generateM3U8Toggle.checked = playlistSettings.shouldGenerateM3U8();
        generateM3U8Toggle.addEventListener('change', (e) => {
            playlistSettings.setGenerateM3U8(e.target.checked);
        });
    }

    const generateCUEtoggle = document.getElementById('generate-cue-toggle');
    if (generateCUEtoggle) {
        generateCUEtoggle.checked = playlistSettings.shouldGenerateCUE();
        generateCUEtoggle.addEventListener('change', (e) => {
            playlistSettings.setGenerateCUE(e.target.checked);
        });
    }

    const generateNFOtoggle = document.getElementById('generate-nfo-toggle');
    if (generateNFOtoggle) {
        generateNFOtoggle.checked = playlistSettings.shouldGenerateNFO();
        generateNFOtoggle.addEventListener('change', (e) => {
            playlistSettings.setGenerateNFO(e.target.checked);
        });
    }

    const generateJSONtoggle = document.getElementById('generate-json-toggle');
    if (generateJSONtoggle) {
        generateJSONtoggle.checked = playlistSettings.shouldGenerateJSON();
        generateJSONtoggle.addEventListener('change', (e) => {
            playlistSettings.setGenerateJSON(e.target.checked);
        });
    }

    const relativePathsToggle = document.getElementById('relative-paths-toggle');
    if (relativePathsToggle) {
        relativePathsToggle.checked = playlistSettings.shouldUseRelativePaths();
        relativePathsToggle.addEventListener('change', (e) => {
            playlistSettings.setUseRelativePaths(e.target.checked);
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

    // Settings Search functionality
    setupSettingsSearch();
}

function setupSettingsSearch() {
    const searchInput = document.getElementById('settings-search-input');
    if (!searchInput) return;

    // Setup clear button
    const clearBtn = searchInput.parentElement.querySelector('.search-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
            searchInput.focus();
        });
    }

    // Show/hide clear button based on input
    const updateClearButton = () => {
        if (clearBtn) {
            clearBtn.style.display = searchInput.value ? 'flex' : 'none';
        }
    };

    searchInput.addEventListener('input', () => {
        updateClearButton();
        filterSettings(searchInput.value.toLowerCase().trim());
    });

    searchInput.addEventListener('focus', updateClearButton);
}

function filterSettings(query) {
    const settingsPage = document.getElementById('page-settings');
    if (!settingsPage) return;

    const allTabContents = settingsPage.querySelectorAll('.settings-tab-content');
    const allTabs = settingsPage.querySelectorAll('.settings-tab');

    if (!query) {
        // Reset: show active tab only
        allTabContents.forEach((content) => {
            content.classList.remove('active');
        });
        allTabs.forEach((tab) => {
            tab.classList.remove('active');
        });

        // Restore first tab as active
        const firstTab = allTabs[0];
        const firstContent = allTabContents[0];
        if (firstTab && firstContent) {
            firstTab.classList.add('active');
            firstContent.classList.add('active');
        }

        // Show all settings groups and items
        const allGroups = settingsPage.querySelectorAll('.settings-group');
        const allItems = settingsPage.querySelectorAll('.setting-item');
        allGroups.forEach((group) => (group.style.display = ''));
        allItems.forEach((item) => (item.style.display = ''));
        return;
    }

    // When searching, show all tabs' content
    allTabContents.forEach((content) => {
        content.classList.add('active');
    });
    allTabs.forEach((tab) => {
        tab.classList.remove('active');
    });

    // Search through all settings
    const allGroups = settingsPage.querySelectorAll('.settings-group');

    allGroups.forEach((group) => {
        const items = group.querySelectorAll('.setting-item');
        let hasMatch = false;

        items.forEach((item) => {
            const label = item.querySelector('.label');
            const description = item.querySelector('.description');

            const labelText = label?.textContent?.toLowerCase() || '';
            const descriptionText = description?.textContent?.toLowerCase() || '';

            const matches = labelText.includes(query) || descriptionText.includes(query);

            if (matches) {
                item.style.display = '';
                hasMatch = true;
            } else {
                item.style.display = 'none';
            }
        });

        // Show/hide group based on whether it has any visible items
        group.style.display = hasMatch ? '' : 'none';
    });
}
