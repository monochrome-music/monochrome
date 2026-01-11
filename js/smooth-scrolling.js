//js/smooth-scrolling.js
import { smoothScrollingSettings } from './storage.js';

let lenis = null;

function initializeSmoothScrolling() {
    if (lenis) return; // Already initialized

    lenis = new Lenis({
        wrapper: document.querySelector('.main-content'),
        content: document.querySelector('.main-content'),
        lerp: 0.1,
        smoothWheel: true,
        smoothTouch: false,
        normalizeWheel: true,
        wheelMultiplier: 0.8,
    });

    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
}

function destroySmoothScrolling() {
    if (lenis) {
        lenis.destroy();
        lenis = null;
    }
}

function setupSmoothScrolling() {
    // Check if smooth scrolling is enabled
    const smoothScrollingEnabled = smoothScrollingSettings.isEnabled();

    if (smoothScrollingEnabled) {
        initializeSmoothScrolling();
    }

    // Listen for toggle changes
    window.addEventListener('smooth-scrolling-toggle', function (e) {
        if (e.detail.enabled) {
            initializeSmoothScrolling();
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
