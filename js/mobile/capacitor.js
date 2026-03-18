// js/desktop/desktop.js
import CapacitorBridge from './capacitor-bridge.js';
// import { initializeDiscordRPC } from './discord-rpc.js';

export async function initDesktop(player) {
    console.log('[Capacitor] Initializing mobile features...');

    // Expose bridge globally for modules that do runtime native checks
    window.CapacitorBridge = CapacitorBridge;

    try {
        await CapacitorBridge.init();
        console.log('[Capacitor] Capacitor bridge initialized.');
        if (player && typeof player.setupMediaSession === 'function') {
            player.setupMediaSession();
        }

        /* discord rpc doesn't exist on mobile
        if (player) {
            console.log('[Desktop] Starting Discord RPC...');
            initializeDiscordRPC(player);
        }
        */
    } catch (error) {
        console.error('[Desktop] Failed to initialize desktop environment:', error);
    }
}
