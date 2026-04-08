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

// Initialize analytics on page load
export function initAnalytics() {
    if (!isAnalyticsEnabled()) return;

    // Track initial page view
    trackPageView(window.location.pathname);
}
