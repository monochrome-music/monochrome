// js/feature-integrator.js
// Lazy-loads and initializes all new feature modules
// Imported from app.js after core initialization

let featuresInitialized = false;

/**
 * Initialize all new feature modules.
 * Call this after Player, UIRenderer, and MusicAPI are ready.
 * @param {object} deps - { player, uiRenderer, musicAPI, audioPlayer }
 */
export async function initializeNewFeatures(deps) {
  if (featuresInitialized) return;
  featuresInitialized = true;

  const { player, audioPlayer } = deps;

  // 1. A-B Loop
  try {
    const { ABLoop } = await import('./ab-loop.js');
    const abLoop = new ABLoop(player, audioPlayer);
    window.monochromeABLoop = abLoop;
    console.log('[Features] A-B Loop initialized');
  } catch (e) {
    console.warn('[Features] Failed to init A-B Loop:', e);
  }

  // 2. Spectrum Analyzer
  try {
    const { SpectrumAnalyzer } = await import('./spectrum-analyzer.js');
    const analyzer = new SpectrumAnalyzer({
      barCount: 32,
      width: 120,
      height: 30,
    });
    // Attach to now-playing bar
    const nowPlayingBar = document.querySelector('.now-playing-bar .controls');
    if (nowPlayingBar) {
      analyzer.createCanvas(nowPlayingBar);
    }
    // Connect when audio plays
    const connectAnalyzer = () => {
      if (audioPlayer && !analyzer.isRunning) {
        analyzer.connect(audioPlayer);
        analyzer.start();
      }
    };
    audioPlayer.addEventListener('play', connectAnalyzer);
    audioPlayer.addEventListener('pause', () => analyzer.stop());
    audioPlayer.addEventListener('ended', () => analyzer.stop());
    window.monochromeSpectrumAnalyzer = analyzer;
    console.log('[Features] Spectrum Analyzer initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Spectrum Analyzer:', e);
  }

  // 3. Spatial Audio
  try {
    const { SpatialAudio } = await import('./spatial-audio.js');
    const spatial = new SpatialAudio(audioPlayer);
    window.monochromeSpatialAudio = spatial;
    console.log('[Features] Spatial Audio initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Spatial Audio:', e);
  }

  // 4. Timestamp Comments
  try {
    const { TimestampComments } = await import('./timestamp-comments.js');
    const comments = new TimestampComments();
    window.monochromeTimestampComments = comments;
    console.log('[Features] Timestamp Comments initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Timestamp Comments:', e);
  }

  // 5. Listening Heatmap
  try {
    const { ListeningHeatmap } = await import('./listening-heatmap.js');
    const heatmap = new ListeningHeatmap();
    // Record listening data on timeupdate
    audioPlayer.addEventListener('timeupdate', () => {
      if (player.currentTrack && audioPlayer.duration) {
        heatmap.record(
          player.currentTrack.id,
          audioPlayer.currentTime,
          audioPlayer.duration
        );
      }
    });
    window.monochromeListeningHeatmap = heatmap;
    console.log('[Features] Listening Heatmap initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Listening Heatmap:', e);
  }

  // 6. Artist Wiki
  try {
    const { ArtistWiki } = await import('./artist-wiki.js');
    const wiki = new ArtistWiki();
    window.monochromeArtistWiki = wiki;
    console.log('[Features] Artist Wiki initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Artist Wiki:', e);
  }

  // 7. Similar Tracks Graph
  try {
    const { SimilarTracksGraph } = await import('./similar-tracks-graph.js');
    const graph = new SimilarTracksGraph();
    window.monochromeSimilarTracksGraph = graph;
    console.log('[Features] Similar Tracks Graph initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Similar Tracks Graph:', e);
  }

  console.log('[Features] All new features initialized successfully');
}
