// js/keyboard-shortcuts.js
// Global keyboard shortcuts with customizable bindings
// Shows overlay with ? key for shortcut reference

export class KeyboardShortcuts {
  constructor(player, audioPlayer) {
    this.player = player;
    this.audioPlayer = audioPlayer;
    this.overlayVisible = false;
    this.overlay = null;
    this.enabled = true;

    // Default shortcuts
    this.shortcuts = {
      'Space': { action: 'playPause', label: 'Play / Pause' },
      'ArrowRight': { action: 'seekForward', label: 'Seek forward 10s' },
      'ArrowLeft': { action: 'seekBackward', label: 'Seek backward 10s' },
      'ArrowUp': { action: 'volumeUp', label: 'Volume up' },
      'ArrowDown': { action: 'volumeDown', label: 'Volume down' },
      'KeyN': { action: 'nextTrack', label: 'Next track' },
      'KeyP': { action: 'prevTrack', label: 'Previous track' },
      'KeyM': { action: 'mute', label: 'Mute / Unmute' },
      'KeyR': { action: 'repeat', label: 'Toggle repeat' },
      'KeyS': { action: 'shuffle', label: 'Toggle shuffle' },
      'KeyL': { action: 'like', label: 'Like current track' },
      'KeyF': { action: 'fullscreen', label: 'Toggle fullscreen' },
      'Digit1': { action: 'seekPercent10', label: 'Seek to 10%' },
      'Digit2': { action: 'seekPercent20', label: 'Seek to 20%' },
      'Digit3': { action: 'seekPercent30', label: 'Seek to 30%' },
      'Digit4': { action: 'seekPercent40', label: 'Seek to 40%' },
      'Digit5': { action: 'seekPercent50', label: 'Seek to 50%' },
      'Digit6': { action: 'seekPercent60', label: 'Seek to 60%' },
      'Digit7': { action: 'seekPercent70', label: 'Seek to 70%' },
      'Digit8': { action: 'seekPercent80', label: 'Seek to 80%' },
      'Digit9': { action: 'seekPercent90', label: 'Seek to 90%' },
      'Slash': { action: 'showHelp', label: 'Show keyboard shortcuts' },
    };

    // Load custom bindings
    this._loadCustomBindings();
    this._createOverlay();
    this._attachEvents();
  }

  _attachEvents() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      // Ignore when typing in inputs
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

      const shortcut = this.shortcuts[e.code];
      if (shortcut) {
        e.preventDefault();
        this._executeAction(shortcut.action);
      }
    });
  }

  _executeAction(action) {
    const ap = this.audioPlayer;
    const p = this.player;

    switch (action) {
      case 'playPause':
        ap.paused ? ap.play() : ap.pause();
        this._showToast(ap.paused ? 'Paused' : 'Playing');
        break;
      case 'seekForward':
        ap.currentTime = Math.min(ap.duration || 0, ap.currentTime + 10);
        this._showToast('>> +10s');
        break;
      case 'seekBackward':
        ap.currentTime = Math.max(0, ap.currentTime - 10);
        this._showToast('<< -10s');
        break;
      case 'volumeUp':
        ap.volume = Math.min(1, ap.volume + 0.05);
        this._showToast(`Volume ${Math.round(ap.volume * 100)}%`);
        break;
      case 'volumeDown':
        ap.volume = Math.max(0, ap.volume - 0.05);
        this._showToast(`Volume ${Math.round(ap.volume * 100)}%`);
        break;
      case 'nextTrack':
        if (p.next) p.next();
        this._showToast('Next >>|');
        break;
      case 'prevTrack':
        if (p.previous) p.previous();
        this._showToast('|<< Previous');
        break;
      case 'mute':
        ap.muted = !ap.muted;
        this._showToast(ap.muted ? 'Muted' : 'Unmuted');
        break;
      case 'repeat':
        if (p.toggleRepeat) p.toggleRepeat();
        this._showToast('Repeat toggled');
        break;
      case 'shuffle':
        if (p.toggleShuffle) p.toggleShuffle();
        this._showToast('Shuffle toggled');
        break;
      case 'like':
        if (p.toggleLike) p.toggleLike();
        this._showToast('Liked!');
        break;
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
      case 'showHelp':
        this.toggleOverlay();
        break;
      default:
        // Handle seekPercent
        if (action.startsWith('seekPercent')) {
          const pct = parseInt(action.replace('seekPercent', '')) / 100;
          if (ap.duration) {
            ap.currentTime = ap.duration * pct;
            this._showToast(`Seek to ${pct * 100}%`);
          }
        }
    }
  }

  _showToast(msg) {
    let toast = document.getElementById('kb-shortcut-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'kb-shortcut-toast';
      Object.assign(toast.style, {
        position: 'fixed', bottom: '100px', left: '50%',
        transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.85)',
        color: '#fff', padding: '8px 20px', borderRadius: '20px',
        fontSize: '14px', fontWeight: '600', zIndex: '99999',
        transition: 'opacity 0.3s', pointerEvents: 'none',
      });
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1200);
  }

  _createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'kb-shortcuts-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(0,0,0,0.85); display: none;
      justify-content: center; align-items: center;
      font-family: inherit; color: #fff;
    `;

    const grid = Object.entries(this.shortcuts).map(([key, { label }]) => {
      const displayKey = key
        .replace('Key', '')
        .replace('Digit', '')
        .replace('Arrow', '')
        .replace('Slash', '?')
        .replace('Space', 'Space');
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #333">
        <span style="opacity:0.7">${label}</span>
        <kbd style="background:#333;padding:2px 10px;border-radius:4px;font-size:13px;min-width:40px;text-align:center">${displayKey}</kbd>
      </div>`;
    }).join('');

    overlay.innerHTML = `
      <div style="background:#1a1a1a;border-radius:16px;padding:30px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;border:1px solid #333">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:20px">Keyboard Shortcuts</h2>
          <button id="kb-close-overlay" style="background:none;border:none;color:#b3b3b3;font-size:24px;cursor:pointer">&times;</button>
        </div>
        ${grid}
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'kb-close-overlay') {
        this.hideOverlay();
      }
    });

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  toggleOverlay() {
    this.overlayVisible ? this.hideOverlay() : this.showOverlay();
  }

  showOverlay() {
    this.overlayVisible = true;
    this.overlay.style.display = 'flex';
  }

  hideOverlay() {
    this.overlayVisible = false;
    this.overlay.style.display = 'none';
  }

  _loadCustomBindings() {
    try {
      const custom = JSON.parse(localStorage.getItem('monochrome_kb_shortcuts') || '{}');
      Object.entries(custom).forEach(([key, action]) => {
        if (this.shortcuts[key]) {
          this.shortcuts[key].action = action;
        }
      });
    } catch {}
  }

  rebind(keyCode, action) {
    if (this.shortcuts[keyCode]) {
      this.shortcuts[keyCode].action = action;
      try {
        const custom = JSON.parse(localStorage.getItem('monochrome_kb_shortcuts') || '{}');
        custom[keyCode] = action;
        localStorage.setItem('monochrome_kb_shortcuts', JSON.stringify(custom));
      } catch {}
    }
  }
}
