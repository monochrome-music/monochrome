//js/settings
import {
    themeManager,
    lastFMStorage,
    nowPlayingSettings,
    fullscreenCoverClickSettings,
    lyricsSettings,
    backgroundSettings,
    dynamicColorSettings,
    cardSettings,
    artistBannerSettings,
    waveformSettings,
    replayGainSettings,
    downloadQualitySettings,
    losslessContainerSettings,
    coverArtSizeSettings,
    qualityBadgeSettings,
    trackDateSettings,
    visualizerSettings,
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
    gaplessPlaybackSettings,
    analyticsSettings,
    modalSettings,
    preferDolbyAtmosSettings,
    binauralDspSettings,
    fullscreenCoverNoRoundSettings,
    fullscreenCoverVanillaTiltSettings,
    fullscreenCoverTiltDistanceSettings,
    fullscreenCoverTiltSpeedSettings,
    devModeSettings,
    serverDisruptionSettings,
} from './storage.js';
import { audioContextManager, getPresetsForBandCount } from './audio-context.js';
import { calculateBiquadResponse, interpolate, getNormalizationOffset, runAutoEqAlgorithm } from './autoeq-engine.js';
import { parseRawData, TARGETS, SPEAKER_TARGETS } from './autoeq-data.js';
import { fetchAutoEqIndex, fetchHeadphoneData, searchHeadphones, POPULAR_HEADPHONES } from './autoeq-importer.js';
import { db } from './db.js';
import { authManager } from './accounts/auth.js';
import { syncManager } from './accounts/pocketbase.js';
import { containerFormats, customFormats } from './ffmpegFormats.ts';
import { BulkDownloadMethod, modernSettings } from './ModernSettings.js';

async function getButterchurnPresets(...args) {
    const butterchurnModule = await import('./visualizers/butterchurn.js');
    return butterchurnModule.getButterchurnPresets(...args);
}

// Module-level state for AutoEQ (persists across re-initializations)
let _autoeqIndex = [];
let _graphAbortController = null;
let _graphResizeObserver = null;

export async function initializeSettings(scrobbler, player, api, ui) {
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

    // ========================================
    // Dev Mode
    // ========================================
    const devModeToggle = document.getElementById('dev-mode-toggle');
    const devModeUrlSetting = document.getElementById('dev-mode-url-setting');
    const devModeUrlInput = document.getElementById('dev-mode-url-input');

    function updateDevModeUI() {
        if (devModeToggle) devModeToggle.checked = devModeSettings.isEnabled();
        if (devModeUrlSetting) devModeUrlSetting.style.display = devModeSettings.isEnabled() ? '' : 'none';
        if (devModeUrlInput) devModeUrlInput.value = devModeSettings.getUrl();
    }

    updateDevModeUI();

    if (devModeToggle) {
        devModeToggle.addEventListener('change', (e) => {
            devModeSettings.setEnabled(e.target.checked);
            updateDevModeUI();
        });
    }

    if (devModeUrlInput) {
        devModeUrlInput.addEventListener('change', (e) => {
            devModeSettings.setUrl(e.target.value.trim());
        });
    }

    // ========================================
    // Server Disruption Banner
    // ========================================
    const disruptionBanner = document.getElementById('server-disruption-banner');
    const dismissDisruptionBtn = document.getElementById('dismiss-disruption-btn');

    if (disruptionBanner && !serverDisruptionSettings.isDismissed()) {
        disruptionBanner.style.display = 'flex';
    }

    if (dismissDisruptionBtn) {
        dismissDisruptionBtn.addEventListener('click', () => {
            serverDisruptionSettings.dismiss();
            if (disruptionBanner) disruptionBanner.style.display = 'none';
        });
    }

    // Email Auth UI Logic
    const toggleEmailBtn = document.getElementById('toggle-email-auth-btn');
    const authModalCloseBtn = document.getElementById('email-auth-modal-close');
    const authModal = document.getElementById('email-auth-modal');
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const signInBtn = document.getElementById('email-signin-btn');
    const signUpBtn = document.getElementById('email-signup-btn');
    const resetPasswordBtn = document.getElementById('reset-password-btn');

    if (toggleEmailBtn && authModal) {
        toggleEmailBtn.addEventListener('click', () => {
            authModal.classList.add('active');
        });
    }

    if (authModal) {
        const closeAuthModal = () => authModal.classList.remove('active');
        authModalCloseBtn?.addEventListener('click', closeAuthModal);
        authModal.querySelector('.modal-overlay')?.addEventListener('click', closeAuthModal);
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
                authModal.classList.remove('active');
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
                authModal.classList.remove('active');
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

        let authWindow = window.open('', '_blank');

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
    const lbLoveSetting = document.getElementById('listenbrainz-love-setting');
    const lbLoveToggle = document.getElementById('listenbrainz-love-toggle');
    const lbTokenInput = document.getElementById('listenbrainz-token-input');
    const lbCustomUrlInput = document.getElementById('listenbrainz-custom-url-input');

    const updateListenBrainzUI = () => {
        const isEnabled = listenBrainzSettings.isEnabled();
        if (lbToggle) lbToggle.checked = isEnabled;
        if (lbTokenSetting) lbTokenSetting.style.display = isEnabled ? 'flex' : 'none';
        if (lbCustomUrlSetting) lbCustomUrlSetting.style.display = isEnabled ? 'flex' : 'none';
        if (lbLoveSetting) lbLoveSetting.style.display = isEnabled ? 'flex' : 'none';
        if (lbTokenInput) lbTokenInput.value = listenBrainzSettings.getToken();
        if (lbCustomUrlInput) lbCustomUrlInput.value = listenBrainzSettings.getCustomUrl();
        if (lbLoveToggle) lbLoveToggle.checked = listenBrainzSettings.shouldLoveOnLike();
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

    if (lbLoveToggle) {
        lbLoveToggle.addEventListener('change', (e) => {
            listenBrainzSettings.setLoveOnLike(e.target.checked);
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

            let authWindow = window.open('', '_blank');

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

    const communityThemeContainer = document.getElementById('applied-community-theme-container');
    const communityThemeBtn = document.getElementById('applied-community-theme-btn');
    const communityThemeDetails = document.getElementById('community-theme-details-panel');
    const communityThemeUnapplyBtn = document.getElementById('ct-unapply-btn');
    const appliedThemeName = document.getElementById('applied-theme-name');
    const ctDetailsTitle = document.getElementById('ct-details-title');
    const ctDetailsAuthor = document.getElementById('ct-details-author');

    function updateCommunityThemeUI() {
        const metadataStr = localStorage.getItem('community-theme');
        if (metadataStr) {
            try {
                const metadata = JSON.parse(metadataStr);
                if (communityThemeContainer) communityThemeContainer.style.display = 'block';
                if (appliedThemeName) appliedThemeName.textContent = metadata.name;
                if (ctDetailsTitle) ctDetailsTitle.textContent = metadata.name;
                if (ctDetailsAuthor) ctDetailsAuthor.textContent = `by ${metadata.author}`;
            } catch {
                if (communityThemeContainer) communityThemeContainer.style.display = 'none';
            }
        } else {
            if (communityThemeContainer) communityThemeContainer.style.display = 'none';
            if (communityThemeDetails) communityThemeDetails.style.display = 'none';
        }
    }

    updateCommunityThemeUI();
    window.addEventListener('theme-changed', updateCommunityThemeUI);

    if (communityThemeBtn) {
        communityThemeBtn.addEventListener('click', () => {
            const isVisible = communityThemeDetails.style.display === 'block';
            communityThemeDetails.style.display = isVisible ? 'none' : 'block';
        });
    }

    if (communityThemeUnapplyBtn) {
        communityThemeUnapplyBtn.addEventListener('click', () => {
            if (confirm('Unapply this community theme?')) {
                localStorage.removeItem('custom_theme_css');
                localStorage.removeItem('community-theme');
                const styleEl = document.getElementById('custom-theme-style');
                if (styleEl) styleEl.remove();
                themeManager.setTheme('system');

                const themePicker = document.getElementById('theme-picker');
                if (themePicker) {
                    themePicker.querySelectorAll('.theme-option').forEach((opt) => opt.classList.remove('active'));
                    themePicker.querySelector('[data-theme="system"]')?.classList.add('active');
                }
                document.getElementById('custom-theme-editor').classList.remove('show');
            }
        });
    }

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
        const savedAdaptiveQuality = localStorage.getItem('adaptive-playback-quality') || 'auto';

        // Map the stored auto state to the dropdown, or if it doesn't match an option, use the playback-quality value
        const optionExists = Array.from(streamingQualitySetting.options).some(
            (opt) => opt.value === savedAdaptiveQuality
        );
        streamingQualitySetting.value = optionExists
            ? savedAdaptiveQuality
            : localStorage.getItem('playback-quality') || 'auto';

        // Apply initially
        if (player.forceQuality) player.forceQuality(streamingQualitySetting.value);
        const apiQuality = streamingQualitySetting.value === 'auto' ? 'LOSSLESS' : streamingQualitySetting.value;
        player.setQuality(localStorage.getItem('playback-quality') || apiQuality);

        streamingQualitySetting.addEventListener('change', (e) => {
            const val = e.target.value;

            // Set adaptive DASH quality
            localStorage.setItem('adaptive-playback-quality', val);
            if (player.forceQuality) player.forceQuality(val);

            // Set fallback API quality
            const newApiQuality = val === 'auto' ? 'LOSSLESS' : val;
            player.setQuality(newApiQuality);
            localStorage.setItem('playback-quality', newApiQuality);
        });
    }

    // Download Quality setting
    const downloadQualitySetting = document.getElementById('download-quality-setting');
    if (downloadQualitySetting) {
        // Assign categories to the static (native) options already in the HTML
        const staticCategories = {
            HI_RES_LOSSLESS: 'Lossless',
            LOSSLESS: 'Lossless',
            HIGH: 'AAC',
            LOW: 'AAC',
        };

        // Collect static options first (preserving their original order)
        const allOptions = Array.from(downloadQualitySetting.options).map((opt) => ({
            value: opt.value,
            text: opt.textContent,
            category: staticCategories[opt.value] || 'Other',
        }));

        // Append custom (ffmpeg-transcoded) format options
        for (const [key, fmt] of Object.entries(customFormats)) {
            allOptions.push({ value: key, text: fmt.displayName, category: fmt.category });
        }

        // Sort by category order first, then by bitrate descending within each category
        // so higher-quality options always appear before lower-quality ones.
        // Options without an explicit kbps value (lossless) use Infinity so they
        // sort to the top; ties fall back to display-name descending.
        const getBitrate = (text) => {
            const m = text.match(/(\d+)\s*kbps/i);
            return m ? parseInt(m[1], 10) : Infinity;
        };
        const categoryOrder = ['Lossless', 'AAC', 'MP3', 'OGG'];
        allOptions.sort((a, b) => {
            if (a.category == b.category && a.category === 'Lossless') return 0; // Preserve original order for lossless options
            const ai = categoryOrder.indexOf(a.category);
            const bi = categoryOrder.indexOf(b.category);
            const categoryDiff = (ai === -1 ? categoryOrder.length : ai) - (bi === -1 ? categoryOrder.length : bi);
            if (categoryDiff !== 0) return categoryDiff;
            const bitrateA = getBitrate(a.text);
            const bitrateB = getBitrate(b.text);
            if (bitrateA !== bitrateB) return bitrateB - bitrateA;
            return b.text.localeCompare(a.text);
        });

        // Rebuild the select with optgroup elements per category
        downloadQualitySetting.innerHTML = '';
        let currentGroup = null;
        let currentCategory = null;
        for (const opt of allOptions) {
            if (opt.category !== currentCategory) {
                currentCategory = opt.category;
                currentGroup = document.createElement('optgroup');
                currentGroup.label = opt.category;
                downloadQualitySetting.appendChild(currentGroup);
            }
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            currentGroup.appendChild(option);
        }

        downloadQualitySetting.value = downloadQualitySettings.getQuality();

        downloadQualitySetting.addEventListener('change', (e) => {
            downloadQualitySettings.setQuality(e.target.value);
            updateLosslessContainerVisibility();
        });
    }

    const prefersAtmosSetting = document.getElementById('dolby-atmos-toggle');
    if (prefersAtmosSetting) {
        prefersAtmosSetting.checked = preferDolbyAtmosSettings.isEnabled();
        prefersAtmosSetting.addEventListener('change', (e) => {
            preferDolbyAtmosSettings.setEnabled(e.target.checked);
        });
    }

    const losslessContainerSetting = document.getElementById('lossless-container-setting');
    const losslessContainerSettingItem = losslessContainerSetting?.closest('.setting-item');

    /** Shows/hides the Lossless Container setting based on the selected quality */
    function updateLosslessContainerVisibility() {
        if (!losslessContainerSettingItem) return;
        const quality = downloadQualitySettings.getQuality();
        const isLossless = quality === 'LOSSLESS' || quality === 'HI_RES_LOSSLESS';
        losslessContainerSettingItem.style.display = isLossless ? '' : 'none';
    }

    if (losslessContainerSetting) {
        const noChangeOption = losslessContainerSetting.querySelector('option:last-child');
        noChangeOption.remove();

        for (const [internalName, { displayName }] of Object.entries(containerFormats)) {
            const option = document.createElement('option');
            option.value = internalName;
            option.textContent = displayName;
            losslessContainerSetting.appendChild(option);
        }

        losslessContainerSetting.append(noChangeOption);

        losslessContainerSetting.value = losslessContainerSettings.getContainer();

        losslessContainerSetting.addEventListener('change', (e) => {
            losslessContainerSettings.setContainer(e.target.value);
        });
    }

    updateLosslessContainerVisibility();

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
        showQualityBadgesToggle.addEventListener('change', async (e) => {
            qualityBadgeSettings.setEnabled(e.target.checked);
            // Re-render queue if available, but don't force navigation to library
            if (window.renderQueueFunction) await window.renderQueueFunction();
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

    const forceZipBlobToggle = document.getElementById('force-zip-blob-toggle');
    const forceZipBlobSettingItem = forceZipBlobToggle?.closest('.setting-item');
    const hasFileSystemAccess =
        'showSaveFilePicker' in window &&
        typeof FileSystemFileHandle !== 'undefined' &&
        'createWritable' in FileSystemFileHandle.prototype;
    const hasFolderPicker = 'showDirectoryPicker' in window;

    const rememberFolderSetting = document.getElementById('remember-folder-setting');
    const rememberFolderToggle = document.getElementById('remember-folder-toggle');
    const resetSavedFolderSetting = document.getElementById('reset-saved-folder-setting');
    const resetSavedFolderBtn = document.getElementById('reset-saved-folder-btn');
    const singleToFolderSetting = document.getElementById('single-to-folder-setting');
    const singleToFolderToggle = document.getElementById('single-to-folder-toggle');

    /** Shows/hides the Force ZIP as Blob setting based on method and browser support */
    function updateForceZipBlobVisibility() {
        if (!forceZipBlobSettingItem) return;
        const method = modernSettings.bulkDownloadMethod;
        // Only relevant when zip method is selected and the browser supports streaming
        const visible = method === BulkDownloadMethod.Zip && hasFileSystemAccess;
        forceZipBlobSettingItem.style.display = visible ? '' : 'none';
    }

    /** Shows/hides folder-picker-specific and folder-method settings */
    async function updateFolderMethodVisibility() {
        const method = modernSettings.bulkDownloadMethod;
        const isFolderMethod = method === BulkDownloadMethod.Folder;
        const isFolderOrLocal = isFolderMethod || method === BulkDownloadMethod.LocalMedia;

        if (rememberFolderSetting) {
            rememberFolderSetting.style.display = isFolderMethod && hasFolderPicker ? '' : 'none';
        }

        // Reset button: only visible when folder method + remember enabled + valid saved handle exists
        if (resetSavedFolderSetting) {
            let showReset = false;
            if (isFolderMethod && hasFolderPicker && modernSettings.rememberBulkDownloadFolder) {
                const savedHandle = modernSettings.bulkDownloadFolder;
                showReset = !!savedHandle;
            }
            resetSavedFolderSetting.style.display = showReset ? '' : 'none';
        }

        if (singleToFolderSetting) {
            singleToFolderSetting.style.display = isFolderOrLocal ? '' : 'none';
        }
    }

    const bulkDownloadMethod = document.getElementById('bulk-download-method');
    if (bulkDownloadMethod) {
        // Remove the folder picker option if the browser doesn't support it
        if (!hasFolderPicker) {
            const folderOption = bulkDownloadMethod.querySelector('option[value="folder"]');
            if (folderOption) {
                folderOption.remove();
            }
            const localOption = bulkDownloadMethod.querySelector('option[value="local"]');
            if (localOption) {
                localOption.remove();
            }
            // If the stored method is 'folder' or 'local' without native support, fall back to 'zip'
            const currentMethod = modernSettings.bulkDownloadMethod;
            if (currentMethod === BulkDownloadMethod.Folder || currentMethod === BulkDownloadMethod.LocalMedia) {
                modernSettings.bulkDownloadMethod = BulkDownloadMethod.Zip;
            }
        }
        bulkDownloadMethod.value = modernSettings.bulkDownloadMethod;
        bulkDownloadMethod.addEventListener('change', async (e) => {
            const previousMethod = modernSettings.bulkDownloadMethod;
            const newMethod = e.target.value;
            modernSettings.bulkDownloadMethod = newMethod;

            // When switching to 'local', prompt to select the local media folder if not yet configured
            if (newMethod === BulkDownloadMethod.LocalMedia) {
                const existingHandle = await db.getSetting('local_folder_handle');
                if (!existingHandle) {
                    let picked = false;
                    try {
                        if (hasFolderPicker) {
                            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                            if (handle) {
                                picked = true;
                                await db.saveSetting('local_folder_handle', handle);
                            }
                        }
                    } catch {
                        // User cancelled the picker
                    }

                    if (!picked) {
                        // Revert to the previous method since no folder was selected.
                        // Guard against the edge case where the previousMethod option
                        // no longer exists in the dropdown (e.g. removed due to no API support).
                        if (bulkDownloadMethod.querySelector(`option[value="${previousMethod}"]`)) {
                            modernSettings.bulkDownloadMethod = previousMethod;
                            bulkDownloadMethod.value = previousMethod;
                        } else {
                            // Fall back to zip which is always present
                            modernSettings.bulkDownloadMethod = 'zip';
                            bulkDownloadMethod.value = 'zip';
                        }
                    }
                }
            }
            await modernSettings.waitPending();

            updateForceZipBlobVisibility();
            await updateFolderMethodVisibility();
        });
    }

    if (rememberFolderToggle) {
        rememberFolderToggle.checked = modernSettings.rememberBulkDownloadFolder;
        rememberFolderToggle.addEventListener('change', async (e) => {
            modernSettings.rememberBulkDownloadFolder = !!e.target.checked;
            await modernSettings.waitPending();
            await updateFolderMethodVisibility();
        });
    }

    if (resetSavedFolderBtn) {
        resetSavedFolderBtn.addEventListener('click', async () => {
            modernSettings.bulkDownloadFolder = null;
            await modernSettings.waitPending();
            await updateFolderMethodVisibility();
        });
    }

    if (singleToFolderToggle) {
        singleToFolderToggle.checked = modernSettings.downloadSinglesToFolder;
        singleToFolderToggle.addEventListener('change', (e) => {
            modernSettings.downloadSinglesToFolder = !!e.target.checked;
        });
    }

    if (forceZipBlobToggle) {
        forceZipBlobToggle.checked = modernSettings.forceZipBlob;
        forceZipBlobToggle.addEventListener('change', (e) => {
            modernSettings.forceZipBlob = !!e.target.checked;
        });
    }

    updateForceZipBlobVisibility();
    await updateFolderMethodVisibility();

    const includeCoverToggle = document.getElementById('include-cover-toggle');
    if (includeCoverToggle) {
        includeCoverToggle.checked = playlistSettings.shouldIncludeCover();
        includeCoverToggle.addEventListener('change', (e) => {
            playlistSettings.setIncludeCover(e.target.checked);
        });
    }

    const gaplessPlaybackToggle = document.getElementById('gapless-playback-toggle');
    if (gaplessPlaybackToggle) {
        gaplessPlaybackToggle.checked = gaplessPlaybackSettings.isEnabled();
        gaplessPlaybackToggle.addEventListener('change', (e) => {
            gaplessPlaybackSettings.setEnabled(e.target.checked);
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
            const val = parseFloat(e.target.value);
            replayGainSettings.setPreamp(isNaN(val) ? 3 : val);
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

    // ========================================
    // Binaural / Spatial DSP
    // ========================================
    const binauralToggle = document.getElementById('binaural-dsp-toggle');
    const binauralContainer = document.getElementById('binaural-dsp-container');
    const binauralAutoSpatialToggle = document.getElementById('binaural-auto-spatial-toggle');
    const binauralCrossfeedToggle = document.getElementById('binaural-crossfeed-toggle');
    const binauralCrossfeedLevel = document.getElementById('binaural-crossfeed-level');
    const crossfeedLevelRow = document.getElementById('crossfeed-level-row');
    const binauralHrtfPreset = document.getElementById('binaural-hrtf-preset');
    const binauralWideningToggle = document.getElementById('binaural-widening-toggle');
    const binauralWideningSlider = document.getElementById('binaural-widening-slider');
    const binauralWidthValue = document.getElementById('binaural-width-value');
    const wideningSliderRow = document.getElementById('widening-slider-row');

    if (binauralToggle && binauralContainer) {
        const isEnabled = binauralDspSettings.isEnabled();
        binauralToggle.checked = isEnabled;
        binauralContainer.style.display = isEnabled ? 'block' : 'none';

        binauralToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            binauralContainer.style.display = enabled ? 'block' : 'none';
            await audioContextManager.toggleBinaural(enabled);
        });
    }

    if (binauralAutoSpatialToggle) {
        binauralAutoSpatialToggle.checked = binauralDspSettings.getAutoEnableForSpatial();
        binauralAutoSpatialToggle.addEventListener('change', (e) => {
            binauralDspSettings.setAutoEnableForSpatial(e.target.checked);
        });
    }

    if (binauralCrossfeedToggle) {
        binauralCrossfeedToggle.checked = binauralDspSettings.getCrossfeedEnabled();
        if (crossfeedLevelRow) {
            crossfeedLevelRow.style.display = binauralCrossfeedToggle.checked ? 'flex' : 'none';
        }
        binauralCrossfeedToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            if (crossfeedLevelRow) {
                crossfeedLevelRow.style.display = enabled ? 'flex' : 'none';
            }
            await audioContextManager.setBinauralCrossfeedEnabled(enabled);
        });
    }

    if (binauralCrossfeedLevel) {
        binauralCrossfeedLevel.value = binauralDspSettings.getCrossfeedLevel();
        binauralCrossfeedLevel.addEventListener('change', (e) => {
            audioContextManager.setBinauralCrossfeedLevel(e.target.value);
        });
    }

    if (binauralHrtfPreset) {
        binauralHrtfPreset.value = binauralDspSettings.getHrtfPreset();
        binauralHrtfPreset.addEventListener('change', async (e) => {
            await audioContextManager.setBinauralHrtfPreset(e.target.value);
        });
    }

    if (binauralWideningToggle) {
        binauralWideningToggle.checked = binauralDspSettings.getWideningEnabled();
        if (wideningSliderRow) {
            wideningSliderRow.style.display = binauralWideningToggle.checked ? 'flex' : 'none';
        }
        binauralWideningToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            if (wideningSliderRow) {
                wideningSliderRow.style.display = enabled ? 'flex' : 'none';
            }
            await audioContextManager.setBinauralWideningEnabled(enabled);
        });
    }

    if (binauralWideningSlider && binauralWidthValue) {
        binauralWideningSlider.value = binauralDspSettings.getWideningAmount();
        binauralWidthValue.textContent = parseFloat(binauralWideningSlider.value).toFixed(2);
        binauralWideningSlider.addEventListener('input', (e) => {
            const amount = parseFloat(e.target.value);
            binauralWidthValue.textContent = amount.toFixed(2);
            audioContextManager.setBinauralWidening(amount);
        });
    }

    // Listen for binaural mode changes (multichannel detection)
    window.addEventListener('binaural-mode-changed', (e) => {
        const statusEl = document.getElementById('binaural-status');
        if (statusEl) {
            const { mode, channels } = e.detail;
            const label = statusEl.querySelector('.binaural-mode-label');
            if (label) {
                label.textContent =
                    mode === 'multichannel'
                        ? `Mode: Multichannel (${channels > 6 ? '7.1' : '5.1'} → Binaural)`
                        : 'Mode: Stereo';
            }
        }
    });

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
    const playbackSpeedReset = document.getElementById('playback-speed-reset');

    if (playbackSpeedSlider && playbackSpeedInput) {
        // Helper function to update both controls
        const updatePlaybackSpeedControls = (speed) => {
            const parsedSpeed = parseFloat(speed);
            const validSpeed = Math.max(0.01, Math.min(100, isNaN(parsedSpeed) ? 1.0 : parsedSpeed));
            playbackSpeedInput.value = validSpeed;
            // Only update slider if value is within slider range
            if (validSpeed >= 0.25 && validSpeed <= 4.0) {
                playbackSpeedSlider.value = validSpeed;
            }
            return validSpeed;
        };

        // Initialize with current value
        const currentSpeed = audioEffectsSettings.getSpeed();
        updatePlaybackSpeedControls(currentSpeed);

        playbackSpeedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            playbackSpeedInput.value = speed;
            audioEffectsSettings.setSpeed(speed);
            player.setPlaybackSpeed(speed);
        });

        playbackSpeedInput.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            if (!isNaN(speed) && speed >= 0.01 && speed <= 100) {
                if (speed >= 0.25 && speed <= 4.0) {
                    playbackSpeedSlider.value = speed;
                }
                audioEffectsSettings.setSpeed(speed);
                player.setPlaybackSpeed(speed);
            }
        });

        playbackSpeedInput.addEventListener('change', (e) => {
            const speed = parseFloat(e.target.value);
            const validSpeed = updatePlaybackSpeedControls(speed);
            audioEffectsSettings.setSpeed(validSpeed);
            player.setPlaybackSpeed(validSpeed);
        });

        if (playbackSpeedReset) {
            playbackSpeedReset.addEventListener('click', () => {
                const defaultSpeed = audioEffectsSettings.resetSpeed();
                updatePlaybackSpeedControls(defaultSpeed);
                player.setPlaybackSpeed(defaultSpeed);
            });
        }
    }

    // ========================================
    // Preserve Pitch Toggle
    // ========================================
    const preservePitchToggle = document.getElementById('preserve-pitch-toggle');
    if (preservePitchToggle) {
        preservePitchToggle.checked = audioEffectsSettings.isPreservePitchEnabled();

        preservePitchToggle.addEventListener('change', (e) => {
            player.setPreservePitch(e.target.checked);
        });
    }

    // ========================================
    // Graphic Equalizer (Legacy EQ mode) - Configurable Bands
    // ========================================
    let geqBandCount = equalizerSettings.getGraphicEqBandCount();
    let geqFreqRange = equalizerSettings.getGraphicEqFreqRange();

    const formatGeqFreq = (freq) => {
        if (freq >= 10000) return (freq / 1000).toFixed(0) + 'K';
        if (freq >= 1000) return (freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1) + 'K';
        return freq.toString();
    };

    const generateGeqFrequencies = (count, min, max) => {
        const freqs = [];
        for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            let freq = Math.round(min * Math.pow(max / min, t));
            // Ensure strictly increasing - rounding can produce duplicates at high band counts
            if (freqs.length > 0 && freq <= freqs[freqs.length - 1]) {
                freq = freqs[freqs.length - 1] + 1;
            }
            freqs.push(freq);
        }
        return freqs;
    };

    let GEQ_FREQUENCIES = generateGeqFrequencies(geqBandCount, geqFreqRange.min, geqFreqRange.max);
    let GEQ_LABELS = GEQ_FREQUENCIES.map(formatGeqFreq);

    const geqBandsContainer = document.getElementById('graphic-eq-bands');
    const geqPreampSlider = document.getElementById('graphic-eq-preamp-slider');
    const geqPreampValue = document.getElementById('graphic-eq-preamp-value');
    const geqPresetSelect = document.getElementById('graphic-eq-preset-select');
    const geqResetBtn = document.getElementById('graphic-eq-reset-btn');

    const legacyGeqBandsContainer = document.getElementById('legacy-graphic-eq-bands');
    const legacyGeqPreampSlider = document.getElementById('legacy-graphic-eq-preamp-slider');
    const legacyGeqPreampValue = document.getElementById('legacy-graphic-eq-preamp-value');
    const legacyGeqPresetSelect = document.getElementById('legacy-graphic-eq-preset-select');
    const legacyGeqResetBtn = document.getElementById('legacy-graphic-eq-reset-btn');

    const geqBandCountInput = document.getElementById('legacy-geq-band-count');
    const geqFreqMinInput = document.getElementById('legacy-geq-freq-min');
    const geqFreqMaxInput = document.getElementById('legacy-geq-freq-max');

    const geqPreampSliders = [geqPreampSlider, legacyGeqPreampSlider].filter(Boolean);
    const geqPreampValues = [geqPreampValue, legacyGeqPreampValue].filter(Boolean);
    const geqPresetSelects = [geqPresetSelect, legacyGeqPresetSelect].filter(Boolean);

    let geqGains = equalizerSettings.getGraphicEqGains(geqBandCount) || new Array(geqBandCount).fill(0);
    let geqPreamp = equalizerSettings.getGraphicEqPreamp() || 0;
    const geqRange = equalizerSettings.getRange();

    // Sync all slider UIs across both containers
    const geqSyncAllSliders = () => {
        geqGains.forEach((g, i) => {
            ['geq', 'legacy-geq'].forEach((prefix) => {
                const sl = document.getElementById(`${prefix}-slider-${i}`);
                const vl = document.getElementById(`${prefix}-value-${i}`);
                if (sl) sl.value = g;
                if (vl) vl.textContent = `${g > 0 ? '+' : ''}${g.toFixed(1)}`;
            });
        });
    };

    // Build vertical slider bands into a container
    const buildGeqBands = (container, idPrefix) => {
        if (!container) return;
        container.innerHTML = '';
        GEQ_LABELS.forEach((_label, i) => {
            const band = document.createElement('div');
            band.className = 'graphic-eq-band';

            const valueLabel = document.createElement('span');
            valueLabel.className = 'graphic-eq-band-value';
            valueLabel.textContent = `${geqGains[i] > 0 ? '+' : ''}${geqGains[i].toFixed(1)}`;
            valueLabel.id = `${idPrefix}-value-${i}`;

            const sliderWrap = document.createElement('div');
            sliderWrap.className = 'graphic-eq-band-slider-wrap';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = geqRange.min;
            slider.max = geqRange.max;
            slider.step = '0.1';
            slider.value = geqGains[i];
            slider.id = `${idPrefix}-slider-${i}`;
            slider.setAttribute('aria-label', `${GEQ_LABELS[i]} Hz`);

            slider.addEventListener('input', () => {
                const gain = parseFloat(slider.value);
                geqGains[i] = gain;
                equalizerSettings.setGraphicEqGains(geqGains);
                audioContextManager.setGraphicEqBandGain(i, gain);
                geqSyncAllSliders();
                geqPresetSelects.forEach((s) => (s.value = ''));
            });

            sliderWrap.appendChild(slider);

            const freqLabel = document.createElement('span');
            freqLabel.className = 'graphic-eq-band-label';
            freqLabel.textContent = GEQ_LABELS[i];

            band.appendChild(valueLabel);
            band.appendChild(sliderWrap);
            band.appendChild(freqLabel);
            container.appendChild(band);
        });
    };

    buildGeqBands(geqBandsContainer, 'geq');
    buildGeqBands(legacyGeqBandsContainer, 'legacy-geq');

    // Wire up preamp sliders
    geqPreampSliders.forEach((slider) => {
        slider.value = geqPreamp;
        slider.addEventListener('input', () => {
            geqPreamp = parseFloat(slider.value);
            const text = `${geqPreamp.toFixed(1)} dB`;
            geqPreampValues.forEach((v) => (v.textContent = text));
            geqPreampSliders.forEach((s) => {
                if (s !== slider) s.value = geqPreamp;
            });
            equalizerSettings.setGraphicEqPreamp(geqPreamp);
            audioContextManager.setGraphicEqPreamp(geqPreamp);
        });
    });
    geqPreampValues.forEach((v) => (v.textContent = `${geqPreamp} dB`));

    // Wire up preset selects
    geqPresetSelects.forEach((select) => {
        select.addEventListener('change', () => {
            const key = select.value;
            if (!key) return;
            const presets = getPresetsForBandCount(geqBandCount);
            const preset = presets[key];
            if (!preset) return;
            geqGains = [...preset.gains];
            equalizerSettings.setGraphicEqGains(geqGains);
            audioContextManager.setGraphicEqAllGains(geqGains);
            geqSyncAllSliders();
            geqPresetSelects.forEach((s) => {
                if (s !== select) s.value = key;
            });
        });
    });

    // Wire up reset buttons
    [geqResetBtn, legacyGeqResetBtn].filter(Boolean).forEach((btn) => {
        btn.addEventListener('click', () => {
            geqGains = new Array(geqBandCount).fill(0);
            equalizerSettings.setGraphicEqGains(geqGains);
            audioContextManager.setGraphicEqAllGains(geqGains);
            geqSyncAllSliders();
            geqPresetSelects.forEach((s) => (s.value = 'flat'));
        });
    });

    // Band count and frequency range controls
    const rebuildGeq = () => {
        GEQ_FREQUENCIES = generateGeqFrequencies(geqBandCount, geqFreqRange.min, geqFreqRange.max);
        GEQ_LABELS = GEQ_FREQUENCIES.map(formatGeqFreq);
        buildGeqBands(geqBandsContainer, 'geq');
        buildGeqBands(legacyGeqBandsContainer, 'legacy-geq');
        geqSyncAllSliders();
    };

    if (geqBandCountInput) {
        geqBandCountInput.value = geqBandCount;
        geqBandCountInput.addEventListener('change', () => {
            const newCount = Math.max(3, Math.min(32, parseInt(geqBandCountInput.value, 10) || 16));
            geqBandCountInput.value = newCount;
            if (newCount === geqBandCount) return;
            geqGains = equalizerSettings.interpolateGains(geqGains, newCount);
            geqBandCount = newCount;
            equalizerSettings.setGraphicEqGains(geqGains);
            audioContextManager.setGraphicEqBandCount(newCount);
            rebuildGeq();
            geqPresetSelects.forEach((s) => (s.value = ''));
        });
    }

    if (geqFreqMinInput && geqFreqMaxInput) {
        geqFreqMinInput.value = geqFreqRange.min;
        geqFreqMaxInput.value = geqFreqRange.max;

        const handleFreqRangeChange = () => {
            const newMin = Math.max(10, Math.min(96000, parseInt(geqFreqMinInput.value, 10) || 25));
            const newMax = Math.max(10, Math.min(96000, parseInt(geqFreqMaxInput.value, 10) || 20000));
            geqFreqMinInput.value = newMin;
            geqFreqMaxInput.value = newMax;
            if (newMin >= newMax) return;
            if (newMin === geqFreqRange.min && newMax === geqFreqRange.max) return;
            geqFreqRange = { min: newMin, max: newMax };
            audioContextManager.setGraphicEqFreqRange(newMin, newMax);
            rebuildGeq();
        };

        geqFreqMinInput.addEventListener('change', handleFreqRangeChange);
        geqFreqMaxInput.addEventListener('change', handleFreqRangeChange);
    }

    // Legacy EQ Import / Export
    const parseGeqLabelFrequency = (label) => {
        const normalized = String(label).trim().toLowerCase().replace(/\s+/g, '');
        if (normalized.endsWith('khz')) {
            return Number.parseFloat(normalized.slice(0, -3)) * 1000;
        }
        const withoutHz = normalized.replace(/hz$/, '');
        if (withoutHz.endsWith('k')) {
            return Number.parseFloat(withoutHz.slice(0, -1)) * 1000;
        }
        return Number.parseFloat(withoutHz);
    };
    const legacyGeqExportBtn = document.getElementById('legacy-geq-export-btn');
    const legacyGeqExportCsvBtn = document.getElementById('legacy-geq-export-csv-btn');
    const legacyGeqImportBtn = document.getElementById('legacy-geq-import-btn');
    const legacyGeqImportFile = document.getElementById('legacy-geq-import-file');

    if (legacyGeqExportBtn) {
        legacyGeqExportBtn.addEventListener('click', () => {
            const lines = [`Preamp: ${geqPreamp.toFixed(1)} dB`];
            GEQ_FREQUENCIES.forEach((freq, i) => {
                // Q from octave spacing between adjacent bands
                const prev = GEQ_FREQUENCIES[Math.max(0, i - 1)];
                const next = GEQ_FREQUENCIES[Math.min(GEQ_FREQUENCIES.length - 1, i + 1)];
                const octaves = Math.log2(next / prev);
                const q =
                    octaves > 0
                        ? (Math.SQRT2 / (2 * Math.sinh((Math.LN2 / 2) * octaves))).toFixed(2)
                        : Math.SQRT2.toFixed(2);
                lines.push(`Filter ${i + 1}: ON PK Fc ${freq} Hz Gain ${geqGains[i].toFixed(1)} dB Q ${q}`);
            });
            const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'legacy-eq.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        });
    }

    if (legacyGeqExportCsvBtn) {
        legacyGeqExportCsvBtn.addEventListener('click', () => {
            const pairs = GEQ_FREQUENCIES.map((freq, i) => `${freq} ${geqGains[i].toFixed(1)}`).join('; ');
            const lines = [`Preamp: ${geqPreamp.toFixed(1)} dB`, `GraphicEQ: ${pairs}`];
            const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'legacy-eq-apo.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        });
    }

    if (legacyGeqImportBtn && legacyGeqImportFile) {
        legacyGeqImportBtn.addEventListener('click', () => legacyGeqImportFile.click());
        legacyGeqImportFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const text = event.target.result;
                    const lines = text.split('\n');
                    let preamp = geqPreamp;
                    let hasPreamp = false;
                    const importedPoints = [];

                    for (const line of lines) {
                        const preampMatch = line.match(/Preamp:\s*([-\d.]+)\s*dB/i);
                        if (preampMatch) {
                            preamp = parseFloat(preampMatch[1]);
                            hasPreamp = true;
                            continue;
                        }
                        // EqualizerAPO format: Filter N: ON PK Fc XXXX Hz Gain X.X dB Q X.XX
                        const filterMatch = line.match(
                            /Filter\s+\d+:\s*ON\s+\w+\s+Fc\s+([\d.]+[kK]?)\s*(?:Hz)?\s+Gain\s+([+-]?[\d.]+)\s*dB/i
                        );
                        if (filterMatch) {
                            importedPoints.push({
                                freq: parseGeqLabelFrequency(filterMatch[1]),
                                gain: parseFloat(filterMatch[2]),
                            });
                            continue;
                        }
                        // Simple two-column format: freq gain (whitespace/tab/comma separated)
                        const simpleMatch = line.trim().match(/^([\d.]+)\s*([kK])?(?:Hz)?\s*[,\s\t]+([+-]?[\d.]+)/);
                        if (simpleMatch) {
                            importedPoints.push({
                                freq: parseGeqLabelFrequency(`${simpleMatch[1]}${simpleMatch[2] || ''}`),
                                gain: parseFloat(simpleMatch[3]),
                            });
                        }
                    }

                    if (importedPoints.length === 0) return;

                    // Filter out invalid frequencies (0, negative, NaN, Infinity)
                    const validPoints = importedPoints.filter(
                        (p) => Number.isFinite(p.freq) && p.freq > 0 && Number.isFinite(p.gain)
                    );
                    if (validPoints.length === 0) return;

                    // Sort by frequency
                    validPoints.sort((a, b) => a.freq - b.freq);

                    // Map imported points to the GEQ bands using nearest-frequency matching
                    const newGains = GEQ_FREQUENCIES.map((targetFreq) => {
                        // Find the closest imported point by log-frequency distance
                        let closest = validPoints[0];
                        let minDist = Math.abs(Math.log10(targetFreq) - Math.log10(closest.freq));
                        for (let j = 1; j < validPoints.length; j++) {
                            const dist = Math.abs(Math.log10(targetFreq) - Math.log10(validPoints[j].freq));
                            if (dist < minDist) {
                                minDist = dist;
                                closest = validPoints[j];
                            }
                        }
                        // Clamp to slider range
                        return Math.max(parseFloat(geqRange.min), Math.min(parseFloat(geqRange.max), closest.gain));
                    });

                    geqGains = newGains;
                    equalizerSettings.setGraphicEqGains(geqGains);
                    audioContextManager.setGraphicEqAllGains(geqGains);
                    geqSyncAllSliders();
                    if (hasPreamp) {
                        geqPreamp = Math.max(-20, Math.min(20, preamp));
                        equalizerSettings.setGraphicEqPreamp(geqPreamp);
                        audioContextManager.setGraphicEqPreamp(geqPreamp);
                        geqPreampSliders.forEach((s) => (s.value = geqPreamp));
                        geqPreampValues.forEach((v) => (v.textContent = `${geqPreamp.toFixed(1)} dB`));
                    }
                    geqPresetSelects.forEach((s) => {
                        s.value = '';
                        s.dispatchEvent(new Event('change'));
                    });
                } catch (err) {
                    console.error('[Legacy GEQ Import] Failed:', err);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // Legacy EQ Custom Presets (Save / Delete)
    const LEGACY_GEQ_CUSTOM_PRESETS_KEY = 'monochrome-legacy-geq-custom-presets';
    // Migrate from old key if present
    try {
        const oldData = localStorage.getItem('legacy-geq-custom-presets');
        if (oldData && !localStorage.getItem(LEGACY_GEQ_CUSTOM_PRESETS_KEY)) {
            localStorage.setItem(LEGACY_GEQ_CUSTOM_PRESETS_KEY, oldData);
            localStorage.removeItem('legacy-geq-custom-presets');
        }
    } catch {
        /* ignore */
    }
    const legacyGeqSavePresetBtn = document.getElementById('legacy-geq-save-preset-btn');
    const legacyGeqDeletePresetBtn = document.getElementById('legacy-geq-delete-preset-btn');

    const getLegacyGeqCustomPresets = () => {
        try {
            const stored = localStorage.getItem(LEGACY_GEQ_CUSTOM_PRESETS_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    };

    const saveLegacyGeqCustomPresets = (presets) => {
        try {
            localStorage.setItem(LEGACY_GEQ_CUSTOM_PRESETS_KEY, JSON.stringify(presets));
        } catch (e) {
            console.error('[Legacy GEQ] Failed to save presets:', e);
            alert('Failed to save preset. Storage may be full.');
        }
    };

    /** Rebuild custom preset options in all legacy GEQ preset dropdowns */
    const refreshLegacyGeqCustomPresetOptions = () => {
        const presets = getLegacyGeqCustomPresets();
        geqPresetSelects.forEach((select) => {
            // Remove existing custom options
            select.querySelectorAll('option[data-custom]').forEach((opt) => opt.remove());
            // Remove existing separator
            select.querySelectorAll('optgroup[data-custom-group]').forEach((g) => g.remove());

            const entries = Object.entries(presets);
            if (entries.length === 0) return;

            const group = document.createElement('optgroup');
            group.label = 'Custom Presets';
            group.setAttribute('data-custom-group', '');
            entries.forEach(([id, preset]) => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = preset.name;
                opt.setAttribute('data-custom', '');
                group.appendChild(opt);
            });
            select.appendChild(group);
        });
    };

    // Populate custom presets on load
    refreshLegacyGeqCustomPresetOptions();

    /** Show/hide delete button based on whether a custom preset is selected */
    const updateDeleteBtnVisibility = () => {
        const val = legacyGeqPresetSelect?.value || '';
        const isCustom = val.startsWith('geq_custom_');
        if (legacyGeqDeletePresetBtn) {
            legacyGeqDeletePresetBtn.style.display = isCustom ? '' : 'none';
        }
    };

    // Update the preset change handler to also handle custom presets
    geqPresetSelects.forEach((select) => {
        select.addEventListener('change', () => {
            const key = select.value;
            if (!key) {
                updateDeleteBtnVisibility();
                return;
            }

            // Check custom presets first
            const customPresets = getLegacyGeqCustomPresets();
            if (customPresets[key]) {
                const gains = customPresets[key]?.gains;
                if (!Array.isArray(gains) || gains.length === 0) {
                    updateDeleteBtnVisibility();
                    return;
                }
                const adjusted =
                    gains.length !== geqBandCount ? equalizerSettings.interpolateGains(gains, geqBandCount) : gains;
                geqGains = adjusted.map((g) => {
                    const n = Number(g);
                    return Number.isFinite(n)
                        ? Math.max(parseFloat(geqRange.min), Math.min(parseFloat(geqRange.max), n))
                        : 0;
                });
                equalizerSettings.setGraphicEqGains(geqGains);
                audioContextManager.setGraphicEqAllGains(geqGains);
                geqSyncAllSliders();
                if (customPresets[key].preamp !== undefined) {
                    geqPreamp = customPresets[key].preamp;
                    equalizerSettings.setGraphicEqPreamp(geqPreamp);
                    audioContextManager.setGraphicEqPreamp(geqPreamp);
                    geqPreampSliders.forEach((s) => (s.value = geqPreamp));
                    geqPreampValues.forEach((v) => (v.textContent = `${geqPreamp.toFixed(1)} dB`));
                }
                geqPresetSelects.forEach((s) => {
                    if (s !== select) s.value = key;
                });
                updateDeleteBtnVisibility();
                return;
            }
            updateDeleteBtnVisibility();
        });
    });

    if (legacyGeqSavePresetBtn) {
        legacyGeqSavePresetBtn.addEventListener('click', () => {
            const name = prompt('Preset name:');
            if (!name || !name.trim()) return;
            const sanitized = name.trim().substring(0, 50);
            const presets = getLegacyGeqCustomPresets();
            const id = 'geq_custom_' + Date.now();
            presets[id] = {
                name: sanitized,
                gains: geqGains.map((g) => Math.round(g * 10) / 10),
                preamp: Math.round(geqPreamp * 10) / 10,
            };
            saveLegacyGeqCustomPresets(presets);
            refreshLegacyGeqCustomPresetOptions();
            geqPresetSelects.forEach((s) => (s.value = id));
            updateDeleteBtnVisibility();
        });
    }

    if (legacyGeqDeletePresetBtn) {
        legacyGeqDeletePresetBtn.addEventListener('click', () => {
            const selected = legacyGeqPresetSelect?.value || '';
            if (!selected.startsWith('geq_custom_')) return;
            const presets = getLegacyGeqCustomPresets();
            const presetName = presets[selected]?.name || selected;
            if (!confirm(`Delete preset "${presetName}"?`)) return;
            delete presets[selected];
            saveLegacyGeqCustomPresets(presets);
            refreshLegacyGeqCustomPresetOptions();
            geqPresetSelects.forEach((s) => (s.value = ''));
            updateDeleteBtnVisibility();
        });
    }

    // ========================================
    // Precision AutoEQ - Redesigned Equalizer
    // ========================================
    const eqToggle = document.getElementById('equalizer-enabled-toggle');
    const eqContainer = document.getElementById('equalizer-container');
    const eqPreampSlider = document.getElementById('eq-preamp-slider');

    // AutoEQ State (kept when switching modes)
    let autoeqSelectedMeasurement = null;
    let autoeqSelectedEntry = null;
    let autoeqCurrentBands = null; // AutoEQ-generated bands
    let autoeqCorrectedCurve = null;
    let currentPreamp = equalizerSettings.getPreamp();

    // Parametric EQ State (separate from AutoEQ, kept when switching modes)
    let parametricBands = null;

    // Interactive graph state
    let draggedNode = null;
    let hoveredNode = null;
    let graphAnimFrame = null;

    // dB zoom state (half-range values, user-adjustable via scroll on Y axis)
    let graphDbHalfAutoEQ = 16;
    let graphDbHalfParametric = 16;

    /** Get the active bands for the current mode */
    const getActiveBands = () => {
        if (currentMode === 'parametric') return parametricBands;
        if (currentMode === 'speaker') return speakerChannels[speakerActiveChannel]?.bands || null;
        return autoeqCurrentBands;
    };
    /** Set the active bands for the current mode */
    const setActiveBands = (bands) => {
        if (currentMode === 'parametric') parametricBands = bands;
        else if (currentMode === 'speaker') speakerChannels[speakerActiveChannel].bands = bands;
        else autoeqCurrentBands = bands;
    };

    // DOM Elements
    const autoeqCanvas = document.getElementById('autoeq-response-canvas');
    const autoeqGraphWrapper = document.getElementById('autoeq-graph-wrapper');
    const autoeqHeadphoneSelect = document.getElementById('autoeq-headphone-select');
    const autoeqTargetSelect = document.getElementById('autoeq-target-select');
    const autoeqBandCount = document.getElementById('autoeq-band-count');
    const autoeqMaxFreq = document.getElementById('autoeq-max-freq');
    const autoeqSampleRate = document.getElementById('autoeq-sample-rate');

    // Safely set band count dropdown, ensuring the value matches an available option
    const setAutoeqBandCount = (count, bands) => {
        if (!autoeqBandCount) return;
        const val = String(count || (bands && bands.length) || 10);
        autoeqBandCount.value = val;
        // If value didn't match any option (dropdown shows blank), add it or fall back
        if (autoeqBandCount.value !== val) {
            // Try using actual band count from the bands array
            if (bands && bands.length) {
                const bandsVal = String(bands.length);
                autoeqBandCount.value = bandsVal;
                if (autoeqBandCount.value === bandsVal) return;
            }
            // Fall back to default
            autoeqBandCount.value = '10';
        }
    };
    const autoeqRunBtn = document.getElementById('autoeq-run-btn');
    const autoeqDownloadBtn = document.getElementById('autoeq-download-btn');
    const autoeqStatus = document.getElementById('autoeq-status');
    const autoeqImportBtn = document.getElementById('autoeq-import-measurement-btn');
    const autoeqImportFile = document.getElementById('autoeq-import-measurement-file');
    const autoeqSavedGrid = document.getElementById('autoeq-saved-grid');
    const autoeqSavedCount = document.getElementById('autoeq-saved-count');
    const autoeqProfileNameInput = document.getElementById('autoeq-profile-name');
    const autoeqSaveBtn = document.getElementById('autoeq-save-btn');
    const autoeqSavedCollapse = document.getElementById('autoeq-saved-collapse');
    const autoeqDatabaseList = document.getElementById('autoeq-database-list');
    const autoeqDatabaseCount = document.getElementById('autoeq-database-count');
    const autoeqFiltersToggle = document.getElementById('autoeq-filters-toggle');
    const autoeqFiltersContent = document.getElementById('autoeq-filters-content');
    const autoeqFiltersCollapse = document.getElementById('autoeq-filters-collapse');
    const autoeqBandsList = document.getElementById('autoeq-bands-list');
    const autoeqPreampValue = document.getElementById('autoeq-preamp-value');

    // Populate headphone select with popular models
    if (autoeqHeadphoneSelect) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = 'Popular';
        for (const hp of POPULAR_HEADPHONES) {
            const opt = document.createElement('option');
            opt.value = hp.name;
            opt.textContent = hp.name.replace(/\s*\([^)]*\)\s*$/, ''); // strip source suffix for clean display
            opt.dataset.type = hp.type;
            optgroup.appendChild(opt);
        }
        // Insert after the placeholder option
        autoeqHeadphoneSelect.appendChild(optgroup);

        // When user picks a popular headphone from the dropdown, load it
        autoeqHeadphoneSelect.addEventListener('change', async () => {
            const selected = autoeqHeadphoneSelect.value;
            if (!selected) return;
            const popularEntry = POPULAR_HEADPHONES.find((hp) => hp.name === selected);
            if (popularEntry && (!autoeqSelectedEntry || autoeqSelectedEntry.name !== selected)) {
                await loadHeadphoneEntry(popularEntry);
            }
        });
    }

    // ========================================
    // Frequency Response Graph Renderer
    // ========================================
    const FREQ_MIN = 20;
    const FREQ_MAX = 20000;
    const GRAPH_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const LOG_MIN = Math.log10(FREQ_MIN);
    const LOG_MAX = Math.log10(FREQ_MAX);
    const LOG_RANGE = LOG_MAX - LOG_MIN;

    const freqToX = (freq, width) => ((Math.log10(Math.max(FREQ_MIN, freq)) - LOG_MIN) / LOG_RANGE) * width;
    const xToFreq = (x, width) => Math.pow(10, (x / width) * LOG_RANGE + LOG_MIN);
    const dbToY = (db, height, dbMin, dbMax) => height - ((db - dbMin) / (dbMax - dbMin)) * height;
    const yToDb = (y, height, dbMin, dbMax) => dbMin + (1 - y / height) * (dbMax - dbMin);

    const formatFreq = (freq) => {
        if (freq >= 1000) return (freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1) + 'k';
        return Math.round(freq).toString();
    };

    /**
     * Draw the frequency response graph with Original, Target, and Corrected curves
     */
    let _drawGraphRafId = null;
    const scheduleDrawAutoEQGraph = () => {
        if (_drawGraphRafId) return;
        _drawGraphRafId = requestAnimationFrame(() => {
            _drawGraphRafId = null;
            drawAutoEQGraph();
        });
    };

    const drawAutoEQGraph = () => {
        if (!autoeqCanvas) return;
        const activeBands = getActiveBands();
        const ctx = autoeqCanvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = autoeqCanvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        autoeqCanvas.width = rect.width * dpr;
        autoeqCanvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const padLeft = 40,
            padRight = 10,
            padTop = 10,
            padBottom = 30;
        const w = rect.width - padLeft - padRight;
        const h = rect.height - padTop - padBottom;

        ctx.clearRect(0, 0, rect.width, rect.height);

        // dB scale: fixed 75dB center for AutoEQ, 0dB center for Parametric
        const isParametricMode = currentMode === 'parametric';
        const dbCenter = isParametricMode ? 0 : 75;
        const dbHalfRange = isParametricMode ? graphDbHalfParametric : graphDbHalfAutoEQ;
        const dbMin = dbCenter - dbHalfRange;
        const dbMax = dbCenter + dbHalfRange;

        // Helper mappings (local to graph area)
        const gx = (freq) => padLeft + freqToX(freq, w);
        const gy = (db) => padTop + dbToY(db, h, dbMin, dbMax);

        // Fixed curve colors (work across all themes)
        const gridColor = 'rgba(255,255,255,0.06)';
        const textColor = 'rgba(255,255,255,0.4)';
        const originalColor = '#3b82f6'; // Blue
        const targetColor = 'rgba(255,255,255,0.5)'; // White/gray dashed
        const correctedColor = '#f472b6'; // Pink

        // Draw grid
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        // Horizontal grid lines (dB)
        for (let db = dbMin; db <= dbMax; db += 5) {
            const y = gy(db);
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + w, y);
            ctx.stroke();
        }
        // Vertical grid lines (freq)
        for (const freq of GRAPH_FREQS) {
            const x = gx(freq);
            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, padTop + h);
            ctx.stroke();
        }

        // Y axis labels
        ctx.fillStyle = textColor;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let db = dbMin; db <= dbMax; db += 5) {
            ctx.fillText(db.toString(), padLeft - 5, gy(db));
        }

        // X axis labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const freq of GRAPH_FREQS) {
            ctx.fillText(formatFreq(freq), gx(freq), padTop + h + 8);
        }

        // Draw curve helper
        const drawCurve = (data, color, lineWidth, dashed = false) => {
            if (!data || data.length < 2) return;
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            if (dashed) ctx.setLineDash([6, 4]);
            let started = false;
            for (const p of data) {
                if (p.freq < FREQ_MIN || p.freq > FREQ_MAX) continue;
                const x = gx(p.freq);
                const y = gy(p.gain);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
        };

        // Normalize all data to center around dbCenter
        let targetId, targetEntry, targetData, graphMeasurement;
        if (currentMode === 'speaker') {
            const sCh = speakerChannels[speakerActiveChannel];
            targetId = sCh?.targetId || 'harman_room';
            targetEntry = SPEAKER_TARGETS.find((t) => t.id === targetId);
            targetData = targetEntry?.data;
            graphMeasurement = sCh?.measurement;
        } else {
            targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
            targetEntry = TARGETS.find((t) => t.id === targetId);
            targetData = targetEntry?.data;
            graphMeasurement = autoeqSelectedMeasurement;
        }

        let graphShift = 0;

        if (isParametricMode) {
            // Parametric mode: flat 0dB reference line
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padLeft, gy(0));
            ctx.lineTo(padLeft + w, gy(0));
            ctx.stroke();

            if (activeBands && activeBands.length > 0) {
                const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;
                const nodeColors = [
                    '#f472b6',
                    '#fb923c',
                    '#facc15',
                    '#4ade80',
                    '#22d3ee',
                    '#818cf8',
                    '#c084fc',
                    '#f87171',
                    '#34d399',
                    '#60a5fa',
                    '#a78bfa',
                    '#fb7185',
                    '#fbbf24',
                    '#2dd4bf',
                    '#38bdf8',
                    '#a3e635',
                ];

                // Draw individual band bell curves (filled)
                activeBands.forEach((band, i) => {
                    if (!band.enabled || Math.abs(band.gain) < 0.1) return;
                    const color = nodeColors[i % nodeColors.length];
                    const r = parseInt(color.slice(1, 3), 16);
                    const g2 = parseInt(color.slice(3, 5), 16);
                    const b2 = parseInt(color.slice(5, 7), 16);

                    // Draw filled bell shape
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(padLeft, gy(0));
                    for (let f = FREQ_MIN; f <= FREQ_MAX; f *= 1.02) {
                        const resp = calculateBiquadResponse(f, band, sampleRate);
                        ctx.lineTo(gx(f), gy(resp));
                    }
                    ctx.lineTo(padLeft + w, gy(0));
                    ctx.closePath();
                    ctx.fillStyle = `rgba(${r},${g2},${b2},0.12)`;
                    ctx.fill();

                    // Draw bell curve outline
                    ctx.beginPath();
                    let started = false;
                    for (let f = FREQ_MIN; f <= FREQ_MAX; f *= 1.02) {
                        const resp = calculateBiquadResponse(f, band, sampleRate);
                        const bx = gx(f);
                        const by = gy(resp);
                        if (!started) {
                            ctx.moveTo(bx, by);
                            started = true;
                        } else ctx.lineTo(bx, by);
                    }
                    ctx.strokeStyle = `rgba(${r},${g2},${b2},0.5)`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.restore();
                });

                // Draw combined EQ response curve (sum of all bands)
                const eqCurve = [];
                for (let f = FREQ_MIN; f <= FREQ_MAX; f *= 1.02) {
                    let totalGain = 0;
                    for (const band of activeBands) {
                        if (band.enabled) totalGain += calculateBiquadResponse(f, band, sampleRate);
                    }
                    eqCurve.push({ freq: f, gain: totalGain });
                }
                drawCurve(eqCurve, 'rgba(255,255,255,0.8)', 2);
            }
        } else {
            // AutoEQ / Speaker mode: draw measurement, target, corrected
            if (targetData) {
                const targetMidAvg = getNormalizationOffset(targetData);
                graphShift = dbCenter - targetMidAvg;
            } else if (graphMeasurement) {
                const measMidAvg = getNormalizationOffset(graphMeasurement);
                graphShift = dbCenter - measMidAvg;
            }

            // Draw Target curve (shifted)
            if (targetData) {
                const shiftedTarget = targetData.map((p) => ({ freq: p.freq, gain: p.gain + graphShift }));
                drawCurve(shiftedTarget, targetColor, 1.5, true);
            }

            // Draw Original measurement (normalized + shifted)
            if (graphMeasurement) {
                const normOff = targetData ? getNormalizationOffset(graphMeasurement, targetData) : 0;
                const normalized = graphMeasurement.map((p) => ({ freq: p.freq, gain: p.gain + normOff + graphShift }));
                drawCurve(normalized, originalColor, 1.5);
            }

            // Draw Corrected curve (shifted)
            if (autoeqCorrectedCurve) {
                const shiftedCorrected = autoeqCorrectedCurve.map((p) => ({ freq: p.freq, gain: p.gain + graphShift }));
                drawCurve(shiftedCorrected, correctedColor, 2);
            }
        }

        // Speaker EQ: draw bass limit & room limit markers
        if (currentMode === 'speaker') {
            const bassHz = speakerBassCutoff ? parseInt(speakerBassCutoff.value, 10) : 40;
            const roomHz = speakerRoomLimit ? parseInt(speakerRoomLimit.value, 10) : 500;

            // Shaded regions outside EQ range
            ctx.fillStyle = 'rgba(34, 211, 238, 0.04)';
            ctx.fillRect(padLeft, padTop, gx(bassHz) - padLeft, h);
            ctx.fillStyle = 'rgba(245, 158, 11, 0.04)';
            ctx.fillRect(gx(roomHz), padTop, padLeft + w - gx(roomHz), h);

            // Bass limit line (cyan dashed)
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.moveTo(gx(bassHz), padTop);
            ctx.lineTo(gx(bassHz), padTop + h);
            ctx.stroke();
            ctx.restore();

            // Bass limit label
            ctx.save();
            ctx.font = 'bold 9px system-ui';
            ctx.fillStyle = 'rgba(34, 211, 238, 0.7)';
            ctx.textAlign = 'center';
            ctx.fillText(bassHz + ' Hz', gx(bassHz), padTop - 2);
            ctx.restore();

            // Room limit line (amber dashed)
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.moveTo(gx(roomHz), padTop);
            ctx.lineTo(gx(roomHz), padTop + h);
            ctx.stroke();
            ctx.restore();

            // Room limit label
            ctx.save();
            ctx.font = 'bold 9px system-ui';
            ctx.fillStyle = 'rgba(245, 158, 11, 0.7)';
            ctx.textAlign = 'center';
            ctx.fillText(roomHz + ' Hz', gx(roomHz), padTop - 2);
            ctx.restore();
        }

        // Draw interactive nodes
        if (activeBands && activeBands.length > 0 && (autoeqCorrectedCurve || isParametricMode)) {
            const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;
            activeBands.forEach((band, i) => {
                if (!band.enabled) return;
                const x = gx(band.freq);
                // In parametric mode: node Y = band's individual response at its freq (basically its gain)
                // In AutoEQ mode: node Y = corrected curve value at band freq (shifted)
                let nodeGain, sumGain;
                if (isParametricMode) {
                    // Node sits at individual band gain; sum is for tooltip only
                    nodeGain = band.gain;
                    sumGain = 0;
                    for (const b of activeBands) {
                        if (b.enabled) sumGain += calculateBiquadResponse(band.freq, b, sampleRate);
                    }
                } else {
                    nodeGain = interpolate(band.freq, autoeqCorrectedCurve) + graphShift;
                    sumGain = nodeGain;
                }
                const y = gy(nodeGain);

                // Draw node circle with unique color per band
                const nodeColors = [
                    '#f472b6',
                    '#fb923c',
                    '#facc15',
                    '#4ade80',
                    '#22d3ee',
                    '#818cf8',
                    '#c084fc',
                    '#f87171',
                    '#34d399',
                    '#60a5fa',
                    '#a78bfa',
                    '#fb7185',
                    '#fbbf24',
                    '#2dd4bf',
                    '#38bdf8',
                    '#a3e635',
                ];
                const nodeColor = nodeColors[i % nodeColors.length];
                const isHovered = i === hoveredNode;
                const isDragged = i === draggedNode;
                const radius = isDragged ? 9 : isHovered ? 7 : 5;

                // Glow effect on hover/drag
                if (isHovered || isDragged) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
                    ctx.fillStyle = nodeColor.replace(')', ', 0.25)').replace('rgb', 'rgba').replace('#', '');
                    // Use hex to rgba
                    const r2 = parseInt(nodeColor.slice(1, 3), 16);
                    const g2 = parseInt(nodeColor.slice(3, 5), 16);
                    const b2 = parseInt(nodeColor.slice(5, 7), 16);
                    ctx.fillStyle = `rgba(${r2},${g2},${b2},0.25)`;
                    ctx.fill();
                    ctx.restore();
                }

                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fillStyle = isDragged ? '#fff' : nodeColor;
                ctx.fill();
                ctx.strokeStyle = isDragged ? nodeColor : 'rgba(0,0,0,0.5)';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Show M/S channel label inside node for non-stereo bands
                const bandChannel = band.channel || 'stereo';
                if (bandChannel !== 'stereo') {
                    ctx.save();
                    ctx.font = `bold ${isDragged ? 10 : isHovered ? 9 : 7}px system-ui, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = isDragged ? nodeColor : '#fff';
                    ctx.fillText(bandChannel === 'mid' ? 'M' : 'S', x, y + 0.5);
                    ctx.restore();
                }

                // Show tooltip on drag
                if (isDragged) {
                    ctx.save();
                    ctx.font = 'bold 11px system-ui, sans-serif';
                    const chLabel = bandChannel !== 'stereo' ? ` [${bandChannel.toUpperCase()}]` : '';
                    const line1 = `${Math.round(band.freq)} Hz  ${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB  Q${band.q.toFixed(2)}${chLabel}`;
                    const line2 = `Sum: ${sumGain > 0 ? '+' : ''}${sumGain.toFixed(1)} dB`;
                    const tw1 = ctx.measureText(line1).width;
                    const tw2 = ctx.measureText(line2).width;
                    const tw = Math.max(tw1, tw2) + 12;
                    const th = 34;
                    const tx = Math.max(5, Math.min(x - tw / 2, rect.width - tw - 5));
                    const ty = y - 44;
                    ctx.fillStyle = 'rgba(0,0,0,0.8)';
                    ctx.fillRect(tx, ty, tw, th);
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(line1, tx + tw / 2, ty + 10);
                    ctx.fillStyle = 'rgba(255,255,255,0.7)';
                    ctx.fillText(line2, tx + tw / 2, ty + 24);
                    ctx.restore();
                }
            });
        }
    };

    /**
     * Compute corrected curve from measurement + bands
     */
    const computeCorrectedCurve = () => {
        let measurement, bands, tId, tList;
        if (currentMode === 'speaker') {
            const sCh = speakerChannels[speakerActiveChannel];
            measurement = sCh?.measurement;
            bands = sCh?.bands;
            tId = sCh?.targetId || 'harman_room';
            tList = SPEAKER_TARGETS;
        } else {
            measurement = autoeqSelectedMeasurement;
            bands = autoeqCurrentBands;
            tId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
            tList = TARGETS;
        }

        if (!measurement || !bands) {
            autoeqCorrectedCurve = null;
            return;
        }
        const targetEntry = tList.find((t) => t.id === tId);
        const targetData = targetEntry?.data;
        const normOff = targetData ? getNormalizationOffset(measurement, targetData) : 0;
        const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;

        autoeqCorrectedCurve = measurement.map((p) => {
            let correction = 0;
            for (const band of bands) {
                if (band.enabled) correction += calculateBiquadResponse(p.freq, band, sampleRate);
            }
            return { freq: p.freq, gain: p.gain + normOff + correction };
        });
    };

    /**
     * Get canvas coordinates from mouse event
     */
    const getCanvasCoords = (e) => {
        const rect = autoeqCanvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /**
     * Find closest node to coordinates
     */
    const findClosestNode = (mx, my, threshold = 15) => {
        const activeBands = getActiveBands();
        if (!activeBands || !autoeqCanvas) return -1;
        const isParam = currentMode === 'parametric';
        if (!isParam && !autoeqCorrectedCurve) return -1;

        const rect = autoeqCanvas.getBoundingClientRect();
        const padLeft = 40,
            padRight = 10,
            padTop = 10,
            padBottom = 30;
        const w = rect.width - padLeft - padRight;
        const h = rect.height - padTop - padBottom;

        const dbCenter = isParam ? 0 : 75;
        const dbHalfRange = isParam ? graphDbHalfParametric : graphDbHalfAutoEQ;
        const dbMin = dbCenter - dbHalfRange;
        const dbMax = dbCenter + dbHalfRange;

        let graphShift = 0;
        if (!isParam) {
            let tId, tList, meas;
            if (currentMode === 'speaker') {
                const sCh = speakerChannels[speakerActiveChannel];
                tId = sCh?.targetId || 'harman_room';
                tList = SPEAKER_TARGETS;
                meas = sCh?.measurement;
            } else {
                tId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
                tList = TARGETS;
                meas = autoeqSelectedMeasurement;
            }
            const targetEntry = tList.find((t) => t.id === tId);
            const targetData = targetEntry?.data;
            if (targetData) graphShift = 75 - getNormalizationOffset(targetData);
            else if (meas) graphShift = 75 - getNormalizationOffset(meas);
        }

        let closest = -1,
            closestDist = Infinity;
        activeBands.forEach((band, i) => {
            if (!band.enabled) return;
            const x = padLeft + freqToX(band.freq, w);
            let nodeGain;
            if (isParam) {
                nodeGain = band.gain;
            } else {
                nodeGain = interpolate(band.freq, autoeqCorrectedCurve) + graphShift;
            }
            const y = padTop + dbToY(nodeGain, h, dbMin, dbMax);
            const dist = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
            if (dist < threshold && dist < closestDist) {
                closest = i;
                closestDist = dist;
            }
        });
        return closest;
    };

    /**
     * Auto preamp compensation state
     */
    let autoPreampEnabled = false;
    const autoPreampToggle = document.getElementById('autoeq-auto-preamp-toggle');

    /**
     * Apply current bands to audio engine
     */
    const applyBandsToAudio = (bands) => {
        if (bands && bands.length > 0) {
            // Pass skipPreamp=true when auto preamp is off so the engine doesn't override manual preamp
            audioContextManager.applyAutoEQBands(bands, !autoPreampEnabled);
            currentPreamp = equalizerSettings.getPreamp();
            if (eqPreampSlider) eqPreampSlider.value = currentPreamp;
            if (autoeqPreampValue) autoeqPreampValue.textContent = `${currentPreamp} dB`;
        }
    };

    // ========================================
    // Interactive Graph Mouse/Touch Handlers
    // ========================================
    if (autoeqCanvas) {
        autoeqCanvas.addEventListener('mousedown', (e) => {
            hideEqContextMenu();
            hideEmptyContextMenu();
            const coords = getCanvasCoords(e);
            const nodeIdx = findClosestNode(coords.x, coords.y, 18);
            if (nodeIdx >= 0) {
                // Clicked directly on a node - start dragging
                draggedNode = nodeIdx;
                autoeqCanvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        // Helper to compute canvas-relative coords from any mouse event (even outside the canvas)
        const getCanvasCoordsFromEvent = (e) => {
            const rect = autoeqCanvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        // Clean up previous document-level listeners and observer on re-initialization
        if (_graphAbortController) _graphAbortController.abort();
        _graphAbortController = new AbortController();
        const graphSignal = _graphAbortController.signal;
        if (_graphResizeObserver) {
            _graphResizeObserver.disconnect();
            _graphResizeObserver = null;
        }

        // Document-level mousemove so dragging continues outside the canvas
        document.addEventListener(
            'mousemove',
            (e) => {
                if (draggedNode === null) return;
                const bands = getActiveBands();
                if (!bands) return;

                const coords = getCanvasCoordsFromEvent(e);
                const rect = autoeqCanvas.getBoundingClientRect();
                const padLeft = 40,
                    padRight = 10,
                    padTop = 10,
                    padBottom = 30;
                const w = rect.width - padLeft - padRight;
                const h = rect.height - padTop - padBottom;

                const isParam = currentMode === 'parametric';
                const dbCenter = isParam ? 0 : 75;
                const dbHalf = isParam ? graphDbHalfParametric : graphDbHalfAutoEQ;
                const dbMin = dbCenter - dbHalf;
                const dbMax = dbCenter + dbHalf;

                const freq = xToFreq(coords.x - padLeft, w);
                bands[draggedNode].freq = Math.max(20, Math.min(20000, freq));

                if (isParam) {
                    const newGain = yToDb(coords.y - padTop, h, dbMin, dbMax);
                    bands[draggedNode].gain = Math.max(-30, Math.min(30, Math.round(newGain * 10) / 10));
                } else {
                    const corrGain = interpolate(bands[draggedNode].freq, autoeqCorrectedCurve || []);
                    const newDb = yToDb(coords.y - padTop, h, dbMin, dbMax);
                    const gainDelta = newDb - corrGain;
                    bands[draggedNode].gain = Math.max(-30, Math.min(30, bands[draggedNode].gain + gainDelta * 0.3));
                }

                if (!graphAnimFrame) {
                    graphAnimFrame = requestAnimationFrame(() => {
                        computeCorrectedCurve();
                        applyBandsToAudio(bands);
                        drawAutoEQGraph();
                        renderBandControls(bands);
                        graphAnimFrame = null;
                    });
                }
            },
            { signal: graphSignal }
        );

        // Canvas-only mousemove for hover cursor changes (when not dragging)
        autoeqCanvas.addEventListener('mousemove', (e) => {
            if (draggedNode !== null) return; // dragging is handled by document listener
            const coords = getCanvasCoords(e);
            const padLeft = 40;
            if (coords.x <= padLeft + 10) {
                autoeqCanvas.style.cursor = 'ns-resize';
                if (hoveredNode !== null) {
                    hoveredNode = null;
                    drawAutoEQGraph();
                }
            } else {
                const newHovered = findClosestNode(coords.x, coords.y, 18);
                if (newHovered !== hoveredNode) {
                    hoveredNode = newHovered;
                    autoeqCanvas.style.cursor = hoveredNode >= 0 ? 'grab' : 'crosshair';
                    drawAutoEQGraph();
                }
            }
        });

        // Document-level mouseup so drag ends even if cursor is outside the canvas
        document.addEventListener(
            'mouseup',
            () => {
                if (draggedNode !== null) {
                    draggedNode = null;
                    autoeqCanvas.style.cursor = hoveredNode >= 0 ? 'grab' : 'crosshair';
                }
            },
            { signal: graphSignal }
        );

        autoeqCanvas.addEventListener('mouseleave', () => {
            // Only reset hover state, NOT drag state (drag continues outside canvas)
            hoveredNode = null;
            if (draggedNode === null) {
                autoeqCanvas.style.cursor = 'crosshair';
            }
            drawAutoEQGraph();
        });

        // ========================================
        // EQ Node Right-Click Context Menu
        // ========================================
        const eqCtxMenu = document.getElementById('eq-node-context-menu');
        let contextMenuNodeIdx = null;

        const hideEqContextMenu = () => {
            if (eqCtxMenu) eqCtxMenu.style.display = 'none';
            contextMenuNodeIdx = null;
        };

        const showEqContextMenu = (x, y, nodeIdx) => {
            if (!eqCtxMenu) return;
            const bands = getActiveBands();
            if (!bands || !bands[nodeIdx]) return;

            contextMenuNodeIdx = nodeIdx;
            const band = bands[nodeIdx];

            // Update active states for filter type items
            eqCtxMenu.querySelectorAll('.eq-ctx-type').forEach((li) => {
                const action = li.dataset.action;
                const isActive =
                    (action === 'eq-type-lowshelf' && band.type === 'lowshelf') ||
                    (action === 'eq-type-peaking' && band.type === 'peaking') ||
                    (action === 'eq-type-highshelf' && band.type === 'highshelf');
                li.classList.toggle('eq-ctx-active', isActive);
            });

            // Update active states for channel items (per-band M/S mode)
            const bandChannel = band.channel || 'stereo';
            eqCtxMenu.querySelectorAll('.eq-ctx-channel').forEach((li) => {
                const action = li.dataset.action;
                const isActive =
                    (action === 'eq-channel-stereo' && bandChannel === 'stereo') ||
                    (action === 'eq-channel-mid' && bandChannel === 'mid') ||
                    (action === 'eq-channel-side' && bandChannel === 'side');
                li.classList.toggle('eq-ctx-active', isActive);
            });

            // Position menu at cursor, clamped to viewport
            eqCtxMenu.style.display = 'block';
            const menuRect = eqCtxMenu.getBoundingClientRect();
            const clampedX = Math.min(x, window.innerWidth - menuRect.width - 4);
            const clampedY = Math.min(y, window.innerHeight - menuRect.height - 4);
            eqCtxMenu.style.left = `${clampedX}px`;
            eqCtxMenu.style.top = `${clampedY}px`;
        };

        if (eqCtxMenu) {
            // Handle menu item clicks
            eqCtxMenu.addEventListener('click', (e) => {
                const li = e.target.closest('li[data-action]');
                if (!li) return;

                const action = li.dataset.action;
                const bands = getActiveBands();

                // Filter type actions
                if (
                    action.startsWith('eq-type-') &&
                    contextMenuNodeIdx !== null &&
                    bands &&
                    bands[contextMenuNodeIdx]
                ) {
                    const typeMap = {
                        'eq-type-lowshelf': 'lowshelf',
                        'eq-type-peaking': 'peaking',
                        'eq-type-highshelf': 'highshelf',
                    };
                    const newType = typeMap[action];
                    if (newType) {
                        bands[contextMenuNodeIdx].type = newType;
                        computeCorrectedCurve();
                        applyBandsToAudio(bands);
                        renderBandControls(bands);
                        drawAutoEQGraph();
                    }
                }

                // Channel actions (per-band M/S mode)
                if (
                    action.startsWith('eq-channel-') &&
                    contextMenuNodeIdx !== null &&
                    bands &&
                    bands[contextMenuNodeIdx]
                ) {
                    const channelMap = {
                        'eq-channel-stereo': 'stereo',
                        'eq-channel-mid': 'mid',
                        'eq-channel-side': 'side',
                    };
                    const newChannel = channelMap[action];
                    if (newChannel) {
                        bands[contextMenuNodeIdx].channel = newChannel;
                        computeCorrectedCurve();
                        applyBandsToAudio(bands);
                        renderBandControls(bands);
                        drawAutoEQGraph();
                    }
                }

                hideEqContextMenu();
            });
        }

        // Empty-space context menu (Add Node)
        const eqEmptyCtxMenu = document.getElementById('eq-empty-context-menu');
        let pendingAddCoords = null;

        const hideEmptyContextMenu = () => {
            if (eqEmptyCtxMenu) eqEmptyCtxMenu.style.display = 'none';
            pendingAddCoords = null;
        };

        const showEmptyContextMenu = (clientX, clientY, canvasCoords) => {
            if (!eqEmptyCtxMenu) return;
            pendingAddCoords = canvasCoords;
            eqEmptyCtxMenu.style.display = 'block';
            const menuRect = eqEmptyCtxMenu.getBoundingClientRect();
            eqEmptyCtxMenu.style.left = `${Math.min(clientX, window.innerWidth - menuRect.width - 4)}px`;
            eqEmptyCtxMenu.style.top = `${Math.min(clientY, window.innerHeight - menuRect.height - 4)}px`;
        };

        if (eqEmptyCtxMenu) {
            eqEmptyCtxMenu.addEventListener('click', (e) => {
                const li = e.target.closest('li[data-action]');
                if (!li || li.dataset.action !== 'eq-add-node' || !pendingAddCoords) return;

                const isParam = currentMode === 'parametric';
                let bands = getActiveBands();
                if (!bands) {
                    if (currentMode === 'autoeq') {
                        autoeqCurrentBands = [];
                        bands = autoeqCurrentBands;
                    } else {
                        hideEmptyContextMenu();
                        return;
                    }
                }
                if (bands.length >= 32) {
                    hideEmptyContextMenu();
                    return;
                }

                const rect = autoeqCanvas.getBoundingClientRect();
                const padLeft = 40,
                    padRight = 10,
                    padTop = 10,
                    padBottom = 30;
                const w = rect.width - padLeft - padRight;
                const h = rect.height - padTop - padBottom;
                const dbCenter = isParam ? 0 : 75;
                const dbHalf = isParam ? graphDbHalfParametric : graphDbHalfAutoEQ;
                const dbMin = dbCenter - dbHalf;
                const dbMax = dbCenter + dbHalf;
                const freq = Math.max(20, Math.min(20000, Math.round(xToFreq(pendingAddCoords.x - padLeft, w))));
                const gain = Math.max(
                    -30,
                    Math.min(30, Math.round((yToDb(pendingAddCoords.y - padTop, h, dbMin, dbMax) - dbCenter) * 10) / 10)
                );

                bands.push({ id: bands.length, type: 'peaking', freq, gain, q: 1.0, enabled: true, channel: 'stereo' });
                setActiveBands(bands);
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                renderBandControls(bands);
                drawAutoEQGraph();
                hideEmptyContextMenu();
            });
        }

        // Right-click on canvas: show node menu or empty-space menu
        autoeqCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            hideEmptyContextMenu();
            hideEqContextMenu();
            const coords = getCanvasCoords(e);
            const nodeIdx = findClosestNode(coords.x, coords.y, 18);
            if (nodeIdx >= 0) {
                showEqContextMenu(e.clientX, e.clientY, nodeIdx);
            } else {
                showEmptyContextMenu(e.clientX, e.clientY, coords);
            }
        });

        // Dismiss context menus when clicking outside the EQ graph area
        document.addEventListener(
            'mousedown',
            (e) => {
                const graphWrapper = document.getElementById('autoeq-graph-wrapper');
                if (
                    contextMenuNodeIdx !== null &&
                    eqCtxMenu &&
                    !eqCtxMenu.contains(e.target) &&
                    (!graphWrapper || !graphWrapper.contains(e.target))
                ) {
                    hideEqContextMenu();
                }
                if (
                    pendingAddCoords &&
                    eqEmptyCtxMenu &&
                    !eqEmptyCtxMenu.contains(e.target) &&
                    (!graphWrapper || !graphWrapper.contains(e.target))
                ) {
                    hideEmptyContextMenu();
                }
            },
            { signal: graphSignal }
        );

        autoeqCanvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const coords = getCanvasCoords(e);
            const isParam = currentMode === 'parametric';

            // getActiveBands() returns null in autoeq mode before first run - init to empty array
            let bands = getActiveBands();
            if (!bands) {
                if (currentMode === 'autoeq') {
                    autoeqCurrentBands = [];
                    bands = autoeqCurrentBands;
                } else return;
            }

            // findClosestNode needs autoeqCorrectedCurve in non-parametric modes.
            // Fall back to frequency-only (X-axis) matching when corrected curve is absent.
            let nodeIdx = findClosestNode(coords.x, coords.y, 18);
            if (nodeIdx < 0 && !isParam && !autoeqCorrectedCurve && bands.length > 0) {
                const rect2 = autoeqCanvas.getBoundingClientRect();
                const w2 = rect2.width - 40 - 10;
                let best = Infinity;
                bands.forEach((band, i) => {
                    const dx = Math.abs(coords.x - (40 + freqToX(band.freq, w2)));
                    if (dx < 18 && dx < best) {
                        best = dx;
                        nodeIdx = i;
                    }
                });
            }

            if (nodeIdx >= 0) {
                bands.splice(nodeIdx, 1);
                bands.forEach((b, i) => {
                    b.id = i;
                });
                draggedNode = null;
                hoveredNode = null;
            } else {
                if (bands.length >= 32) return;
                const rect = autoeqCanvas.getBoundingClientRect();
                const padLeft = 40,
                    padRight = 10,
                    padTop = 10,
                    padBottom = 30;
                const w = rect.width - padLeft - padRight;
                const h = rect.height - padTop - padBottom;
                const dbCenter = isParam ? 0 : 75;
                const dbHalf = isParam ? graphDbHalfParametric : graphDbHalfAutoEQ;
                const dbMin = dbCenter - dbHalf;
                const dbMax = dbCenter + dbHalf;
                const freq = Math.max(20, Math.min(20000, Math.round(xToFreq(coords.x - padLeft, w))));
                const gain = Math.max(
                    -30,
                    Math.min(30, Math.round((yToDb(coords.y - padTop, h, dbMin, dbMax) - dbCenter) * 10) / 10)
                );
                bands.push({ id: bands.length, type: 'peaking', freq, gain, q: 1.0, enabled: true, channel: 'stereo' });
            }

            setActiveBands(bands);
            computeCorrectedCurve();
            applyBandsToAudio(bands);
            renderBandControls(bands);
            drawAutoEQGraph();
        });

        autoeqCanvas.addEventListener(
            'wheel',
            (e) => {
                const coords = getCanvasCoords(e);
                const padLeft = 40;

                // Scroll on Y axis area (left edge) = dB zoom
                if (coords.x <= padLeft + 10) {
                    e.preventDefault();
                    const zoomStep = e.deltaY > 0 ? 2 : -2; // scroll down = zoom out (wider range), scroll up = zoom in
                    if (currentMode === 'parametric') {
                        graphDbHalfParametric = Math.max(5, Math.min(60, graphDbHalfParametric + zoomStep));
                    } else {
                        graphDbHalfAutoEQ = Math.max(5, Math.min(60, graphDbHalfAutoEQ + zoomStep));
                    }
                    drawAutoEQGraph();
                    return;
                }

                // Scroll on a node = Q adjust
                const wBands = getActiveBands();
                if (hoveredNode >= 0 && wBands && wBands[hoveredNode]) {
                    e.preventDefault();
                    const band = wBands[hoveredNode];
                    const delta = e.deltaY > 0 ? -0.15 : 0.15;
                    band.q = Math.max(0.1, Math.min(10, (band.q || 1) + delta));
                    computeCorrectedCurve();
                    applyBandsToAudio(wBands);
                    drawAutoEQGraph();
                    renderBandControls(wBands);
                }
            },
            { passive: false }
        );

        // Touch support - drag nodes on direct touch, continue drag outside canvas
        let touchNodeIdx = -1;
        autoeqCanvas.addEventListener(
            'touchstart',
            (e) => {
                const touch = e.touches[0];
                const rect = autoeqCanvas.getBoundingClientRect();
                const coords = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
                touchNodeIdx = findClosestNode(coords.x, coords.y, 25);
                if (touchNodeIdx >= 0) {
                    draggedNode = touchNodeIdx;
                    e.preventDefault();
                }
            },
            { passive: false }
        );

        // Document-level touchmove so dragging continues outside canvas
        document.addEventListener(
            'touchmove',
            (e) => {
                if (draggedNode === null) return;
                const tBands = getActiveBands();
                if (!tBands) return;

                const touch = e.touches[0];
                const rect = autoeqCanvas.getBoundingClientRect();
                const coords = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
                const padLeft = 40,
                    padRight = 10,
                    padTop = 10,
                    padBottom = 30;
                const w = rect.width - padLeft - padRight;
                const h = rect.height - padTop - padBottom;

                const isParam = currentMode === 'parametric';
                const dbCenter = isParam ? 0 : 75;
                const dbHalf = isParam ? graphDbHalfParametric : graphDbHalfAutoEQ;
                const dbMin = dbCenter - dbHalf;
                const dbMax = dbCenter + dbHalf;

                const freq = xToFreq(coords.x - padLeft, w);
                tBands[draggedNode].freq = Math.max(20, Math.min(20000, freq));

                if (isParam) {
                    const newGain = yToDb(coords.y - padTop, h, dbMin, dbMax);
                    tBands[draggedNode].gain = Math.max(-30, Math.min(30, Math.round(newGain * 10) / 10));
                } else {
                    const corrGain = interpolate(tBands[draggedNode].freq, autoeqCorrectedCurve || []);
                    const newDb = yToDb(coords.y - padTop, h, dbMin, dbMax);
                    const gainDelta = newDb - corrGain;
                    tBands[draggedNode].gain = Math.max(-30, Math.min(30, tBands[draggedNode].gain + gainDelta * 0.3));
                }

                computeCorrectedCurve();
                applyBandsToAudio(tBands);
                if (!graphAnimFrame) {
                    graphAnimFrame = requestAnimationFrame(() => {
                        drawAutoEQGraph();
                        renderBandControls(tBands);
                        graphAnimFrame = null;
                    });
                }
                e.preventDefault();
            },
            { passive: false, signal: graphSignal }
        );

        document.addEventListener(
            'touchend',
            () => {
                if (draggedNode !== null) {
                    draggedNode = null;
                    touchNodeIdx = -1;
                }
            },
            { signal: graphSignal }
        );

        // Resize observer for graph
        if (autoeqGraphWrapper) {
            _graphResizeObserver = new ResizeObserver(() => {
                scheduleDrawAutoEQGraph();
            });
            _graphResizeObserver.observe(autoeqGraphWrapper);
        }
    }

    // ========================================
    // Per-Band Parametric EQ Controls
    // ========================================
    const renderBandControls = (bands) => {
        if (!autoeqBandsList) return;
        autoeqBandsList.innerHTML = '';
        if (!bands || bands.length === 0) return;

        bands.forEach((band, i) => {
            const control = document.createElement('div');
            control.className = 'autoeq-band-control';
            control.dataset.band = i;
            const currentType = band.type || 'peaking';
            const currentChannel = band.channel || 'stereo';
            control.innerHTML = `
                <div class="autoeq-band-header">
                    <span class="autoeq-band-number">${i + 1}</span>
                    <select class="autoeq-type-select">
                        <option value="peaking"${currentType === 'peaking' ? ' selected' : ''}>PK</option>
                        <option value="lowshelf"${currentType === 'lowshelf' ? ' selected' : ''}>LSF</option>
                        <option value="highshelf"${currentType === 'highshelf' ? ' selected' : ''}>HSF</option>
                    </select>
                    <select class="autoeq-channel-select">
                        <option value="stereo"${currentChannel === 'stereo' ? ' selected' : ''}>ST</option>
                        <option value="mid"${currentChannel === 'mid' ? ' selected' : ''}>M</option>
                        <option value="side"${currentChannel === 'side' ? ' selected' : ''}>S</option>
                    </select>
                    <div class="autoeq-band-param">
                        <span class="autoeq-band-param-label">Freq</span>
                        <span class="autoeq-band-value autoeq-freq-val">${formatFreq(band.freq)} Hz</span>
                    </div>
                    <div class="autoeq-band-param">
                        <span class="autoeq-band-param-label">Gain</span>
                        <span class="autoeq-band-value autoeq-gain-val">${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB</span>
                    </div>
                    <div class="autoeq-band-param">
                        <span class="autoeq-band-param-label">Q</span>
                        <span class="autoeq-band-value autoeq-q-val">${band.q.toFixed(2)}</span>
                    </div>
                </div>
                <div class="autoeq-band-sliders">
                    <input type="range" class="autoeq-band-slider autoeq-freq-slider" min="20" max="20000" step="1" value="${Math.round(band.freq)}" />
                    <input type="range" class="autoeq-band-slider autoeq-gain-slider" min="-30" max="30" step="0.1" value="${band.gain.toFixed(1)}" />
                    <input type="range" class="autoeq-band-slider autoeq-q-slider" min="0.1" max="10" step="0.01" value="${band.q.toFixed(2)}" />
                </div>
            `;
            autoeqBandsList.appendChild(control);

            // Attach slider event listeners
            const freqSlider = control.querySelector('.autoeq-freq-slider');
            const gainSlider = control.querySelector('.autoeq-gain-slider');
            const qSlider = control.querySelector('.autoeq-q-slider');
            const freqVal = control.querySelector('.autoeq-freq-val');
            const gainVal = control.querySelector('.autoeq-gain-val');
            const qVal = control.querySelector('.autoeq-q-val');

            freqSlider.addEventListener('input', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].freq = parseFloat(freqSlider.value);
                freqVal.textContent = `${formatFreq(bands[i].freq)} Hz`;
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                scheduleDrawAutoEQGraph();
            });

            gainSlider.addEventListener('input', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].gain = parseFloat(gainSlider.value);
                gainVal.textContent = `${bands[i].gain > 0 ? '+' : ''}${bands[i].gain.toFixed(1)} dB`;
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                scheduleDrawAutoEQGraph();
            });

            qSlider.addEventListener('input', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].q = parseFloat(qSlider.value);
                qVal.textContent = bands[i].q.toFixed(2);
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                scheduleDrawAutoEQGraph();
            });

            const typeSelect = control.querySelector('.autoeq-type-select');
            typeSelect.addEventListener('change', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].type = typeSelect.value;
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                scheduleDrawAutoEQGraph();
            });

            const channelSelect = control.querySelector('.autoeq-channel-select');
            channelSelect.addEventListener('change', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].channel = channelSelect.value;
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                scheduleDrawAutoEQGraph();
            });
        });
    };

    // ========================================
    // EQ Toggle + Container Visibility
    // ========================================
    /**
     * Ensure parametric bands exist - creates default 10 log-spaced bands if none
     */
    const ensureParametricBands = () => {
        if (!parametricBands || parametricBands.length === 0) {
            const defaultBands = [];
            for (let i = 0; i < 10; i++) {
                const freq = 20 * Math.pow(20000 / 20, i / 9);
                defaultBands.push({
                    id: i,
                    type: 'peaking',
                    freq: Math.round(freq),
                    gain: 0,
                    q: 1.0,
                    enabled: true,
                    channel: 'stereo',
                });
            }
            parametricBands = defaultBands;
            applyBandsToAudio(parametricBands);
        }
    };

    const updateEQContainerVisibility = (enabled) => {
        if (eqContainer) {
            eqContainer.style.display = enabled ? 'flex' : 'none';
            if (enabled) {
                // Ensure bands exist when EQ is enabled (fixes parametric mode without AutoEQ)
                if (currentMode === 'parametric') {
                    ensureParametricBands();
                    applyBandsToAudio(parametricBands);
                    renderBandControls(parametricBands);
                }
                requestAnimationFrame(drawAutoEQGraph);
            }
        }
    };

    // ========================================
    // Collapsible Sections
    // ========================================
    // Saved Profiles collapse
    if (autoeqSavedCollapse) {
        const savedGrid = document.getElementById('autoeq-saved-grid');
        autoeqSavedCollapse.addEventListener('click', (e) => {
            e.stopPropagation();
            autoeqSavedCollapse.classList.toggle('collapsed');
            if (savedGrid)
                savedGrid.style.display = autoeqSavedCollapse.classList.contains('collapsed') ? 'none' : 'flex';
        });
    }

    // Parametric EQ Filters collapse
    if (autoeqFiltersToggle) {
        autoeqFiltersToggle.addEventListener('click', () => {
            if (autoeqFiltersCollapse) autoeqFiltersCollapse.classList.toggle('collapsed');
            if (autoeqFiltersContent)
                autoeqFiltersContent.style.display = autoeqFiltersContent.style.display === 'none' ? 'flex' : 'none';
        });
    }

    // Database section collapse
    const autoeqDatabaseToggle = document.getElementById('autoeq-database-toggle');
    const autoeqDatabaseCollapse = document.getElementById('autoeq-database-collapse');
    const autoeqDatabaseBody = document.getElementById('autoeq-database-body');
    if (autoeqDatabaseToggle) {
        autoeqDatabaseToggle.addEventListener('click', () => {
            if (autoeqDatabaseCollapse) autoeqDatabaseCollapse.classList.toggle('collapsed');
            if (autoeqDatabaseBody)
                autoeqDatabaseBody.style.display = autoeqDatabaseBody.style.display === 'none' ? '' : 'none';
            if (autoeqDatabaseCollapse) {
                const isExpanded = !autoeqDatabaseCollapse.classList.contains('collapsed');
                autoeqDatabaseCollapse.setAttribute('aria-expanded', String(isExpanded));
            }
        });
    }

    // ========================================
    // Set Status Message
    // ========================================
    const setAutoEQStatus = (msg, type = '') => {
        if (!autoeqStatus) return;
        autoeqStatus.textContent = msg;
        autoeqStatus.className = 'autoeq-status' + (type ? ' ' + type : '');
    };

    // ========================================
    // Downsample curve for profile storage
    // ========================================
    const downsampleCurve = (data, maxPoints = 80) => {
        if (!data || data.length <= maxPoints) return data ? [...data] : [];
        const result = [];
        const step = data.length / maxPoints;
        for (let i = 0; i < maxPoints; i++) {
            result.push({ ...data[Math.floor(i * step)] });
        }
        return result;
    };

    // ========================================
    // Mini-Graph Renderer for Profile Cards
    // ========================================
    const drawMiniGraph = (canvas, measurementData, targetData, correctedData) => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0) {
            // Canvas not laid out yet - retry when it becomes visible
            const obs = new IntersectionObserver((entries, observer) => {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    drawMiniGraph(canvas, measurementData, targetData, correctedData);
                }
            });
            obs.observe(canvas);
            return;
        }

        canvas.width = rect.width * dpr;
        canvas.height = (rect.height || 60) * dpr;
        ctx.scale(dpr, dpr);
        const w = rect.width;
        const h = rect.height || 60;

        ctx.clearRect(0, 0, w, h);

        const drawMiniFill = (data, colors) => {
            if (!data || data.length < 2) return;
            const allGains = data.map((p) => p.gain);
            const dMin = Math.min(...allGains) - 2;
            const dMax = Math.max(...allGains) + 2;
            const dRange = dMax - dMin || 1;

            const gradient = ctx.createLinearGradient(0, 0, w, 0);
            colors.forEach((c, i) => gradient.addColorStop(i / (colors.length - 1), c));

            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let i = 0; i < data.length; i++) {
                const x = freqToX(data[i].freq, w);
                const y = h - ((data[i].gain - dMin) / dRange) * h * 0.8 - h * 0.1;
                if (i === 0) ctx.lineTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.globalAlpha = 0.4;
            ctx.fill();
            ctx.globalAlpha = 1;

            // Draw line
            ctx.beginPath();
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.5;
            for (let i = 0; i < data.length; i++) {
                const x = freqToX(data[i].freq, w);
                const y = h - ((data[i].gain - dMin) / dRange) * h * 0.8 - h * 0.1;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };

        if (measurementData) drawMiniFill(measurementData, ['#3b82f6', '#06b6d4', '#8b5cf6']);
        if (targetData) drawMiniFill(targetData, ['#f472b6', '#a855f7', '#6366f1']);
        if (correctedData) drawMiniFill(correctedData, ['#22c55e', '#06b6d4', '#3b82f6']);
    };

    const BAND_PREVIEW_COLORS = [
        '#f472b6',
        '#fb923c',
        '#facc15',
        '#4ade80',
        '#22d3ee',
        '#818cf8',
        '#c084fc',
        '#f87171',
        '#34d399',
        '#60a5fa',
    ];

    const drawBandsPreview = (canvas, bands, sampleRate) => {
        if (!canvas || !bands || bands.length === 0) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0) {
            const obs = new IntersectionObserver((entries, observer) => {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    drawBandsPreview(canvas, bands, sampleRate);
                }
            });
            obs.observe(canvas);
            return;
        }
        const sr = sampleRate || 48000;
        const ph = rect.height || 100;
        canvas.width = rect.width * dpr;
        canvas.height = ph * dpr;
        ctx.scale(dpr, dpr);
        const pw = rect.width;
        ctx.clearRect(0, 0, pw, ph);
        const mid = ph / 2;
        const dbRange = 12; // -12dB to +12dB

        // Draw each band as a filled blob
        bands.forEach((band, bi) => {
            if (!band.enabled || Math.abs(band.gain) < 0.1) return;
            const color = BAND_PREVIEW_COLORS[bi % BAND_PREVIEW_COLORS.length];
            const pts = [];
            for (let f = 20; f <= 20000; f *= 1.04) {
                const resp = calculateBiquadResponse(f, band, sr);
                pts.push({
                    x: freqToX(f, pw),
                    y: mid - (Math.max(-dbRange, Math.min(dbRange, resp)) / dbRange) * mid * 0.9,
                });
            }
            if (!pts.length) return;

            ctx.beginPath();
            ctx.moveTo(pts[0].x, mid);
            pts.forEach((p) => ctx.lineTo(p.x, p.y));
            ctx.lineTo(pts[pts.length - 1].x, mid);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, 0, pw, 0);
            grad.addColorStop(0, color + '18');
            grad.addColorStop(0.5, color + '55');
            grad.addColorStop(1, color + '18');
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.85;
            ctx.stroke();
            ctx.globalAlpha = 1;
        });

        // Combined curve on top
        ctx.beginPath();
        let first = true;
        for (let f = 20; f <= 20000; f *= 1.04) {
            let total = 0;
            for (const b of bands) {
                if (b.enabled) total += calculateBiquadResponse(f, b, sr);
            }
            const x = freqToX(f, pw);
            const y = mid - (Math.max(-dbRange, Math.min(dbRange, total)) / dbRange) * mid * 0.9;
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
    };

    // ========================================
    // Saved Profiles Rendering
    // ========================================
    const renderSavedProfiles = () => {
        if (!autoeqSavedGrid) return;
        const profiles = equalizerSettings.getAutoEQProfiles();
        const activeId = equalizerSettings.getActiveAutoEQProfile();
        const keys = Object.keys(profiles);

        if (autoeqSavedCount) autoeqSavedCount.textContent = keys.length;
        autoeqSavedGrid.innerHTML = '';

        if (keys.length === 0) return;

        keys.forEach((id) => {
            const profile = profiles[id];
            const card = document.createElement('div');
            card.className = 'autoeq-profile-card' + (id === activeId ? ' active' : '');
            card.dataset.profileId = id;

            const preview = document.createElement('canvas');
            preview.className = 'autoeq-profile-preview';
            card.appendChild(preview);

            const info = document.createElement('div');
            info.className = 'autoeq-profile-info';
            info.innerHTML = `
                <span class="autoeq-profile-active-icon">&#10003;</span>
                <span class="autoeq-profile-name">${profile.name || 'Unnamed'}</span>
                <span class="autoeq-profile-meta">${profile.bandCount || '?'} bands &middot; ${profile.targetLabel || ''}</span>
            `;
            card.appendChild(info);

            const delBtn = document.createElement('button');
            delBtn.className = 'autoeq-profile-delete';
            delBtn.innerHTML = '&#128465;';
            delBtn.title = 'Delete profile';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                equalizerSettings.deleteAutoEQProfile(id);
                renderSavedProfiles();
            });
            card.appendChild(delBtn);

            // Click to load profile
            card.addEventListener('click', () => {
                loadAutoEQProfile(id);
            });

            autoeqSavedGrid.appendChild(card);

            // Draw mini preview using filter bands
            requestAnimationFrame(() => {
                drawBandsPreview(preview, profile.bands, profile.sampleRate);
            });
        });
    };

    // ========================================
    // Profile Save/Load
    // ========================================
    const saveAutoEQProfile = (name) => {
        if (!autoeqCurrentBands || !autoeqSelectedMeasurement) return;

        const targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
        const targetEntry = TARGETS.find((t) => t.id === targetId);

        const profile = {
            id: 'autoeq_' + Date.now(),
            name: name || (autoeqSelectedEntry ? autoeqSelectedEntry.name : 'Custom'),
            headphoneName: autoeqSelectedEntry ? autoeqSelectedEntry.name : 'Custom',
            headphoneType: autoeqSelectedEntry ? autoeqSelectedEntry.type : 'over-ear',
            targetId,
            targetLabel: targetEntry ? targetEntry.label : targetId,
            bandCount:
                (autoeqBandCount && autoeqBandCount.value ? parseInt(autoeqBandCount.value, 10) : null) ||
                autoeqCurrentBands.length ||
                10,
            maxFreq: autoeqMaxFreq ? parseInt(autoeqMaxFreq.value, 10) : 16000,
            sampleRate: autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000,
            bands: autoeqCurrentBands.map((b) => ({ ...b })),
            gains: audioContextManager.getGains ? audioContextManager.getGains() : [],
            preamp: equalizerSettings.getPreamp(),
            measurementData: downsampleCurve(autoeqSelectedMeasurement),
            targetData: downsampleCurve(targetEntry?.data),
            correctedData: downsampleCurve(autoeqCorrectedCurve),
            createdAt: Date.now(),
        };

        const id = equalizerSettings.saveAutoEQProfile(profile);
        equalizerSettings.setActiveAutoEQProfile(id);
        renderSavedProfiles();
        setAutoEQStatus(`Profile "${name}" saved`, 'success');
    };

    const loadAutoEQProfile = (profileId) => {
        const profiles = equalizerSettings.getAutoEQProfiles();
        const profile = profiles[profileId];
        if (!profile) return;

        autoeqCurrentBands = profile.bands.map((b) => ({ ...b }));
        autoeqCorrectedCurve = profile.correctedData ? [...profile.correctedData] : null;
        autoeqSelectedMeasurement = profile.measurementData ? [...profile.measurementData] : null;
        autoeqSelectedEntry = { name: profile.headphoneName, type: profile.headphoneType };

        // Update headphone select dropdown
        if (autoeqHeadphoneSelect) {
            let opt = autoeqHeadphoneSelect.querySelector(`option[value="${profile.headphoneName}"]`);
            if (!opt) {
                opt = document.createElement('option');
                opt.value = profile.headphoneName;
                opt.textContent = profile.headphoneName.replace(/\s*\([^)]*\)\s*$/, '');
                autoeqHeadphoneSelect.appendChild(opt);
            }
            autoeqHeadphoneSelect.value = profile.headphoneName;
        }

        // Update UI selects
        if (autoeqTargetSelect) autoeqTargetSelect.value = profile.targetId || 'harman_oe_2018';
        setAutoeqBandCount(profile.bandCount, profile.bands);
        if (autoeqMaxFreq) autoeqMaxFreq.value = profile.maxFreq || 16000;
        if (autoeqSampleRate) autoeqSampleRate.value = profile.sampleRate || 48000;

        // Apply to audio
        applyBandsToAudio(autoeqCurrentBands);

        equalizerSettings.setActiveAutoEQProfile(profileId);
        renderSavedProfiles();
        renderBandControls(autoeqCurrentBands);
        drawAutoEQGraph();
        setAutoEQStatus(`Loaded "${profile.name}"`, 'success');
    };

    // Save button
    if (autoeqSaveBtn) {
        autoeqSaveBtn.addEventListener('click', () => {
            const name = autoeqProfileNameInput ? autoeqProfileNameInput.value.trim() : '';
            if (!name) {
                setAutoEQStatus('Enter a profile name', 'error');
                return;
            }
            saveAutoEQProfile(name);
            if (autoeqProfileNameInput) autoeqProfileNameInput.value = '';
        });
    }

    // ========================================

    // ========================================
    // Database Browser
    // ========================================
    /**
     * Load a headphone measurement entry
     */
    const loadHeadphoneEntry = async (entry) => {
        setAutoEQStatus('Loading measurement...', '');
        try {
            const data = await fetchHeadphoneData(entry);
            autoeqSelectedMeasurement = data;
            autoeqSelectedEntry = entry;

            if (autoeqHeadphoneSelect) {
                let opt = autoeqHeadphoneSelect.querySelector(`option[value="${entry.name}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = entry.name;
                    opt.textContent = entry.name;
                    autoeqHeadphoneSelect.appendChild(opt);
                }
                autoeqHeadphoneSelect.value = entry.name;
            }

            if (autoeqTargetSelect && entry.type === 'in-ear') {
                autoeqTargetSelect.value = 'harman_ie_2019';
            }

            if (autoeqRunBtn) autoeqRunBtn.disabled = false;
            drawAutoEQGraph();
            setAutoEQStatus(`Loaded ${data.length} points for ${entry.name}`, 'success');

            // Persist for reload
            equalizerSettings.setLastHeadphone(entry, data);
        } catch (err) {
            setAutoEQStatus('Failed: ' + err.message, 'error');
        }
    };

    /**
     * Render database list with expandable headphone groups
     */
    const renderDatabaseResults = (entries, append = false) => {
        if (!autoeqDatabaseList) return;
        if (!append) autoeqDatabaseList.innerHTML = '';

        if (entries.length === 0 && !append) {
            autoeqDatabaseList.innerHTML =
                '<div style="padding: 1rem; text-align: center; color: var(--muted-foreground); font-size: 0.8rem;">No results found</div>';
            return;
        }

        // Group by base model name (strip source suffix like "(crinacle)")
        const modelMap = new Map();
        entries.forEach((entry) => {
            const baseName = entry.name.replace(/\s*\([^)]*\)\s*$/, '').trim() || entry.name;
            if (!modelMap.has(baseName)) {
                modelMap.set(baseName, []);
            }
            modelMap.get(baseName).push(entry);
        });

        modelMap.forEach(async (variants, name) => {
            const wrapper = document.createElement('div');
            const rawFirstChar = name[0]?.toUpperCase() || '#';
            const firstLetter = /^[A-Z]$/.test(rawFirstChar) ? rawFirstChar : '#';
            wrapper.dataset.letter = firstLetter;

            const item = document.createElement('div');
            item.className = 'autoeq-db-item';
            item.dataset.name = name;

            item.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
                <div class="autoeq-db-item-info">
                    <span class="autoeq-db-item-name">${name}</span>
                    <span class="autoeq-db-item-meta">${variants.length} profile${variants.length > 1 ? 's' : ''}</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="autoeq-db-item-chevron"><path d="m9 18 6-6-6-6"/></svg>
            `;

            wrapper.appendChild(item);

            // Sub-list for multiple profiles
            if (variants.length > 1) {
                const subList = document.createElement('div');
                subList.className = 'autoeq-db-sub-list';

                for (const entry of variants) {
                    const subItem = document.createElement('div');
                    subItem.className = 'autoeq-db-sub-item';
                    // Extract source from parentheses
                    const sourceMatch = await entry.name.match(/\(([^)]+)\)\s*$/);
                    const source = sourceMatch ? sourceMatch[1] : entry.type;
                    subItem.innerHTML = `<span>${entry.name}</span><span class="sub-source">${source}</span>`;
                    subItem.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await loadHeadphoneEntry(entry);
                    });
                    subList.appendChild(subItem);
                }

                wrapper.appendChild(subList);

                item.addEventListener('click', () => {
                    item.classList.toggle('expanded');
                    subList.classList.toggle('visible');
                });
            } else {
                // Single profile - load directly
                item.addEventListener('click', () => loadHeadphoneEntry(variants[0]));
            }

            autoeqDatabaseList.appendChild(wrapper);
        });
    };

    /**
     * Render the A-Z alphabet index
     */
    const renderAlphaIndex = () => {
        const alphaContainer = document.getElementById('autoeq-alpha-index');
        if (!alphaContainer) return;
        alphaContainer.innerHTML = '';

        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
        letters.forEach((letter) => {
            const btn = document.createElement('button');
            btn.textContent = letter;
            btn.addEventListener('click', () => {
                // Find the index of the first entry starting with this letter
                const targetIdx = _dbFilteredEntries.findIndex((e) => {
                    const first = e.name[0].toUpperCase();
                    return letter === '#' ? !/[A-Z]/.test(first) : first === letter;
                });

                if (targetIdx < 0) return; // No entries for this letter

                // Render all entries up to and past the target so the DOM element exists
                while (_dbRenderedCount <= targetIdx + DB_BATCH_SIZE && _dbRenderedCount < _dbFilteredEntries.length) {
                    renderNextDatabaseBatch();
                }

                // Now find and scroll to the element
                requestAnimationFrame(() => {
                    const target = autoeqDatabaseList?.querySelector(`[data-letter="${letter}"]`);
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
            alphaContainer.appendChild(btn);
        });
    };

    /**
     * Load and display the full headphone database
     */
    // Lazy-loading state for database list
    let _dbFilteredEntries = [];
    let _dbRenderedCount = 0;
    const DB_BATCH_SIZE = 80;

    const renderNextDatabaseBatch = () => {
        if (_dbRenderedCount >= _dbFilteredEntries.length) return;
        const end = Math.min(_dbRenderedCount + DB_BATCH_SIZE, _dbFilteredEntries.length);
        const batch = _dbFilteredEntries.slice(_dbRenderedCount, end);
        renderDatabaseResults(batch, true); // append mode
        _dbRenderedCount = end;
    };

    const resetDatabaseList = (entries) => {
        _dbFilteredEntries = entries;
        _dbRenderedCount = 0;
        if (autoeqDatabaseList) autoeqDatabaseList.innerHTML = '';
        renderNextDatabaseBatch();
    };

    // Infinite scroll on database list
    if (autoeqDatabaseList) {
        autoeqDatabaseList.addEventListener('scroll', () => {
            const el = autoeqDatabaseList;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
                renderNextDatabaseBatch();
            }
        });
    }

    const loadFullDatabase = async () => {
        if (_autoeqIndex.length === 0) {
            setAutoEQStatus('Loading headphone database...', '');
            try {
                _autoeqIndex = await fetchAutoEqIndex();
                setAutoEQStatus(`Loaded ${_autoeqIndex.length} headphones`, 'success');
            } catch {
                setAutoEQStatus('Failed to load database', 'error');
                return;
            }
        }
        if (autoeqDatabaseCount) autoeqDatabaseCount.textContent = `${_autoeqIndex.length} models`;
        resetDatabaseList(_autoeqIndex);
        renderAlphaIndex();
    };

    // Search input with debounce
    {
        const searchEl = document.getElementById('autoeq-headphone-search');

        if (searchEl && !searchEl._autoeqBound) {
            searchEl._autoeqBound = true;
            let timer = null;

            const doSearch = async () => {
                const query = searchEl.value.trim();
                if (!query) {
                    resetDatabaseList(_autoeqIndex);
                    return;
                }

                if (_autoeqIndex.length === 0) await loadFullDatabase();

                const results = searchHeadphones(query, _autoeqIndex, 'all', 500);
                resetDatabaseList(results);
            };

            searchEl.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(doSearch, 300);
            });
        }
    }

    // ========================================
    // AutoEQ Run
    // ========================================
    if (autoeqRunBtn) {
        autoeqRunBtn.addEventListener('click', () => {
            if (!autoeqSelectedMeasurement) return;

            setAutoEQStatus('Running AutoEQ...', '');
            autoeqRunBtn.disabled = true;

            setTimeout(() => {
                try {
                    const targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
                    const targetEntry = TARGETS.find((t) => t.id === targetId);
                    if (!targetEntry || !targetEntry.data || targetEntry.data.length === 0) {
                        setAutoEQStatus('Invalid target curve', 'error');
                        autoeqRunBtn.disabled = false;
                        return;
                    }

                    const bandCount = autoeqBandCount ? parseInt(autoeqBandCount.value, 10) : 10;
                    const maxFreq = autoeqMaxFreq ? parseInt(autoeqMaxFreq.value, 10) : 16000;
                    const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;

                    const bands = runAutoEqAlgorithm(
                        autoeqSelectedMeasurement,
                        targetEntry.data,
                        bandCount,
                        maxFreq,
                        20,
                        5.0,
                        sampleRate
                    );

                    if (!bands || bands.length === 0) {
                        setAutoEQStatus('No correction needed', 'success');
                        autoeqRunBtn.disabled = false;
                        return;
                    }

                    autoeqCurrentBands = bands;
                    computeCorrectedCurve();
                    applyBandsToAudio(autoeqCurrentBands);
                    drawAutoEQGraph();
                    renderBandControls(autoeqCurrentBands);

                    const headphoneName = autoeqSelectedEntry ? autoeqSelectedEntry.name : 'Custom';
                    setAutoEQStatus(`Applied ${bands.length} bands for ${headphoneName}`, 'success');
                    autoeqRunBtn.disabled = false;
                } catch (err) {
                    console.error('[AutoEQ] Algorithm failed:', err);
                    setAutoEQStatus('Error: ' + err.message, 'error');
                    autoeqRunBtn.disabled = false;
                }
            }, 50);
        });
    }

    // ========================================
    // Import Measurement File
    // ========================================
    if (autoeqImportBtn && autoeqImportFile) {
        autoeqImportBtn.addEventListener('click', () => {
            autoeqImportFile.click();
        });

        autoeqImportFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = parseRawData(event.target.result);
                    if (data.length === 0) {
                        setAutoEQStatus('Invalid measurement file', 'error');
                        return;
                    }
                    autoeqSelectedMeasurement = data;
                    autoeqSelectedEntry = { name: file.name.replace(/\.(txt|csv)$/i, ''), type: 'over-ear' };
                    if (autoeqRunBtn) autoeqRunBtn.disabled = false;
                    drawAutoEQGraph();
                    setAutoEQStatus(`Imported ${data.length} points from ${file.name}`, 'success');
                } catch {
                    setAutoEQStatus('Failed to parse file', 'error');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // ========================================
    // Import Target Button
    // ========================================
    const autoeqImportTargetBtn = document.getElementById('autoeq-import-target-btn');
    const autoeqImportTargetFile = document.getElementById('autoeq-import-target-file');

    if (autoeqImportTargetBtn && autoeqImportTargetFile) {
        autoeqImportTargetBtn.addEventListener('click', () => autoeqImportTargetFile.click());

        autoeqImportTargetFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = parseRawData(event.target.result);
                    if (data.length === 0) {
                        setAutoEQStatus('Invalid target file', 'error');
                        return;
                    }

                    const customId = 'custom_target';
                    const customLabel = file.name.replace(/\.(txt|csv)$/i, '');

                    // Inject or update in TARGETS array
                    const existing = TARGETS.findIndex((t) => t.id === customId);
                    if (existing > -1) {
                        TARGETS[existing] = { id: customId, label: customLabel, data };
                    } else {
                        TARGETS.push({ id: customId, label: customLabel, data });
                    }

                    // Add/update option in select
                    if (autoeqTargetSelect) {
                        let opt = autoeqTargetSelect.querySelector('option[value="custom_target"]');
                        if (!opt) {
                            opt = document.createElement('option');
                            opt.value = customId;
                            autoeqTargetSelect.appendChild(opt);
                        }
                        opt.textContent = customLabel;
                        autoeqTargetSelect.value = customId;
                    }

                    computeCorrectedCurve();
                    drawAutoEQGraph();
                    setAutoEQStatus(`Target "${customLabel}" imported`, 'success');
                } catch {
                    setAutoEQStatus('Failed to parse target file', 'error');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // ========================================
    // Download/Export Button
    // ========================================
    if (autoeqDownloadBtn) {
        autoeqDownloadBtn.addEventListener('click', () => {
            if (!autoeqCurrentBands || autoeqCurrentBands.length === 0) {
                setAutoEQStatus('No EQ to export', 'error');
                return;
            }
            // Build EqualizerAPO / Peace format
            let lines = [`Preamp: ${currentPreamp} dB`];
            autoeqCurrentBands.forEach((band, i) => {
                if (!band.enabled) return;
                const type = band.type === 'peaking' ? 'PK' : band.type === 'lowshelf' ? 'LSC' : 'HSC';
                lines.push(
                    `Filter ${i + 1}: ON ${type} Fc ${Math.round(band.freq)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q.toFixed(2)}`
                );
            });
            const exportText = lines.join('\n');
            const blob = new Blob([exportText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `autoeq-${autoeqSelectedEntry?.name || 'custom'}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            setAutoEQStatus('Exported', 'success');
        });
    }

    // ========================================
    // Auto Preamp Compensation Toggle
    // ========================================
    if (autoPreampToggle) {
        autoPreampToggle.addEventListener('change', () => {
            autoPreampEnabled = autoPreampToggle.checked;
            if (autoPreampEnabled) {
                // Recalculate and apply auto preamp immediately
                const bands = getActiveBands();
                if (bands && bands.length > 0) {
                    const maxGain = Math.max(0, ...bands.filter((b) => b.enabled).map((b) => b.gain));
                    const autoPreamp = maxGain > 0 ? -Math.round(maxGain * 10) / 10 : 0;
                    currentPreamp = autoPreamp;
                    equalizerSettings.setPreamp(autoPreamp);
                    if (audioContextManager.setPreamp) audioContextManager.setPreamp(autoPreamp);
                    if (eqPreampSlider) eqPreampSlider.value = autoPreamp;
                    if (autoeqPreampValue) autoeqPreampValue.textContent = `${autoPreamp} dB`;
                }
            } else {
                // Reset preamp to 0 dB
                currentPreamp = 0;
                equalizerSettings.setPreamp(0);
                if (audioContextManager.setPreamp) audioContextManager.setPreamp(0);
                if (eqPreampSlider) eqPreampSlider.value = 0;
                if (autoeqPreampValue) autoeqPreampValue.textContent = '0 dB';
            }
        });
    }

    // ========================================
    // Preamp Slider
    // ========================================
    if (eqPreampSlider) {
        eqPreampSlider.value = currentPreamp;
        if (autoeqPreampValue) autoeqPreampValue.textContent = `${currentPreamp} dB`;

        eqPreampSlider.addEventListener('input', () => {
            // Manual preamp adjustment disables auto compensation
            if (autoPreampEnabled) {
                autoPreampEnabled = false;
                if (autoPreampToggle) autoPreampToggle.checked = false;
            }
            const val = parseFloat(eqPreampSlider.value);
            currentPreamp = val;
            equalizerSettings.setPreamp(val);
            if (autoeqPreampValue) autoeqPreampValue.textContent = `${val} dB`;
            if (audioContextManager.setPreamp) audioContextManager.setPreamp(val);
        });
    }

    // ========================================
    // Speaker EQ State
    // ========================================
    const SPEAKER_CONFIGS = {
        '2.0': ['FL', 'FR'],
        5.1: ['FL', 'FR', 'C', 'LFE', 'SL', 'SR'],
        7.1: ['FL', 'FR', 'C', 'LFE', 'SL', 'SR', 'SBL', 'SBR'],
    };
    const SPEAKER_CHANNEL_LABELS = {
        FL: 'Front L',
        FR: 'Front R',
        C: 'Center',
        LFE: 'Sub',
        SL: 'Surr L',
        SR: 'Surr R',
        SBL: 'Back L',
        SBR: 'Back R',
    };
    let speakerConfig = '2.0';
    let speakerActiveChannel = 'FL';
    const speakerChannels = {};
    // Initialize all channels
    Object.keys(SPEAKER_CHANNEL_LABELS).forEach((id) => {
        speakerChannels[id] = {
            measurement: null,
            targetId: 'harman_room',
            bands: Array.from({ length: 10 }, (_, i) => ({
                id: i,
                type: 'peaking',
                freq: Math.round(100 * Math.pow(2, i)),
                gain: 0,
                q: 1.41,
                enabled: true,
                channel: 'stereo',
            })),
            preamp: 0,
        };
    });

    // ========================================
    // Mode Toggle: AutoEQ vs Parametric EQ vs Speaker EQ
    // ========================================
    const modeButtons = document.querySelectorAll('.autoeq-mode-btn');
    const EQ_MODE_KEY = 'eq-active-mode';
    let currentMode = 'autoeq';

    const speakerSection = document.getElementById('speaker-eq-section');

    const setEQMode = (mode) => {
        currentMode = mode;
        localStorage.setItem(EQ_MODE_KEY, mode);
        modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));

        const graphSection = document.querySelector('.autoeq-graph-section');
        const controlsSection = document.querySelector('.autoeq-controls-section');
        const savedSection = document.getElementById('autoeq-saved-section');
        const databaseSection = document.getElementById('autoeq-database-section');
        const filtersSection = document.getElementById('autoeq-filters-section');
        const filtersContent = document.getElementById('autoeq-filters-content');
        const presetRow = document.getElementById('autoeq-preset-row');
        const parametricProfiles = document.getElementById('autoeq-parametric-profiles');
        const speakerSavedSection = document.getElementById('speaker-saved-section');
        const legacySection = document.getElementById('graphic-eq-section');

        // Reset interactive state on switch
        draggedNode = null;
        hoveredNode = null;

        // Graph visible in all modes except legacy
        if (graphSection) graphSection.style.display = mode === 'legacy' ? 'none' : '';
        // Legend only relevant in modes with Original/Target/Corrected curves
        const graphLegend = document.querySelector('.autoeq-graph-legend');
        if (graphLegend) graphLegend.style.display = mode === 'autoeq' || mode === 'speaker' ? '' : 'none';
        // Only show shared AutoEq button in AutoEQ mode
        if (autoeqRunBtn) autoeqRunBtn.style.display = mode === 'autoeq' ? '' : 'none';

        // Hide all mode-specific sections first
        if (controlsSection) controlsSection.style.display = 'none';
        if (savedSection) savedSection.style.display = 'none';
        if (databaseSection) databaseSection.style.display = 'none';
        if (filtersSection) filtersSection.style.display = 'none';
        if (presetRow) presetRow.style.display = 'none';
        if (parametricProfiles) parametricProfiles.style.display = 'none';
        if (speakerSection) speakerSection.style.display = 'none';
        if (speakerSavedSection) speakerSavedSection.style.display = 'none';
        if (legacySection) legacySection.style.display = 'none';

        if (mode === 'legacy') {
            if (legacySection) legacySection.style.display = '';
            // Disable parametric EQ entirely - only graphic EQ active to save resources
            audioContextManager.isEQEnabled = false;
            audioContextManager.toggleGraphicEQ(equalizerSettings.isEnabled());
            equalizerSettings.setGraphicEqEnabled(true);
        } else {
            // Disable graphic EQ entirely - only parametric EQ active to save resources
            audioContextManager.isEQEnabled = equalizerSettings.isEnabled();
            audioContextManager.toggleGraphicEQ(false);
            equalizerSettings.setGraphicEqEnabled(false);
        }

        if (mode === 'autoeq') {
            if (controlsSection) controlsSection.style.display = '';
            if (savedSection) savedSection.style.display = '';
            if (databaseSection) databaseSection.style.display = '';
            if (filtersSection) filtersSection.style.display = '';

            if (autoeqCurrentBands && autoeqCurrentBands.length > 0) {
                applyBandsToAudio(autoeqCurrentBands);
                renderBandControls(autoeqCurrentBands);
            }
            computeCorrectedCurve();
            drawAutoEQGraph();
        } else if (mode === 'parametric') {
            if (filtersSection) filtersSection.style.display = '';
            if (filtersContent) filtersContent.style.display = 'flex';
            if (autoeqFiltersCollapse) autoeqFiltersCollapse.classList.remove('collapsed');
            if (presetRow) presetRow.style.display = '';
            if (parametricProfiles) parametricProfiles.style.display = '';

            if (!parametricBands || parametricBands.length === 0) {
                const defaultBands = [];
                for (let i = 0; i < 10; i++) {
                    const freq = 20 * Math.pow(20000 / 20, i / 9);
                    defaultBands.push({
                        id: i,
                        type: 'peaking',
                        freq: Math.round(freq),
                        gain: 0,
                        q: 1.0,
                        enabled: true,
                    });
                }
                parametricBands = defaultBands;
            }
            applyBandsToAudio(parametricBands);
            renderBandControls(parametricBands);
            renderParametricProfiles();
            computeCorrectedCurve();
            drawAutoEQGraph();
        } else if (mode === 'speaker') {
            if (speakerSection) speakerSection.style.display = '';
            if (speakerSavedSection) speakerSavedSection.style.display = '';
            if (filtersSection) filtersSection.style.display = '';
            if (filtersContent) filtersContent.style.display = 'flex';
            if (autoeqFiltersCollapse) autoeqFiltersCollapse.classList.remove('collapsed');

            // Apply active speaker channel bands
            const ch = speakerChannels[speakerActiveChannel];
            if (ch && ch.bands.length > 0) {
                applyBandsToAudio(ch.bands);
                renderBandControls(ch.bands);
            }
            renderSpeakerChannelTabs();
            renderSpeakerProfiles();
            computeCorrectedCurve();
            drawAutoEQGraph();
        }

        // Update tutorial tab if visible
        const hp = document.getElementById('eq-howto-panel');
        if (hp && hp.style.display !== 'none') {
            const tabs = {
                legacy: document.getElementById('eq-howto-legacy'),
                autoeq: document.getElementById('eq-howto-autoeq'),
                parametric: document.getElementById('eq-howto-parametric'),
                speaker: document.getElementById('eq-howto-speaker'),
            };
            Object.values(tabs).forEach((t) => {
                if (t) t.style.display = 'none';
            });
            if (tabs[mode]) tabs[mode].style.display = '';
        }
    };

    modeButtons.forEach((btn) => {
        btn.addEventListener('click', () => setEQMode(btn.dataset.mode));
    });

    // ========================================
    // How-To Tutorial Panel
    // ========================================
    const howtoBtn = document.getElementById('eq-howto-btn');
    const howtoPanel = document.getElementById('eq-howto-panel');
    const howtoClose = document.getElementById('eq-howto-close');
    const howtoTabs = {
        legacy: document.getElementById('eq-howto-legacy'),
        autoeq: document.getElementById('eq-howto-autoeq'),
        parametric: document.getElementById('eq-howto-parametric'),
        speaker: document.getElementById('eq-howto-speaker'),
    };

    const updateHowtoTab = () => {
        Object.values(howtoTabs).forEach((t) => {
            if (t) t.style.display = 'none';
        });
        const active = howtoTabs[currentMode];
        if (active) active.style.display = '';
    };

    if (howtoBtn && howtoPanel) {
        howtoBtn.addEventListener('click', () => {
            const visible = howtoPanel.style.display !== 'none';
            howtoPanel.style.display = visible ? 'none' : '';
            if (!visible) updateHowtoTab();
        });
    }
    if (howtoClose && howtoPanel) {
        howtoClose.addEventListener('click', () => {
            howtoPanel.style.display = 'none';
        });
    }

    // ========================================
    // Redraw graph when target/settings change
    // ========================================
    if (autoeqTargetSelect) {
        autoeqTargetSelect.addEventListener('change', () => {
            if (autoeqCurrentBands && autoeqSelectedMeasurement) {
                computeCorrectedCurve();
            }
            drawAutoEQGraph();
        });
    }

    if (autoeqBandCount) {
        autoeqBandCount.addEventListener('change', () => drawAutoEQGraph());
    }
    if (autoeqMaxFreq) {
        autoeqMaxFreq.addEventListener('change', () => drawAutoEQGraph());
    }
    if (autoeqSampleRate) {
        autoeqSampleRate.addEventListener('change', () => {
            if (autoeqCurrentBands && autoeqSelectedMeasurement) {
                computeCorrectedCurve();
            }
            drawAutoEQGraph();
        });
    }

    // ========================================
    // Parametric EQ Preset Selector
    // ========================================

    // Mid/Side presets define complete band arrays with per-band channel modes
    const MS_PRESETS = {
        shelf_warm: {
            name: 'Warm',
            bands: [
                { id: 0, type: 'lowshelf', freq: 200, gain: 3.0, q: 0.7, enabled: true, channel: 'stereo' },
                { id: 1, type: 'highshelf', freq: 6000, gain: -2.0, q: 0.6, enabled: true, channel: 'stereo' },
                { id: 2, type: 'peaking', freq: 3000, gain: -1.0, q: 1.2, enabled: true, channel: 'stereo' },
                { id: 3, type: 'peaking', freq: 800, gain: 0.5, q: 0.8, enabled: true, channel: 'stereo' },
            ],
        },
        shelf_bright: {
            name: 'Bright & Airy',
            bands: [
                { id: 0, type: 'highshelf', freq: 8000, gain: 3.0, q: 0.5, enabled: true, channel: 'stereo' },
                { id: 1, type: 'lowshelf', freq: 150, gain: -1.5, q: 0.6, enabled: true, channel: 'stereo' },
                { id: 2, type: 'peaking', freq: 5000, gain: 1.0, q: 1.5, enabled: true, channel: 'stereo' },
                { id: 3, type: 'peaking', freq: 2500, gain: 0.5, q: 1.0, enabled: true, channel: 'stereo' },
            ],
        },
        shelf_hifi: {
            name: 'Hi-Fi',
            bands: [
                { id: 0, type: 'lowshelf', freq: 80, gain: 2.5, q: 0.7, enabled: true, channel: 'stereo' },
                { id: 1, type: 'highshelf', freq: 10000, gain: 2.0, q: 0.5, enabled: true, channel: 'stereo' },
                { id: 2, type: 'peaking', freq: 400, gain: -1.0, q: 1.0, enabled: true, channel: 'stereo' },
                { id: 3, type: 'peaking', freq: 3000, gain: 0.5, q: 1.5, enabled: true, channel: 'stereo' },
            ],
        },
        shelf_dark: {
            name: 'Dark & Smooth',
            bands: [
                { id: 0, type: 'highshelf', freq: 5000, gain: -3.0, q: 0.5, enabled: true, channel: 'stereo' },
                { id: 1, type: 'lowshelf', freq: 150, gain: 2.0, q: 0.7, enabled: true, channel: 'stereo' },
                { id: 2, type: 'peaking', freq: 2500, gain: -1.5, q: 1.2, enabled: true, channel: 'stereo' },
                { id: 3, type: 'peaking', freq: 600, gain: 0.5, q: 0.8, enabled: true, channel: 'stereo' },
            ],
        },
        shelf_radio: {
            name: 'Radio Ready',
            bands: [
                { id: 0, type: 'lowshelf', freq: 100, gain: 2.0, q: 0.7, enabled: true, channel: 'stereo' },
                { id: 1, type: 'peaking', freq: 3000, gain: 2.0, q: 1.8, enabled: true, channel: 'stereo' },
                { id: 2, type: 'highshelf', freq: 10000, gain: 1.5, q: 0.5, enabled: true, channel: 'stereo' },
                { id: 3, type: 'peaking', freq: 500, gain: -1.5, q: 1.0, enabled: true, channel: 'stereo' },
                { id: 4, type: 'peaking', freq: 7000, gain: -0.5, q: 2.0, enabled: true, channel: 'stereo' },
            ],
        },
        ms_vocal_clarity: {
            name: 'M/S Vocal Clarity',
            bands: [
                { id: 0, type: 'lowshelf', freq: 100, gain: -3.5, q: 0.6, enabled: true, channel: 'side' },
                { id: 1, type: 'peaking', freq: 3500, gain: 2.0, q: 2.0, enabled: true, channel: 'mid' },
                { id: 2, type: 'peaking', freq: 350, gain: -1.5, q: 1.2, enabled: true, channel: 'mid' },
                { id: 3, type: 'peaking', freq: 3000, gain: -1.5, q: 1.5, enabled: true, channel: 'side' },
                { id: 4, type: 'highshelf', freq: 12000, gain: 1.5, q: 0.5, enabled: true, channel: 'side' },
                { id: 5, type: 'peaking', freq: 5000, gain: 1.0, q: 2.0, enabled: true, channel: 'mid' },
            ],
        },
        ms_wide_stereo: {
            name: 'M/S Wide Stereo',
            bands: [
                { id: 0, type: 'lowshelf', freq: 100, gain: -4.0, q: 0.6, enabled: true, channel: 'side' },
                { id: 1, type: 'peaking', freq: 1200, gain: 1.5, q: 1.0, enabled: true, channel: 'side' },
                { id: 2, type: 'highshelf', freq: 10000, gain: 2.0, q: 0.5, enabled: true, channel: 'side' },
                { id: 3, type: 'peaking', freq: 5000, gain: 1.0, q: 1.2, enabled: true, channel: 'side' },
                { id: 4, type: 'peaking', freq: 800, gain: -1.0, q: 1.0, enabled: true, channel: 'mid' },
                { id: 5, type: 'lowshelf', freq: 60, gain: 1.0, q: 0.7, enabled: true, channel: 'mid' },
            ],
        },
        ms_mono_bass: {
            name: 'M/S Mono Bass',
            bands: [
                { id: 0, type: 'lowshelf', freq: 120, gain: -5.0, q: 0.5, enabled: true, channel: 'side' },
                { id: 1, type: 'peaking', freq: 60, gain: 2.5, q: 0.7, enabled: true, channel: 'mid' },
                { id: 2, type: 'peaking', freq: 120, gain: 1.0, q: 1.2, enabled: true, channel: 'mid' },
                { id: 3, type: 'peaking', freq: 400, gain: 1.0, q: 0.8, enabled: true, channel: 'side' },
                { id: 4, type: 'highshelf', freq: 10000, gain: 1.0, q: 0.7, enabled: true, channel: 'stereo' },
            ],
        },
        ms_master_polish: {
            name: 'M/S Master Polish',
            bands: [
                { id: 0, type: 'lowshelf', freq: 100, gain: -3.5, q: 0.5, enabled: true, channel: 'side' },
                { id: 1, type: 'peaking', freq: 60, gain: 1.5, q: 0.7, enabled: true, channel: 'mid' },
                { id: 2, type: 'peaking', freq: 350, gain: -1.0, q: 1.2, enabled: true, channel: 'mid' },
                { id: 3, type: 'peaking', freq: 3000, gain: 1.5, q: 2.0, enabled: true, channel: 'mid' },
                { id: 4, type: 'peaking', freq: 3000, gain: -1.0, q: 1.5, enabled: true, channel: 'side' },
                { id: 5, type: 'highshelf', freq: 12000, gain: 2.0, q: 0.5, enabled: true, channel: 'side' },
                { id: 6, type: 'peaking', freq: 7000, gain: -0.5, q: 2.0, enabled: true, channel: 'stereo' },
                { id: 7, type: 'peaking', freq: 500, gain: -0.5, q: 0.8, enabled: true, channel: 'mid' },
            ],
        },
        ms_rock_master: {
            name: 'M/S Rock Master',
            bands: [
                { id: 0, type: 'lowshelf', freq: 100, gain: -4.0, q: 0.5, enabled: true, channel: 'side' },
                { id: 1, type: 'peaking', freq: 3500, gain: -2.5, q: 2.0, enabled: true, channel: 'side' },
                { id: 2, type: 'peaking', freq: 2500, gain: 1.5, q: 1.8, enabled: true, channel: 'mid' },
                { id: 3, type: 'peaking', freq: 60, gain: 1.5, q: 0.7, enabled: true, channel: 'mid' },
                { id: 4, type: 'highshelf', freq: 10000, gain: 1.5, q: 0.5, enabled: true, channel: 'side' },
                { id: 5, type: 'peaking', freq: 400, gain: -1.0, q: 1.0, enabled: true, channel: 'mid' },
                { id: 6, type: 'peaking', freq: 800, gain: 1.0, q: 1.0, enabled: true, channel: 'side' },
            ],
        },
        ms_hiphop: {
            name: 'M/S Hip-Hop',
            bands: [
                { id: 0, type: 'lowshelf', freq: 60, gain: 2.5, q: 0.5, enabled: true, channel: 'mid' },
                { id: 1, type: 'lowshelf', freq: 100, gain: -4.5, q: 0.5, enabled: true, channel: 'side' },
                { id: 2, type: 'peaking', freq: 3500, gain: 1.5, q: 2.0, enabled: true, channel: 'mid' },
                { id: 3, type: 'peaking', freq: 7000, gain: 1.5, q: 1.0, enabled: true, channel: 'side' },
                { id: 4, type: 'highshelf', freq: 12000, gain: 1.5, q: 0.5, enabled: true, channel: 'side' },
                { id: 5, type: 'peaking', freq: 300, gain: -1.0, q: 1.0, enabled: true, channel: 'mid' },
                { id: 6, type: 'peaking', freq: 500, gain: -0.5, q: 0.8, enabled: true, channel: 'mid' },
            ],
        },
    };

    const parametricPresetSelect = document.getElementById('parametric-preset-select');
    if (parametricPresetSelect) {
        parametricPresetSelect.addEventListener('change', () => {
            const presetKey = parametricPresetSelect.value;
            if (!presetKey) return; // "Custom" selected

            // Check for M/S preset first (replaces entire band array)
            const msPreset = MS_PRESETS[presetKey];
            if (msPreset) {
                parametricBands = msPreset.bands.map((b) => ({ ...b }));
                setActiveBands(parametricBands);
                applyBandsToAudio(parametricBands);
                renderBandControls(parametricBands);
                computeCorrectedCurve();
                drawAutoEQGraph();
                return;
            }

            // Standard gain-only preset
            ensureParametricBands();
            const bandCount = parametricBands.length;
            const presets = getPresetsForBandCount(bandCount);
            const preset = presets[presetKey];
            if (!preset) return;

            parametricBands.forEach((band, i) => {
                band.gain = preset.gains[i] || 0;
                band.channel = 'stereo';
                band.type = 'peaking';
            });

            applyBandsToAudio(parametricBands);
            renderBandControls(parametricBands);
            computeCorrectedCurve();
            drawAutoEQGraph();
        });
    }

    // ========================================
    // Parametric EQ Profile Save/Load/Render
    // ========================================
    const PARAMETRIC_PROFILES_KEY = 'parametric-eq-profiles';
    const PARAMETRIC_ACTIVE_KEY = 'parametric-eq-active-profile';

    const getParametricProfiles = () => {
        try {
            return JSON.parse(localStorage.getItem(PARAMETRIC_PROFILES_KEY)) || {};
        } catch {
            return {};
        }
    };

    const renderParametricProfiles = () => {
        const grid = document.getElementById('parametric-saved-grid');
        const countEl = document.getElementById('parametric-saved-count');
        if (!grid) return;

        const profiles = getParametricProfiles();
        const activeId = localStorage.getItem(PARAMETRIC_ACTIVE_KEY);
        const keys = Object.keys(profiles);
        if (countEl) countEl.textContent = keys.length;
        grid.innerHTML = '';

        keys.forEach((id) => {
            const profile = profiles[id];
            const card = document.createElement('div');
            card.className = 'autoeq-profile-card' + (id === activeId ? ' active' : '');
            card.dataset.profileId = id;

            const preview = document.createElement('canvas');
            preview.className = 'autoeq-profile-preview';
            preview.style.height = '80px';
            card.appendChild(preview);

            const info = document.createElement('div');
            info.className = 'autoeq-profile-info';
            info.innerHTML = `
                <span class="autoeq-profile-active-icon">&#10003;</span>
                <span class="autoeq-profile-name">${profile.name || 'Unnamed'}</span>
                <span class="autoeq-profile-meta">${profile.bandCount || '?'} bands</span>
            `;
            card.appendChild(info);

            const delBtn = document.createElement('button');
            delBtn.className = 'autoeq-profile-delete';
            delBtn.innerHTML = '&#128465;';
            delBtn.title = 'Delete profile';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const all = getParametricProfiles();
                delete all[id];
                localStorage.setItem(PARAMETRIC_PROFILES_KEY, JSON.stringify(all));
                if (localStorage.getItem(PARAMETRIC_ACTIVE_KEY) === id) localStorage.removeItem(PARAMETRIC_ACTIVE_KEY);
                renderParametricProfiles();
            });
            card.appendChild(delBtn);

            card.addEventListener('click', () => {
                parametricBands = profile.bands.map((b) => ({ ...b }));
                applyBandsToAudio(parametricBands);
                renderBandControls(parametricBands);
                computeCorrectedCurve();
                drawAutoEQGraph();
                localStorage.setItem(PARAMETRIC_ACTIVE_KEY, id);
                if (parametricPresetSelect) parametricPresetSelect.value = '';
                renderParametricProfiles();
            });

            grid.appendChild(card);

            // Draw mini graph
            requestAnimationFrame(() => {
                drawBandsPreview(preview, profile.bands);
            });
        });
    };

    // Save parametric profile
    const parametricSaveBtn = document.getElementById('parametric-save-btn');
    const parametricProfileName = document.getElementById('parametric-profile-name');
    if (parametricSaveBtn) {
        parametricSaveBtn.addEventListener('click', () => {
            if (!parametricBands || parametricBands.length === 0) return;
            const name = parametricProfileName ? parametricProfileName.value.trim() : '';
            if (!name) return;

            const profiles = getParametricProfiles();
            const id = 'peq_' + Date.now();
            profiles[id] = {
                name,
                bands: parametricBands.map((b) => ({ ...b })),
                bandCount: parametricBands.length,
                preamp: equalizerSettings.getPreamp(),
                createdAt: Date.now(),
            };
            localStorage.setItem(PARAMETRIC_PROFILES_KEY, JSON.stringify(profiles));
            localStorage.setItem(PARAMETRIC_ACTIVE_KEY, id);
            if (parametricProfileName) parametricProfileName.value = '';
            renderParametricProfiles();
        });
    }

    // ========================================
    // Parametric EQ Import/Export
    // ========================================
    const parametricExportBtn = document.getElementById('parametric-export-btn');
    const parametricImportBtn = document.getElementById('parametric-import-btn');
    const parametricImportFile = document.getElementById('parametric-import-file');

    if (parametricExportBtn) {
        parametricExportBtn.addEventListener('click', () => {
            if (!parametricBands || parametricBands.length === 0) return;
            const preamp = equalizerSettings.getPreamp();
            const lines = [`Preamp: ${preamp.toFixed(1)} dB`];
            parametricBands.forEach((band, i) => {
                const ft = band.type === 'lowshelf' ? 'LS' : band.type === 'highshelf' ? 'HS' : 'PK';
                lines.push(
                    `Filter ${i + 1}: ON ${ft} Fc ${Math.round(band.freq)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q.toFixed(2)}`
                );
            });
            const text = lines.join('\n');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'parametric-eq.txt';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    if (parametricImportBtn && parametricImportFile) {
        parametricImportBtn.addEventListener('click', () => parametricImportFile.click());
        parametricImportFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const text = event.target.result;
                    const bands = [];
                    let preamp = 0;
                    const lines = text.split('\n');
                    for (const line of lines) {
                        const preampMatch = line.match(/Preamp:\s*([-\d.]+)\s*dB/i);
                        if (preampMatch) {
                            preamp = parseFloat(preampMatch[1]);
                            continue;
                        }
                        const filterMatch = line.match(
                            /Filter\s+\d+:\s*ON\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+([-\d.]+)\s*dB\s+Q\s+([\d.]+)/i
                        );
                        if (filterMatch) {
                            const typeMap = {
                                PK: 'peaking',
                                LS: 'lowshelf',
                                LSC: 'lowshelf',
                                LSF: 'lowshelf',
                                HS: 'highshelf',
                                HSC: 'highshelf',
                                HSF: 'highshelf',
                            };
                            bands.push({
                                id: bands.length,
                                type: typeMap[filterMatch[1].toUpperCase()] || 'peaking',
                                freq: parseFloat(filterMatch[2]),
                                gain: parseFloat(filterMatch[3]),
                                q: parseFloat(filterMatch[4]),
                                enabled: true,
                            });
                        }
                    }
                    if (bands.length === 0) return;
                    parametricBands = bands;
                    applyBandsToAudio(parametricBands);
                    equalizerSettings.setPreamp(preamp);
                    if (eqPreampSlider) eqPreampSlider.value = preamp;
                    if (autoeqPreampValue) autoeqPreampValue.textContent = `${preamp} dB`;
                    renderBandControls(parametricBands);
                    computeCorrectedCurve();
                    drawAutoEQGraph();
                    if (parametricPresetSelect) parametricPresetSelect.value = '';
                } catch (err) {
                    console.error('[PEQ Import] Failed:', err);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // ========================================
    // Speaker EQ Logic
    // ========================================
    const speakerConfigSelect = document.getElementById('speaker-config-select');
    const speakerChannelTabsEl = document.getElementById('speaker-channel-tabs');
    const speakerMeasStatus = document.getElementById('speaker-measurement-status');
    const speakerImportMeasBtn = document.getElementById('speaker-import-measurement-btn');
    const speakerImportMeasFile = document.getElementById('speaker-import-measurement-file');
    const speakerClearMeasBtn = document.getElementById('speaker-clear-measurement-btn');
    const speakerTargetSelect = document.getElementById('speaker-target-select');
    const speakerImportTargetBtn = document.getElementById('speaker-import-target-btn');
    const speakerImportTargetFile = document.getElementById('speaker-import-target-file');
    const speakerBandCountSelect = document.getElementById('speaker-band-count');
    const speakerBassCutoff = document.getElementById('speaker-bass-cutoff');
    const speakerBassCutoffValue = document.getElementById('speaker-bass-cutoff-value');
    const speakerRoomLimit = document.getElementById('speaker-room-limit');
    const speakerRoomLimitValue = document.getElementById('speaker-room-limit-value');
    const speakerAutoEqBtn = document.getElementById('speaker-autoeq-btn');
    const speakerEqStatus = document.getElementById('speaker-eq-status');
    const speakerExportBtn = document.getElementById('speaker-export-btn');

    const getSpeakerChannel = () => speakerChannels[speakerActiveChannel];

    const renderSpeakerChannelTabs = () => {
        if (!speakerChannelTabsEl) return;
        const ids = SPEAKER_CONFIGS[speakerConfig];
        speakerChannelTabsEl.innerHTML = '';
        ids.forEach((id) => {
            const btn = document.createElement('button');
            btn.className = 'speaker-channel-tab' + (id === speakerActiveChannel ? ' active' : '');
            btn.textContent = id;
            btn.title = SPEAKER_CHANNEL_LABELS[id];
            if (speakerChannels[id].measurement) btn.classList.add('has-data');
            btn.addEventListener('click', () => {
                speakerActiveChannel = id;
                renderSpeakerChannelTabs();
                updateSpeakerUI();
                // Apply this channel's bands to audio + graph
                const ch = getSpeakerChannel();
                applyBandsToAudio(ch.bands);
                renderBandControls(ch.bands);
                drawAutoEQGraph();
            });
            speakerChannelTabsEl.appendChild(btn);
        });
    };

    const updateSpeakerUI = () => {
        const ch = getSpeakerChannel();
        // Measurement status
        if (speakerMeasStatus) {
            speakerMeasStatus.textContent = ch.measurement ? `${ch.measurement.length} pts` : 'No measurement';
            speakerMeasStatus.classList.toggle('loaded', !!ch.measurement);
        }
        if (speakerClearMeasBtn) speakerClearMeasBtn.style.display = ch.measurement ? '' : 'none';
        if (speakerAutoEqBtn) speakerAutoEqBtn.disabled = !ch.measurement;
        // Target
        if (speakerTargetSelect) speakerTargetSelect.value = ch.targetId;
        // Preamp
    };

    // Config change
    if (speakerConfigSelect) {
        speakerConfigSelect.addEventListener('change', () => {
            speakerConfig = speakerConfigSelect.value;
            const ids = SPEAKER_CONFIGS[speakerConfig];
            if (!ids.includes(speakerActiveChannel)) speakerActiveChannel = ids[0];
            renderSpeakerChannelTabs();
            updateSpeakerUI();
        });
    }

    // Import measurement
    if (speakerImportMeasBtn && speakerImportMeasFile) {
        speakerImportMeasBtn.addEventListener('click', () => speakerImportMeasFile.click());
        speakerImportMeasFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const data = parseRawData(ev.target.result);
                if (data.length > 0) {
                    getSpeakerChannel().measurement = data;
                    updateSpeakerUI();
                    renderSpeakerChannelTabs();
                    drawAutoEQGraph();
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // Clear measurement
    if (speakerClearMeasBtn) {
        speakerClearMeasBtn.addEventListener('click', () => {
            getSpeakerChannel().measurement = null;
            updateSpeakerUI();
            renderSpeakerChannelTabs();
            drawAutoEQGraph();
        });
    }

    // Pink noise room measurement
    const speakerMeasureBtn = document.getElementById('speaker-measure-btn');
    if (speakerMeasureBtn) {
        speakerMeasureBtn.addEventListener('click', async () => {
            speakerMeasureBtn.disabled = true;
            if (speakerMeasStatus) {
                speakerMeasStatus.textContent = 'Requesting mic...';
                speakerMeasStatus.classList.remove('loaded');
            }

            let measCtx, stream;
            try {
                // 1. Get mic with processing disabled
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                });

                measCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
                const sr = measCtx.sampleRate;
                const duration = 5;

                // 2. Generate pink noise buffer (Voss algorithm approximation)
                const bufLen = sr * duration;
                const buffer = measCtx.createBuffer(1, bufLen, sr);
                const data = buffer.getChannelData(0);
                // Paul Kellet's refined pink noise filter coefficients
                let b0 = 0,
                    b1 = 0,
                    b2 = 0,
                    b3 = 0,
                    b4 = 0,
                    b5 = 0,
                    b6 = 0;
                for (let i = 0; i < bufLen; i++) {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.969 * b2 + white * 0.153852;
                    b3 = 0.8665 * b3 + white * 0.3104856;
                    b4 = 0.55 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.016898;
                    let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                    b6 = white * 0.115926;
                    // Fade in/out envelope (100ms)
                    let env = 1;
                    const t = i / sr;
                    if (t < 0.1) env = t / 0.1;
                    else if (t > duration - 0.1) env = (duration - t) / 0.1;
                    data[i] = pink * 0.04 * env; // low amplitude
                }

                // 3. Play pink noise
                const noiseSource = measCtx.createBufferSource();
                noiseSource.buffer = buffer;
                noiseSource.connect(measCtx.destination);

                // 4. Setup mic analyser
                const micSource = measCtx.createMediaStreamSource(stream);
                const analyser = measCtx.createAnalyser();
                analyser.fftSize = 8192;
                analyser.smoothingTimeConstant = 0.3;
                micSource.connect(analyser);

                const freqBinCount = analyser.frequencyBinCount;
                const binHz = sr / analyser.fftSize;
                const fftData = new Float32Array(freqBinCount);
                const accumulator = new Float64Array(freqBinCount);
                let frameCount = 0;

                // 5. Start playback + capture loop
                noiseSource.start();
                const startTime = measCtx.currentTime;

                await new Promise((resolve) => {
                    const tick = () => {
                        const elapsed = measCtx.currentTime - startTime;
                        if (elapsed >= duration) {
                            resolve();
                            return;
                        }

                        // Update progress
                        const pct = Math.round((elapsed / duration) * 100);
                        if (speakerMeasStatus) speakerMeasStatus.textContent = `Measuring... ${pct}%`;

                        // Skip first 0.3s (let noise settle)
                        if (elapsed > 0.3) {
                            analyser.getFloatFrequencyData(fftData);
                            for (let j = 0; j < freqBinCount; j++) {
                                const val = fftData[j];
                                if (val !== -Infinity) accumulator[j] += val;
                            }
                            frameCount++;
                        }
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                });

                noiseSource.stop();

                // 6. Post-process: average bins → log-spaced points
                if (frameCount === 0) throw new Error('No frames captured');
                for (let j = 0; j < freqBinCount; j++) accumulator[j] /= frameCount;

                const points = [];
                const ptsPerOctave = 24;
                let freq = 20;
                while (freq <= 20000) {
                    const binIdx = Math.round(freq / binHz);
                    if (binIdx >= 0 && binIdx < freqBinCount) {
                        // Average a few bins around target for smoothing
                        const lo = Math.max(0, binIdx - 2);
                        const hi = Math.min(freqBinCount - 1, binIdx + 2);
                        let sum = 0,
                            cnt = 0;
                        for (let k = lo; k <= hi; k++) {
                            sum += accumulator[k];
                            cnt++;
                        }
                        points.push({ freq, gain: sum / cnt });
                    }
                    freq *= Math.pow(2, 1 / ptsPerOctave);
                }

                // Normalize: midrange (500-2000 Hz) average → 75 dB
                const midPts = points.filter((p) => p.freq >= 500 && p.freq <= 2000);
                const midAvg = midPts.length > 0 ? midPts.reduce((s, p) => s + p.gain, 0) / midPts.length : 0;
                const offset = 75 - midAvg;
                const normalized = points.map((p) => ({ freq: p.freq, gain: p.gain + offset }));

                // 7. Store result
                getSpeakerChannel().measurement = normalized;
                updateSpeakerUI();
                renderSpeakerChannelTabs();
                computeCorrectedCurve();
                drawAutoEQGraph();
                if (speakerMeasStatus) speakerMeasStatus.textContent = `${normalized.length} pts (measured)`;
            } catch (err) {
                console.error('[Speaker Measure]', err);
                if (speakerMeasStatus)
                    speakerMeasStatus.textContent = err.name === 'NotAllowedError' ? 'Mic denied' : 'Measure failed';
            } finally {
                // Cleanup
                if (stream) stream.getTracks().forEach((t) => t.stop());
                if (measCtx && measCtx.state !== 'closed') measCtx.close().catch(() => {});
                speakerMeasureBtn.disabled = false;
            }
        });
    }

    // Measure All - plays pink noise once, assigns averaged measurement to all active channels
    const speakerMeasureAllBtn = document.getElementById('speaker-measure-all-btn');
    if (speakerMeasureAllBtn) {
        speakerMeasureAllBtn.addEventListener('click', async () => {
            speakerMeasureAllBtn.disabled = true;
            if (speakerMeasureBtn) speakerMeasureBtn.disabled = true;
            if (speakerMeasStatus) {
                speakerMeasStatus.textContent = 'Requesting mic...';
                speakerMeasStatus.classList.remove('loaded');
            }

            let measCtx, stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                });

                measCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
                const sr = measCtx.sampleRate;
                const duration = 5;

                // Generate pink noise buffer
                const bufLen = sr * duration;
                const buffer = measCtx.createBuffer(1, bufLen, sr);
                const d = buffer.getChannelData(0);
                let b0 = 0,
                    b1 = 0,
                    b2 = 0,
                    b3 = 0,
                    b4 = 0,
                    b5 = 0,
                    b6 = 0;
                for (let i = 0; i < bufLen; i++) {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.969 * b2 + white * 0.153852;
                    b3 = 0.8665 * b3 + white * 0.3104856;
                    b4 = 0.55 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.016898;
                    let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                    b6 = white * 0.115926;
                    let env = 1;
                    const t = i / sr;
                    if (t < 0.1) env = t / 0.1;
                    else if (t > duration - 0.1) env = (duration - t) / 0.1;
                    d[i] = pink * 0.04 * env;
                }

                const noiseSource = measCtx.createBufferSource();
                noiseSource.buffer = buffer;
                noiseSource.connect(measCtx.destination);

                const micSource = measCtx.createMediaStreamSource(stream);
                const analyser = measCtx.createAnalyser();
                analyser.fftSize = 8192;
                analyser.smoothingTimeConstant = 0.3;
                micSource.connect(analyser);

                const freqBinCount = analyser.frequencyBinCount;
                const binHz = sr / analyser.fftSize;
                const fftData = new Float32Array(freqBinCount);
                const accumulator = new Float64Array(freqBinCount);
                let frameCount = 0;

                noiseSource.start();
                const startTime = measCtx.currentTime;

                await new Promise((resolve) => {
                    const tick = () => {
                        const elapsed = measCtx.currentTime - startTime;
                        if (elapsed >= duration) {
                            resolve();
                            return;
                        }
                        const pct = Math.round((elapsed / duration) * 100);
                        if (speakerMeasStatus) speakerMeasStatus.textContent = `Measuring all... ${pct}%`;
                        if (elapsed > 0.3) {
                            analyser.getFloatFrequencyData(fftData);
                            for (let j = 0; j < freqBinCount; j++) {
                                const val = fftData[j];
                                if (val !== -Infinity) accumulator[j] += val;
                            }
                            frameCount++;
                        }
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                });

                noiseSource.stop();

                if (frameCount === 0) throw new Error('No frames captured');
                for (let j = 0; j < freqBinCount; j++) accumulator[j] /= frameCount;

                const points = [];
                const ptsPerOctave = 24;
                let freq = 20;
                while (freq <= 20000) {
                    const binIdx = Math.round(freq / binHz);
                    if (binIdx >= 0 && binIdx < freqBinCount) {
                        const lo = Math.max(0, binIdx - 2);
                        const hi = Math.min(freqBinCount - 1, binIdx + 2);
                        let sum = 0,
                            cnt = 0;
                        for (let k = lo; k <= hi; k++) {
                            sum += accumulator[k];
                            cnt++;
                        }
                        points.push({ freq, gain: sum / cnt });
                    }
                    freq *= Math.pow(2, 1 / ptsPerOctave);
                }

                const midPts = points.filter((p) => p.freq >= 500 && p.freq <= 2000);
                const midAvg = midPts.length > 0 ? midPts.reduce((s, p) => s + p.gain, 0) / midPts.length : 0;
                const offset = 75 - midAvg;
                const normalized = points.map((p) => ({ freq: p.freq, gain: p.gain + offset }));

                // Assign to ALL active channels
                const activeIds = SPEAKER_CONFIGS[speakerConfig];
                activeIds.forEach((id) => {
                    speakerChannels[id].measurement = normalized.map((p) => ({ ...p }));
                });

                updateSpeakerUI();
                renderSpeakerChannelTabs();
                computeCorrectedCurve();
                drawAutoEQGraph();
                if (speakerMeasStatus)
                    speakerMeasStatus.textContent = `${normalized.length} pts → ${activeIds.length} channels`;
            } catch (err) {
                console.error('[Speaker Measure All]', err);
                if (speakerMeasStatus)
                    speakerMeasStatus.textContent = err.name === 'NotAllowedError' ? 'Mic denied' : 'Measure failed';
            } finally {
                if (stream) stream.getTracks().forEach((t) => t.stop());
                if (measCtx && measCtx.state !== 'closed') measCtx.close().catch(() => {});
                speakerMeasureAllBtn.disabled = false;
                if (speakerMeasureBtn) speakerMeasureBtn.disabled = false;
            }
        });
    }

    // AutoEQ All - runs AutoEQ on every active channel that has a measurement
    const speakerAutoEqAllBtn = document.getElementById('speaker-autoeq-all-btn');
    if (speakerAutoEqAllBtn) {
        speakerAutoEqAllBtn.addEventListener('click', () => {
            const activeIds = SPEAKER_CONFIGS[speakerConfig];
            const measuredIds = activeIds.filter((id) => speakerChannels[id].measurement);
            if (measuredIds.length === 0) return;

            speakerAutoEqAllBtn.disabled = true;
            if (speakerAutoEqBtn) speakerAutoEqBtn.disabled = true;
            if (speakerEqStatus) speakerEqStatus.textContent = 'Running all...';

            setTimeout(() => {
                const bandCount = speakerBandCountSelect ? parseInt(speakerBandCountSelect.value, 10) : 10;
                const bassCut = speakerBassCutoff ? parseInt(speakerBassCutoff.value, 10) : 40;
                const roomLim = speakerRoomLimit ? parseInt(speakerRoomLimit.value, 10) : 500;

                measuredIds.forEach((id) => {
                    const ch = speakerChannels[id];
                    const targetEntry = SPEAKER_TARGETS.find((t) => t.id === ch.targetId);
                    const targetData = targetEntry?.data || [];

                    const bands = runAutoEqAlgorithm(ch.measurement, targetData, bandCount, roomLim, bassCut, 3.0);

                    let maxGain = 0;
                    for (let f = 20; f <= 20000; f *= 1.1) {
                        let total = 0;
                        bands.forEach((b) => {
                            if (b.enabled) total += calculateBiquadResponse(f, b);
                        });
                        if (total > maxGain) maxGain = total;
                    }
                    ch.bands = bands;
                    ch.preamp = maxGain > 0 ? parseFloat((-maxGain - 0.1).toFixed(1)) : 0;
                });

                // Refresh active channel UI
                const ch = getSpeakerChannel();
                applyBandsToAudio(ch.bands);
                renderBandControls(ch.bands);
                updateSpeakerUI();
                renderSpeakerChannelTabs();
                computeCorrectedCurve();
                drawAutoEQGraph();

                speakerAutoEqAllBtn.disabled = false;
                if (speakerAutoEqBtn) speakerAutoEqBtn.disabled = !ch.measurement;
                if (speakerEqStatus) speakerEqStatus.textContent = `${measuredIds.length} channels optimized`;
                setTimeout(() => {
                    if (speakerEqStatus) speakerEqStatus.textContent = '';
                }, 3000);
            }, 100);
        });
    }

    // Target change
    if (speakerTargetSelect) {
        speakerTargetSelect.addEventListener('change', () => {
            getSpeakerChannel().targetId = speakerTargetSelect.value;
            drawAutoEQGraph();
        });
    }

    // Import custom speaker target
    if (speakerImportTargetBtn && speakerImportTargetFile) {
        speakerImportTargetBtn.addEventListener('click', () => speakerImportTargetFile.click());
        speakerImportTargetFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const data = parseRawData(ev.target.result);
                if (data.length === 0) return;
                const customId = 'custom_speaker_target';
                const label = file.name.replace(/\.(txt|csv)$/i, '');
                const existing = SPEAKER_TARGETS.findIndex((t) => t.id === customId);
                if (existing > -1) SPEAKER_TARGETS[existing] = { id: customId, label, data };
                else SPEAKER_TARGETS.push({ id: customId, label, data });
                let opt = speakerTargetSelect.querySelector('option[value="custom_speaker_target"]');
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = customId;
                    speakerTargetSelect.appendChild(opt);
                }
                opt.textContent = label;
                speakerTargetSelect.value = customId;
                getSpeakerChannel().targetId = customId;
                drawAutoEQGraph();
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // Slider labels
    if (speakerBassCutoff) {
        speakerBassCutoff.addEventListener('input', () => {
            if (speakerBassCutoffValue) speakerBassCutoffValue.textContent = `${speakerBassCutoff.value} Hz`;
            drawAutoEQGraph();
        });
    }
    if (speakerRoomLimit) {
        speakerRoomLimit.addEventListener('input', () => {
            if (speakerRoomLimitValue) speakerRoomLimitValue.textContent = `${speakerRoomLimit.value} Hz`;
            drawAutoEQGraph();
        });
    }
    // AutoEQ per channel
    if (speakerAutoEqBtn) {
        speakerAutoEqBtn.addEventListener('click', () => {
            const ch = getSpeakerChannel();
            if (!ch.measurement) return;
            speakerAutoEqBtn.disabled = true;
            if (speakerEqStatus) speakerEqStatus.textContent = 'Running...';

            setTimeout(() => {
                const targetEntry = SPEAKER_TARGETS.find((t) => t.id === ch.targetId);
                const targetData = targetEntry?.data || [];
                const bandCount = speakerBandCountSelect ? parseInt(speakerBandCountSelect.value, 10) : 10;
                const bassCut = speakerBassCutoff ? parseInt(speakerBassCutoff.value, 10) : 40;
                const roomLim = speakerRoomLimit ? parseInt(speakerRoomLimit.value, 10) : 500;

                const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;
                const bands = runAutoEqAlgorithm(
                    ch.measurement,
                    targetData,
                    bandCount,
                    roomLim,
                    bassCut,
                    3.0,
                    sampleRate
                );

                // Auto preamp
                let maxGain = 0;
                for (let f = 20; f <= 20000; f *= 1.1) {
                    let total = 0;
                    bands.forEach((b) => {
                        if (b.enabled) total += calculateBiquadResponse(f, b, sampleRate);
                    });
                    if (total > maxGain) maxGain = total;
                }
                const autoPreamp = maxGain > 0 ? parseFloat((-maxGain - 0.1).toFixed(1)) : 0;

                ch.bands = bands;
                ch.preamp = autoPreamp;

                applyBandsToAudio(bands);
                renderBandControls(bands);
                updateSpeakerUI();
                renderSpeakerChannelTabs();
                computeCorrectedCurve();
                drawAutoEQGraph();

                speakerAutoEqBtn.disabled = false;
                if (speakerEqStatus) speakerEqStatus.textContent = `${speakerActiveChannel} optimized`;
                setTimeout(() => {
                    if (speakerEqStatus) speakerEqStatus.textContent = '';
                }, 3000);
            }, 100);
        });
    }

    // Export all channels as JSON
    if (speakerExportBtn) {
        speakerExportBtn.addEventListener('click', () => {
            const activeIds = SPEAKER_CONFIGS[speakerConfig];
            const data = {
                config: speakerConfig,
                channels: activeIds.map((id) => {
                    const ch = speakerChannels[id];
                    return {
                        id,
                        label: SPEAKER_CHANNEL_LABELS[id],
                        preamp: ch.preamp,
                        filters: ch.bands
                            .filter((b) => b.enabled)
                            .map((b) => ({
                                type: b.type,
                                freq: b.freq,
                                gain: b.gain,
                                q: b.q,
                            })),
                    };
                }),
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `SpeakerEQ_${speakerConfig}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Import EQ settings from JSON
    const speakerImportBtn = document.getElementById('speaker-import-btn');
    const speakerImportFile = document.getElementById('speaker-import-file');
    if (speakerImportBtn && speakerImportFile) {
        speakerImportBtn.addEventListener('click', () => speakerImportFile.click());
        speakerImportFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data.config || !Array.isArray(data.channels)) {
                    throw new Error('Invalid JSON format');
                }
                // Change config if different
                if (data.config !== speakerConfig) {
                    speakerConfig = data.config;
                    if (speakerConfigSelect) speakerConfigSelect.value = speakerConfig;
                }
                // Load channels
                data.channels.forEach((ch) => {
                    if (speakerChannels[ch.id]) {
                        speakerChannels[ch.id].preamp = ch.preamp || 0;
                        speakerChannels[ch.id].bands = ch.filters.map((f) => ({
                            enabled: true,
                            type: f.type,
                            freq: f.freq,
                            gain: f.gain,
                            q: f.q,
                        }));
                    }
                });
                // Update UI
                speakerActiveChannel = SPEAKER_CONFIGS[speakerConfig][0];
                renderSpeakerChannelTabs();
                setEQMode('speaker');
                if (speakerEqStatus) speakerEqStatus.textContent = `Loaded: ${data.channels.length} channels`;
                setTimeout(() => {
                    if (speakerEqStatus) speakerEqStatus.textContent = '';
                }, 2000);
            } catch (err) {
                if (speakerEqStatus) speakerEqStatus.textContent = `Error: ${err.message}`;
            }
            speakerImportFile.value = '';
        });
    }

    // ========================================
    // Speaker Saved Profiles
    // ========================================
    const SPEAKER_PROFILES_IDB_KEY = 'speaker-eq-profiles';
    const SPEAKER_ACTIVE_PROFILE_KEY = 'speaker-eq-active-profile';
    let _speakerProfilesCache = null; // in-memory cache backed by IndexedDB

    const getSpeakerProfiles = () => _speakerProfilesCache || {};

    const loadSpeakerProfilesFromDB = async () => {
        try {
            // Migrate from localStorage if present
            const lsData = localStorage.getItem('speaker-eq-profiles');
            if (lsData) {
                const parsed = JSON.parse(lsData);
                if (parsed && Object.keys(parsed).length > 0) {
                    await db.saveSetting(SPEAKER_PROFILES_IDB_KEY, parsed);
                }
                localStorage.removeItem('speaker-eq-profiles');
            }
        } catch {
            /* ignore migration errors */
        }
        try {
            _speakerProfilesCache = (await db.getSetting(SPEAKER_PROFILES_IDB_KEY)) || {};
        } catch {
            _speakerProfilesCache = {};
        }
    };

    const saveSpeakerProfiles = async (profiles) => {
        _speakerProfilesCache = profiles;
        await db.saveSetting(SPEAKER_PROFILES_IDB_KEY, profiles);
    };

    await loadSpeakerProfilesFromDB();

    const renderSpeakerProfiles = () => {
        const grid = document.getElementById('speaker-saved-grid');
        const countEl = document.getElementById('speaker-saved-count');
        if (!grid) return;

        const profiles = getSpeakerProfiles();
        const activeId = localStorage.getItem(SPEAKER_ACTIVE_PROFILE_KEY);
        const keys = Object.keys(profiles);
        if (countEl) countEl.textContent = keys.length;
        grid.innerHTML = '';

        if (keys.length === 0) return;

        keys.forEach((id) => {
            const profile = profiles[id];
            const card = document.createElement('div');
            card.className = 'autoeq-profile-card' + (id === activeId ? ' active' : '');

            const preview = document.createElement('canvas');
            preview.className = 'autoeq-profile-preview';
            preview.style.height = '80px';
            card.appendChild(preview);

            const channelCount = profile.channels ? profile.channels.length : 0;
            const info = document.createElement('div');
            info.className = 'autoeq-profile-info';
            info.innerHTML = `
                <span class="autoeq-profile-active-icon">&#10003;</span>
                <span class="autoeq-profile-name">${profile.name || 'Unnamed'}</span>
                <span class="autoeq-profile-meta">${profile.config} &middot; ${channelCount} ch</span>
            `;
            card.appendChild(info);

            const delBtn = document.createElement('button');
            delBtn.className = 'autoeq-profile-delete';
            delBtn.innerHTML = '&#128465;';
            delBtn.title = 'Delete profile';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const all = getSpeakerProfiles();
                delete all[id];
                await saveSpeakerProfiles(all);
                if (localStorage.getItem(SPEAKER_ACTIVE_PROFILE_KEY) === id)
                    localStorage.removeItem(SPEAKER_ACTIVE_PROFILE_KEY);
                renderSpeakerProfiles();
            });
            card.appendChild(delBtn);

            // Click to load
            card.addEventListener('click', () => {
                loadSpeakerProfile(id);
            });

            grid.appendChild(card);

            // Draw mini preview from first channel's measurement
            requestAnimationFrame(() => {
                const firstCh = profile.channels?.[0];
                if (firstCh && firstCh.measurementPreview) {
                    const targetEntry = SPEAKER_TARGETS.find((t) => t.id === (firstCh.targetId || 'harman_room'));
                    drawMiniGraph(
                        preview,
                        firstCh.measurementPreview,
                        targetEntry?.data ? downsampleCurve(targetEntry.data) : null,
                        firstCh.correctedPreview || null
                    );
                }
            });
        });
    };

    const loadSpeakerProfile = (profileId) => {
        const profiles = getSpeakerProfiles();
        const profile = profiles[profileId];
        if (!profile) return;

        // Switch config if different
        if (profile.config && profile.config !== speakerConfig) {
            speakerConfig = profile.config;
            if (speakerConfigSelect) speakerConfigSelect.value = speakerConfig;
        }

        // Load all channels
        if (profile.channels) {
            profile.channels.forEach((saved) => {
                if (speakerChannels[saved.id]) {
                    speakerChannels[saved.id].measurement = saved.measurement || null;
                    speakerChannels[saved.id].targetId = saved.targetId || 'harman_room';
                    speakerChannels[saved.id].preamp = saved.preamp || 0;
                    speakerChannels[saved.id].bands = saved.bands
                        ? saved.bands.map((b) => ({ ...b }))
                        : speakerChannels[saved.id].bands;
                }
            });
        }

        speakerActiveChannel = SPEAKER_CONFIGS[speakerConfig][0];
        const ch = getSpeakerChannel();
        applyBandsToAudio(ch.bands);
        renderBandControls(ch.bands);
        updateSpeakerUI();
        renderSpeakerChannelTabs();
        computeCorrectedCurve();
        drawAutoEQGraph();

        localStorage.setItem(SPEAKER_ACTIVE_PROFILE_KEY, profileId);
        renderSpeakerProfiles();
        if (speakerEqStatus) speakerEqStatus.textContent = `Loaded "${profile.name}"`;
        setTimeout(() => {
            if (speakerEqStatus) speakerEqStatus.textContent = '';
        }, 2000);
    };

    // Save button
    const speakerSaveBtn = document.getElementById('speaker-save-btn');
    const speakerProfileNameInput = document.getElementById('speaker-profile-name');
    if (speakerSaveBtn) {
        speakerSaveBtn.addEventListener('click', async () => {
            try {
                const name = speakerProfileNameInput?.value.trim() || `Speaker ${speakerConfig}`;
                const activeIds = SPEAKER_CONFIGS[speakerConfig];
                const profiles = getSpeakerProfiles();
                const id = 'spk_' + Date.now();

                profiles[id] = {
                    name,
                    config: speakerConfig,
                    channels: activeIds.map((chId) => {
                        const ch = speakerChannels[chId];
                        return {
                            id: chId,
                            targetId: ch.targetId,
                            preamp: ch.preamp,
                            bands: ch.bands.map((b) => ({ ...b })),
                            measurement: ch.measurement
                                ? ch.measurement.map((p) => ({ freq: p.freq, gain: parseFloat(p.gain.toFixed(1)) }))
                                : null,
                            measurementPreview: ch.measurement ? downsampleCurve(ch.measurement) : null,
                            correctedPreview:
                                autoeqCorrectedCurve && chId === speakerActiveChannel
                                    ? downsampleCurve(autoeqCorrectedCurve)
                                    : null,
                        };
                    }),
                    createdAt: Date.now(),
                };

                await saveSpeakerProfiles(profiles);
                localStorage.setItem(SPEAKER_ACTIVE_PROFILE_KEY, id);
                if (speakerProfileNameInput) speakerProfileNameInput.value = '';
                renderSpeakerProfiles();
                if (speakerEqStatus) speakerEqStatus.textContent = `Saved "${name}"`;
                setTimeout(() => {
                    if (speakerEqStatus) speakerEqStatus.textContent = '';
                }, 2000);
            } catch (err) {
                console.error('[Speaker Save]', err);
                if (speakerEqStatus) speakerEqStatus.textContent = `Save failed: ${err.message}`;
            }
        });
    }

    // Collapse toggle for speaker saved section
    const speakerSavedCollapse = document.getElementById('speaker-saved-collapse');
    const speakerSavedGrid = document.getElementById('speaker-saved-grid');
    if (speakerSavedCollapse && speakerSavedGrid) {
        speakerSavedCollapse.addEventListener('click', () => {
            speakerSavedCollapse.classList.toggle('collapsed');
            speakerSavedGrid.style.display = speakerSavedCollapse.classList.contains('collapsed') ? 'none' : '';
        });
    }

    // ========================================
    // Add/Remove/Reset Band Buttons
    // ========================================
    const addBandBtn = document.getElementById('autoeq-add-band-btn');
    const removeBandBtn = document.getElementById('autoeq-remove-band-btn');
    const resetBandsBtn = document.getElementById('autoeq-reset-bands-btn');

    if (addBandBtn) {
        addBandBtn.addEventListener('click', () => {
            let bands = getActiveBands();
            if (!bands) {
                bands = [];
                setActiveBands(bands);
            }
            if (bands.length >= 32) return;
            bands.push({
                id: bands.length,
                type: 'peaking',
                freq: 1000,
                gain: 0,
                q: 1.0,
                enabled: true,
                channel: 'stereo',
            });
            applyBandsToAudio(bands);
            renderBandControls(bands);
            computeCorrectedCurve();
            drawAutoEQGraph();
        });
    }

    if (removeBandBtn) {
        removeBandBtn.addEventListener('click', () => {
            const bands = getActiveBands();
            if (!bands || bands.length <= 1) return;
            bands.pop();
            applyBandsToAudio(bands);
            renderBandControls(bands);
            computeCorrectedCurve();
            drawAutoEQGraph();
        });
    }

    if (resetBandsBtn) {
        resetBandsBtn.addEventListener('click', () => {
            const bands = getActiveBands();
            if (!bands) return;
            bands.forEach((b) => {
                b.gain = 0;
            });
            applyBandsToAudio(bands);
            renderBandControls(bands);
            computeCorrectedCurve();
            drawAutoEQGraph();
        });
    }

    // ========================================
    // EQ Toggle (enable/disable)
    // ========================================
    if (eqToggle) {
        eqToggle.checked = equalizerSettings.isEnabled();
        updateEQContainerVisibility(eqToggle.checked);

        eqToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            equalizerSettings.setEnabled(enabled);
            updateEQContainerVisibility(enabled);

            if (currentMode === 'legacy') {
                // Legacy mode uses graphic EQ chain
                audioContextManager.isEQEnabled = false;
                audioContextManager.toggleGraphicEQ(enabled);
            } else {
                // AutoEQ/Parametric/Speaker modes use parametric EQ chain
                audioContextManager.toggleEQ(enabled);
                audioContextManager.toggleGraphicEQ(false);
            }
        });
    }

    // Initial render of saved profiles
    renderSavedProfiles();

    // Hide parametric-only elements on startup (default mode is autoeq)
    const initPresetRow = document.getElementById('autoeq-preset-row');
    const initParaProfiles = document.getElementById('autoeq-parametric-profiles');
    if (initPresetRow) initPresetRow.style.display = 'none';
    if (initParaProfiles) initParaProfiles.style.display = 'none';

    // Auto-load headphone database
    await loadFullDatabase();

    // Auto-load default popular headphone if no saved profile is active
    const activeProfileId = equalizerSettings.getActiveAutoEQProfile();
    if (!activeProfileId) {
        // Try restoring last selected headphone (persisted measurement + entry)
        const lastHp = equalizerSettings.getLastHeadphone();
        if (lastHp) {
            autoeqSelectedMeasurement = lastHp.measurementData;
            autoeqSelectedEntry = lastHp.entry;
            if (autoeqHeadphoneSelect) {
                let opt = autoeqHeadphoneSelect.querySelector(`option[value="${lastHp.entry.name}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = lastHp.entry.name;
                    opt.textContent = lastHp.entry.name.replace(/\s*\([^)]*\)\s*$/, '');
                    autoeqHeadphoneSelect.appendChild(opt);
                }
                autoeqHeadphoneSelect.value = lastHp.entry.name;
            }
            if (autoeqRunBtn) autoeqRunBtn.disabled = false;
            requestAnimationFrame(drawAutoEQGraph);
        } else if (POPULAR_HEADPHONES.length > 0) {
            await loadHeadphoneEntry(POPULAR_HEADPHONES[0]);
        }
    }

    // Initial draw of graph (if EQ is enabled)
    if (equalizerSettings.isEnabled()) {
        requestAnimationFrame(drawAutoEQGraph);
    }

    // Load active profile on startup
    if (activeProfileId) {
        const profiles = equalizerSettings.getAutoEQProfiles();
        if (profiles[activeProfileId]) {
            // Restore state silently
            const profile = profiles[activeProfileId];
            autoeqCurrentBands = profile.bands?.map((b) => ({ ...b })) || null;
            autoeqCorrectedCurve = profile.correctedData ? [...profile.correctedData] : null;
            autoeqSelectedMeasurement = profile.measurementData ? [...profile.measurementData] : null;
            autoeqSelectedEntry = { name: profile.headphoneName, type: profile.headphoneType };
            // Restore headphone select dropdown
            if (autoeqHeadphoneSelect) {
                let opt = autoeqHeadphoneSelect.querySelector(`option[value="${profile.headphoneName}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = profile.headphoneName;
                    opt.textContent = profile.headphoneName.replace(/\s*\([^)]*\)\s*$/, '');
                    autoeqHeadphoneSelect.appendChild(opt);
                }
                autoeqHeadphoneSelect.value = profile.headphoneName;
            }
            if (autoeqTargetSelect) autoeqTargetSelect.value = profile.targetId || 'harman_oe_2018';
            setAutoeqBandCount(profile.bandCount, profile.bands);
            if (autoeqMaxFreq) autoeqMaxFreq.value = profile.maxFreq || 16000;
            if (autoeqSampleRate) autoeqSampleRate.value = profile.sampleRate || 48000;
            if (autoeqRunBtn) autoeqRunBtn.disabled = false;
            if (autoeqCurrentBands) renderBandControls(autoeqCurrentBands);
            requestAnimationFrame(drawAutoEQGraph);
        }
    }

    // Restore parametric EQ active profile on startup
    const activeParametricId = localStorage.getItem(PARAMETRIC_ACTIVE_KEY);
    if (activeParametricId) {
        const parametricProfiles = getParametricProfiles();
        const paraProfile = parametricProfiles[activeParametricId];
        if (paraProfile && paraProfile.bands) {
            parametricBands = paraProfile.bands.map((b) => ({ ...b }));
        }
    }

    // Restore speaker EQ active profile on startup
    const activeSpeakerId = localStorage.getItem(SPEAKER_ACTIVE_PROFILE_KEY);
    if (activeSpeakerId) {
        const speakerProfiles = getSpeakerProfiles();
        const spkProfile = speakerProfiles[activeSpeakerId];
        if (spkProfile) {
            if (spkProfile.config) {
                speakerConfig = spkProfile.config;
                if (speakerConfigSelect) speakerConfigSelect.value = speakerConfig;
            }
            if (spkProfile.channels) {
                spkProfile.channels.forEach((saved) => {
                    if (speakerChannels[saved.id]) {
                        speakerChannels[saved.id].measurement = saved.measurement || null;
                        speakerChannels[saved.id].targetId = saved.targetId || 'harman_room';
                        speakerChannels[saved.id].preamp = saved.preamp || 0;
                        speakerChannels[saved.id].bands = saved.bands
                            ? saved.bands.map((b) => ({ ...b }))
                            : speakerChannels[saved.id].bands;
                    }
                });
            }
            speakerActiveChannel = SPEAKER_CONFIGS[speakerConfig][0];
        }
    }

    // Restore EQ mode on startup
    const savedEQMode = localStorage.getItem(EQ_MODE_KEY);
    if (savedEQMode && ['autoeq', 'parametric', 'speaker', 'legacy'].includes(savedEQMode)) {
        setEQMode(savedEQMode);
    }

    // Now Playing Mode
    const nowPlayingMode = document.getElementById('now-playing-mode');
    if (nowPlayingMode) {
        nowPlayingMode.value = nowPlayingSettings.getMode();
        nowPlayingMode.addEventListener('change', (e) => {
            nowPlayingSettings.setMode(e.target.value);
        });
    }

    // Fullscreen Cover Click Action
    const fullscreenCoverClickAction = document.getElementById('fullscreen-cover-click-action');
    if (fullscreenCoverClickAction) {
        fullscreenCoverClickAction.value = fullscreenCoverClickSettings.getAction();
        fullscreenCoverClickAction.addEventListener('change', (e) => {
            fullscreenCoverClickSettings.setAction(e.target.value);
        });
    }

    // Close Modals on Navigation Toggle
    const closeModalsOnNavigationToggle = document.getElementById('close-modals-on-navigation-toggle');
    if (closeModalsOnNavigationToggle) {
        closeModalsOnNavigationToggle.checked = modalSettings.shouldCloseOnNavigation();
        closeModalsOnNavigationToggle.addEventListener('change', (e) => {
            modalSettings.setCloseOnNavigation(e.target.checked);
        });
    }

    // Intercept Back to Close Modals Toggle
    const interceptBackToCloseToggle = document.getElementById('intercept-back-to-close-modals-toggle');
    if (interceptBackToCloseToggle) {
        interceptBackToCloseToggle.checked = modalSettings.shouldInterceptBackToClose();
        interceptBackToCloseToggle.addEventListener('change', (e) => {
            modalSettings.setInterceptBackToClose(e.target.checked);
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

    // Artist Banners Toggle
    const artistBannersToggle = document.getElementById('artist-banners-toggle');
    if (artistBannersToggle) {
        artistBannersToggle.checked = artistBannerSettings.isEnabled();
        artistBannersToggle.addEventListener('change', (e) => {
            artistBannerSettings.setEnabled(e.target.checked);
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

    // Write multiple artists toggle
    const writeArtistsSeparatelyToggle = document.getElementById('write-artists-separately-toggle');
    if (writeArtistsSeparatelyToggle) {
        writeArtistsSeparatelyToggle.checked = modernSettings.writeArtistsSeparately;
        writeArtistsSeparatelyToggle.addEventListener('change', (e) => {
            modernSettings.writeArtistsSeparately = e.target.checked;
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

    // Fullscreen Cover No Round Toggle
    const fullscreenCoverNoRoundToggle = document.getElementById('fullscreen-cover-no-round-toggle');
    if (fullscreenCoverNoRoundToggle) {
        fullscreenCoverNoRoundToggle.checked = fullscreenCoverNoRoundSettings.isEnabled();
        fullscreenCoverNoRoundToggle.addEventListener('change', (e) => {
            fullscreenCoverNoRoundSettings.setEnabled(e.target.checked);
            window.dispatchEvent(new CustomEvent('fullscreen-cover-settings-changed'));
        });
    }

    // Fullscreen Cover Vanilla Tilt Toggle
    const fullscreenCoverVanillaTiltToggle = document.getElementById('fullscreen-cover-vanilla-tilt-toggle');
    if (fullscreenCoverVanillaTiltToggle) {
        fullscreenCoverVanillaTiltToggle.checked = fullscreenCoverVanillaTiltSettings.isEnabled();
        fullscreenCoverVanillaTiltToggle.addEventListener('change', (e) => {
            fullscreenCoverVanillaTiltSettings.setEnabled(e.target.checked);
            window.dispatchEvent(new CustomEvent('fullscreen-cover-settings-changed'));
        });
    }

    // Fullscreen Cover Tilt Distance
    const fullscreenCoverTiltDistanceSlider = document.getElementById('fullscreen-cover-tilt-distance');
    if (fullscreenCoverTiltDistanceSlider) {
        fullscreenCoverTiltDistanceSlider.value = fullscreenCoverTiltDistanceSettings.getValue();
        fullscreenCoverTiltDistanceSlider.addEventListener('input', (e) => {
            fullscreenCoverTiltDistanceSettings.setValue(parseInt(e.target.value));
            window.dispatchEvent(new CustomEvent('fullscreen-cover-settings-changed'));
        });
    }

    // Fullscreen Cover Tilt Speed
    const fullscreenCoverTiltSpeedSlider = document.getElementById('fullscreen-cover-tilt-speed');
    if (fullscreenCoverTiltSpeedSlider) {
        fullscreenCoverTiltSpeedSlider.value = fullscreenCoverTiltSpeedSettings.getValue();
        fullscreenCoverTiltSpeedSlider.addEventListener('input', (e) => {
            fullscreenCoverTiltSpeedSettings.setValue(parseInt(e.target.value));
            window.dispatchEvent(new CustomEvent('fullscreen-cover-settings-changed'));
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

    const visualizerDimmingSlider = document.getElementById('visualizer-dimming-slider');
    const visualizerDimmingValue = document.getElementById('visualizer-dimming-value');
    if (visualizerDimmingSlider && visualizerDimmingValue) {
        const currentDimming = visualizerSettings.getDimAmount();
        visualizerDimmingSlider.value = currentDimming;
        visualizerDimmingValue.textContent = `${(currentDimming * 100).toFixed(0)}%`;

        visualizerDimmingSlider.addEventListener('input', (e) => {
            const newDimming = parseFloat(e.target.value);
            visualizerSettings.setDimAmount(newDimming);
            visualizerDimmingValue.textContent = `${(newDimming * 100).toFixed(0)}%`;
            window.dispatchEvent(new CustomEvent('visualizer-dim-change', { detail: { dimAmount: newDimming } }));
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

    const updateButterchurnSettingsVisibility = async () => {
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
        const { keys: presetNames } = await getButterchurnPresets();
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

    const updateVisualizerSettingsVisibility = async (enabled) => {
        const display = enabled ? 'flex' : 'none';
        if (visualizerModeSetting) visualizerModeSetting.style.display = display;
        if (visualizerSmartIntensitySetting) visualizerSmartIntensitySetting.style.display = display;
        if (visualizerSensitivitySetting) visualizerSensitivitySetting.style.display = display;
        if (visualizerPresetSetting) visualizerPresetSetting.style.display = display;

        // Also update Butterchurn specific visibility
        await updateButterchurnSettingsVisibility();
    };

    // Initialize preset select value early so visibility logic works correctly on load
    if (visualizerPresetSelect) {
        visualizerPresetSelect.value = visualizerSettings.getPreset();
    }

    if (visualizerEnabledToggle) {
        visualizerEnabledToggle.checked = visualizerSettings.isEnabled();

        await updateVisualizerSettingsVisibility(visualizerEnabledToggle.checked);

        visualizerEnabledToggle.addEventListener('change', async (e) => {
            visualizerSettings.setEnabled(e.target.checked);
            await updateVisualizerSettingsVisibility(e.target.checked);
        });
    }

    // Visualizer Preset Select
    if (visualizerPresetSelect) {
        // value set above
        visualizerPresetSelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            visualizerSettings.setPreset(val);
            if (ui && ui.visualizer) {
                ui.visualizer.setPreset(val);
            }
            await updateButterchurnSettingsVisibility();

            //Since changing the preset breaks the visualizer, a location.reload() is added to make sure that it works
            window.location.reload();
        });
    }

    if (butterchurnCycleToggle) {
        butterchurnCycleToggle.checked = visualizerSettings.isButterchurnCycleEnabled();
        butterchurnCycleToggle.addEventListener('change', async (e) => {
            visualizerSettings.setButterchurnCycleEnabled(e.target.checked);
            await updateButterchurnSettingsVisibility();
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
    window.addEventListener('butterchurn-presets-loaded', async () => {
        console.log('[Settings] Butterchurn presets loaded event received');
        await updateButterchurnSettingsVisibility();
    });

    // Check if presets already cached and update immediately
    const { keys: cachedKeys } = await getButterchurnPresets();
    if (cachedKeys.length > 0) {
        console.log('[Settings] Presets already cached, updating dropdown immediately');
        await updateButterchurnSettingsVisibility();
    }

    // Watch for appearance tab becoming active and refresh presets
    const appearanceTabContent = document.getElementById('settings-tab-appearance');
    if (appearanceTabContent) {
        const observer = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (appearanceTabContent.classList.contains('active')) {
                        console.log('[Settings] Appearance tab became active, refreshing presets');
                        await updateButterchurnSettingsVisibility();
                    }
                }
            }
        });
        observer.observe(appearanceTabContent, { attributes: true });
    }

    // Watch for downloads tab becoming active and update setting visibility
    const downloadsTabContent = document.getElementById('settings-tab-downloads');
    if (downloadsTabContent) {
        const observer = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (downloadsTabContent.classList.contains('active')) {
                        console.log('[Settings] Downloads tab became active, updating setting visibility');
                        updateForceZipBlobVisibility();
                        await updateFolderMethodVisibility();
                    }
                }
            }
        });
        observer.observe(downloadsTabContent, { attributes: true });
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

    const editorsPicksSourceSelect = document.getElementById('editors-picks-source-select');
    if (editorsPicksSourceSelect) {
        async function populateEditorsPicksSource() {
            try {
                const response = await fetch('/editors-picks-old/index.json');
                if (response.ok) {
                    const oldPicks = await response.json();
                    oldPicks.forEach((pick) => {
                        const option = document.createElement('option');
                        option.value = pick.file;
                        option.textContent = pick.label;
                        editorsPicksSourceSelect.appendChild(option);
                    });
                }
            } catch (e) {
                console.warn('Could not load editors-picks-old index:', e);
            }
            const currentSource = homePageSettings.getEditorsPicksSource();
            editorsPicksSourceSelect.value = currentSource;
        }
        await populateEditorsPicksSource();

        editorsPicksSourceSelect.addEventListener('change', (e) => {
            homePageSettings.setEditorsPicksSource(e.target.value);
            window.dispatchEvent(new CustomEvent('refresh-home-editors-picks'));
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

    const sidebarShowAboutToggle = document.getElementById('sidebar-show-about-bottom-toggle');
    if (sidebarShowAboutToggle) {
        sidebarShowAboutToggle.checked = sidebarSectionSettings.shouldShowAbout();
        sidebarShowAboutToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowAbout(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowDiscordToggle = document.getElementById('sidebar-show-discordbtn-toggle');
    if (sidebarShowDiscordToggle) {
        sidebarShowDiscordToggle.checked = sidebarSectionSettings.shouldShowDiscord();
        sidebarShowDiscordToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowDiscord(e.target.checked);
            sidebarSectionSettings.applySidebarVisibility();
        });
    }

    const sidebarShowGithubToggle = document.getElementById('sidebar-show-githubbtn-toggle');
    if (sidebarShowGithubToggle) {
        sidebarShowGithubToggle.checked = sidebarSectionSettings.shouldShowGithub();
        sidebarShowGithubToggle.addEventListener('change', (e) => {
            sidebarSectionSettings.setShowGithub(e.target.checked);
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

        const mainContainer = sidebarSettingsGroup.querySelector('.sidebar-settings-main');
        const bottomContainer = sidebarSettingsGroup.querySelector('.sidebar-settings-bottom');

        const getSidebarItems = () => [
            ...(mainContainer?.querySelectorAll('.sidebar-setting-item[data-sidebar-id]') ?? []),
            ...(bottomContainer?.querySelectorAll('.sidebar-setting-item[data-sidebar-id]') ?? []),
        ];

        const applySidebarSettingsOrder = () => {
            const order = sidebarSectionSettings.getOrder();
            const bottomIds = sidebarSectionSettings.getBottomNavIds();
            const mainOrder = order.filter((id) => !bottomIds.includes(id));
            const bottomOrder = order.filter((id) => bottomIds.includes(id));
            const allItems = getSidebarItems();
            const itemMap = new Map(allItems.map((item) => [item.dataset.sidebarId, item]));

            mainOrder.forEach((id) => {
                const item = itemMap.get(id);
                if (item && mainContainer) mainContainer.appendChild(item);
            });
            bottomOrder.forEach((id) => {
                const item = itemMap.get(id);
                if (item && bottomContainer) bottomContainer.appendChild(item);
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

        const getDragAfterElement = (elements, y) => {
            const draggableElements = elements.filter((el) => el !== draggedItem);
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
            const container = draggedItem.parentElement;
            if (container !== mainContainer && container !== bottomContainer) return;
            const sectionItems = Array.from(container.querySelectorAll('.sidebar-setting-item[data-sidebar-id]'));
            const afterElement = getDragAfterElement(sectionItems, e.clientY);
            if (afterElement === draggedItem) return;
            if (afterElement) {
                container.insertBefore(draggedItem, afterElement);
            } else {
                container.appendChild(draggedItem);
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
        filenameTemplate.value = modernSettings.filenameTemplate;
        filenameTemplate.addEventListener('change', (e) => {
            modernSettings.filenameTemplate = String(e.target.value);
        });
    }

    // ZIP folder template
    const zipFolderTemplate = document.getElementById('zip-folder-template');
    if (zipFolderTemplate) {
        zipFolderTemplate.value = modernSettings.folderTemplate;
        zipFolderTemplate.addEventListener('change', (e) => {
            modernSettings.folderTemplate = String(e.target.value);
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

    const separateDiscsZipToggle = document.getElementById('separate-discs-zip-toggle');
    if (separateDiscsZipToggle) {
        separateDiscsZipToggle.checked = playlistSettings.shouldSeparateDiscsInZip();
        separateDiscsZipToggle.addEventListener('change', (e) => {
            playlistSettings.setSeparateDiscsInZip(e.target.checked);
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
        const type = button.dataset.type || li?.dataset.type || 'api';

        if (button.classList.contains('add-instance')) {
            const url = prompt(`Enter custom ${type.toUpperCase()} instance URL (e.g. https://my-instance.com):`);
            if (url && url.trim()) {
                let formattedUrl = url.trim();
                if (!formattedUrl.startsWith('http')) {
                    formattedUrl = 'https://' + formattedUrl;
                }
                api.settings.addUserInstance(type, formattedUrl);
                ui.renderApiSettings();
            }
            return;
        }

        if (button.classList.contains('delete-instance')) {
            const url = li.dataset.url;
            if (url && confirm(`Delete custom instance ${url}?`)) {
                api.settings.removeUserInstance(type, url);
                ui.renderApiSettings();
            }
            return;
        }

        const index = parseInt(li?.dataset.index, 10);
        if (isNaN(index)) return;

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

    document.getElementById('auth-clear-cloud-btn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete ALL your data from the cloud? This cannot be undone.')) {
            try {
                await syncManager.clearCloudData();
                alert('Cloud data cleared successfully.');
                await authManager.signOut();
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
                await db.importData(data, true);
                alert('Library imported successfully!');
                window.location.reload(); // Simple way to refresh all state
            } catch (err) {
                console.error('Import failed:', err);
                alert('Failed to import library. Please check the file format.');
            }
        };
        reader.readAsText(file);
    });

    // Export All Settings
    document.getElementById('export-settings-btn')?.addEventListener('click', () => {
        const settingsToExport = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('monochrome-')) {
                try {
                    settingsToExport[key] = JSON.parse(localStorage.getItem(key));
                } catch {
                    settingsToExport[key] = localStorage.getItem(key);
                }
            }
        }
        const blob = new Blob([JSON.stringify(settingsToExport, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `monochrome-settings-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Import All Settings
    const settingsImportInput = document.getElementById('import-settings-input');
    document.getElementById('import-settings-btn')?.addEventListener('click', () => {
        settingsImportInput.click();
    });

    settingsImportInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const settingsToImport = JSON.parse(event.target.result);
                for (const [key, value] of Object.entries(settingsToImport)) {
                    if (key.startsWith('monochrome-')) {
                        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                    }
                }
                alert('Settings imported successfully! Please reload the app.');
                window.location.reload();
            } catch (err) {
                console.error('Import failed:', err);
                alert('Failed to import settings. Please check the file format.');
            }
        };
        reader.readAsText(file);
    });

    const customDbBtn = document.getElementById('custom-db-btn');
    const customDbModal = document.getElementById('custom-db-modal');
    const customPbUrlInput = document.getElementById('custom-pb-url');
    const customAppwriteEndpointInput = document.getElementById('custom-appwrite-endpoint');
    const customAppwriteProjectInput = document.getElementById('custom-appwrite-project');
    const customDbSaveBtn = document.getElementById('custom-db-save');
    const customDbResetBtn = document.getElementById('custom-db-reset');
    const customDbCancelBtn = document.getElementById('custom-db-cancel');

    if (customDbBtn && customDbModal) {
        const appwriteFromEnv = !!(window.__APPWRITE_ENDPOINT__ || window.__APPWRITE_PROJECT_ID__);
        const pbFromEnv = !!window.__POCKETBASE_URL__;

        // Hide entire setting if both are server-configured
        if (appwriteFromEnv && pbFromEnv) {
            const settingItem = customDbBtn.closest('.setting-item');
            if (settingItem) settingItem.style.display = 'none';
        }

        // Hide individual fields in the modal
        if (pbFromEnv && customPbUrlInput) customPbUrlInput.closest('div[style]').style.display = 'none';
        if (appwriteFromEnv) {
            if (customAppwriteEndpointInput) customAppwriteEndpointInput.closest('div[style]').style.display = 'none';
            if (customAppwriteProjectInput) customAppwriteProjectInput.closest('div[style]').style.display = 'none';
        }

        customDbBtn.addEventListener('click', () => {
            const pbUrl = localStorage.getItem('monochrome-pocketbase-url') || '';
            const appwriteEndpoint = localStorage.getItem('monochrome-appwrite-endpoint') || '';
            const appwriteProject = localStorage.getItem('monochrome-appwrite-project') || '';

            if (!pbFromEnv && customPbUrlInput) customPbUrlInput.value = pbUrl;
            if (!appwriteFromEnv) {
                if (customAppwriteEndpointInput) customAppwriteEndpointInput.value = appwriteEndpoint;
                if (customAppwriteProjectInput) customAppwriteProjectInput.value = appwriteProject;
            }

            customDbModal.classList.add('active');
        });

        const closeCustomDbModal = () => {
            customDbModal.classList.remove('active');
        };

        customDbCancelBtn.addEventListener('click', closeCustomDbModal);
        customDbModal.querySelector('.modal-overlay').addEventListener('click', closeCustomDbModal);

        customDbSaveBtn.addEventListener('click', () => {
            if (!pbFromEnv && customPbUrlInput) {
                const pbUrl = customPbUrlInput.value.trim();
                if (pbUrl) {
                    localStorage.setItem('monochrome-pocketbase-url', pbUrl);
                } else {
                    localStorage.removeItem('monochrome-pocketbase-url');
                }
            }

            if (!appwriteFromEnv) {
                const endpoint = customAppwriteEndpointInput?.value.trim();
                const project = customAppwriteProjectInput?.value.trim();

                if (endpoint) {
                    localStorage.setItem('monochrome-appwrite-endpoint', endpoint);
                } else {
                    localStorage.removeItem('monochrome-appwrite-endpoint');
                }

                if (project) {
                    localStorage.setItem('monochrome-appwrite-project', project);
                } else {
                    localStorage.removeItem('monochrome-appwrite-project');
                }
            }

            alert('Settings saved. Reloading...');
            window.location.reload();
        });

        customDbResetBtn.addEventListener('click', () => {
            if (confirm('Reset custom database settings to default?')) {
                localStorage.removeItem('monochrome-pocketbase-url');
                localStorage.removeItem('monochrome-appwrite-endpoint');
                localStorage.removeItem('monochrome-appwrite-project');
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

    // Analytics Toggle
    const analyticsToggle = document.getElementById('analytics-toggle');
    if (analyticsToggle) {
        analyticsToggle.checked = analyticsSettings.isEnabled();
        analyticsToggle.addEventListener('change', (e) => {
            analyticsSettings.setEnabled(e.target.checked);
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
                        const stores = [
                            'favorites_tracks',
                            'favorites_videos',
                            'favorites_albums',
                            'favorites_artists',
                            'favorites_playlists',
                            'favorites_mixes',
                            'history_tracks',
                            'user_playlists',
                            'user_folders',
                            'settings',
                            'pinned_items',
                        ];

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
                            const deleteRequest = indexedDB.deleteDatabase('MonochromeDB');
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
        } else if (value === 'Apple Music') {
            fontSettings.loadAppleMusicFont();
        } else {
            fontSettings.loadPresetFont(value, 'sans-serif');
        }
    });

    // Google Fonts apply
    fontGoogleApply.addEventListener('click', async () => {
        const input = fontGoogleInput.value.trim();
        if (!input) return;

        let fontName = input;

        // Check if it's a Google Fonts URL
        try {
            const urlObj = new URL(input);
            if (urlObj.hostname === 'fonts.google.com') {
                const parsed = fontSettings.parseGoogleFontsUrl(input);
                if (parsed) {
                    fontName = parsed;
                }
            }
        } catch {
            // Not a URL, treat as font name
        }

        await fontSettings.loadGoogleFont(fontName);
    });

    // URL font apply
    fontUrlApply.addEventListener('click', async () => {
        const url = fontUrlInput.value.trim();
        const name = fontUrlName.value.trim();
        if (!url) return;

        await fontSettings.loadFontFromUrl(url, name || 'CustomFont');
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

    // Font Size Controls
    const fontSizeSlider = document.getElementById('font-size-slider');
    const fontSizeInput = document.getElementById('font-size-input');
    const fontSizeReset = document.getElementById('font-size-reset');

    // Helper function to update both controls
    const updateFontSizeControls = (size) => {
        const validSize = Math.max(50, Math.min(200, parseInt(size, 10) || 100));
        if (fontSizeSlider) fontSizeSlider.value = validSize;
        if (fontSizeInput) fontSizeInput.value = validSize;
        return validSize;
    };

    // Initialize with saved value
    const savedSize = fontSettings.getFontSize();
    updateFontSizeControls(savedSize);

    // Slider change handler
    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', () => {
            const size = parseInt(fontSizeSlider.value, 10);
            if (fontSizeInput) fontSizeInput.value = size;
            fontSettings.setFontSize(size);
        });
    }

    // Number input change handler
    if (fontSizeInput) {
        fontSizeInput.addEventListener('change', () => {
            let size = parseInt(fontSizeInput.value, 10);
            // Clamp to valid range
            size = Math.max(50, Math.min(200, size || 100));
            updateFontSizeControls(size);
            fontSettings.setFontSize(size);
        });

        // Also update on input for real-time feedback
        fontSizeInput.addEventListener('input', () => {
            let size = parseInt(fontSizeInput.value, 10);
            if (!isNaN(size) && size >= 50 && size <= 200) {
                if (fontSizeSlider) fontSizeSlider.value = size;
                fontSettings.setFontSize(size);
            }
        });
    }

    if (fontSizeReset) {
        fontSizeReset.addEventListener('click', () => {
            const defaultSize = fontSettings.resetFontSize();
            updateFontSizeControls(defaultSize);
        });
    }
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
