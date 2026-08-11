// js/sentry.js - Sentry error tracking and performance monitoring
import * as Sentry from '@sentry/browser';
import { analyticsSettings } from './storage.js';

export const SENTRY_DSN = 'http://33e55746a9904532835bee180d60d9b1@rustrak-api.edideaur.works/2';

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
