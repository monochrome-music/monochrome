import { formatTime, trackDataStore, getTrackTitle, getTrackArtists } from './utils.js';

export function initializeUIInteractions(player, api) {
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const queueBtn = document.getElementById('queue-btn');
    const queueModalOverlay = document.getElementById('queue-modal-overlay');
    const closeQueueBtn = document.getElementById('close-queue-btn');
    const queueList = document.getElementById('queue-list');
    
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
    
    // Queue modal
    queueBtn.addEventListener('click', () => {
        renderQueue();
        queueModalOverlay.style.display = 'flex';
    });
    
    closeQueueBtn.addEventListener('click', () => {
        queueModalOverlay.style.display = 'none';
    });
    
    queueModalOverlay.addEventListener('click', e => {
        if (e.target === queueModalOverlay) {
            queueModalOverlay.style.display = 'none';
        }
    });
    
    function renderQueue() {
        const currentQueue = player.getCurrentQueue();
        
        if (currentQueue.length === 0) {
            queueList.innerHTML = '<div class="placeholder-text">Queue is empty.</div>';
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
                        <img src="${api.getCoverUrl(track.album?.cover, '80')}" 
                             class="track-item-cover" loading="lazy">
                        <div class="track-item-details">
                            <div class="title">${trackTitle}</div>
                            <div class="artist">${trackArtists}</div>
                        </div>
                    </div>
                    <div class="track-item-duration">${formatTime(track.duration)}</div>
                    <button class="track-menu-btn" data-track-index="${index}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="12" cy="5" r="1"></circle>
                            <circle cx="12" cy="19" r="1"></circle>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
        
        queueList.innerHTML = html;
        
        queueList.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);
            
            item.addEventListener('click', (e) => {
                if (e.target.closest('.track-menu-btn')) return;
                player.playAtIndex(index);
                renderQueue();
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
                    renderQueue();
                }
            });
        });
        
        queueList.querySelectorAll('.track-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.trackIndex);
                showQueueTrackMenu(e, index);
            });
        });
    }
    
    function showQueueTrackMenu(e, trackIndex) {
        const menu = document.getElementById('queue-track-menu');
        menu.style.top = `${e.pageY}px`;
        menu.style.left = `${e.pageX}px`;
        menu.classList.add('show');
        menu.dataset.trackIndex = trackIndex;
        positionContextMenu(menu, e.pageX, e.pageY, true);
        document.addEventListener('click', hideQueueTrackMenu);
    }
    
    function hideQueueTrackMenu() {
        const menu = document.getElementById('queue-track-menu');
        menu.classList.remove('show');
        document.removeEventListener('click', hideQueueTrackMenu);
    }
    
    document.getElementById('queue-track-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        const menu = document.getElementById('queue-track-menu');
        const trackIndex = parseInt(menu.dataset.trackIndex);
        
        if (action === 'remove') {
            player.removeFromQueue(trackIndex);
            renderQueue();
        }
        
        hideQueueTrackMenu();
    });
    
    function positionContextMenu(menu, x, y, preferLeft = false) {
        menu.style.display = 'block';
        menu.style.visibility = 'hidden';
        
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let finalX = x;
        let finalY = y;
        
        if (preferLeft || (x + menuRect.width > viewportWidth)) {
            finalX = x - menuRect.width;
            if (finalX < 0) {
                finalX = Math.min(x, viewportWidth - menuRect.width - 10);
            }
        }
        
        if (finalX < 10) finalX = 10;
        if (finalX + menuRect.width > viewportWidth - 10) {
            finalX = viewportWidth - menuRect.width - 10;
        }
        if (y + menuRect.height > viewportHeight) {
            finalY = Math.max(10, y - menuRect.height);
        }
        if (finalY + menuRect.height > viewportHeight - 10) {
            finalY = viewportHeight - menuRect.height - 10;
        }
        if (finalY < 10) finalY = 10;
        
        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
        menu.style.visibility = 'visible';
    }
    
    // Make renderQueue available globally for other modules
    window.renderQueueFunction = renderQueue;
    
    // Search tabs
    document.querySelectorAll('.search-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.search-tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`search-tab-${tab.dataset.tab}`).classList.add('active');
        });
    });
}