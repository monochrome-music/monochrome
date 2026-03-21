// js/i18n.js
// Internationalization (i18n) module for Monochrome

const LOCALE_PATH = './locales';

const SUPPORTED_LANGUAGES = {
    en: 'English',
    id: 'Bahasa Indonesia',
    ja: '日本語',
    ko: '한국어',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    pt: 'Português',
    ru: 'Русский',
    ar: 'العربية',
    hi: 'हिन्दी',
    th: 'ไทย',
    vi: 'Tiếng Việt',
    ms: 'Bahasa Melayu',
    tr: 'Türkçe',
    it: 'Italiano',
    nl: 'Nederlands',
    pl: 'Polski',
    sv: 'Svenska',
    fil: 'Filipino',
    bn: 'বাংলা',
    ur: 'اردو',
    fa: 'فارسی',
};

const COMMON_PHRASES_EN = {
    Home: 'Home',
    Library: 'Library',
    Recent: 'Recent',
    Unreleased: 'Unreleased',
    Donate: 'Donate',
    Settings: 'Settings',
    About: 'About',
    Discord: 'Discord',
    Pinned: 'Pinned',
    Appearance: 'Appearance',
    Interface: 'Interface',
    Scrobbling: 'Scrobbling',
    Audio: 'Audio',
    Downloads: 'Downloads',
    Instances: 'Instances',
    System: 'System',
    'Search settings...': 'Search settings...',
    'Streaming Quality': 'Streaming Quality',
    'Quality for streaming playback': 'Quality for streaming playback',
    'App Language': 'App Language',
    'Display language for the app interface': 'Display language for the app interface',
    'Hi-Res FLAC (24-bit)': 'Hi-Res FLAC (24-bit)',
    'FLAC (Lossless)': 'FLAC (Lossless)',
    'AAC 320kbps': 'AAC 320kbps',
    'AAC 96kbps': 'AAC 96kbps',
    'Create Profile': 'Create Profile',
    'My Profile': 'My Profile',
    'Sign Out': 'Sign Out',
    'Connect with Google': 'Connect with Google',
    'Connect with Email': 'Connect with Email',
    'Edit Profile': 'Edit Profile',
    Username: 'Username',
    'Display Name': 'Display Name',
    'Avatar URL': 'Avatar URL',
    'Banner URL': 'Banner URL',
    'About Me': 'About Me',
    Website: 'Website',
    'Last.fm Username': 'Last.fm Username',
    'Save Profile': 'Save Profile',
    Cancel: 'Cancel',
    Upload: 'Upload',
    'or URL': 'or URL',
};

const LANGUAGE_OVERRIDES = {
    id: {
        Home: 'Beranda',
        Library: 'Perpustakaan',
        Recent: 'Terbaru',
        Settings: 'Pengaturan',
        Appearance: 'Tampilan',
        Interface: 'Antarmuka',
        Scrobbling: 'Scrobbling',
        Audio: 'Audio',
        Downloads: 'Unduhan',
        System: 'Sistem',
        'App Language': 'Bahasa Aplikasi',
        'Streaming Quality': 'Kualitas Streaming',
        'Create Profile': 'Buat Profil',
        'My Profile': 'Profil Saya',
        'Sign Out': 'Keluar',
        'Connect with Google': 'Hubungkan dengan Google',
        'Connect with Email': 'Hubungkan dengan Email',
        'Edit Profile': 'Edit Profil',
        Username: 'Nama pengguna',
        'Display Name': 'Nama tampilan',
        'Save Profile': 'Simpan Profil',
    },
    ja: { Home: 'ホーム', Library: 'ライブラリ', Recent: '最近', Settings: '設定', 'App Language': '表示言語' },
    ko: { Home: '홈', Library: '라이브러리', Recent: '최근', Settings: '설정', 'App Language': '앱 언어' },
    'zh-CN': { Home: '首页', Library: '资料库', Recent: '最近', Settings: '设置', 'App Language': '界面语言' },
    'zh-TW': { Home: '首頁', Library: '資料庫', Recent: '最近', Settings: '設定', 'App Language': '介面語言' },
    es: { Home: 'Inicio', Library: 'Biblioteca', Recent: 'Reciente', Settings: 'Ajustes', 'App Language': 'Idioma de la app' },
    fr: { Home: 'Accueil', Library: 'Bibliothèque', Recent: 'Récent', Settings: 'Paramètres', 'App Language': "Langue de l'application" },
    de: { Home: 'Start', Library: 'Bibliothek', Recent: 'Zuletzt', Settings: 'Einstellungen', 'App Language': 'App-Sprache' },
    pt: { Home: 'Início', Library: 'Biblioteca', Recent: 'Recentes', Settings: 'Configurações', 'App Language': 'Idioma do app' },
    ru: { Home: 'Главная', Library: 'Библиотека', Recent: 'Недавнее', Settings: 'Настройки', 'App Language': 'Язык приложения' },
    ar: { Home: 'الرئيسية', Library: 'المكتبة', Recent: 'الأخيرة', Settings: 'الإعدادات', 'App Language': 'لغة التطبيق' },
    hi: { Home: 'होम', Library: 'लाइब्रेरी', Recent: 'हाल ही में', Settings: 'सेटिंग्स', 'App Language': 'ऐप भाषा' },
    th: { Home: 'หน้าแรก', Library: 'คลังเพลง', Recent: 'ล่าสุด', Settings: 'การตั้งค่า', 'App Language': 'ภาษาแอป' },
    vi: { Home: 'Trang chủ', Library: 'Thư viện', Recent: 'Gần đây', Settings: 'Cài đặt', 'App Language': 'Ngôn ngữ ứng dụng' },
    ms: { Home: 'Laman Utama', Library: 'Perpustakaan', Recent: 'Terkini', Settings: 'Tetapan', 'App Language': 'Bahasa Aplikasi' },
    tr: { Home: 'Ana Sayfa', Library: 'Kütüphane', Recent: 'Son', Settings: 'Ayarlar', 'App Language': 'Uygulama Dili' },
    it: { Home: 'Home', Library: 'Libreria', Recent: 'Recenti', Settings: 'Impostazioni', 'App Language': 'Lingua app' },
    nl: { Home: 'Home', Library: 'Bibliotheek', Recent: 'Recent', Settings: 'Instellingen', 'App Language': 'App-taal' },
    pl: { Home: 'Strona główna', Library: 'Biblioteka', Recent: 'Ostatnie', Settings: 'Ustawienia', 'App Language': 'Język aplikacji' },
    sv: { Home: 'Hem', Library: 'Bibliotek', Recent: 'Senaste', Settings: 'Inställningar', 'App Language': 'Appspråk' },
    fil: { Home: 'Home', Library: 'Library', Recent: 'Kamakailan', Settings: 'Mga Setting', 'App Language': 'Wika ng app' },
    bn: { Home: 'হোম', Library: 'লাইব্রেরি', Recent: 'সাম্প্রতিক', Settings: 'সেটিংস', 'App Language': 'অ্যাপ ভাষা' },
    ur: { Home: 'ہوم', Library: 'لائبریری', Recent: 'حالیہ', Settings: 'ترتیبات', 'App Language': 'ایپ زبان' },
    fa: { Home: 'خانه', Library: 'کتابخانه', Recent: 'اخیر', Settings: 'تنظیمات', 'App Language': 'زبان برنامه' },
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
        const browserLangFull = navigator.language || '';
        if (SUPPORTED_LANGUAGES[browserLangFull]) {
            return browserLangFull;
        }
        const browserLang = browserLangFull.split('-')[0];
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
    const builtInPhrases = {
        ...COMMON_PHRASES_EN,
        ...(LANGUAGE_OVERRIDES[lang] || {}),
    };
    try {
        const response = await fetch(`${LOCALE_PATH}/${lang}.json`);
        if (!response.ok) {
            throw new Error(`Failed to load locale: ${lang} (HTTP ${response.status})`);
        }
        const loaded = await response.json();
        return { ...loaded, ...builtInPhrases };
    } catch (err) {
        console.warn(`[i18n] Could not load language "${lang}":`, err);
        return builtInPhrases;
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

    applyPhraseTranslations(root);
}

function applyPhraseTranslations(root = document) {
    const phraseMap = {
        ...COMMON_PHRASES_EN,
        ...(LANGUAGE_OVERRIDES[currentLanguage] || {}),
    };

    const scopedSelectors = [
        '.sidebar-nav .nav-item span',
        '.settings-tab',
        '#page-settings .section-title',
        '#page-settings .label',
        '#page-settings .description',
        '#page-settings button',
        '#page-settings option',
        '#header-account-dropdown button',
        '#edit-profile-modal h3',
        '#edit-profile-modal label',
        '#edit-profile-modal button',
        '#page-profile .section-title',
        '#profile-edit-btn',
        '#view-my-profile-btn',
    ];

    root.querySelectorAll(scopedSelectors.join(',')).forEach((el) => {
        const original = el.dataset.i18nOriginalText || el.textContent?.trim();
        if (!original) return;
        if (!el.dataset.i18nOriginalText) {
            el.dataset.i18nOriginalText = original;
        }
        const translated = phraseMap[el.dataset.i18nOriginalText];
        if (translated) {
            el.textContent = translated;
        }
    });

    root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
        const original = el.dataset.i18nOriginalPlaceholder || el.getAttribute('placeholder');
        if (!original) return;
        if (!el.dataset.i18nOriginalPlaceholder) {
            el.dataset.i18nOriginalPlaceholder = original;
        }
        const translated = phraseMap[el.dataset.i18nOriginalPlaceholder];
        if (translated) {
            el.setAttribute('placeholder', translated);
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
