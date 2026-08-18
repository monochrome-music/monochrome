// js/sentry.js - Sentry error tracking and performance monitoring
import * as Sentry from '@sentry/browser';
import { analyticsSettings } from './storage.js';

export const SENTRY_DSN = 'https://33e55746a9904532835bee180d60d9b1@rustrak-api.edideaur.works/2';

// Bump this on every release so Rustrak groups errors per deploy.
const RELEASE = '5.0.5';

/**
 * Errors raised by scripts injected into users' browsers by malicious
 * extensions/adware. They are not Monochrome code and cannot be fixed here, so
 * drop them before they reach the error tracker.
 */
const INJECTION_NOISE_PATTERNS = [
    /\.wasm\.wasm/,
    /opiumbest|opium\.best|unpkg\.com\/opium/,
    /scramjet/,
    /unreachable: e\.data !== MessagePort|MessagePort/,
    /dead object/,
    /registerSW is not defined|Can't find variable: registerSW/,
    /attachShadow|observeAttachShadow|Permission denied to access property "Element"/,
    /The operation is insecure/,
    /className\.includes is not a function/,
    /CreateListFromArrayLike/,
    /window\.__TAURI__|reading 'core'/,
    /Unexpected (token|identifier|end of input)|Invalid or unexpected token|'h' has already been declared/,
    /authManager\.updateUI is not a function/,
    /getTrackStreamUrl|UIRenderer is not defined|NowPlayingBar is not defined/,
    /document is not defined/,
    /onLongParse/,
    /canvas-lms|instructure|degloved|hotelconsuladoinn|jtlanguage|if-it-runs-ship-it\.lol|hpsschools|gas\.education|myonlineportal|chanka\.com|ayresinn|nanobit/,
    /\/classes\/math\//,
    /undefined is not an object|Navigator\.prototype/,
    /n\.target\.matches is not a function|^l is not a function$|reading 'M_ID'/,
    /Failed to start the audio device|The operation is not supported\./,
    /AbortError|TimeoutError|signal is aborted without reason|signal timed out|Fetch is aborted|The operation was aborted\./,
    /DecompressionStream is not defined/,
    /Can't find variable: [a-z]$/,
    /\.entries\.at is not a function/,
    /can't redefine non-configurable property "userAgent"|Cannot redefine property: userAgent/,
    /Can't find variable: __firefox__/,
    /Maximum call stack size exceeded\./,
    /NS_ERROR_FAILURE: No error message/,
    /Invalid call to runtime\.sendMessage\(\)\. Tab not found/,
    /Can't find variable: indexedDB/,
    /doesn't provide an export named/,
    /TransactionInactiveError/,
];

function isForeignOrigin(filename) {
    if (!filename) return false;
    if (filename.startsWith('/') || filename.startsWith('blob:') || filename.startsWith('data:')) return false;
    try {
        const origin = new URL(filename).origin;
        return !(origin === location.origin || origin.endsWith('.edideaur.works') || origin.includes('localhost'));
    } catch {
        return false;
    }
}

function isInjectionNoise(event) {
    const message = event.message || '';
    const values = event.exception?.values || [];
    const exceptionText = values.map((v) => v.value || '').join('\n');

    // The throwing frame is on a foreign origin (attacker CDN / S3 bucket /
    // injected script host) -> this error was raised by injected code, not by
    // our bundle. Our own errors always have frames on our own origin.
    for (const v of values) {
        const frames = v.stacktrace?.frames;
        if (Array.isArray(frames) && frames.length > 0) {
            if (isForeignOrigin(frames[0].filename)) {
                return true;
            }
        }
    }

    const stackText = values
        .map((v) =>
            Array.isArray(v.stacktrace?.frames) ? v.stacktrace.frames.map((f) => f.filename || '').join('\n') : ''
        )
        .join('\n');
    return INJECTION_NOISE_PATTERNS.some((re) => re.test(`${message}\n${exceptionText}\n${stackText}`));
}

/**
 * Errors that are either environmental (storage/quota/network), outside our
 * control (third-party backends, WebView bridges), handled-and-surfaced to the
 * user, or self-healing (stale hashed chunks after a deploy). None of them
 * represent a code defect worth paging someone, so drop them before upload.
 */
const IGNORE_ERRORS = [
    'Nothing to reset found for provided container',
    /\[Cloudflare Turnstile\] Error: \d+/,
    /TurnstileError:.*Turnstile/,
    // Environmental: browser storage/quota/filesystem failures.
    /QuotaExceededError/,
    /Access is denied for this document/,
    /Encountered full disk while opening backing store/,
    /NoModificationAllowedError/,
    /NotFoundError: A requested file or directory could not be found/,
    /UnknownError: (Unable to open database|Unable to establish IDB|Database deleted by request|Connection to Indexed Database|Internal error|Attempt to get)/,
    /NotFoundError: Failed to execute 'transaction' on 'IDBDatabase'/,
    /InvalidStateError: A mutation operation was attempted on a database that did not allow mutations/,
    /Out of memory/,
    /SecurityError: Failed to read the 'localStorage' property from 'Window'/,
    // Expected when a track has no resolvable stream (Unified Playback and
    // Deezer both fail). This is handled and surfaced to the user as a
    // friendly notification, not a code defect, so don't track it.
    /Could not resolve (audio stream|stream URL) from Unified Playback or Deezer/,
    /Cannot resolve audio stream: Unified Playback failed and track has no ISRC/,
    /Could not resolve stream URL: Unified Playback failed and the track has no ISRC/,
    // Expected when an Atmos download is unavailable with strict quality enabled.
    /tier is unavailable\. Atmos downloads are strict, so no stereo fallback was used/,
    // Transient chunk load failures (network blips or a stale service worker
    // referencing old hashed assets). Self-heal on reload; not actionable.
    /Failed to fetch dynamically imported module/,
    /error loading dynamically imported module/,
    /^Importing a module script failed\.$/,
    /'text\/html' is not a valid JavaScript MIME type/,
    // User-initiated cancellation / navigation aborts.
    /AbortError|TimeoutError|signal is aborted without reason|signal timed out|Fetch is aborted|The operation was aborted\./,
    // Third-party lyrics backends (user-configured) failing to respond.
    /Failed to fetch \(lyrics/i,
    /lyricsplus|lyrics-api\.binimum|lyrics-storage\.binimum|unison\.boidu\.dev/,
    // Third-party CDN/proxy fetch failures outside our control.
    /Failed to fetch \((resources\.tidal\.com|dzr\.|tabs-vs-spaces\.wtf|canine\.tools|trends\.artistgrid\.cx|tidal-proxy\.monochrome\.tf|panora-api|aoty\.|127\.0\.0\.1)/i,
    /^Failed to fetch\([^)]*\)$/,
    /^TypeError: Failed to fetch$/,
    /^TypeError: Load failed$/,
    /NetworkError when attempting to fetch resource/,
    // Android WebView / iOS WKWebView native-bridge failures (outside our JS).
    /Error invoking \w+: Java/,
    /Error invoking postMessage:/,
    /Java exception was raised during method invocation/,
    /sendDataToNative/,
    /Window message "chrome: call method" timed out/,
    /WKWebView API client did not respond to this postMessage/,
    // Click handler fired on a non-element target (rare DOM edge case).
    /\.target\.closest is not a function/,
    // Stale browser-extension contexts calling chrome.runtime.sendMessage.
    /Invalid call to runtime\.sendMessage\(\)\. Tab not found/,
    // Browser cannot play the assigned media source (codec/format unsupported).
    /The element has no supported sources/,
    /The media resource indicated by the src attribute or assigned media provider object was not suitable/,
    /AudioParam\.value setter/,
    // Firefox-specific oddities / old engines.
    /Can't find variable: __firefox__/,
    /NS_ERROR_FAILURE/,
    /DecompressionStream is not defined/,
    // Extension-induced DOM/instrumentation breakage.
    /Maximum call stack size exceeded\./,
    /can't redefine non-configurable property "userAgent"|Cannot redefine property: userAgent/,
    /Log Message: uncaught exception: undefined/,
    /Non-Error promise rejection captured with value: undefined/,
    /Can't find variable: indexedDB/,
    /doesn't provide an export named/,
    /TransactionInactiveError/,
    /InvalidStateError: A mutation operation was attempted/,
];

/**
 * Initialize Sentry SDK
 */
export function initSentry() {
    if (!analyticsSettings.isEnabled()) {
        return;
    }

    Sentry.init({
        dsn: SENTRY_DSN,
        release: RELEASE,
        integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
        ignoreErrors: IGNORE_ERRORS,
        beforeSend(event) {
            if (isInjectionNoise(event)) {
                return null;
            }
            return event;
        },
        // Performance Monitoring
        tracesSampleRate: 1.0,
        tracePropagationTargets: ['localhost', /^https:\/\/.*\.edideaur\.works/],
        // Session Replay
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
    });
}

// Auto-initialize Sentry on load
initSentry();
