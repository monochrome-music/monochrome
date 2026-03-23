// js/social-share.js
// Social sharing: share currently playing track to social media platforms

export class SocialShare {
  constructor(player) {
    this.player = player;
    this._btn = null;
    this._createShareButton();
  }

  _createShareButton() {
    // Check if share button already exists
    if (document.querySelector('.now-playing-bar .social-share-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'social-share-btn';
    btn.title = 'Share Track';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
    btn.style.cssText = 'background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px;display:flex;align-items:center;opacity:0.7;transition:all 0.2s;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showShareMenu(e);
    });
    btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
    btn.addEventListener('mouseleave', () => btn.style.opacity = '0.7');
    this._btn = btn;

    const editBtn = document.querySelector('.now-playing-bar .edit-btn') ||
                    document.querySelector('#toggle-lyrics-btn');
    if (editBtn && editBtn.parentNode) {
      editBtn.parentNode.insertBefore(btn, editBtn.nextSibling);
    }
  }

  _showShareMenu(event) {
    const track = this.player?.currentTrack;
    if (!track) {
      alert('No track is currently playing');
      return;
    }

    // Remove existing menu
    document.getElementById('social-share-menu')?.remove();

    const title = track.title || 'Unknown';
    const artist = track.artist?.name || 'Unknown';
    const text = `${title} by ${artist}`;
    const url = window.location.href;

    const menu = document.createElement('div');
    menu.id = 'social-share-menu';
    menu.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
    `;

    const platforms = [
      { name: 'Twitter / X', icon: 'X', action: () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank') },
      { name: 'WhatsApp', icon: 'WA', action: () => window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank') },
      { name: 'Telegram', icon: 'TG', action: () => window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank') },
      { name: 'Copy Link', icon: 'LINK', action: () => { navigator.clipboard.writeText(`${text} - ${url}`); this._showCopied(); } },
    ];

    // Use Web Share API if available
    if (navigator.share) {
      platforms.unshift({
        name: 'Share...',
        icon: 'OS',
        action: () => navigator.share({ title, text, url }).catch(() => {}),
      });
    }

    menu.innerHTML = `
      <div style="background:var(--bg-secondary,#1a1a2e);border-radius:16px;padding:24px;min-width:280px;color:var(--text-primary,#fff);box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;font-size:16px;">Share Track</h3>
          <button id="share-menu-close" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:20px;">&times;</button>
        </div>
        <div style="margin-bottom:16px;padding:12px;background:var(--bg-tertiary,#252540);border-radius:10px;">
          <div style="font-weight:600;font-size:14px;">${title}</div>
          <div style="color:var(--text-secondary);font-size:12px;margin-top:2px;">${artist}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${platforms.map((p, i) => `
            <button class="share-platform-btn" data-index="${i}" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;border:1px solid var(--border,#333);background:var(--bg-tertiary,#252540);color:var(--text-primary);cursor:pointer;font-size:14px;transition:all 0.2s;text-align:left;width:100%;">
              <span style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:var(--accent,#00d4ff);color:#000;border-radius:8px;font-weight:bold;font-size:11px;">${p.icon}</span>
              ${p.name}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(menu);

    menu.querySelector('#share-menu-close').addEventListener('click', () => menu.remove());
    menu.addEventListener('click', (e) => { if (e.target === menu) menu.remove(); });

    menu.querySelectorAll('.share-platform-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = 'var(--accent,#00d4ff)');
      btn.addEventListener('mouseleave', () => btn.style.background = 'var(--bg-tertiary,#252540)');
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        platforms[idx].action();
        menu.remove();
      });
    });
  }

  _showCopied() {
    const toast = document.createElement('div');
    toast.textContent = 'Link copied!';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--accent,#00d4ff);color:#000;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:10001;animation:fadeInUp 0.3s ease;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }
}
