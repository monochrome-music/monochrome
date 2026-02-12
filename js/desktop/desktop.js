// js/desktop/desktop.js
import Neutralino from './neutralino-bridge.js';
import { initializeDiscordRPC } from './discord-rpc.js';

export async function initDesktop(player) {
    console.log('[Desktop] Initializing desktop features...');

    // Assign to window for modules that use global Neutralino (like Player.js)
    window.Neutralino = Neutralino;

    try {
        await Neutralino.init();
        console.log('[Desktop] Neutralino initialized.');

        if (player) {
            console.log('[Desktop] Starting Discord RPC...');
            initializeDiscordRPC(player);
        }
    } catch (error) {
        console.error('[Desktop] Failed to initialize desktop environment:', error);
    }
}
