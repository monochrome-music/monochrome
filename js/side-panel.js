import { trackCloseSidePanel, trackCloseQueue, trackCloseLyrics } from './analytics.js';

export class SidePanelManager {
    constructor() {
        this.panel = document.getElementById('side-panel');
        this.titleElement = document.getElementById('side-panel-title');
        this.controlsElement = document.getElementById('side-panel-controls');
        this.contentElement = document.getElementById('side-panel-content');
        this.currentView = null; // 'queue' or 'lyrics'
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
