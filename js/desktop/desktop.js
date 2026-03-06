// js/desktop/desktop.js
import CapacitorBridge from './capacitor-bridge.js';
import { initializeDiscordRPC } from './discord-rpc.js';

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    // Expose bridge globally for modules that do runtime native checks
    window.CapacitorBridge = CapacitorBridge;

    try {
        await CapacitorBridge.init();
        console.log('[Desktop] Capacitor bridge initialized.');
        if (player && typeof player.setupMediaSession === 'function') {
            player.setupMediaSession();
        }

        if (player) {
            console.log('[Desktop] Starting Discord RPC...');
            initializeDiscordRPC(player);
        }
    } catch (error) {
        console.error('[Desktop] Failed to initialize desktop environment:', error);
    }
}
