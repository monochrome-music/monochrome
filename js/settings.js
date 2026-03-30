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
} from './storage.js';
import { audioContextManager, EQ_PRESETS, getPresetsForBandCount } from './audio-context.js';
import { calculateBiquadResponse, interpolate, getNormalizationOffset, runAutoEqAlgorithm } from './autoeq-engine.js';
import { parseRawData, TARGETS } from './autoeq-data.js';
import { fetchAutoEqIndex, fetchHeadphoneData, searchHeadphones } from './autoeq-importer.js';
import { db } from './db.js';
import { authManager } from './accounts/auth.js';
import { syncManager } from './accounts/pocketbase.js';
import { containerFormats, customFormats } from './ffmpegFormats.ts';
import { modernSettings } from './ModernSettings.js';

async function getButterchurnPresets(...args) {
    const butterchurnModule = await import('./visualizers/butterchurn.js');
    return butterchurnModule.getButterchurnPresets(...args);
}

// Module-level state for AutoEQ (persists across re-initializations)
let _autoeqIndex = [];

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
        const apiQuality = streamingQualitySetting.value === 'auto' ? 'HI_RES_LOSSLESS' : streamingQualitySetting.value;
        player.setQuality(localStorage.getItem('playback-quality') || apiQuality);

        streamingQualitySetting.addEventListener('change', (e) => {
            const val = e.target.value;

            // Set adaptive DASH quality
            localStorage.setItem('adaptive-playback-quality', val);
            if (player.forceQuality) player.forceQuality(val);

            // Set fallback API quality
            const newApiQuality = val === 'auto' ? 'HI_RES_LOSSLESS' : val;
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
        const visible = method === 'zip' && hasFileSystemAccess;
        forceZipBlobSettingItem.style.display = visible ? '' : 'none';
    }

    /** Shows/hides folder-picker-specific and folder-method settings */
    async function updateFolderMethodVisibility() {
        const method = modernSettings.bulkDownloadMethod;
        const isFolderMethod = method === 'folder';
        const isFolderOrLocal = isFolderMethod || method === 'local';

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
            if (currentMethod === 'folder' || currentMethod === 'local') {
                modernSettings.bulkDownloadMethod = 'zip';
            }
        }
        bulkDownloadMethod.value = modernSettings.bulkDownloadMethod;
        bulkDownloadMethod.addEventListener('change', async (e) => {
            const previousMethod = modernSettings.bulkDownloadMethod;
            const newMethod = e.target.value;
            modernSettings.bulkDownloadMethod = newMethod;

            // When switching to 'local', prompt to select the local media folder if not yet configured
            if (newMethod === 'local') {
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
    const playbackSpeedReset = document.getElementById('playback-speed-reset');

    if (playbackSpeedSlider && playbackSpeedInput) {
        // Helper function to update both controls
        const updatePlaybackSpeedControls = (speed) => {
            const validSpeed = Math.max(0.01, Math.min(100, parseFloat(speed) || 1.0));
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
    // Precision AutoEQ — Redesigned Equalizer
    // ========================================
    const eqToggle = document.getElementById('equalizer-enabled-toggle');
    const eqContainer = document.getElementById('equalizer-container');
    const eqPreampSlider = document.getElementById('eq-preamp-slider');
    const eqImportFile = document.getElementById('eq-import-file');

    // AutoEQ State (kept when switching modes)
    let autoeqSelectedMeasurement = null;
    let autoeqSelectedEntry = null;
    let autoeqTypeFilter = 'all';
    let autoeqSearchTimer = null;
    let autoeqCurrentBands = null;   // AutoEQ-generated bands
    let autoeqCorrectedCurve = null;
    let currentPreamp = equalizerSettings.getPreamp();

    // Parametric EQ State (separate from AutoEQ, kept when switching modes)
    let parametricBands = null;

    // Interactive graph state
    let draggedNode = null;
    let hoveredNode = null;
    let graphAnimFrame = null;

    // dB zoom state (half-range values, user-adjustable via scroll on Y axis)
    let graphDbHalfAutoEQ = 25;
    let graphDbHalfParametric = 35;

    /** Get the active bands for the current mode */
    const getActiveBands = () => currentMode === 'parametric' ? parametricBands : autoeqCurrentBands;
    /** Set the active bands for the current mode */
    const setActiveBands = (bands) => {
        if (currentMode === 'parametric') parametricBands = bands;
        else autoeqCurrentBands = bands;
    };

    // DOM Elements
    const autoeqCanvas = document.getElementById('autoeq-response-canvas');
    const autoeqGraphWrapper = document.getElementById('autoeq-graph-wrapper');
    const autoeqSearchInput = document.getElementById('autoeq-headphone-search');
    const autoeqHeadphoneSelect = document.getElementById('autoeq-headphone-select');
    const autoeqTargetSelect = document.getElementById('autoeq-target-select');
    const autoeqBandCount = document.getElementById('autoeq-band-count');
    const autoeqMaxFreq = document.getElementById('autoeq-max-freq');
    const autoeqSampleRate = document.getElementById('autoeq-sample-rate');
    const autoeqRunBtn = document.getElementById('autoeq-run-btn');
    const autoeqDownloadBtn = document.getElementById('autoeq-download-btn');
    const autoeqStatus = document.getElementById('autoeq-status');
    const autoeqTypeButtons = document.querySelectorAll('.autoeq-type-btn');
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

        const padLeft = 40, padRight = 10, padTop = 10, padBottom = 30;
        const w = rect.width - padLeft - padRight;
        const h = rect.height - padTop - padBottom;

        ctx.clearRect(0, 0, rect.width, rect.height);

        // dB scale: fixed 75dB center for AutoEQ, 0dB center for Parametric
        const isParametricMode = currentMode === 'parametric';
        const dbCenter = isParametricMode ? 0 : 75;
        const dbHalfRange = isParametricMode ? graphDbHalfParametric : graphDbHalfAutoEQ;
        const dbMin = dbCenter - dbHalfRange;
        const dbMax = dbCenter + dbHalfRange;
        const dbRange = dbMax - dbMin;

        // Helper mappings (local to graph area)
        const gx = (freq) => padLeft + freqToX(freq, w);
        const gy = (db) => padTop + dbToY(db, h, dbMin, dbMax);

        // Fixed curve colors (work across all themes)
        const gridColor = 'rgba(255,255,255,0.06)';
        const textColor = 'rgba(255,255,255,0.4)';
        const originalColor = '#3b82f6';       // Blue
        const targetColor = 'rgba(255,255,255,0.5)'; // White/gray dashed
        const correctedColor = '#f472b6';      // Pink

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
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
        };

        // Normalize all data to center around dbCenter
        const targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
        const targetEntry = TARGETS.find(t => t.id === targetId);
        const targetData = targetEntry?.data;

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
                const nodeColors = ['#f472b6','#fb923c','#facc15','#4ade80','#22d3ee','#818cf8','#c084fc','#f87171','#34d399','#60a5fa','#a78bfa','#fb7185','#fbbf24','#2dd4bf','#38bdf8','#a3e635'];

                // Draw individual band bell curves (filled)
                activeBands.forEach((band, i) => {
                    if (!band.enabled || Math.abs(band.gain) < 0.1) return;
                    const color = nodeColors[i % nodeColors.length];
                    const r = parseInt(color.slice(1,3), 16);
                    const g2 = parseInt(color.slice(3,5), 16);
                    const b2 = parseInt(color.slice(5,7), 16);

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
                        if (!started) { ctx.moveTo(bx, by); started = true; }
                        else ctx.lineTo(bx, by);
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
            // AutoEQ mode: draw measurement, target, corrected
            if (targetData) {
                const targetMidAvg = getNormalizationOffset(targetData);
                graphShift = dbCenter - targetMidAvg;
            } else if (autoeqSelectedMeasurement) {
                const measMidAvg = getNormalizationOffset(autoeqSelectedMeasurement);
                graphShift = dbCenter - measMidAvg;
            }

            // Draw Target curve (shifted)
            if (targetData) {
                const shiftedTarget = targetData.map(p => ({ freq: p.freq, gain: p.gain + graphShift }));
                drawCurve(shiftedTarget, targetColor, 1.5, true);
            }

            // Draw Original measurement (normalized + shifted)
            if (autoeqSelectedMeasurement) {
                const normOff = targetData ? getNormalizationOffset(targetData) - getNormalizationOffset(autoeqSelectedMeasurement) : 0;
                const normalized = autoeqSelectedMeasurement.map(p => ({ freq: p.freq, gain: p.gain + normOff + graphShift }));
                drawCurve(normalized, originalColor, 1.5);
            }

            // Draw Corrected curve (shifted)
            if (autoeqCorrectedCurve) {
                const shiftedCorrected = autoeqCorrectedCurve.map(p => ({ freq: p.freq, gain: p.gain + graphShift }));
                drawCurve(shiftedCorrected, correctedColor, 2);
            }
        }

        // Draw interactive nodes
        if (activeBands && activeBands.length > 0 && (autoeqCorrectedCurve || isParametricMode)) {
            const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;
            activeBands.forEach((band, i) => {
                if (!band.enabled) return;
                const x = gx(band.freq);
                // In parametric mode: node Y = band's individual response at its freq (basically its gain)
                // In AutoEQ mode: node Y = corrected curve value at band freq (shifted)
                let nodeGain;
                if (isParametricMode) {
                    // Sum all bands' response at this frequency
                    let totalGain = 0;
                    for (const b of activeBands) {
                        if (b.enabled) totalGain += calculateBiquadResponse(band.freq, b, sampleRate);
                    }
                    nodeGain = totalGain;
                } else {
                    nodeGain = interpolate(band.freq, autoeqCorrectedCurve) + graphShift;
                }
                const y = gy(nodeGain);

                // Draw node circle with unique color per band
                const nodeColors = ['#f472b6','#fb923c','#facc15','#4ade80','#22d3ee','#818cf8','#c084fc','#f87171','#34d399','#60a5fa','#a78bfa','#fb7185','#fbbf24','#2dd4bf','#38bdf8','#a3e635'];
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
                    const r2 = parseInt(nodeColor.slice(1,3), 16);
                    const g2 = parseInt(nodeColor.slice(3,5), 16);
                    const b2 = parseInt(nodeColor.slice(5,7), 16);
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

                // Show tooltip on drag
                if (isDragged) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(0,0,0,0.8)';
                    const txt = `${Math.round(band.freq)} Hz  ${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB  Q${band.q.toFixed(2)}`;
                    ctx.font = 'bold 11px system-ui, sans-serif';
                    const tw = ctx.measureText(txt).width + 12;
                    const tx = Math.min(x - tw / 2, rect.width - tw - 5);
                    const ty = y - 28;
                    ctx.fillRect(tx, ty, tw, 20);
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(txt, tx + tw / 2, ty + 10);
                    ctx.restore();
                }
            });
        }
    };

    /**
     * Compute corrected curve from measurement + bands
     */
    const computeCorrectedCurve = () => {
        if (!autoeqSelectedMeasurement || !autoeqCurrentBands) {
            autoeqCorrectedCurve = null;
            return;
        }
        const targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
        const targetEntry = TARGETS.find(t => t.id === targetId);
        const targetData = targetEntry?.data;
        const normOff = targetData ? getNormalizationOffset(targetData) - getNormalizationOffset(autoeqSelectedMeasurement) : 0;
        const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;

        autoeqCorrectedCurve = autoeqSelectedMeasurement.map(p => {
            let correction = 0;
            for (const band of autoeqCurrentBands) {
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
        const padLeft = 40, padRight = 10, padTop = 10, padBottom = 30;
        const w = rect.width - padLeft - padRight;
        const h = rect.height - padTop - padBottom;

        const dbCenter = isParam ? 0 : 75;
        const dbHalfRange = isParam ? graphDbHalfParametric : graphDbHalfAutoEQ;
        const dbMin = dbCenter - dbHalfRange;
        const dbMax = dbCenter + dbHalfRange;

        let graphShift = 0;
        if (!isParam) {
            const targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
            const targetEntry = TARGETS.find(t => t.id === targetId);
            const targetData = targetEntry?.data;
            if (targetData) graphShift = 75 - getNormalizationOffset(targetData);
            else if (autoeqSelectedMeasurement) graphShift = 75 - getNormalizationOffset(autoeqSelectedMeasurement);
        }

        const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;
        let closest = -1, closestDist = Infinity;
        activeBands.forEach((band, i) => {
            if (!band.enabled) return;
            const x = padLeft + freqToX(band.freq, w);
            let nodeGain;
            if (isParam) {
                nodeGain = 0;
                for (const b of activeBands) {
                    if (b.enabled) nodeGain += calculateBiquadResponse(band.freq, b, sampleRate);
                }
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
    let autoPreampEnabled = true;
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
            const coords = getCanvasCoords(e);
            const nodeIdx = findClosestNode(coords.x, coords.y, 18);
            if (nodeIdx >= 0) {
                draggedNode = nodeIdx;
                autoeqCanvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        autoeqCanvas.addEventListener('mousemove', (e) => {
            const coords = getCanvasCoords(e);
            const bands = getActiveBands();
            if (draggedNode !== null && bands) {
                const rect = autoeqCanvas.getBoundingClientRect();
                const padLeft = 40, padRight = 10, padTop = 10, padBottom = 30;
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

                computeCorrectedCurve();
                applyBandsToAudio(bands);
                if (!graphAnimFrame) {
                    graphAnimFrame = requestAnimationFrame(() => {
                        drawAutoEQGraph();
                        renderBandControls(bands);
                        graphAnimFrame = null;
                    });
                }
            } else {
                const padLeft = 40;
                if (coords.x <= padLeft + 10) {
                    autoeqCanvas.style.cursor = 'ns-resize';
                    if (hoveredNode !== null) { hoveredNode = null; drawAutoEQGraph(); }
                } else {
                    const newHovered = findClosestNode(coords.x, coords.y, 18);
                    if (newHovered !== hoveredNode) {
                        hoveredNode = newHovered;
                        autoeqCanvas.style.cursor = hoveredNode >= 0 ? 'grab' : 'crosshair';
                        drawAutoEQGraph();
                    }
                }
            }
        });

        autoeqCanvas.addEventListener('mouseup', () => {
            draggedNode = null;
            autoeqCanvas.style.cursor = hoveredNode >= 0 ? 'grab' : 'crosshair';
        });

        autoeqCanvas.addEventListener('mouseleave', () => {
            draggedNode = null;
            hoveredNode = null;
            autoeqCanvas.style.cursor = 'crosshair';
            drawAutoEQGraph();
        });

        autoeqCanvas.addEventListener('wheel', (e) => {
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
            if (hoveredNode >= 0 && wBands) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.15 : 0.15;
                wBands[hoveredNode].q = Math.max(0.1, Math.min(10, wBands[hoveredNode].q + delta));
                computeCorrectedCurve();
                applyBandsToAudio(wBands);
                drawAutoEQGraph();
                renderBandControls(wBands);
            }
        }, { passive: false });

        // Touch support
        let touchNodeIdx = -1;
        autoeqCanvas.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            const coords = { x: touch.clientX - autoeqCanvas.getBoundingClientRect().left, y: touch.clientY - autoeqCanvas.getBoundingClientRect().top };
            touchNodeIdx = findClosestNode(coords.x, coords.y, 25);
            if (touchNodeIdx >= 0) {
                draggedNode = touchNodeIdx;
                e.preventDefault();
            }
        }, { passive: false });

        autoeqCanvas.addEventListener('touchmove', (e) => {
            const tBands = getActiveBands();
            if (draggedNode !== null && tBands) {
                const touch = e.touches[0];
                const rect = autoeqCanvas.getBoundingClientRect();
                const coords = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
                const padLeft = 40, padRight = 10, padTop = 10, padBottom = 30;
                const w = rect.width - padLeft - padRight;
                const h = rect.height - padTop - padBottom;

                const freq = xToFreq(coords.x - padLeft, w);
                tBands[draggedNode].freq = Math.max(20, Math.min(20000, freq));

                if (currentMode === 'parametric') {
                    const newGain = yToDb(coords.y - padTop, h, -graphDbHalfParametric, graphDbHalfParametric);
                    tBands[draggedNode].gain = Math.max(-30, Math.min(30, Math.round(newGain * 10) / 10));
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
            }
        }, { passive: false });

        autoeqCanvas.addEventListener('touchend', () => {
            draggedNode = null;
            touchNodeIdx = -1;
        });

        // Resize observer for graph
        if (autoeqGraphWrapper) {
            const ro = new ResizeObserver(() => { drawAutoEQGraph(); });
            ro.observe(autoeqGraphWrapper);
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
            control.innerHTML = `
                <div class="autoeq-band-row">
                    <span class="autoeq-band-label">Freq (${band.type ? band.type.toUpperCase() : 'PEAKING'})</span>
                    <span class="autoeq-band-value autoeq-freq-val">${formatFreq(band.freq)} Hz</span>
                </div>
                <input type="range" class="autoeq-band-slider autoeq-freq-slider" min="20" max="20000" step="1" value="${Math.round(band.freq)}" />
                <div class="autoeq-band-row">
                    <span class="autoeq-band-label">Gain</span>
                    <span class="autoeq-band-value autoeq-gain-val">${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB</span>
                </div>
                <input type="range" class="autoeq-band-slider autoeq-gain-slider" min="-30" max="30" step="0.1" value="${band.gain.toFixed(1)}" />
                <div class="autoeq-band-row">
                    <span class="autoeq-band-label">Q-Factor</span>
                    <span class="autoeq-band-value autoeq-q-val">${band.q.toFixed(2)}</span>
                </div>
                <input type="range" class="autoeq-band-slider autoeq-q-slider" min="0.1" max="10" step="0.01" value="${band.q.toFixed(2)}" />
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
                drawAutoEQGraph();
            });

            gainSlider.addEventListener('input', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].gain = parseFloat(gainSlider.value);
                gainVal.textContent = `${bands[i].gain > 0 ? '+' : ''}${bands[i].gain.toFixed(1)} dB`;
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                drawAutoEQGraph();
            });

            qSlider.addEventListener('input', () => {
                const bands = getActiveBands();
                if (!bands || !bands[i]) return;
                bands[i].q = parseFloat(qSlider.value);
                qVal.textContent = bands[i].q.toFixed(2);
                computeCorrectedCurve();
                applyBandsToAudio(bands);
                drawAutoEQGraph();
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
                defaultBands.push({ id: i, type: 'peaking', freq: Math.round(freq), gain: 0, q: 1.0, enabled: true });
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
            if (savedGrid) savedGrid.style.display = autoeqSavedCollapse.classList.contains('collapsed') ? 'none' : 'flex';
        });
    }

    // Parametric EQ Filters collapse
    if (autoeqFiltersToggle) {
        autoeqFiltersToggle.addEventListener('click', () => {
            if (autoeqFiltersCollapse) autoeqFiltersCollapse.classList.toggle('collapsed');
            if (autoeqFiltersContent) autoeqFiltersContent.style.display = autoeqFiltersContent.style.display === 'none' ? 'flex' : 'none';
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
        if (rect.width === 0) return;

        canvas.width = rect.width * dpr;
        canvas.height = (rect.height || 60) * dpr;
        ctx.scale(dpr, dpr);
        const w = rect.width;
        const h = rect.height || 60;

        ctx.clearRect(0, 0, w, h);

        const drawMiniFill = (data, colors) => {
            if (!data || data.length < 2) return;
            const allGains = data.map(p => p.gain);
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
            preview.style.height = '60px';
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

            // Draw mini preview
            requestAnimationFrame(() => {
                drawMiniGraph(preview, profile.measurementData, profile.targetData, profile.correctedData);
            });
        });
    };

    // ========================================
    // Profile Save/Load
    // ========================================
    const saveAutoEQProfile = (name) => {
        if (!autoeqCurrentBands || !autoeqSelectedMeasurement) return;

        const targetId = autoeqTargetSelect ? autoeqTargetSelect.value : 'harman_oe_2018';
        const targetEntry = TARGETS.find(t => t.id === targetId);

        const profile = {
            id: 'autoeq_' + Date.now(),
            name: name || (autoeqSelectedEntry ? autoeqSelectedEntry.name : 'Custom'),
            headphoneName: autoeqSelectedEntry ? autoeqSelectedEntry.name : 'Custom',
            headphoneType: autoeqSelectedEntry ? autoeqSelectedEntry.type : 'over-ear',
            targetId,
            targetLabel: targetEntry ? targetEntry.label : targetId,
            bandCount: autoeqCurrentBands.length,
            maxFreq: autoeqMaxFreq ? parseInt(autoeqMaxFreq.value, 10) : 16000,
            sampleRate: autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000,
            bands: autoeqCurrentBands.map(b => ({ ...b })),
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

        autoeqCurrentBands = profile.bands.map(b => ({ ...b }));
        autoeqCorrectedCurve = profile.correctedData ? [...profile.correctedData] : null;
        autoeqSelectedMeasurement = profile.measurementData ? [...profile.measurementData] : null;
        autoeqSelectedEntry = { name: profile.headphoneName, type: profile.headphoneType };

        // Update UI selects
        if (autoeqTargetSelect) autoeqTargetSelect.value = profile.targetId || 'harman_oe_2018';
        if (autoeqBandCount) autoeqBandCount.value = profile.bandCount || 10;
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
    // Type Filter Buttons
    // ========================================
    autoeqTypeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            autoeqTypeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            autoeqTypeFilter = btn.dataset.type;
            // Re-filter
            if (_autoeqIndex.length > 0) {
                const query = autoeqSearchInput ? autoeqSearchInput.value.trim() : '';
                const results = query
                    ? searchHeadphones(query, _autoeqIndex, autoeqTypeFilter, 500)
                    : (autoeqTypeFilter === 'all' ? _autoeqIndex : _autoeqIndex.filter(e => e.type === autoeqTypeFilter));
                resetDatabaseList(results);
            }
        });
    });

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
            autoeqDatabaseList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--muted-foreground); font-size: 0.8rem;">No results found</div>';
            return;
        }

        // Group by base model name (strip source suffix like "(crinacle)")
        const modelMap = new Map();
        entries.forEach(entry => {
            const baseName = entry.name.replace(/\s*\([^)]*\)\s*$/, '').trim() || entry.name;
            if (!modelMap.has(baseName)) {
                modelMap.set(baseName, []);
            }
            modelMap.get(baseName).push(entry);
        });

        modelMap.forEach((variants, name) => {
            const wrapper = document.createElement('div');
            const firstLetter = name[0]?.toUpperCase() || '?';
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

                variants.forEach(entry => {
                    const subItem = document.createElement('div');
                    subItem.className = 'autoeq-db-sub-item';
                    // Extract source from parentheses
                    const sourceMatch = entry.name.match(/\(([^)]+)\)\s*$/);
                    const source = sourceMatch ? sourceMatch[1] : entry.type;
                    subItem.innerHTML = `<span>${entry.name}</span><span class="sub-source">${source}</span>`;
                    subItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        loadHeadphoneEntry(entry);
                    });
                    subList.appendChild(subItem);
                });

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
        letters.forEach(letter => {
            const btn = document.createElement('button');
            btn.textContent = letter;
            btn.addEventListener('click', () => {
                // Find the index of the first entry starting with this letter
                const targetIdx = _dbFilteredEntries.findIndex(e => {
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
            } catch (err) {
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

                const results = searchHeadphones(query, _autoeqIndex, autoeqTypeFilter, 500);
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
                    const targetEntry = TARGETS.find(t => t.id === targetId);
                    if (!targetEntry || !targetEntry.data || targetEntry.data.length === 0) {
                        setAutoEQStatus('Invalid target curve', 'error');
                        autoeqRunBtn.disabled = false;
                        return;
                    }

                    const bandCount = autoeqBandCount ? parseInt(autoeqBandCount.value, 10) : 10;
                    const maxFreq = autoeqMaxFreq ? parseInt(autoeqMaxFreq.value, 10) : 16000;
                    const sampleRate = autoeqSampleRate ? parseInt(autoeqSampleRate.value, 10) : 48000;

                    const bands = runAutoEqAlgorithm(autoeqSelectedMeasurement, targetEntry.data, bandCount, maxFreq, 20, 5.0, sampleRate);

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
                } catch (err) {
                    setAutoEQStatus('Failed to parse file', 'error');
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
                lines.push(`Filter ${i + 1}: ON ${type} Fc ${Math.round(band.freq)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q.toFixed(2)}`);
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
                    const maxGain = Math.max(0, ...bands.filter(b => b.enabled).map(b => b.gain));
                    const autoPreamp = maxGain > 0 ? -Math.round(maxGain * 10) / 10 : 0;
                    currentPreamp = autoPreamp;
                    equalizerSettings.setPreamp(autoPreamp);
                    if (audioContextManager.setPreamp) audioContextManager.setPreamp(autoPreamp);
                    if (eqPreampSlider) eqPreampSlider.value = autoPreamp;
                    if (autoeqPreampValue) autoeqPreampValue.textContent = `${autoPreamp} dB`;
                }
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
    // Mode Toggle: AutoEQ vs Parametric EQ
    // ========================================
    const modeButtons = document.querySelectorAll('.autoeq-mode-btn');
    let currentMode = 'autoeq';

    const setEQMode = (mode) => {
        currentMode = mode;
        modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

        const graphSection = document.querySelector('.autoeq-graph-section');
        const controlsSection = document.querySelector('.autoeq-controls-section');
        const savedSection = document.getElementById('autoeq-saved-section');
        const databaseSection = document.getElementById('autoeq-database-section');
        const filtersSection = document.getElementById('autoeq-filters-section');
        const filtersContent = document.getElementById('autoeq-filters-content');
        const presetRow = document.getElementById('autoeq-preset-row');
        const parametricProfiles = document.getElementById('autoeq-parametric-profiles');

        // Reset interactive state on switch
        draggedNode = null;
        hoveredNode = null;

        // Graph always visible in both modes
        if (graphSection) graphSection.style.display = '';

        if (mode === 'autoeq') {
            if (controlsSection) controlsSection.style.display = '';
            if (savedSection) savedSection.style.display = '';
            if (databaseSection) databaseSection.style.display = '';
            if (filtersSection) filtersSection.style.display = '';
            if (presetRow) presetRow.style.display = 'none';
            if (parametricProfiles) parametricProfiles.style.display = 'none';

            // Restore AutoEQ bands to audio engine
            if (autoeqCurrentBands && autoeqCurrentBands.length > 0) {
                applyBandsToAudio(autoeqCurrentBands);
                renderBandControls(autoeqCurrentBands);
            }
            drawAutoEQGraph();
        } else {
            // Parametric EQ only
            if (controlsSection) controlsSection.style.display = 'none';
            if (savedSection) savedSection.style.display = 'none';
            if (databaseSection) databaseSection.style.display = 'none';
            if (filtersSection) filtersSection.style.display = '';
            if (filtersContent) filtersContent.style.display = 'flex';
            if (autoeqFiltersCollapse) autoeqFiltersCollapse.classList.remove('collapsed');
            if (presetRow) presetRow.style.display = '';
            if (parametricProfiles) parametricProfiles.style.display = '';

            // Ensure parametric bands exist (separate from autoeq bands)
            if (!parametricBands || parametricBands.length === 0) {
                const defaultBands = [];
                for (let i = 0; i < 10; i++) {
                    const freq = 20 * Math.pow(20000 / 20, i / 9);
                    defaultBands.push({ id: i, type: 'peaking', freq: Math.round(freq), gain: 0, q: 1.0, enabled: true });
                }
                parametricBands = defaultBands;
            }
            // Apply parametric bands to audio engine
            applyBandsToAudio(parametricBands);
            renderBandControls(parametricBands);
            renderParametricProfiles();
            drawAutoEQGraph();
        }
    };

    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => setEQMode(btn.dataset.mode));
    });

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
    const parametricPresetSelect = document.getElementById('parametric-preset-select');
    if (parametricPresetSelect) {
        parametricPresetSelect.addEventListener('change', () => {
            const presetKey = parametricPresetSelect.value;
            if (!presetKey) return; // "Custom" selected

            ensureParametricBands();
            const bandCount = parametricBands.length;
            const presets = getPresetsForBandCount(bandCount);
            const preset = presets[presetKey];
            if (!preset) return;

            parametricBands.forEach((band, i) => {
                band.gain = preset.gains[i] || 0;
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
        try { return JSON.parse(localStorage.getItem(PARAMETRIC_PROFILES_KEY)) || {}; }
        catch { return {}; }
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

        keys.forEach(id => {
            const profile = profiles[id];
            const card = document.createElement('div');
            card.className = 'autoeq-profile-card' + (id === activeId ? ' active' : '');
            card.dataset.profileId = id;

            const preview = document.createElement('canvas');
            preview.className = 'autoeq-profile-preview';
            preview.style.height = '60px';
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
                parametricBands = profile.bands.map(b => ({ ...b }));
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
                if (!preview || !profile.bands) return;
                const ctx = preview.getContext('2d');
                const dpr = window.devicePixelRatio || 1;
                const rect = preview.getBoundingClientRect();
                if (rect.width === 0) return;
                preview.width = rect.width * dpr;
                preview.height = 60 * dpr;
                ctx.scale(dpr, dpr);
                const pw = rect.width, ph = 60;
                ctx.clearRect(0, 0, pw, ph);

                const sampleRate = 48000;
                const nodeColors = ['#f472b6','#fb923c','#facc15','#4ade80','#22d3ee','#818cf8','#c084fc','#f87171','#34d399','#60a5fa'];

                profile.bands.forEach((band, bi) => {
                    if (!band.enabled || Math.abs(band.gain) < 0.1) return;
                    const color = nodeColors[bi % nodeColors.length];
                    ctx.beginPath();
                    for (let f = 20; f <= 20000; f *= 1.04) {
                        const resp = calculateBiquadResponse(f, band, sampleRate);
                        const x = freqToX(f, pw);
                        const y = ph / 2 - (resp / 30) * (ph / 2) * 0.8;
                        if (f <= 21) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                    }
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.6;
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                });

                // Combined curve
                ctx.beginPath();
                for (let f = 20; f <= 20000; f *= 1.04) {
                    let total = 0;
                    for (const b of profile.bands) { if (b.enabled) total += calculateBiquadResponse(f, b, sampleRate); }
                    const x = freqToX(f, pw);
                    const y = ph / 2 - (total / 30) * (ph / 2) * 0.8;
                    if (f <= 21) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 2;
                ctx.stroke();
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
                bands: parametricBands.map(b => ({ ...b })),
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
                lines.push(`Filter ${i + 1}: ON ${ft} Fc ${Math.round(band.freq)} Hz Gain ${band.gain.toFixed(1)} dB Q ${band.q.toFixed(2)}`);
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
                        if (preampMatch) { preamp = parseFloat(preampMatch[1]); continue; }
                        const filterMatch = line.match(/Filter\s+\d+:\s*ON\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+([-\d.]+)\s*dB\s+Q\s+([\d.]+)/i);
                        if (filterMatch) {
                            const typeMap = { PK: 'peaking', LS: 'lowshelf', HS: 'highshelf' };
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
    // Add/Remove/Reset Band Buttons
    // ========================================
    const addBandBtn = document.getElementById('autoeq-add-band-btn');
    const removeBandBtn = document.getElementById('autoeq-remove-band-btn');
    const resetBandsBtn = document.getElementById('autoeq-reset-bands-btn');

    if (addBandBtn) {
        addBandBtn.addEventListener('click', () => {
            let bands = getActiveBands();
            if (!bands) { bands = []; setActiveBands(bands); }
            if (bands.length >= 32) return;
            bands.push({ id: bands.length, type: 'peaking', freq: 1000, gain: 0, q: 1.0, enabled: true });
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
            bands.forEach(b => { b.gain = 0; });
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

            audioContextManager.toggleEQ(enabled);
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
    loadFullDatabase();

    // Initial draw of graph (if EQ is enabled)
    if (equalizerSettings.isEnabled()) {
        requestAnimationFrame(drawAutoEQGraph);
    }

    // Load active profile on startup
    const activeProfileId = equalizerSettings.getActiveAutoEQProfile();
    if (activeProfileId) {
        const profiles = equalizerSettings.getAutoEQProfiles();
        if (profiles[activeProfileId]) {
            // Restore state silently
            const profile = profiles[activeProfileId];
            autoeqCurrentBands = profile.bands?.map(b => ({ ...b })) || null;
            autoeqCorrectedCurve = profile.correctedData ? [...profile.correctedData] : null;
            autoeqSelectedMeasurement = profile.measurementData ? [...profile.measurementData] : null;
            autoeqSelectedEntry = { name: profile.headphoneName, type: profile.headphoneType };
            if (autoeqTargetSelect) autoeqTargetSelect.value = profile.targetId || 'harman_oe_2018';
            if (autoeqBandCount) autoeqBandCount.value = profile.bandCount || 10;
            if (autoeqMaxFreq) autoeqMaxFreq.value = profile.maxFreq || 16000;
            if (autoeqSampleRate) autoeqSampleRate.value = profile.sampleRate || 48000;
            if (autoeqRunBtn) autoeqRunBtn.disabled = false;
            if (autoeqCurrentBands) renderBandControls(autoeqCurrentBands);
            requestAnimationFrame(drawAutoEQGraph);
        }
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
    fontGoogleApply.addEventListener('click', () => {
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
