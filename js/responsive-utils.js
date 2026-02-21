// js/responsive-utils.js
// Responsive Manager for Monochrome music player
// Provides algorithmic UI calculations based on viewport and container sizes

class ResponsiveManager {
    constructor() {
        // Standard breakpoints
        this.breakpoints = {
            xs: 480,
            sm: 768,
            md: 1024,
            lg: 1200,
            xl: 1440,
            '2xl': 1920,
        };

        this.currentBreakpoint = this.getCurrentBreakpoint();
        this.listeners = new Set();
        this.containerObservers = new Map();

        // Debounced resize handler
        this.handleResize = this.debounce(() => {
            const newBreakpoint = this.getCurrentBreakpoint();
            if (newBreakpoint !== this.currentBreakpoint) {
                this.currentBreakpoint = newBreakpoint;
                this.notifyListeners('breakpoint', newBreakpoint);
            }
        }, 100);

        // Listen for window resize
        window.addEventListener('resize', this.handleResize);

        // Listen for orientation change on mobile
        window.addEventListener('orientationchange', () => {
            setTimeout(this.handleResize, 100);
        });
    }

    /**
     * Get the current breakpoint name
     * @returns {string} Breakpoint name
     */
    getCurrentBreakpoint() {
        const width = window.innerWidth;
        const entries = Object.entries(this.breakpoints);

        for (const [name, value] of entries) {
            if (width < value) return name;
        }

        return '2xl';
    }

    /**
     * Check if current viewport matches a breakpoint
     * @param {string} breakpoint - Breakpoint name
     * @returns {boolean}
     */
    isBreakpoint(breakpoint) {
        return this.currentBreakpoint === breakpoint;
    }

    /**
     * Check if current viewport is at least a certain breakpoint
     * @param {string} breakpoint - Breakpoint name
     * @returns {boolean}
     */
    isBreakpointUp(breakpoint) {
        const order = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
        const currentIndex = order.indexOf(this.currentBreakpoint);
        const targetIndex = order.indexOf(breakpoint);
        return currentIndex >= targetIndex;
    }

    /**
     * Check if current viewport is at most a certain breakpoint
     * @param {string} breakpoint - Breakpoint name
     * @returns {boolean}
     */
    isBreakpointDown(breakpoint) {
        const order = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
        const currentIndex = order.indexOf(this.currentBreakpoint);
        const targetIndex = order.indexOf(breakpoint);
        return currentIndex <= targetIndex;
    }

    /**
     * Check if device is mobile
     * @returns {boolean}
     */
    isMobile() {
        return this.isBreakpointDown('sm');
    }

    /**
     * Check if device is tablet
     * @returns {boolean}
     */
    isTablet() {
        return this.isBreakpoint('md') || this.isBreakpoint('sm');
    }

    /**
     * Check if device is desktop
     * @returns {boolean}
     */
    isDesktop() {
        return this.isBreakpointUp('lg');
    }

    /**
     * Calculate optimal card count for container
     * @param {number} containerWidth - Container width in pixels
     * @param {number} cardMinWidth - Minimum card width in pixels
     * @param {number} gap - Gap between cards in pixels
     * @returns {number} Optimal card count
     */
    calculateCardCount(containerWidth, cardMinWidth = 180, gap = 16) {
        return Math.floor((containerWidth + gap) / (cardMinWidth + gap));
    }

    /**
     * Calculate optimal card width for container
     * @param {number} containerWidth - Container width in pixels
     * @param {number} minCards - Minimum number of cards
     * @param {number} gap - Gap between cards in pixels
     * @returns {number} Optimal card width
     */
    calculateCardWidth(containerWidth, minCards = 3, gap = 16) {
        const totalGap = gap * (minCards - 1);
        return Math.floor((containerWidth - totalGap) / minCards);
    }

    /**
     * Calculate optimal font size based on container
     * @param {number} containerWidth - Container width in pixels
     * @param {number} minSize - Minimum font size in pixels
     * @param {number} maxSize - Maximum font size in pixels
     * @returns {number} Optimal font size
     */
    calculateFontSize(containerWidth, minSize = 14, maxSize = 18) {
        const slope = (maxSize - minSize) / (1200 - 320);
        return Math.max(minSize, Math.min(maxSize, minSize + slope * (containerWidth - 320)));
    }

    /**
     * Get optimal image size for element
     * @param {number} elementWidth - Element width in pixels
     * @returns {number} Optimal image size
     */
    getOptimalImageSize(elementWidth) {
        const dpr = window.devicePixelRatio || 1;
        const physicalWidth = elementWidth * dpr;

        // Available sizes from API
        const sizes = [80, 160, 320, 640, 1280];

        for (const size of sizes) {
            if (size >= physicalWidth) return size;
        }

        return sizes[sizes.length - 1];
    }

    /**
     * Observe a container for size changes
     * @param {HTMLElement} element - Element to observe
     * @param {Function} callback - Callback function
     * @returns {Function} Cleanup function
     */
    observeContainer(element, callback) {
        if (!window.ResizeObserver) {
            // Fallback for browsers without ResizeObserver
            const handler = () => {
                callback({
                    width: element.offsetWidth,
                    height: element.offsetHeight,
                });
            };
            window.addEventListener('resize', handler);
            return () => window.removeEventListener('resize', handler);
        }

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                callback({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                    element: entry.target,
                });
            }
        });

        observer.observe(element);
        this.containerObservers.set(element, observer);

        return () => {
            observer.unobserve(element);
            this.containerObservers.delete(element);
        };
    }

    /**
     * Stop observing a container
     * @param {HTMLElement} element - Element to stop observing
     */
    unobserveContainer(element) {
        const observer = this.containerObservers.get(element);
        if (observer) {
            observer.disconnect();
            this.containerObservers.delete(element);
        }
    }

    /**
     * Subscribe to breakpoint changes
     * @param {Function} listener - Listener function
     * @returns {Function} Unsubscribe function
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Notify all listeners of a change
     * @param {string} type - Event type
     * @param {*} data - Event data
     */
    notifyListeners(type, data) {
        this.listeners.forEach((listener) => {
            try {
                listener(type, data);
            } catch (e) {
                console.warn('[ResponsiveManager] Listener error:', e);
            }
        });
    }

    /**
     * Check if device supports touch
     * @returns {boolean}
     */
    isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    /**
     * Get device pixel ratio
     * @returns {number}
     */
    getPixelRatio() {
        return window.devicePixelRatio || 1;
    }

    /**
     * Check if user prefers reduced motion
     * @returns {boolean}
     */
    prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * Check if user prefers dark color scheme
     * @returns {boolean}
     */
    prefersDarkMode() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    /**
     * Check if user prefers high contrast
     * @returns {boolean}
     */
    prefersHighContrast() {
        return window.matchMedia('(prefers-contrast: more)').matches;
    }

    /**
     * Get viewport dimensions
     * @returns {Object} Viewport dimensions
     */
    getViewport() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            aspectRatio: window.innerWidth / window.innerHeight,
        };
    }

    /**
     * Get safe area insets (for notched devices)
     * @returns {Object} Safe area insets
     */
    getSafeAreaInsets() {
        const computedStyle = getComputedStyle(document.documentElement);
        return {
            top: parseInt(computedStyle.getPropertyValue('--safe-area-inset-top') || '0', 10),
            right: parseInt(computedStyle.getPropertyValue('--safe-area-inset-right') || '0', 10),
            bottom: parseInt(computedStyle.getPropertyValue('--safe-area-inset-bottom') || '0', 10),
            left: parseInt(computedStyle.getPropertyValue('--safe-area-inset-left') || '0', 10),
        };
    }

    /**
     * Calculate optimal grid columns
     * @param {number} containerWidth - Container width
     * @param {Object} options - Grid options
     * @returns {number} Number of columns
     */
    calculateGridColumns(containerWidth, options = {}) {
        const { minColumnWidth = 180, maxColumnWidth = 250, gap = 16, minColumns = 2, maxColumns = 8 } = options;

        // Calculate how many columns fit
        let columns = Math.floor((containerWidth + gap) / (minColumnWidth + gap));

        // Clamp to min/max
        columns = Math.max(minColumns, Math.min(maxColumns, columns));

        // Check if columns would be too wide
        const columnWidth = (containerWidth - gap * (columns - 1)) / columns;
        if (columnWidth > maxColumnWidth && columns < maxColumns) {
            columns++;
        }

        return columns;
    }

    /**
     * Get optimal sidebar width
     * @returns {number} Sidebar width in pixels
     */
    getOptimalSidebarWidth() {
        const viewport = this.getViewport();

        if (viewport.width < 768) {
            return Math.min(280, viewport.width * 0.85);
        } else if (viewport.width < 1024) {
            return 200;
        } else if (viewport.width < 1440) {
            return 220;
        } else {
            return 240;
        }
    }

    /**
     * Get optimal player bar height
     * @returns {number} Player bar height in pixels
     */
    getOptimalPlayerBarHeight() {
        const viewport = this.getViewport();

        if (viewport.width < 768) {
            return Math.max(120, viewport.height * 0.15);
        } else {
            return Math.max(80, viewport.height * 0.1);
        }
    }

    /**
     * Debounce helper
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in ms
     * @returns {Function} Debounced function
     */
    debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    /**
     * Throttle helper
     * @param {Function} fn - Function to throttle
     * @param {number} limit - Limit in ms
     * @returns {Function} Throttled function
     */
    throttle(fn, limit) {
        let inThrottle;
        return (...args) => {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                }, limit);
            }
        };
    }

    /**
     * Get CSS variable value
     * @param {string} name - Variable name (without --)
     * @returns {string} Variable value
     */
    getCSSVariable(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    }

    /**
     * Set CSS variable value
     * @param {string} name - Variable name (without --)
     * @param {string} value - Variable value
     */
    setCSSVariable(name, value) {
        document.documentElement.style.setProperty(`--${name}`, value);
    }

    /**
     * Get connection information
     * @returns {Object} Connection info
     */
    getConnectionInfo() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

        if (!connection) {
            return {
                available: false,
                type: 'unknown',
                effectiveType: 'unknown',
                downlink: null,
                rtt: null,
                saveData: false,
            };
        }

        return {
            available: true,
            type: connection.type || 'unknown',
            effectiveType: connection.effectiveType || 'unknown',
            downlink: connection.downlink || null,
            rtt: connection.rtt || null,
            saveData: connection.saveData || false,
        };
    }

    /**
     * Check if connection is slow
     * @returns {boolean}
     */
    isSlowConnection() {
        const info = this.getConnectionInfo();
        return (
            info.saveData ||
            info.effectiveType === '2g' ||
            info.effectiveType === 'slow-2g' ||
            (info.downlink !== null && info.downlink < 1.5)
        );
    }
}

// Create singleton instance
export const responsiveManager = new ResponsiveManager();
