// js/ab-loop.js
// A-B Loop: Repeat a specific section of a track
// Usage: Set point A and point B, audio will loop between them

export class ABLoop {
  constructor(player) {
    this.player = player;
    this.pointA = null;
    this.pointB = null;
    this.enabled = false;
    this.loopCount = 0;
    this.maxLoops = Infinity;
    this._onTimeUpdate = this._onTimeUpdate.bind(this);
  }

  setPointA(time) {
    if (time === undefined || time === null) {
      const audio = this.player.audio || this.player.audioElement;
      if (audio) time = audio.currentTime;
      else return;
    }
    this.pointA = Math.max(0, time);
    if (this.pointB !== null && this.pointA >= this.pointB) {
      this.pointB = null;
    }
    this.loopCount = 0;
    this._dispatchEvent('ab-loop-update');
  }

  setPointB(time) {
    if (time === undefined || time === null) {
      const audio = this.player.audio || this.player.audioElement;
      if (audio) time = audio.currentTime;
      else return;
    }
    if (this.pointA === null) return;
    if (time <= this.pointA) return;
    this.pointB = time;
    this.enabled = true;
    this.loopCount = 0;
    this._attachListener();
    this._dispatchEvent('ab-loop-update');
  }

  toggle() {
    if (this.pointA !== null && this.pointB !== null) {
      this.enabled = !this.enabled;
      if (this.enabled) {
        this._attachListener();
      } else {
        this._detachListener();
      }
      this._dispatchEvent('ab-loop-update');
    }
  }

  clear() {
    this.pointA = null;
    this.pointB = null;
    this.enabled = false;
    this.loopCount = 0;
    this.maxLoops = Infinity;
    this._detachListener();
    this._dispatchEvent('ab-loop-update');
  }

  setMaxLoops(n) {
    this.maxLoops = n > 0 ? n : Infinity;
  }

  getState() {
    return {
      pointA: this.pointA,
      pointB: this.pointB,
      enabled: this.enabled,
      loopCount: this.loopCount,
      maxLoops: this.maxLoops,
    };
  }

  _getAudio() {
    return this.player.audio || this.player.audioElement || null;
  }

  _attachListener() {
    const audio = this._getAudio();
    if (audio) {
      audio.removeEventListener('timeupdate', this._onTimeUpdate);
      audio.addEventListener('timeupdate', this._onTimeUpdate);
    }
  }

  _detachListener() {
    const audio = this._getAudio();
    if (audio) {
      audio.removeEventListener('timeupdate', this._onTimeUpdate);
    }
  }

  _onTimeUpdate() {
    if (!this.enabled || this.pointA === null || this.pointB === null) return;
    const audio = this._getAudio();
    if (!audio) return;
    if (audio.currentTime >= this.pointB) {
      this.loopCount++;
      if (this.loopCount >= this.maxLoops) {
        this.enabled = false;
        this._detachListener();
        this._dispatchEvent('ab-loop-update');
        return;
      }
      audio.currentTime = this.pointA;
      this._dispatchEvent('ab-loop-looped');
    }
  }

  _dispatchEvent(name) {
    window.dispatchEvent(new CustomEvent(name, { detail: this.getState() }));
  }

  destroy() {
    this._detachListener();
    this.clear();
  }
}
