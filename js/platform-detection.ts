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
