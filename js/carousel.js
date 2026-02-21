// js/carousel.js
// Carousel component for Monochrome music player
// YouTube Music-style horizontal scrolling carousels for artists and albums
// Features: infinite scroll, dynamic loading, touch/drag support

import { animationManager } from './animation-utils.js';

/**
 * Carousel class for creating horizontal scrolling content with infinite scroll
 */
export class Carousel {
    /**
     * Create a carousel
     * @param {Object} options - Carousel options
     * @param {string} options.container - Container element or selector
     * @param {string} options.title - Carousel title
     * @param {Array} options.items - Array of items to display
     * @param {string} options.type - Carousel type: 'artist', 'album', 'playlist', 'featured'
     * @param {Function} options.onItemClick - Click handler for items
     * @param {boolean} options.showProgress - Show progress dots
     * @param {boolean} options.autoPlay - Auto-scroll carousel
     * @param {number} options.autoPlayInterval - Auto-scroll interval in ms
     * @param {Function} options.onLoadMore - Callback to load more items (receives 'left' or 'right' direction)
     * @param {number} options.pageSize - Number of items to load per page
     */
    constructor(options) {
        this.container =
            typeof options.container === 'string' ? document.querySelector(options.container) : options.container;
        this.title = options.title || 'Recommended';
        this.items = options.items || [];
        this.type = options.type || 'album';
        this.onItemClick = options.onItemClick || (() => {});
        this.showProgress = options.showProgress !== false;
        this.autoPlay = options.autoPlay || false;
        this.autoPlayInterval = options.autoPlayInterval || 5000;
        this.onLoadMore = options.onLoadMore || null;
        this.pageSize = options.pageSize || 20;
        this.scrollPosition = 0;
        this.itemWidth = 0;
        this.autoPlayTimer = null;
        this.isHovered = false;
        this.isLoading = false;
        this.hasMoreLeft = true;
        this.hasMoreRight = true;
        this.loadThreshold = 200; // Pixels from edge to trigger load

        // Touch/drag support
        this.isDragging = false;
        this.startX = 0;
        this.scrollLeft = 0;

        this.init();
    }

    /**
     * Initialize the carousel
     */
    init() {
        if (!this.container) {
            console.warn('[Carousel] Container not found');
            return;
        }

        this.render();
        this.setupEventListeners();
        this.calculateItemWidth();

        if (this.autoPlay) {
            this.startAutoPlay();
        }

        // Apply entrance animations
        this.animateEntrance();
    }

    /**
     * Render the carousel HTML
     */
    render() {
        const itemClass = this.getItemClass();

        this.container.innerHTML = `
            <div class="carousel-wrapper">
                <div class="carousel-header">
                    <h2 class="carousel-title animate-on-load">${this.title}</h2>
                    <div class="carousel-nav">
                        <button class="carousel-nav-btn prev" aria-label="Previous">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>
                        <button class="carousel-nav-btn next" aria-label="Next">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="carousel-container">
                    <div class="carousel-track">
                        ${this.items.map((item, index) => this.renderItem(item, index, itemClass)).join('')}
                    </div>
                    <div class="carousel-loading-indicator left" style="display: none;">
                        <div class="loading-spinner"></div>
                    </div>
                    <div class="carousel-loading-indicator right" style="display: none;">
                        <div class="loading-spinner"></div>
                    </div>
                </div>
                ${
                    this.showProgress
                        ? `
                    <div class="carousel-progress">
                        ${this.renderProgressDots()}
                    </div>
                `
                        : ''
                }
            </div>
        `;

        // Cache DOM references
        this.wrapper = this.container.querySelector('.carousel-wrapper');
        this.track = this.container.querySelector('.carousel-track');
        this.prevBtn = this.container.querySelector('.carousel-nav-btn.prev');
        this.nextBtn = this.container.querySelector('.carousel-nav-btn.next');
        this.progressDots = this.container.querySelectorAll('.carousel-progress-dot');
    }

    /**
     * Get the item class based on carousel type
     * @returns {string} CSS class for items
     */
    getItemClass() {
        const classes = {
            artist: 'carousel-item-artist',
            album: 'carousel-item-album',
            playlist: 'carousel-item-album',
            featured: 'carousel-item-large',
        };
        return classes[this.type] || 'carousel-item-album';
    }

    /**
     * Render a single carousel item
     * @param {Object} item - Item data
     * @param {number} index - Item index
     * @param {string} itemClass - CSS class for the item
     * @returns {string} HTML string
     */
    renderItem(item, index, itemClass) {
        const image = item.image || item.cover || item.album?.image || '';
        const title = item.name || item.title || 'Unknown';
        const subtitle = item.artist?.name || item.artist || '';
        const id = item.id || index;

        return `
            <div class="carousel-item ${itemClass} stagger-${(index % 10) + 1}" 
                 data-id="${id}" 
                 data-index="${index}">
                <div class="card-image">
                    ${
                        image
                            ? `<img src="${image}" alt="${title}" loading="lazy" />`
                            : `<div class="card-image-placeholder">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                        </svg>
                    </div>`
                    }
                </div>
                <div class="card-info">
                    <span class="card-title">${title}</span>
                    ${subtitle ? `<span class="card-subtitle">${subtitle}</span>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Render progress dots
     * @returns {string} HTML string
     */
    renderProgressDots() {
        const visiblePages = Math.ceil(this.items.length / this.getVisibleCount());
        return Array(Math.min(visiblePages, 10))
            .fill(0)
            .map((_, i) => `<div class="carousel-progress-dot ${i === 0 ? 'active' : ''}" data-page="${i}"></div>`)
            .join('');
    }

    /**
     * Calculate the width of a single item
     */
    calculateItemWidth() {
        const firstItem = this.track.querySelector('.carousel-item');
        if (firstItem) {
            const style = getComputedStyle(firstItem);
            const gap = parseFloat(getComputedStyle(this.track).gap) || 16;
            this.itemWidth = firstItem.offsetWidth + gap;
        }
    }

    /**
     * Get the number of visible items
     * @returns {number} Visible item count
     */
    getVisibleCount() {
        const containerWidth = this.track?.parentElement?.offsetWidth || 800;
        return Math.floor(containerWidth / (this.itemWidth || 200));
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Navigation buttons
        if (this.prevBtn) {
            this.prevBtn.addEventListener('click', () => this.scrollPrev());
        }
        if (this.nextBtn) {
            this.nextBtn.addEventListener('click', () => this.scrollNext());
        }

        // Item clicks
        this.track.addEventListener('click', (e) => {
            // Don't trigger click if we were dragging
            if (this.isDragging) return;

            const item = e.target.closest('.carousel-item');
            if (item) {
                const index = parseInt(item.dataset.index, 10);
                this.onItemClick(this.items[index], index);
            }
        });

        // Hover state for auto-play pause
        this.wrapper.addEventListener('mouseenter', () => {
            this.isHovered = true;
            if (this.autoPlay) {
                this.stopAutoPlay();
            }
        });

        this.wrapper.addEventListener('mouseleave', () => {
            this.isHovered = false;
            if (this.autoPlay) {
                this.startAutoPlay();
            }
        });

        // Scroll event for progress updates and infinite scroll
        this.track.addEventListener('scroll', () => {
            this.updateProgress();
            this.checkInfiniteScroll();
        });

        // Touch/drag support for horizontal scrolling
        this.setupDragScroll();

        // Progress dot clicks
        this.progressDots.forEach((dot) => {
            dot.addEventListener('click', () => {
                const page = parseInt(dot.dataset.page, 10);
                this.scrollToPage(page);
            });
        });

        // Keyboard navigation
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                this.scrollPrev();
            } else if (e.key === 'ArrowRight') {
                this.scrollNext();
            }
        });

        // Resize handler
        window.addEventListener('resize', () => {
            this.calculateItemWidth();
            this.updateNavigationState();
        });

        // Cache loading indicators
        this.loadingLeft = this.container.querySelector('.carousel-loading-indicator.left');
        this.loadingRight = this.container.querySelector('.carousel-loading-indicator.right');
    }

    /**
     * Setup drag-to-scroll functionality
     */
    setupDragScroll() {
        this.track.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.startX = e.pageX - this.track.offsetLeft;
            this.scrollLeft = this.track.scrollLeft;
            this.track.style.cursor = 'grabbing';
            this.track.style.userSelect = 'none';
        });

        this.track.addEventListener('mouseleave', () => {
            this.isDragging = false;
            this.track.style.cursor = 'grab';
            this.track.style.userSelect = '';
        });

        this.track.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.track.style.cursor = 'grab';
            this.track.style.userSelect = '';
        });

        this.track.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            const x = e.pageX - this.track.offsetLeft;
            const walk = (x - this.startX) * 1.5; // Scroll speed multiplier
            this.track.scrollLeft = this.scrollLeft - walk;
        });

        // Touch events for mobile
        this.track.addEventListener(
            'touchstart',
            (e) => {
                this.startX = e.touches[0].pageX - this.track.offsetLeft;
                this.scrollLeft = this.track.scrollLeft;
            },
            { passive: true }
        );

        this.track.addEventListener(
            'touchmove',
            (e) => {
                const x = e.touches[0].pageX - this.track.offsetLeft;
                const walk = (x - this.startX) * 1.5;
                this.track.scrollLeft = this.scrollLeft - walk;
            },
            { passive: true }
        );

        // Set initial cursor
        this.track.style.cursor = 'grab';
    }

    /**
     * Check for infinite scroll loading
     */
    checkInfiniteScroll() {
        if (!this.onLoadMore || this.isLoading) return;

        const scrollLeft = this.track.scrollLeft;
        const maxScroll = this.track.scrollWidth - this.track.clientWidth;

        // Check if near right edge
        if (this.hasMoreRight && maxScroll - scrollLeft < this.loadThreshold) {
            this.loadMore('right');
        }

        // Check if near left edge
        if (this.hasMoreLeft && scrollLeft < this.loadThreshold) {
            this.loadMore('left');
        }
    }

    /**
     * Load more items dynamically
     * @param {string} direction - 'left' or 'right'
     */
    async loadMore(direction) {
        if (this.isLoading) return;
        this.isLoading = true;

        // Show loading indicator
        const indicator = direction === 'left' ? this.loadingLeft : this.loadingRight;
        if (indicator) indicator.style.display = 'flex';

        try {
            const newItems = await this.onLoadMore(direction, this.pageSize);

            if (newItems && newItems.length > 0) {
                const itemClass = this.getItemClass();
                const scrollBefore = this.track.scrollLeft;

                if (direction === 'right') {
                    // Add items to the end
                    newItems.forEach((item, index) => {
                        const itemElement = this.createItemElement(item, this.items.length + index, itemClass);
                        this.track.appendChild(itemElement);
                    });
                    this.items.push(...newItems);
                } else {
                    // Add items to the beginning
                    const fragment = document.createDocumentFragment();
                    newItems.forEach((item, index) => {
                        const itemElement = this.createItemElement(item, index, itemClass);
                        fragment.prepend(itemElement);
                    });
                    this.track.prepend(fragment);

                    // Update all item indices
                    this.items = [...newItems, ...this.items];
                    this.updateItemIndices();

                    // Maintain scroll position
                    const newScrollLeft = scrollBefore + newItems.length * this.itemWidth;
                    this.track.scrollLeft = newScrollLeft;
                }
            } else {
                // No more items in this direction
                if (direction === 'left') this.hasMoreLeft = false;
                if (direction === 'right') this.hasMoreRight = false;
            }
        } catch (error) {
            console.warn('[Carousel] Failed to load more items:', error);
        } finally {
            this.isLoading = false;
            if (indicator) indicator.style.display = 'none';
        }
    }

    /**
     * Create an item element
     * @param {Object} item - Item data
     * @param {number} index - Item index
     * @param {string} itemClass - CSS class
     * @returns {HTMLElement} Item element
     */
    createItemElement(item, index, itemClass) {
        const template = document.createElement('div');
        template.innerHTML = this.renderItem(item, index, itemClass);
        return template.firstElementChild;
    }

    /**
     * Update item indices after adding items to the beginning
     */
    updateItemIndices() {
        const items = this.track.querySelectorAll('.carousel-item');
        items.forEach((item, index) => {
            item.dataset.index = index;
        });
    }

    /**
     * Scroll to previous items
     */
    scrollPrev() {
        const scrollAmount = this.itemWidth * this.getVisibleCount();
        this.track.scrollBy({
            left: -scrollAmount,
            behavior: 'smooth',
        });
    }

    /**
     * Scroll to next items
     */
    scrollNext() {
        const scrollAmount = this.itemWidth * this.getVisibleCount();
        this.track.scrollBy({
            left: scrollAmount,
            behavior: 'smooth',
        });
    }

    /**
     * Scroll to a specific page
     * @param {number} page - Page index
     */
    scrollToPage(page) {
        const scrollAmount = page * this.itemWidth * this.getVisibleCount();
        this.track.scrollTo({
            left: scrollAmount,
            behavior: 'smooth',
        });
    }

    /**
     * Update progress indicator
     */
    updateProgress() {
        if (!this.showProgress || !this.progressDots.length) return;

        const scrollLeft = this.track.scrollLeft;
        const maxScroll = this.track.scrollWidth - this.track.clientWidth;
        const progress = scrollLeft / maxScroll;
        const activePage = Math.round(progress * (this.progressDots.length - 1));

        this.progressDots.forEach((dot, i) => {
            dot.classList.toggle('active', i === activePage);
        });

        this.updateNavigationState();
    }

    /**
     * Update navigation button states
     */
    updateNavigationState() {
        if (this.prevBtn) {
            this.prevBtn.disabled = this.track.scrollLeft <= 0;
        }
        if (this.nextBtn) {
            const maxScroll = this.track.scrollWidth - this.track.clientWidth;
            this.nextBtn.disabled = this.track.scrollLeft >= maxScroll - 5;
        }
    }

    /**
     * Start auto-play
     */
    startAutoPlay() {
        if (this.autoPlayTimer) return;

        this.autoPlayTimer = setInterval(() => {
            if (this.isHovered) return;

            const maxScroll = this.track.scrollWidth - this.track.clientWidth;
            if (this.track.scrollLeft >= maxScroll - 5) {
                // Reset to start
                this.track.scrollTo({
                    left: 0,
                    behavior: 'smooth',
                });
            } else {
                this.scrollNext();
            }
        }, this.autoPlayInterval);
    }

    /**
     * Stop auto-play
     */
    stopAutoPlay() {
        if (this.autoPlayTimer) {
            clearInterval(this.autoPlayTimer);
            this.autoPlayTimer = null;
        }
    }

    /**
     * Apply entrance animations
     */
    animateEntrance() {
        // Animate title
        const title = this.container.querySelector('.carousel-title');
        if (title) {
            animationManager.fadeIn(title, { duration: 400 });
        }

        // Animate items with stagger
        const items = this.container.querySelectorAll('.carousel-item');
        items.forEach((item, index) => {
            const delay = Math.min(index * 50, 500);
            setTimeout(() => {
                item.style.opacity = '1';
                animationManager.scaleIn(item, { duration: 300, easing: 'ease-out' });
            }, delay);
        });
    }

    /**
     * Update carousel items
     * @param {Array} newItems - New items array
     */
    updateItems(newItems) {
        this.items = newItems;
        this.render();
        this.setupEventListeners();
        this.calculateItemWidth();
        this.animateEntrance();
    }

    /**
     * Destroy the carousel
     */
    destroy() {
        this.stopAutoPlay();
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

/**
 * Create a carousel for recommended artists
 * @param {HTMLElement} container - Container element
 * @param {Array} artists - Array of artist objects
 * @param {Function} onClick - Click handler
 * @returns {Carousel} Carousel instance
 */
export function createArtistCarousel(container, artists, onClick) {
    return new Carousel({
        container,
        title: 'Recommended Artists',
        items: artists,
        type: 'artist',
        onItemClick: onClick,
        showProgress: true,
    });
}

/**
 * Create a carousel for recommended albums
 * @param {HTMLElement} container - Container element
 * @param {Array} albums - Array of album objects
 * @param {Function} onClick - Click handler
 * @returns {Carousel} Carousel instance
 */
export function createAlbumCarousel(container, albums, onClick) {
    return new Carousel({
        container,
        title: 'Recommended Albums',
        items: albums,
        type: 'album',
        onItemClick: onClick,
        showProgress: true,
    });
}

/**
 * Create a featured carousel for hero content
 * @param {HTMLElement} container - Container element
 * @param {Array} items - Array of featured items
 * @param {Function} onClick - Click handler
 * @returns {Carousel} Carousel instance
 */
export function createFeaturedCarousel(container, items, onClick) {
    return new Carousel({
        container,
        title: 'Featured',
        items,
        type: 'featured',
        onItemClick: onClick,
        showProgress: true,
        autoPlay: true,
        autoPlayInterval: 6000,
    });
}

// Export singleton instance for global use
export const carouselManager = {
    create: (options) => new Carousel(options),
    createArtistCarousel,
    createAlbumCarousel,
    createFeaturedCarousel,
};

export default Carousel;
