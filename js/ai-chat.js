import { sidePanelManager } from './side-panel.js';

// HuggingFace Inference API config
// Ganti HF_API_KEY dengan API key kamu dari https://huggingface.co/settings/tokens
const HF_API_URL = 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3';
const HF_API_KEY = 'hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

/**
 * Buka AI Chat panel di side panel (mirip Lyrics panel)
 * @param {object} track - track yang sedang diputar
 */
export function openAiChatPanel(track) {
  const trackTitle = track?.title || 'Unknown Track';
  const trackArtist =
    track?.artist?.name ||
    track?.artists?.[0]?.name ||
    'Unknown Artist';
  const trackAlbum = track?.album?.title || '';

  const systemContext = `Kamu adalah asisten musik yang membantu pengguna memahami lagu secara mendalam.
Pengguna sedang mendengarkan: "${trackTitle}" oleh ${trackArtist}${trackAlbum ? ` dari album "${trackAlbum}"` : ''}.
Jawab pertanyaan tentang makna lagu, lirik, artis, konteks budaya, atau sejarah lagu tersebut dengan informatif.
Jika pengguna tidak bertanya apa-apa, kamu bisa langsung memberi gambaran singkat tentang lagu ini.
Jawab dalam bahasa yang sama dengan pertanyaan pengguna (Indonesia atau Inggris).`;

  sidePanelManager.open(
    'ai-chat',
    `AI · ${trackTitle}`,
    // Controls (header bawah title)
    (controls) => {
      controls.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.75rem;color:var(--muted-foreground);padding:0.25rem 0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
          Tanya apa saja tentang <strong style="color:var(--foreground);margin-left:2px;">${trackTitle}</strong>
        </div>
      `;
    },
    // Content (body panel)
    (content) => {
      content.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
      content.innerHTML = `
        <div id="ai-chat-messages" style="
          flex:1;
          overflow-y:auto;
          display:flex;
          flex-direction:column;
          gap:0.75rem;
          padding:1rem;
          padding-bottom:0.5rem;
        ">
          <div class="ai-bubble-intro" style="
            background:var(--card);
            border-radius:var(--radius);
            padding:0.75rem 1rem;
            font-size:0.875rem;
            color:var(--foreground);
            align-self:flex-start;
            max-width:90%;
            animation: aiBubbleIn 0.3s ease;
          ">
            Halo! Saya siap membantu kamu memahami <strong>${trackTitle}</strong> oleh <em>${trackArtist}</em>. Tanya apa saja — makna lagu, lirik, atau konteks di balik lagunya 🎵
          </div>
        </div>

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
            placeholder="Tanya tentang lagu ini..."
            rows="2"
            style="
              flex:1;
              resize:none;
              background:var(--input);
              border:1px solid var(--border);
              border-radius:var(--radius-sm);
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
            style="
              background:var(--primary);
              color:var(--primary-foreground);
              border:none;
              border-radius:var(--radius-sm);
              padding:0.5rem 1rem;
              cursor:pointer;
              font-size:0.875rem;
              min-height:40px;
              font-family:inherit;
              transition:opacity 0.2s;
            "
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      `;

      const messagesEl = content.querySelector('#ai-chat-messages');
      const inputEl = content.querySelector('#ai-chat-input');
      const sendBtn = content.querySelector('#ai-chat-send');

      // Riwayat percakapan
      const conversationHistory = [];

      const addMessage = (text, isUser = false, isLoading = false) => {
        const div = document.createElement('div');
        div.style.cssText = `
          background:${isUser ? 'var(--primary)' : 'var(--card)'};
          color:${isUser ? 'var(--primary-foreground)' : 'var(--foreground)'};
          border-radius:var(--radius);
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
          div.innerHTML = `<span class="ai-typing-dots"><span>.</span><span>.</span><span>.</span></span>`;
        } else {
          div.textContent = text;
        }
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
      };

      const sendMessage = async () => {
        const userText = inputEl.value.trim();
        if (!userText || sendBtn.disabled) return;

        inputEl.value = '';
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.5';
        addMessage(userText, true);

        conversationHistory.push({ role: 'user', content: userText });

        // Loading bubble
        const loadingDiv = addMessage('', false, true);

        try {
          // Build Mistral Instruct prompt
          let prompt = `<s>[INST] ${systemContext} [/INST] Baik, saya siap membantu! </s>`;
          const recentHistory = conversationHistory.slice(-8);
          for (let i = 0; i < recentHistory.length; i++) {
            const msg = recentHistory[i];
            if (msg.role === 'user') {
              prompt += `[INST] ${msg.content} [/INST]`;
            } else {
              prompt += ` ${msg.content}</s>`;
            }
          }

          const response = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HF_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inputs: prompt,
              parameters: {
                max_new_tokens: 400,
                temperature: 0.7,
                top_p: 0.9,
                return_full_text: false,
              },
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();

          // Handle HF error format
          if (data.error) {
            throw new Error(data.error);
          }

          const aiText =
            (Array.isArray(data) ? data[0]?.generated_text : data?.generated_text)?.trim() ||
            'Maaf, saya tidak bisa menjawab saat ini. Coba tanyakan lagi.';

          loadingDiv.innerHTML = '';
          loadingDiv.textContent = aiText;
          conversationHistory.push({ role: 'assistant', content: aiText });

        } catch (err) {
          loadingDiv.innerHTML = '';
          if (HF_API_KEY === 'hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') {
            loadingDiv.textContent = '⚠️ API key belum diisi. Buka js/ai-chat.js dan ganti HF_API_KEY dengan key dari huggingface.co/settings/tokens';
          } else {
            loadingDiv.textContent = `⚠️ Gagal terhubung ke AI: ${err.message}`;
          }
        }

        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        inputEl.focus();
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
  );
}


/**
 * aiChatManager - manager object for AI chat panel
 * Provides toggle, open, and close methods
 */
export const aiChatManager = {
    _isOpen: false,

    toggle(track) {
        if (this._isOpen) {
            this.close();
        } else {
            this.open(track);
        }
    },

    open(track) {
        this._isOpen = true;
        openAiChatPanel(track);
    },

    close() {
        this._isOpen = false;
        sidePanelManager.close();
    },

    showDrawer() {
        const drawer = document.getElementById('now-playing-drawer');
        if (drawer) drawer.classList.add('visible');
    },

    hideDrawer() {
        const drawer = document.getElementById('now-playing-drawer');
        if (drawer) drawer.classList.remove('visible');
    },
};

// Setup audio element listeners for drawer show/hide
document.addEventListener('DOMContentLoaded', () => {
    const setupDrawerListeners = () => {
        const audio = document.getElementById('audio-player');
        if (audio) {
            audio.addEventListener('play', () => aiChatManager.showDrawer());
            audio.addEventListener('pause', () => aiChatManager.hideDrawer());
            audio.addEventListener('ended', () => aiChatManager.hideDrawer());
        }
    };
    setTimeout(setupDrawerListeners, 500);
});
