//js/lyrics.js
import {
  getTrackTitle,
  getTrackArtists,
  buildTrackFilename,
  SVG_DOWNLOAD,
  SVG_CLOSE,
} from "./utils.js";
import { sidePanelManager } from "./side-panel.js";

// Dictionary path for kuromoji
// Using CDN - the kuroshiro-analyzer loaded from unpkg will use this as base for fetching dict files
const KUROMOJI_DICT_PATH = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

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
    this.romajiTextCache = new Map(); // Cache: originalText -> convertedRomaji
    this.convertedTracksCache = new Set(); // Track IDs that have been fully converted
    this.originalLinesCache = new Map(); // Cache: line element -> original innerHTML
    this.isConverting = false; // Prevent overlapping conversions
  }

  // Load Kuroshiro from CDN (npm package uses Node.js path which doesn't work in browser)
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
      // Bug on kuromoji@0.1.2 where it mangles absolute URLs
      // Using self-hosted dict files is failed, so we use CDN with monkey-patch
      // Monkey-patch XMLHttpRequest to redirect dictionary requests to CDN
      // Kuromoji uses XHR, not fetch, for loading dictionary files
      if (!window._originalXHROpen) {
        window._originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          const urlStr = url.toString();
          if (urlStr.includes("/dict/") && urlStr.includes(".dat.gz")) {
            // Extract just the filename
            const filename = urlStr.split("/").pop();
            // Redirect to CDN
            const cdnUrl = `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${filename}`;
            return window._originalXHROpen.call(this, method, cdnUrl, ...rest);
          }
          return window._originalXHROpen.call(this, method, url, ...rest);
        };
      }

      // Also patch fetch just in case
      if (!window._originalFetch) {
        window._originalFetch = window.fetch;
        window.fetch = async (url, options) => {
          const urlStr = url.toString();
          if (urlStr.includes("/dict/") && urlStr.includes(".dat.gz")) {
            const filename = urlStr.split("/").pop();
            const cdnUrl = `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${filename}`;
            console.log(`Redirecting dict fetch: ${filename} -> CDN`);
            return window._originalFetch(cdnUrl, options);
          }
          return window._originalFetch(url, options);
        };
      }

      // Load Kuroshiro from CDN
      if (!window.Kuroshiro) {
        await this.loadScript(
          "https://unpkg.com/kuroshiro@1.2.0/dist/kuroshiro.min.js"
        );
      }

      // Load Kuromoji analyzer from CDN
      if (!window.KuromojiAnalyzer) {
        await this.loadScript(
          "https://unpkg.com/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js"
        );
      }

      // Initialize Kuroshiro (CDN version exports as .default)
      const Kuroshiro = window.Kuroshiro.default || window.Kuroshiro;
      const KuromojiAnalyzer =
        window.KuromojiAnalyzer.default || window.KuromojiAnalyzer;

      this.kuroshiro = new Kuroshiro();

      // Initialize with a dummy path - our fetch interceptor will redirect to CDN
      await this.kuroshiro.init(
        new KuromojiAnalyzer({
          dictPath: "/dict/", // This gets mangled but our interceptor fixes it
        })
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
      // Check if script already exists
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
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

  // Convert Japanese text to Romaji (including Kanji) with caching
  async convertToRomaji(text) {
    if (!text) return text;

    // Check cache first
    if (this.romajiTextCache.has(text)) {
      return this.romajiTextCache.get(text);
    }

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
      // Cache the result
      this.romajiTextCache.set(text, result);
      return result;
    } catch (error) {
      console.warn(
        "Romaji conversion failed for text:",
        text.substring(0, 30),
        error
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
          `https://lrclib.net/api/get?${params.toString()}`
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
      ".lrc"
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

  // Helper method to extract full line text from progress-text spans
  extractLineText(lineElement) {
    const spans = lineElement.querySelectorAll(".progress-text");
    const chars = [];

    spans.forEach((span) => {
      const text = span.textContent.trim();
      if (text) {
        chars.push(text);
      }
    });

    return chars.join("");
  }

  // Helper method to replace line content with romaji (single text, uses interpolate timing)
  replaceLineWithRomaji(line, spans, romajiText) {
    // Get the parent container that holds all the progress-text spans
    const spansContainer = spans[0]?.parentElement;
    if (!spansContainer) return;

    // Save original HTML if not already saved
    if (!this.originalLinesCache.has(line)) {
      this.originalLinesCache.set(line, spansContainer.innerHTML);
    }

    // Inject romaji styles once (into shadow DOM if present)
    this.injectRomajiStyles(line);

    // Create a single span with the full romaji text
    // Using the same class structure as original for styling compatibility
    const romajiSpan = document.createElement("span");
    romajiSpan.className = "progress-text romaji-converted";
    romajiSpan.textContent = romajiText;

    // Clear all existing spans and add the single romaji span
    spansContainer.innerHTML = "";
    spansContainer.appendChild(romajiSpan);
  }

  // Inject CSS for romaji highlighting into shadow DOM
  injectRomajiStyles(line) {
    // Find the shadow root or document
    const root = line.getRootNode();
    if (root._romajiStylesInjected) return;

    const style = document.createElement("style");
    style.textContent = `
      /* Romaji converted text - base style (not active) */
      .romaji-converted {
        transition: color 0.3s ease;
        color: rgba(255, 255, 255, 0.5);
      }
      
      /* Active line - full highlight */
      div.active-line {
        color: var(--highlight-color, #93c5fd);
      }
    `;

    if (root instanceof ShadowRoot) {
      root.appendChild(style);
    } else if (root.head) {
      root.head.appendChild(style);
    }

    root._romajiStylesInjected = true;

    // Also setup an observer to forward line opacity to romaji spans
    this.setupLineStyleObserver(root);
  }

  // Observe class changes on lyrics-line and update romaji span styles
  setupLineStyleObserver(root) {
    if (root._lineStyleObserver) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const line = mutation.target;
        if (!line.classList || !line.classList.contains("lyrics-line")) return;

        const romajiSpan = line.querySelector(".romaji-converted");
        if (!romajiSpan) return;

        // Check if line has active-line class
        if (line.classList.contains("active-line")) {
          // Active line - full highlight
          romajiSpan.style.color = "var(--highlight-color, #93c5fd)";
          romajiSpan.style.setProperty("--line-progress", "100%");
        } else {
          // Inactive line - dim
          romajiSpan.style.color = "rgba(255, 255, 255, 0.5)";
          romajiSpan.style.setProperty("--line-progress", "0%");
        }
      });
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });

    root._lineStyleObserver = observer;
  }

  // Restore original Japanese content for a line
  restoreLineFromCache(line) {
    const spansContainer = line.querySelector("span");
    if (!spansContainer) return;

    const originalHTML = this.originalLinesCache.get(line);
    if (originalHTML) {
      spansContainer.innerHTML = originalHTML;
    }
  }

  // Restore all lines to original Japanese
  restoreAllLines(amLyricsElement) {
    if (!amLyricsElement) return;

    const rootToTraverse = amLyricsElement.shadowRoot || amLyricsElement;
    const lyricsLines = rootToTraverse.querySelectorAll(".lyrics-line");

    lyricsLines.forEach((line) => {
      this.restoreLineFromCache(line);
    });
  }

  // Setup MutationObserver to convert lyrics in am-lyrics component
  setupLyricsObserver(amLyricsElement) {
    this.stopLyricsObserver();

    if (!amLyricsElement) return;

    // Check for shadow DOM
    const observeRoot = amLyricsElement.shadowRoot || amLyricsElement;

    this.romajiObserver = new MutationObserver((mutations) => {
      // Check if any relevant mutation occurred
      const hasRelevantChange = mutations.some((mutation) => {
        // New nodes added
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          return true;
        }
        // Text content changed
        if (mutation.type === "characterData" && mutation.target.textContent) {
          // Only trigger if the text contains Japanese
          return this.containsJapanese(mutation.target.textContent);
        }
        return false;
      });

      if (!hasRelevantChange) {
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
    // Watch for new nodes AND text content changes to catch when lyrics refresh
    this.romajiObserver.observe(observeRoot, {
      childList: true,
      subtree: true,
      characterData: true, // Watch text changes to catch lyric refreshes
      attributes: false, // Don't watch attribute changes (highlight, etc)
    });

    // Initial conversion if Romaji mode is enabled - single attempt, no periodic polling
    if (this.isRomajiMode) {
      this.convertLyricsContent(amLyricsElement);
    }
  }

  // Convert lyrics content to Romaji
  async convertLyricsContent(amLyricsElement) {
    if (!amLyricsElement || !this.isRomajiMode) {
      return;
    }

    // Prevent overlapping conversions
    if (this.isConverting) {
      return;
    }
    this.isConverting = true;

    try {
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

      // NEW APPROACH: Find lyrics lines instead of individual text nodes
      const lyricsLines = rootToTraverse.querySelectorAll(".lyrics-line");

      if (lyricsLines.length === 0) {
        return;
      }

      // Check if already fully converted (all lines have romaji-converted)
      const unconvertedLines = Array.from(lyricsLines).filter(
        (line) => !line.querySelector(".romaji-converted")
      );

      if (unconvertedLines.length === 0) {
        return; // All lines already converted
      }

      // Process only unconverted lines
      for (const line of unconvertedLines) {
        const spans = line.querySelectorAll(".progress-text");

        if (spans.length === 0) continue;

        // Step 1: Extract full line text for proper context
        const fullText = this.extractLineText(line);

        if (!fullText || !this.containsJapanese(fullText)) {
          continue;
        }

        // Skip if already converted (check first span)
        const firstSpanText = spans[0].textContent.trim();
        if (!this.containsJapanese(firstSpanText)) {
          continue; // Already converted
        }

        // Step 2: Convert with FULL CONTEXT using Kuroshiro
        const romajiText = await this.convertToRomaji(fullText);

        if (!romajiText || romajiText === fullText) {
          continue;
        }

        // Step 3: Replace all spans with single romaji text (uses interpolate timing)
        this.replaceLineWithRomaji(line, spans, romajiText);
      }

      // Mark this track as converted
      if (this.currentTrackId) {
        this.convertedTracksCache.add(this.currentTrackId);
      }
    } finally {
      this.isConverting = false;
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
  }

  // Toggle Romaji mode
  async toggleRomajiMode(amLyricsElement) {
    this.isRomajiMode = !this.isRomajiMode;
    this.setRomajiMode(this.isRomajiMode);

    if (amLyricsElement) {
      if (this.isRomajiMode) {
        // Turning ON: Setup observer and convert immediately
        this.setupLyricsObserver(amLyricsElement);
        await this.convertLyricsContent(amLyricsElement);
      } else {
        // Turning OFF: Stop observer and restore original Japanese
        this.stopLyricsObserver();
        this.restoreAllLines(amLyricsElement);
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
            <button id="romaji-toggle-btn" class="btn-icon" title="Toggle Romaji (Japanese to Latin)" data-enabled="${isRomajiMode}" style="color: ${
      isRomajiMode ? "var(--primary)" : ""
    }">
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
  lyricsManager
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

    // Setup observer IMMEDIATELY to catch lyrics as they load (not after waiting)
    // This is critical - observer must be running before lyrics arrive from LRCLIB
    lyricsManager.setupLyricsObserver(amLyrics);

    // If Romaji mode is enabled, ensure Kuroshiro is ready
    if (lyricsManager.isRomajiMode && !lyricsManager.kuroshiroLoaded) {
      await lyricsManager.loadKuroshiro();
    }

    // Wait for lyrics to appear, then do an immediate conversion
    const waitForLyrics = () => {
      return new Promise((resolve) => {
        // Check if lyrics are already loaded
        const checkForLyrics = () => {
          const hasLyrics =
            amLyrics.querySelector(".lyric-line, [class*='lyric']") ||
            (amLyrics.shadowRoot &&
              amLyrics.shadowRoot.querySelector("[class*='lyric']")) ||
            (amLyrics.textContent && amLyrics.textContent.length > 50);
          return hasLyrics;
        };

        if (checkForLyrics()) {
          resolve();
          return;
        }

        // Check more frequently (200ms) for faster response
        let attempts = 0;
        const maxAttempts = 25; // 5 seconds max
        const interval = setInterval(() => {
          attempts++;
          if (checkForLyrics() || attempts >= maxAttempts) {
            clearInterval(interval);
            resolve();
          }
        }, 200);
      });
    };

    await waitForLyrics();

    // Convert immediately after lyrics detected
    if (lyricsManager.isRomajiMode) {
      await lyricsManager.convertLyricsContent(amLyrics);
      // One retry after 500ms in case more lyrics load
      setTimeout(() => lyricsManager.convertLyricsContent(amLyrics), 500);
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
  container
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
