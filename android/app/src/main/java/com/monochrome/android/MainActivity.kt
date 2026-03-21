package com.monochrome.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Hosts the full-screen WebView that loads the Monochrome PWA.
 *
 * On startup it:
 *  1. Configures the WebView (JS, DOM storage, autoplay, etc.)
 *  2. Adds [JavaScriptBridge] as `window.AndroidBridge` so the PWA can send
 *     playback state updates to the native [MediaSession].
 *  3. Injects [android_bridge.js] via [WebViewCompat.addDocumentStartJavaScript]
 *     so the interceptors are in place before player.js runs.
 *  4. Starts + binds to [MusicService] and hands it the [WebView] so the
 *     service can call JS action handlers on Android Auto commands.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var musicService: MusicService? = null
    private var serviceBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val service = (binder as MusicService.LocalBinder).getService()
            musicService = service
            service.attachWebView(webView)
            serviceBound = true
        }

        override fun onServiceDisconnected(name: ComponentName) {
            musicService?.detachWebView()
            musicService = null
            serviceBound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        setupWebView()

        val serviceIntent = Intent(this, MusicService::class.java)
        startService(serviceIntent)
        bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(true) // remove for production

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false        // no local file access needed
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        // Register the Java bridge object BEFORE loading any URL.
        // android_bridge.js references `window.AndroidBridge` — this is it.
        val jsBridge = JavaScriptBridge(createBridgeListener())
        webView.addJavascriptInterface(jsBridge, "AndroidBridge")

        // Inject android_bridge.js before any page scripts so our
        // setActionHandler wrapper is in place before player.js runs.
        injectBridgeScript()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // Keep navigation within the WebView for same-origin URLs.
                val pwaHost = android.net.Uri.parse(PWA_URL).host
                return request.url.host != pwaHost
            }
        }

        webView.webChromeClient = WebChromeClient()

        webView.loadUrl(PWA_URL)
    }

    private fun injectBridgeScript() {
        val script = assets.open("android_bridge.js").bufferedReader().use { it.readText() }
        val pwaOrigin = android.net.Uri.parse(PWA_URL).run { "$scheme://$host" }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Guaranteed to run before any page script — the preferred path.
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(pwaOrigin))
        } else {
            // Fallback: inject after page start. By this point player.js may
            // have already registered handlers; the bridge will still capture
            // future setActionHandler calls and metadata updates.
            webView.webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    view.evaluateJavascript(script, null)
                }
            }
        }
    }

    private fun createBridgeListener() = object : JavaScriptBridge.Listener {
        override fun onMetadataChanged(metadata: TrackMetadata) {
            musicService?.onMetadataChanged(metadata)
        }
        override fun onPlaybackStateChanged(isPlaying: Boolean) {
            musicService?.onPlaybackStateChanged(isPlaying)
        }
        override fun onPositionStateChanged(state: PositionState) {
            musicService?.onPositionStateChanged(state)
        }
        override fun onBridgeReady() {
            musicService?.onBridgeReady()
        }
    }

    override fun onDestroy() {
        if (serviceBound) {
            musicService?.detachWebView()
            unbindService(serviceConnection)
            serviceBound = false
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in API 33; kept for minSdk 23 compat")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else @Suppress("DEPRECATION") super.onBackPressed()
    }

    companion object {
        /**
         * Replace with the URL of your self-hosted Monochrome instance.
         * Also update the matching string in res/values/strings.xml.
         */
        const val PWA_URL = "https://monochrome.tf"
    }
}
