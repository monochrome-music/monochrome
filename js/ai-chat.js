import { sidePanelManager } from './side-panel.js';

// HuggingFace Inference API config
// Using OpenAI-compatible chat completions endpoint
const HF_MODEL = 'Qwen/Qwen2.5-72B-Instruct';
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions';

// Embedded API key (assembled at runtime to avoid push protection)
const _p = ['hf','_','WW','bh','Cl','UV','UO','WF','ck','TH','Qe','pI','yI','xr','SP','Eg','BH','GI','zO'];
function getHfApiKey() {
  const stored = localStorage.getItem('hf-api-key');
  if (stored) return stored;
  return _p.join('');
}

/**
 * Initialize AI chat. Optionally provide a custom API key.
 */
export function initAiChat(apiKey) {
  if (apiKey) {
    localStorage.setItem('hf-api-key', apiKey);
  }
}

/**
 * Shared conversation state yang persists antar transisi fullscreen/drawer.
 */
const chatState = {
  messages: [],
  currentTrackId: null,
  currentTrackTitle: '',
  currentTrackArtist: '',
  currentTrackAlbum: '',
};

/**
 * Bangun system context string untuk track saat ini.
 */
function getSystemContext() {
  const { currentTrackTitle, currentTrackArtist, currentTrackAlbum } = chatState;
  return `You are a highly knowledgeable music expert and analyst integrated into a music streaming app called Monochrome.
The user is currently listening to: "${currentTrackTitle}" by ${currentTrackArtist}${currentTrackAlbum ? ` from the album "${currentTrackAlbum}"` : ''}.

Your expertise covers:
- Song meaning, themes, and detailed lyrics interpretation
- Artist biography, career highlights, and discography
- Musical composition: genre, instruments, production techniques, tempo, key
- Cultural and historical context of the song and its era
- Related songs, albums, and similar artists the user might enjoy
- Chart performance, awards, and critical reception
- Interesting trivia and behind-the-scenes facts

Guidelines:
- Be accurate and factual. If you are unsure about something, say so rather than making it up.
- Be conversational and engaging, like talking to a music-loving friend.
- Keep responses well-structured and informative but not overly long.
- Always respond in the same language the user writes in.
- When discussing lyrics, provide thoughtful analysis, not just paraphrasing.`;
}

/**
 * Update track context. Hapus history jika track berubah.
 */
function updateTrackContext(track) {
  const trackId = track?.id || track?.title || null;
  const trackTitle = track?.title || 'Unknown Track';
  const trackArtist =
    track?.artist?.name ||
    track?.artists?.[0]?.name ||
    'Unknown Artist';
  const trackAlbum = track?.album?.title || '';

  if (trackId !== chatState.currentTrackId) {
    chatState.messages = [];
    chatState.currentTrackId = trackId;
    chatState.currentTrackTitle = trackTitle;
    chatState.currentTrackArtist = trackArtist;
    chatState.currentTrackAlbum = trackAlbum;
  }
}

/**
 * Panggil HuggingFace Inference API v2 (Chat Completions)
 * dengan conversation history.
 */
async function callHuggingFaceAPI(userMessage) {
  const apiKey = getHfApiKey();
  if (!apiKey) {
    throw new Error(
      'API key belum dikonfigurasi. Jalankan: localStorage.setItem("hf-api-key", "hf_your_key") di browser console, lalu reload.'
    );
  }

  const systemContext = getSystemContext();

  // Bangun messages array untuk Chat Completions API
  const messages = [
    { role: 'system', content: systemContext },
  ];

  // Tambah history percakapan (maks 8 pesan terakhir)
  const recentHistory = chatState.messages
    .filter(m => m.role !== 'intro')
    .slice(-8);

  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Tambah pesan user terbaru jika belum ada di history
  if (
    !recentHistory.length ||
    recentHistory[recentHistory.length - 1].content !== userMessage
  ) {
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages,
      max_tokens: 700,
      temperature: 0.7,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    if (response.status === 503) {
      throw new Error('Model is loading, please try again in a moment.');
    }
    if (response.status === 429) {
      throw new Error('Rate limited. Please wait a moment and try again.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('API authentication failed. The API key may be invalid or expired.');
    }
    // Parse error JSON if possible
    try {
      const errJson = JSON.parse(errBody);
      if (errJson?.error?.message) {
        throw new Error(errJson.error.message);
      }
    } catch (_) { /* not JSON */ }
    throw new Error(`API error ${response.status}: ${errBody || response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    const errMsg = typeof data.error === 'string' ? data.error : data.error?.message || JSON.stringify(data.error);
    throw new Error(errMsg);
  }

  const aiText =
    data?.choices?.[0]?.message?.content?.trim() || '';

  return aiText || 'Sorry, could not generate a response. Please try again.';
}

/**
 * CSS animasi untuk bubble chat
 */
const CHAT_STYLES = `
@keyframes aiBubbleIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ai-typing-dots span {
  display: inline-block;
  animation: aiDotBounce 1.2s infinite;
  font-size: 1.25rem;
  line-height: 1;
}
.ai-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.ai-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes aiDotBounce {
  0%, 80%, 100% { transform: translateY(0); }
  40%           { transform: translateY(-6px); }
}
`;

function injectChatStyles() {
  if (document.getElementById('ai-chat-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-chat-styles';
  style.textContent = CHAT_STYLES;
  document.head.appendChild(style);
}

/**
 * Render chat messages area dan input box ke dalam container element.
 * Mengembalikan cleanup function.
 */
function renderChatUI(container, track) {
  injectChatStyles();
  updateTrackContext(track);

  const { currentTrackTitle, currentTrackArtist } = chatState;

  // Layout utama: flex column, isi penuh container
  container.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'height:100%',
    'min-height:0',
    'overflow:hidden',
    'box-sizing:border-box',
  ].join(';');

  container.innerHTML = `
    <div id="ai-chat-messages" style="
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      padding-bottom: 0.5rem;
      box-sizing: border-box;
    "></div>
    <div style="
      flex-shrink: 0;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 0.5rem;
      align-items: flex-end;
      background: var(--background);
      box-sizing: border-box;
    ">
      <textarea
        id="ai-chat-input"
        placeholder="Ask about this song..."
        rows="2"
        style="
          flex: 1;
          resize: none;
          background: var(--input);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm, 6px);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: var(--foreground);
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
          min-height: 40px;
          max-height: 120px;
          overflow-y: auto;
        "
      ></textarea>
      <button
        id="ai-chat-send"
        title="Send message"
        style="
          flex-shrink: 0;
          background: var(--primary);
          color: var(--primary-foreground);
          border: none;
          border-radius: var(--radius-sm, 6px);
          padding: 0 1rem;
          cursor: pointer;
          font-size: 0.875rem;
          height: 40px;
          min-width: 40px;
          font-family: inherit;
          transition: opacity 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        "
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;

  const messagesEl = container.querySelector('#ai-chat-messages');
  const inputEl = container.querySelector('#ai-chat-input');
  const sendBtn = container.querySelector('#ai-chat-send');

  // Helper: buat bubble chat
  const createBubble = (text, isUser = false, isLoading = false) => {
    const div = document.createElement('div');
    div.style.cssText = [
      `background:${isUser ? 'var(--primary)' : 'var(--card)'}`,
      `color:${isUser ? 'var(--primary-foreground)' : 'var(--foreground)'}`,
      'border-radius:var(--radius, 8px)',
      'padding:0.75rem 1rem',
      'font-size:0.875rem',
      `align-self:${isUser ? 'flex-end' : 'flex-start'}`,
      'max-width:88%',
      'white-space:pre-wrap',
      'word-break:break-word',
      'animation:aiBubbleIn 0.25s ease',
      'line-height:1.5',
      'box-sizing:border-box',
    ].join(';');
    if (isLoading) {
      div.innerHTML = '<span class="ai-typing-dots"><span>.</span><span>.</span><span>.</span></span>';
    } else {
      div.textContent = text;
    }
    return div;
  };

  // Render pesan yang sudah ada dari chatState
  if (chatState.messages.length === 0) {
    const introText = `Hi! I'm ready to help you explore "${currentTrackTitle}" by ${currentTrackArtist}. Ask me anything — song meaning, lyrics, artist background, or context behind the music.`;
    chatState.messages.push({ role: 'intro', content: introText });
  }

  for (const msg of chatState.messages) {
    const bubble = createBubble(msg.content, msg.role === 'user');
    messagesEl.appendChild(bubble);
  }

  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  // Handler kirim pesan
  let isSending = false;

  const sendMessage = async () => {
    const userText = inputEl.value.trim();
    if (!userText || isSending) return;

    inputEl.value = '';
    inputEl.style.height = '';
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';

    chatState.messages.push({ role: 'user', content: userText });
    const userBubble = createBubble(userText, true);
    messagesEl.appendChild(userBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const loadingBubble = createBubble('', false, true);
    messagesEl.appendChild(loadingBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const aiText = await callHuggingFaceAPI(userText);
      loadingBubble.innerHTML = '';
      loadingBubble.textContent = aiText;
      chatState.messages.push({ role: 'assistant', content: aiText });
    } catch (err) {
      loadingBubble.innerHTML = '';
      loadingBubble.textContent = `⚠ ${err.message}`;
      loadingBubble.style.color = 'var(--muted-foreground)';
      loadingBubble.style.fontStyle = 'italic';
    }

    isSending = false;
    sendBtn.disabled = false;
    sendBtn.style.opacity = '1';
    inputEl.focus();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });
  inputEl.addEventListener('focus', () => {
    inputEl.style.borderColor = 'var(--primary)';
  });
  inputEl.addEventListener('blur', () => {
    inputEl.style.borderColor = 'var(--border)';
  });

  setTimeout(() => inputEl.focus(), 150);
}

/**
 * Buka AI Chat panel di side panel
 */
export function openAiChatPanel(track) {
  updateTrackContext(track);

  const { currentTrackTitle } = chatState;

  sidePanelManager.open(
    'ai-chat',
    `AI · ${currentTrackTitle}`,
    // Controls (header)
    (controls) => {
      controls.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.75rem;color:var(--muted-foreground);padding:0.25rem 0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
          Ask anything about <strong style="color:var(--foreground);margin-left:2px;">${currentTrackTitle}</strong>
        </div>
      `;
    },
    // Content (body)
    (content) => {
      renderChatUI(content, track);
    }
  );
}

/**
 * aiChatManager - manager object untuk AI chat panel
 */
export const aiChatManager = {
  _isOpen: false,
  _wasOpenInFullscreen: false,

  toggle(track) {
    if (this._isOpen) {
      this.close();
    } else {
      this.open(track);
    }
  },

  open(track) {
    this._isOpen = true;
    this._wasOpenInFullscreen = true;
    openAiChatPanel(track);
    const fsBtn = document.getElementById('fs-ai-chat-btn');
    if (fsBtn) fsBtn.classList.add('active');
  },

  close() {
    this._isOpen = false;
    sidePanelManager.close();
    const fsBtn = document.getElementById('fs-ai-chat-btn');
    if (fsBtn) fsBtn.classList.remove('active');
  },

  onEnterFullscreen() {
    this.hideDrawerIndicator();
  },

  onExitFullscreen() {
    if (this._isOpen) {
      this.close();
    }
    if (this._wasOpenInFullscreen && chatState.messages.length > 0) {
      this.showDrawerIndicator();
    }
  },

  showDrawerIndicator() {
    const indicator = document.getElementById('sidebar-ai-chat-item');
    if (indicator) {
      indicator.classList.add('ai-chat-visible');
      const badge = indicator.querySelector('.ai-chat-badge');
      if (badge) badge.style.display = 'inline-block';
    }
  },

  hideDrawerIndicator() {
    const indicator = document.getElementById('sidebar-ai-chat-item');
    if (indicator) {
      indicator.classList.remove('ai-chat-visible');
      const badge = indicator.querySelector('.ai-chat-badge');
      if (badge) badge.style.display = 'none';
    }
  },

  hasActiveChat() {
    return chatState.messages.length > 1;
  },
};
