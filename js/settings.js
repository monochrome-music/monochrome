//js/settings
import {
    themeManager,
    lastFMStorage,
    nowPlayingSettings,
    lyricsSettings,
    backgroundSettings,
    dynamicColorSettings,
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
    fontSettings,
    monoAudioSettings,
    exponentialVolumeSettings,
    audioEffectsSettings,
    settingsUiState,
    pwaUpdateSettings,
    contentBlockingSettings,
    musicProviderSettings,
} from './storage.js';
import { audioContextManager, EQ_PRESETS } from './audio-context.js';
import { getButterchurnPresets } from './visualizers/butterchurn.js';
import { db } from './db.js';
import { authManager } from './accounts/auth.js';
import { syncManager } from './accounts/pocketbase.js';
import { saveFirebaseConfig, clearFirebaseConfig } from './accounts/config.js';

export function initializeSettings(scrobbler, player, api, ui) {
    // Restore last active settings tab
    const savedTab = settingsUiState.getActiveTab();
    const settingsTab = document.querySelector(`.settings-tab[data-tab="${savedTab}"]`);
    if (settingsTab) {
        document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach((c) => c.classList.remove('active'));
        settingsTab.classList.add('active');
        document.getElementById(`settings-tab-${savedTab}`)?.classList.add('active');
    }

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
    const lastfmCustomCredsToggle = document.getElementById('lastfm-custom-creds-toggle');
    const lastfmCustomCredsToggleSetting = document.getElementById('lastfm-custom-creds-toggle-setting');
    const lastfmCustomCredsSetting = document.getElementById('lastfm-custom-creds-setting');
    const lastfmCustomApiKey = document.getElementById('lastfm-custom-api-key');
    const lastfmCustomApiSecret = document.getElementById('lastfm-custom-api-secret');
    const lastfmSaveCustomCreds = document.getElementById('lastfm-save-custom-creds');
    const lastfmClearCustomCreds = document.getElementById('lastfm-clear-custom-creds');
    const lastfmCredentialAuth = document.getElementById('lastfm-credential-auth');
    const lastfmCredentialForm = document.getElementById('lastfm-credential-form');
    const lastfmUsernameInput = document.getElementById('lastfm-username');
    const lastfmPasswordInput = document.getElementById('lastfm-password');
    const lastfmLoginCredentialsBtn = document.getElementById('lastfm-login-credentials');
    const lastfmUseOAuthBtn = document.getElementById('lastfm-use-oauth');

    function updateLastFMUI() {
        if (scrobbler.lastfm.isAuthenticated()) {
            lastfmStatus.textContent = `Connected as ${scrobbler.lastfm.username}`;
            lastfmConnectBtn.textContent = 'Disconnect';
            lastfmConnectBtn.classList.add('danger');
            lastfmToggleSetting.style.display = 'flex';
            lastfmLoveSetting.style.display = 'flex';
            lastfmToggle.checked = lastFMStorage.isEnabled();
            lastfmLoveToggle.checked = lastFMStorage.shouldLoveOnLike();
            lastfmCustomCredsToggleSetting.style.display = 'flex';
            lastfmCustomCredsToggle.checked = lastFMStorage.useCustomCredentials();
            updateCustomCredsUI();
            hideCredentialAuth();
        } else {
            lastfmStatus.textContent = 'Connect your Last.fm account to scrobble tracks';
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.classList.remove('danger');
            lastfmToggleSetting.style.display = 'none';
            lastfmLoveSetting.style.display = 'none';
            lastfmCustomCredsToggleSetting.style.display = 'none';
            lastfmCustomCredsSetting.style.display = 'none';
            // Hide credential auth by default - only show on OAuth failure
            hideCredentialAuth();
        }
    }

    function showCredentialAuth() {
        if (lastfmCredentialAuth) lastfmCredentialAuth.style.display = 'block';
        if (lastfmCredentialForm) lastfmCredentialForm.style.display = 'block';
        // Focus on username field
        if (lastfmUsernameInput) lastfmUsernameInput.focus();
    }

    function hideCredentialAuth() {
        if (lastfmCredentialAuth) lastfmCredentialAuth.style.display = 'none';
        if (lastfmCredentialForm) lastfmCredentialForm.style.display = 'none';
        if (lastfmUsernameInput) lastfmUsernameInput.value = '';
        if (lastfmPasswordInput) lastfmPasswordInput.value = '';
    }

    function updateCustomCredsUI() {
        const useCustom = lastFMStorage.useCustomCredentials();
        lastfmCustomCredsSetting.style.display = useCustom ? 'flex' : 'none';

        if (useCustom) {
            lastfmCustomApiKey.value = lastFMStorage.getCustomApiKey();
            lastfmCustomApiSecret.value = lastFMStorage.getCustomApiSecret();

            const hasCreds = lastFMStorage.getCustomApiKey() && lastFMStorage.getCustomApiSecret();
            lastfmClearCustomCreds.style.display = hasCreds ? 'inline-block' : 'none';
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
            const maxAttempts = 5;

            const checkAuth = setInterval(async () => {
                attempts++;

                if (attempts > maxAttempts) {
                    clearInterval(checkAuth);
                    if (authWindow && !authWindow.closed) authWindow.close();
                    lastfmConnectBtn.textContent = 'Connect Last.fm';
                    lastfmConnectBtn.disabled = false;
                    // Ask user if they want to use credentials instead
                    if (
                        confirm('Authorization timed out. Would you like to login with username and password instead?')
                    ) {
                        showCredentialAuth();
                    }
                    return;
                }

                try {
                    const result = await scrobbler.lastfm.completeAuthentication(token);

                    if (result.success) {
                        clearInterval(checkAuth);
                        if (authWindow && !authWindow.closed) authWindow.close();
                        lastFMStorage.setEnabled(true);
                        lastfmToggle.checked = true;
                        updateLastFMUI();
                        lastfmConnectBtn.disabled = false;
                        alert(`Successfully connected to Last.fm as ${result.username}!`);
                    }
                } catch {
                    // Still waiting
                }
            }, 2000);
        } catch (error) {
            console.error('Last.fm connection failed:', error);
            if (authWindow && !authWindow.closed) authWindow.close();
            lastfmConnectBtn.textContent = 'Connect Last.fm';
            lastfmConnectBtn.disabled = false;
            // Ask user if they want to use credentials instead
            if (confirm('Failed to connect to Last.fm. Would you like to login with username and password instead?')) {
                showCredentialAuth();
            }
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

    // Custom Credentials Toggle
    if (lastfmCustomCredsToggle) {
        lastfmCustomCredsToggle.addEventListener('change', (e) => {
            lastFMStorage.setUseCustomCredentials(e.target.checked);
            updateCustomCredsUI();

            // Reload credentials in the scrobbler
            scrobbler.lastfm.reloadCredentials();

            // If credentials are being disabled, clear any existing session
            if (!e.target.checked && scrobbler.lastfm.isAuthenticated()) {
                scrobbler.lastfm.disconnect();
                updateLastFMUI();
                alert('Switched to default API credentials. Please reconnect to Last.fm.');
            }
        });
    }

    // Save Custom Credentials
    if (lastfmSaveCustomCreds) {
        lastfmSaveCustomCreds.addEventListener('click', () => {
            const apiKey = lastfmCustomApiKey.value.trim();
            const apiSecret = lastfmCustomApiSecret.value.trim();

            if (!apiKey || !apiSecret) {
                alert('Please enter both API Key and API Secret');
                return;
            }

            lastFMStorage.setCustomApiKey(apiKey);
            lastFMStorage.setCustomApiSecret(apiSecret);

            // Reload credentials
            scrobbler.lastfm.reloadCredentials();

            updateCustomCredsUI();
            alert('Custom API credentials saved! Please reconnect to Last.fm to use them.');

            // Disconnect current session if authenticated
            if (scrobbler.lastfm.isAuthenticated()) {
                scrobbler.lastfm.disconnect();
                updateLastFMUI();
            }
        });
    }

    // Clear Custom Credentials
    if (lastfmClearCustomCreds) {
        lastfmClearCustomCreds.addEventListener('click', () => {
            if (confirm('Clear custom API credentials?')) {
                lastFMStorage.clearCustomCredentials();
                lastfmCustomApiKey.value = '';
                lastfmCustomApiSecret.value = '';
                lastfmCustomCredsToggle.checked = false;

                // Reload credentials
                scrobbler.lastfm.reloadCredentials();

                updateCustomCredsUI();

                // Disconnect current session if authenticated
                if (scrobbler.lastfm.isAuthenticated()) {
                    scrobbler.lastfm.disconnect();
                    updateLastFMUI();
                    alert(
                        'Custom credentials cleared. Switched to default API credentials. Please reconnect to Last.fm.'
                    );
                }
            }
        });
    }

    // Last.fm Credential Auth - Login with credentials
    if (lastfmLoginCredentialsBtn) {
        lastfmLoginCredentialsBtn.addEventListener('click', async () => {
            const username = lastfmUsernameInput?.value?.trim();
            const password = lastfmPasswordInput?.value;

            if (!username || !password) {
                alert('Please enter both username and password.');
                return;
            }

            lastfmLoginCredentialsBtn.disabled = true;
            lastfmLoginCredentialsBtn.textContent = 'Logging in...';

            try {
                const result = await scrobbler.lastfm.authenticateWithCredentials(username, password);
                if (result.success) {
                    lastFMStorage.setEnabled(true);
                    lastfmToggle.checked = true;
                    updateLastFMUI();
                    // Clear password for security
                    if (lastfmPasswordInput) lastfmPasswordInput.value = '';
                    alert(`Successfully connected to Last.fm as ${result.username}!`);
                }
            } catch (error) {
                console.error('Last.fm credential login failed:', error);
                alert('Failed to login: ' + error.message);
            } finally {
                lastfmLoginCredentialsBtn.disabled = false;
                lastfmLoginCredentialsBtn.textContent = 'Login';
            }
        });
    }

    // Last.fm Credential Auth - Switch back to OAuth
    if (lastfmUseOAuthBtn) {
        lastfmUseOAuthBtn.addEventListener('click', () => {
            hideCredentialAuth();
        });
    }

    // ========================================
    // Global Scrobble Settings
    // ========================================
    const scrobblePercentageSlider = document.getElementById('scrobble-percentage-slider');
    const scrobblePercentageInput = document.getElementById('scrobble-percentage-input');

    if (scrobblePercentageSlider && scrobblePercentageInput) {
        const percentage = lastFMStorage.getScrobblePercentage();
        scrobblePercentageSlider.value = percentage;
        scrobblePercentageInput.value = percentage;

        scrobblePercentageSlider.addEventListener('input', (e) => {
            const newPercentage = parseInt(e.target.value, 10);
            scrobblePercentageInput.value = newPercentage;
            lastFMStorage.setScrobblePercentage(newPercentage);
        });

        scrobblePercentageInput.addEventListener('change', (e) => {
            let newPercentage = parseInt(e.target.value, 10);
            newPercentage = Math.max(1, Math.min(100, newPercentage || 75));
            scrobblePercentageSlider.value = newPercentage;
            scrobblePercentageInput.value = newPercentage;
            lastFMStorage.setScrobblePercentage(newPercentage);
        });

        scrobblePercentageInput.addEventListener('input', (e) => {
            let newPercentage = parseInt(e.target.value, 10);
            if (!isNaN(newPercentage) && newPercentage >= 1 && newPercentage <= 100) {
                scrobblePercentageSlider.value = newPercentage;
                lastFMStorage.setScrobblePercentage(newPercentage);
            }
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
                            libreFmSettings.setEnabled(true);
                            librefmToggle.checked = true;
                            updateLibreFmUI();
                            librefmConnectBtn.disabled = false;
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

    // Music Provider setting
    const musicProviderSetting = document.getElementById('music-provider-setting');
    if (musicProviderSetting) {
        musicProviderSetting.value = musicProviderSettings.getProvider();
        musicProviderSetting.addEventListener('change', (e) => {
            musicProviderSettings.setProvider(e.target.value);
            // Reload page to apply changes
            window.location.reload();
        });
    }

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
            // Re-render queue if available, but don't force navigation to library
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

    // Mono Audio Toggle
    const monoAudioToggle = document.getElementById('mono-audio-toggle');
    if (monoAudioToggle) {
        monoAudioToggle.checked = monoAudioSettings.isEnabled();
        monoAudioToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            monoAudioSettings.setEnabled(enabled);
            audioContextManager.toggleMonoAudio(enabled);
        });
    }

    // Exponential Volume Toggle
    const exponentialVolumeToggle = document.getElementById('exponential-volume-toggle');
    if (exponentialVolumeToggle) {
        exponentialVolumeToggle.checked = exponentialVolumeSettings.isEnabled();
        exponentialVolumeToggle.addEventListener('change', (e) => {
            exponentialVolumeSettings.setEnabled(e.target.checked);
            // Re-apply current volume to use new curve
            player.applyReplayGain();
        });
    }

    // ========================================
    // Audio Effects (Playback Speed)
    // ========================================
    const playbackSpeedSlider = document.getElementById('playback-speed-slider');
    const playbackSpeedInput = document.getElementById('playback-speed-input');
    if (playbackSpeedSlider && playbackSpeedInput) {
        const currentSpeed = audioEffectsSettings.getSpeed();
        // Clamp slider to its range (0.25-4), but show actual value in input
        playbackSpeedSlider.value = Math.max(0.25, Math.min(4.0, currentSpeed));
        playbackSpeedInput.value = currentSpeed;

        // Slider only controls 0.25-4 range
        playbackSpeedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value) || 1.0;
            playbackSpeedInput.value = speed;
            player.setPlaybackSpeed(speed);
        });

        // Input allows full 0.01-100 range
        const handleInputChange = () => {
            const speed = parseFloat(playbackSpeedInput.value) || 1.0;
            const validSpeed = Math.max(0.01, Math.min(100, speed));
            playbackSpeedInput.value = validSpeed;
            // Only update slider if value is within slider range
            if (validSpeed >= 0.25 && validSpeed <= 4.0) {
                playbackSpeedSlider.value = validSpeed;
            }
            player.setPlaybackSpeed(validSpeed);
        };

        playbackSpeedInput.addEventListener('change', handleInputChange);
        playbackSpeedInput.addEventListener('blur', handleInputChange);
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

    // Dynamic Color Toggle
    const dynamicColorToggle = document.getElementById('dynamic-color-toggle');
    if (dynamicColorToggle) {
        dynamicColorToggle.checked = dynamicColorSettings.isEnabled();
        dynamicColorToggle.addEventListener('change', (e) => {
            dynamicColorSettings.setEnabled(e.target.checked);
            if (!e.target.checked) {
                // Reset colors immediately when disabled
                window.dispatchEvent(new CustomEvent('reset-dynamic-color'));
            }
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
    const visualizerPresetSelect = document.getElementById('visualizer-preset-select');

    // Butterchurn Settings Elements
    const butterchurnCycleSetting = document.getElementById('butterchurn-cycle-setting');
    const butterchurnDurationSetting = document.getElementById('butterchurn-duration-setting');
    const butterchurnRandomizeSetting = document.getElementById('butterchurn-randomize-setting');
    const butterchurnSpecificPresetSetting = document.getElementById('butterchurn-specific-preset-setting');
    const butterchurnSpecificPresetSelect = document.getElementById('butterchurn-specific-preset-select');
    const butterchurnCycleToggle = document.getElementById('butterchurn-cycle-toggle');
    const butterchurnDurationInput = document.getElementById('butterchurn-duration-input');
    const butterchurnRandomizeToggle = document.getElementById('butterchurn-randomize-toggle');

    const updateButterchurnSettingsVisibility = () => {
        const isEnabled = visualizerEnabledToggle ? visualizerEnabledToggle.checked : false;
        const isButterchurn = visualizerPresetSelect ? visualizerPresetSelect.value === 'butterchurn' : false;
        const show = isEnabled && isButterchurn;

        if (butterchurnCycleSetting) butterchurnCycleSetting.style.display = show ? 'flex' : 'none';
        if (butterchurnSpecificPresetSetting) butterchurnSpecificPresetSetting.style.display = show ? 'flex' : 'none';

        // Cycle duration and randomize only show if cycle is enabled
        const isCycleEnabled = butterchurnCycleToggle ? butterchurnCycleToggle.checked : false;
        const showSubSettings = show && isCycleEnabled;

        if (butterchurnDurationSetting) butterchurnDurationSetting.style.display = showSubSettings ? 'flex' : 'none';
        if (butterchurnRandomizeSetting) butterchurnRandomizeSetting.style.display = showSubSettings ? 'flex' : 'none';

        // Populate preset list using module-level cache (works even before visualizer initializes)
        const { keys: presetNames } = getButterchurnPresets();
        const select = butterchurnSpecificPresetSelect;

        if (select && presetNames.length > 0) {
            const currentNames = Array.from(select.options).map((opt) => opt.value);
            // Check if dropdown only has "Loading..." or needs full update
            const hasOnlyLoadingOption = currentNames.length === 1 && currentNames[0] === '';
            const needsUpdate =
                hasOnlyLoadingOption ||
                currentNames.length !== presetNames.length ||
                !presetNames.every((name) => currentNames.includes(name));

            if (needsUpdate) {
                // Save current selection
                const currentSelection = select.value;

                // Clear and rebuild dropdown
                select.innerHTML = '';
                presetNames.forEach((name) => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    select.appendChild(option);
                });

                // Restore selection if it still exists
                if (presetNames.includes(currentSelection)) {
                    select.value = currentSelection;
                } else {
                    select.selectedIndex = 0;
                }
            }
        }
    };

    const updateVisualizerSettingsVisibility = (enabled) => {
        const display = enabled ? 'flex' : 'none';
        if (visualizerModeSetting) visualizerModeSetting.style.display = display;
        if (visualizerSmartIntensitySetting) visualizerSmartIntensitySetting.style.display = display;
        if (visualizerSensitivitySetting) visualizerSensitivitySetting.style.display = display;
        if (visualizerPresetSetting) visualizerPresetSetting.style.display = display;

        // Also update Butterchurn specific visibility
        updateButterchurnSettingsVisibility();
    };

    // Initialize preset select value early so visibility logic works correctly on load
    if (visualizerPresetSelect) {
        visualizerPresetSelect.value = visualizerSettings.getPreset();
    }

    if (visualizerEnabledToggle) {
        visualizerEnabledToggle.checked = visualizerSettings.isEnabled();

        updateVisualizerSettingsVisibility(visualizerEnabledToggle.checked);

        visualizerEnabledToggle.addEventListener('change', (e) => {
            visualizerSettings.setEnabled(e.target.checked);
            updateVisualizerSettingsVisibility(e.target.checked);
        });
    }

    // Visualizer Preset Select
    if (visualizerPresetSelect) {
        // value set above
        visualizerPresetSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            visualizerSettings.setPreset(val);
            if (ui && ui.visualizer) {
                ui.visualizer.setPreset(val);
            }
            updateButterchurnSettingsVisibility();
        });
    }

    if (butterchurnCycleToggle) {
        butterchurnCycleToggle.checked = visualizerSettings.isButterchurnCycleEnabled();
        butterchurnCycleToggle.addEventListener('change', (e) => {
            visualizerSettings.setButterchurnCycleEnabled(e.target.checked);
            updateButterchurnSettingsVisibility();
        });
    }

    if (butterchurnDurationInput) {
        butterchurnDurationInput.value = visualizerSettings.getButterchurnCycleDuration();
        butterchurnDurationInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 5) val = 5;
            if (val > 300) val = 300;
            e.target.value = val;
            visualizerSettings.setButterchurnCycleDuration(val);
        });
    }

    if (butterchurnRandomizeToggle) {
        butterchurnRandomizeToggle.checked = visualizerSettings.isButterchurnRandomizeEnabled();
        butterchurnRandomizeToggle.addEventListener('change', (e) => {
            visualizerSettings.setButterchurnRandomizeEnabled(e.target.checked);
        });
    }

    if (butterchurnSpecificPresetSelect) {
        butterchurnSpecificPresetSelect.addEventListener('change', (e) => {
            // Try to load via visualizer if active, otherwise just store the selection
            if (ui && ui.visualizer && ui.visualizer.presets['butterchurn']) {
                ui.visualizer.presets['butterchurn'].loadPreset(e.target.value);
            }
        });
    }

    // Refresh settings when presets are loaded asynchronously
    window.addEventListener('butterchurn-presets-loaded', () => {
        console.log('[Settings] Butterchurn presets loaded event received');
        updateButterchurnSettingsVisibility();
    });

    // Check if presets already cached and update immediately
    const { keys: cachedKeys } = getButterchurnPresets();
    if (cachedKeys.length > 0) {
        console.log('[Settings] Presets already cached, updating dropdown immediately');
        updateButterchurnSettingsVisibility();
    }

    // Watch for audio tab becoming active and refresh presets
    const audioTabContent = document.getElementById('settings-tab-audio');
    if (audioTabContent) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (audioTabContent.classList.contains('active')) {
                        console.log('[Settings] Audio tab became active, refreshing presets');
                        updateButterchurnSettingsVisibility();
                    }
                }
            });
        });
        observer.observe(audioTabContent, { attributes: true });
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

    const showEditorsPicksToggle = document.getElementById('show-editors-picks-toggle');
    if (showEditorsPicksToggle) {
        showEditorsPicksToggle.checked = homePageSettings.shouldShowEditorsPicks();
        showEditorsPicksToggle.addEventListener('change', (e) => {
            homePageSettings.setShowEditorsPicks(e.target.checked);
        });
    }

    const shuffleEditorsPicksToggle = document.getElementById('shuffle-editors-picks-toggle');
    if (shuffleEditorsPicksToggle) {
        shuffleEditorsPicksToggle.checked = homePageSettings.shouldShuffleEditorsPicks();
        shuffleEditorsPicksToggle.addEventListener('change', (e) => {
            homePageSettings.setShuffleEditorsPicks(e.target.checked);
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
        sidebarShowSettingsToggle.checked = true;
        sidebarShowSettingsToggle.disabled = true;
        sidebarSectionSettings.setShowSettings(true);
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

    const sidebarSettingsGroup = sidebarShowHomeToggle?.closest('.settings-group');
    if (sidebarSettingsGroup) {
        const toggleIdFromSidebarId = (sidebarId) =>
            sidebarId ? sidebarId.replace('sidebar-nav-', 'sidebar-show-') + '-toggle' : '';

        const sidebarOrderConfig = sidebarSectionSettings.DEFAULT_ORDER.map((sidebarId) => ({
            sidebarId,
            toggleId: toggleIdFromSidebarId(sidebarId),
        }));

        sidebarOrderConfig.forEach(({ toggleId, sidebarId }) => {
            const toggle = document.getElementById(toggleId);
            const item = toggle?.closest('.setting-item');
            if (!item) return;
            item.dataset.sidebarId = sidebarId;
            item.classList.add('sidebar-setting-item');
            item.draggable = true;
        });

        const getSidebarItems = () =>
            Array.from(sidebarSettingsGroup.querySelectorAll('.sidebar-setting-item[data-sidebar-id]'));

        const applySidebarSettingsOrder = () => {
            const order = sidebarSectionSettings.getOrder();
            const itemMap = new Map(getSidebarItems().map((item) => [item.dataset.sidebarId, item]));

            order.forEach((id) => {
                const item = itemMap.get(id);
                if (item) {
                    sidebarSettingsGroup.appendChild(item);
                }
            });
        };

        applySidebarSettingsOrder();

        let draggedItem = null;

        const saveSidebarOrder = () => {
            const order = getSidebarItems().map((item) => item.dataset.sidebarId);
            sidebarSectionSettings.setOrder(order);
            sidebarSectionSettings.applySidebarVisibility();
        };

        const handleDragStart = (e) => {
            const item = e.target.closest('.sidebar-setting-item');
            if (!item) return;
            draggedItem = item;
            draggedItem.classList.add('dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.dataset.sidebarId || '');
            }
        };

        const handleDragEnd = () => {
            if (!draggedItem) return;
            draggedItem.classList.remove('dragging');
            draggedItem = null;
            saveSidebarOrder();
        };

        const getDragAfterElement = (container, y) => {
            const draggableElements = [...container.querySelectorAll('.sidebar-setting-item:not(.dragging)')];

            return draggableElements.reduce(
                (closest, child) => {
                    const box = child.getBoundingClientRect();
                    const offset = y - box.top - box.height / 2;
                    if (offset < 0 && offset > closest.offset) {
                        return { offset, element: child };
                    }
                    return closest;
                },
                { offset: Number.NEGATIVE_INFINITY }
            ).element;
        };

        const handleDragOver = (e) => {
            e.preventDefault();
            if (!draggedItem) return;
            const afterElement = getDragAfterElement(sidebarSettingsGroup, e.clientY);
            if (afterElement === draggedItem) return;
            if (afterElement) {
                sidebarSettingsGroup.insertBefore(draggedItem, afterElement);
            } else {
                sidebarSettingsGroup.appendChild(draggedItem);
            }
        };

        sidebarSettingsGroup.addEventListener('dragstart', handleDragStart);
        sidebarSettingsGroup.addEventListener('dragend', handleDragEnd);
        sidebarSettingsGroup.addEventListener('dragover', handleDragOver);
        sidebarSettingsGroup.addEventListener('drop', (e) => e.preventDefault());
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
            await api.settings.refreshInstances();
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
        const fbFromEnv = !!window.__FIREBASE_CONFIG__;
        const pbFromEnv = !!window.__POCKETBASE_URL__;

        // Hide entire setting if both are server-configured
        if (fbFromEnv && pbFromEnv) {
            const settingItem = customDbBtn.closest('.setting-item');
            if (settingItem) settingItem.style.display = 'none';
        }

        // Hide individual fields in the modal
        if (pbFromEnv && customPbUrlInput) customPbUrlInput.closest('div[style]').style.display = 'none';
        if (fbFromEnv && customFirebaseConfigInput)
            customFirebaseConfigInput.closest('div[style]').style.display = 'none';

        customDbBtn.addEventListener('click', () => {
            const pbUrl = localStorage.getItem('monochrome-pocketbase-url') || '';
            const fbConfig = localStorage.getItem('monochrome-firebase-config');

            if (!pbFromEnv) customPbUrlInput.value = pbUrl;
            if (!fbFromEnv) {
                if (fbConfig) {
                    try {
                        customFirebaseConfigInput.value = JSON.stringify(JSON.parse(fbConfig), null, 2);
                    } catch {
                        customFirebaseConfigInput.value = fbConfig;
                    }
                } else {
                    customFirebaseConfigInput.value = '';
                }
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

    // PWA Auto-Update Toggle
    const pwaAutoUpdateToggle = document.getElementById('pwa-auto-update-toggle');
    if (pwaAutoUpdateToggle) {
        pwaAutoUpdateToggle.checked = pwaUpdateSettings.isAutoUpdateEnabled();
        pwaAutoUpdateToggle.addEventListener('change', (e) => {
            pwaUpdateSettings.setAutoUpdateEnabled(e.target.checked);
        });
    }

    // Reset Local Data Button
    const resetLocalDataBtn = document.getElementById('reset-local-data-btn');
    if (resetLocalDataBtn) {
        resetLocalDataBtn.addEventListener('click', async () => {
            if (
                confirm(
                    'WARNING: This will clear all local data including settings, cache, and library.\n\nAre you sure you want to continue?\n\n(Cloud-synced data will not be affected)'
                )
            ) {
                try {
                    // Clear all localStorage
                    const keysToPreserve = [];
                    // Optionally preserve certain keys if needed

                    // Get all keys
                    const allKeys = Object.keys(localStorage);

                    // Clear each key except preserved ones
                    allKeys.forEach((key) => {
                        if (!keysToPreserve.includes(key)) {
                            localStorage.removeItem(key);
                        }
                    });

                    // Clear IndexedDB - try to clear individual stores, fallback to deleting database
                    try {
                        const stores = ['tracks', 'albums', 'artists', 'playlists', 'settings', 'history'];
                        for (const storeName of stores) {
                            try {
                                await db.performTransaction(storeName, 'readwrite', (store) => store.clear());
                            } catch {
                                // Store might not exist, continue
                            }
                        }
                    } catch (dbError) {
                        console.log('Could not clear IndexedDB stores:', dbError);
                        // Try to delete the entire database as fallback
                        try {
                            const deleteRequest = indexedDB.deleteDatabase('monochromeDB');
                            await new Promise((resolve, reject) => {
                                deleteRequest.onsuccess = resolve;
                                deleteRequest.onerror = reject;
                            });
                        } catch (deleteError) {
                            console.log('Could not delete IndexedDB:', deleteError);
                        }
                    }

                    alert('All local data has been cleared. The app will now reload.');
                    window.location.reload();
                } catch (error) {
                    console.error('Failed to reset local data:', error);
                    alert('Failed to reset local data: ' + error.message);
                }
            }
        });
    }

    // Font Settings
    initializeFontSettings();

    // Settings Search functionality
    setupSettingsSearch();

    // Blocked Content Management
    initializeBlockedContentManager();
}

function initializeFontSettings() {
    const fontTypeSelect = document.getElementById('font-type-select');
    const fontPresetSection = document.getElementById('font-preset-section');
    const fontGoogleSection = document.getElementById('font-google-section');
    const fontUrlSection = document.getElementById('font-url-section');
    const fontUploadSection = document.getElementById('font-upload-section');
    const fontPresetSelect = document.getElementById('font-preset-select');
    const fontGoogleInput = document.getElementById('font-google-input');
    const fontGoogleApply = document.getElementById('font-google-apply');
    const fontUrlInput = document.getElementById('font-url-input');
    const fontUrlName = document.getElementById('font-url-name');
    const fontUrlApply = document.getElementById('font-url-apply');
    const fontUploadInput = document.getElementById('font-upload-input');
    const uploadedFontsList = document.getElementById('uploaded-fonts-list');

    if (!fontTypeSelect) return;

    // Load current font config
    const config = fontSettings.getConfig();

    // Show correct section based on type
    function showFontSection(type) {
        fontPresetSection.style.display = type === 'preset' ? 'block' : 'none';
        fontGoogleSection.style.display = type === 'google' ? 'flex' : 'none';
        fontUrlSection.style.display = type === 'url' ? 'flex' : 'none';
        fontUploadSection.style.display = type === 'upload' ? 'block' : 'none';
    }

    // Initialize UI state
    fontTypeSelect.value = config.type;
    showFontSection(config.type);

    if (config.type === 'preset') {
        fontPresetSelect.value = config.family;
    } else if (config.type === 'google') {
        fontGoogleInput.value = config.family || '';
    } else if (config.type === 'url') {
        fontUrlInput.value = config.url || '';
        fontUrlName.value = config.family || '';
    }

    // Type selector change
    fontTypeSelect.addEventListener('change', (e) => {
        showFontSection(e.target.value);
    });

    // Preset font change
    fontPresetSelect.addEventListener('change', (e) => {
        const value = e.target.value;
        if (value === 'System UI') {
            fontSettings.loadPresetFont(
                "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue'",
                'sans-serif'
            );
        } else if (value === 'monospace') {
            fontSettings.loadPresetFont('monospace', 'monospace');
        } else {
            fontSettings.loadPresetFont(value, 'sans-serif');
        }
    });

    // Google Fonts apply
    fontGoogleApply.addEventListener('click', () => {
        const input = fontGoogleInput.value.trim();
        if (!input) return;

        let fontName = input;

        // Check if it's a Google Fonts URL
        if (input.includes('fonts.google.com')) {
            const parsed = fontSettings.parseGoogleFontsUrl(input);
            if (parsed) {
                fontName = parsed;
            }
        }

        fontSettings.loadGoogleFont(fontName);
    });

    // URL font apply
    fontUrlApply.addEventListener('click', () => {
        const url = fontUrlInput.value.trim();
        const name = fontUrlName.value.trim();
        if (!url) return;

        fontSettings.loadFontFromUrl(url, name || 'CustomFont');
    });

    // File upload
    fontUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const font = await fontSettings.saveUploadedFont(file);
            await fontSettings.loadUploadedFont(font.id);
            renderUploadedFontsList();
            fontUploadInput.value = '';
        } catch (err) {
            console.error('Failed to upload font:', err);
            alert('Failed to upload font');
        }
    });

    // Render uploaded fonts list
    function renderUploadedFontsList() {
        const fonts = fontSettings.getUploadedFontList();
        uploadedFontsList.innerHTML = '';

        fonts.forEach((font) => {
            const item = document.createElement('div');
            item.className = 'uploaded-font-item';
            item.innerHTML = `
                <span class="font-name">${font.name}</span>
                <div class="font-actions">
                    <button class="btn-icon" data-id="${font.id}" data-action="use">Use</button>
                    <button class="btn-icon btn-delete" data-id="${font.id}" data-action="delete">Delete</button>
                </div>
            `;
            uploadedFontsList.appendChild(item);
        });

        // Add event listeners for buttons
        uploadedFontsList.querySelectorAll('.btn-icon').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const fontId = e.target.dataset.id;
                const action = e.target.dataset.action;

                if (action === 'use') {
                    await fontSettings.loadUploadedFont(fontId);
                    fontTypeSelect.value = 'upload';
                    showFontSection('upload');
                } else if (action === 'delete') {
                    if (confirm('Delete this font?')) {
                        fontSettings.deleteUploadedFont(fontId);
                        renderUploadedFontsList();
                    }
                }
            });
        });
    }

    renderUploadedFontsList();
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
        // Reset: show saved active tab
        allTabContents.forEach((content) => {
            content.classList.remove('active');
        });
        allTabs.forEach((tab) => {
            tab.classList.remove('active');
        });

        // Restore saved tab as active
        const savedTabName = settingsUiState.getActiveTab();
        const savedTab = document.querySelector(`.settings-tab[data-tab="${savedTabName}"]`);
        const savedContent = document.getElementById(`settings-tab-${savedTabName}`);
        if (savedTab && savedContent) {
            savedTab.classList.add('active');
            savedContent.classList.add('active');
        } else if (allTabs[0] && allTabContents[0]) {
            // Fallback to first tab if saved tab not found
            allTabs[0].classList.add('active');
            allTabContents[0].classList.add('active');
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

function initializeBlockedContentManager() {
    const manageBtn = document.getElementById('manage-blocked-btn');
    const clearAllBtn = document.getElementById('clear-all-blocked-btn');
    const blockedListContainer = document.getElementById('blocked-content-list');
    const blockedArtistsList = document.getElementById('blocked-artists-list');
    const blockedAlbumsList = document.getElementById('blocked-albums-list');
    const blockedTracksList = document.getElementById('blocked-tracks-list');
    const blockedArtistsSection = document.getElementById('blocked-artists-section');
    const blockedAlbumsSection = document.getElementById('blocked-albums-section');
    const blockedTracksSection = document.getElementById('blocked-tracks-section');
    const blockedEmptyMessage = document.getElementById('blocked-empty-message');

    if (!manageBtn || !blockedListContainer) return;

    function renderBlockedLists() {
        const artists = contentBlockingSettings.getBlockedArtists();
        const albums = contentBlockingSettings.getBlockedAlbums();
        const tracks = contentBlockingSettings.getBlockedTracks();
        const totalCount = artists.length + albums.length + tracks.length;

        // Update manage button text
        manageBtn.textContent = totalCount > 0 ? `Manage (${totalCount})` : 'Manage';

        // Show/hide clear all button
        if (clearAllBtn) {
            clearAllBtn.style.display = totalCount > 0 ? 'inline-block' : 'none';
        }

        // Show/hide sections
        blockedArtistsSection.style.display = artists.length > 0 ? 'block' : 'none';
        blockedAlbumsSection.style.display = albums.length > 0 ? 'block' : 'none';
        blockedTracksSection.style.display = tracks.length > 0 ? 'block' : 'none';
        blockedEmptyMessage.style.display = totalCount === 0 ? 'block' : 'none';

        // Render artists
        if (blockedArtistsList) {
            blockedArtistsList.innerHTML = artists
                .map(
                    (artist) => `
                <li data-id="${artist.id}" data-type="artist">
                    <div class="item-info">
                        <div class="item-name">${escapeHtml(artist.name)}</div>
                        <div class="item-meta">${new Date(artist.blockedAt).toLocaleDateString()}</div>
                    </div>
                    <button class="unblock-btn" data-id="${artist.id}" data-type="artist">Unblock</button>
                </li>
            `
                )
                .join('');
        }

        // Render albums
        if (blockedAlbumsList) {
            blockedAlbumsList.innerHTML = albums
                .map(
                    (album) => `
                <li data-id="${album.id}" data-type="album">
                    <div class="item-info">
                        <div class="item-name">${escapeHtml(album.title)}</div>
                        <div class="item-meta">${escapeHtml(album.artist || 'Unknown Artist')} • ${new Date(album.blockedAt).toLocaleDateString()}</div>
                    </div>
                    <button class="unblock-btn" data-id="${album.id}" data-type="album">Unblock</button>
                </li>
            `
                )
                .join('');
        }

        // Render tracks
        if (blockedTracksList) {
            blockedTracksList.innerHTML = tracks
                .map(
                    (track) => `
                <li data-id="${track.id}" data-type="track">
                    <div class="item-info">
                        <div class="item-name">${escapeHtml(track.title)}</div>
                        <div class="item-meta">${escapeHtml(track.artist || 'Unknown Artist')} • ${new Date(track.blockedAt).toLocaleDateString()}</div>
                    </div>
                    <button class="unblock-btn" data-id="${track.id}" data-type="track">Unblock</button>
                </li>
            `
                )
                .join('');
        }

        // Add unblock button handlers
        blockedListContainer.querySelectorAll('.unblock-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const type = btn.dataset.type;

                if (type === 'artist') {
                    contentBlockingSettings.unblockArtist(id);
                } else if (type === 'album') {
                    contentBlockingSettings.unblockAlbum(id);
                } else if (type === 'track') {
                    contentBlockingSettings.unblockTrack(id);
                }

                renderBlockedLists();
            });
        });
    }

    // Toggle blocked list visibility
    manageBtn.addEventListener('click', () => {
        const isVisible = blockedListContainer.style.display !== 'none';
        blockedListContainer.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            renderBlockedLists();
        }
    });

    // Clear all blocked content
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to unblock all artists, albums, and tracks?')) {
                contentBlockingSettings.clearAllBlocked();
                renderBlockedLists();
            }
        });
    }

    // Initial render
    renderBlockedLists();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
