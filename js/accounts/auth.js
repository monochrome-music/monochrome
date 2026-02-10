// js/accounts/auth.js
import { auth, provider } from './config.js';
import {
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
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

        // Handle redirect result (for Linux/Mobile where popup might be blocked)
        getRedirectResult(auth).catch((error) => {
            console.error('Redirect Login failed:', error);
            alert(`Login failed: ${error.message}`);
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

            if (result.user) {
                console.log('Login successful:', result.user.email);
                this.user = result.user;
                this.updateUI(result.user);
                this.authListeners.forEach((listener) => listener(result.user));
                return result.user;
            }
        } catch (error) {
            console.error('Login failed:', error);

            // On Linux, if popup is blocked or fails, we might be forced to redirect,
            // but we've seen it "bug the app", so we alert the user first.
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
                if (
                    confirm(
                        'The login popup was blocked or failed to communicate. Would you like to try a redirect instead? Note: This may reload the application.'
                    )
                ) {
                    try {
                        await signInWithRedirect(auth, provider);
                        return;
                    } catch (redirectError) {
                        console.error('Redirect fallback failed:', redirectError);
                        alert(`Login failed: ${redirectError.message}`);
                    }
                }
            } else {
                alert(`Login failed: ${error.message}`);
            }
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
                } catch {
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

            // Settings page: hide custom DB/Auth config when fully server-configured
            const customDbBtn = document.getElementById('custom-db-btn');
            if (customDbBtn) {
                const fbFromEnv = !!window.__FIREBASE_CONFIG__;
                const pbFromEnv = !!window.__POCKETBASE_URL__;
                if (fbFromEnv && pbFromEnv) {
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
