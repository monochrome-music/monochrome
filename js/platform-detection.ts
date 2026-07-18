/** The original user agent string before spoofing. */
export const originalUserAgent = navigator.userAgent;

/** A lowercase version of the original user agent string. */
const lowerCaseOriginalUserAgent = originalUserAgent.toLowerCase();

/** If the device is an iOS device. (iPhone, iPad, iPod, or Apple Vision) */
export const isIos =
    /iphone|ipad|ipod|applevision/.test(lowerCaseOriginalUserAgent) ||
    (lowerCaseOriginalUserAgent.includes('mac') && navigator.maxTouchPoints > 1);

/** If the browser is Safari (excluding Chrome, Chromium-based browsers, and Android browsers). */
export const isSafari =
    lowerCaseOriginalUserAgent.includes('safari') &&
    !lowerCaseOriginalUserAgent.includes('chrome') &&
    !lowerCaseOriginalUserAgent.includes('crios') &&
    !lowerCaseOriginalUserAgent.includes('android');

/** If the browser is Chrome. */
export const isChrome = lowerCaseOriginalUserAgent.includes('chrome') || lowerCaseOriginalUserAgent.includes('crios');

const chromiumBrandPattern = /chromium|chrome|edge|opera|brave/i;
const userAgentBrands = (navigator as any).userAgentData?.brands || [];

/** If this browser has Chromium's native ClearKey/CENC behavior we rely on for Amazon streams. */
export const canUseNativeAmazonCenc =
    !isIos &&
    !isSafari &&
    (userAgentBrands.some((brand) => chromiumBrandPattern.test(brand.brand)) || !!(globalThis as any).chrome);


export function getLocalFilesSupportInfo(): { supported: boolean; message: string | null } {
    const isFileSystemAccessSupported = 'showDirectoryPicker' in window;

    if (isFileSystemAccessSupported) {
        return { supported: true, message: null };
    }

    const brands = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
    const isBrave = brands.some((brand) => /brave/i.test(brand.brand));

    if (isBrave) {
        return {
            supported: false,
            message:
                "We've detected you're on Brave, which disabled the File System API by default. Paste brave://flags/#file-system-access-api into your address bar, change it to Enabled, and relaunch your browser.",
        };
    }

    const isFirefox = /firefox/i.test(originalUserAgent) && !isChrome;
    if (isSafari || isFirefox) {
        return {
            supported: false,
            message:
                'Local Files is only available on Chromium-based browsers because Firefox and Safari explicitly do not support the File System Access API. We recommend <a href="https://helium.computer/" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline">Helium</a>.',
        };
    }

    return {
        supported: false,
        message:
            'Your browser doesn\'t support the File System Access API, which is required for Local Files. We recommend <a href="https://helium.computer/" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline">Helium</a>.',
    };
}
