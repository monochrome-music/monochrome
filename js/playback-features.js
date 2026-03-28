// playback-features.js
// Module untuk fitur Crossfade dan Gapless Playback
// Diintegrasikan ke Player via init() di player.js

import { crossfadeSettings, gaplessPlaybackSettings } from './storage.js';
import { audioContextManager } from './audio-context.js';

/**
 * CrossfadeManager - Mengelola efek crossfade antar lagu
 * Menggunakan Web Audio API GainNode untuk fade in/out yang smooth
 */
export class CrossfadeManager {
    constructor(player) {
        this.player = player;
        this.fadeOutInterval = null;
        this.fadeInInterval = null;
        this.isFading = false;
    }

    /**
     * Memulai proses crossfade:
     * 1. Fade out audio yang sedang diputar
     * 2. Muat dan fade in lagu berikutnya secara bersamaan
     */
    async startCrossfade(onNextTrackReady) {
        if (this.isFading) return;
        if (!crossfadeSettings.isEnabled()) {
            onNextTrackReady();
            return;
        }

        const duration = crossfadeSettings.getDuration() * 1000; // konversi ke ms
        const steps = 50;
        const interval = duration / steps;
        const el = this.player.activeElement;
        const initialVolume = el.volume;

        this.isFading = true;
        this.clearFades();

        let step = 0;
        // Fade out audio saat ini
        this.fadeOutInterval = setInterval(() => {
            step++;
            const progress = step / steps;
            el.volume = Math.max(0, initialVolume * (1 - progress));
            if (step >= steps) {
                clearInterval(this.fadeOutInterval);
                this.fadeOutInterval = null;
            }
        }, interval);

        // Muat lagu berikutnya setelah setengah durasi crossfade
        setTimeout(() => {
            onNextTrackReady();
            this.isFading = false;
        }, duration / 2);

        // Setelah fade selesai, reset volume ke level asli
        setTimeout(() => {
            if (!el.paused) el.volume = initialVolume;
            this.player.applyReplayGain();
        }, duration + 100);
    }

    /**
     * Fade in audio yang baru dimuat
     * Dipanggil setelah lagu baru mulai diputar
     */
    fadeInNewTrack() {
        if (!crossfadeSettings.isEnabled()) return;

        const duration = crossfadeSettings.getDuration() * 1000;
        const steps = 50;
        const interval = duration / steps;
        const el = this.player.activeElement;
        const targetVolume = el.volume > 0 ? el.volume : parseFloat(localStorage.getItem('volume') || '0.7');

        // Mulai dari volume 0
        el.volume = 0;
        let step = 0;

        this.clearFadeIn();
        this.fadeInInterval = setInterval(() => {
            step++;
            const progress = step / steps;
            el.volume = Math.min(targetVolume, targetVolume * progress);
            if (step >= steps) {
                clearInterval(this.fadeInInterval);
                this.fadeInInterval = null;
                // Kembalikan volume ke setting yang benar via ReplayGain
                this.player.applyReplayGain();
            }
        }, interval);
    }

    clearFades() {
        if (this.fadeOutInterval) {
            clearInterval(this.fadeOutInterval);
            this.fadeOutInterval = null;
        }
        this.clearFadeIn();
    }

    clearFadeIn() {
        if (this.fadeInInterval) {
            clearInterval(this.fadeInInterval);
            this.fadeInInterval = null;
        }
    }

    destroy() {
        this.clearFades();
        this.isFading = false;
    }
}

/**
 * GaplessManager - Mengelola Gapless Playback
 * Memantau waktu sisa lagu dan mempersiapkan lagu berikutnya
 * agar diputar tanpa jeda
 */
export class GaplessManager {
    constructor(player) {
        this.player = player;
        this.preloadedAudio = null;
        this.preloadedTrackId = null;
        this.isPreloading = false;
        this._boundOnTimeUpdate = this._onTimeUpdate.bind(this);
        this._boundOnEnded = this._onEnded.bind(this);
    }

    /**
     * Aktifkan listener gapless pada elemen audio aktif
     */
    attach(audioElement) {
        this.detach();
        this._audioElement = audioElement;
        audioElement.addEventListener('timeupdate', this._boundOnTimeUpdate);
        audioElement.addEventListener('ended', this._boundOnEnded);
    }

    detach() {
        if (this._audioElement) {
            this._audioElement.removeEventListener('timeupdate', this._boundOnTimeUpdate);
            this._audioElement.removeEventListener('ended', this._boundOnEnded);
            this._audioElement = null;
        }
        this._cleanupPreload();
    }

    /**
     * Saat timeupdate: jika sisa waktu < thresholdnya, preload lagu berikutnya
     * Threshold = durasi crossfade + 2 detik buffer
     */
    _onTimeUpdate() {
        if (!gaplessPlaybackSettings.isEnabled()) return;
        const el = this._audioElement;
        if (!el || !el.duration || isNaN(el.duration)) return;

        const crossfadeDuration = crossfadeSettings.isEnabled() ? crossfadeSettings.getDuration() : 0;
        const threshold = crossfadeDuration + 2; // detik sebelum lagu habis
        const remaining = el.duration - el.currentTime;

        if (remaining <= threshold && remaining > 0) {
            this._preloadNextTrack();

            // Mulai crossfade jika diaktifkan
            if (crossfadeSettings.isEnabled() && remaining <= crossfadeDuration && !this.player.crossfadeManager.isFading) {
                this.player.crossfadeManager.startCrossfade(() => {
                    this.player.playNext();
                });
            }
        }
    }

    _onEnded() {
        // Jika crossfade aktif, lagu berikutnya sudah dimuat. Jika tidak, panggil playNext normal.
        if (!crossfadeSettings.isEnabled()) {
            // Gapless: langsung play next tanpa delay
            if (gaplessPlaybackSettings.isEnabled()) {
                this.player.playNext();
            }
        }
    }

    async _preloadNextTrack() {
        if (this.isPreloading) return;
        const nextTrack = this.player.getNextTrack();
        if (!nextTrack || nextTrack.id === this.preloadedTrackId) return;
        if (nextTrack.isLocal || nextTrack.isTracker || nextTrack.isPodcast || nextTrack.type === 'video') return;

        this.isPreloading = true;
        this.preloadedTrackId = nextTrack.id;

        try {
            // Gunakan cache dari player jika sudah ada
            if (!this.player.preloadCache.has(nextTrack.id)) {
                const streamInfo = await this.player.api.getStreamUrl(nextTrack.id, this.player.quality);
                this.player.preloadCache.set(nextTrack.id, streamInfo);
            }
        } catch (e) {
            this.preloadedTrackId = null;
        } finally {
            this.isPreloading = false;
        }
    }

    _cleanupPreload() {
        this.preloadedAudio = null;
        this.preloadedTrackId = null;
        this.isPreloading = false;
    }

    destroy() {
        this.detach();
    }
}
