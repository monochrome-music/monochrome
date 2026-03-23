// js/sleep-timer.js
// Sleep Timer: auto-stop playback after a set duration or at end of current track

export class SleepTimer {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.timerId = null;
    this.endTime = null;
    this.mode = null; // 'time' or 'tracks'
    this.tracksRemaining = 0;
    this.fadeOutDuration = 15000; // 15s fade out
    this.originalVolume = 1;
    this._onTrackEnd = this._onTrackEnd.bind(this);
    this._tickInterval = null;
    this._callbacks = new Set();
    this._btn = null;
    this._createUI();
  }

  _createUI() {
    // Check if a built-in sleep timer button already exists (from desktop UI)
    const existingBtn = document.querySelector('#sleep-timer-btn-desktop');
    if (existingBtn) {
      // Hook into the existing button instead of creating a new one
      this._btn = existingBtn;
      existingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showModal();
      });
      return;
    }

    // Also check if we already created one
    const alreadyCreated = document.querySelector('.sleep-timer-btn-feature');
    if (alreadyCreated) {
      this._btn = alreadyCreated;
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'sleep-timer-btn-feature';
    btn.title = 'Sleep Timer';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.style.cssText = 'background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px;display:flex;align-items:center;opacity:0.7;transition:all 0.2s;';
    btn.addEventListener('click', () => this._showModal());
    btn.addEventListener('mouseenter', () => { if (!this.isActive) btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { if (!this.isActive) btn.style.opacity = '0.7'; });
    this._btn = btn;

    // Insert to the LEFT of the like/heart button
    const likeBtn = document.querySelector('#now-playing-like-btn');
    if (likeBtn && likeBtn.parentNode) {
      likeBtn.parentNode.insertBefore(btn, likeBtn);
    } else {
      // Fallback: append to extra-controls or now-playing-bar
      const controls = document.querySelector('.now-playing-bar .extra-controls')
        || document.querySelector('.now-playing-bar');
      if (controls) controls.appendChild(btn);
    }
  }

  _showModal() {
    // Remove existing modal
    document.getElementById('sleep-timer-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'sleep-timer-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
    `;

    const isActive = this.isActive;
    const remaining = this.getRemaining();

    modal.innerHTML = `
      <div style="background:var(--bg-secondary,#1a1a2e);border-radius:16px;padding:28px;max-width:380px;width:90%;border:1px solid var(--border,#333);box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 style="margin:0;color:var(--text-primary);font-size:18px;">Sleep Timer</h3>
          <button id="sleep-timer-close" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:20px;padding:4px;">&times;</button>
        </div>
        ${isActive ? `
          <div style="text-align:center;padding:20px 0;">
            <div id="sleep-timer-countdown" style="font-size:48px;font-weight:700;color:var(--accent,#00d4ff);font-variant-numeric:tabular-nums;">${this._formatTime(remaining)}</div>
            <div style="color:var(--text-secondary);margin-top:8px;">remaining</div>
            <button id="sleep-timer-cancel" style="margin-top:20px;padding:10px 28px;border-radius:20px;border:1px solid var(--accent,#00d4ff);background:none;color:var(--accent,#00d4ff);cursor:pointer;font-size:14px;transition:all 0.2s;">Cancel Timer</button>
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
            ${[5, 10, 15, 20, 30, 45, 60, 90].map(m => `
              <button class="sleep-timer-preset" data-minutes="${m}" style="padding:10px 4px;border-radius:10px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary);cursor:pointer;font-size:13px;transition:all 0.2s;">
                ${m < 60 ? m + ' min' : (m / 60) + ' hr' + (m > 60 ? 's' : '')}
              </button>
            `).join('')}
          </div>
          <button id="sleep-timer-end-of-track" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary);cursor:pointer;font-size:13px;margin-bottom:12px;transition:all 0.2s;">End of current track</button>
          <div style="display:flex;gap:8px;">
            <input id="sleep-timer-custom" type="number" min="1" max="480" placeholder="min" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary);font-size:14px;">
            <button id="sleep-timer-custom-btn" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent,#00d4ff);color:#000;cursor:pointer;font-weight:600;font-size:13px;">Set</button>
          </div>
        `}
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('#sleep-timer-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    if (isActive) {
      modal.querySelector('#sleep-timer-cancel').addEventListener('click', () => {
        this.cancel();
        modal.remove();
      });
      const countdownEl = modal.querySelector('#sleep-timer-countdown');
      const updateInterval = setInterval(() => {
        if (!this.isActive || !document.getElementById('sleep-timer-modal')) {
          clearInterval(updateInterval);
          return;
        }
        countdownEl.textContent = this._formatTime(this.getRemaining());
      }, 1000);
    } else {
      modal.querySelectorAll('.sleep-timer-preset').forEach(btn => {
        btn.addEventListener('mouseenter', () => btn.style.background = 'var(--accent,#00d4ff)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'var(--bg-tertiary,#252540)');
        btn.addEventListener('click', () => {
          this.start(parseInt(btn.dataset.minutes) * 60 * 1000);
          modal.remove();
        });
      });
      modal.querySelector('#sleep-timer-end-of-track')?.addEventListener('click', () => {
        this.startEndOfTrack();
        modal.remove();
      });
      modal.querySelector('#sleep-timer-custom-btn')?.addEventListener('click', () => {
        const val = parseInt(modal.querySelector('#sleep-timer-custom').value);
        if (val > 0) {
          this.start(val * 60 * 1000);
          modal.remove();
        }
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
    console.log(`[SleepTimer] Started: ${Math.round(durationMs / 60000)} minutes`);
  }

  startEndOfTrack() {
    this.cancel();
    this.mode = 'track-end';
    this.audioPlayer.addEventListener('ended', this._onTrackEnd);
    this._updateUI(true);
    this._notifyCallbacks('start', { mode: 'track-end' });
    console.log('[SleepTimer] Will stop at end of current track');
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
      const newVolume = Math.max(0, this.originalVolume - (volumeStep * step));
      this.audioPlayer.volume = newVolume;

      if (step >= steps) {
        clearInterval(this._tickInterval);
        this.audioPlayer.pause();
        this.audioPlayer.volume = this.originalVolume;
        this._cleanup();
        this._notifyCallbacks('triggered');
        console.log('[SleepTimer] Playback stopped (fade complete)');
      }
    }, interval);
  }

  cancel() {
    if (this.timerId) clearTimeout(this.timerId);
    if (this._tickInterval) clearInterval(this._tickInterval);
    this.audioPlayer.removeEventListener('ended', this._onTrackEnd);
    if (this.originalVolume && this.audioPlayer) {
      this.audioPlayer.volume = this.originalVolume;
    }
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
      this._btn.style.color = 'var(--text-secondary)';
      this._btn.title = 'Sleep Timer';
    }
  }

  get isActive() {
    return this.mode !== null;
  }

  getRemaining() {
    if (this.mode === 'time' && this.endTime) {
      return Math.max(0, this.endTime - Date.now());
    }
    if (this.mode === 'track-end' && this.audioPlayer) {
      const remaining = this.audioPlayer.duration - this.audioPlayer.currentTime;
      return isFinite(remaining) ? remaining * 1000 : 0;
    }
    return 0;
  }

  _formatTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  onChange(callback) {
    this._callbacks.add(callback);
    return () => this._callbacks.delete(callback);
  }

  _notifyCallbacks(event, data = {}) {
    this._callbacks.forEach(cb => cb({ event, ...data }));
  }
}
