// js/collaborative-room.js
// Collaborative Listening Room - listen together in sync
// Uses BroadcastChannel for same-device tab sync + shareable room links

export class CollaborativeRoom {
  constructor(player) {
    this._player = player;
    this._roomId = null;
    this._isHost = false;
    this._channel = null;
    this._participants = [];
    this._chatMessages = [];
    this._container = null;
    this._storageKey = 'collab-room-state';
  }

  /**
   * Render collaborative room UI into container
   */
  renderPage(container) {
    this._container = container;
    container.innerHTML = `
      <div class="collab-room-page">
        <h1 class="page-title">Collaborative Room</h1>
        <p class="page-subtitle">Listen together with friends in sync</p>

        <div class="collab-join-section">
          <div class="collab-create">
            <h3>Create a Room</h3>
            <p>Start a new listening session and invite friends</p>
            <button class="btn-primary collab-create-btn"><span>Create Room</span></button>
          </div>
          <div class="collab-divider">OR</div>
          <div class="collab-join">
            <h3>Join a Room</h3>
            <input type="text" class="collab-room-input" placeholder="Enter Room ID..." />
            <button class="btn-secondary collab-join-btn"><span>Join Room</span></button>
          </div>
        </div>

        <div class="collab-active-section" style="display:none">
          <div class="collab-room-header">
            <div class="collab-room-info">
              <span class="collab-room-id-label">Room ID:</span>
              <span class="collab-room-id-value"></span>
              <button class="collab-copy-btn" title="Copy Room ID">Copy</button>
            </div>
            <div class="collab-participants">
              <span class="collab-participants-count">1 listener</span>
            </div>
            <button class="btn-danger collab-leave-btn">Leave Room</button>
          </div>

          <div class="collab-now-playing">
            <h3>Now Playing</h3>
            <div class="collab-track-info">
              <span class="collab-track-title">No track playing</span>
              <span class="collab-track-artist"></span>
            </div>
            <div class="collab-sync-status">
              <span class="collab-sync-indicator sync-ok">In Sync</span>
            </div>
          </div>

          <div class="collab-chat">
            <h3>Chat</h3>
            <div class="collab-messages"></div>
            <div class="collab-chat-input">
              <input type="text" class="collab-message-input" placeholder="Say something..." />
              <button class="collab-send-btn">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this._attachEvents(container);
  }

  _attachEvents(container) {
    container.querySelector('.collab-create-btn')?.addEventListener('click', () => {
      this._createRoom();
    });

    container.querySelector('.collab-join-btn')?.addEventListener('click', () => {
      const id = container.querySelector('.collab-room-input')?.value?.trim();
      if (id) this._joinRoom(id);
    });

    container.querySelector('.collab-room-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') container.querySelector('.collab-join-btn')?.click();
    });

    container.querySelector('.collab-leave-btn')?.addEventListener('click', () => {
      this._leaveRoom();
    });

    container.querySelector('.collab-copy-btn')?.addEventListener('click', () => {
      const id = container.querySelector('.collab-room-id-value')?.textContent;
      if (id) {
        navigator.clipboard.writeText(id).then(() => {
          container.querySelector('.collab-copy-btn').textContent = 'Copied!';
          setTimeout(() => {
            const btn = container.querySelector('.collab-copy-btn');
            if (btn) btn.textContent = 'Copy';
          }, 2000);
        });
      }
    });

    container.querySelector('.collab-send-btn')?.addEventListener('click', () => {
      this._sendChat();
    });

    container.querySelector('.collab-message-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._sendChat();
    });
  }

  _generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  _createRoom() {
    this._roomId = this._generateRoomId();
    this._isHost = true;
    this._openChannel(this._roomId);
    this._showActiveRoom();
    this._updateRoomInfo();
    this._broadcastState();
    console.log('[CollabRoom] Created room:', this._roomId);
  }

  _joinRoom(roomId) {
    this._roomId = roomId.toUpperCase();
    this._isHost = false;
    this._openChannel(this._roomId);
    this._showActiveRoom();
    this._updateRoomInfo();
    // Request sync from host
    this._channel.postMessage({ type: 'request-sync', from: this._getPeerId() });
    console.log('[CollabRoom] Joined room:', this._roomId);
  }

  _openChannel(roomId) {
    if (this._channel) {
      this._channel.close();
    }
    this._channel = new BroadcastChannel(`collab-room-${roomId}`);
    this._channel.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'sync-state':
        if (!this._isHost) {
          this._syncToState(msg.state);
        }
        break;
      case 'chat':
        this._addChatMessage(msg.author, msg.text, false);
        break;
      case 'request-sync':
        if (this._isHost) {
          this._broadcastState();
        }
        break;
      case 'participant-join':
        this._participants.push(msg.peerId);
        this._updateParticipantCount();
        break;
      case 'participant-leave':
        this._participants = this._participants.filter(p => p !== msg.peerId);
        this._updateParticipantCount();
        break;
    }
  }

  _broadcastState() {
    if (!this._channel || !this._isHost) return;
    const track = this._player?.currentTrack;
    const state = {
      trackId: track?.id,
      trackTitle: track?.title,
      trackArtist: track?.artist?.name || track?.artists?.[0]?.name,
      isPlaying: !this._player?._audio?.paused,
      currentTime: this._player?._audio?.currentTime || 0,
      timestamp: Date.now(),
    };
    this._channel.postMessage({ type: 'sync-state', state });
    this._updateNowPlaying(state);
  }

  _syncToState(state) {
    if (!state) return;
    this._updateNowPlaying(state);
    this._updateSyncStatus(true);
    console.log('[CollabRoom] Synced to host state:', state);
  }

  _showActiveRoom() {
    const joinSection = this._container?.querySelector('.collab-join-section');
    const activeSection = this._container?.querySelector('.collab-active-section');
    if (joinSection) joinSection.style.display = 'none';
    if (activeSection) activeSection.style.display = 'block';

    // Announce presence
    this._channel?.postMessage({ type: 'participant-join', peerId: this._getPeerId() });

    // If host, broadcast state every 5 seconds
    if (this._isHost) {
      this._syncInterval = setInterval(() => this._broadcastState(), 5000);
    }
  }

  _leaveRoom() {
    this._channel?.postMessage({ type: 'participant-leave', peerId: this._getPeerId() });
    this._channel?.close();
    this._channel = null;
    if (this._syncInterval) clearInterval(this._syncInterval);
    this._roomId = null;
    this._isHost = false;

    const joinSection = this._container?.querySelector('.collab-join-section');
    const activeSection = this._container?.querySelector('.collab-active-section');
    if (joinSection) joinSection.style.display = '';
    if (activeSection) activeSection.style.display = 'none';
  }

  _updateRoomInfo() {
    const idEl = this._container?.querySelector('.collab-room-id-value');
    if (idEl) idEl.textContent = this._roomId;
  }

  _updateParticipantCount() {
    const el = this._container?.querySelector('.collab-participants-count');
    const count = this._participants.length + 1;
    if (el) el.textContent = `${count} listener${count !== 1 ? 's' : ''}`;
  }

  _updateNowPlaying(state) {
    const titleEl = this._container?.querySelector('.collab-track-title');
    const artistEl = this._container?.querySelector('.collab-track-artist');
    if (titleEl) titleEl.textContent = state.trackTitle || 'No track playing';
    if (artistEl) artistEl.textContent = state.trackArtist || '';
  }

  _updateSyncStatus(inSync) {
    const el = this._container?.querySelector('.collab-sync-indicator');
    if (el) {
      el.textContent = inSync ? 'In Sync' : 'Out of Sync';
      el.className = `collab-sync-indicator ${inSync ? 'sync-ok' : 'sync-warn'}`;
    }
  }

  _sendChat() {
    const input = this._container?.querySelector('.collab-message-input');
    const text = input?.value?.trim();
    if (!text || !this._channel) return;
    const author = 'You';
    this._addChatMessage(author, text, true);
    this._channel.postMessage({ type: 'chat', author: 'Guest', text });
    if (input) input.value = '';
  }

  _addChatMessage(author, text, isSelf) {
    const messages = this._container?.querySelector('.collab-messages');
    if (!messages) return;
    const msg = document.createElement('div');
    msg.className = `collab-message ${isSelf ? 'self' : 'other'}`;
    msg.innerHTML = `<span class="collab-msg-author">${author}</span><span class="collab-msg-text">${text}</span>`;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    this._chatMessages.push({ author, text, isSelf });
  }

  _getPeerId() {
    if (!this._peerId) {
      this._peerId = Math.random().toString(36).substring(2, 10);
    }
    return this._peerId;
  }

  destroy() {
    this._leaveRoom();
  }
}
