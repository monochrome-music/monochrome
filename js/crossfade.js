// js/crossfade.js
// Crossfade: smooth volume transitions between tracks

export class Crossfade {
  constructor(audioPlayer, player) {
    this.audioPlayer = audioPlayer;
    this.player = player;
    this.enabled = false;
    this.duration = 5; // seconds
    this._fadeInterval = null;
    this._isTransitioning = false;
    this._boundTimeUpdate = this._onTimeUpdate.bind(this);

    // Load saved settings
    const saved = localStorage.getItem('monochrome-crossfade');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        this.enabled = config.enabled || false;
        this.duration = config.duration || 5;
      } catch (e) { /* ignore */ }
    }

    if (this.enabled) {
      this._attach();
    }
  }

  _attach() {
    this.audioPlayer.addEventListener('timeupdate', this._boundTimeUpdate);
  }

  _detach() {
    this.audioPlayer.removeEventListener('timeupdate', this._boundTimeUpdate);
  }

  _onTimeUpdate() {
    if (!this.enabled || this._isTransitioning) return;
    const { currentTime, duration } = this.audioPlayer;
    if (!duration || !isFinite(duration)) return;

    const remaining = duration - currentTime;
    if (remaining <= this.duration && remaining > 0.5) {
      this._startFadeOut();
    }
  }

  _startFadeOut() {
    if (this._isTransitioning) return;
    this._isTransitioning = true;

    const startVolume = this.audioPlayer.volume;
    const steps = this.duration * 20; // 20 steps per second
    const interval = (this.duration * 1000) / steps;
    const volumeStep = startVolume / steps;
    let step = 0;

    this._fadeInterval = setInterval(() => {
      step++;
      this.audioPlayer.volume = Math.max(0, startVolume - (volumeStep * step));

      if (step >= steps) {
        clearInterval(this._fadeInterval);
        this._fadeInterval = null;
        // Trigger next track
        if (this.player && typeof this.player.playNext === 'function') {
          this.player.playNext();
        }
        // Fade in on next track
        setTimeout(() => this._startFadeIn(startVolume), 100);
      }
    }, interval);
  }

  _startFadeIn(targetVolume) {
    this.audioPlayer.volume = 0;
    const steps = this.duration * 20;
    const interval = (this.duration * 1000) / steps;
    const volumeStep = targetVolume / steps;
    let step = 0;

    const fadeIn = setInterval(() => {
      step++;
      this.audioPlayer.volume = Math.min(targetVolume, volumeStep * step);

      if (step >= steps) {
        clearInterval(fadeIn);
        this.audioPlayer.volume = targetVolume;
        this._isTransitioning = false;
      }
    }, interval);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this._attach();
    } else {
      this._detach();
      this._cancelFade();
    }
    this._save();
  }

  setDuration(seconds) {
    this.duration = Math.max(1, Math.min(12, seconds));
    this._save();
  }

  _cancelFade() {
    if (this._fadeInterval) {
      clearInterval(this._fadeInterval);
      this._fadeInterval = null;
    }
    this._isTransitioning = false;
  }

  _save() {
    localStorage.setItem('monochrome-crossfade', JSON.stringify({
      enabled: this.enabled,
      duration: this.duration,
    }));
  }

  get isEnabled() {
    return this.enabled;
  }
}
