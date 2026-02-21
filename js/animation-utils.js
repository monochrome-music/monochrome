// js/animation-utils.js
// Animation Manager for Monochrome music player
// Provides optimized, hardware-accelerated animations with accessibility support

class AnimationManager {
    constructor() {
        // Check for reduced motion preference
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.animations = new Map();
        this.frameId = null;

        // Listen for preference changes
        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.reducedMotion = e.matches;
            if (e.matches) {
                this.cancelAll();
            }
        });
    }

    /**
     * Check if animations should be reduced
     * @returns {boolean}
     */
    shouldReduceMotion() {
        return this.reducedMotion;
    }

    /**
     * Optimized fade in animation
     * @param {HTMLElement} element - Element to animate
     * @param {number} duration - Animation duration in ms
     * @returns {Promise<void>}
     */
    fadeIn(element, duration = 300) {
        if (this.reducedMotion) {
            element.style.opacity = '1';
            return Promise.resolve();
        }

        return this.animate(element, {
            from: { opacity: 0 },
            to: { opacity: 1 },
            duration,
        });
    }

    /**
     * Optimized fade out animation
     * @param {HTMLElement} element - Element to animate
     * @param {number} duration - Animation duration in ms
     * @returns {Promise<void>}
     */
    fadeOut(element, duration = 300) {
        if (this.reducedMotion) {
            element.style.opacity = '0';
            return Promise.resolve();
        }

        return this.animate(element, {
            from: { opacity: 1 },
            to: { opacity: 0 },
            duration,
        });
    }

    /**
     * Optimized slide in animation
     * @param {HTMLElement} element - Element to animate
     * @param {string} direction - Direction: 'up', 'down', 'left', 'right'
     * @param {number} duration - Animation duration in ms
     * @returns {Promise<void>}
     */
    slideIn(element, direction = 'up', duration = 300) {
        if (this.reducedMotion) {
            element.style.transform = 'translate3d(0, 0, 0)';
            element.style.opacity = '1';
            return Promise.resolve();
        }

        const offsets = {
            up: [0, 20, 0],
            down: [0, -20, 0],
            left: [20, 0, 0],
            right: [-20, 0, 0],
        };

        const [x, y, z] = offsets[direction] || offsets.up;

        return this.animate(element, {
            from: {
                opacity: 0,
                transform: `translate3d(${x}px, ${y}px, ${z}px)`,
            },
            to: {
                opacity: 1,
                transform: 'translate3d(0, 0, 0)',
            },
            duration,
        });
    }

    /**
     * Scale in animation
     * @param {HTMLElement} element - Element to animate
     * @param {number} duration - Animation duration in ms
     * @returns {Promise<void>}
     */
    scaleIn(element, duration = 200) {
        if (this.reducedMotion) {
            element.style.transform = 'scale3d(1, 1, 1)';
            element.style.opacity = '1';
            return Promise.resolve();
        }

        return this.animate(element, {
            from: {
                opacity: 0,
                transform: 'scale3d(0.95, 0.95, 1)',
            },
            to: {
                opacity: 1,
                transform: 'scale3d(1, 1, 1)',
            },
            duration,
        });
    }

    /**
     * Pop in animation with bounce effect
     * @param {HTMLElement} element - Element to animate
     * @param {number} duration - Animation duration in ms
     * @returns {Promise<void>}
     */
    popIn(element, duration = 300) {
        if (this.reducedMotion) {
            element.style.transform = 'scale3d(1, 1, 1)';
            element.style.opacity = '1';
            return Promise.resolve();
        }

        return this.animate(element, {
            from: {
                opacity: 0,
                transform: 'scale3d(0.9, 0.9, 1)',
            },
            to: {
                opacity: 1,
                transform: 'scale3d(1, 1, 1)',
            },
            duration,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // ease-out-back
        });
    }

    /**
     * Core animation method using Web Animations API
     * @param {HTMLElement} element - Element to animate
     * @param {Object} options - Animation options
     * @returns {Promise<void>}
     */
    animate(element, options) {
        const { from, to, duration = 300, easing = 'ease-out' } = options;

        // Cancel any existing animation on this element
        const existing = this.animations.get(element);
        if (existing) {
            existing.cancel();
        }

        return new Promise((resolve) => {
            const animation = element.animate([from, to], {
                duration,
                easing,
                fill: 'forwards',
            });

            this.animations.set(element, animation);

            animation.onfinish = () => {
                this.animations.delete(element);
                // Apply final styles to ensure they persist
                Object.entries(to).forEach(([prop, value]) => {
                    element.style[prop] = value;
                });
                resolve();
            };

            animation.oncancel = () => {
                this.animations.delete(element);
                resolve();
            };
        });
    }

    /**
     * Staggered animation for lists
     * @param {NodeList|Array} elements - Elements to animate
     * @param {Function} animationFn - Animation function to apply to each element
     * @param {number} staggerDelay - Delay between each element in ms
     * @returns {Promise<void>}
     */
    animateList(elements, animationFn, staggerDelay = 50) {
        if (this.reducedMotion) {
            elements.forEach((el) => {
                el.style.opacity = '1';
                el.style.transform = 'translate3d(0, 0, 0)';
            });
            return Promise.resolve();
        }

        const promises = Array.from(elements).map((el, index) => {
            return new Promise((resolve) => {
                setTimeout(() => {
                    animationFn(el).then(resolve);
                }, index * staggerDelay);
            });
        });

        return Promise.all(promises);
    }

    /**
     * Create ripple effect for buttons
     * @param {MouseEvent} event - Click event
     * @param {HTMLElement} element - Button element
     */
    createRipple(event, element) {
        if (this.reducedMotion) return;

        // Ensure element has position relative
        const computedStyle = getComputedStyle(element);
        if (computedStyle.position === 'static') {
            element.style.position = 'relative';
        }

        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            left: ${x}px;
            top: ${y}px;
            border-radius: 50%;
            background: currentColor;
            opacity: 0.3;
            transform: scale(0);
            pointer-events: none;
            z-index: 1;
        `;

        element.appendChild(ripple);

        ripple.animate(
            [
                { transform: 'scale(0)', opacity: 0.3 },
                { transform: 'scale(2)', opacity: 0 },
            ],
            {
                duration: 600,
                easing: 'ease-out',
            }
        ).onfinish = () => ripple.remove();
    }

    /**
     * Smooth scroll to position with easing
     * @param {HTMLElement} element - Scrollable element
     * @param {number} targetScroll - Target scroll position
     * @param {number} duration - Animation duration in ms
     * @returns {Promise<void>}
     */
    smoothScrollTo(element, targetScroll, duration = 300) {
        if (this.reducedMotion) {
            element.scrollTop = targetScroll;
            return Promise.resolve();
        }

        const startScroll = element.scrollTop;
        const distance = targetScroll - startScroll;
        const startTime = performance.now();

        return new Promise((resolve) => {
            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Ease-out cubic
                const eased = 1 - Math.pow(1 - progress, 3);

                element.scrollTop = startScroll + distance * eased;

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };

            requestAnimationFrame(animate);
        });
    }

    /**
     * Smooth scroll element into view
     * @param {HTMLElement} element - Element to scroll into view
     * @param {Object} options - Scroll options
     * @returns {Promise<void>}
     */
    scrollIntoViewSmooth(element, options = {}) {
        if (this.reducedMotion) {
            element.scrollIntoView({ block: 'nearest' });
            return Promise.resolve();
        }

        const { behavior = 'smooth', block = 'nearest', inline = 'nearest' } = options;

        element.scrollIntoView({
            behavior,
            block,
            inline,
        });

        return Promise.resolve();
    }

    /**
     * Shake animation for error feedback
     * @param {HTMLElement} element - Element to shake
     * @param {number} intensity - Shake intensity in pixels
     * @returns {Promise<void>}
     */
    shake(element, intensity = 10) {
        if (this.reducedMotion) {
            return Promise.resolve();
        }

        return this.animate(element, {
            from: { transform: 'translate3d(0, 0, 0)' },
            to: { transform: 'translate3d(0, 0, 0)' },
            duration: 400,
            easing: 'ease-out',
        });
    }

    /**
     * Pulse animation for attention
     * @param {HTMLElement} element - Element to pulse
     * @param {number} scale - Scale factor
     * @returns {Promise<void>}
     */
    pulse(element, scale = 1.05) {
        if (this.reducedMotion) {
            return Promise.resolve();
        }

        return this.animate(element, {
            from: { transform: 'scale3d(1, 1, 1)' },
            to: { transform: `scale3d(${scale}, ${scale}, 1)` },
            duration: 150,
            easing: 'ease-out',
        }).then(() => {
            return this.animate(element, {
                from: { transform: `scale3d(${scale}, ${scale}, 1)` },
                to: { transform: 'scale3d(1, 1, 1)' },
                duration: 150,
                easing: 'ease-out',
            });
        });
    }

    /**
     * Cancel animation on an element
     * @param {HTMLElement} element - Element to cancel animation on
     */
    cancel(element) {
        const animation = this.animations.get(element);
        if (animation) {
            animation.cancel();
            this.animations.delete(element);
        }
    }

    /**
     * Cancel all running animations
     */
    cancelAll() {
        this.animations.forEach((animation) => {
            animation.cancel();
        });
        this.animations.clear();
    }

    /**
     * Add entrance animation to element when it enters viewport
     * @param {HTMLElement} element - Element to observe
     * @param {Object} options - Animation options
     * @returns {Function} Cleanup function
     */
    observeEntrance(element, options = {}) {
        const { animation = 'fadeIn', threshold = 0.1, rootMargin = '0px', once = true } = options;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        this[animation](element);
                        if (once) {
                            observer.unobserve(element);
                        }
                    }
                });
            },
            {
                threshold,
                rootMargin,
            }
        );

        observer.observe(element);

        return () => observer.unobserve(element);
    }

    /**
     * Batch multiple DOM reads/writes to prevent layout thrashing
     * @param {Function[]} reads - Array of read functions
     * @param {Function[]} writes - Array of write functions
     */
    batchDOM(reads, writes) {
        // Perform all reads first
        const readResults = reads.map((fn) => fn());

        // Then perform all writes in a frame
        requestAnimationFrame(() => {
            for (let i = 0; i < writes.length; i++) {
                writes[i](readResults[i]);
            }
        });
    }

    /**
     * Throttle a function using requestAnimationFrame
     * @param {Function} callback - Function to throttle
     * @returns {Function} Throttled function
     */
    throttleRAF(callback) {
        let ticking = false;
        return (...args) => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(() => {
                    callback(...args);
                    ticking = false;
                });
            }
        };
    }

    // =========================================
    // LOAD ANIMATIONS - Text and UI Elements
    // =========================================

    /**
     * Animate text reveal effect (characters slide up)
     * @param {HTMLElement} element - Text element to animate
     * @param {Object} options - Animation options
     * @returns {Promise<void>}
     */
    textReveal(element, options = {}) {
        if (this.reducedMotion) {
            element.style.opacity = '1';
            return Promise.resolve();
        }

        const { duration = 600, delay = 0, easing = 'cubic-bezier(0.16, 1, 0.3, 1)' } = options;
        const text = element.textContent;
        element.innerHTML = '';

        // Wrap each character in a span
        text.split('').forEach((char, i) => {
            const span = document.createElement('span');
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.style.cssText = `
                display: inline-block;
                opacity: 0;
                transform: translate3d(0, 100%, 0);
                filter: blur(4px);
            `;
            element.appendChild(span);

            // Animate each character with stagger
            setTimeout(
                () => {
                    span.animate(
                        [
                            { opacity: 0, transform: 'translate3d(0, 100%, 0)', filter: 'blur(4px)' },
                            { opacity: 1, transform: 'translate3d(0, 0, 0)', filter: 'blur(0)' },
                        ],
                        { duration, easing, fill: 'forwards' }
                    );
                },
                delay + i * 30
            );
        });

        return new Promise((resolve) => {
            setTimeout(resolve, delay + text.length * 30 + duration);
        });
    }

    /**
     * Animate heading reveal effect (slides from left with letter spacing)
     * @param {HTMLElement} element - Heading element to animate
     * @param {Object} options - Animation options
     * @returns {Promise<void>}
     */
    headingReveal(element, options = {}) {
        if (this.reducedMotion) {
            element.style.opacity = '1';
            return Promise.resolve();
        }

        const { duration = 800, delay = 0 } = options;

        return new Promise((resolve) => {
            setTimeout(() => {
                element.animate(
                    [
                        {
                            opacity: 0,
                            transform: 'translate3d(-20px, 0, 0)',
                            letterSpacing: '0.2em',
                            filter: 'blur(2px)',
                        },
                        {
                            opacity: 1,
                            transform: 'translate3d(0, 0, 0)',
                            letterSpacing: 'normal',
                            filter: 'blur(0)',
                        },
                    ],
                    { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
                ).onfinish = resolve;
            }, delay);
        });
    }

    /**
     * Animate page load sequence with staggered elements
     * @param {HTMLElement} container - Container with elements to animate
     * @param {Object} options - Animation options
     */
    async animatePageLoad(container, options = {}) {
        if (this.reducedMotion) {
            container.querySelectorAll('.animate-on-load').forEach((el) => {
                el.classList.add('animated');
                el.style.opacity = '1';
            });
            return;
        }

        const { staggerDelay = 100, baseDelay = 0 } = options;

        // Find all elements with animate-on-load class
        const elements = container.querySelectorAll('.animate-on-load');

        // Animate each element with stagger
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const delay = baseDelay + i * staggerDelay;

            setTimeout(() => {
                el.classList.add('animated');

                // Determine animation type based on class
                if (el.classList.contains('animate-text-reveal')) {
                    this.textReveal(el, { duration: 500 });
                } else if (el.classList.contains('animate-heading-reveal')) {
                    this.headingReveal(el, { duration: 600 });
                } else if (el.classList.contains('animate-card-enter')) {
                    this.scaleIn(el, { duration: 400 });
                } else {
                    // Default fade in + slide up
                    this.slideIn(el, 'up', 400);
                }
            }, delay);
        }
    }

    /**
     * Animate card grid entrance
     * @param {NodeList|Array} cards - Card elements to animate
     * @param {Object} options - Animation options
     */
    animateCardGrid(cards, options = {}) {
        if (this.reducedMotion) {
            cards.forEach((card) => {
                card.style.opacity = '1';
                card.style.transform = 'translate3d(0, 0, 0) scale3d(1, 1, 1)';
            });
            return;
        }

        const { staggerDelay = 50, duration = 400 } = options;

        cards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translate3d(0, 30px, 0) scale3d(0.95, 0.95, 1)';

            setTimeout(() => {
                card.animate(
                    [
                        {
                            opacity: 0,
                            transform: 'translate3d(0, 30px, 0) scale3d(0.95, 0.95, 1)',
                        },
                        {
                            opacity: 1,
                            transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)',
                        },
                    ],
                    {
                        duration,
                        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                        fill: 'forwards',
                    }
                );
            }, index * staggerDelay);
        });
    }

    /**
     * Create shimmer loading effect
     * @param {HTMLElement} element - Element to apply shimmer
     */
    shimmer(element) {
        element.classList.add('animate-shimmer');
    }

    /**
     * Remove shimmer effect
     * @param {HTMLElement} element - Element to remove shimmer from
     */
    stopShimmer(element) {
        element.classList.remove('animate-shimmer');
    }

    /**
     * Apply glow pulse effect
     * @param {HTMLElement} element - Element to apply glow
     * @param {Object} options - Animation options
     * @returns {number} Animation ID for stopping
     */
    glowPulse(element, options = {}) {
        if (this.reducedMotion) return 0;

        const { color = 'rgba(255, 255, 255, 0.3)', duration = 2000 } = options;

        let scale = 1;
        let growing = true;

        const animate = () => {
            if (growing) {
                scale += 0.01;
                if (scale >= 1.5) growing = false;
            } else {
                scale -= 0.01;
                if (scale <= 1) growing = true;
            }

            element.style.boxShadow = `0 0 ${20 * scale}px ${color}`;
        };

        return setInterval(animate, duration / 100);
    }

    /**
     * Initialize load animations for the entire page
     * Call this on DOMContentLoaded or when page content loads
     */
    initLoadAnimations() {
        // Find all elements that should animate on load
        const animatedElements = document.querySelectorAll('[data-animate-on-load]');

        animatedElements.forEach((el, index) => {
            const animationType = el.dataset.animateOnLoad || 'fade-in';
            const delay = parseInt(el.dataset.animateDelay || '0', 10);
            const duration = parseInt(el.dataset.animateDuration || '400', 10);

            el.style.opacity = '0';

            setTimeout(
                () => {
                    switch (animationType) {
                        case 'text-reveal':
                            this.textReveal(el, { duration });
                            break;
                        case 'heading-reveal':
                            this.headingReveal(el, { duration });
                            break;
                        case 'scale-in':
                            this.scaleIn(el, { duration });
                            break;
                        case 'slide-up':
                            this.slideIn(el, 'up', duration);
                            break;
                        case 'card-enter':
                            el.style.opacity = '1';
                            this.scaleIn(el, { duration });
                            break;
                        default:
                            this.fadeIn(el, duration);
                    }
                },
                delay + index * 50
            );
        });
    }
}

// Create singleton instance
export const animationManager = new AnimationManager();
export default AnimationManager;
