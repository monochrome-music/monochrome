// js/accounts/auth.js
import { pb } from './config.js';

export class AuthManager {
    constructor() {
        this.user = null;
        this.authListeners = [];
        this.init();
    }

    async init() {
        // PocketBase handles persistence automatically via pb.authStore.
        // We just need to check if we are logged in.
        if (pb.authStore.isValid) {
            this.user = {
                $id: pb.authStore.model.id,
                email: pb.authStore.model.email,
                name: pb.authStore.model.name || pb.authStore.model.username
            };
            this.updateUI(this.user);
            this.notifyListeners(this.user);
        } else {
            // Handle OAuth2 callback if we are coming back from Google
            const params = new URLSearchParams(window.location.search);
            if (params.has('oauth')) {
                // PocketBase doesn't strictly need us to do anything here if using popups,
                // but if using redirects, we'd handle it. 
                // For now, let's assume we're using the standard flow.
                window.history.replaceState({}, '', window.location.pathname);
            }
            this.updateUI(null);
        }
        
        // Listen to auth changes (login/logout from other tabs or same tab)
        pb.authStore.onChange((token, model) => {
            if (model) {
                this.user = {
                    $id: model.id,
                    email: model.email,
                    name: model.name || model.username
                };
            } else {
                this.user = null;
            }
            this.updateUI(this.user);
            this.notifyListeners(this.user);
        }, true);
    }

    notifyListeners(user) {
        this.authListeners.forEach((listener) => listener(user));
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        if (this.user !== null) {
            callback(this.user);
        }
    }

    async signInWithGoogle() {
        try {
            // This will redirect to Google
            await pb.collection('users').authWithOAuth2({ provider: 'google' });
            // After successful login, the authStore is updated automatically
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
        }
    }

    async signInWithGitHub() {
        try {
            await pb.collection('users').authWithOAuth2({ provider: 'github' });
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
        }
    }

    async signInWithDiscord() {
        try {
            await pb.collection('users').authWithOAuth2({ provider: 'discord' });
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
        }
    }

    async signInWithEmail(email, password) {
        try {
            const authData = await pb.collection('users').authWithPassword(email, password);
            return authData.record;
        } catch (error) {
            console.error('Email Login failed:', error);
            alert(`Login failed: ${error.message}`);
            throw error;
        }
    }

    async signUpWithEmail(email, password) {
        try {
            await pb.collection('users').create({
                email,
                password,
                passwordConfirm: password,
            });
            return await this.signInWithEmail(email, password);
        } catch (error) {
            console.error('Sign Up failed:', error);
            alert(`Sign Up failed: ${error.message}`);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        try {
            await pb.collection('users').requestPasswordReset(email);
            alert(`Password reset email sent to ${email}`);
        } catch (error) {
            console.error('Password reset failed:', error);
            alert(`Failed to send reset email: ${error.message}`);
            throw error;
        }
    }

    async signOut() {
        try {
            pb.authStore.clear();
            this.user = null;
            this.updateUI(null);
            this.notifyListeners(null);

            if (window.__AUTH_GATE__) {
                window.location.href = '/login';
            } else {
                window.location.reload();
            }
        } catch (error) {
            console.error('Logout failed:', error);
            throw error;
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
            
            // Hide custom DB button if it's already set from environment
            const customDbBtn = document.getElementById('custom-db-btn');
            if (customDbBtn && window.__POCKETBASE_URL__) {
                const settingItem = customDbBtn.closest('.setting-item');
                if (settingItem) settingItem.style.display = 'none';
            }
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
