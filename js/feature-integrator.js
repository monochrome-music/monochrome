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
    const nowPlayingBar = document.querySelector('.now-playing-bar .controls');
    if (nowPlayingBar) {
      analyzer.createCanvas(nowPlayingBar);
    }
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

  // 8. Sleep Timer
  try {
    const { SleepTimer } = await import('./sleep-timer.js');
    const sleepTimer = new SleepTimer(audioPlayer);
    window.monochromeSleepTimer = sleepTimer;
    console.log('[Features] Sleep Timer initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Sleep Timer:', e);
  }

  // 9. Crossfade
  try {
    const { Crossfade } = await import('./crossfade.js');
    const crossfade = new Crossfade(player, audioPlayer);
    window.monochromeCrossfade = crossfade;
    console.log('[Features] Crossfade initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Crossfade:', e);
  }

  // 10. Playback Stats
  try {
    const { PlaybackStats } = await import('./playback-stats.js');
    const stats = new PlaybackStats(player, audioPlayer);
    window.monochromePlaybackStats = stats;
    console.log('[Features] Playback Stats initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Playback Stats:', e);
  }

  // 11. Social Share
  try {
    const { SocialShare } = await import('./social-share.js');
    const socialShare = new SocialShare(player);
    window.monochromeSocialShare = socialShare;
    console.log('[Features] Social Share initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Social Share:', e);
  }

  // 12. Audio Normalization
  try {
    const { AudioNormalization } = await import('./audio-normalization.js');
    const normalization = new AudioNormalization(audioPlayer);
    window.monochromeAudioNormalization = normalization;
    console.log('[Features] Audio Normalization initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Audio Normalization:', e);
  }

  // 13. Mini Player
  try {
    const { MiniPlayer } = await import('./mini-player.js');
    const miniPlayer = new MiniPlayer(player, audioPlayer);
    window.monochromeMiniPlayer = miniPlayer;
    console.log('[Features] Mini Player initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Mini Player:', e);
  }

  // 14. Keyboard Shortcuts
  try {
    const { KeyboardShortcuts } = await import('./keyboard-shortcuts.js');
    const shortcuts = new KeyboardShortcuts(player, audioPlayer);
    window.monochromeKeyboardShortcuts = shortcuts;
    console.log('[Features] Keyboard Shortcuts initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Keyboard Shortcuts:', e);
  }

  // 15. Mood Tag
  try {
    const { MoodTag } = await import('./mood-tag.js');
    const moodTag = new MoodTag(player);
    window.monochromeMoodTag = moodTag;
    console.log('[Features] Mood Tag initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Mood Tag:', e);
  }

  // 16. 3D Visualizer
  try {
    const { Visualizer3D } = await import('./3d-visualizer.js');
    const viz3d = new Visualizer3D(audioPlayer);
    window.monochromeVisualizer3D = viz3d;
    console.log('[Features] 3D Visualizer initialized');
  } catch (e) {
    console.warn('[Features] Failed to init 3D Visualizer:', e);
  }

  // 17. Equalizer Studio (initialized but not connected to AudioContext yet - done on demand)
  try {
    const { EqualizerStudio } = await import('./equalizer-studio.js');
    const eqStudio = new EqualizerStudio(audioPlayer);
    window.monochromeEqualizerStudio = eqStudio;
    console.log('[Features] Equalizer Studio initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Equalizer Studio:', e);
  }

  // 18. Release Radar
  try {
    const { ReleaseRadar } = await import('./release-radar.js');
    const { musicAPI } = deps;
    const radar = new ReleaseRadar(musicAPI);
    window.monochromeReleaseRadar = radar;
    console.log('[Features] Release Radar initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Release Radar:', e);
  }

  // 19. Collaborative Room
  try {
    const { CollaborativeRoom } = await import('./collaborative-room.js');
    const collabRoom = new CollaborativeRoom(player);
    window.monochromeCollaborativeRoom = collabRoom;
    console.log('[Features] Collaborative Room initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Collaborative Room:', e);
  }

  // 20. Stats Dashboard
  try {
    const { StatsDashboard } = await import('./stats-dashboard.js');
    const statsDashboard = new StatsDashboard();
    window.monochromeStatsDashboard = statsDashboard;
    console.log('[Features] Stats Dashboard initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Stats Dashboard:', e);
  }

  // 21. Social Profile
  try {
    const { SocialProfile } = await import('./social-profile.js');
    const { syncManager } = deps;
    const socialProfile = new SocialProfile(syncManager);
    window.monochromeSocialProfile = socialProfile;
    console.log('[Features] Social Profile initialized');
  } catch (e) {
    console.warn('[Features] Failed to init Social Profile:', e);
  }

  console.log('[Features] All new features initialized successfully');
}
