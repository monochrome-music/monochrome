// js/mini-player.js
// Floating mini player that persists during navigation
// Draggable, resizable, with album art and basic controls

export class MiniPlayer {
  constructor(player, audioPlayer) {
    this.player = player;
    this.audioPlayer = audioPlayer;
    this.isVisible = false;
    this.isDragging = false;
    this.isMinimized = false;
    this.dragOffset = { x: 0, y: 0 };
    this.position = JSON.parse(localStorage.getItem('monochrome_miniplayer_pos') || '{"x":20,"y":20}');
    this.container = null;
    this.ui = {};

    this._createUI();
    this._attachEvents();
  }

  _createUI() {
    // Toggle button in main controls
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'mini-player-toggle';
    toggleBtn.title = 'Mini Player';
    toggleBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <rect x="12" y="10" width="10" height="7" rx="1" fill="currentColor" opacity="0.3"/>
      </svg>
    `;
    Object.assign(toggleBtn.style, {
      background: 'none', border: 'none', color: '#b3b3b3',
      cursor: 'pointer', padding: '8px', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    toggleBtn.addEventListener('click', () => this.toggle());

    const controls = document.querySelector('.now-playing-bar .extra-controls')
      || document.querySelector('.now-playing-bar .controls');
    if (controls) controls.appendChild(toggleBtn);
    this.ui.toggleBtn = toggleBtn;

    // Mini player container
    const container = document.createElement('div');
    container.className = 'monochrome-mini-player';
    container.innerHTML = `
      <div class="mp-header">
        <span class="mp-title">Mini Player</span>
        <div class="mp-header-actions">
          <button class="mp-minimize" title="Minimize">&#8211;</button>
          <button class="mp-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="mp-body">
        <div class="mp-artwork">
          <img src="" alt="Album Art" class="mp-art-img"/>
        </div>
        <div class="mp-info">
          <div class="mp-track-name">No track</div>
          <div class="mp-artist-name">--</div>
        </div>
        <div class="mp-progress">
          <div class="mp-progress-bar"><div class="mp-progress-fill"></div></div>
          <div class="mp-time"><span class="mp-current">0:00</span><span class="mp-duration">0:00</span></div>
        </div>
        <div class="mp-controls">
          <button class="mp-prev" title="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="mp-play" title="Play/Pause">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="mp-next" title="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .monochrome-mini-player {
        position: fixed;
        z-index: 99999;
        width: 300px;
        background: #181818;
        border: 1px solid #333;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        overflow: hidden;
        display: none;
        font-family: inherit;
        color: #fff;
      }
      .monochrome-mini-player.visible { display: block; }
      .monochrome-mini-player.minimized .mp-body { display: none; }
      .monochrome-mini-player.minimized { width: 200px; }
      .mp-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; background: #222; cursor: move;
        user-select: none;
      }
      .mp-title { font-size: 12px; font-weight: 600; opacity: 0.7; }
      .mp-header-actions button {
        background: none; border: none; color: #b3b3b3;
        cursor: pointer; font-size: 16px; padding: 2px 6px;
      }
      .mp-header-actions button:hover { color: #fff; }
      .mp-body { padding: 12px; }
      .mp-artwork { text-align: center; margin-bottom: 10px; }
      .mp-art-img {
        width: 180px; height: 180px; border-radius: 8px;
        object-fit: cover; background: #333;
      }
      .mp-info { text-align: center; margin-bottom: 10px; }
      .mp-track-name {
        font-size: 14px; font-weight: 600;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mp-artist-name { font-size: 12px; opacity: 0.6; margin-top: 2px; }
      .mp-progress { margin-bottom: 10px; }
      .mp-progress-bar {
        width: 100%; height: 4px; background: #444;
        border-radius: 2px; cursor: pointer; position: relative;
      }
      .mp-progress-fill {
        height: 100%; background: #1db954; border-radius: 2px;
        width: 0%; transition: width 0.3s linear;
      }
      .mp-time {
        display: flex; justify-content: space-between;
        font-size: 10px; opacity: 0.5; margin-top: 4px;
      }
      .mp-controls {
        display: flex; justify-content: center; align-items: center; gap: 16px;
      }
      .mp-controls button {
        background: none; border: none; color: #b3b3b3;
        cursor: pointer; padding: 6px; border-radius: 50%;
        display: flex; align-items: center;
      }
      .mp-controls button:hover { color: #fff; }
      .mp-play {
        background: #fff !important; color: #000 !important;
        border-radius: 50% !important; padding: 8px !important;
      }
    `;
    document.head.appendChild(style);

    container.style.left = this.position.x + 'px';
    container.style.top = this.position.y + 'px';
    document.body.appendChild(container);
    this.container = container;

    // Store refs
    this.ui.artImg = container.querySelector('.mp-art-img');
    this.ui.trackName = container.querySelector('.mp-track-name');
    this.ui.artistName = container.querySelector('.mp-artist-name');
    this.ui.progressFill = container.querySelector('.mp-progress-fill');
    this.ui.currentTime = container.querySelector('.mp-current');
    this.ui.duration = container.querySelector('.mp-duration');
    this.ui.playBtn = container.querySelector('.mp-play');
    this.ui.prevBtn = container.querySelector('.mp-prev');
    this.ui.nextBtn = container.querySelector('.mp-next');
    this.ui.closeBtn = container.querySelector('.mp-close');
    this.ui.minimizeBtn = container.querySelector('.mp-minimize');
    this.ui.header = container.querySelector('.mp-header');
    this.ui.progressBar = container.querySelector('.mp-progress-bar');
  }

  _attachEvents() {
    // Drag
    this.ui.header.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragOffset.x = e.clientX - this.container.offsetLeft;
      this.dragOffset.y = e.clientY - this.container.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - 300, e.clientX - this.dragOffset.x));
      const y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - this.dragOffset.y));
      this.container.style.left = x + 'px';
      this.container.style.top = y + 'px';
      this.position = { x, y };
    });
    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        localStorage.setItem('monochrome_miniplayer_pos', JSON.stringify(this.position));
      }
    });

    // Controls
    this.ui.playBtn.addEventListener('click', () => {
      if (this.audioPlayer.paused) this.audioPlayer.play();
      else this.audioPlayer.pause();
    });
    this.ui.prevBtn.addEventListener('click', () => {
      if (this.player.previous) this.player.previous();
    });
    this.ui.nextBtn.addEventListener('click', () => {
      if (this.player.next) this.player.next();
    });
    this.ui.closeBtn.addEventListener('click', () => this.hide());
    this.ui.minimizeBtn.addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.container.classList.toggle('minimized', this.isMinimized);
    });

    // Progress seek
    this.ui.progressBar.addEventListener('click', (e) => {
      const rect = this.ui.progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      if (this.audioPlayer.duration) {
        this.audioPlayer.currentTime = pct * this.audioPlayer.duration;
      }
    });

    // Audio events
    this.audioPlayer.addEventListener('timeupdate', () => this._updateProgress());
    this.audioPlayer.addEventListener('play', () => this._updatePlayBtn());
    this.audioPlayer.addEventListener('pause', () => this._updatePlayBtn());
    this.audioPlayer.addEventListener('loadedmetadata', () => this._updateTrackInfo());

    // Poll for track changes
    setInterval(() => this._updateTrackInfo(), 2000);
  }

  _updateProgress() {
    if (!this.isVisible || !this.audioPlayer.duration) return;
    const pct = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
    this.ui.progressFill.style.width = pct + '%';
    this.ui.currentTime.textContent = this._formatTime(this.audioPlayer.currentTime);
    this.ui.duration.textContent = this._formatTime(this.audioPlayer.duration);
  }

  _updatePlayBtn() {
    const icon = this.audioPlayer.paused
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
    this.ui.playBtn.innerHTML = icon;
  }

  _updateTrackInfo() {
    if (!this.isVisible) return;
    const track = this.player.currentTrack;
    if (track) {
      this.ui.trackName.textContent = track.title || track.name || 'Unknown';
      this.ui.artistName.textContent = track.artist || track.artistName || '--';
      if (track.albumArt || track.cover || track.image) {
        this.ui.artImg.src = track.albumArt || track.cover || track.image;
      }
    }
  }

  _formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  toggle() {
    this.isVisible ? this.hide() : this.show();
  }

  show() {
    this.isVisible = true;
    this.container.classList.add('visible');
    this.ui.toggleBtn.style.color = '#1db954';
    this._updateTrackInfo();
    this._updatePlayBtn();
  }

  hide() {
    this.isVisible = false;
    this.container.classList.remove('visible');
    this.ui.toggleBtn.style.color = '#b3b3b3';
  }
}
