// js/accounts/auth.js
import { AUTH_BASE_URL, authClient } from './config.js';

const LEGACY_AUTH_TOKEN_KEY = 'monochrome-auth-token';
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
        this.init().catch(console.error);
    }

    async init() {
        const params = new URLSearchParams(window.location.search);
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

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        if (this.user !== null) {
            callback(this.user);
        }
    }

    async _signInSocial(provider) {
        try {
            const callbackURL = window.location.origin + '/index.html';
            const errorCallbackURL = window.location.origin + '/index.html';

            const isCapacitorNative = !!(window.Capacitor
                && window.Capacitor.getPlatform
                && window.Capacitor.getPlatform() !== 'web');

            if (isCapacitorNative) {
                const res = await fetch(`${AUTH_BASE_URL}/api/auth/sign-in/social`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, callbackURL, errorCallbackURL }),
                    credentials: 'include',
                });
                const data = await res.json();
                if (data.url && data.redirect) {
                    window.open(data.url, '_system');
                    return;
                }
                if (data.error) {
                    throw new Error(data.error.message || 'OAuth URL fetch failed');
                }
                throw new Error('Unexpected response from auth server');
            }

            await authClient.signIn.social({
                provider,
                callbackURL,
                errorCallbackURL,
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
