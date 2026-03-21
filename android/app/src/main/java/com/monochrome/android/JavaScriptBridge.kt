package com.monochrome.android

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONObject

data class TrackMetadata(
    val title: String,
    val artist: String,
    val album: String,
    val artworkUrl: String,
)

data class PositionState(
    /** Duration in milliseconds */
    val durationMs: Long,
    /** Current position in milliseconds */
    val positionMs: Long,
    val playbackRate: Float,
)

/**
 * Exposed to the WebView as `window.AndroidBridge`.
 *
 * Each method is annotated with @JavascriptInterface so the WebView runtime
 * allows JS to call it. All callbacks are dispatched to the main thread so
 * listeners can safely update UI / MediaSession.
 *
 * The [Listener] is implemented by [MusicService].
 */
class JavaScriptBridge(private val listener: Listener) {

    interface Listener {
        fun onMetadataChanged(metadata: TrackMetadata)
        fun onPlaybackStateChanged(isPlaying: Boolean)
        fun onPositionStateChanged(state: PositionState)
        fun onBridgeReady()
        fun onOpenOAuthUrl(url: String)
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onMetadataChanged(json: String) {
        mainHandler.post {
            try {
                val obj = JSONObject(json)
                listener.onMetadataChanged(
                    TrackMetadata(
                        title = obj.optString("title"),
                        artist = obj.optString("artist"),
                        album = obj.optString("album"),
                        artworkUrl = obj.optString("artworkUrl"),
                    )
                )
            } catch (_: Exception) {
            }
        }
    }

    @JavascriptInterface
    fun onPlaybackStateChanged(state: String) {
        mainHandler.post { listener.onPlaybackStateChanged(state == "playing") }
    }

    @JavascriptInterface
    fun onPositionStateChanged(json: String) {
        mainHandler.post {
            try {
                val obj = JSONObject(json)
                listener.onPositionStateChanged(
                    PositionState(
                        durationMs = (obj.optDouble("duration", 0.0) * 1000).toLong(),
                        positionMs = (obj.optDouble("position", 0.0) * 1000).toLong(),
                        playbackRate = obj.optDouble("playbackRate", 1.0).toFloat(),
                    )
                )
            } catch (_: Exception) {
            }
        }
    }

    @JavascriptInterface
    fun onBridgeReady() {
        mainHandler.post { listener.onBridgeReady() }
    }

    @JavascriptInterface
    fun openOAuthUrl(url: String) {
        mainHandler.post { listener.onOpenOAuthUrl(url) }
    }
}
