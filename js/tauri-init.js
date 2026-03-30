import { isTauri } from './platform-detection.js';
import { Player } from './player.js';

export async function initTauri() {
    if (!isTauri) return;

    document.body.classList.add('is-tauri');
    const titlebar = document.getElementById('tauri-titlebar');
    if (titlebar) {
        titlebar.style.display = 'flex';
    }

    try {
        const { Window } = await import('@tauri-apps/api/window');
        const appWindow = new Window('main');

        document.getElementById('tauri-titlebar-minimize')?.addEventListener('click', () => {
            appWindow.minimize();
        });

        document.getElementById('tauri-titlebar-maximize')?.addEventListener('click', async () => {
            const isMax = await appWindow.isMaximized();
            if (isMax) {
                appWindow.unmaximize();
            } else {
                appWindow.maximize();
            }
        });

        document.getElementById('tauri-titlebar-close')?.addEventListener('click', () => {
            // We'll hide the window instead of closing so it stays in the tray.
            appWindow.hide();
        });

        // Setup F11 Fullscreen Toggle
        window.addEventListener('keydown', async (e) => {
            if (e.key === 'F11') {
                e.preventDefault();
                const isFullscreen = await appWindow.isFullscreen();
                await appWindow.setFullscreen(!isFullscreen);
            }
        }, { capture: true });

        // Setup Media Keys
        const { register } = await import('@tauri-apps/plugin-global-shortcut');

        await register('MediaPlayPause', () => {
            if (Player.instance) {
                Player.instance.handlePlayPause();
            }
        });

        await register('MediaNextTrack', () => {
            // Check if playNext exists in scope or trigger the UI button
            const nextBtn = document.getElementById('next-btn');
            if (nextBtn) nextBtn.click();
        });

        await register('MediaPrevTrack', () => {
            const prevBtn = document.getElementById('prev-btn');
            if (prevBtn) prevBtn.click();
        });

        console.log("Tauri Desktop Features Initialized Successfully.");
    } catch (error) {
        console.error("Error initializing Tauri desktop features:", error);
    }
}
