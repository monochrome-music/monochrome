// js/firebase/auth.js
import { auth, provider } from './config.js';
import { signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { syncManager } from './sync.js';

export class AuthManager {
    constructor() {
        this.user = null;
        this.unsubscribe = null;
        this.init();
    }

    init() {
        if (!auth) return;

        this.unsubscribe = onAuthStateChanged(auth, (user) => {
            this.user = user;
            this.updateUI(user);
            
            if (user) {
                console.log("User logged in:", user.uid);
                syncManager.initialize(user);
            } else {
                console.log("User logged out");
                syncManager.disconnect();
            }
        });
    }

    async signInWithGoogle() {
        if (!auth) {
            alert("Firebase is not configured. Please check console.");
            return;
        }

        try {
            const result = await signInWithPopup(auth, provider);
            // The onAuthStateChanged listener will handle the rest
            return result.user;
        } catch (error) {
            console.error("Login failed:", error);
            alert(`Login failed: ${error.message}`);
            throw error;
        }
    }

    async signOut() {
        if (!auth) return;

        try {
            await firebaseSignOut(auth);
            // The onAuthStateChanged listener will handle the rest
        } catch (error) {
            console.error("Logout failed:", error);
            throw error;
        }
    }

    updateUI(user) {
        const connectBtn = document.getElementById('firebase-connect-btn');
        const statusText = document.getElementById('firebase-status');
        const userAvatar = document.getElementById('firebase-user-avatar');
        const userName = document.getElementById('firebase-user-name');
        const container = document.getElementById('firebase-controls');

        if (!connectBtn) return; // UI might not be rendered yet

        if (user) {
            connectBtn.textContent = 'Sign Out';
            connectBtn.classList.add('danger');
            connectBtn.onclick = () => this.signOut();
            
            if (statusText) statusText.textContent = `Signed in as ${user.email}`;
            
            // Optional: Show user info if elements exist
            if (userAvatar && user.photoURL) userAvatar.src = user.photoURL;
            if (userName) userName.textContent = user.displayName;

        } else {
            connectBtn.textContent = 'Connect with Google';
            connectBtn.classList.remove('danger');
            connectBtn.onclick = () => this.signInWithGoogle();
            
            if (statusText) statusText.textContent = 'Sync your library across devices';
            
            if (userAvatar) userAvatar.src = ''; // Placeholder or clear
            if (userName) userName.textContent = '';
        }
    }
}

export const authManager = new AuthManager();
