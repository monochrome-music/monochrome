// js/sleep-timer.js
// Sleep Timer: auto-stop playback after a set duration or at end of current track

export class SleepTimer {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.timerId = null;
    this.endTime = null;
    this.mode = null;
    this.tracksRemaining = 0;
    this.fadeOutDuration = 15000;
    this.originalVolume = 1;
    this._onTrackEnd = this._onTrackEnd.bind(this);
    this._tickInterval = null;
    this._callbacks = new Set();
    this._btn = null;
    this._moved = false;
    this._initUI();
  }

  _initUI() {
    // Use polling + MutationObserver to find and move #sleep-timer-btn-desktop
    // This button is created by player.js AFTER our module loads
    const tryMove = () => {
      if (this._moved) return true;
      const desktopBtn = document.querySelector('#sleep-timer-btn-desktop');
      const likeBtn = document.querySelector('#now-playing-like-btn');
      if (desktopBtn && likeBtn && likeBtn.parentNode) {
        // Move the desktop button to be BEFORE the like/heart button
        likeBtn.parentNode.insertBefore(desktopBtn, likeBtn);
        this._btn = desktopBtn;
        // Attach our modal click handler
        desktopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._showModal();
        });
        this._moved = true;
        console.log('[SleepTimer] Moved desktop button before like button');
        return true;
      }
      return false;
    };

    // Try immediately
    if (tryMove()) return;

    // Poll every 500ms for up to 30 seconds
    let attempts = 0;
    const maxAttempts = 60;
    const pollInterval = setInterval(() => {
      attempts++;
      if (tryMove() || attempts >= maxAttempts) {
        clearInterval(pollInterval);
        if (!this._moved) {
          console.log('[SleepTimer] Desktop button not found after polling, creating fallback');
          this._createFallbackButton();
        }
      }
    }, 500);

    // Also use MutationObserver as backup
    const observer = new MutationObserver(() => {
      if (tryMove()) {
        observer.disconnect();
        clearInterval(pollInterval);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Auto-disconnect observer after 30s
    setTimeout(() => observer.disconnect(), 30000);
  }

  _createFallbackButton() {
    const likeBtn = document.querySelector('#now-playing-like-btn');
    if (!likeBtn || !likeBtn.parentNode) return;
    if (document.querySelector('.sleep-timer-feature-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'sleep-timer-feature-btn';
    btn.title = 'Sleep Timer';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    btn.style.cssText = 'background:none;border:none;color:var(--text-secondary,#8b8fa3);cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center;opacity:0.7;transition:all 0.2s;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showModal();
    });
    btn.addEventListener('mouseenter', () => { if (!this.isActive) btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { if (!this.isActive) btn.style.opacity = '0.7'; });
    this._btn = btn;
    likeBtn.parentNode.insertBefore(btn, likeBtn);
    this._moved = true;
    console.log('[SleepTimer] Fallback button created before like button');
  }

  _showModal() {
    document.getElementById('sleep-timer-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'sleep-timer-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);';
    const isActive = this.isActive;
    const remaining = this.getRemaining();
    modal.innerHTML = `
      <div style="background:var(--bg-secondary,#1a1a2e);border-radius:16px;padding:24px;min-width:320px;max-width:400px;color:var(--text-primary,#fff);box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;font-size:18px;">Sleep Timer</h3>
          <button id="sleep-timer-close" style="background:none;border:none;color:var(--text-secondary,#8b8fa3);cursor:pointer;font-size:20px;">&times;</button>
        </div>
        ${isActive ? `
          <div style="text-align:center;padding:20px 0;">
            <div id="sleep-timer-countdown" style="font-size:36px;font-weight:bold;color:var(--accent,#00d4ff);">${this._formatTime(remaining)}</div>
            <div style="color:var(--text-secondary,#8b8fa3);margin-top:8px;">remaining</div>
            <button id="sleep-timer-cancel" style="margin-top:16px;padding:10px 24px;border-radius:8px;border:1px solid var(--border,#333);background:none;color:var(--text-primary,#fff);cursor:pointer;">Cancel Timer</button>
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
            ${[5,10,15,20,30,45,60,90].map(m => `<button class="sleep-timer-preset" data-minutes="${m}" style="padding:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary,#fff);cursor:pointer;transition:all 0.2s;">${m < 60 ? m + ' min' : (m/60) + ' hr'}</button>`).join('')}
          </div>
          <button id="sleep-timer-end-of-track" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary,#fff);cursor:pointer;margin-bottom:12px;">End of current track</button>
          <div style="display:flex;gap:8px;">
            <input id="sleep-timer-custom" type="number" min="1" max="480" placeholder="min" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary,#fff);font-size:14px;">
            <button id="sleep-timer-custom-btn" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent,#00d4ff);color:#000;cursor:pointer;font-weight:600;">Set</button>
          </div>
        `}
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#sleep-timer-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    if (isActive) {
      modal.querySelector('#sleep-timer-cancel').addEventListener('click', () => { this.cancel(); modal.remove(); });
      const countdownEl = modal.querySelector('#sleep-timer-countdown');
      const iv = setInterval(() => {
        if (!this.isActive || !document.getElementById('sleep-timer-modal')) { clearInterval(iv); return; }
        countdownEl.textContent = this._formatTime(this.getRemaining());
      }, 1000);
    } else {
      modal.querySelectorAll('.sleep-timer-preset').forEach(btn => {
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--accent,#00d4ff)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'var(--bg-tertiary,#252540)');
        btn.addEventListener('click', () => { this.start(parseInt(btn.dataset.minutes)*60*1000); modal.remove(); });
      });
      modal.querySelector('#sleep-timer-end-of-track')?.addEventListener('click', () => { this.startEndOfTrack(); modal.remove(); });
      modal.querySelector('#sleep-timer-custom-btn')?.addEventListener('click', () => {
        const val = parseInt(modal.querySelector('#sleep-timer-custom').value);
        if (val > 0) { this.start(val*60*1000); modal.remove(); }
      });
    }
  }

  start(durationMs) {
    this.cancel();
    this.mode = 'time';
    this.endTime = Date.now() + durationMs;
    this.originalVolume = this.audioPlayer.volume;
    this.timerId = setTimeout(() => this._fadeAndStop(), durationMs - this.fadeOutDuration);
    this._updateUI(true);
    this._notifyCallbacks('start', { duration: durationMs });
  }

  startEndOfTrack() {
    this.cancel();
    this.mode = 'track-end';
    this.audioPlayer.addEventListener('ended', this._onTrackEnd);
    this._updateUI(true);
    this._notifyCallbacks('start', { mode: 'track-end' });
  }

  _onTrackEnd() {
    this.audioPlayer.removeEventListener('ended', this._onTrackEnd);
    this.audioPlayer.pause();
    this._cleanup();
    this._notifyCallbacks('triggered');
  }

  _fadeAndStop() {
    const steps = 30;
    const interval = this.fadeOutDuration / steps;
    const volumeStep = this.originalVolume / steps;
    let step = 0;
    this._tickInterval = setInterval(() => {
      step++;
      this.audioPlayer.volume = Math.max(0, this.originalVolume - (volumeStep * step));
      if (step >= steps) {
        clearInterval(this._tickInterval);
        this.audioPlayer.pause();
        this.audioPlayer.volume = this.originalVolume;
        this._cleanup();
        this._notifyCallbacks('triggered');
      }
    }, interval);
  }

  cancel() {
    if (this.timerId) clearTimeout(this.timerId);
    if (this._tickInterval) clearInterval(this._tickInterval);
    this.audioPlayer.removeEventListener('ended', this._onTrackEnd);
    if (this.originalVolume && this.audioPlayer) this.audioPlayer.volume = this.originalVolume;
    this._cleanup();
    this._notifyCallbacks('cancel');
  }

  _cleanup() {
    this.timerId = null;
    this._tickInterval = null;
    this.endTime = null;
    this.mode = null;
    this._updateUI(false);
  }

  _updateUI(active) {
    if (!this._btn) return;
    if (active) {
      this._btn.style.opacity = '1';
      this._btn.style.color = 'var(--accent,#00d4ff)';
      this._btn.title = 'Sleep Timer (active)';
    } else {
      this._btn.style.opacity = '0.7';
      this._btn.style.color = 'var(--text-secondary,#8b8fa3)';
      this._btn.title = 'Sleep Timer';
    }
  }

  get isActive() { return this.mode !== null; }

  getRemaining() {
    if (this.mode === 'time' && this.endTime) return Math.max(0, this.endTime - Date.now());
    if (this.mode === 'track-end' && this.audioPlayer) {
      const r = this.audioPlayer.duration - this.audioPlayer.currentTime;
      return isFinite(r) ? r * 1000 : 0;
    }
    return 0;
  }

  _formatTime(ms) {
    const t = Math.ceil(ms / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  onChange(cb) { this._callbacks.add(cb); return () => this._callbacks.delete(cb); }
  _notifyCallbacks(event, data = {}) { this._callbacks.forEach(cb => cb({ event, ...data })); }
}
