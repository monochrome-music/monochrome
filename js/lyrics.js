//js/lyrics.js
import {
  getTrackTitle,
  getTrackArtists,
  buildTrackFilename,
  SVG_DOWNLOAD,
  SVG_CLOSE,
} from "./utils.js";
import { sidePanelManager } from "./side-panel.js";

export class LyricsManager {
  constructor(api) {
    this.api = api;
    this.currentLyrics = null;
    this.syncedLyrics = [];
    this.lyricsCache = new Map();
    this.componentLoaded = false;
    this.amLyricsElement = null;
    this.animationFrameId = null;
    this.currentTrackId = null;
    this.mutationObserver = null;
    this.romajiObserver = null;
    this.isRomajiMode = false;
    this.originalLyricsData = null;
    this.kuroshiroLoaded = false;
    this.kuroshiroLoading = false;
    this.convertedNodes = new WeakSet(); // Track already converted nodes
  }

  // Load Kuroshiro from CDN
  async loadKuroshiro() {
    if (this.kuroshiroLoaded) return true;
    if (this.kuroshiroLoading) {
      // Wait for existing load to complete
      return new Promise((resolve) => {
        const checkLoad = setInterval(() => {
          if (!this.kuroshiroLoading) {
            clearInterval(checkLoad);
            resolve(this.kuroshiroLoaded);
          }
        }, 100);
      });
    }

    this.kuroshiroLoading = true;
    try {
      console.log("Loading Kuroshiro for Kanji to Romaji conversion...");

      // Load Kuroshiro from CDN
      if (!window.Kuroshiro) {
        await this.loadScript(
          "https://unpkg.com/kuroshiro@1.2.0/dist/kuroshiro.min.js",
        );
      }

      // Load Kuromoji analyzer from CDN with proper dictionary path
      if (!window.KuromojiAnalyzer) {
        await this.loadScript(
          "https://unpkg.com/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js",
        );
      }

      // Initialize Kuroshiro (CDN version exports as .default)
      const Kuroshiro = window.Kuroshiro.default || window.Kuroshiro;
      const KuromojiAnalyzer =
        window.KuromojiAnalyzer.default || window.KuromojiAnalyzer;

      this.kuroshiro = new Kuroshiro();

      // Initialize with custom dictionary path from unpkg
      await this.kuroshiro.init(
        new KuromojiAnalyzer({
          dictPath: "https://unpkg.com/kuromoji@0.1.2/dict/",
        }),
      );

      this.kuroshiroLoaded = true;
      this.kuroshiroLoading = false;
      console.log("✓ Kuroshiro loaded and initialized successfully");
      return true;
    } catch (error) {
      console.error("✗ Failed to load Kuroshiro:", error);
      this.kuroshiroLoaded = false;
      this.kuroshiroLoading = false;
      return false;
    }
  }

  // Helper to load external scripts
  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  // Check if text contains Japanese characters
  containsJapanese(text) {
    if (!text) return false;
    // Match any Japanese character (Hiragana, Katakana, Kanji)
    return /[\u3040-\u30FF\u31F0-\u9FFF]/.test(text);
  }

  // Convert Japanese text to Romaji (including Kanji)
  async convertToRomaji(text) {
    if (!text) return text;

    // Make sure Kuroshiro is loaded
    if (!this.kuroshiroLoaded) {
      const success = await this.loadKuroshiro();
      if (!success) {
        console.warn("Kuroshiro not available, skipping conversion");
        return text;
      }
    }

    if (!this.kuroshiro) {
      console.warn("Kuroshiro not available, skipping conversion");
      return text;
    }

    try {
      // Convert to Romaji using Kuroshiro (handles Kanji, Hiragana, Katakana)
      const result = await this.kuroshiro.convert(text, {
        to: "romaji",
        mode: "spaced",
        romajiSystem: "hepburn",
      });
      return result;
    } catch (error) {
      console.warn(
        "Romaji conversion failed for text:",
        text.substring(0, 30),
        error,
      );
      return text;
    }
  }

  // Set Romaji mode and save preference
  setRomajiMode(enabled) {
    this.isRomajiMode = enabled;
    try {
      localStorage.setItem("lyricsRomajiMode", enabled ? "true" : "false");
    } catch (e) {
      console.warn("Failed to save Romaji mode preference:", e);
    }
  }

  // Get saved Romaji mode preference
  getRomajiMode() {
    try {
      return localStorage.getItem("lyricsRomajiMode") === "true";
    } catch (e) {
      return false;
    }
  }

  async ensureComponentLoaded() {
    if (this.componentLoaded) return;

    if (
      typeof customElements !== "undefined" &&
      customElements.get("am-lyrics")
    ) {
      this.componentLoaded = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src =
        "https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics@0.6.2/dist/src/am-lyrics.min.js";

      script.onload = () => {
        if (typeof customElements !== "undefined") {
          customElements
            .whenDefined("am-lyrics")
            .then(() => {
              this.componentLoaded = true;
              resolve();
            })
            .catch(reject);
        } else {
          resolve();
        }
      };

      script.onerror = () =>
        reject(new Error("Failed to load lyrics component"));
      document.head.appendChild(script);
    });
  }

  async fetchLyrics(trackId, track = null) {
    if (track) {
      if (this.lyricsCache.has(trackId)) {
        return this.lyricsCache.get(trackId);
      }

      try {
        const artist = Array.isArray(track.artists)
          ? track.artists.map((a) => a.name || a).join(", ")
          : track.artist?.name || "";
        const title = track.title || "";
        const album = track.album?.title || "";
        const duration = track.duration ? Math.round(track.duration) : null;

        if (!title || !artist) {
          console.warn("Missing required fields for LRCLIB");
          return null;
        }

        const params = new URLSearchParams({
          track_name: title,
          artist_name: artist,
        });

        if (album) params.append("album_name", album);
        if (duration) params.append("duration", duration.toString());

        const response = await fetch(
          `https://lrclib.net/api/get?${params.toString()}`,
        );

        if (response.ok) {
          const data = await response.json();

          if (data.syncedLyrics) {
            const lyricsData = {
              subtitles: data.syncedLyrics,
              lyricsProvider: "LRCLIB",
            };

            this.lyricsCache.set(trackId, lyricsData);
            return lyricsData;
          }
        }
      } catch (error) {
        console.warn("LRCLIB fetch failed:", error);
      }
    }

    return null;
  }

  parseSyncedLyrics(subtitles) {
    if (!subtitles) return [];
    const lines = subtitles.split("\n").filter((line) => line.trim());
    return lines
      .map((line) => {
        const match = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.+)/);
        if (match) {
          const [, minutes, seconds, centiseconds, text] = match;
          const timeInSeconds =
            parseInt(minutes) * 60 +
            parseInt(seconds) +
            parseInt(centiseconds) / 100;
          return { time: timeInSeconds, text: text.trim() };
        }
        return null;
      })
      .filter(Boolean);
  }

  generateLRCContent(lyricsData, track) {
    if (!lyricsData || !lyricsData.subtitles) return null;

    const trackTitle = getTrackTitle(track);
    const trackArtist = getTrackArtists(track);

    let lrc = `[ti:${trackTitle}]\n`;
    lrc += `[ar:${trackArtist}]\n`;
    lrc += `[al:${track.album?.title || "Unknown Album"}]\n`;
    lrc += `[by:${lyricsData.lyricsProvider || "Unknown"}]\n`;
    lrc += "\n";
    lrc += lyricsData.subtitles;

    return lrc;
  }

  downloadLRC(lyricsData, track) {
    const lrcContent = this.generateLRCContent(lyricsData, track);
    if (!lrcContent) {
      alert("No synced lyrics available for this track");
      return;
    }

    const blob = new Blob([lrcContent], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildTrackFilename(track, "LOSSLESS").replace(
      /\.flac$/,
      ".lrc",
    );
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  getCurrentLine(currentTime) {
    if (!this.syncedLyrics || this.syncedLyrics.length === 0) return -1;
    let currentIndex = -1;
    for (let i = 0; i < this.syncedLyrics.length; i++) {
      if (currentTime >= this.syncedLyrics[i].time) {
        currentIndex = i;
      } else {
        break;
      }
    }
    return currentIndex;
  }

  // Setup MutationObserver to convert lyrics in am-lyrics component
  setupLyricsObserver(amLyricsElement) {
    this.stopLyricsObserver();

    if (!amLyricsElement) return;

    // Check for shadow DOM
    const observeRoot = amLyricsElement.shadowRoot || amLyricsElement;

    this.romajiObserver = new MutationObserver((mutations) => {
      // Only process if new text content was added (ignore attribute changes like highlight)
      const hasNewContent = mutations.some(
        (mutation) =>
          mutation.type === "childList" && mutation.addedNodes.length > 0,
      );

      if (!hasNewContent) {
        // Ignore highlight changes and other attribute mutations
        return;
      }

      // Debounce mutations
      if (this.observerTimeout) {
        clearTimeout(this.observerTimeout);
      }
      this.observerTimeout = setTimeout(async () => {
        await this.convertLyricsContent(amLyricsElement);
      }, 100);
    });

    // Observe all child nodes for changes (in shadow DOM if it exists)
    // Only watch for new nodes, not attribute changes (to avoid highlight spam)
    this.romajiObserver.observe(observeRoot, {
      childList: true,
      subtree: true,
      characterData: false, // Don't watch text changes, only new nodes
      attributes: false, // Don't watch attribute changes (highlight, etc)
    });

    // Initial conversion if Romaji mode is enabled
    if (this.isRomajiMode) {
      // Try immediately and after delays to catch lyrics when they load
      this.convertLyricsContent(amLyricsElement);
      setTimeout(async () => {
        await this.convertLyricsContent(amLyricsElement);
      }, 500);
      setTimeout(async () => {
        await this.convertLyricsContent(amLyricsElement);
      }, 1500);
      setTimeout(async () => {
        await this.convertLyricsContent(amLyricsElement);
      }, 3000);
    }
  }

  // Convert lyrics content to Romaji
  async convertLyricsContent(amLyricsElement) {
    if (!amLyricsElement || !this.isRomajiMode) {
      return;
    }

    // Find the root to traverse - check for shadow DOM first
    const rootToTraverse = amLyricsElement.shadowRoot || amLyricsElement;

    // Make sure Kuroshiro is ready
    if (!this.kuroshiroLoaded) {
      const success = await this.loadKuroshiro();
      if (!success) {
        console.warn("Cannot convert lyrics - Kuroshiro load failed");
        return;
      }
    }

    // Find all text nodes in the component
    const textNodes = [];
    const walker = document.createTreeWalker(
      rootToTraverse,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // Convert Japanese text to Romaji (using async/await for Kuroshiro)
    let convertedCount = 0;

    for (const textNode of textNodes) {
      // Skip if already converted
      if (this.convertedNodes.has(textNode)) {
        continue;
      }

      if (!textNode.parentElement) {
        continue;
      }

      const parentTag = textNode.parentElement.tagName?.toLowerCase();
      const parentClass = String(textNode.parentElement.className || "");

      // Skip elements that shouldn't be converted
      const skipTags = ["script", "style", "code", "input", "textarea", "time"];
      if (skipTags.includes(parentTag)) {
        continue;
      }

      const originalText = textNode.textContent;

      // Skip progress indicators and timestamps (but NOT progress-text which is the actual lyrics!)
      if (
        (parentClass.includes("progress") &&
          !parentClass.includes("progress-text")) ||
        (parentClass.includes("time") &&
          !parentClass.includes("progress-text")) ||
        parentClass.includes("timestamp")
      ) {
        continue;
      }

      if (!originalText || originalText.trim().length === 0) {
        continue;
      }

      // Check if contains Japanese
      if (this.containsJapanese(originalText)) {
        const romajiText = await this.convertToRomaji(originalText);

        if (romajiText && romajiText !== originalText) {
          textNode.textContent = romajiText;
          // Mark as converted
          this.convertedNodes.add(textNode);
          convertedCount++;
        }
      }
    }
  }

  // Stop the observer
  stopLyricsObserver() {
    if (this.romajiObserver) {
      this.romajiObserver.disconnect();
      this.romajiObserver = null;
    }
    if (this.observerTimeout) {
      clearTimeout(this.observerTimeout);
      this.observerTimeout = null;
    }
    // Clear converted nodes tracking when stopping
    this.convertedNodes = new WeakSet();
  }

  // Toggle Romaji mode
  async toggleRomajiMode(amLyricsElement) {
    this.isRomajiMode = !this.isRomajiMode;
    this.setRomajiMode(this.isRomajiMode);

    if (amLyricsElement) {
      if (this.isRomajiMode) {
        // Turning ON: Setup observer and convert immediately
        this.setupLyricsObserver(amLyricsElement);
        // Also try immediate conversion (don't wait for timeout)
        await this.convertLyricsContent(amLyricsElement);
      } else {
        // Turning OFF: Stop observer (original lyrics should remain)
        // Note: To restore original Japanese, we'd need to reload the component
        // For now, the converted text stays until lyrics are reloaded
        this.stopLyricsObserver();
      }
    }

    return this.isRomajiMode;
  }
}

export async function openLyricsPanel(track, audioPlayer, lyricsManager) {
  const manager = lyricsManager || new LyricsManager();

  // Load Kuroshiro early for Kanji conversion (blocking if Romaji mode is enabled)
  if (!manager.kuroshiroLoaded && !manager.kuroshiroLoading) {
    if (manager.getRomajiMode()) {
      // If Romaji mode is enabled, wait for Kuroshiro to load before continuing
      await manager.loadKuroshiro();
    } else {
      // Otherwise, load in background
      manager.loadKuroshiro().catch((err) => {
        console.warn("Failed to load Kuroshiro for Romaji conversion:", err);
      });
    }
  }

  const renderControls = (container) => {
    const isRomajiMode = manager.getRomajiMode();
    manager.isRomajiMode = isRomajiMode;

    container.innerHTML = `
            <button id="close-side-panel-btn" class="btn-icon" title="Close">
                ${SVG_CLOSE}
            </button>
            <button id="romaji-toggle-btn" class="btn-icon" title="Toggle Romaji (Japanese to Latin)" data-enabled="${isRomajiMode}" style="color: ${isRomajiMode ? "var(--primary)" : ""}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
            </button>
        `;

    container
      .querySelector("#close-side-panel-btn")
      .addEventListener("click", () => {
        sidePanelManager.close();
        clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
      });

    // Romaji toggle button handler
    const romajiBtn = container.querySelector("#romaji-toggle-btn");
    if (romajiBtn) {
      const updateRomajiBtn = () => {
        const enabled = manager.isRomajiMode;
        romajiBtn.setAttribute("data-enabled", enabled);
        romajiBtn.style.color = enabled ? "var(--primary)" : "";
      };
      updateRomajiBtn();

      romajiBtn.addEventListener("click", async () => {
        const amLyrics = sidePanelManager.panel.querySelector("am-lyrics");
        if (amLyrics) {
          const newMode = await manager.toggleRomajiMode(amLyrics);
          updateRomajiBtn();
        }
      });
    }
  };

  const renderContent = async (container) => {
    clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
    await renderLyricsComponent(container, track, audioPlayer, manager);
  };

  sidePanelManager.open("lyrics", "Lyrics", renderControls, renderContent);
}

async function renderLyricsComponent(
  container,
  track,
  audioPlayer,
  lyricsManager,
) {
  container.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';

  try {
    await lyricsManager.ensureComponentLoaded();

    // Set initial Romaji mode
    lyricsManager.isRomajiMode = lyricsManager.getRomajiMode();
    lyricsManager.currentTrackId = track.id;

    const title = track.title;
    const artist = getTrackArtists(track);
    const album = track.album?.title;
    const durationMs = track.duration
      ? Math.round(track.duration * 1000)
      : undefined;
    const isrc = track.isrc || "";

    container.innerHTML = "";
    const amLyrics = document.createElement("am-lyrics");
    amLyrics.setAttribute("song-title", title);
    amLyrics.setAttribute("song-artist", artist);
    if (album) amLyrics.setAttribute("song-album", album);
    if (durationMs) amLyrics.setAttribute("song-duration", durationMs);
    amLyrics.setAttribute("query", `${title} ${artist}`.trim());
    if (isrc) amLyrics.setAttribute("isrc", isrc);

    amLyrics.setAttribute("highlight-color", "#93c5fd");
    amLyrics.setAttribute("hover-background-color", "rgba(59, 130, 246, 0.14)");
    amLyrics.setAttribute("autoscroll", "");
    amLyrics.setAttribute("interpolate", "");
    amLyrics.style.height = "100%";
    amLyrics.style.width = "100%";

    container.appendChild(amLyrics);

    // Wait for lyrics to load in the component, then setup observer
    const waitForLyrics = () => {
      return new Promise((resolve) => {
        // Check if lyrics are already loaded
        const hasLyrics =
          amLyrics.querySelector(".lyric-line, [class*='lyric']") ||
          (amLyrics.textContent && amLyrics.textContent.length > 50);

        if (hasLyrics) {
          resolve();
          return;
        }

        // Wait up to 10 seconds for lyrics to load
        let attempts = 0;
        const maxAttempts = 20;
        const interval = setInterval(() => {
          attempts++;
          const hasContent =
            amLyrics.querySelector(".lyric-line, [class*='lyric']") ||
            (amLyrics.textContent && amLyrics.textContent.length > 50);
          if (hasContent || attempts >= maxAttempts) {
            clearInterval(interval);
            resolve();
          }
        }, 500);
      });
    };

    await waitForLyrics();

    // Setup observer to convert lyrics to Romaji
    lyricsManager.setupLyricsObserver(amLyrics);

    // If Romaji mode is already enabled, convert after shadow DOM is ready
    if (lyricsManager.isRomajiMode) {
      // Ensure Kuroshiro is loaded before converting
      if (!lyricsManager.kuroshiroLoaded) {
        await lyricsManager.loadKuroshiro();
      }
      // Add small delay to ensure shadow DOM is fully populated
      await new Promise((resolve) => setTimeout(resolve, 200));
      await lyricsManager.convertLyricsContent(amLyrics);
    }

    const cleanup = setupSync(track, audioPlayer, amLyrics);

    // Attach cleanup to container for easy access
    container.lyricsCleanup = cleanup;
    container.lyricsManager = lyricsManager;

    return amLyrics;
  } catch (error) {
    console.error("Failed to load lyrics:", error);
    container.innerHTML =
      '<div class="lyrics-error">Failed to load lyrics</div>';
    return null;
  }
}

function setupSync(track, audioPlayer, amLyrics) {
  let baseTimeMs = 0;
  let lastTimestamp = performance.now();
  let animationFrameId = null;

  const updateTime = () => {
    const currentMs = audioPlayer.currentTime * 1000;
    baseTimeMs = currentMs;
    lastTimestamp = performance.now();
    amLyrics.currentTime = currentMs;
  };

  const tick = () => {
    if (!audioPlayer.paused) {
      const now = performance.now();
      const elapsed = now - lastTimestamp;
      const nextMs = baseTimeMs + elapsed;
      amLyrics.currentTime = nextMs;
      animationFrameId = requestAnimationFrame(tick);
    }
  };

  const onPlay = () => {
    baseTimeMs = audioPlayer.currentTime * 1000;
    lastTimestamp = performance.now();
    tick();
  };

  const onPause = () => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const onLineClick = (e) => {
    if (e.detail && e.detail.timestamp) {
      audioPlayer.currentTime = e.detail.timestamp / 1000;
      audioPlayer.play();
    }
  };

  audioPlayer.addEventListener("timeupdate", updateTime);
  audioPlayer.addEventListener("play", onPlay);
  audioPlayer.addEventListener("pause", onPause);
  audioPlayer.addEventListener("seeked", updateTime);
  amLyrics.addEventListener("line-click", onLineClick);

  if (!audioPlayer.paused) {
    tick();
  }

  return () => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    audioPlayer.removeEventListener("timeupdate", updateTime);
    audioPlayer.removeEventListener("play", onPlay);
    audioPlayer.removeEventListener("pause", onPause);
    audioPlayer.removeEventListener("seeked", updateTime);
    amLyrics.removeEventListener("line-click", onLineClick);
  };
}

export async function renderLyricsInFullscreen(
  track,
  audioPlayer,
  lyricsManager,
  container,
) {
  return renderLyricsComponent(container, track, audioPlayer, lyricsManager);
}

export function clearFullscreenLyricsSync(container) {
  if (container && container.lyricsCleanup) {
    container.lyricsCleanup();
    container.lyricsCleanup = null;
  }
  if (container && container.lyricsManager) {
    container.lyricsManager.stopLyricsObserver();
  }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
  if (panel && panel.lyricsCleanup) {
    panel.lyricsCleanup();
    panel.lyricsCleanup = null;
  }
  if (panel && panel.lyricsManager) {
    panel.lyricsManager.stopLyricsObserver();
  }
}
