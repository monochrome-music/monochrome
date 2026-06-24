// js/accounts/auth.js
import { AUTH_BASE_URL, authClient } from './config.js';

const LEGACY_AUTH_TOKEN_KEY = 'monochrome-auth-token';
const NATIVE_OAUTH_SCHEME = 'monochrome';
const NATIVE_OAUTH_HOST = 'auth-callback';
let authToken = '';

function normalizeUser(user) {
    if (!user) return null;
    return { ...user, $id: user.id };
}

export function getAuthToken() {
    return authToken;
}

function storeAuthToken(token) {
    authToken = token || '';
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
}

function clearAuthToken() {
    authToken = '';
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
}

function isCapacitorNative() {
    return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web');
}

function getCapacitorPlugin(name) {
    return window.Capacitor?.Plugins?.[name];
}

async function getBrowserPlugin() {
    const plugin = getCapacitorPlugin('Browser');
    if (plugin?.open) return plugin;

    try {
        const { Browser } = await import('@capacitor/browser');
        return Browser;
    } catch {
        return plugin;
    }
}

async function getAppPlugin() {
    const plugin = getCapacitorPlugin('App');
    if (plugin?.addListener) return plugin;

    try {
        const { App } = await import('@capacitor/app');
        return App;
    } catch {
        return plugin;
    }
}

function getNativeOAuthCallbackURL() {
    return `${AUTH_BASE_URL}/api/native/oauth/callback`;
}

function getOAuthParams(urlString = window.location.href) {
    let url;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }

    const params = new URLSearchParams(url.search);
    if (!params.size && url.hash?.startsWith('#')) {
        const hashParams = new URLSearchParams(url.hash.slice(1));
        if (hashParams.size) return hashParams;
    }
    return params;
}

function hasOAuthParams(params) {
    return !!(params && (params.has('oauth') || params.has('userId') || params.has('secret') || params.has('error')));
}

function getErrorMessage(data, fallback) {
    if (data?.error?.message) return data.error.message;
    if (typeof data?.error === 'string') return data.error;
    if (data?.message) return data.message;
    if (typeof data === 'string' && data.trim()) return data;
    return fallback;
}

function findOAuthUrl(data, response) {
    const candidates = [
        data?.url,
        data?.data?.url,
        data?.redirectURL,
        data?.redirectUrl,
        data?.data?.redirectURL,
        data?.data?.redirectUrl,
        response?.redirected ? response.url : null,
    ];

    return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
}

async function readAuthResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();

    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
async function openNativeOAuthUrl(url) {
    const Browser = await getBrowserPlugin();
    if (Browser?.open) {
        await Browser.open({ url, presentationStyle: 'fullscreen' });
        return;
    }

    const opened = window.open(url, '_system');
    if (!opened) {
        window.location.href = url;
    }
}

async function closeNativeOAuthBrowser() {
    try {
        await (await getBrowserPlugin())?.close?.();
    } catch {
        // Browser.close throws on Android when no custom tab is active.
    }
}

async function getSessionFromBearerToken() {
    const token = getAuthToken();
    if (!token) return null;

    const response = await fetch(`${AUTH_BASE_URL}/api/me`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
        clearAuthToken();
        return null;
    }
    if (!response.ok) throw new Error(`Session check failed: ${response.status}`);
    return response.json();
}

export class AuthManager {
    constructor() {
        this.user = null;
        this.authListeners = [];
        this.setupNativeOAuthListener().catch(console.error);
        this.init().catch(console.error);
    }

    async init() {
        const params = getOAuthParams();
        if (params.has('oauth') || params.has('userId') || params.has('secret')) {
            if (params.has('secret')) {
                storeAuthToken(params.get('secret'));
            }
            window.history.replaceState({}, '', window.location.pathname);
        }

        try {
            const { data: session } = await authClient.getSession();
            const resolvedSession = session?.user ? session : await getSessionFromBearerToken();
            this.user = normalizeUser(resolvedSession?.user);
            this.updateUI(this.user);
            this.authListeners.forEach((listener) => listener(this.user));
        } catch (err) {
            try {
                const session = await getSessionFromBearerToken();
                this.user = normalizeUser(session?.user);
                this.updateUI(this.user);
                this.authListeners.forEach((listener) => listener(this.user));
            } catch (fallbackErr) {
                console.warn('Session check failed:', fallbackErr || err);
                this.user = null;
                this.updateUI(null);
            }
        }
    }

    async setupNativeOAuthListener() {
        if (!isCapacitorNative()) return;

        const App = await getAppPlugin();
        if (!App?.addListener) return;

        App.addListener('appUrlOpen', (event) => {
            this.handleNativeOAuthCallback(event?.url);
        });

        const launchEvent = await App.getLaunchUrl?.();
        if (launchEvent?.url) this.handleNativeOAuthCallback(launchEvent.url);
    }

    handleNativeOAuthCallback(url) {
        const params = getOAuthParams(url);
        if (!hasOAuthParams(params)) return false;

        closeNativeOAuthBrowser();

        const target = new URL('/index.html', window.location.href);
        target.search = params.toString();
        window.location.href = target.toString();
        return true;
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        if (this.user !== null) {
            callback(this.user);
        }
    }

    async _signInSocial(provider) {
        try {
            const isNative = isCapacitorNative();
            const callbackURL = isNative ? getNativeOAuthCallbackURL() : window.location.origin + '/index.html';
            const errorCallbackURL = callbackURL;

            if (isNative) {
                const res = await fetch(`${AUTH_BASE_URL}/api/auth/sign-in/social`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, callbackURL, errorCallbackURL, disableRedirect: true }),
                    credentials: 'include',
                });
                const data = await readAuthResponse(res);
                const oauthUrl = findOAuthUrl(data, res);
                if (oauthUrl) {
                    await openNativeOAuthUrl(oauthUrl);
                    return;
                }
                if (!res.ok || data?.error || data?.message) {
                    throw new Error(getErrorMessage(data, `OAuth URL fetch failed (${res.status})`));
                }
                throw new Error(`Unexpected response from auth server: ${JSON.stringify(data)}`);
            }

            await authClient.signIn.social({
                provider,
                callbackURL: window.location.origin + '/index.html',
                errorCallbackURL: window.location.origin + '/index.html',
            });
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
        }
    }

    async signInWithGoogle() {
        return this._signInSocial('google');
    }
    async signInWithGitHub() {
        return this._signInSocial('github');
    }
    async signInWithDiscord() {
        return this._signInSocial('discord');
    }

    async signInWithEmail(email, password) {
        try {
            const { data, error } = await authClient.signIn.email({ email, password });
            if (error) throw new Error(error.message);

            storeAuthToken(data?.token);
            this.user = normalizeUser(data.user);
            this.updateUI(this.user);
            this.authListeners.forEach((listener) => listener(this.user));
            return this.user;
        } catch (error) {
            console.error('Email Login failed:', error);
            alert(`Login failed: ${error.message}`);
            throw error;
        }
    }

    async signUpWithEmail(email, password) {
        try {
            const { data, error } = await authClient.signUp.email({
                email,
                password,
                name: email.split('@')[0],
            });
            if (error) throw new Error(error.message);

            storeAuthToken(data?.token);
            this.user = normalizeUser(data.user);
            this.updateUI(this.user);
            this.authListeners.forEach((listener) => listener(this.user));
            return this.user;
        } catch (error) {
            console.error('Sign Up failed:', error);
            alert(`Sign Up failed: ${error.message}`);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        try {
            const { error } = await authClient.requestPasswordReset({
                email,
                redirectTo: window.location.origin + '/reset-password',
            });
            if (error) throw new Error(error.message);
            alert(`Password reset email sent to ${email}`);
        } catch (error) {
            console.error('Password reset failed:', error);
            alert(`Failed to send reset email: ${error.message}`);
            throw error;
        }
    }

    async resetPassword(token, password, confirmPassword) {
        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }
        try {
            const { error } = await authClient.resetPassword({ newPassword: password, token });
            if (error) throw new Error(error.message);
        } catch (error) {
            console.error('Password reset failed:', error);
            throw error;
        }
    }

    async signOut() {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Remote logout failed:', error);
        } finally {
            clearAuthToken();
            this.user = null;
            this.updateUI(null);
            this.authListeners.forEach((listener) => listener(null));

            if (window.__AUTH_GATE__) {
                window.location.href = '/login';
            } else {
                window.location.reload();
            }
        }
    }

    updateUI(user) {
        const connectBtn = document.getElementById('auth-connect-btn');
        const clearDataBtn = document.getElementById('auth-clear-cloud-btn');
        const statusText = document.getElementById('auth-status');
        const emailContainer = document.getElementById('email-auth-container');
        const emailToggleBtn = document.getElementById('toggle-email-auth-btn');
        const githubBtn = document.getElementById('auth-github-btn');
        const discordBtn = document.getElementById('auth-discord-btn');

        if (!connectBtn) return;

        if (window.__AUTH_GATE__) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = user ? `Signed in as ${user.email}` : 'Signed in';

            const accountPage = document.getElementById('page-account');
            if (accountPage) {
                const title = accountPage.querySelector('.section-title');
                if (title) title.textContent = 'Account';
                accountPage.querySelectorAll('.account-content > p, .account-content > div').forEach((el) => {
                    if (el.id !== 'auth-status' && el.id !== 'auth-buttons-container') {
                        el.style.display = 'none';
                    }
                });
            }

            const customDbBtn = document.getElementById('custom-db-btn');
            if (customDbBtn) {
                const pbFromEnv = !!window.__POCKETBASE_URL__;
                if (pbFromEnv) {
                    const settingItem = customDbBtn.closest('.setting-item');
                    if (settingItem) settingItem.style.display = 'none';
                }
            }

            return;
        }

        if (user) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();

            if (clearDataBtn) clearDataBtn.style.display = 'block';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (githubBtn) githubBtn.style.display = 'none';
            if (discordBtn) discordBtn.style.display = 'none';
            if (statusText) statusText.textContent = `Signed in as ${user.email}`;
        } else {
            connectBtn.textContent = 'Connect with Google';
            connectBtn.classList.remove('danger');
            connectBtn.onclick = () => this.signInWithGoogle();

            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'inline-block';
            if (githubBtn) {
                githubBtn.style.display = 'inline-block';
                githubBtn.onclick = () => this.signInWithGitHub();
            }
            if (discordBtn) {
                discordBtn.style.display = 'inline-block';
                discordBtn.onclick = () => this.signInWithDiscord();
            }
            if (statusText) statusText.textContent = 'Sync your library across devices';
        }
    }
}

export const authManager = new AuthManager();
