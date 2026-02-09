// js/accounts/auth.js
import { auth, provider } from './config.js';
import {
    signInWithPopup,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

export class AuthManager {
    constructor() {
        this.user = null;
        this.unsubscribe = null;
        this.authListeners = [];
        this.init();
    }

    init() {
        if (!auth) return;

        this.unsubscribe = onAuthStateChanged(auth, (user) => {
            this.user = user;
            this.updateUI(user);

            this.authListeners.forEach((listener) => listener(user));
        });
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        // If we already have a user state, trigger immediately
        if (this.user !== null) {
            callback(this.user);
        }
    }

    async signInWithGoogle() {
        if (!auth) {
            alert('Firebase is not configured. Please check console.');
            return;
        }

        try {
            const result = await signInWithPopup(auth, provider);
            // The onAuthStateChanged listener will handle the rest
            return result.user;
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
            throw error;
        }
    }

    async signInWithEmail(email, password) {
        if (!auth) {
            alert('Firebase is not configured.');
            return;
        }
        try {
            const result = await signInWithEmailAndPassword(auth, email, password);
            return result.user;
        } catch (error) {
            console.error('Email Login failed:', error);
            alert(`Login failed: ${error.message}`);
            throw error;
        }
    }

    async signUpWithEmail(email, password) {
        if (!auth) {
            alert('Firebase is not configured.');
            return;
        }
        try {
            const result = await createUserWithEmailAndPassword(auth, email, password);
            return result.user;
        } catch (error) {
            console.error('Sign Up failed:', error);
            alert(`Sign Up failed: ${error.message}`);
            throw error;
        }
    }

    async sendPasswordReset(email) {
        if (!auth) {
            alert('Firebase is not configured.');
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            alert(`Password reset email sent to ${email}`);
        } catch (error) {
            console.error('Password reset failed:', error);
            alert(`Failed to send reset email: ${error.message}`);
            throw error;
        }
    }

    async signOut() {
        if (!auth) return;

        try {
            await firebaseSignOut(auth);
            if (window.__AUTH_GATE__) {
                try {
                    await fetch('/api/auth/logout', { method: 'POST' });
                } catch (_) {
                    // Server endpoint may not exist in dev mode
                }
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Logout failed:', error);
            throw error;
        }
    }

    updateUI(user) {
        const connectBtn = document.getElementById('firebase-connect-btn');
        const clearDataBtn = document.getElementById('firebase-clear-cloud-btn');
        const statusText = document.getElementById('firebase-status');
        const emailContainer = document.getElementById('email-auth-container');
        const emailToggleBtn = document.getElementById('toggle-email-auth-btn');

        if (!connectBtn) return; // UI might not be rendered yet

        // Auth gate active: strip down to status + sign out only
        if (window.__AUTH_GATE__) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();
            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailContainer) emailContainer.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'none';
            if (statusText) statusText.textContent = user ? `Signed in as ${user.email}` : 'Signed in';

            // Account page: clean up unnecessary text
            const accountPage = document.getElementById('page-account');
            if (accountPage) {
                const title = accountPage.querySelector('.section-title');
                if (title) title.textContent = 'Account';
                // Hide description + privacy paragraphs, keep only status
                accountPage.querySelectorAll('.account-content > p, .account-content > div').forEach((el) => {
                    if (el.id !== 'firebase-status' && el.id !== 'auth-buttons-container') {
                        el.style.display = 'none';
                    }
                });
            }

            // Settings page: hide custom DB/Auth config
            const customDbBtn = document.getElementById('custom-db-btn');
            if (customDbBtn) {
                const settingItem = customDbBtn.closest('.setting-item');
                if (settingItem) settingItem.style.display = 'none';
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

            if (statusText) statusText.textContent = `Signed in as ${user.email}`;
        } else {
            connectBtn.textContent = 'Connect with Google';
            connectBtn.classList.remove('danger');
            connectBtn.onclick = () => this.signInWithGoogle();

            if (clearDataBtn) clearDataBtn.style.display = 'none';
            if (emailToggleBtn) emailToggleBtn.style.display = 'inline-block';

            if (statusText) statusText.textContent = 'Sync your library across devices';
        }
    }
}

export const authManager = new AuthManager();
