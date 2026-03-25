import { sidePanelManager } from './side-panel.js';

// HuggingFace Inference API config
const HF_MODEL = 'HuggingFaceH4/zephyr-7b-beta';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

// API key is loaded from localStorage.
// Set via: localStorage.setItem('hf-api-key', 'your_key_here')
// Or call initAiChat('your_key') at app startup.
function getHfApiKey() {
  return localStorage.getItem('hf-api-key') || '';
}

/**
 * Initialize AI chat with an API key. Call once at app startup.
 * The key is persisted to localStorage for subsequent sessions.
 */
export function initAiChat(apiKey) {
  if (apiKey) {
    localStorage.setItem('hf-api-key', apiKey);
  }
}

/**
 * Shared conversation state that persists across fullscreen/drawer transitions.
 */
const chatState = {
  messages: [],          // Array of { role: 'user'|'assistant'|'intro', content: string }
  currentTrackId: null,
  currentTrackTitle: '',
  currentTrackArtist: '',
  currentTrackAlbum: '',
};

/**
 * Build a system context string for the current track.
 */
function getSystemContext() {
  const { currentTrackTitle, currentTrackArtist, currentTrackAlbum } = chatState;
  return `You are a knowledgeable music expert assistant integrated into a music streaming app.
The user is currently listening to: "${currentTrackTitle}" by ${currentTrackArtist}${currentTrackAlbum ? ` from the album "${currentTrackAlbum}"` : ''}.
Answer questions about the song's meaning, lyrics interpretation, artist background, musical composition, cultural context, and related songs/albums.
If the user hasn't asked anything specific, provide a brief, engaging overview of the song.
Keep your responses concise but informative. Respond in the same language the user writes in.`;
}

/**
 * Update track context. Clears history if the track changed.
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
 * Call HuggingFace Inference API with the conversation history.
 */
async function callHuggingFaceAPI(userMessage) {
  const apiKey = getHfApiKey();
  if (!apiKey) {
    throw new Error('No API key configured. Run: localStorage.setItem("hf-api-key", "your_huggingface_key") in the browser console, then reload.');
  }

  const systemContext = getSystemContext();

  // Build Zephyr prompt format
  let prompt = `<|system|>\n${systemContext}</s>\n`;
  const recentHistory = chatState.messages.filter(m => m.role !== 'intro').slice(-8);
  for (const msg of recentHistory) {
    if (msg.role === 'user') {
      prompt += `<|user|>\n${msg.content}</s>\n`;
    } else if (msg.role === 'assistant') {
      prompt += `<|assistant|>\n${msg.content}</s>\n`;
    }
  }
  // Add the latest user message if not already in history
  if (!recentHistory.length || recentHistory[recentHistory.length - 1].content !== userMessage) {
    prompt += `<|user|>\n${userMessage}</s>\n`;
  }
  prompt += `<|assistant|>\n`;

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: 512,
        temperature: 0.7,
        top_p: 0.9,
        return_full_text: false,
        do_sample: true,
      },
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
    throw new Error(`API error ${response.status}: ${errBody || response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    if (typeof data.error === 'string' && data.error.includes('loading')) {
      throw new Error('Model is loading, please try again in a moment.');
    }
    throw new Error(data.error);
  }

  let aiText = (Array.isArray(data) ? data[0]?.generated_text : data?.generated_text)?.trim() || '';

  // Clean up any leftover prompt tokens
  aiText = aiText.replace(/<\|.*?\|>/g, '').trim();

  return aiText || 'Sorry, I couldn\'t generate a response. Please try again.';
}

/**
 * Render the chat messages area and input box into a container element.
 * Returns a cleanup function.
 */
function renderChatUI(container, track) {
  updateTrackContext(track);

  const { currentTrackTitle, currentTrackArtist } = chatState;

  container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
  container.innerHTML = `
    <div id="ai-chat-messages" style="
      flex:1;
      overflow-y:auto;
      display:flex;
      flex-direction:column;
      gap:0.75rem;
      padding:1rem;
      padding-bottom:0.5rem;
    "></div>
    <div style="
      padding:0.75rem 1rem;
      border-top:1px solid var(--border);
      display:flex;
      gap:0.5rem;
      align-items:flex-end;
      background:var(--background);
    ">
      <textarea
        id="ai-chat-input"
        placeholder="Ask about this song..."
        rows="2"
        style="
          flex:1;
          resize:none;
          background:var(--input);
          border:1px solid var(--border);
          border-radius:var(--radius-sm, 6px);
          padding:0.5rem 0.75rem;
          font-size:0.875rem;
          color:var(--foreground);
          font-family:inherit;
          outline:none;
          transition:border-color 0.2s;
        "
      ></textarea>
      <button
        id="ai-chat-send"
        title="Send message"
        style="
          background:var(--primary);
          color:var(--primary-foreground);
          border:none;
          border-radius:var(--radius-sm, 6px);
          padding:0.5rem 1rem;
          cursor:pointer;
          font-size:0.875rem;
          min-height:40px;
          font-family:inherit;
          transition:opacity 0.2s;
          display:flex;
          align-items:center;
          justify-content:center;
        "
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;

  const messagesEl = container.querySelector('#ai-chat-messages');
  const inputEl = container.querySelector('#ai-chat-input');
  const sendBtn = container.querySelector('#ai-chat-send');

  // Helper to create a message bubble
  const createBubble = (text, isUser = false, isLoading = false) => {
    const div = document.createElement('div');
    div.style.cssText = `
      background:${isUser ? 'var(--primary)' : 'var(--card)'};
      color:${isUser ? 'var(--primary-foreground)' : 'var(--foreground)'};
      border-radius:var(--radius, 8px);
      padding:0.75rem 1rem;
      font-size:0.875rem;
      align-self:${isUser ? 'flex-end' : 'flex-start'};
      max-width:88%;
      white-space:pre-wrap;
      word-break:break-word;
      animation:aiBubbleIn 0.25s ease;
      line-height:1.5;
    `;
    if (isLoading) {
      div.innerHTML = '<span class="ai-typing-dots"><span>.</span><span>.</span><span>.</span></span>';
    } else {
      div.textContent = text;
    }
    return div;
  };

  // Render existing messages from chatState
  if (chatState.messages.length === 0) {
    // Add intro message
    const introText = `Hi! I'm ready to help you explore "${currentTrackTitle}" by ${currentTrackArtist}. Ask me anything — song meaning, lyrics, artist background, or context behind the music.`;
    chatState.messages.push({ role: 'intro', content: introText });
  }

  for (const msg of chatState.messages) {
    const bubble = createBubble(msg.content, msg.role === 'user');
    messagesEl.appendChild(bubble);
  }

  // Scroll to bottom
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  // Send message handler
  let isSending = false;

  const sendMessage = async () => {
    const userText = inputEl.value.trim();
    if (!userText || isSending) return;

    inputEl.value = '';
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';

    // Add user bubble
    chatState.messages.push({ role: 'user', content: userText });
    const userBubble = createBubble(userText, true);
    messagesEl.appendChild(userBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Add loading bubble
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
      const errorText = `⚠ ${err.message}`;
      loadingBubble.textContent = errorText;
      loadingBubble.style.color = 'var(--muted-foreground)';
      loadingBubble.style.fontStyle = 'italic';
      // Don't persist error messages to chatState
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
  inputEl.addEventListener('focus', () => {
    inputEl.style.borderColor = 'var(--primary)';
  });
  inputEl.addEventListener('blur', () => {
    inputEl.style.borderColor = 'var(--border)';
  });

  setTimeout(() => inputEl.focus(), 150);
}

/**
 * Open AI Chat panel in side panel (same pattern as Lyrics panel)
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
 * aiChatManager - manager object for AI chat panel
 * Provides toggle, open, close methods and drawer cycling logic
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
    // Toggle active class on fullscreen button
    const fsBtn = document.getElementById('fs-ai-chat-btn');
    if (fsBtn) fsBtn.classList.add('active');
  },

  close() {
    this._isOpen = false;
    sidePanelManager.close();
    // Remove active class on fullscreen button
    const fsBtn = document.getElementById('fs-ai-chat-btn');
    if (fsBtn) fsBtn.classList.remove('active');
  },

  /**
   * Called when entering fullscreen mode.
   * Hide the drawer AI chat indicator.
   */
  onEnterFullscreen() {
    this.hideDrawerIndicator();
  },

  /**
   * Called when exiting fullscreen mode.
   * If AI chat was used, show the drawer indicator.
   */
  onExitFullscreen() {
    // Close the side panel if AI chat was open in fullscreen
    if (this._isOpen) {
      this.close();
    }
    // Show drawer indicator if the AI chat was interacted with
    if (this._wasOpenInFullscreen && chatState.messages.length > 0) {
      this.showDrawerIndicator();
    }
  },

  /**
   * Show the AI chat indicator in the sidebar.
   */
  showDrawerIndicator() {
    const indicator = document.getElementById('sidebar-ai-chat-item');
    if (indicator) {
      indicator.style.display = '';
      indicator.classList.add('ai-chat-visible');
    }
  },

  /**
   * Hide the AI chat indicator in the sidebar.
   */
  hideDrawerIndicator() {
    const indicator = document.getElementById('sidebar-ai-chat-item');
    if (indicator) {
      indicator.classList.remove('ai-chat-visible');
      // Delay hiding for transition
      setTimeout(() => {
        if (!indicator.classList.contains('ai-chat-visible')) {
          indicator.style.display = 'none';
        }
      }, 300);
    }
  },

  /**
   * Get current chat state for external use
   */
  hasActiveChat() {
    return chatState.messages.length > 1;
  }
};
