//js/ui-interactions.js
import { SVG_CLOSE, SVG_BIN, formatTime, trackDataStore, getTrackTitle, getTrackArtists } from './utils.js';
import { sidePanelManager } from './side-panel.js';

export function initializeUIInteractions(player, api) {
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const queueBtn = document.getElementById('queue-btn');

    let draggedQueueIndex = null;

    // Sidebar mobile
    hamburgerBtn.addEventListener('click', () => {
        sidebar.classList.add('is-open');
        sidebarOverlay.classList.add('is-visible');
    });

    const closeSidebar = () => {
        sidebar.classList.remove('is-open');
        sidebarOverlay.classList.remove('is-visible');
    };

    sidebarOverlay.addEventListener('click', closeSidebar);

    sidebar.addEventListener('click', e => {
        if (e.target.closest('a')) {
            closeSidebar();
        }
    });

    // Queue panel
    const renderQueueControls = (container) => {
        const currentQueue = player.getCurrentQueue();
        const showClearBtn = currentQueue.length > 0;

        container.innerHTML = `
            <button id="clear-queue-btn" class="btn-icon" title="Clear Queue" style="display: ${showClearBtn ? 'flex' : 'none'}">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
            <button id="close-side-panel-btn" class="btn-icon" title="Close">
                ${SVG_CLOSE}
            </button>
        `;

        container.querySelector('#close-side-panel-btn').addEventListener('click', () => {
            sidePanelManager.close();
        });

        const clearBtn = container.querySelector('#clear-queue-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                player.clearQueue();
                refreshQueuePanel();
            });
        }
    };

    const renderQueueContent = (container) => {
        const currentQueue = player.getCurrentQueue();

        if (currentQueue.length === 0) {
            container.innerHTML = '<div class="placeholder-text">Queue is empty.</div>';
            return;
        }

        const html = currentQueue.map((track, index) => {
            const isPlaying = index === player.currentQueueIndex;
            const trackTitle = getTrackTitle(track);
            const trackArtists = getTrackArtists(track, { fallback: "Unknown" });

            return `
                <div class="queue-track-item ${isPlaying ? 'playing' : ''}" data-queue-index="${index}" data-track-id="${track.id}" draggable="true">
                    <div class="drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="8" x2="19" y2="8"></line>
                            <line x1="5" y1="16" x2="19" y2="16"></line>
                        </svg>
                    </div>
                    <div class="track-item-info">
                        <img src="${api.getCoverUrl(track.album?.cover)}"
                             class="track-item-cover" loading="lazy">
                        <div class="track-item-details">
                            <div class="title">${trackTitle}</div>
                            <div class="artist">${trackArtists}</div>
                        </div>
                    </div>
                    <div class="track-item-duration">${formatTime(track.duration)}</div>
                    <button class="queue-remove-btn" data-track-index="${index}" title="Remove from queue">
                        ${SVG_BIN}
                    </button>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        container.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);

            item.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.queue-remove-btn');
                if (removeBtn) {
                    e.stopPropagation();
                    player.removeFromQueue(index);
                    refreshQueuePanel();
                    return;
                }
                player.playAtIndex(index);
                refreshQueuePanel();
            });

            item.addEventListener('dragstart', (e) => {
                draggedQueueIndex = index;
                item.style.opacity = '0.5';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedQueueIndex !== null && draggedQueueIndex !== index) {
                    player.moveInQueue(draggedQueueIndex, index);
                    refreshQueuePanel();
                }
            });
        });
    };

    const refreshQueuePanel = () => {
        sidePanelManager.refresh('queue', renderQueueControls, renderQueueContent);
    };

    const openQueuePanel = () => {
        sidePanelManager.open('queue', 'Queue', renderQueueControls, renderQueueContent);
    };

    queueBtn.addEventListener('click', openQueuePanel);

    // Expose renderQueue for external updates (e.g. shuffle, add to queue)
    window.renderQueueFunction = () => {
        if (sidePanelManager.isActive('queue')) {
            refreshQueuePanel();
        }
    };

    // Search and Library tabs
    document.querySelectorAll('.search-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const page = tab.closest('.page');
            if (!page) return;

            page.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
            page.querySelectorAll('.search-tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            
            const prefix = page.id === 'page-library' ? 'library-tab-' : 'search-tab-';
            const contentId = `${prefix}${tab.dataset.tab}`;
            document.getElementById(contentId)?.classList.add('active');
        });
    });
}
