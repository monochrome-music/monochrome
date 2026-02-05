//js/smooth-scrolling.js
import { smoothScrollingSettings } from './storage.js';

let lenis = null;
let lenisLoaded = false;
let lenisLoading = false;

async function loadLenisScript() {
    if (lenisLoaded) return true;
    if (lenisLoading) {
        return new Promise((resolve) => {
            const checkLoaded = setInterval(() => {
                if (!lenisLoading) {
                    clearInterval(checkLoaded);
                    resolve(lenisLoaded);
                }
            }, 100);
        });
    }

    lenisLoading = true;

    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@studio-freight/lenis';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        lenisLoaded = true;
        lenisLoading = false;
        console.log('✓ Lenis loaded successfully');
        return true;
    } catch (error) {
        console.error('✗ Failed to load Lenis:', error);
        lenisLoaded = false;
        lenisLoading = false;
        return false;
    }
}

async function initializeSmoothScrolling() {
    if (lenis) return; // Already initialized

    const loaded = await loadLenisScript();
    if (!loaded) return;

    lenis = new window.Lenis({
        wrapper: document.querySelector('.main-content'),
        content: document.querySelector('.main-content'),
        lerp: 0.1,
        smoothWheel: true,
        smoothTouch: false,
        normalizeWheel: true,
        wheelMultiplier: 0.8,
    });

    function raf(time) {
        if (lenis) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
    }

    requestAnimationFrame(raf);
}

function destroySmoothScrolling() {
    if (lenis) {
        lenis.destroy();
        lenis = null;
    }
}

async function setupSmoothScrolling() {
    // Check if smooth scrolling is enabled
    const smoothScrollingEnabled = smoothScrollingSettings.isEnabled();

    if (smoothScrollingEnabled) {
        await initializeSmoothScrolling();
    }

    // Listen for toggle changes
    window.addEventListener('smooth-scrolling-toggle', async function (e) {
        if (e.detail.enabled) {
            await initializeSmoothScrolling();
        } else {
            destroySmoothScrolling();
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSmoothScrolling);
} else {
    setupSmoothScrolling();
}
