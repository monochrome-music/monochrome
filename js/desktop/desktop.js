// js/desktop/desktop.js
import Neutralino from './neutralino-bridge.js';
import { initializeDiscordRPC } from './discord-rpc.js';
import { initStorageSync } from './storage-sync.js';

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    // Assign to window for modules that use global Neutralino (like Player.js)
    window.Neutralino = Neutralino;

    try {
        // Restore localStorage from disk BEFORE anything reads it
        await initStorageSync();

        await Neutralino.init();
        console.log('[Desktop] Neutralino initialized.');


        // Intercept external links → open in system browser
        interceptExternalLinks();

        if (player) {
            console.log('[Desktop] Starting Discord RPC...');
            initializeDiscordRPC(player);
        }
    } catch (error) {
        console.error('[Desktop] Failed to initialize desktop environment:', error);
    }
}

function interceptExternalLinks() {
    console.log('[Desktop] Intercepting external links for system browser...');

    // Intercept clicks on <a> tags with external URLs
    document.addEventListener('click', (e) => {
        const anchor = e.target.closest('a[href]');
        if (!anchor) return;
        const href = anchor.href;
        if (
            href &&
            (href.startsWith('http://') || href.startsWith('https://')) &&
            new URL(href).origin !== window.location.origin
        ) {
            e.preventDefault();
            Neutralino.os.open(href);
        }
    });

    // Override window.open() for external URLs
    const originalOpen = window.open.bind(window);
    window.open = (url, ...args) => {
        if (
            url &&
            (url.startsWith('http://') || url.startsWith('https://')) &&
            new URL(url).origin !== window.location.origin
        ) {
            Neutralino.os.open(url);
            return null;
        }
        return originalOpen(url, ...args);
    };
}

