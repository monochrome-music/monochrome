import { trackCloseSidePanel, trackCloseQueue, trackCloseLyrics } from './analytics.js';

export class SidePanelManager {
    constructor() {
        this.panel = document.getElementById('side-panel');
        this.titleElement = document.getElementById('side-panel-title');
        this.controlsElement = document.getElementById('side-panel-controls');
        this.contentElement = document.getElementById('side-panel-content');
        this.currentView = null; // 'queue' or 'lyrics'

        // Resize logic initialization
        this.resizer = document.getElementById('side-panel-resizer');
        this.isResizing = false;

        // Load saved width from preferences or default
        const savedWidth = localStorage.getItem('sidePanelWidth');
        if (savedWidth) {
            this.panel.style.setProperty('--side-panel-width', `${savedWidth}px`);
        }

        if (this.resizer) {
            this.resizer.addEventListener('mousedown', this.initResize.bind(this));
        }
    }

    initResize(e) {
        this.isResizing = true;
        this.panel.classList.add('resizing');
        this.resizer.classList.add('active');

        // Prevent text selection while dragging
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ew-resize';

        // Bind handlers to "this" context
        this.onMouseMove = this.resize.bind(this);
        this.onMouseUp = this.stopResize.bind(this);

        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
    }

    resize(e) {
        if (!this.isResizing) return;

        // Calculate new width: viewport width - cursor X position
        // This makes it act like resizing from the *right edge* of the screen
        let newWidth = window.innerWidth - e.clientX;

        // Enforce basic minimum limits visually mapped to the CSS values
        if (newWidth < 300) newWidth = 300;

        // Math for 80vw constraint max
        const maxVw = window.innerWidth * 0.8;
        if (newWidth > maxVw) newWidth = maxVw;

        this.panel.style.setProperty('--side-panel-width', `${newWidth}px`);
    }

    stopResize(e) {
        this.isResizing = false;
        this.panel.classList.remove('resizing');
        this.resizer.classList.remove('active');

        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);

        // Save width preference
        const finalWidth = parseInt(getComputedStyle(this.panel).getPropertyValue('--side-panel-width'));
        if (!isNaN(finalWidth)) {
            localStorage.setItem('sidePanelWidth', finalWidth);
        }
    }

    open(view, title, renderControlsCallback, renderContentCallback, forceOpen = false) {
        // If clicking the same view that is already open, close it
        if (!forceOpen && this.currentView === view && this.panel.classList.contains('active')) {
            this.close();
            return;
        }

        this.currentView = view;
        this.panel.dataset.view = view;
        this.titleElement.textContent = title;

        // Clear previous content
        this.controlsElement.innerHTML = '';
        this.contentElement.innerHTML = '';

        // Render new content
        if (renderControlsCallback) renderControlsCallback(this.controlsElement);
        if (renderContentCallback) renderContentCallback(this.contentElement);

        this.panel.classList.add('active');
    }

    close() {
        // Track side panel close
        if (this.currentView) {
            trackCloseSidePanel();
            if (this.currentView === 'queue') {
                trackCloseQueue();
            } else if (this.currentView === 'lyrics') {
                // Get current track from audio player context
                const audioPlayer = document.getElementById('audio-player');
                if (audioPlayer && audioPlayer._currentTrack) {
                    trackCloseLyrics(audioPlayer._currentTrack);
                }
            }
        }

        this.panel.classList.remove('active');
        this.currentView = null;
        // Optionally clear content after transition
        setTimeout(() => {
            if (!this.panel.classList.contains('active')) {
                this.controlsElement.innerHTML = '';
                this.contentElement.innerHTML = '';
            }
        }, 300);
    }

    isActive(view) {
        return this.currentView === view && this.panel.classList.contains('active');
    }

    refresh(view, renderControlsCallback, renderContentCallback) {
        if (this.isActive(view)) {
            if (renderControlsCallback) {
                this.controlsElement.innerHTML = '';
                renderControlsCallback(this.controlsElement);
            }
            if (renderContentCallback) {
                this.contentElement.innerHTML = '';
                renderContentCallback(this.contentElement);
            }
        }
    }

    updateContent(view, renderContentCallback) {
        if (this.isActive(view)) {
            this.contentElement.innerHTML = '';
            renderContentCallback(this.contentElement);
        }
    }
}

export const sidePanelManager = new SidePanelManager();
