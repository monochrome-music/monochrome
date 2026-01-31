//js/accounts/config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

let app = null;
let auth = null;
let database = null;
let provider = null;

const STORAGE_KEY = 'monochrome-firebase-config';

const DEFAULT_CONFIG = {
    apiKey: 'AIzaSyDPU-unAjuLtQJt4IkGS5faG50UCF7lYyA',
    authDomain: 'monochrome-database.firebaseapp.com',
    projectId: 'monochrome-database',
    storageBucket: 'monochrome-database.firebasestorage.app',
    messagingSenderId: '895657412760',
    appId: '1:895657412760:web:e81c5044c7f4e9b799e8ed',
};

function getStoredConfig() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.warn('Failed to parse Firebase config from storage', e);
        return null;
    }
}

// Attempt to initialize on load
const storedConfig = getStoredConfig();
const config = storedConfig || DEFAULT_CONFIG;

if (config) {
    try {
        app = initializeApp(config);
        auth = getAuth(app);
        database = getDatabase(app);
        provider = new GoogleAuthProvider();
        console.log('Firebase initialized from ' + (storedConfig ? 'saved' : 'default') + ' config');
    } catch (error) {
        console.error('Error initializing Firebase:', error);
    }
} else {
    console.log('No Firebase config found.');
}

export function saveFirebaseConfig(configObj) {
    if (!configObj) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configObj));
}

export function clearFirebaseConfig() {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Generates a shareable URL containing the encoded configuration.
 * @param {Object} config - The Firebase configuration object.
 * @returns {string} The full URL with the config hash.
 */
export function generateShareLink(config) {
    if (!config) return null;
    try {
        const json = JSON.stringify(config);
        // Base64 encode (safe for URL hash)
        const encoded = btoa(json);
        const url = new URL(window.location.href);
        url.hash = `#setup_firebase=${encoded}`;
        return url.toString();
    } catch (e) {
        console.error('Failed to generate share link:', e);
        return null;
    }
}

/**
 * Checks the current URL for a shared configuration.
 * If found, prompts the user to import it.
 * @returns {boolean} True if a config was handled/processed.
 */
export function checkAndImportConfig() {
    const hash = window.location.hash;
    if (!hash.startsWith('#setup_firebase=')) return false;

    const encoded = hash.split('#setup_firebase=')[1];
    if (!encoded) return false;

    try {
        const json = atob(encoded);
        const config = JSON.parse(json);

        // Validate basic structure
        if (!config.apiKey || !config.authDomain) {
            alert('The shared configuration link appears to be invalid.');
            return false;
        }

        if (confirm('A Firebase configuration was detected in the link. Do you want to import it and enable Sync?')) {
            saveFirebaseConfig(config);
            // Clean URL
            window.history.replaceState(null, null, window.location.pathname);
            alert('Configuration imported successfully! The app will now reload.');
            window.location.reload();
            return true;
        } else {
            // User rejected, clean URL anyway to avoid re-prompting
            window.history.replaceState(null, null, window.location.pathname + '#settings');
        }
    } catch (e) {
        console.error('Failed to parse shared config:', e);
        alert('Failed to read configuration from link. The link might be corrupted.');
    }
    return false;
}

export function initializeFirebaseSettingsUI() {
    // Check for shared config in URL first
    checkAndImportConfig();

    const firebaseConfigInput = document.getElementById('firebase-config-input');
    const saveFirebaseConfigBtn = document.getElementById('save-firebase-config-btn');
    const clearFirebaseConfigBtn = document.getElementById('clear-firebase-config-btn');
    const shareFirebaseConfigBtn = document.getElementById('share-firebase-config-btn');
    const toggleFirebaseConfigBtn = document.getElementById('toggle-firebase-config-btn');
    const customFirebaseConfigContainer = document.getElementById('custom-firebase-config-container');

    // Toggle Button Logic
    if (toggleFirebaseConfigBtn && customFirebaseConfigContainer) {
        toggleFirebaseConfigBtn.addEventListener('click', () => {
            const isVisible = customFirebaseConfigContainer.classList.contains('visible');
            if (isVisible) {
                customFirebaseConfigContainer.classList.remove('visible');
                toggleFirebaseConfigBtn.textContent = 'Custom Configuration';
            } else {
                customFirebaseConfigContainer.classList.add('visible');
                toggleFirebaseConfigBtn.textContent = 'Hide Custom Configuration';
            }
        });
    }

    // Populate current config
    if (firebaseConfigInput) {
        const currentConfig = localStorage.getItem(STORAGE_KEY);
        if (currentConfig) {
            try {
                firebaseConfigInput.value = JSON.stringify(JSON.parse(currentConfig), null, 2);
                // If custom config exists, show the container
                if (customFirebaseConfigContainer && toggleFirebaseConfigBtn) {
                    customFirebaseConfigContainer.classList.add('visible');
                    toggleFirebaseConfigBtn.textContent = 'Hide Custom Configuration';
                }
            } catch {
                firebaseConfigInput.value = currentConfig;
            }
        }
    }

    // Share Button
    if (shareFirebaseConfigBtn) {
        shareFirebaseConfigBtn.addEventListener('click', () => {
            const currentConfigStr = localStorage.getItem(STORAGE_KEY);
            if (!currentConfigStr) {
                alert('No configuration saved to share.');
                return;
            }
            try {
                const config = JSON.parse(currentConfigStr);
                const link = generateShareLink(config);
                if (link) {
                    navigator.clipboard
                        .writeText(link)
                        .then(() => {
                            alert('Magic Link copied to clipboard! Send it to your other device.');
                        })
                        .catch((err) => {
                            console.error('Clipboard error:', err);
                            prompt('Copy this link:', link);
                        });
                }
            } catch {
                alert('Invalid configuration found.');
            }
        });
    }

    // Save Button
    if (saveFirebaseConfigBtn) {
        saveFirebaseConfigBtn.addEventListener('click', () => {
            const inputVal = firebaseConfigInput.value.trim();
            if (!inputVal) {
                alert('Please enter a valid configuration.');
                return;
            }

            try {
                let cleaned = inputVal;
                // Remove variable declaration if present (e.g., "const firebaseConfig = ")
                if (cleaned.includes('=')) {
                    cleaned = cleaned.substring(cleaned.indexOf('=') + 1);
                }
                // Remove trailing semicolon
                cleaned = cleaned.trim();
                if (cleaned.endsWith(';')) {
                    cleaned = cleaned.slice(0, -1);
                }

                // Convert JS Object format to JSON format
                const jsonReady = cleaned
                    .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // Wrap keys in double quotes
                    .replace(/:\s*'([^']*)'/g, ': "$1"') // Replace single-quoted values with double quotes
                    .replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas

                const config = JSON.parse(jsonReady);
                saveFirebaseConfig(config);
                alert('Configuration saved. Reloading...');
                window.location.reload();
            } catch (error) {
                console.error('Invalid Config:', error);
                alert('Could not parse configuration. Please ensure it looks like a valid JSON or JS object.');
            }
        });
    }

    // Clear Button
    if (clearFirebaseConfigBtn) {
        clearFirebaseConfigBtn.addEventListener('click', () => {
            if (
                confirm(
                    'Are you sure you want to remove the custom configuration? The app will revert to the shared default database.'
                )
            ) {
                clearFirebaseConfig();
                window.location.reload();
            }
        });
    }
}

export { app, auth, database, provider };
