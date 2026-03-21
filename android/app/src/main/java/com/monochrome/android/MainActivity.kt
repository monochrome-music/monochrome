package com.monochrome.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

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

        // Handle OAuth redirect if app was launched via deep link
        handleOAuthIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleOAuthIntent(intent)
    }

    private fun handleOAuthIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "monochrome" && data.host == "oauth") {
            val userId = data.getQueryParameter("userId")
            val secret = data.getQueryParameter("secret")
            if (!userId.isNullOrEmpty() && !secret.isNullOrEmpty()) {
                // Redirect back into the PWA with the OAuth credentials
                val redirectUrl = "$PWA_URL/index.html?userId=$userId&secret=$secret"
                webView.loadUrl(redirectUrl)
            }
        }
    }

    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(true)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        val jsBridge = JavaScriptBridge(createBridgeListener())
        webView.addJavascriptInterface(jsBridge, "AndroidBridge")

        injectBridgeScript()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url
                val host = url.host ?: return false

                // Intercept Appwrite OAuth initiation — open in Chrome Custom Tab
                // Google blocks OAuth in WebViews, so we hand off to Chrome
                if (host.contains("auth.samidy.com") &&
                    url.path?.contains("/v1/account/sessions/oauth2/") == true
                ) {
                    CustomTabsIntent.Builder()
                        .setShowTitle(false)
                        .build()
                        .launchUrl(this@MainActivity, url)
                    return true
                }

                // Keep same-origin navigation inside WebView
                val pwaHost = Uri.parse(PWA_URL).host
                return host != pwaHost
            }
        }

        webView.webChromeClient = WebChromeClient()
        webView.loadUrl(PWA_URL)
    }

    private fun injectBridgeScript() {
        val script = assets.open("android_bridge.js").bufferedReader().use { it.readText() }
        val pwaOrigin = Uri.parse(PWA_URL).run { "$scheme://$host" }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(pwaOrigin))
        } else {
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
        override fun onOpenOAuthUrl(url: String) {
            CustomTabsIntent.Builder()
                .setShowTitle(false)
                .build()
                .launchUrl(this@MainActivity, Uri.parse(url))
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
        const val PWA_URL = "https://monochrome.tf"
    }
}
