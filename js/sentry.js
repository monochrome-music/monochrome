// js/sentry.js - Sentry error tracking and performance monitoring
import * as Sentry from '@sentry/browser';
import { analyticsSettings } from './storage.js';

export const SENTRY_DSN = 'http://33e55746a9904532835bee180d60d9b1@rustrak-api.edideaur.works/2';

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
    /AbortError/,
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
        .map((v) => (Array.isArray(v.stacktrace?.frames) ? v.stacktrace.frames.map((f) => f.filename || '').join('\n') : ''))
        .join('\n');
    return INJECTION_NOISE_PATTERNS.some((re) => re.test(`${message}\n${exceptionText}\n${stackText}`));
}

/**
 * Initialize Sentry SDK
 */
export function initSentry() {
    if (!analyticsSettings.isEnabled()) {
        return;
    }

    Sentry.init({
        dsn: SENTRY_DSN,
        release: '5.0.0',
        integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
        // The Turnstile SDK throws this internally (uncaught, from its own async
        // cleanup) after a widget has already been removed. It is harmless and
        // outside our control, so drop it instead of flooding the error tracker.
        ignoreErrors: ['Nothing to reset found for provided container'],
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

export { Sentry };
