/**
 * android_bridge.js
 *
 * Injected into the WebView via WebViewCompat.addDocumentStartJavaScript(),
 * which guarantees execution BEFORE any page scripts — including player.js.
 *
 * Responsibilities:
 *   1. Wrap navigator.mediaSession.setActionHandler() to capture each handler
 *      in a local map so Kotlin can invoke them on Android Auto commands.
 *   2. Intercept the navigator.mediaSession.metadata setter to push track info
 *      to the native MediaSession via AndroidBridge.onMetadataChanged().
 *   3. Intercept the playbackState setter and setPositionState() similarly.
 *   4. Expose window.androidTriggerMediaAction(action, detailsJson) for Kotlin
 *      to call when Android Auto sends a transport command.
 *
 * The `AndroidBridge` global is injected by Kotlin via
 * WebView.addJavascriptInterface(JavaScriptBridge(), "AndroidBridge").
 */
(function () {
    'use strict';

    if (!('mediaSession' in navigator)) {
        console.warn('[AndroidBridge] navigator.mediaSession not available — skipping bridge install');
        return;
    }

    const session = navigator.mediaSession;
    const _handlers = {};

    // ── 1. Capture action handlers ──────────────────────────────────────────

    const origSetActionHandler = session.setActionHandler.bind(session);
    session.setActionHandler = function (action, handler) {
        _handlers[action] = handler;
        origSetActionHandler(action, handler);
    };

    // ── 2. Intercept metadata setter ────────────────────────────────────────

    const sessionProto = Object.getPrototypeOf(session);

    const metaDesc =
        Object.getOwnPropertyDescriptor(sessionProto, 'metadata') ||
        Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata');

    if (metaDesc && metaDesc.set) {
        Object.defineProperty(sessionProto, 'metadata', {
            set(val) {
                metaDesc.set.call(this, val);
                if (val && window.AndroidBridge) {
                    try {
                        AndroidBridge.onMetadataChanged(
                            JSON.stringify({
                                title: val.title || '',
                                artist: val.artist || '',
                                album: val.album || '',
                                artworkUrl:
                                    val.artwork && val.artwork.length > 0
                                        ? val.artwork[0].src
                                        : '',
                            })
                        );
                    } catch (e) {
                        console.error('[AndroidBridge] onMetadataChanged failed:', e);
                    }
                }
            },
            get() {
                return metaDesc.get.call(this);
            },
            configurable: true,
        });
    }

    // ── 3. Intercept playbackState setter ───────────────────────────────────

    const stateDesc =
        Object.getOwnPropertyDescriptor(sessionProto, 'playbackState') ||
        Object.getOwnPropertyDescriptor(MediaSession.prototype, 'playbackState');

    if (stateDesc && stateDesc.set) {
        Object.defineProperty(sessionProto, 'playbackState', {
            set(val) {
                stateDesc.set.call(this, val);
                if (window.AndroidBridge) {
                    try {
                        AndroidBridge.onPlaybackStateChanged(val);
                    } catch (e) {
                        console.error('[AndroidBridge] onPlaybackStateChanged failed:', e);
                    }
                }
            },
            get() {
                return stateDesc.get.call(this);
            },
            configurable: true,
        });
    }

    // ── 4. Intercept setPositionState ────────────────────────────────────────

    const origSetPositionState = session.setPositionState
        ? session.setPositionState.bind(session)
        : null;

    if (origSetPositionState) {
        session.setPositionState = function (state) {
            origSetPositionState(state);
            if (window.AndroidBridge) {
                try {
                    AndroidBridge.onPositionStateChanged(
                        JSON.stringify({
                            duration: state.duration || 0,
                            position: state.position || 0,
                            playbackRate: state.playbackRate || 1,
                        })
                    );
                } catch (e) {
                    console.error('[AndroidBridge] onPositionStateChanged failed:', e);
                }
            }
        };
    }

    // ── 5. Entry point for Kotlin to fire action handlers ───────────────────
    //
    // Called from MusicService via:
    //   webView.evaluateJavascript("androidTriggerMediaAction('play', null)", null)
    //
    window.androidTriggerMediaAction = function (action, detailsJson) {
        const handler = _handlers[action];
        if (!handler) {
            console.warn('[AndroidBridge] No handler registered for action:', action);
            return;
        }
        try {
            const details = detailsJson ? JSON.parse(detailsJson) : {};
            handler(details);
        } catch (e) {
            console.error('[AndroidBridge] Error triggering action', action, e);
        }
    };

    // Notify Kotlin the bridge is wired up (useful for debugging)
    document.addEventListener('DOMContentLoaded', function () {
        if (window.AndroidBridge) {
            AndroidBridge.onBridgeReady();
        }
    });

    console.log('[AndroidBridge] Media session bridge installed');
})();
