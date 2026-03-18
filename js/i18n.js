// js/i18n.js
// Internationalization (i18n) module for Monochrome

const LOCALE_PATH = './locales';

const SUPPORTED_LANGUAGES = {
    en: 'English',
    id: 'Bahasa Indonesia',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    ja: '日本語',
    pt: 'Português',
    zh: '中文',
};

const STORAGE_KEY = 'monochrome-language';
const DEFAULT_LANGUAGE = 'en';

let currentTranslations = {};
let currentLanguage = DEFAULT_LANGUAGE;

/**
 * Get the stored language preference, falling back to browser language or English.
 */
function getStoredLanguage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && SUPPORTED_LANGUAGES[stored]) {
            return stored;
        }
        // Auto-detect from browser if not set
        const browserLang = navigator.language?.split('-')[0];
        if (browserLang && SUPPORTED_LANGUAGES[browserLang]) {
            return browserLang;
        }
    } catch {
        // ignore localStorage errors
    }
    return DEFAULT_LANGUAGE;
}

/**
 * Save the language preference.
 */
function setStoredLanguage(lang) {
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // ignore localStorage errors
    }
}

/**
 * Load translations for the given language code.
 * Falls back to English if the language file cannot be loaded.
 */
async function loadTranslations(lang) {
    try {
        const response = await fetch(`${LOCALE_PATH}/${lang}.json`);
        if (!response.ok) {
            throw new Error(`Failed to load locale: ${lang} (HTTP ${response.status})`);
        }
        return await response.json();
    } catch (err) {
        console.warn(`[i18n] Could not load language "${lang}":`, err);
        if (lang !== DEFAULT_LANGUAGE) {
            // Fall back to English
            try {
                const fallback = await fetch(`${LOCALE_PATH}/${DEFAULT_LANGUAGE}.json`);
                if (fallback.ok) {
                    return await fallback.json();
                }
            } catch {
                // ignore
            }
        }
        return {};
    }
}

/**
 * Translate a key using the current language translations.
 * Falls back to the key itself if no translation is found.
 */
export function t(key) {
    return currentTranslations[key] ?? key;
}

/**
 * Apply translations to all elements with [data-i18n] attributes.
 * The attribute value should be the translation key.
 * Optionally provide a root element to limit the scope.
 */
export function applyTranslations(root = document) {
    const elements = root.querySelectorAll('[data-i18n]');
    elements.forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const translation = t(key);
        if (translation !== key) {
            el.textContent = translation;
        }
    });

    // Also handle placeholder translations
    const placeholderEls = root.querySelectorAll('[data-i18n-placeholder]');
    placeholderEls.forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        const translation = t(key);
        if (translation !== key) {
            el.setAttribute('placeholder', translation);
        }
    });

    // Handle title/aria-label translations
    const titleEls = root.querySelectorAll('[data-i18n-title]');
    titleEls.forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;
        const translation = t(key);
        if (translation !== key) {
            el.setAttribute('title', translation);
        }
    });
}

/**
 * Get the current language code.
 */
export function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * Get all supported languages as an object { code: displayName }.
 */
export function getSupportedLanguages() {
    return { ...SUPPORTED_LANGUAGES };
}

/**
 * Switch to a different language and re-apply all translations.
 * @param {string} lang - Language code (e.g., 'en', 'id', 'es')
 */
export async function switchLanguage(lang) {
    if (!SUPPORTED_LANGUAGES[lang]) {
        console.warn(`[i18n] Unsupported language: "${lang}". Falling back to English.`);
        lang = DEFAULT_LANGUAGE;
    }

    currentLanguage = lang;
    setStoredLanguage(lang);
    currentTranslations = await loadTranslations(lang);
    applyTranslations();

    // Update the html lang attribute
    document.documentElement.setAttribute('lang', lang);

    // Dispatch a custom event so other modules can react to language changes
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
}

/**
 * Initialize the i18n system.
 * Loads the stored (or browser-detected) language and applies translations.
 */
export async function initI18n() {
    const lang = getStoredLanguage();
    currentLanguage = lang;
    currentTranslations = await loadTranslations(lang);
    applyTranslations();
    document.documentElement.setAttribute('lang', lang);
}
