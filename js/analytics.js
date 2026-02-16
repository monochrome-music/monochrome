// js/analytics.js - Plausible Analytics custom event tracking

import { analyticsSettings } from './storage.js';

/**
 * Check if analytics is enabled
 * @returns {boolean}
 */
function isAnalyticsEnabled() {
    return analyticsSettings.isEnabled();
}

/**
 * Track a custom event with Plausible
 * @param {string} eventName - The name of the event
 * @param {object} [props] - Optional event properties
 */
export function trackEvent(eventName, props = {}) {
    if (!isAnalyticsEnabled()) return;
    if (window.plausible) {
        try {
            window.plausible(eventName, { props });
        } catch {
            // Silently fail if analytics is blocked
        }
    }
}

/**
 * Track page views with custom properties
 * @param {string} path - The page path
 */
export function trackPageView(path) {
    trackEvent('pageview', { path });
}

// Playback Events
export function trackPlayTrack(track) {
    trackEvent('Play Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        album: track?.album?.title || 'Unknown',
        duration: track?.duration || 0,
        quality: track?.audioQuality || track?.quality || 'Unknown',
        is_local: track?.isLocal || false,
        is_explicit: track?.explicit || false,
        track_number: track?.trackNumber || 0,
        year: track?.album?.releaseYear || track?.album?.releaseDate || 'unknown',
    });
}

export function trackPauseTrack(track) {
    trackEvent('Pause Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        album: track?.album?.title || 'Unknown',
    });
}

export function trackSkipTrack(track, direction) {
    trackEvent('Skip Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        album: track?.album?.title || 'Unknown',
        direction: direction,
    });
}

export function trackToggleShuffle(enabled) {
    trackEvent('Toggle Shuffle', { enabled });
}

export function trackToggleRepeat(mode) {
    trackEvent('Toggle Repeat', { mode });
}

export function trackTrackComplete(track, completionPercent) {
    trackEvent('Track Complete', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        album: track?.album?.title || 'Unknown',
        duration: track?.duration || 0,
        completion_percent: completionPercent || 100,
    });
}

export function trackSetVolume(level) {
    // Only track volume changes at coarse intervals to avoid spam
    const roundedLevel = Math.round(level * 10) / 10;
    trackEvent('Set Volume', { level: roundedLevel });
}

export function trackToggleMute(muted) {
    trackEvent('Toggle Mute', { muted });
}

export function trackSeek(position, duration) {
    const progress = duration ? Math.round((position / duration) * 100) : 0;
    // Track seek at 25%, 50%, 75% milestones
    if (progress >= 25 && progress < 30) {
        trackEvent('Seek', { milestone: '25%', position });
    } else if (progress >= 50 && progress < 55) {
        trackEvent('Seek', { milestone: '50%', position });
    } else if (progress >= 75 && progress < 80) {
        trackEvent('Seek', { milestone: '75%', position });
    }
}

// Track listening progress milestones (10%, 25%, 50%, 75%, 90%, 100%)
export function trackListeningProgress(track, percent) {
    trackEvent('Listening Progress', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        percent: percent,
    });
}

// Search Events
export function trackSearch(query, resultsCount) {
    trackEvent('Search', {
        query_length: query?.length || 0,
        has_results: resultsCount > 0,
        results_count: resultsCount,
    });
}

export function trackSearchTabChange(tab) {
    trackEvent('Search Tab Change', { tab });
}

// Navigation Events
export function trackNavigate(path, pageType) {
    trackEvent('Navigate', {
        path,
        page_type: pageType,
    });
}

export function trackSidebarNavigation(item) {
    trackEvent('Sidebar Navigation', { item });
}

// Library Events
export function trackLikeTrack(track) {
    trackEvent('Like Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        album: track?.album?.title || 'Unknown',
    });
}

export function trackUnlikeTrack(track) {
    trackEvent('Unlike Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
    });
}

export function trackLikeAlbum(album) {
    trackEvent('Like Album', {
        album_title: album?.title || 'Unknown',
        artist: album?.artist?.name || 'Unknown',
    });
}

export function trackUnlikeAlbum(album) {
    trackEvent('Unlike Album', {
        album_title: album?.title || 'Unknown',
    });
}

export function trackLikeArtist(artist) {
    trackEvent('Like Artist', {
        artist_name: artist?.name || 'Unknown',
    });
}

export function trackUnlikeArtist(artist) {
    trackEvent('Unlike Artist', {
        artist_name: artist?.name || 'Unknown',
    });
}

export function trackLikePlaylist(playlist) {
    trackEvent('Like Playlist', {
        playlist_name: playlist?.title || playlist?.name || 'Unknown',
    });
}

export function trackUnlikePlaylist(playlist) {
    trackEvent('Unlike Playlist', {
        playlist_name: playlist?.title || playlist?.name || 'Unknown',
    });
}

// Playlist Management Events
export function trackCreatePlaylist(playlist, source) {
    trackEvent('Create Playlist', {
        playlist_name: playlist?.name || 'Unknown',
        track_count: playlist?.tracks?.length || 0,
        is_public: playlist?.isPublic || false,
        source: source || 'manual',
    });
}

export function trackEditPlaylist(playlist) {
    trackEvent('Edit Playlist', {
        playlist_name: playlist?.name || 'Unknown',
    });
}

export function trackDeletePlaylist(playlistName) {
    trackEvent('Delete Playlist', { playlist_name: playlistName });
}

export function trackAddToPlaylist(track, playlist) {
    trackEvent('Add to Playlist', {
        track_title: track?.title || 'Unknown',
        playlist_name: playlist?.name || 'Unknown',
    });
}

export function trackRemoveFromPlaylist(track, playlist) {
    trackEvent('Remove from Playlist', {
        track_title: track?.title || 'Unknown',
        playlist_name: playlist?.name || 'Unknown',
    });
}

export function trackCreateFolder(folder) {
    trackEvent('Create Folder', {
        folder_name: folder?.name || 'Unknown',
    });
}

export function trackDeleteFolder(folderName) {
    trackEvent('Delete Folder', { folder_name: folderName });
}

// Playback Actions
export function trackPlayAlbum(album, shuffle) {
    trackEvent('Play Album', {
        album_id: album?.id || 'unknown',
        album_title: album?.title || 'Unknown',
        artist_id: album?.artist?.id || 'unknown',
        artist: album?.artist?.name || 'Unknown',
        shuffle: shuffle || false,
        track_count: album?.numberOfTracks || album?.tracks?.length || 0,
        year: album?.releaseYear || album?.releaseDate || 'unknown',
    });
}

export function trackPlayPlaylist(playlist, shuffle) {
    trackEvent('Play Playlist', {
        playlist_id: playlist?.id || 'unknown',
        playlist_name: playlist?.title || playlist?.name || 'Unknown',
        shuffle: shuffle || false,
        track_count: playlist?.tracks?.length || 0,
        is_public: playlist?.isPublic || false,
    });
}

export function trackPlayArtistRadio(artist) {
    trackEvent('Play Artist Radio', {
        artist_id: artist?.id || 'unknown',
        artist_name: artist?.name || 'Unknown',
    });
}

export function trackShuffleLikedTracks(count) {
    trackEvent('Shuffle Liked Tracks', { track_count: count });
}

// Download Events
export function trackDownloadTrack(track, quality) {
    trackEvent('Download Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        quality: quality || 'Unknown',
    });
}

export function trackDownloadAlbum(album, quality) {
    trackEvent('Download Album', {
        album_id: album?.id || 'unknown',
        album_title: album?.title || 'Unknown',
        artist_id: album?.artist?.id || 'unknown',
        artist: album?.artist?.name || 'Unknown',
        track_count: album?.numberOfTracks || album?.tracks?.length || 0,
        quality: quality || 'Unknown',
    });
}

export function trackDownloadPlaylist(playlist, quality) {
    trackEvent('Download Playlist', {
        playlist_id: playlist?.id || 'unknown',
        playlist_name: playlist?.title || playlist?.name || 'Unknown',
        track_count: playlist?.tracks?.length || 0,
        quality: quality || 'Unknown',
    });
}

export function trackDownloadLikedTracks(count, quality) {
    trackEvent('Download Liked Tracks', {
        track_count: count,
        quality: quality || 'Unknown',
    });
}

export function trackDownloadDiscography(artist, selection) {
    trackEvent('Download Discography', {
        artist_id: artist?.id || 'unknown',
        artist_name: artist?.name || 'Unknown',
        include_albums: selection?.includeAlbums || false,
        include_eps: selection?.includeEPs || false,
        include_singles: selection?.includeSingles || false,
    });
}

// Queue Management
export function trackAddToQueue(track, position) {
    trackEvent('Add to Queue', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
        position: position || 'end',
    });
}

export function trackPlayNext(track) {
    trackEvent('Play Next', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
    });
}

export function trackClearQueue() {
    trackEvent('Clear Queue');
}

export function trackShuffleQueue() {
    trackEvent('Shuffle Queue');
}

// Context Menu Actions
export function trackContextMenuAction(action, itemType, item) {
    trackEvent('Context Menu Action', {
        action,
        item_type: itemType,
        item_name: item?.title || item?.name || 'Unknown',
    });
}

export function trackBlockTrack(track) {
    trackEvent('Block Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
        artist_id: track?.artist?.id || track?.artists?.[0]?.id || 'unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
        album_id: track?.album?.id || 'unknown',
    });
}

export function trackUnblockTrack(track) {
    trackEvent('Unblock Track', {
        track_id: track?.id || 'unknown',
        track_title: track?.title || 'Unknown',
    });
}

export function trackBlockAlbum(album) {
    trackEvent('Block Album', {
        album_id: album?.id || 'unknown',
        album_title: album?.title || 'Unknown',
        artist_id: album?.artist?.id || 'unknown',
    });
}

export function trackUnblockAlbum(album) {
    trackEvent('Unblock Album', {
        album_id: album?.id || 'unknown',
        album_title: album?.title || 'Unknown',
    });
}

export function trackBlockArtist(artist) {
    trackEvent('Block Artist', {
        artist_id: artist?.id || 'unknown',
        artist_name: artist?.name || 'Unknown',
    });
}

export function trackUnblockArtist(artist) {
    trackEvent('Unblock Artist', {
        artist_id: artist?.id || 'unknown',
        artist_name: artist?.name || 'Unknown',
    });
}

export function trackCopyLink(type, id) {
    trackEvent('Copy Link', { type, id });
}

export function trackOpenInNewTab(type, id) {
    trackEvent('Open in New Tab', { type, id });
}

// Lyrics Events
export function trackOpenLyrics(track) {
    trackEvent('Open Lyrics', {
        track_title: track?.title || 'Unknown',
        artist: track?.artist?.name || track?.artists?.[0]?.name || 'Unknown',
    });
}

export function trackCloseLyrics(track) {
    trackEvent('Close Lyrics', {
        track_title: track?.title || 'Unknown',
    });
}

// Fullscreen/Cover View Events
export function trackOpenFullscreenCover(track) {
    trackEvent('Open Fullscreen Cover', {
        track_title: track?.title || 'Unknown',
    });
}

export function trackCloseFullscreenCover() {
    trackEvent('Close Fullscreen Cover');
}

export function trackToggleVisualizer(enabled) {
    trackEvent('Toggle Visualizer', { enabled });
}

export function trackToggleLyricsFullscreen(enabled) {
    trackEvent('Toggle Lyrics Fullscreen', { enabled });
}

// Settings Events
export function trackChangeSetting(setting, value) {
    trackEvent('Change Setting', {
        setting,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    });
}

export function trackChangeTheme(theme) {
    trackEvent('Change Theme', { theme });
}

export function trackChangeQuality(type, quality) {
    trackEvent('Change Quality', { type, quality });
}

export function trackChangeVolume(volume) {
    trackEvent('Change Volume', { volume: Math.round(volume * 100) });
}

export function trackToggleScrobbler(service, enabled) {
    trackEvent('Toggle Scrobbler', { service, enabled });
}

export function trackConnectScrobbler(service) {
    trackEvent('Connect Scrobbler', { service });
}

export function trackDisconnectScrobbler(service) {
    trackEvent('Disconnect Scrobbler', { service });
}

// Local Files Events
export function trackSelectLocalFolder(fileCount) {
    trackEvent('Select Local Folder', { file_count: fileCount });
}

export function trackPlayLocalFile(track) {
    trackEvent('Play Local File', {
        track_title: track?.title || 'Unknown',
    });
}

export function trackChangeLocalFolder() {
    trackEvent('Change Local Folder');
}

// Import/Export Events
export function trackImportCSV(playlistName, trackCount, missingCount) {
    trackEvent('Import CSV', {
        playlist_name: playlistName,
        track_count: trackCount,
        missing_count: missingCount,
    });
}

export function trackImportJSPF(playlistName, trackCount, missingCount, source) {
    trackEvent('Import JSPF', {
        playlist_name: playlistName,
        track_count: trackCount,
        missing_count: missingCount,
        source: source || 'unknown',
    });
}

export function trackImportXSPF(playlistName, trackCount, missingCount) {
    trackEvent('Import XSPF', {
        playlist_name: playlistName,
        track_count: trackCount,
        missing_count: missingCount,
    });
}

export function trackImportXML(playlistName, trackCount, missingCount) {
    trackEvent('Import XML', {
        playlist_name: playlistName,
        track_count: trackCount,
        missing_count: missingCount,
    });
}

export function trackImportM3U(playlistName, trackCount, missingCount) {
    trackEvent('Import M3U', {
        playlist_name: playlistName,
        track_count: trackCount,
        missing_count: missingCount,
    });
}

// Sleep Timer Events
export function trackSetSleepTimer(minutes) {
    trackEvent('Set Sleep Timer', { minutes });
}

export function trackCancelSleepTimer() {
    trackEvent('Cancel Sleep Timer');
}

// History Events
export function trackClearHistory() {
    trackEvent('Clear History');
}

export function trackClearRecent() {
    trackEvent('Clear Recent');
}

// Casting Events
export function trackStartCasting(deviceType) {
    trackEvent('Start Casting', { device_type: deviceType });
}

export function trackStopCasting() {
    trackEvent('Stop Casting');
}

// Keyboard Shortcuts
export function trackKeyboardShortcut(key) {
    trackEvent('Keyboard Shortcut', { key });
}

// Pinning Events
export function trackPinItem(type, item) {
    trackEvent('Pin Item', {
        type,
        item_name: item?.title || item?.name || 'Unknown',
    });
}

export function trackUnpinItem(type, item) {
    trackEvent('Unpin Item', {
        type,
        item_name: item?.title || item?.name || 'Unknown',
    });
}

// Side Panel Events
export function trackOpenSidePanel(panelType) {
    trackEvent('Open Side Panel', { panel_type: panelType });
}

export function trackCloseSidePanel() {
    trackEvent('Close Side Panel');
}

// Queue Panel Events
export function trackOpenQueue() {
    trackEvent('Open Queue');
}

export function trackCloseQueue() {
    trackEvent('Close Queue');
}

// Mix Events
export function trackStartMix(sourceType, source) {
    trackEvent('Start Mix', {
        source_type: sourceType,
        source_name: source?.title || source?.name || 'Unknown',
    });
}

export function trackPlayMix(mixId) {
    trackEvent('Play Mix', { mix_id: mixId });
}

// Search History Events
export function trackClearSearchHistory() {
    trackEvent('Clear Search History');
}

export function trackClickSearchHistory(query) {
    trackEvent('Click Search History', { query_length: query?.length || 0 });
}

// PWA/Update Events
export function trackPwaInstall() {
    trackEvent('PWA Install');
}

export function trackPwaUpdate() {
    trackEvent('PWA Update');
}

export function trackDismissUpdate() {
    trackEvent('Dismiss Update');
}

// Sort Events
export function trackChangeSort(sortType) {
    trackEvent('Change Sort', { sort_type: sortType });
}

// Modal Events
export function trackOpenModal(modalName) {
    trackEvent('Open Modal', { modal_name: modalName });
}

export function trackCloseModal(modalName) {
    trackEvent('Close Modal', { modal_name: modalName });
}

// Sharing Events
export function trackSharePlaylist(playlist, isPublic) {
    trackEvent('Share Playlist', {
        playlist_name: playlist?.name || 'Unknown',
        is_public: isPublic,
    });
}

// Audio Effects Events
export function trackChangePlaybackSpeed(speed) {
    trackEvent('Change Playback Speed', { speed });
}

export function trackToggleReplayGain(mode) {
    trackEvent('Toggle ReplayGain', { mode });
}

export function trackChangeEqualizer(preset) {
    trackEvent('Change Equalizer', { preset });
}

// Waveform Events
export function trackToggleWaveform(enabled) {
    trackEvent('Toggle Waveform', { enabled });
}

// Error Events
export function trackPlaybackError(errorType, track) {
    trackEvent('Playback Error', {
        error_type: errorType,
        track_title: track?.title || 'Unknown',
    });
}

export function trackSearchError(query) {
    trackEvent('Search Error', { query_length: query?.length || 0 });
}

export function trackApiError(endpoint) {
    trackEvent('API Error', { endpoint });
}

// Feature Discovery Events
export function trackViewFeature(feature) {
    trackEvent('View Feature', { feature });
}

export function trackUseFeature(feature) {
    trackEvent('Use Feature', { feature });
}

// Session Events
export function trackSessionStart() {
    trackEvent('Session Start', {
        user_agent: navigator.userAgent,
        screen_width: window.screen.width,
        screen_height: window.screen.height,
        language: navigator.language,
    });
}

export function trackSessionEnd(duration) {
    trackEvent('Session End', { duration });
}

// Initialize analytics on page load
export function initAnalytics() {
    if (!isAnalyticsEnabled()) return;

    // Track initial page view
    trackPageView(window.location.pathname);

    // Track session start
    trackSessionStart();

    // Track navigation changes
    let lastPath = window.location.pathname;
    setInterval(() => {
        const currentPath = window.location.pathname;
        if (currentPath !== lastPath) {
            trackPageView(currentPath);
            lastPath = currentPath;
        }
    }, 500);

    // Track online/offline status
    window.addEventListener('online', () => trackEvent('Go Online'));
    window.addEventListener('offline', () => trackEvent('Go Offline'));

    // Track visibility changes (app focus/blur)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            trackEvent('App Background');
        } else {
            trackEvent('App Foreground');
        }
    });
}
