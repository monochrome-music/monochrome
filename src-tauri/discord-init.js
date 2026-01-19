(function() {
    if (window.discordRpcInjected) {
        return;
    }
    window.discordRpcInjected = true;

    const originalOpen = window.open;
    window.open = function(url, target, features) {
        const urlStr = String(url || '');
        const isExternalAuth = urlStr.includes('last.fm') || 
                               urlStr.includes('spotify.com') || 
                               urlStr.includes('google.com') ||
                               urlStr.includes('discord.com');
                               urlStr.includes('monochrome-database.firebaseapp.com')

        if (isExternalAuth) {
            if (window.__TAURI__?.shell) {
                window.__TAURI__.shell.open(urlStr);
            }
            return { 
                close: () => {}, 
                focus: () => {}, 
                blur: () => {}, 
                postMessage: () => {},
                closed: false,
                location: { href: urlStr }
            };
        }
        
        return originalOpen.apply(window, arguments);
    };

    document.addEventListener('contextmenu', e => e.preventDefault());
    let debounceTimer;
    let lastState = {};

    function invoke(cmd, args) {
        if (window.__TAURI__?.core?.invoke) {
            return window.__TAURI__.core.invoke(cmd, args);
        }
        if (window.__TAURI__?.tauri?.invoke) {
            return window.__TAURI__.tauri.invoke(cmd, args);
        }
        return Promise.reject("Tauri API not found");
    }

    if (window.__TAURI__?.event?.listen) {
        window.__TAURI__.event.listen('media-toggle', () => {
            const audio = document.getElementById('audio-player');
            if (audio) {
                if (audio.paused) audio.play(); else audio.pause();
            }
        });
    }

    function updateRPC(force = false) {
        const titleEl = document.querySelector('.now-playing-bar .title');
        const artistEl = document.querySelector('.now-playing-bar .artist');
        const coverEl = document.querySelector('.now-playing-bar img.cover');
        const audioEl = document.getElementById('audio-player');

        if (titleEl && artistEl) {
            let title = titleEl.innerText.replace(/\s*HD\s*$/, '').trim();
            
            let image = 'logo';
            if (coverEl && coverEl.src && coverEl.src.startsWith('http') && coverEl.src.length < 256) {
                image = coverEl.src;
            }

            const isPaused = audioEl ? audioEl.paused : false;
            
            const currentState = {
                title: title,
                artist: artistEl.innerText,
                image: image,
                isPaused: isPaused
            };

            if (!force && JSON.stringify(currentState) === JSON.stringify(lastState)) {
                return;
            }

            lastState = currentState;

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const currentSec = audioEl ? audioEl.currentTime : 0;
                
                invoke('update_discord_presence', {
                    details: title,
                    status: currentState.artist,
                    image: image,
                    isPaused: isPaused,
                    currentSec: currentSec
                }).catch(() => {});
            }, 500);
        }
    }

    let observer = null;
    
    function attachAudioListeners() {
        const audio = document.getElementById('audio-player');
        if (audio && !audio.dataset.rpcAttached) {
            audio.addEventListener('play', () => updateRPC(false));
            audio.addEventListener('pause', () => updateRPC(false));
            audio.addEventListener('seeked', () => updateRPC(true));
            audio.dataset.rpcAttached = "true";
        }
    }

    function initializeWatcher() {
        const bar = document.querySelector('.now-playing-bar');
        if (bar && !observer) {
            observer = new MutationObserver(() => {
                try {
                    updateRPC(false);
                } catch(e) {}
            });
            observer.observe(bar, { subtree: true, childList: true, characterData: true });
        }
        attachAudioListeners();
        updateRPC(false);
    }
    
    function tryInit() {
        initializeWatcher();
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
    
    setInterval(tryInit, 2000);
})();