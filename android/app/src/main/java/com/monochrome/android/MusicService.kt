package com.monochrome.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import androidx.media.MediaBrowserServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.lang.ref.WeakReference

/**
 * MediaBrowserServiceCompat — the heart of the Android Auto integration.
 *
 * Responsibilities:
 *  - Own the [MediaSessionCompat] whose token Android Auto uses.
 *  - Route Auto's transport commands (play/pause/next/…) to the PWA via
 *    [WebView.evaluateJavascript] → `window.androidTriggerMediaAction(...)`.
 *  - Receive metadata / playback-state updates from [JavaScriptBridge] and
 *    mirror them into the native MediaSession so Auto's UI stays in sync.
 *  - Expose a simple [onLoadChildren] browse tree via [BrowseTreeProvider].
 *  - Post a media-style foreground notification while playback is active.
 *
 * The [WebView] lives in [MainActivity]. [MainActivity] binds to this service
 * via [LocalBinder] and calls [attachWebView] / [detachWebView].
 */
class MusicService : MediaBrowserServiceCompat(), JavaScriptBridge.Listener {

    // ── Binder for MainActivity ──────────────────────────────────────────────

    inner class LocalBinder : Binder() {
        fun getService(): MusicService = this@MusicService
    }

    private val localBinder = LocalBinder()

    // ── Core state ───────────────────────────────────────────────────────────

    private lateinit var mediaSession: MediaSessionCompat
    private val browseTree = BrowseTreeProvider()
    private val serviceScope = CoroutineScope(Dispatchers.Main + Job())
    private val mainHandler = Handler(Looper.getMainLooper())
    private val httpClient by lazy { OkHttpClient() }

    private var webViewRef: WeakReference<WebView>? = null
    private var isPlaying = false
    private var currentPositionMs = 0L
    private var currentDurationMs = 0L
    private var currentPlaybackRate = 1f

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        setupMediaSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Let MediaButtonReceiver handle headset / Bluetooth button intents.
        MediaButtonReceiver.handleIntent(mediaSession, intent)
        return START_STICKY
    }

    override fun onDestroy() {
        mediaSession.release()
        serviceScope.launch { }.cancel() // cancel all pending artwork loads
        super.onDestroy()
    }

    // ── Binder ───────────────────────────────────────────────────────────────

    override fun onBind(intent: Intent): IBinder =
        if (SERVICE_INTERFACE == intent.action) super.onBind(intent)!!
        else localBinder

    // ── WebView attachment (called by MainActivity) ──────────────────────────

    fun attachWebView(webView: WebView) {
        webViewRef = WeakReference(webView)
    }

    fun detachWebView() {
        webViewRef = null
    }

    // ── MediaSession setup ───────────────────────────────────────────────────

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, TAG).apply {
            setCallback(mediaSessionCallback)
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            isActive = true
        }
        // Required: hand the token to MediaBrowserServiceCompat so Auto can find it.
        sessionToken = mediaSession.sessionToken

        // Set an initial idle playback state so the session is recognised immediately.
        mediaSession.setPlaybackState(idlePlaybackState())
    }

    // ── MediaSession.Callback — routes Auto commands → WebView JS ───────────

    private val mediaSessionCallback = object : MediaSessionCompat.Callback() {

        override fun onPlay() = triggerJs("play")
        override fun onPause() = triggerJs("pause")
        override fun onStop() = triggerJs("stop")
        override fun onSkipToNext() = triggerJs("nexttrack")
        override fun onSkipToPrevious() = triggerJs("previoustrack")

        override fun onSeekTo(posMs: Long) {
            // seekTime in the Web MediaSession API is in seconds
            triggerJs("seekto", """{"seekTime":${posMs / 1000.0}}""")
        }

        override fun onFastForward() = triggerJs("seekforward", """{"seekOffset":10}""")
        override fun onRewind() = triggerJs("seekbackward", """{"seekOffset":10}""")

        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            // TODO: Translate mediaId → JS call to load the specific track.
            // e.g. webView.evaluateJavascript("player.playById('$mediaId')", null)
        }
    }

    /**
     * Calls `window.androidTriggerMediaAction(action, detailsJson)` in the WebView.
     * This invokes the handler that player.js registered via
     * navigator.mediaSession.setActionHandler().
     */
    private fun triggerJs(action: String, detailsJson: String? = null) {
        val js = buildString {
            append("window.androidTriggerMediaAction('")
            append(action)
            append("', ")
            if (detailsJson != null) append("'$detailsJson'") else append("null")
            append(")")
        }
        mainHandler.post { webViewRef?.get()?.evaluateJavascript(js, null) }
    }

    // ── JavaScriptBridge.Listener — receives state from the PWA ─────────────

    override fun onBridgeReady() {
        // Bridge installed successfully; nothing special needed yet.
    }

    override fun onPlaybackStateChanged(isPlaying: Boolean) {
        this.isPlaying = isPlaying
        val state = PlaybackStateCompat.Builder()
            .setActions(ALL_TRANSPORT_ACTIONS)
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING
                else PlaybackStateCompat.STATE_PAUSED,
                currentPositionMs,
                currentPlaybackRate,
            )
            .build()
        mediaSession.setPlaybackState(state)
        if (isPlaying) {
            startForeground(NOTIFICATION_ID, buildNotification())
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(false)
            }
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
        }
    }

    override fun onPositionStateChanged(state: PositionState) {
        currentDurationMs = state.durationMs
        currentPositionMs = state.positionMs
        currentPlaybackRate = state.playbackRate

        val playbackState = PlaybackStateCompat.Builder()
            .setActions(ALL_TRANSPORT_ACTIONS)
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING
                else PlaybackStateCompat.STATE_PAUSED,
                currentPositionMs,
                currentPlaybackRate,
            )
            .build()
        mediaSession.setPlaybackState(playbackState)
    }

    override fun onMetadataChanged(metadata: TrackMetadata) {
        // Build metadata without artwork first so the session updates quickly.
        val builder = baseMetadataBuilder(metadata)
        if (currentDurationMs > 0) {
            builder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
        }
        mediaSession.setMetadata(builder.build())
        updateNotification()

        // Load artwork asynchronously then update again.
        if (metadata.artworkUrl.isNotEmpty()) {
            serviceScope.launch {
                val bitmap = withContext(Dispatchers.IO) { fetchBitmap(metadata.artworkUrl) }
                if (bitmap != null) {
                    val withArt = baseMetadataBuilder(metadata)
                        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap)
                        .also {
                            if (currentDurationMs > 0)
                                it.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
                        }
                        .build()
                    mediaSession.setMetadata(withArt)
                    updateNotification()
                }
            }
        }
    }

    private fun baseMetadataBuilder(meta: TrackMetadata): MediaMetadataCompat.Builder =
        MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, meta.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, meta.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, meta.album)

    private fun fetchBitmap(url: String): Bitmap? = runCatching {
        val request = Request.Builder().url(url).build()
        httpClient.newCall(request).execute().use { response ->
            response.body?.bytes()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
        }
    }.getOrNull()

    // ── MediaBrowserServiceCompat — browse tree for Auto ────────────────────

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?,
    ): BrowserRoot = BrowserRoot(BrowseTreeProvider.ROOT_ID, null)

    override fun onLoadChildren(
        parentId: String,
        result: Result<MutableList<MediaBrowserCompat.MediaItem>>,
    ) {
        result.sendResult(browseTree.getChildren(parentId).toMutableList())
    }

    // ── Notification ─────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.notification_channel_description)
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val description = mediaSession.controller.metadata?.description

        val activityIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val prevIntent = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        )
        val playPauseIntent = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_PLAY_PAUSE
        )
        val nextIntent = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(description?.title ?: getString(R.string.app_name))
            .setContentText(description?.subtitle ?: "")
            .setSubText(description?.description ?: "")
            .setLargeIcon(mediaSession.controller.metadata
                ?.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART))
            .setContentIntent(activityIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .addAction(R.drawable.ic_skip_previous, getString(R.string.action_previous), prevIntent)
            .addAction(
                if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play,
                if (isPlaying) getString(R.string.action_pause) else getString(R.string.action_play),
                playPauseIntent,
            )
            .addAction(R.drawable.ic_skip_next, getString(R.string.action_next), nextIntent)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
                    .setShowCancelButton(true)
                    .setCancelButtonIntent(
                        MediaButtonReceiver.buildMediaButtonPendingIntent(
                            this, PlaybackStateCompat.ACTION_STOP
                        )
                    )
            )
            .build()
    }

    private fun updateNotification() {
        runCatching {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification())
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun idlePlaybackState(): PlaybackStateCompat =
        PlaybackStateCompat.Builder()
            .setActions(ALL_TRANSPORT_ACTIONS)
            .setState(PlaybackStateCompat.STATE_NONE, 0L, 1f)
            .build()

    companion object {
        private const val TAG = "MonochromeAuto"
        private const val NOTIFICATION_CHANNEL_ID = "monochrome_playback"
        private const val NOTIFICATION_ID = 1

        private const val ALL_TRANSPORT_ACTIONS =
            PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_FAST_FORWARD or
                PlaybackStateCompat.ACTION_REWIND or
                PlaybackStateCompat.ACTION_STOP
    }
}
