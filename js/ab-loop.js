// js/ab-loop.js
// A-B Loop: Repeat a specific section of a track with visible UI button

export class ABLoop {
  constructor(player, audioPlayer) {
    this.player = player;
    this.audioPlayer = audioPlayer;
    this.pointA = null;
    this.pointB = null;
    this.enabled = false;
    this.loopCount = 0;
    this.maxLoops = Infinity;
    this._onTimeUpdate = this._onTimeUpdate.bind(this);
    this._btn = null;
    this._indicator = null;
    this._createUI();
  }

  _createUI() {
    // Create A-B loop button next to repeat button
    const repeatBtn = document.getElementById('repeat-btn');
    if (!repeatBtn) return;

    const btn = document.createElement('button');
    btn.id = 'ab-loop-btn';
    btn.className = 'player-btn';
    btn.title = 'A-B Loop: Click to set point A';
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4l3-3 3 3h4"/><path d="M2 18h4l3 3 3-3h4"/><line x1="2" y1="6" x2="2" y2="18"/><line x1="16" y1="6" x2="16" y2="18"/><text x="5" y="14" font-size="8" fill="currentColor" stroke="none" font-weight="bold">AB</text></svg>`;
    btn.style.cssText = 'background:none;border:none;color:var(--muted-foreground);cursor:pointer;padding:4px;display:flex;align-items:center;opacity:0.6;transition:all 0.2s;font-size:11px;position:relative;';

    // Insert after repeat button
    repeatBtn.parentNode.insertBefore(btn, repeatBtn.nextSibling);
    this._btn = btn;

    // Create indicator text
    const indicator = document.createElement('span');
    indicator.id = 'ab-loop-indicator';
    indicator.style.cssText = 'display:none;font-size:9px;color:var(--primary);position:absolute;top:-12px;left:50%;transform:translateX(-50%);white-space:nowrap;pointer-events:none;';
    btn.appendChild(indicator);
    this._indicator = indicator;

    // Click handler - cycles through: none -> A set -> A+B set (active) -> clear
    btn.addEventListener('click', () => this._handleClick());
  }

  _handleClick() {
    if (this.pointA === null) {
      // Set point A
      this.setPointA();
      this._btn.style.opacity = '0.8';
      this._btn.style.color = 'var(--primary)';
      this._btn.title = `A: ${this._formatTime(this.pointA)} | Click to set B`;
      this._indicator.textContent = `A: ${this._formatTime(this.pointA)}`;
      this._indicator.style.display = 'block';
    } else if (this.pointB === null) {
      // Set point B
      this.setPointB();
      if (this.pointB !== null) {
        this._btn.style.opacity = '1';
        this._btn.style.color = 'var(--primary)';
        this._btn.title = `Looping ${this._formatTime(this.pointA)} - ${this._formatTime(this.pointB)} | Click to clear`;
        this._indicator.textContent = `${this._formatTime(this.pointA)}-${this._formatTime(this.pointB)}`;
        this._indicator.style.display = 'block';
      }
    } else {
      // Clear loop
      this.clear();
      this._btn.style.opacity = '0.6';
      this._btn.style.color = 'var(--muted-foreground)';
      this._btn.title = 'A-B Loop: Click to set point A';
      this._indicator.style.display = 'none';
    }
  }

  _formatTime(seconds) {
    if (seconds === null) return '--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  setPointA(time) {
    if (time === undefined || time === null) {
      const audio = this.audioPlayer;
      if (audio) time = audio.currentTime;
      else return;
    }
    this.pointA = Math.max(0, time);
    if (this.pointB !== null && this.pointA >= this.pointB) {
      this.pointB = null;
    }
    this.loopCount = 0;
  }

  setPointB(time) {
    if (time === undefined || time === null) {
      const audio = this.audioPlayer;
      if (audio) time = audio.currentTime;
      else return;
    }
    if (this.pointA === null) return;
    if (time <= this.pointA) return;
    this.pointB = time;
    this.enabled = true;
    this.loopCount = 0;
    this._attachListener();
  }

  clear() {
    this.pointA = null;
    this.pointB = null;
    this.enabled = false;
    this.loopCount = 0;
    this._detachListener();
  }

  _attachListener() {
    if (!this.audioPlayer) return;
    this.audioPlayer.removeEventListener('timeupdate', this._onTimeUpdate);
    this.audioPlayer.addEventListener('timeupdate', this._onTimeUpdate);
  }

  _detachListener() {
    if (!this.audioPlayer) return;
    this.audioPlayer.removeEventListener('timeupdate', this._onTimeUpdate);
  }

  _onTimeUpdate() {
    if (!this.enabled || this.pointA === null || this.pointB === null) return;
    const audio = this.audioPlayer;
    if (!audio) return;
    if (audio.currentTime >= this.pointB) {
      audio.currentTime = this.pointA;
      this.loopCount++;
      if (this.maxLoops !== Infinity && this.loopCount >= this.maxLoops) {
        this.clear();
        if (this._btn) {
          this._btn.style.opacity = '0.6';
          this._btn.style.color = 'var(--muted-foreground)';
          this._indicator.style.display = 'none';
        }
      }
    }
  }
}
